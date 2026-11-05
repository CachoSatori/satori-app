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
import json
import os
import re
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
def cargar(export: Path) -> dict:
    def leer(nombre_o_patron: str):
        if export.is_dir():
            cand = sorted(export.glob(nombre_o_patron))
            if not cand:
                sys.exit(f'Falta {nombre_o_patron} en el export')
            return json.loads(cand[0].read_text(encoding='utf-8'))
        with zipfile.ZipFile(export) as z:
            nombres = [n for n in z.namelist() if Path(n).match(nombre_o_patron)]
            if not nombres:
                sys.exit(f'Falta {nombre_o_patron} en el export')
            return json.loads(z.read(sorted(nombres)[0]))
    return {
        'businesses': leer('businesses.json'),
        'referrers': leer('referrers.json'),
        'referrals': leer('referrals.json'),
        'referrals_club': leer('referrals_club.json'),
        'vencimientos': leer('vencimientos_*.json'),
    }


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
        sys.exit(f'Se esperaba 1 negocio (Satori) en businesses.json y hay {len(biz)}')
    p.rate = int(biz[0]['peoplePointsRate'])
    biz_id = biz[0]['_id']

    referrers = [r for r in d['referrers'] if r.get('businessId') == biz_id]
    p.avisos['referrers_otro_negocio_excluidos'] = len(d['referrers']) - len(referrers)
    ids = {r['_id'] for r in referrers}
    referrals = [x for x in d['referrals'] if x['referrerId'] in ids]
    club = [x for x in d['referrals_club'] if x['referrerId'] in ids]
    venc_ids = set(d['vencimientos'])
    if any(int(x['peoplePointsRateSnapshot']) != p.rate for x in referrals):
        sys.exit('Hay referrals con peoplePointsRateSnapshot distinto de la tasa del negocio: revisar antes de migrar')

    con_club = {x['referrerId'] for x in club if int(x['amount']) != 0}

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
    faltan = venc_ids - {x['_id'] for x in debitos}
    if faltan:
        sys.exit(f'{len(faltan)} ids de vencimientos no están entre los débitos del export')
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

    # [D1] Cuentas borradas con saldo > 0 → vencimiento por el saldo, con fecha de la migración.
    for m in p.miembros:
        s = p.neto_firestore[m['legacy_id']]
        if m['estado'] == 'baja' and s > 0:
            p.movimientos.append({
                'miembro_id': m['id'], 'tipo': 'vencimiento', 'personas': -s, 'creditos': None,
                'fecha': None, 'nota': NOTA_D1, 'legacy_ids': None,
            })
        if s < 0:
            p.avisos['saldo_negativo_en_firestore'] += 1

    # PM: amount/100 = colones.
    for x in club:
        monto = Decimal(int(x['amount'])) / 100
        reg = {'miembro_id': uid_por_legacy[x['referrerId']], 'monto': monto, 'fecha': x['createdAt'], 'legacy_ids': [x['_id']]}
        (p.pm_cargos if x['referralType'] == 'credit' else p.pm_pagos).append(reg)
    return p


# ── Validación local del plan (sin red) ──────────────────────────────────────
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
    cargos = collections.Counter(); pagos = collections.Counter()
    for c in p.pm_cargos: cargos[c['miembro_id']] += c['monto']
    for c in p.pm_pagos: pagos[c['miembro_id']] += c['monto']
    pm_suf = sum(cargos[m['id']] - pagos[m['id']] for m in act if m['sufijo_pm'])
    pm_sin = sum(cargos[m['id']] - pagos[m['id']] for m in act if not m['sufijo_pm'])
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
        'pm_neto_no_borrados': str(pm_suf + pm_sin), 'pm_neto_con_sufijo': str(pm_suf), 'pm_neto_sin_sufijo': str(pm_sin),
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


