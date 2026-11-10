#!/usr/bin/env python3
"""
Club Satori F1b — migración Firestore (creditos-73bac) → Supabase STAGING.

Spec: docs/club-satori/SPEC.md §7. Uso y reglas: scripts/club/README.md.

  python3 -I scripts/club/migrar_firestore.py --export ~/club-export/export.zip --dry-run
  python3 -I scripts/club/migrar_firestore.py --export ~/club-export/export.zip --apply

· SOLO STAGING: el ref está fijo y el script se niega a correr contra cualquier otro.
· Re-ejecutable: --apply borra primero todo lo club_* con origen='migracion' (nunca club_config)
  y vuelve a insertar, en UNA transacción.
· El export tiene contactos: nunca se imprimen nombres, teléfonos ni emails. Los CSV de revisión
  (equivalencias de negocios y duplicados) se escriben FUERA del repo (--out).
· Conexión: Management API de Supabase (SQL transaccional). Token en SUPABASE_ACCESS_TOKEN
  (variable de entorno, nunca en el repo); en la sesión de Claude Code lo inyecta el proxy.
"""
from __future__ import annotations

import argparse
import collections
import csv
import difflib
import hashlib
import json
import os
import re
import secrets
import ssl
import sys
import urllib.error
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

# ── Constantes ────────────────────────────────────────────────────────────────
STAGING_REF = 'hwiatgicyyqyezqwldia'
PROD_REF = 'yiczgdtirrkdvohdquzf'
# LC-ML: el local destino de la migración se pasa con --local (id de club_config); ninguno escrito en el código.
LOCATION = ''
VALOR_CREDITO_CRC = 18000
NOTA_TARJETA = 'fecha aproximada (carga)'
NOTA_VENC_136 = 'cancelación inactividad 05-nov-2026'
NOTA_D1 = 'cuenta borrada en el sistema viejo'
NOTA_RESTO = 'resto del sistema viejo'   # decisión de Ismael 07-nov
CORTE_D1 = '2026-11-01T06:00:00'   # 1-nov-2026 00:00 hora CR, en UTC
# CLUB-AUD-21: el export tiene que ser del negocio de Satori, y la cancelación del 05-nov cae ese día (hora CR).
SATORI_BIZ_ID = 'uPberDoE9w19ydF6bZSA'
VENTANA_VENC = ('2026-11-05T06:00:00', '2026-11-06T06:00:00')   # 05-nov-2026 00:00 → 24:00 hora CR, en UTC
ARCHIVOS = ('businesses.json', 'referrers.json', 'referrals.json', 'referrals_club.json', 'vencimientos_*.json')
REPO_ROOT = Path(__file__).resolve().parents[2]

ACENTOS = str.maketrans('áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')
RE_EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
RE_E164 = re.compile(r'^\+[1-9][0-9]{6,14}$')
RE_PM = re.compile(r'\bPM\s*$', re.IGNORECASE)

# Misma normalización que el índice único de club_negocios (mig 075).
SQL_NORM = "lower(translate(regexp_replace(btrim({c}), '\\s+', ' ', 'g'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'))"


def norm_texto(s: str | None) -> str:
    return re.sub(r'\s+', ' ', (s or '').strip()).translate(ACENTOS).lower()


def limpio(s: str | None) -> str:
    return re.sub(r'\s+', ' ', (s or '').strip())


def norm_telefono(s: str | None) -> tuple[str | None, str]:
    """E.164 (+506 si vienen 8 dígitos). 'None' o texto → None. Devuelve (valor, motivo)."""
    t = (s or '').strip().replace('±', '+')
    if not t:
        return None, 'vacio'
    if t.lower() in ('none', 'null', 'nan') or re.search(r'[A-Za-z]', t):
        return None, 'texto'
    t = re.sub(r'[\s\-().]', '', t)
    if re.fullmatch(r'\d{8}', t):
        t = '+506' + t
    elif re.fullmatch(r'[1-9]\d{7,14}', t):
        t = '+' + t
    return (t, 'ok') if RE_E164.match(t) else (None, 'invalido')


def norm_email(s: str | None) -> tuple[str | None, str]:
    e = (s or '').strip().lower()
    if not e:
        return None, 'vacio'
    return (e, 'ok') if len(e) <= 254 and RE_EMAIL.match(e) else (None, 'invalido')


