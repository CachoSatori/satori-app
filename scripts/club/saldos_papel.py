#!/usr/bin/env python3
"""
Club Satori — carga masiva de saldos de TARJETAS DE PAPEL (decisión del dueño, 08-nov: «tu saldo de la tarjeta de papel
pasa a tu portal»). Se usa a través del migrador:

  python3 scripts/club/migrar_firestore.py saldos-papel --csv <archivo fuera del repo> --local <id> --validar
  python3 scripts/club/migrar_firestore.py saldos-papel --csv <archivo> --local <id> --emitir <carpeta fuera del repo>
  python3 scripts/club/migrar_firestore.py saldos-papel --ficticios 6 --local <id> --ensayo     # staging, termina en ROLLBACK

Plantilla (sin datos reales): scripts/club/plantilla_saldos_papel.csv. Columnas:
  codigo_anfitrion  el código público del anfitrión (8 caracteres, el de su QR /r/) — o, en la CARGA ÚNICA del
                    lanzamiento (base vacía, junto con el migrador), `legacy_id`: el id del anfitrión en la página vieja
  personas          personas acumuladas en la tarjeta (entero 1..600; es la unidad del libro: 6 = 1 crédito)
  fecha_tarjeta     AAAA-MM-DD (la de la última marca de la tarjeta; no futura; desde 2020-01-01)
  referencia        identificador de la tarjeta física (obligatorio; letras, números, espacio, - _ /; hasta 40)

Reglas de G-56 (RUNBOOK §12) aplicadas a esta carga:
  · el SQL emitido es UNA transacción: set local lock_timeout / statement_timeout, `lock table public.club_cargas_papel
    in exclusive mode` (Grok 109: dos sesiones a la vez se ponen en fila), precondiciones que abortan (el local existe;
    el entorno es el esperado; línea de base «ninguna carga de papel de este local»; todos los anfitriones activos),
    el registro del lote (club_cargas_papel: un local, un lote = sha256 de las filas, únicos), solo
    `insert into public.club_movimientos` con origen 'papel', validación de conteo y suma, y commit al final;
  · filtro (09-nov, B1): ANÁLISIS REAL del SQL (scripts/club/sql_g56.py: tokenizador con literales, $tag$, comentarios
    anidados e identificadores; lista cerrada de sentencias; sin execute; set local solo para los dos timeouts; insert
    solo en club_movimientos y club_cargas_papel);
  · chequeo de 12 meses SOBRE LA FUENTE (B11): con la fecha de carga, una tarjeta sin actividad desde hace más que el
    vencimiento volvería a contar 12 meses el día del lanzamiento: se frena antes de emitir;
  · el CSV y el SQL pueden tener datos de anfitriones: van fuera del repo (0600); viaja solo el sha256 (resumen.json);
  · nada contra prod: la ejecución solo existe para staging y siempre como ensayo (ROLLBACK).
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import json
import re
import secrets

COLUMNAS = ['codigo_anfitrion', 'personas', 'fecha_tarjeta', 'referencia']
RE_CODIGO = re.compile(r'^[A-HJ-NP-Z2-9]{8}$')
RE_LEGACY = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
COLUMNAS_LEGACY = ['legacy_id', 'personas', 'fecha_tarjeta', 'referencia']
RE_REF = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 _/-]{0,39}$')
PERSONAS_MAX = 600
FECHA_MIN = dt.date(2020, 1, 1)
NOTA = 'saldo tarjeta de papel'
ORIGEN = 'papel'   # B2 (09-nov): su propio origen; el migrador nunca lo borra y frena si lo encuentra


# ── Validador ────────────────────────────────────────────────────────────────
def validar(texto: str, hoy: dt.date | None = None) -> tuple[list[dict], list[str]]:
    """Devuelve (filas, errores). Con un solo error, el archivo entero se rechaza (no se carga a medias).
    Los errores dicen línea y motivo, nunca el contenido de la fila."""
    hoy = hoy or dt.date.today()
    errores: list[str] = []
    filas: list[dict] = []
    texto = texto.lstrip('﻿')
    if not texto.strip():
        return [], ['archivo vacío']
    lector = csv.reader(io.StringIO(texto))
    cab = next(lector, None)
    cab = [c.strip().lower() for c in (cab or [])]
    if cab not in (COLUMNAS, COLUMNAS_LEGACY):
        return [], [f'encabezado distinto de la plantilla (se espera: {",".join(COLUMNAS)}; o, en la carga única, {",".join(COLUMNAS_LEGACY)})']
    clave = 'codigo' if cab == COLUMNAS else 'legacy_id'
    vistos_ref: dict[tuple[str, str], int] = {}
    vistos_fila: dict[tuple, int] = {}
    for n, f in enumerate(lector, start=2):
        if not f or all(not c.strip() for c in f):
            continue
        if len(f) != len(COLUMNAS):
            errores.append(f'línea {n}: {len(f)} columnas (se esperan {len(COLUMNAS)})'); continue
        cod, per, fec, ref = (c.strip() for c in f)
        mal = []
        if clave == 'codigo':
            cod = cod.upper()
            if not RE_CODIGO.match(cod):
                mal.append('código de anfitrión mal formado')
        elif not RE_LEGACY.match(cod):
            mal.append('legacy_id mal formado')
        if not re.fullmatch(r'[0-9]{1,4}', per) or not (1 <= int(per) <= PERSONAS_MAX):
            mal.append(f'personas no es un entero entre 1 y {PERSONAS_MAX}')
        try:
            fd = dt.date.fromisoformat(fec)
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', fec) or fd > hoy or fd < FECHA_MIN:
                mal.append('fecha fuera de rango (ni futura ni antes de 2020)')
        except ValueError:
            mal.append('fecha no es AAAA-MM-DD')
        if not RE_REF.match(ref):
            mal.append('referencia vacía o con caracteres no permitidos')
        if mal:
            errores.append(f'línea {n}: ' + '; '.join(mal)); continue
        clave_ref = (cod, ref.lower())
        clave_fila = (cod, int(per), fec, ref.lower())
        if clave_fila in vistos_fila:
            errores.append(f'línea {n}: fila duplicada (igual a la línea {vistos_fila[clave_fila]})'); continue
        if clave_ref in vistos_ref:
            errores.append(f'línea {n}: la misma tarjeta (anfitrión + referencia) ya está en la línea {vistos_ref[clave_ref]}'); continue
        vistos_fila[clave_fila] = n
        vistos_ref[clave_ref] = n
        filas.append({'codigo': cod, 'personas': int(per), 'fecha': fec, 'referencia': ref, 'linea': n, 'clave': clave})
    if not filas and not errores:
        errores.append('el archivo no tiene filas')
    return filas, errores


# ── Filtro de sentencias (G-56) ──────────────────────────────────────────────
def filtrar(sql: str, ficticios: bool = False) -> list[str]:
    """Problemas del archivo; vacío = pasa. Se corre al emitir y otra vez antes de ejecutar. (09-nov, B1) Análisis real
    del SQL con scripts/club/sql_g56.py (ya no regex sobre el texto). `ficticios` = el ensayo de staging que crea
    anfitriones ficticios dentro de la misma transacción (admite UN insert en club_miembros)."""
    import sql_g56
    return sql_g56.revisar(sql, permitir_extra='alta_ficticios' if ficticios else None)


# ── Chequeo de inactividad sobre la fuente (B11) ─────────────────────────────
def inactivos(filas: list[dict], hoy: dt.date, meses: int = 12) -> list[dict]:
    """Tarjetas cuya última marca es de hace más de `meses` (el vencimiento del Club). Con la fecha de carga volverían a
    contar el plazo el día del lanzamiento: se deciden en la fuente ANTES de cargar. Solo línea, referencia y meses."""
    corte_y, corte_m = hoy.year, hoy.month - meses
    while corte_m <= 0:
        corte_m += 12; corte_y -= 1
    import calendar
    corte = dt.date(corte_y, corte_m, min(hoy.day, calendar.monthrange(corte_y, corte_m)[1]))
    out = []
    for f in filas:
        d = dt.date.fromisoformat(f['fecha'])
        if d < corte:
            out.append({'linea': f['linea'], 'referencia': f['referencia'],
                        'meses': (hoy.year - d.year) * 12 + hoy.month - d.month})
    return out


def lote_sha256(filas: list[dict], local: str) -> str:
    """Clave única del lote (Grok 109): sha256 de las filas canónicas (clave, personas, fecha, referencia), ordenadas."""
    canon = '\n'.join(sorted(f"{f.get('clave', 'codigo')}|{f['codigo']}|{f['personas']}|{f['fecha']}|{f['referencia'].lower()}" for f in filas))
    return hashlib.sha256(f'{local}\n{canon}'.encode()).hexdigest()


# ── SQL ──────────────────────────────────────────────────────────────────────
def _q(v) -> str:
    return "'" + str(v).replace("'", "''") + "'"


FECHAS = ('carga', 'tarjeta')


def cuerpo_sql(filas: list[dict], local: str, entorno: str, fecha: str = 'carga') -> str:
    """Todo lo que va ENTRE begin/set local y commit: lock, precondiciones, registro del lote, inserción y validación.
    `fecha` = de qué fecha es el movimiento (cuenta para el vencimiento de 12 meses sin actividad):
      · 'carga' (POR DEFECTO; el dueño, 09-nov: «fecha de carga para todos»): la del día de la carga. Las tarjetas de más
        de 12 meses sin actividad se deciden ANTES, en la fuente (`inactivos`).
      · 'tarjeta': la fecha de la tarjeta (la de la última marca).
    La fecha de la tarjeta queda siempre en la nota."""
    assert entorno in ('staging', 'prod')
    assert fecha in FECHAS
    claves = {f.get('clave', 'codigo') for f in filas}
    assert len(claves) == 1, 'todas las filas con la misma clave (código o legacy_id)'
    col = 'codigo' if claves == {'codigo'} else 'legacy_id'
    valores = ',\n  '.join(f"({_q(f['codigo'])}, {f['personas']}, {_q(f['fecha'])}::date, {_q(f['referencia'])})" for f in filas)
    n, total = len(filas), sum(f['personas'] for f in filas)
    lote = lote_sha256(filas, local)
    cond_entorno = ("exists (select 1 from public.club_entorno)" if entorno == 'staging'
                    else "not exists (select 1 from public.club_entorno)")
    return f"""lock table public.club_cargas_papel in exclusive mode;
