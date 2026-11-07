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
LOCATION = 'santa-teresa'
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
        if mv['nota'] != NOTA_D1:
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


def sql_apply(p: Plan, esperados: dict | None = None, ensayo: bool = False) -> str:
    """Todo en UNA transacción: precheck → limpieza de lo migrado → carga → restos → VALIDACIÓN → commit.
    · CLUB-AUD-19: la validación corre ANTES del commit y hace `raise` si algo no cuadra (nada queda cargado).
    · CLUB-AUD-20: los datos (con nombres, teléfonos y emails) viajan en UN solo literal jsonb y se
      expanden con jsonb_to_recordset; los errores nunca se imprimen con el cuerpo (ver ejecutar).
    · CLUB-AUD-23: al re-ejecutar se conservan id, código y token de cada miembro por legacy_id; y se
      aborta si ya hay cierres de mes congelados (club_reportes_cerrados).
    · ensayo=True termina en ROLLBACK: valida contra la base sin dejar nada."""
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
    esp = json.dumps(esperados or {}, ensure_ascii=False)
    ctl = json.dumps(plan_ctrl, ensure_ascii=False)
    hoy = "(now() at time zone 'America/Costa_Rica')::date"
    neg = SQL_NORM.format(c='n.nombre')

    L = ["begin;", "set local statement_timeout = '300s';"]
    L.append(f"""do $$ begin
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
end $$;""")
    L.append(f"create temp table _datos on commit drop as select {tag}{cuerpo}{tag}::jsonb as d;")
    # 23: identidad de cada miembro migrado antes de borrar
    L.append("create temp table _prev on commit drop as select legacy_id, id, codigo, token_portal from public.club_miembros where origen = 'migracion';")
    L += [
        "delete from public.club_pm_cargos where origen = 'migracion';",
        "delete from public.club_pm_pagos where origen = 'migracion';",
        "delete from public.club_movimientos where origen = 'migracion';",
        "delete from public.club_miembros_contacto c using public.club_miembros m where m.id = c.miembro_id and m.origen = 'migracion';",
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
       coalesce(j.fecha, now()), coalesce(j.fecha, now()), 'migracion', j.nota, j.legacy_ids
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
  select m.legacy_id, coalesce(sum(mv.personas) filter (where not coalesce(mv.nota in ({q(NOTA_D1)}, {q(NOTA_RESTO)}), false)), 0) as neto
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


def ejecutar(ref: str, sql: str, read_only: bool = False):
    if ref != STAGING_REF or ref == PROD_REF:
        sys.exit('NEGADO: este script solo corre contra STAGING.')
    url = f'https://api.supabase.com/v1/projects/{STAGING_REF}/database/query'
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


# ── CLI ──────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description='Club Satori F1b: Firestore → Supabase STAGING')
    ap.add_argument('--export', required=True, type=Path, help='zip o carpeta del export (fuera del repo)')
    ap.add_argument('--out', type=Path, default=Path.home() / 'club-export' / 'salida', help='carpeta de salida (fuera del repo)')
    ap.add_argument('--ref', default=STAGING_REF, help='ref de Supabase; solo se acepta staging')
    ap.add_argument('--esperados', type=Path, help='JSON con los totales esperados, firmado por Ismael (obligatorio con --apply)')
    modo = ap.add_mutually_exclusive_group(required=True)
    modo.add_argument('--dry-run', action='store_true', help='arma el plan y los CSV; no toca la base')
    modo.add_argument('--ensayo', action='store_true', help='corre todo contra staging y valida, pero termina en ROLLBACK')
    modo.add_argument('--apply', action='store_true', help='borra lo migrado antes y vuelve a insertar (staging)')
    a = ap.parse_args()

    if a.ref != STAGING_REF:
        sys.exit('NEGADO: este script solo corre contra STAGING.')
    if os.environ.get('SUPABASE_URL') and STAGING_REF not in os.environ['SUPABASE_URL']:
        sys.exit('NEGADO: SUPABASE_URL no es la de staging.')
    if a.apply and not a.esperados:
        sys.exit('NEGADO: --apply exige --esperados (los totales firmados por Ismael).')
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
    if a.dry_run:
        return

    filas = ejecutar(a.ref, sql_apply(plan, esperados, ensayo=a.ensayo))
    val = filas[0]['r'] if filas else None
    (out / 'validacion.json').write_text(json.dumps(val, ensure_ascii=False, indent=1), encoding='utf-8')
    os.chmod(out / 'validacion.json', 0o600)
    print(json.dumps({'validacion': val, 'guardado': not a.ensayo}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