def creditos(personas: int, ppc: int = 6) -> Decimal:
    if personas <= 0:
        return Decimal(0)
    return Decimal(personas // ppc) + (Decimal('0.5') if (personas % ppc) * 2 >= ppc else Decimal(0))


# ── Carga del export ─────────────────────────────────────────────────────────
class ExportInvalido(SystemExit):
    """El export no pasa los controles: se aborta antes de armar nada (código de salida 3)."""
    def __init__(self, msg: str):
        super().__init__(f'EXPORT RECHAZADO: {msg}')
        self.code = 3


def _leer_crudo(export: Path, patron: str) -> tuple[str, bytes] | None:
    if export.is_dir():
        cand = sorted(export.glob(patron))
        return (cand[0].name, cand[0].read_bytes()) if cand else None
    with zipfile.ZipFile(export) as z:
        nombres = sorted(n for n in z.namelist() if Path(n).match(patron))
        return (Path(nombres[0]).name, z.read(nombres[0])) if nombres else None


def leer_manifiesto(export: Path) -> dict:
    """CLUB-AUD-21. `MANIFEST.json` ({"provisional": bool, "archivos": {nombre: sha256}}) o, si no hay,
    el `MANIFEST.md` que genera el bot de Grok: cada línea con un nombre de archivo y un sha256 de 64
    hex. Un manifiesto que diga «provisional» (en el JSON o en el texto) se rechaza."""
    j = _leer_crudo(export, 'MANIFEST.json')
    if j:
        m = json.loads(j[1])
        if not isinstance(m, dict) or not isinstance(m.get('archivos'), dict):
            raise ExportInvalido('MANIFEST.json sin el mapa «archivos»')
        return {'provisional': bool(m.get('provisional', False)),
                'archivos': {Path(k).name: str(v).lower() for k, v in m['archivos'].items()}}
    md = _leer_crudo(export, 'MANIFEST.md')
    if not md:
        raise ExportInvalido('no hay MANIFEST.json ni MANIFEST.md')
    texto = md[1].decode('utf-8', 'replace')
    archivos = {}
    for linea in texto.splitlines():
        h = re.search(r'\b([0-9a-fA-F]{64})\b', linea)
        n = re.search(r'([A-Za-z0-9_.\-]+\.(?:json|csv))', linea)
        if h and n:
            archivos[n.group(1)] = h.group(1).lower()
    return {'provisional': bool(re.search(r'provisional', texto, re.I)), 'archivos': archivos}


def cargar(export: Path) -> dict:
    man = leer_manifiesto(export)
    if man['provisional']:
        raise ExportInvalido('el manifiesto está marcado como provisional')
    d = {'_sha256': {}}
    for patron in ARCHIVOS:
        r = _leer_crudo(export, patron)
        if r is None:
            raise ExportInvalido(f'falta {patron}')
        nombre, crudo = r
        sha = hashlib.sha256(crudo).hexdigest()
        if man['archivos'].get(nombre) != sha:
            raise ExportInvalido(f'{nombre}: el sha256 no coincide con el manifiesto (o no está listado)')
        d['_sha256'][nombre] = sha
        d[patron.replace('_*.json', '').replace('.json', '')] = json.loads(crudo)
    return d


# ── Plan de migración (puro, sin red) ────────────────────────────────────────
@dataclass
class Plan:
    rate: int = 6
    negocios: dict = field(default_factory=dict)        # norm → nombre a mostrar
    variantes: dict = field(default_factory=dict)       # (variante original, norm) → nº miembros
    miembros: list = field(default_factory=list)
    contactos: list = field(default_factory=list)
    movimientos: list = field(default_factory=list)
    pm_cargos: list = field(default_factory=list)
    pm_pagos: list = field(default_factory=list)
    neto_firestore: dict = field(default_factory=dict)  # legacy_id → personas (credit − debit)
    avisos: collections.Counter = field(default_factory=collections.Counter)
    duplicados: list = field(default_factory=list)


def armar_plan(d: dict) -> Plan:
    p = Plan()
    biz = d['businesses']
    if len(biz) != 1:
        raise ExportInvalido(f'se esperaba 1 negocio (Satori) en businesses.json y hay {len(biz)}')
    biz_id = biz[0].get('_id')
    if biz_id != SATORI_BIZ_ID:
        raise ExportInvalido('el negocio del export no es Satori')
    p.rate = int(biz[0]['peoplePointsRate'])

    referrers = [r for r in d['referrers'] if r.get('businessId') == biz_id]
    p.avisos['referrers_otro_negocio_excluidos'] = len(d['referrers']) - len(referrers)
    ids = {r['_id'] for r in referrers}
    referrals = [x for x in d['referrals'] if x['referrerId'] in ids]
    club = [x for x in d['referrals_club'] if x['referrerId'] in ids]
    venc_lista = list(d['vencimientos'])
    venc_ids = set(venc_lista)
    if len(venc_ids) != len(venc_lista):
        raise ExportInvalido('hay ids repetidos en vencimientos_*.json')
    if any(int(x['peoplePointsRateSnapshot']) != p.rate for x in referrals):
        sys.exit('Hay referrals con peoplePointsRateSnapshot distinto de la tasa del negocio: revisar antes de migrar')

    con_club = {x['referrerId'] for x in club if int(x['amount']) != 0}

    # [D1 corregida, firmada 05-nov] Fecha de la baja de una cuenta borrada:
    # max(updatedAt, último movimiento en referrals o referrals_club).
    ultimo = {}
    for x in referrals + club:
        ultimo[x['referrerId']] = max(ultimo.get(x['referrerId'], ''), x['createdAt'])
    fecha_baja = {r['_id']: max(r.get('updatedAt') or '', ultimo.get(r['_id'], '')) for r in referrers if r.get('deleted')}

    # Negocios: variantes → clave normalizada → nombre más frecuente.
    por_norm: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in referrers:
        wp = limpio(r.get('workPlace'))
        if wp:
            por_norm[norm_texto(wp)][wp] += 1
            p.variantes[(r.get('workPlace') or '', norm_texto(wp))] = p.variantes.get((r.get('workPlace') or '', norm_texto(wp)), 0) + 1
    for k, c in por_norm.items():
        p.negocios[k] = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0][:120]

    # Miembros + contactos
    uid_por_legacy = {}
    for r in referrers:
        nombre = limpio(r.get('name'))
        if not nombre:
            nombre = '(sin nombre)'
            p.avisos['nombre_vacio_reemplazado'] += 1
        if len(nombre) > 120:
            nombre = nombre[:120]
            p.avisos['nombre_recortado_120'] += 1
        wp = limpio(r.get('workPlace'))
        if 'satori' in norm_texto(nombre) or 'satori' in norm_texto(wp):
            tipo = 'equipo'
        elif RE_PM.search(nombre) or r['_id'] in con_club:
            tipo = 'concierge_pm'
        else:
            tipo = 'referente'
        uid = str(uuid.uuid4())
        uid_por_legacy[r['_id']] = uid
        p.miembros.append({
            'id': uid, 'legacy_id': r['_id'], 'tipo': tipo, 'nombre': nombre,
            'negocio_norm': norm_texto(wp) if wp else None,
            'estado': 'baja' if r.get('deleted') else 'activo',
            'fecha_baja': fecha_baja.get(r['_id']),
            'created_at': r.get('createdAt'), 'updated_at': r.get('updatedAt') or r.get('createdAt'),
            'sufijo_pm': bool(RE_PM.search(nombre)),
        })
        tel, mt = norm_telefono(r.get('phoneNumber'))
        em, me = norm_email(r.get('email'))
        p.avisos[f'telefono_{mt}'] += 1
        p.avisos[f'email_{me}'] += 1
        if tel or em:
            p.contactos.append({'miembro_id': uid, 'telefono': tel, 'email': em})

    # Duplicados: mismo nombre normalizado con distinto negocio (no se fusiona nada).
    por_nombre = collections.defaultdict(list)
    for m in p.miembros:
        por_nombre[norm_texto(m['nombre'])].append(m)
    for k, ms in por_nombre.items():
        if len({m['negocio_norm'] for m in ms}) > 1:
            p.duplicados.append(ms)

    # Neto en Firestore por referente (credit − debit, incluye los 136 de la cancelación).
    neto = collections.Counter()
    for x in referrals:
        neto[x['referrerId']] += x['peopleCount'] if x['referralType'] == 'credit' else -x['peopleCount']
    p.neto_firestore = {r['_id']: neto.get(r['_id'], 0) for r in referrers}

    # Tarjetas
    for x in referrals:
        if x['referralType'] != 'credit':
            continue
        if x['peopleCount'] <= 0:
            p.avisos['tarjeta_personas_no_positivas'] += 1
        p.movimientos.append({
            'miembro_id': uid_por_legacy[x['referrerId']], 'tipo': 'tarjeta', 'personas': x['peopleCount'],
            'creditos': None, 'fecha': x['createdAt'], 'nota': NOTA_TARJETA, 'legacy_ids': [x['_id']],
        })

    # Débitos: los 136 de la cancelación → vencimiento por referente; el resto → canjes por minuto UTC.
    debitos = [x for x in referrals if x['referralType'] == 'debit']
    p.avisos['debitos_total'] = len(debitos)
    por_id = {x['_id']: x for x in referrals}
    faltan = venc_ids - set(por_id)
    if faltan:
        raise ExportInvalido(f'{len(faltan)} ids de vencimientos no están entre los movimientos de Satori')
    no_debit = [i for i in venc_ids if por_id[i]['referralType'] != 'debit']
    if no_debit:
        raise ExportInvalido(f'{len(no_debit)} vencimientos no son débitos')
    fuera = [i for i in venc_ids if not (VENTANA_VENC[0] <= por_id[i]['createdAt'][:19] < VENTANA_VENC[1])]
    if fuera:
        raise ExportInvalido(f'{len(fuera)} vencimientos fuera del 05-nov-2026 (hora CR)')
    p.avisos['vencimientos_docs'] = len(venc_ids)
    grupos_v = collections.defaultdict(list)
    grupos_c = collections.defaultdict(list)
    for x in debitos:
        if x['_id'] in venc_ids:
            grupos_v[x['referrerId']].append(x)
        else:
            grupos_c[(x['referrerId'], x['createdAt'][:16])].append(x)
    p.avisos['debitos_vencimiento_docs'] = sum(len(v) for v in grupos_v.values())
    p.avisos['debitos_canje_docs'] = sum(len(v) for v in grupos_c.values())
    for (rid, _), xs in sorted(grupos_c.items()):
        pers = sum(x['peopleCount'] for x in xs)
        cr = Decimal(pers) / Decimal(p.rate)
        if cr % Decimal('0.5') != 0:
            p.avisos['canje_creditos_no_multiplo_0_5'] += 1
        if cr > 2:
            p.avisos['canje_mayor_a_2_creditos_D3'] += 1
        p.movimientos.append({
            'miembro_id': uid_por_legacy[rid], 'tipo': 'canje', 'personas': -pers, 'creditos': cr,
            'fecha': min(x['createdAt'] for x in xs), 'nota': None, 'legacy_ids': sorted(x['_id'] for x in xs),
        })
    for rid, xs in sorted(grupos_v.items()):
        p.movimientos.append({
            'miembro_id': uid_por_legacy[rid], 'tipo': 'vencimiento', 'personas': -sum(x['peopleCount'] for x in xs),
            'creditos': None, 'fecha': min(x['createdAt'] for x in xs), 'nota': NOTA_VENC_136,
            'legacy_ids': sorted(x['_id'] for x in xs),
        })

    # [D1] Cuentas borradas con saldo > 0 → vencimiento por el saldo, fechado en la baja
    # (max(updatedAt, último movimiento)). Si alguna fecha cae desde CORTE_D1, se frena.
    tardias = [m for m in p.miembros if m['estado'] == 'baja' and p.neto_firestore[m['legacy_id']] > 0
               and (not m['fecha_baja'] or m['fecha_baja'] >= CORTE_D1)]
    if tardias:
        sys.exit(f'FRENADO: {len(tardias)} cuentas borradas con saldo tienen fecha de baja desde {CORTE_D1} (o sin fecha)')
    for m in p.miembros:
        s = p.neto_firestore[m['legacy_id']]
        if m['estado'] == 'baja' and s > 0:
            p.movimientos.append({
                'miembro_id': m['id'], 'tipo': 'vencimiento', 'personas': -s, 'creditos': None,
                'fecha': m['fecha_baja'], 'nota': NOTA_D1, 'legacy_ids': None,
            })
        if s < 0:
            p.avisos['saldo_negativo_en_firestore'] += 1

    # PM: amount/100 = colones.
    for x in club:
        monto = Decimal(int(x['amount'])) / 100
        reg = {'miembro_id': uid_por_legacy[x['referrerId']], 'monto': monto, 'fecha': x['createdAt'], 'legacy_ids': [x['_id']],
               # [D2] el PM de una cuenta borrada se anula en la fecha de su baja
               'anulado_en': fecha_baja.get(x['referrerId'])}
        (p.pm_cargos if x['referralType'] == 'credit' else p.pm_pagos).append(reg)
    return p


# ── Inactividad sobre la fuente (B11, sin red) ───────────────────────────────
def inactivos_fuente(p: Plan, hoy_iso: str, meses: int = 12) -> list[dict]:
    """Cuentas ACTIVAS con saldo cuya última actividad (tarjeta o canje) es de antes de hoy − `meses`. Con «fecha de
    carga para todos» volverían a contar el plazo el día del lanzamiento: se deciden en la fuente antes de cargar.
    Devuelve legacy_id (id de la página vieja, no un dato personal), saldo en personas y la fecha; sin nombres."""
    import datetime as _dt
    hoy = _dt.date.fromisoformat(hoy_iso[:10])
    y, m = hoy.year, hoy.month - meses
    while m <= 0:
        m += 12; y -= 1
    corte = f'{y:04d}-{m:02d}-{hoy.day:02d}'
    saldo = collections.Counter(); ult: dict[str, str] = {}
    for mv in p.movimientos:
        saldo[mv['miembro_id']] += mv['personas']
        if mv['tipo'] in ('tarjeta', 'canje') and mv['fecha']:
            ult[mv['miembro_id']] = max(ult.get(mv['miembro_id'], ''), mv['fecha'][:10])
    out = []
    for mi in p.miembros:
        if mi['estado'] != 'activo' or saldo[mi['id']] <= 0:
            continue
        u = ult.get(mi['id']) or (mi.get('created_at') or '')[:10]
        if u < corte:
            out.append({'legacy_id': mi['legacy_id'], 'personas': saldo[mi['id']], 'ultima_actividad': u})
    return sorted(out, key=lambda x: x['ultima_actividad'])


def es_resto(personas: int, rate: int) -> bool:
    """Regla del 07-nov (la misma que el SQL de restos y club_vencer_candidatos): menos de medio crédito."""
    return 0 < personas and personas * 2 < rate