do $$
begin
  -- precondiciones (abortan todo): el local, el entorno, la línea de base y los anfitriones. Van DESPUÉS del lock
  -- (Grok 109): una segunda sesión espera a la primera y recién ahí mira la línea de base.
  if not exists (select 1 from public.club_config where location_id = {_q(local)}) then
    raise exception 'CLUB: el local no existe';
  end if;
  if not ({cond_entorno}) then
    raise exception 'CLUB: el entorno no es {entorno}';
  end if;
  if exists (select 1 from public.club_cargas_papel where location_id = {_q(local)} or lote_sha256 = {_q(lote)})
     or exists (select 1 from public.club_movimientos where origen = {_q(ORIGEN)} and location_id = {_q(local)}) then
    raise exception 'CLUB: línea de base: ya hay una carga de tarjetas de papel de este local o de este lote (no se carga dos veces)';
  end if;
end $$;
do $$
declare v_falta int;
begin
  select count(*) into v_falta from (values
  {valores}) p(codigo, personas, fecha, referencia)
   where not exists (select 1 from public.club_miembros m
                      where m.{col} = p.codigo and m.location_id = {_q(local)} and m.estado = 'activo'
                        and m.tipo in ('referente', 'concierge_pm', 'equipo'));
  if v_falta > 0 then
    raise exception 'CLUB: % filas con un código que no es un anfitrión activo del local', v_falta;
  end if;