def sql_apply(p: Plan) -> str:
    L = ["begin;", "set local statement_timeout = '300s';"]
    L.append(f"""do $$ begin
  if (select personas_por_credito from public.club_config where location_id = {q(LOCATION)}) is distinct from {p.rate} then
    raise exception 'club_config.personas_por_credito no coincide con la tasa del export ({p.rate})';
  end if;
  if exists (select 1 from public.club_movimientos mv join public.club_miembros m on m.id = mv.miembro_id
              where m.origen = 'migracion' and mv.origen <> 'migracion')
     or exists (select 1 from public.club_cupones c join public.club_miembros m on m.id = c.referente_id where m.origen = 'migracion')
     or exists (select 1 from public.club_pm_cargos c join public.club_miembros m on m.id = c.miembro_id where m.origen = 'migracion' and c.origen <> 'migracion')
     or exists (select 1 from public.club_pm_pagos c join public.club_miembros m on m.id = c.miembro_id where m.origen = 'migracion' and c.origen <> 'migracion')
     or exists (select 1 from public.club_visitas v join public.club_miembros m on m.id = v.miembro_id where m.origen = 'migracion') then
    raise exception 'Hay datos cargados en la app sobre miembros migrados: no se borra nada';
  end if;
end $$;""")
    # Limpieza de una corrida anterior (solo origen = migracion; nunca config).
    L += [
        "delete from public.club_pm_cargos where origen = 'migracion';",
        "delete from public.club_pm_pagos where origen = 'migracion';",
        "delete from public.club_movimientos where origen = 'migracion';",
        "delete from public.club_miembros where origen = 'migracion';",
        "delete from public.club_negocios n where n.origen = 'migracion' and not exists (select 1 from public.club_miembros m where m.negocio_id = n.id);",
    ]
    if p.negocios:
        vals = ','.join(f"({q(LOCATION)},{q(nombre)},'otro',true,'migracion')" for nombre in p.negocios.values())
        L.append(f"insert into public.club_negocios (location_id, nombre, tipo, activo, origen) values {vals} on conflict do nothing;")
    neg = SQL_NORM.format(c='n.nombre')
    filas = []
    for m in p.miembros:
        nsel = 'null' if not m['negocio_norm'] else f"(select n.id from public.club_negocios n where n.location_id = {q(LOCATION)} and {neg} = {q(m['negocio_norm'])})"
        filas.append(f"({q(m['id'])}::uuid,{q(LOCATION)},{q(m['tipo'])},{q(m['nombre'])},{nsel},{q(m['estado'])},'migracion',{q(m['legacy_id'])},{q(m['created_at'])}::timestamptz,{q(m['updated_at'])}::timestamptz)")
    for i in range(0, len(filas), 200):
        L.append("insert into public.club_miembros (id, location_id, tipo, nombre, negocio_id, estado, origen, legacy_id, created_at, updated_at) values " + ','.join(filas[i:i + 200]) + ';')
    if p.contactos:
        vals = ','.join(f"({q(c['miembro_id'])}::uuid,{q(LOCATION)},{q(c['telefono'])},{q(c['email'])},false,false)" for c in p.contactos)
        L.append("insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email, optin_whatsapp, optin_email) values " + vals + ';')
    filas = []
    for mv in p.movimientos:
        fecha = 'now()' if mv['fecha'] is None else f"{q(mv['fecha'])}::timestamptz"
        filas.append(f"({q(LOCATION)},{q(mv['miembro_id'])}::uuid,{q(mv['tipo'])},{mv['personas']},{q(mv['creditos'])},{p.rate},{VALOR_CREDITO_CRC},{fecha},{fecha},'migracion',{q(mv['nota'])},{arr(mv['legacy_ids'])})")
    for i in range(0, len(filas), 500):
        L.append("insert into public.club_movimientos (location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc, fecha_visita, registrado_en, origen, nota, legacy_ids) values " + ','.join(filas[i:i + 500]) + ';')
    if p.pm_cargos:
        vals = ','.join(f"({q(LOCATION)},{q(c['miembro_id'])}::uuid,{q(c['monto'])},'pendiente','migracion',{arr(c['legacy_ids'])},{q(c['fecha'])}::timestamptz)" for c in p.pm_cargos)
        L.append("insert into public.club_pm_cargos (location_id, miembro_id, monto_crc, estado, origen, legacy_ids, created_at) values " + vals + ';')
    if p.pm_pagos:
        vals = ','.join(f"({q(LOCATION)},{q(c['miembro_id'])}::uuid,{q(c['monto'])},{q(c['fecha'])}::timestamptz,'migracion',{arr(c['legacy_ids'])},{q(c['fecha'])}::timestamptz)" for c in p.pm_pagos)
        L.append("insert into public.club_pm_pagos (location_id, miembro_id, monto_crc, pagado_en, origen, legacy_ids, created_at) values " + vals + ';')
    L.append('commit;')
    return '\n'.join(L)