def vencer_restos_fuente(p: Plan, restos: list[dict]) -> int:
    """(10-nov, el dueño) Con la fecha de carga, las cuentas activas SIN actividad en el plazo cuyo saldo es un resto
    (< medio crédito) se vencen EN LA MISMA CARGA con la regla del 07-nov («resto del sistema viejo»), fechadas en la
    carga: entran con saldo 0 y no vuelven a contar el plazo. `restos` sale de inactivos_fuente (solo legacy_id)."""
    por_legacy = {m['legacy_id']: m for m in p.miembros}
    saldo = collections.Counter()
    for mv in p.movimientos:
        saldo[mv['miembro_id']] += mv['personas']
    for x in restos:
        m = por_legacy[x['legacy_id']]
        s = saldo[m['id']]
        assert m['estado'] == 'activo' and s == x['personas'] and es_resto(s, p.rate), 'resto inválido'
        p.movimientos.append({'miembro_id': m['id'], 'tipo': 'vencimiento', 'personas': -s, 'creditos': None,
                              'fecha': None, 'nota': NOTA_RESTO, 'legacy_ids': None})
    return len(restos)


# ── Validación local del plan (sin red) ──────────────────────────────────────
def pm_pendiente_plan(p: Plan) -> Decimal:
    """CLUB-AUD-22: UNA definición de PM pendiente, la de club_reporte_mes al día de hoy: todos los
    cargos del local salvo los anulados, menos todos los pagos. Sin mirar el estado actual de la cuenta."""
    return sum((c['monto'] for c in p.pm_cargos if not c['anulado_en']), Decimal(0)) - sum((c['monto'] for c in p.pm_pagos), Decimal(0))


def problemas_plan(p: Plan, res: dict) -> list[str]:
    """Lo que tiene que dar 0 ya en el plan: si no, ni el dry-run pasa."""
    out = []
    if res['diferencias_saldo_vs_firestore'] != 0:
        out.append(f"diferencias_saldo_vs_firestore = {res['diferencias_saldo_vs_firestore']}")
    if res['personas_baja_final'] != 0:
        out.append(f"personas_baja_final = {res['personas_baja_final']}")
    return out


def resumen_plan(p: Plan) -> dict:
    saldo = collections.Counter()
    for mv in p.movimientos:
        saldo[mv['miembro_id']] += mv['personas']
    neto_sin_d1 = collections.Counter()
    for mv in p.movimientos:
        if mv['nota'] not in (NOTA_D1, NOTA_RESTO):   # igual que sql_validar: D1 y restos no son de Firestore
            neto_sin_d1[mv['miembro_id']] += mv['personas']
    diffs = sum(1 for m in p.miembros if neto_sin_d1[m['id']] != p.neto_firestore[m['legacy_id']])
    act = [m for m in p.miembros if m['estado'] == 'activo']
    cr_eq = sum(creditos(saldo[m['id']], p.rate) for m in act if m['tipo'] == 'equipo')
    cr_ext = sum(creditos(saldo[m['id']], p.rate) for m in act if m['tipo'] != 'equipo')
    cuentas = sum(1 for m in act if creditos(saldo[m['id']], p.rate) > 0)
    pm = pm_pendiente_plan(p)
    tipos = collections.Counter(mv['tipo'] for mv in p.movimientos)
    return {
        'miembros': len(p.miembros), 'miembros_por_tipo': dict(collections.Counter(m['tipo'] for m in p.miembros)),
        'miembros_baja': sum(1 for m in p.miembros if m['estado'] == 'baja'),
        'negocios': len(p.negocios), 'contactos': len(p.contactos),
        'tarjetas': tipos['tarjeta'], 'canjes': tipos['canje'],
        'vencimientos_136': sum(1 for mv in p.movimientos if mv['nota'] == NOTA_VENC_136),
        'vencimientos_d1': sum(1 for mv in p.movimientos if mv['nota'] == NOTA_D1),
        # (10-nov) los restos vencidos EN EL PLAN (solo con --vencer-restos-inactivos; con fechas originales los vence el SQL)
        'vencimientos_restos': sum(1 for mv in p.movimientos if mv['nota'] == NOTA_RESTO),
        'vencimientos_restos_personas': -sum(mv['personas'] for mv in p.movimientos if mv['nota'] == NOTA_RESTO),
        'pm_cargos': len(p.pm_cargos), 'pm_pagos': len(p.pm_pagos),
        'diferencias_saldo_vs_firestore': diffs,
        'creditos_activos': str(cr_eq + cr_ext), 'creditos_activos_externos': str(cr_ext),
        'creditos_activos_equipo': str(cr_eq), 'cuentas_activas_con_creditos': cuentas,
        'personas_baja_final': sum(saldo[m['id']] for m in p.miembros if m['estado'] == 'baja'),
        'pm_pendiente': str(pm),
        'avisos': dict(p.avisos),
    }


# ── CSV de revisión (FUERA del repo) ─────────────────────────────────────────
def escribir_csv(p: Plan, out: Path) -> tuple[Path, Path]:
    claves = sorted(p.negocios)
    alnum = collections.defaultdict(list)
    for k in claves:
        alnum[re.sub(r'[^a-z0-9]', '', k)].append(k)
    eq = out / 'equivalencias_negocios.csv'
    with eq.open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['variante', 'negocio_propuesto', 'miembros', 'sugerencia_fusion (no aplicada)'])
        for (var, k), n in sorted(p.variantes.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            sug = [p.negocios[o] for o in alnum[re.sub(r'[^a-z0-9]', '', k)] if o != k]
            sug += [p.negocios[o] for o in difflib.get_close_matches(k, claves, n=3, cutoff=0.86) if o != k and p.negocios[o] not in sug]
            w.writerow([var, p.negocios[k], n, ' | '.join(sug)])
    dup = out / 'duplicados.csv'
    with dup.open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['grupo', 'legacy_id', 'nombre', 'negocio', 'estado', 'tipo'])
        for i, ms in enumerate(p.duplicados, 1):
            for m in ms:
                w.writerow([i, m['legacy_id'], m['nombre'], p.negocios.get(m['negocio_norm'] or '', ''), m['estado'], m['tipo']])
    for f in (eq, dup):
        os.chmod(f, 0o600)
    return eq, dup


# ── SQL ──────────────────────────────────────────────────────────────────────
def q(v) -> str:
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, Decimal)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def arr(xs) -> str:
    return 'null' if not xs else 'array[' + ','.join(q(x) for x in xs) + ']::text[]'


def _jsonable(v):
    if isinstance(v, Decimal):
        return str(v)
    raise TypeError(type(v))


def cruce_papel_firestore(p: Plan, papel_filas: list[dict], tolerancia_dias: int = 3) -> dict:
    """(Grok 115) El mismo cruce que hace la transacción, antes de emitir: cada tarjeta de papel (por legacy_id) contra
    los créditos de Firestore del plan (mismo anfitrión, mismas personas, ≤ tolerancia días). Solo líneas e ids."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import saldos_papel as sp
    legacy_de = {m['id']: m['legacy_id'] for m in p.miembros}
    creditos = [{'_id': mv['legacy_ids'][0], 'referrerId': legacy_de[mv['miembro_id']], 'referralType': 'credit',
                 'peopleCount': mv['personas'], 'createdAt': mv['fecha']}
                for mv in p.movimientos if mv['tipo'] == 'tarjeta' and mv.get('legacy_ids')]
    return sp.cruzar(papel_filas, creditos, {f['codigo']: f['codigo'] for f in papel_filas}, tolerancia_dias)


def sql_apply(p: Plan, esperados: dict | None = None, ensayo: bool = False, primera: bool = False,
              fecha_carga: bool = False, vaciar_ensayo: bool = False, papel: str | None = None) -> str:
    """Todo en UNA transacción: precheck → limpieza de lo migrado → carga → restos → VALIDACIÓN → commit.
    · CLUB-AUD-19: la validación corre ANTES del commit y hace `raise` si algo no cuadra (nada queda cargado).
    · CLUB-AUD-20: los datos (con nombres, teléfonos y emails) viajan en UN solo literal jsonb y se
      expanden con jsonb_to_recordset; los errores nunca se imprimen con el cuerpo (ver ejecutar).
    · CLUB-AUD-23: al re-ejecutar se conservan id, código y token de cada miembro por legacy_id; y se
      aborta si ya hay cierres de mes congelados (club_reportes_cerrados).
    · ensayo=True termina en ROLLBACK: valida contra la base sin dejar nada.
    · (09-nov, B2) frena si hay una carga de tarjetas de papel (origen 'papel' o club_cargas_papel): nunca la borra.
    · (09-nov, B11) primera=True: la CARGA ÚNICA del lanzamiento. No emite ningún delete; exige la base del Club vacía
      (precondición «cero socios»). fecha_carga=True: todos los movimientos con la fecha de la carga (el dueño: «fecha
      de carga para todos»; la inactividad de más de 12 meses se decide antes, en la fuente: inactivos_fuente).
    · vaciar_ensayo=True (solo con ensayo y solo en una base marcada como staging): vacía el Club DENTRO de la
      transacción para ensayar la primera carga sobre una base vacía; el ROLLBACK lo deshace."""
    assert not vaciar_ensayo or (ensayo and primera), 'vaciar_ensayo solo con ensayo y primera carga'
    assert papel is None or primera, 'la carga de papel dentro de la migración es solo para la primera carga'

    datos = {
        'negocios': list(p.negocios.values()),
        'miembros': [{k: m[k] for k in ('id', 'legacy_id', 'tipo', 'nombre', 'negocio_norm', 'estado', 'created_at', 'updated_at')}
                     for m in p.miembros],
        'contactos': p.contactos,
        'movimientos': [{**{k: mv[k] for k in ('miembro_id', 'tipo', 'personas', 'creditos', 'fecha', 'nota')},
                         'legacy_ids': mv['legacy_ids']} for mv in p.movimientos],
        'pm_cargos': [{'miembro_id': c['miembro_id'], 'monto': c['monto'], 'fecha': c['fecha'], 'anulado_en': c['anulado_en'],
                       'legacy_ids': c['legacy_ids']} for c in p.pm_cargos],
        'pm_pagos': [{'miembro_id': c['miembro_id'], 'monto': c['monto'], 'fecha': c['fecha'], 'legacy_ids': c['legacy_ids']}
                     for c in p.pm_pagos],
        'neto_firestore': p.neto_firestore,
    }
    cuerpo = json.dumps(datos, ensure_ascii=False, default=_jsonable)
    tag = '$d' + secrets.token_hex(8) + '$'
    while tag in cuerpo:
        tag = '$d' + secrets.token_hex(8) + '$'
    res = resumen_plan(p)
    plan_ctrl = {
        'miembros': res['miembros'], 'tarjetas': res['tarjetas'], 'canjes': res['canjes'],
        'pm_cargos': res['pm_cargos'], 'pm_pagos': res['pm_pagos'], 'pm_pendiente': res['pm_pendiente'],
        'vencimientos_136': res['vencimientos_136'], 'vencimientos_d1': res['vencimientos_d1'],
    }
    if fecha_carga:   # (10-nov) con la fecha de carga el SQL de restos no vence nada: los restos son los del plan
        plan_ctrl['vencimientos_restos'] = res['vencimientos_restos']
        plan_ctrl['vencimientos_restos_personas'] = res['vencimientos_restos_personas']
    esp = json.dumps(esperados or {}, ensure_ascii=False)
    ctl = json.dumps(plan_ctrl, ensure_ascii=False)
    hoy = "(now() at time zone 'America/Costa_Rica')::date"
    neg = SQL_NORM.format(c='n.nombre')

    L = ["begin;", "set local statement_timeout = '300s';"]
    if vaciar_ensayo:
        L += ["set local club.libro_mantenimiento = 'pruebas';",
              "do $$ begin if not public.club_modo_pruebas() then raise exception 'CLUB: el vaciado de ensayo solo existe en staging'; end if; end $$;",
              "truncate public.club_miembros, public.club_negocios, public.club_cargas_papel cascade;"]
    if primera:
        L.append("""do $$ begin
  if exists (select 1 from public.club_miembros) or exists (select 1 from public.club_movimientos)
     or exists (select 1 from public.club_negocios) or exists (select 1 from public.club_cargas_papel) then
    raise exception 'CLUB: primera carga: la base del Club no está vacía (precondición «cero socios»): no se borra nada';
  end if;