end $$;
insert into public.club_cargas_papel (location_id, lote_sha256, filas, personas, fecha_movimiento)
values ({_q(local)}, {_q(lote)}, {n}, {total}, {_q(fecha)});
insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                     fecha_visita, registrado_en, origen, nota)
select m.location_id, m.id, 'tarjeta', p.personas, c.personas_por_credito, c.valor_credito_crc,
       {"now()" if fecha == 'carga' else "(p.fecha::timestamp + time '12:00') at time zone 'America/Costa_Rica'"}, now(), {_q(ORIGEN)},
       {_q(NOTA + ' · ')} || p.referencia || ' · tarjeta ' || to_char(p.fecha, 'YYYY-MM-DD')
  from (values
  {valores}) p(codigo, personas, fecha, referencia)
  join public.club_miembros m on m.{col} = p.codigo and m.location_id = {_q(local)}
  join public.club_config c on c.location_id = m.location_id;
do $$
declare v_n int; v_p int;
begin
  -- validación dentro de la transacción: si no da, no queda nada
  select count(*), coalesce(sum(personas), 0) into v_n, v_p from public.club_movimientos
   where origen = {_q(ORIGEN)} and location_id = {_q(local)};
  if v_n <> {n} or v_p <> {total} then
    raise exception 'CLUB: validación: % filas y % personas (se esperaban {n} y {total})', v_n, v_p;
  end if;