def sql_validar(p: Plan) -> str:
    esperado = ','.join(f"({q(k)},{v})" for k, v in p.neto_firestore.items())
    return f"""
with esperado(legacy_id, neto) as (values {esperado}),
mig as (select m.* from public.club_miembros m where m.origen = 'migracion'),
real as (
  select m.legacy_id, coalesce(sum(mv.personas) filter (where mv.nota is distinct from {q(NOTA_D1)}), 0) as neto
  from mig m left join public.club_movimientos mv on mv.miembro_id = m.id group by m.legacy_id),
sal as (select s.*, m.tipo as tipo_m, m.estado as estado_m from public.club_saldos s join mig m on m.id = s.miembro_id),
pm as (
  select m.id, m.estado, m.nombre ~* '\\mPM\\s*$' as sufijo,
         coalesce((select sum(c.monto_crc) from public.club_pm_cargos c where c.miembro_id = m.id and c.origen = 'migracion'), 0)
       - coalesce((select sum(c.monto_crc) from public.club_pm_pagos c where c.miembro_id = m.id and c.origen = 'migracion'), 0) as neto
  from mig m),
mov as (select mv.* from public.club_movimientos mv join mig m on m.id = mv.miembro_id where mv.origen = 'migracion'),
mes as (
  select tipo,
         to_char(fecha_visita at time zone 'UTC', 'YYYY-MM') as mes_utc,
         to_char(fecha_visita at time zone 'America/Costa_Rica', 'YYYY-MM') as mes_cr,
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
  'pm_neto_no_borrados', (select sum(neto) from pm where estado = 'activo'),
  'pm_neto_con_sufijo', (select sum(neto) from pm where estado = 'activo' and sufijo),
  'pm_neto_sin_sufijo', (select sum(neto) from pm where estado = 'activo' and not sufijo),
  'pm_neto_borrados', (select sum(neto) from pm where estado = 'baja'),
  'por_mes_utc', (select json_object_agg(mes, v order by mes) from (select mes_utc as mes, json_build_object('tarjetas_personas', sum(personas) filter (where tipo='tarjeta'), 'canjes_creditos', sum(creditos) filter (where tipo='canje')) v from mes group by mes_utc) a),
  'por_mes_cr', (select json_object_agg(mes, v order by mes) from (select mes_cr as mes, json_build_object('tarjetas_personas', sum(personas) filter (where tipo='tarjeta'), 'canjes_creditos', sum(creditos) filter (where tipo='canje')) v from mes group by mes_cr) a),
  'movimientos_que_cambian_de_mes', (select count(*) from mes where mes_utc <> mes_cr)
) as r;"""


SQL_BARRIDO_ANON = """
select count(*) as abiertas from pg_class c join pg_namespace n on n.oid = c.relnamespace
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
def limpiar_error(msg: str) -> str:
    """Postgres incluye la fila que falló (con datos personales): se corta."""
    msg = msg.split('\nDETAIL')[0].split('DETAIL:')[0]
    msg = re.sub(r'Failing row contains .*', 'Failing row contains (oculto)', msg, flags=re.S)
    return msg[:500]


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
        try:
            cuerpo = json.loads(cuerpo).get('message', cuerpo)
        except ValueError:
            pass
        sys.exit(f'Error de la base ({e.code}): {limpiar_error(cuerpo)}')


# ── CLI ──────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description='Club Satori F1b: Firestore → Supabase STAGING')
    ap.add_argument('--export', required=True, type=Path, help='zip o carpeta del export (fuera del repo)')
    ap.add_argument('--out', type=Path, default=Path.home() / 'club-export' / 'salida', help='carpeta de salida (fuera del repo)')
    ap.add_argument('--ref', default=STAGING_REF, help='ref de Supabase; solo se acepta staging')
    modo = ap.add_mutually_exclusive_group(required=True)
    modo.add_argument('--dry-run', action='store_true', help='arma el plan y los CSV; no toca la base')
    modo.add_argument('--apply', action='store_true', help='borra lo migrado antes y vuelve a insertar (staging)')
    a = ap.parse_args()

    if a.ref != STAGING_REF:
        sys.exit('NEGADO: este script solo corre contra STAGING.')
    if os.environ.get('SUPABASE_URL') and STAGING_REF not in os.environ['SUPABASE_URL']:
        sys.exit('NEGADO: SUPABASE_URL no es la de staging.')
    export = a.export.expanduser().resolve()
    out = a.out.expanduser().resolve()
    for pth, nombre in ((export, '--export'), (out, '--out')):
        if pth == REPO_ROOT or REPO_ROOT in pth.parents:
            sys.exit(f'NEGADO: {nombre} está dentro del repo. El export y los CSV van fuera.')
    out.mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o700)

    plan = armar_plan(cargar(export))
    res = resumen_plan(plan)
    eq, dup = escribir_csv(plan, out)
    print(json.dumps({'modo': 'dry-run' if a.dry_run else 'apply', 'plan': res,
                      'csv': {'equivalencias_negocios': str(eq), 'duplicados': str(dup), 'grupos_duplicados': len(plan.duplicados)}},
                     ensure_ascii=False, indent=1))
    if a.dry_run:
        return

    ejecutar(a.ref, sql_apply(plan))
    val = ejecutar(a.ref, sql_validar(plan))[0]['r']   # select puro; el rol read-only no ejecuta club_creditos
    val['barrido_anon_abiertas'] = ejecutar(a.ref, SQL_BARRIDO_ANON, read_only=True)[0]['abiertas']
    (out / 'validacion.json').write_text(json.dumps(val, ensure_ascii=False, indent=1), encoding='utf-8')
    os.chmod(out / 'validacion.json', 0o600)
    print(json.dumps({'validacion': val}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