end $$;""")
    L.append(f"""do $$ begin
  if not exists (select 1 from public.club_config where location_id = {q(LOCATION)}) then
    raise exception 'CLUB: el local {LOCATION} no está dado de alta en club_config (RUNBOOK, alta de los locales)';
  end if;
  if (select personas_por_credito from public.club_config where location_id = {q(LOCATION)}) is distinct from {p.rate} then
    raise exception 'CLUB: club_config.personas_por_credito no coincide con la tasa del export ({p.rate})';
  end if;
  if exists (select 1 from public.club_movimientos mv join public.club_miembros m on m.id = mv.miembro_id
              where m.origen = 'migracion' and mv.origen <> 'migracion')
     or exists (select 1 from public.club_cupones c join public.club_miembros m on m.id = c.referente_id where m.origen = 'migracion')
     or exists (select 1 from public.club_pm_cargos c join public.club_miembros m on m.id = c.miembro_id where m.origen = 'migracion' and c.origen <> 'migracion')
     or exists (select 1 from public.club_pm_pagos c join public.club_miembros m on m.id = c.miembro_id where m.origen = 'migracion' and c.origen <> 'migracion')
     or exists (select 1 from public.club_visitas v join public.club_miembros m on m.id = v.miembro_id where m.origen = 'migracion') then
    raise exception 'CLUB: hay datos cargados en la app sobre miembros migrados: no se borra nada';
  end if;
  if exists (select 1 from public.club_reportes_cerrados) then
    raise exception 'CLUB: ya hay meses cerrados (club_reportes_cerrados): re-migrar cambiaría reportes congelados';
  end if;
  if exists (select 1 from public.club_movimientos where origen = 'papel') or exists (select 1 from public.club_cargas_papel) then
    raise exception 'CLUB: hay una carga de tarjetas de papel: el migrador no corre (nunca la borra; ver saldos-papel.md)';
  end if;
end $$;""")
    L.append(f"create temp table _datos on commit drop as select {tag}{cuerpo}{tag}::jsonb as d;")
    # 23: identidad de cada miembro migrado antes de borrar
    if primera:
        L.append("create temp table _prev (legacy_id text, id uuid, codigo text, token_portal text) on commit drop;")
    else:
        L.append("create temp table _prev on commit drop as select legacy_id, id, codigo, token_portal from public.club_miembros where origen = 'migracion';")
    L += [] if primera else [
        "delete from public.club_pm_cargos where origen = 'migracion';",
        "delete from public.club_pm_pagos where origen = 'migracion';",
        # el libro es de solo inserción: el migrador declara que borra SOLO sus filas (origen = 'migracion')
        "set local club.libro_mantenimiento = 'migracion';",
        "delete from public.club_movimientos where origen = 'migracion';",
        "delete from public.club_miembros_contacto c using public.club_miembros m where m.id = c.miembro_id and m.origen = 'migracion';",
        # LC-A1: los roles referencian al miembro (se vuelven a crear solos con el alta)
        "delete from public.club_socio_solicitudes q using public.club_miembros m where m.id = q.miembro_id and m.origen = 'migracion';",
        "delete from public.club_miembro_roles r using public.club_miembros m where m.id = r.miembro_id and m.origen = 'migracion';",
        "delete from public.club_miembros where origen = 'migracion';",
        "delete from public.club_negocios n where n.origen = 'migracion' and not exists (select 1 from public.club_miembros m where m.negocio_id = n.id);",
    ]
    L.append(f"""insert into public.club_negocios (location_id, nombre, tipo, activo, origen)
select {q(LOCATION)}, x.nombre, 'otro', true, 'migracion' from _datos, jsonb_array_elements_text(d->'negocios') as x(nombre)
on conflict do nothing;""")
    L.append(f"""insert into public.club_miembros (id, location_id, tipo, nombre, negocio_id, estado, origen, legacy_id, created_at, updated_at, codigo, token_portal)
select coalesce(pv.id, j.id), {q(LOCATION)}, j.tipo, j.nombre,
       (select n.id from public.club_negocios n where n.location_id = {q(LOCATION)} and {neg} = j.negocio_norm),
       j.estado, 'migracion', j.legacy_id, j.created_at, j.updated_at,
       coalesce(pv.codigo, public.club_gen_codigo(8)), coalesce(pv.token_portal, encode(extensions.gen_random_bytes(32), 'hex'))
  from _datos, jsonb_to_recordset(d->'miembros') as j(id uuid, legacy_id text, tipo text, nombre text, negocio_norm text,
                                                       estado text, created_at timestamptz, updated_at timestamptz)
  left join _prev pv on pv.legacy_id = j.legacy_id;""")
    L.append("""create temp table _map on commit drop as
select j.id as plan_id, m.id from _datos, jsonb_to_recordset(d->'miembros') as j(id uuid, legacy_id text)
  join public.club_miembros m on m.legacy_id = j.legacy_id;""")
    L.append(f"""insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email, optin_whatsapp, optin_email)
select mp.id, {q(LOCATION)}, j.telefono, j.email, false, false
  from _datos, jsonb_to_recordset(d->'contactos') as j(miembro_id uuid, telefono text, email text)
  join _map mp on mp.plan_id = j.miembro_id;""")
    L.append(f"""insert into public.club_movimientos (location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc,
                                     fecha_visita, registrado_en, origen, nota, legacy_ids)
select {q(LOCATION)}, mp.id, j.tipo, j.personas, j.creditos, {p.rate}, {VALOR_CREDITO_CRC},
       {"now(), now()" if fecha_carga else "coalesce(j.fecha, now()), coalesce(j.fecha, now())"}, 'migracion', j.nota, j.legacy_ids
  from _datos, jsonb_to_recordset(d->'movimientos') as j(miembro_id uuid, tipo text, personas int, creditos numeric,
                                                          fecha timestamptz, nota text, legacy_ids text[])
  join _map mp on mp.plan_id = j.miembro_id;""")
    L.append(f"""insert into public.club_pm_cargos (location_id, miembro_id, monto_crc, estado, origen, legacy_ids, created_at, anulado_en)
select {q(LOCATION)}, mp.id, j.monto, case when j.anulado_en is null then 'pendiente' else 'anulado' end, 'migracion', j.legacy_ids, j.fecha, j.anulado_en
  from _datos, jsonb_to_recordset(d->'pm_cargos') as j(miembro_id uuid, monto numeric, fecha timestamptz, anulado_en timestamptz, legacy_ids text[])
  join _map mp on mp.plan_id = j.miembro_id;""")
    L.append(f"""insert into public.club_pm_pagos (location_id, miembro_id, monto_crc, pagado_en, origen, legacy_ids, created_at)