end $$;
"""


def sql_cruce_firestore(filas: list[dict], local: str, tolerancia_dias: int = 3) -> str:
    """(09-nov, Grok 115) CARGA ÚNICA: cruce papel ↔ Firestore por `legacy_id` DENTRO de la transacción del migrador
    (usa `_datos`, el export que el migrador pasa como un literal jsonb). Aborta todo si:
      · hay filas SIN CRUZAR: un `legacy_id` que no es un anfitrión activo del export, o que no quedó migrado en el local;
      · hay INTERSECCIÓN: una tarjeta de papel que YA está en Firestore (el mismo anfitrión, un crédito con las mismas
        personas y la fecha a ≤ `tolerancia_dias`, en hora de Costa Rica): sería una doble carga.
    Va ANTES del cuerpo de la carga de papel. Los mensajes dicen cuántas, sin datos."""
    assert {f.get('clave', 'codigo') for f in filas} == {'legacy_id'}, 'el cruce de la carga única es por legacy_id'
    valores = ',\n  '.join(f"({_q(f['codigo'])}, {f['personas']}, {_q(f['fecha'])}::date)" for f in filas)
    return f"""do $$
declare v_sin int; v_inter int;
begin
  select count(*) into v_sin from (values
  {valores}) p(legacy, personas, fecha)
   where not exists (select 1 from _datos, jsonb_to_recordset(d->'miembros') as mi(legacy_id text, estado text, tipo text)
                      where mi.legacy_id = p.legacy and mi.estado = 'activo' and mi.tipo in ('referente', 'concierge_pm', 'equipo'))
      or not exists (select 1 from public.club_miembros m
                      where m.legacy_id = p.legacy and m.origen = 'migracion' and m.location_id = {_q(local)});
  if v_sin > 0 then
    raise exception 'CLUB: % filas de papel sin cruzar con un anfitrión activo de Firestore (legacy_id): no se carga nada', v_sin;
  end if;
  select count(*) into v_inter from (values
  {valores}) p(legacy, personas, fecha)
   where exists (select 1 from _datos, jsonb_to_recordset(d->'miembros') as mi(id uuid, legacy_id text),
                      jsonb_to_recordset(d->'movimientos') as mv(miembro_id uuid, tipo text, personas int, fecha timestamptz)
                  where mi.legacy_id = p.legacy and mv.miembro_id = mi.id and mv.tipo = 'tarjeta' and mv.personas = p.personas
                    and abs((mv.fecha at time zone 'America/Costa_Rica')::date - p.fecha) <= {int(tolerancia_dias)});
  if v_inter > 0 then
    raise exception 'CLUB: % tarjetas de papel que YA están en Firestore (mismo anfitrión, mismas personas, ≤ {int(tolerancia_dias)} días): doble carga, no se carga nada', v_inter;
  end if;