select {q(LOCATION)}, mp.id, j.monto, j.fecha, 'migracion', j.legacy_ids, j.fecha
  from _datos, jsonb_to_recordset(d->'pm_pagos') as j(miembro_id uuid, monto numeric, fecha timestamptz, legacy_ids text[])
  join _map mp on mp.plan_id = j.miembro_id;""")
    # [Restos, decisión de Ismael 07-nov] Las cuentas sin actividad en el plazo de vencimiento que solo
    # tienen un resto de menos de medio crédito (1 o 2 personas con la tasa 6) se vencen acá, con la
    # fecha de la migración (mismo criterio que club_vencer_candidatos). La validación exige después
    # que la simulación de hoy dé 0 cuentas.
    L.append(f"""insert into public.club_movimientos (location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, nota)
select k.location_id, k.miembro_id, 'vencimiento', -k.personas, null, k.personas_por_credito, k.valor_credito_crc, now(), now(), 'migracion', {q(NOTA_RESTO)}
  from public.club_vencer_candidatos({hoy}) k
  join public.club_miembros m on m.id = k.miembro_id and m.origen = 'migracion'
 where k.personas * 2 < k.personas_por_credito;""")
    # 19: validación DENTRO de la transacción
    if papel:
        # B11 · la carga ÚNICA: las tarjetas de papel (por legacy_id) en la MISMA transacción, después de crear a los
        # anfitriones y antes de la validación. Trae su propio lock, línea de base, registro del lote y validación.
        L.append(papel)
    L.append(f"create temp table _val on commit drop as {sql_validar()};")
    L.append(f"""do $$
declare v jsonb := (select r from _val); e jsonb := {q(esp)}::jsonb; c jsonb := {q(ctl)}::jsonb; f text[] := '{{}}'; k text;
begin
  if (v->>'diferencias_saldo_vs_firestore')::int <> 0 then f := f || ('diferencias_saldo_vs_firestore=' || (v->>'diferencias_saldo_vs_firestore')); end if;
  if (v->>'cuentas_baja_con_saldo')::int <> 0 then f := f || ('cuentas_baja_con_saldo=' || (v->>'cuentas_baja_con_saldo')); end if;
  if (v->>'vencer_simular_hoy')::int <> 0 then f := f || ('vencer_simular_hoy=' || (v->>'vencer_simular_hoy')); end if;
  if (v->>'barrido_anon_abiertas')::int <> 0 then f := f || ('barrido_anon_abiertas=' || (v->>'barrido_anon_abiertas')); end if;
  -- lo que dice el plan (Python) tiene que ser lo que quedó en la base
  for k in select jsonb_object_keys(c) loop
    if (v->>k)::numeric is distinct from (c->>k)::numeric then f := f || (k || ': base=' || coalesce(v->>k, 'null') || ' plan=' || (c->>k)); end if;
  end loop;
  -- y los esperados firmados por Ismael (--esperados)
  for k in select jsonb_object_keys(e) loop
    if not (v ? k) then
      f := f || (k || ': no existe en la validación');
    elsif jsonb_typeof(e->k) = 'number' then
      if (v->>k)::numeric is distinct from (e->>k)::numeric then f := f || (k || ': base=' || (v->>k) || ' esperado=' || (e->>k)); end if;
    elsif (v->k) is distinct from (e->k) then
      f := f || (k || ': base=' || (v->>k) || ' esperado=' || (e->>k));
    end if;
  end loop;
  if cardinality(f) > 0 then
    raise exception 'CLUB: validación fallida, no se guarda nada: %', array_to_string(f, '; ');
  end if;
end $$;""")
    L.append("select r from _val;")
    L.append('rollback;' if ensayo else 'commit;')
    return '\n'.join(L)


def sql_validar() -> str:
    """Solo agregados (sin nombres, teléfonos ni emails). Corre dentro de la transacción del apply."""
    return f"""
with esperado as (select key as legacy_id, value::int as neto from _datos, jsonb_each_text(d->'neto_firestore')),
mig as (select m.* from public.club_miembros m where m.origen = 'migracion'),
real as (
  select m.legacy_id, coalesce(sum(mv.personas) filter (where mv.origen <> 'papel' and not coalesce(mv.nota in ({q(NOTA_D1)}, {q(NOTA_RESTO)}), false)), 0) as neto
  from mig m left join public.club_movimientos mv on mv.miembro_id = m.id group by m.legacy_id),
sal as (select s.*, m.tipo as tipo_m, m.estado as estado_m from public.club_saldos s join mig m on m.id = s.miembro_id),
mov as (select mv.* from public.club_movimientos mv join mig m on m.id = mv.miembro_id where mv.origen = 'migracion'),
mes as (
  select tipo, to_char(fecha_visita at time zone 'America/Costa_Rica', 'YYYY-MM') as mes_cr,
         personas, coalesce(creditos, 0) as creditos
  from mov where tipo in ('tarjeta','canje'))
select json_build_object(
  'miembros', (select count(*) from mig),
  'miembros_baja', (select count(*) from mig where estado = 'baja'),
  'negocios_migracion', (select count(*) from public.club_negocios where origen = 'migracion'),
  'contactos', (select count(*) from public.club_miembros_contacto c join mig m on m.id = c.miembro_id),
  'tarjetas', (select count(*) from mov where tipo = 'tarjeta'),
  'canjes', (select count(*) from mov where tipo = 'canje'),
  'canjes_mayores_a_2', (select count(*) from mov where tipo = 'canje' and creditos > 2),
  'vencimientos_136', (select count(*) from mov where tipo = 'vencimiento' and nota = {q(NOTA_VENC_136)}),
  'vencimientos_136_docs', (select coalesce(sum(cardinality(legacy_ids)), 0) from mov where tipo = 'vencimiento' and nota = {q(NOTA_VENC_136)}),
  'vencimientos_d1', (select count(*) from mov where tipo = 'vencimiento' and nota = {q(NOTA_D1)}),
  'vencimientos_restos', (select count(*) from mov where tipo = 'vencimiento' and nota = {q(NOTA_RESTO)}),
  'vencimientos_restos_personas', (select coalesce(-sum(personas), 0) from mov where tipo = 'vencimiento' and nota = {q(NOTA_RESTO)}),
  'vencer_simular_hoy', (select count(*) from public.club_vencer_candidatos((now() at time zone 'America/Costa_Rica')::date)),
  'docs_legacy_en_canjes', (select coalesce(sum(cardinality(legacy_ids)), 0) from mov where tipo = 'canje'),
  'pm_cargos', (select count(*) from public.club_pm_cargos where origen = 'migracion'),
  'pm_pagos', (select count(*) from public.club_pm_pagos where origen = 'migracion'),
  'diferencias_saldo_vs_firestore', (select count(*) from esperado e full join real r using (legacy_id) where e.neto is distinct from r.neto),
  'creditos_activos', (select sum(creditos) from sal where estado_m = 'activo'),
  'creditos_activos_externos', (select sum(creditos) from sal where estado_m = 'activo' and tipo_m <> 'equipo'),
  'creditos_activos_equipo', (select sum(creditos) from sal where estado_m = 'activo' and tipo_m = 'equipo'),
  'cuentas_activas_con_creditos', (select count(*) from sal where estado_m = 'activo' and creditos > 0),
  'personas_baja_final', (select coalesce(sum(personas), 0) from sal where estado_m = 'baja'),
  'cuentas_baja_con_saldo', (select count(*) from sal where estado_m = 'baja' and personas <> 0),
  -- CLUB-AUD-22: UNA definición, la de club_reporte_mes al día de hoy (cargos no anulados − pagos)
  'pm_pendiente', (select coalesce(sum(c.monto_crc), 0) from public.club_pm_cargos c where c.origen = 'migracion' and c.estado <> 'anulado')
                - (select coalesce(sum(p.monto_crc), 0) from public.club_pm_pagos p where p.origen = 'migracion'),
  'pm_anulados', (select json_build_object('cargos', count(*), 'monto', coalesce(sum(monto_crc), 0), 'ultima_fecha', max(anulado_en))
                    from public.club_pm_cargos where origen = 'migracion' and estado = 'anulado'),
  'd1_rango_fechas', (select json_build_object('desde', min(fecha_visita), 'hasta', max(fecha_visita)) from mov where tipo = 'vencimiento' and nota = {q(NOTA_D1)}),
  'por_mes_cr', (select json_object_agg(mes, v order by mes) from (select mes_cr as mes, json_build_object('tarjetas_personas', sum(personas) filter (where tipo='tarjeta'), 'canjes_creditos', sum(creditos) filter (where tipo='canje')) v from mes group by mes_cr) a),
  'barrido_anon_abiertas', ({SQL_BARRIDO_ANON_CUERPO})
)::jsonb as r"""


SQL_BARRIDO_ANON_CUERPO = """
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p','v','m')
  and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))
  and (
    (c.relkind in ('r','p') and not c.relrowsecurity)
    or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
               and p.roles && array['anon','public']::name[]
               and coalesce(p.qual,'') || coalesce(p.with_check,'') !~* '(auth\\.uid|auth\\.role|auth\\.jwt|get_my_role|is_[a-z_]+\\(|current_user|profiles)'))
"""


# ── Ejecución contra STAGING ────────────────────────────────────────────────
RE_SQLSTATE = re.compile(r'ERROR:\s+([0-9A-Z]{5}):')
RE_PII = re.compile(r'@|\+\d|\d{8,}')


def mensaje_error(cuerpo: str) -> str:
    """CLUB-AUD-20: nunca se imprime el cuerpo del error (Postgres repite el SQL con `LINE n:` y el SQL
    lleva los datos personales). Sale solo el SQLSTATE y un texto genérico; los mensajes propios del
    script (prefijo «CLUB:», solo conteos y nombres de controles) se muestran si no tienen nada que
    parezca un teléfono o un email."""
    m = RE_SQLSTATE.search(cuerpo or '')
    estado = m.group(1) if m else 'desconocido'
    propio = re.search(r'CLUB: ([^\n]*)', cuerpo or '')
    if propio and not RE_PII.search(propio.group(1)):
        return f'SQLSTATE {estado}: {propio.group(1)[:500]}'
    return f'SQLSTATE {estado} (detalle oculto: puede contener datos personales)'


def ejecutar(ref: str, sql: str, read_only: bool = False, _prod_firmado: bool = False):
    if not ((ref == STAGING_REF) or (_prod_firmado and ref == PROD_REF)):
        sys.exit('NEGADO: este script solo corre contra STAGING (prod: solo --aplicar-firmado de una carga emitida).')
    url = f'https://api.supabase.com/v1/projects/{ref}/database/query'
    headers = {'Content-Type': 'application/json'}
    if os.environ.get('SUPABASE_ACCESS_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN']
    cafile = os.environ.get('SSL_CERT_FILE') or ('/root/.ccr/ca-bundle.crt' if os.path.exists('/root/.ccr/ca-bundle.crt') else None)
    ctx = ssl.create_default_context(cafile=cafile) if cafile else None
    req = urllib.request.Request(url, data=json.dumps({'query': sql, 'read_only': read_only}).encode(), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=600) as r:
            return json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode('utf-8', 'replace')
        sys.exit(f'Error de la base ({e.code}): {mensaje_error(cuerpo)}')


# ── Saldos de tarjetas de papel (Ismael, 08-nov noche): validar, emitir con las reglas de G-56, ensayo en staging ──
def main_saldos_papel(argv: list[str]) -> None:
    import datetime as _dt
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import saldos_papel as sp
    if '--aplicar-firmado' in argv:
        af = argparse.ArgumentParser(prog='migrar_firestore.py saldos-papel --aplicar-firmado',
                                     description='G-56 modo PROD: aplica un carga.sql emitido, tal cual, si su sha256 es el firmado')
        af.add_argument('--aplicar-firmado', type=Path, required=True)
        af.add_argument('--sha256', required=True, help='el sha256 firmado del carga.sql (resumen.json)')
        af.add_argument('--ref', default=STAGING_REF)
        af.add_argument('--confirmo-ref', help='contra prod: volver a escribir el ref de prod')
        aplicar_firmado(af.parse_args(argv), sp); return
    ap = argparse.ArgumentParser(prog='migrar_firestore.py saldos-papel',
                                 description='Carga de saldos de tarjetas de papel (plantilla: scripts/club/plantilla_saldos_papel.csv)')
    ap.add_argument('--local', required=True, help='id del local de club_config')
    ap.add_argument('--ref', default=STAGING_REF, help='ref de Supabase; solo se acepta staging')
    fuente = ap.add_mutually_exclusive_group(required=True)
    fuente.add_argument('--csv', type=Path, help='el CSV (fuera del repo)')
    fuente.add_argument('--ficticios', type=int, help='N anfitriones y tarjetas FICTICIOS (solo con --ensayo)')
    ap.add_argument('--fecha-movimiento', choices=sp.FECHAS, default='carga',
                    help="fecha del movimiento: 'carga' (por defecto; el dueño, 09-nov) o 'tarjeta'")
    ap.add_argument('--vencimiento-meses', type=int, default=12)
    ap.add_argument('--acepto-inactivos', type=int, default=None,
                    help='(B11) cuántas tarjetas con más de N meses sin actividad se cargan igual, sabiéndolo (el número exacto)')
    modo = ap.add_mutually_exclusive_group(required=True)
    modo.add_argument('--validar', action='store_true', help='solo valida el CSV (no conecta)')
    modo.add_argument('--emitir', type=Path, help='escribe carga.sql, ensayo.sql y resumen.json en esta carpeta (fuera del repo); no conecta')
    modo.add_argument('--ensayo', action='store_true', help='corre el ensayo en STAGING dentro de una transacción con ROLLBACK')
    a = ap.parse_args(argv)
    if a.ref != STAGING_REF:
        sys.exit('NEGADO: la carga de saldos de papel solo se ensaya contra STAGING; prod va con el paquete firmado (G-56, --aplicar-firmado).')
    if not re.fullmatch(r'[a-z0-9-]{2,40}', a.local):
        sys.exit('NEGADO: --local mal formado.')
    previo = ''
    if a.ficticios is not None:
        if not a.ensayo or not (1 <= a.ficticios <= 50):
            sys.exit('NEGADO: --ficticios solo con --ensayo y entre 1 y 50.')
        filas, previo = sp.ficticios(a.ficticios, a.local)
    else:
        archivo = a.csv.expanduser().resolve()
        if archivo == REPO_ROOT or REPO_ROOT in archivo.parents:
            sys.exit('NEGADO: el CSV está dentro del repo. Los datos de anfitriones van fuera.')
        filas, errores = sp.validar(archivo.read_text(encoding='utf-8'), _dt.date.today())
        if errores:
            print('CSV RECHAZADO (no se carga nada):'); print('\n'.join('  ' + e for e in errores[:200])); sys.exit(1)
        if a.fecha_movimiento == 'carga':
            inac = sp.inactivos(filas, _dt.date.today(), a.vencimiento_meses)
            if inac and a.acepto_inactivos != len(inac):
                print(f'FRENADO (B11): {len(inac)} tarjetas con más de {a.vencimiento_meses} meses sin actividad (con la fecha de carga '
                      'volverían a contar el plazo). Decidilas en la fuente, o --acepto-inactivos N si el dueño decidió cargarlas igual:')
                print('\n'.join(f"  línea {x['linea']} · {x['referencia']} · {x['meses']} meses" for x in inac[:200])); sys.exit(2)
    if a.validar:
        print(json.dumps({'csv': 'ok', 'filas': len(filas), 'personas': sum(f['personas'] for f in filas)}, ensure_ascii=False)); return
    if a.emitir:
        out = a.emitir.expanduser().resolve()
        if out == REPO_ROOT or REPO_ROOT in out.parents:
            sys.exit('NEGADO: --emitir está dentro del repo.')
        out.mkdir(parents=True, exist_ok=True); os.chmod(out, 0o700)
        carga = sp.sql_carga(filas, a.local, 'prod', a.fecha_movimiento); ensayo = sp.sql_ensayo(filas, a.local, 'prod', '', a.fecha_movimiento)
        for sql in (carga, ensayo):
            malos = sp.filtrar(sql)   # B1: análisis real (sql_g56)
            if malos:
                sys.exit('FILTRO G-56: ' + '; '.join(malos))
        for nombre, txt in (('carga.sql', carga), ('ensayo.sql', ensayo)):
            (out / nombre).write_text(txt, encoding='utf-8'); os.chmod(out / nombre, 0o600)
        r = sp.resumen(filas, carga, a.local, a.fecha_movimiento) | {'sha256_ensayo': __import__('hashlib').sha256(ensayo.encode()).hexdigest()}
        (out / 'resumen.json').write_text(sp.json_resumen(r), encoding='utf-8')
        print(sp.json_resumen(r)); return
    # --ensayo: staging, el mismo cuerpo con ROLLBACK; el filtro se corre otra vez antes de mandar
    sql = sp.sql_ensayo(filas, a.local, 'staging', previo, a.fecha_movimiento)
    malos = sp.filtrar(sql, ficticios=bool(previo))
    if malos:
        sys.exit('FILTRO G-56: ' + '; '.join(malos))
    ejecutar(a.ref, sql)
    print(json.dumps({'ensayo': 'ok (validación dentro de la transacción; terminó en ROLLBACK)', **sp.resumen(filas, sql, a.local, a.fecha_movimiento)},
                     ensure_ascii=False, indent=1))


def aplicar_firmado(a, sp) -> None:
    """G-56 · MODO PROD (09-nov, B1). Aplica un carga.sql EMITIDO por --emitir, byte a byte, si:
      1. su sha256 es el firmado (--sha256, el de resumen.json que firmó el dueño);
      2. pasa el análisis real del SQL (sql_g56) otra vez, justo antes de mandarlo;
      3. contra prod: --confirmo-ref repite el ref de prod Y la variable CLUB_G56_PROD=si está puesta en la consola.
    El SQL trae sus propias precondiciones (entorno, línea de base, lock, validación) y su commit: si algo no da, la
    base lo rechaza entero. Se PRUEBA solo en staging: el carga.sql de prod contra staging aborta en «el entorno no es
    prod» sin escribir nada (scripts/club/test_saldos_papel.py y saldos-papel.md)."""
    f = a.aplicar_firmado.expanduser().resolve()
    sql = f.read_text(encoding='utf-8')
    h = hashlib.sha256(sql.encode()).hexdigest()
    if not a.sha256 or h != a.sha256.strip().lower():
        sys.exit('NEGADO: el sha256 del carga.sql no es el firmado (--sha256).')
    malos = sp.filtrar(sql)
    if malos:
        sys.exit('FILTRO G-56: ' + '; '.join(malos))
    if not sql.rstrip().endswith('commit;'):
        sys.exit('NEGADO: --aplicar-firmado es para el carga.sql (termina en commit), no para el ensayo.')
    prod = a.ref == PROD_REF
    if prod and (a.confirmo_ref != PROD_REF or os.environ.get('CLUB_G56_PROD') != 'si'):
        sys.exit('NEGADO: contra prod hace falta --confirmo-ref con el ref de prod y CLUB_G56_PROD=si (paquete firmado, G-56).')
    if not prod and a.ref != STAGING_REF:
        sys.exit('NEGADO: ref desconocido.')
    ejecutar(a.ref, sql, _prod_firmado=prod)
    print(json.dumps({'aplicado': True, 'ref': a.ref, 'sha256': h}, ensure_ascii=False))


def main_aplicar_migracion(argv: list[str]) -> None:
    """G-56 · MODO PROD de la PRIMERA CARGA (09-nov, punto 4). Aplica un carga.sql EMITIDO por --primera-carga --emitir,
    byte a byte, si:
      1. su sha256 es el firmado (--sha256, el de resumen.json que firmó el dueño);
      2. pasa la lista cerrada del migrador (sql_g56.revisar_migrador) otra vez, justo antes de mandarlo;
      3. termina en commit (no es un ensayo) y no tiene ningún delete;
      4. el servidor tiene standard_conforming_strings = on (el filtro lee los literales así);
      5. contra prod: --confirmo-ref repite el ref de prod Y la variable CLUB_G56_PROD=si está puesta en la consola.
    El SQL trae su precondición «cero socios», su validación y su commit: si algo no da, la base lo rechaza entero.
    Se PRUEBA solo en staging: allí la base no está vacía y la precondición lo frena sin escribir nada."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import sql_g56
    ap = argparse.ArgumentParser(prog='migrar_firestore.py aplicar-firmado',
                                 description='G-56 modo PROD: aplica el carga.sql de la primera carga, tal cual, si su sha256 es el firmado')
    ap.add_argument('--archivo', type=Path, required=True, help='el carga.sql emitido (fuera del repo)')
    ap.add_argument('--sha256', required=True, help='el sha256 firmado (resumen.json)')
    ap.add_argument('--ref', default=STAGING_REF)
    ap.add_argument('--confirmo-ref', help='contra prod: volver a escribir el ref de prod')
    a = ap.parse_args(argv)
    f = a.archivo.expanduser().resolve()
    if f == REPO_ROOT or REPO_ROOT in f.parents:
        sys.exit('NEGADO: el carga.sql está dentro del repo. Tiene datos personales: va fuera.')
    sql = f.read_text(encoding='utf-8')
    h = hashlib.sha256(sql.encode()).hexdigest()
    if h != a.sha256.strip().lower():
        sys.exit('NEGADO: el sha256 del carga.sql no es el firmado (--sha256).')
    malos = sql_g56.revisar_migrador(sql, papel='public.club_cargas_papel' in sql)
    if malos:
        sys.exit('FILTRO G-56 (migrador): ' + '; '.join(malos[:20]))
    if not sql.rstrip().endswith('commit;'):
        sys.exit('NEGADO: aplicar-firmado es para el carga.sql (termina en commit), no para un ensayo.')
    if re.search(r'(?im)^\s*delete\b', sql):
        sys.exit('NEGADO: la primera carga no puede tener deletes.')
    prod = a.ref == PROD_REF
    if prod and (a.confirmo_ref != PROD_REF or os.environ.get('CLUB_G56_PROD') != 'si'):
        sys.exit('NEGADO: contra prod hace falta --confirmo-ref con el ref de prod y CLUB_G56_PROD=si (paquete firmado, G-56).')
    if not prod and a.ref != STAGING_REF:
        sys.exit('NEGADO: ref desconocido.')
    scs = ejecutar(a.ref, 'show standard_conforming_strings', read_only=True, _prod_firmado=prod)
    if not scs or scs[0].get('standard_conforming_strings') != 'on':
        sys.exit('NEGADO: el servidor no tiene standard_conforming_strings = on (el filtro no leería los literales igual).')
    filas = ejecutar(a.ref, sql, _prod_firmado=prod)
    print(json.dumps({'aplicado': True, 'ref': a.ref, 'sha256': h,
                      'validacion': (filas[0].get('r') if filas else None)}, ensure_ascii=False, default=str))