end $$;
"""


CABECERA = "begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '5min';\n"


def sql_carga(filas: list[dict], local: str, entorno: str, fecha: str = 'carga') -> str:
    return CABECERA + cuerpo_sql(filas, local, entorno, fecha) + 'commit;\n'


def sql_ensayo(filas: list[dict], local: str, entorno: str, previo: str = '', fecha: str = 'carga') -> str:
    """El mismo cuerpo, con ROLLBACK al final (y, en staging, el armado de anfitriones ficticios antes)."""
    return CABECERA + previo + cuerpo_sql(filas, local, entorno, fecha) + 'rollback;\n'


def resumen(filas: list[dict], sql: str, local: str, fecha: str = 'carga') -> dict:
    """Lo único que viaja: conteos, totales, la clave del lote y el sha256 del SQL. Sin códigos, referencias ni nombres."""
    total = sum(f['personas'] for f in filas)
    return {'local': local, 'fecha_movimiento': fecha, 'filas': len(filas), 'anfitriones': len({f['codigo'] for f in filas}),
            'personas': total, 'creditos_aprox': round(total / 6, 1), 'lote_sha256': lote_sha256(filas, local),
            'sha256_sql': hashlib.sha256(sql.encode()).hexdigest()}


# ── Ficticios (solo para el ensayo en staging) ───────────────────────────────
ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def ficticios(n: int, local: str, hoy: dt.date | None = None) -> tuple[list[dict], str]:
    """n anfitriones ficticios (código nuevo, nombre «Ficticio Papel k») y su CSV. El SQL que los crea va DENTRO del
    ensayo, antes del cuerpo, y se deshace con el ROLLBACK."""
    hoy = hoy or dt.date.today()
    filas, alta = [], []
    for k in range(1, n + 1):
        cod = 'QQ' + ''.join(secrets.choice(ALFABETO) for _ in range(6))
        filas.append({'codigo': cod, 'personas': 6 * k + (k % 3), 'fecha': (hoy - dt.timedelta(days=30 * k)).isoformat(),
                      'referencia': f'PAPEL-{k:04d}'})
        alta.append(f"({_q(local)}, 'referente', {_q(f'Ficticio Papel {k}')}, 'app', {_q(cod)})")
    previo = ('insert into public.club_miembros (location_id, tipo, nombre, origen, codigo) values\n  '
              + ',\n  '.join(alta) + ';\n')
    return filas, previo


def a_csv(filas: list[dict]) -> str:
    out = io.StringIO()
    w = csv.writer(out, lineterminator='\n')
    w.writerow(COLUMNAS)
    for f in filas:
        w.writerow([f['codigo'], f['personas'], f['fecha'], f['referencia']])
    return out.getvalue()


def json_resumen(r: dict) -> str:
    return json.dumps(r, ensure_ascii=False, indent=1)


# ── Doble carga con Firestore (solo lectura) ─────────────────────────────────
def leer_mapa(texto: str) -> dict[str, str]:
    """Mapa código del Club → id del anfitrión en Firestore (club_miembros.codigo ↔ legacy_id). CSV con encabezado
    codigo_anfitrion,legacy_id. El export de Firestore no tiene el código del Club (nace en la migración)."""
    lector = csv.reader(io.StringIO(texto.lstrip('\ufeff')))
    cab = [c.strip().lower() for c in (next(lector, None) or [])]
    if cab != ['codigo_anfitrion', 'legacy_id']:
        raise ValueError('el mapa tiene que tener el encabezado codigo_anfitrion,legacy_id')
    out = {}
    for f in lector:
        if len(f) == 2 and RE_CODIGO.match(f[0].strip().upper()) and f[1].strip():
            out[f[0].strip().upper()] = f[1].strip()
    return out


def _fecha_cr(iso: str) -> dt.date:
    """createdAt de Firestore (UTC) → fecha de Costa Rica (UTC−6)."""
    t = dt.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return (t - dt.timedelta(hours=6)).date()


def cruzar(filas: list[dict], referrals: list[dict], mapa: dict[str, str], tolerancia_dias: int = 3) -> dict:
    """Tarjetas del CSV que YA están en Firestore: mismo anfitrión, un crédito con las mismas personas y la fecha a
    ≤ tolerancia días. Devuelve solo líneas, referencias, ids de Firestore y días (sin nombres ni teléfonos).
    No escribe nada."""
    creditos: dict[str, list[dict]] = {}
    for x in referrals:
        if x.get('referralType') == 'credit':
            creditos.setdefault(x['referrerId'], []).append(x)
    en_los_dos, sin_mapa, usados = [], [], set()
    for f in filas:
        legacy = mapa.get(f['codigo'])
        if not legacy:
            sin_mapa.append({'linea': f['linea'], 'referencia': f['referencia']}); continue
        fecha = dt.date.fromisoformat(f['fecha'])
        cands = sorted(((abs((_fecha_cr(x['createdAt']) - fecha).days), x['_id']) for x in creditos.get(legacy, [])
                        if int(x.get('peopleCount', 0)) == f['personas'] and x['_id'] not in usados),
                       key=lambda t: (t[0], t[1]))
        if cands and cands[0][0] <= tolerancia_dias:
            dias, fid = cands[0]
            usados.add(fid)   # un crédito de Firestore explica una sola tarjeta
            en_los_dos.append({'linea': f['linea'], 'referencia': f['referencia'], 'firestore_id': fid, 'dias': dias,
                               'certeza': 'exacta' if dias == 0 else 'cercana'})
    return {'filas_csv': len(filas), 'en_los_dos': en_los_dos, 'sin_mapa': sin_mapa, 'tolerancia_dias': tolerancia_dias}