# ── Doble carga: tarjetas de papel que ya están en Firestore (SOLO LECTURA) ────
def main_doble_carga(argv: list[str]) -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import datetime as _dt
    import saldos_papel as sp
    ap = argparse.ArgumentParser(prog='migrar_firestore.py doble-carga-papel',
                                 description='Lista las tarjetas del CSV de saldos de papel que ya están en el export de Firestore. No escribe nada.')
    ap.add_argument('--export', required=True, type=Path, help='zip o carpeta del export de Firestore (fuera del repo)')
    ap.add_argument('--csv', required=True, type=Path, help='CSV de saldos de papel (fuera del repo)')
    mapa = ap.add_mutually_exclusive_group(required=True)
    mapa.add_argument('--mapa', type=Path, help='CSV codigo_anfitrion,legacy_id (fuera del repo)')
    mapa.add_argument('--mapa-staging', action='store_true', help='lee el mapa de STAGING en solo lectura (club_miembros migrados)')
    ap.add_argument('--tolerancia-dias', type=int, default=3)
    a = ap.parse_args(argv)
    for pth, nombre in ((a.export, '--export'), (a.csv, '--csv'), (a.mapa, '--mapa')):
        if pth is None:
            continue
        r = pth.expanduser().resolve()
        if r == REPO_ROOT or REPO_ROOT in r.parents:
            sys.exit(f'NEGADO: {nombre} está dentro del repo. Los datos van fuera.')
    filas, errores = sp.validar(a.csv.expanduser().read_text(encoding='utf-8'), _dt.date.today())
    if errores:
        print('CSV RECHAZADO:'); print('\n'.join('  ' + e for e in errores[:200])); sys.exit(1)
    d = cargar(a.export.expanduser().resolve())
    biz = d['businesses'][0].get('_id') if len(d['businesses']) == 1 else None
    if biz != SATORI_BIZ_ID:
        sys.exit('NEGADO: el export no es de Satori.')
    ids = {r['_id'] for r in d['referrers'] if r.get('businessId') == biz}
    referrals = [x for x in d['referrals'] if x['referrerId'] in ids]
    if a.mapa_staging:
        filas_m = ejecutar(STAGING_REF, "select codigo, legacy_id from public.club_miembros where legacy_id is not null", read_only=True) or []
        m = {x['codigo']: x['legacy_id'] for x in filas_m}
    else:
        m = sp.leer_mapa(a.mapa.expanduser().read_text(encoding='utf-8'))
    out = sp.cruzar(filas, referrals, m, a.tolerancia_dias)
    print(json.dumps(out, ensure_ascii=False, indent=1))
    if out['en_los_dos'] or out['sin_mapa']:
        sys.exit(2)   # hay que decidir antes de cargar


# ── CLI ──────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description='Club Satori F1b: Firestore → Supabase STAGING')
    ap.add_argument('--export', required=True, type=Path, help='zip o carpeta del export (fuera del repo)')
    ap.add_argument('--out', type=Path, default=Path.home() / 'club-export' / 'salida', help='carpeta de salida (fuera del repo)')
    ap.add_argument('--ref', default=STAGING_REF, help='ref de Supabase; solo se acepta staging')
    ap.add_argument('--local', required=True, help='id del local destino en club_config (el de la página vieja del Club)')
    ap.add_argument('--esperados', type=Path, help='JSON con los totales esperados, firmado por Ismael (obligatorio con --apply)')
    modo = ap.add_mutually_exclusive_group(required=True)
    modo.add_argument('--dry-run', action='store_true', help='arma el plan y los CSV; no toca la base')
    modo.add_argument('--ensayo', action='store_true', help='corre todo contra staging y valida, pero termina en ROLLBACK')
    modo.add_argument('--apply', action='store_true', help='borra lo migrado antes y vuelve a insertar (staging)')
    modo.add_argument('--emitir', type=Path, help='(B11) escribe carga.sql y resumen.json de la PRIMERA CARGA (fuera del repo); no conecta')
    ap.add_argument('--primera-carga', action='store_true',
                    help='(B11) carga única del lanzamiento: sin deletes, exige la base del Club vacía («cero socios»)')
    ap.add_argument('--fecha-movimiento', choices=('carga', 'original'), default=None,
                    help="fecha de los movimientos: 'carga' (por defecto en la primera carga) u 'original'")
    ap.add_argument('--vencimiento-meses', type=int, default=12)
    ap.add_argument('--acepto-inactivos', type=int, default=None,
                    help='(B11) cuántas cuentas con más de N meses sin actividad se cargan igual, sabiéndolo (el número exacto)')
    ap.add_argument('--vencer-restos-inactivos', type=int, default=None,
                    help='(10-nov, con la fecha de carga) cuántas cuentas inactivas con un RESTO (< medio crédito) se vencen en la '
                         'misma carga, «resto del sistema viejo» (el número exacto; las demás inactivas siguen pidiendo --acepto-inactivos)')
    ap.add_argument('--papel', type=Path,
                    help='(B11, con --primera-carga) CSV de saldos de papel con legacy_id (fuera del repo): entra en la MISMA transacción')
    ap.add_argument('--vaciar-para-ensayo', action='store_true',
                    help='(solo --ensayo --primera-carga en staging) vacía el Club dentro de la transacción; el ROLLBACK lo deshace')
    a = ap.parse_args()
    global LOCATION
    if not re.fullmatch(r'[a-z0-9-]{2,40}', a.local or ''):
        sys.exit('NEGADO: --local tiene que ser el id de un local de club_config (minúsculas, números y guiones).')
    LOCATION = a.local

    if a.ref != STAGING_REF:
        sys.exit('NEGADO: este script solo corre contra STAGING.')
    if os.environ.get('SUPABASE_URL') and STAGING_REF not in os.environ['SUPABASE_URL']:
        sys.exit('NEGADO: SUPABASE_URL no es la de staging.')
    if a.apply and not a.esperados:
        sys.exit('NEGADO: --apply exige --esperados (los totales firmados por el dueño).')
    if a.apply and a.primera_carga:
        sys.exit('NEGADO: la primera carga no se aplica desde acá: en staging, --ensayo; para prod, --emitir y el paquete firmado (G-56).')
    if a.emitir and not a.primera_carga:
        sys.exit('NEGADO: --emitir es solo para la primera carga (--primera-carga).')
    if a.vaciar_para_ensayo and not (a.ensayo and a.primera_carga):
        sys.exit('NEGADO: --vaciar-para-ensayo solo con --ensayo --primera-carga (staging, termina en ROLLBACK).')
    fecha_carga = (a.fecha_movimiento or ('carga' if a.primera_carga else 'original')) == 'carga'
    if a.papel and not a.primera_carga:
        sys.exit('NEGADO: --papel es solo para la primera carga (--primera-carga).')
    if a.vencer_restos_inactivos is not None and not (a.primera_carga and fecha_carga):
        sys.exit('NEGADO: --vencer-restos-inactivos es solo para la primera carga con la fecha de carga '
                 '(con las fechas originales los restos los vence el SQL de la migración).')
    export = a.export.expanduser().resolve()
    out = a.out.expanduser().resolve()
    for pth, nombre in ((export, '--export'), (out, '--out')):
        if pth == REPO_ROOT or REPO_ROOT in pth.parents:
            sys.exit(f'NEGADO: {nombre} está dentro del repo. El export y los CSV van fuera.')
    esperados = None
    if a.esperados:
        esperados = json.loads(a.esperados.expanduser().read_text(encoding='utf-8'))
        if not isinstance(esperados, dict) or not esperados:
            sys.exit('NEGADO: --esperados tiene que ser un objeto JSON con al menos un total.')
    out.mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o700)

    plan = armar_plan(cargar(export))
    res = resumen_plan(plan)
    eq, dup = escribir_csv(plan, out)
    print(json.dumps({'modo': 'dry-run' if a.dry_run else 'ensayo' if a.ensayo else 'apply', 'plan': res,
                      'csv': {'equivalencias_negocios': str(eq), 'duplicados': str(dup), 'grupos_duplicados': len(plan.duplicados)}},
                     ensure_ascii=False, indent=1))
    malos = problemas_plan(plan, res)
    if malos:
        sys.exit('PLAN RECHAZADO: ' + '; '.join(malos))
    if fecha_carga:
        import datetime as _dt
        inac = inactivos_fuente(plan, _dt.date.today().isoformat(), a.vencimiento_meses)
        restos = [x for x in inac if es_resto(x['personas'], plan.rate)]
        (out / 'inactivos.csv').write_text('legacy_id,personas,ultima_actividad,resto\n' + ''.join(
            f"{x['legacy_id']},{x['personas']},{x['ultima_actividad']},{'si' if es_resto(x['personas'], plan.rate) else 'no'}\n"
            for x in inac), encoding='utf-8')
        os.chmod(out / 'inactivos.csv', 0o600)
        print(json.dumps({'inactivos_mas_de_meses': a.vencimiento_meses, 'cuentas': len(inac), 'con_resto': len(restos),
                          'con_resto_personas': sum(x['personas'] for x in restos), 'con_medio_credito_o_mas': len(inac) - len(restos),
                          'csv': str(out / 'inactivos.csv')}, ensure_ascii=False))
        if a.vencer_restos_inactivos is not None:
            if a.vencer_restos_inactivos != len(restos):
                sys.exit(f'FRENADO (10-nov): --vencer-restos-inactivos {a.vencer_restos_inactivos}, pero la fuente tiene {len(restos)} '
                         f'cuentas inactivas con un resto (< medio crédito). El número tiene que ser el exacto.')
            vencer_restos_fuente(plan, restos)
            inac = [x for x in inac if not es_resto(x['personas'], plan.rate)]
            res = resumen_plan(plan)
            malos = problemas_plan(plan, res)
            if malos:
                sys.exit('PLAN RECHAZADO (después de vencer los restos): ' + '; '.join(malos))
            print(json.dumps({'restos_vencidos_en_la_carga': res['vencimientos_restos'],
                              'personas': res['vencimientos_restos_personas'], 'nota': NOTA_RESTO,
                              'cuentas_activas_con_creditos': res['cuentas_activas_con_creditos'],
                              'creditos_activos': res['creditos_activos']}, ensure_ascii=False))
        if inac and a.acepto_inactivos != len(inac):
            sys.exit(f'FRENADO (B11): {len(inac)} cuentas con saldo y más de {a.vencimiento_meses} meses sin actividad en la fuente '
                     f'({len(restos)} con un resto de menos de medio crédito). Con la fecha de carga volverían a contar el plazo: '
                     'decidilas en la fuente; --vencer-restos-inactivos N vence los restos en la carga («resto del sistema '
                     'viejo»); --acepto-inactivos N carga igual las que queden, si el dueño lo decidió (N, el número exacto).')
        if not inac and a.acepto_inactivos not in (None, 0):
            sys.exit(f'FRENADO (B11): --acepto-inactivos {a.acepto_inactivos}, pero no queda ninguna cuenta inactiva por aceptar.')
    papel_filas = None
    if a.papel:
        import datetime as _dt
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import saldos_papel as sp
        pf = a.papel.expanduser().resolve()
        if pf == REPO_ROOT or REPO_ROOT in pf.parents:
            sys.exit('NEGADO: --papel está dentro del repo. Los datos de anfitriones van fuera.')
        papel_filas, errores = sp.validar(pf.read_text(encoding='utf-8'), _dt.date.today())
        if errores:
            print('CSV DE PAPEL RECHAZADO (no se carga nada):'); print('\n'.join('  ' + e for e in errores[:200])); sys.exit(1)
        if papel_filas[0]['clave'] != 'legacy_id':
            sys.exit('NEGADO: en la carga única el CSV de papel va con legacy_id (los códigos del Club nacen en esta carga).')
        legacy = {m['legacy_id'] for m in plan.miembros if m['estado'] == 'activo'}
        faltan = [f['linea'] for f in papel_filas if f['codigo'] not in legacy]
        if faltan:
            sys.exit(f'NEGADO: {len(faltan)} filas de papel con un legacy_id que no es un anfitrión activo de la fuente (líneas {faltan[:20]}).')
        inter = cruce_papel_firestore(plan, papel_filas)
        if inter['en_los_dos']:
            sys.exit(f"NEGADO (Grok 115): {len(inter['en_los_dos'])} tarjetas de papel que YA están en Firestore (mismo anfitrión, "
                     f"mismas personas, ≤ {inter['tolerancia_dias']} días): líneas "
                     + ', '.join(str(x['linea']) for x in inter['en_los_dos'][:30]) + '. Sacalas del CSV (doble carga).')
        if fecha_carga:
            inac_p = sp.inactivos(papel_filas, _dt.date.today(), a.vencimiento_meses)
            if inac_p and a.acepto_inactivos != len(inac_p):
                sys.exit(f'FRENADO (B11): {len(inac_p)} tarjetas de papel con más de {a.vencimiento_meses} meses sin actividad en la fuente '
                         '(líneas ' + ', '.join(str(x['linea']) for x in inac_p[:30]) + '). Decidilas en la fuente.')
    def cuerpo_papel(entorno: str) -> str | None:
        if not papel_filas:
            return None
        # Grok 115: el cruce con Firestore va en la MISMA transacción, antes de la carga (aborta si no cruza o si ya está)
        return (sp.sql_cruce_firestore(papel_filas, LOCATION)
                + sp.cuerpo_sql(papel_filas, LOCATION, entorno, 'carga' if fecha_carga else 'tarjeta'))
    if a.dry_run:
        return
    if a.emitir:
        dst = a.emitir.expanduser().resolve()
        if dst == REPO_ROOT or REPO_ROOT in dst.parents:
            sys.exit('NEGADO: --emitir está dentro del repo.')
        dst.mkdir(parents=True, exist_ok=True); os.chmod(dst, 0o700)
        sql = sql_apply(plan, esperados, ensayo=False, primera=True, fecha_carga=fecha_carga, papel=cuerpo_papel('prod'))
        if re.search(r'(?im)^\s*delete\b', sql):
            sys.exit('NEGADO: la primera carga no puede tener deletes.')
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import sql_g56
        malos = sql_g56.revisar_migrador(sql, papel=bool(papel_filas))   # lista cerrada del migrador (09-nov)
        if malos:
            sys.exit('FILTRO G-56 (migrador): ' + '; '.join(malos))
        (dst / 'carga.sql').write_text(sql, encoding='utf-8'); os.chmod(dst / 'carga.sql', 0o600)
        r = {'modo': 'primera-carga', 'fecha_movimiento': 'carga' if fecha_carga else 'original', 'plan': res,
             'sha256_sql': hashlib.sha256(sql.encode()).hexdigest()}
        (dst / 'resumen.json').write_text(json.dumps(r, ensure_ascii=False, indent=1, default=str), encoding='utf-8')
        print(json.dumps(r, ensure_ascii=False, indent=1, default=str)); return

    filas = ejecutar(a.ref, sql_apply(plan, esperados, ensayo=a.ensayo, primera=a.primera_carga, fecha_carga=fecha_carga,
                                      vaciar_ensayo=a.vaciar_para_ensayo, papel=cuerpo_papel('staging')))
    val = filas[0]['r'] if filas else None
    (out / 'validacion.json').write_text(json.dumps(val, ensure_ascii=False, indent=1), encoding='utf-8')
    os.chmod(out / 'validacion.json', 0o600)
    print(json.dumps({'validacion': val, 'guardado': not a.ensayo}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'saldos-papel':
        main_saldos_papel(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == 'doble-carga-papel':
        main_doble_carga(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == 'aplicar-firmado':
        main_aplicar_migracion(sys.argv[2:])
    else:
        main()
