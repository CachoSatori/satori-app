#!/usr/bin/env python3
"""
Club Satori — carga masiva de saldos de TARJETAS DE PAPEL (decisión de Ismael, 08-nov: «tu saldo de la tarjeta de papel
pasa a tu portal»). Se usa a través del migrador:

  python3 scripts/club/migrar_firestore.py saldos-papel --csv <archivo fuera del repo> --local <id> --validar
  python3 scripts/club/migrar_firestore.py saldos-papel --csv <archivo> --local <id> --emitir <carpeta fuera del repo>
  python3 scripts/club/migrar_firestore.py saldos-papel --ficticios 6 --local <id> --ensayo     # staging, termina en ROLLBACK

Plantilla (sin datos reales): scripts/club/plantilla_saldos_papel.csv. Columnas:
  codigo_anfitrion  el código público del anfitrión (8 caracteres, el de su QR /r/)
  personas          personas acumuladas en la tarjeta (entero 1..600; es la unidad del libro: 6 = 1 crédito)
  fecha_tarjeta     AAAA-MM-DD (la de la última marca de la tarjeta; no futura; desde 2020-01-01)
  referencia        identificador de la tarjeta física (obligatorio; letras, números, espacio, - _ /; hasta 40)

Reglas de G-56 (RUNBOOK §12) aplicadas a esta carga:
  · el SQL emitido es UNA transacción: set local lock_timeout / statement_timeout, precondiciones que abortan (el local
    existe; el entorno es el esperado; línea de base «cero cargas de papel previas»; todos los códigos son anfitriones
    activos), solo `insert into public.club_movimientos`, validación de conteo y suma, y commit al final;
  · filtro mecánico: se rechaza el archivo si aparece delete/truncate/drop/update/alter/grant/revoke fuera de un
    literal, o una sentencia que no sea begin / set local / do / insert into public.club_… / commit / rollback;
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
RE_REF = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 _/-]{0,39}$')
PERSONAS_MAX = 600
FECHA_MIN = dt.date(2020, 1, 1)
NOTA = 'saldo tarjeta de papel'
PROHIBIDAS = ('delete', 'truncate', 'drop', 'update', 'alter', 'grant', 'revoke')
RE_SENTENCIA_OK = re.compile(r'^(begin|commit|rollback|set\s+local\s|do\s|insert\s+into\s+public\.club_[a-z_]+)', re.I)


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
    if [c.strip().lower() for c in (cab or [])] != COLUMNAS:
        return [], [f'encabezado distinto de la plantilla (se espera: {",".join(COLUMNAS)})']
    vistos_ref: dict[tuple[str, str], int] = {}
    vistos_fila: dict[tuple, int] = {}
    for n, f in enumerate(lector, start=2):
        if not f or all(not c.strip() for c in f):
            continue
        if len(f) != len(COLUMNAS):
            errores.append(f'línea {n}: {len(f)} columnas (se esperan {len(COLUMNAS)})'); continue
        cod, per, fec, ref = (c.strip() for c in f)
        cod = cod.upper()
        mal = []
        if not RE_CODIGO.match(cod):
            mal.append('código de anfitrión mal formado')
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
        filas.append({'codigo': cod, 'personas': int(per), 'fecha': fec, 'referencia': ref})
    if not filas and not errores:
        errores.append('el archivo no tiene filas')
    return filas, errores


# ── Filtro de sentencias (G-56) ──────────────────────────────────────────────
def _sin_literales(sql: str) -> str:
    """Saca los literales '…' (con '' adentro) y los comentarios; deja los cuerpos $$…$$ (se revisan también)."""
    sql = re.sub(r"'(?:[^']|'')*'", "''", sql)
    sql = re.sub(r'--[^\n]*', '', sql)
    return sql


def _sentencias(sql: str) -> list[str]:
    """Parte en sentencias por «;» fuera de cuerpos $$…$$."""
    partes, actual, dentro = [], [], False
    for trozo in re.split(r'(\$\$|;)', sql):
        if trozo == '$$':
            dentro = not dentro; actual.append(trozo)
        elif trozo == ';' and not dentro:
            partes.append(''.join(actual).strip()); actual = []
        else:
            actual.append(trozo)
    if ''.join(actual).strip():
        partes.append(''.join(actual).strip())
    return [p for p in partes if p]


def filtrar(sql: str) -> list[str]:
    """Problemas del archivo; vacío = pasa. Se corre al emitir y otra vez antes de ejecutar."""
    limpio = _sin_literales(sql)
    malos = [w for w in PROHIBIDAS if re.search(rf'\b{w}\b', limpio, re.I)]
    out = [f'palabra prohibida: {w}' for w in malos]
    for s in _sentencias(limpio):
        if not RE_SENTENCIA_OK.match(s):
            out.append('sentencia no permitida: ' + s.split(None, 2)[0][:20])
    return out


# ── SQL ──────────────────────────────────────────────────────────────────────
def _q(v) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def cuerpo_sql(filas: list[dict], local: str, entorno: str) -> str:
    """Todo lo que va ENTRE begin/set local y commit: precondiciones, inserción y validación."""
    assert entorno in ('staging', 'prod')
    valores = ',\n  '.join(f"({_q(f['codigo'])}, {f['personas']}, {_q(f['fecha'])}::date, {_q(f['referencia'])})" for f in filas)
    n, total = len(filas), sum(f['personas'] for f in filas)
    cond_entorno = ("exists (select 1 from public.club_entorno)" if entorno == 'staging'
                    else "not exists (select 1 from public.club_entorno)")
    return f"""do $$
begin
  -- precondiciones (abortan todo): el local, el entorno, la línea de base y los anfitriones
  if not exists (select 1 from public.club_config where location_id = {_q(local)}) then
    raise exception 'CLUB: el local no existe';
  end if;
  if not ({cond_entorno}) then
    raise exception 'CLUB: el entorno no es {entorno}';
  end if;
  if exists (select 1 from public.club_movimientos where nota like {_q(NOTA + '%')}) then
    raise exception 'CLUB: línea de base: ya hay una carga de tarjetas de papel (no se carga dos veces)';
  end if;
end $$;
do $$
declare v_falta int;
begin
  select count(*) into v_falta from (values
  {valores}) p(codigo, personas, fecha, referencia)
   where not exists (select 1 from public.club_miembros m
                      where m.codigo = p.codigo and m.location_id = {_q(local)} and m.estado = 'activo'
                        and m.tipo in ('referente', 'concierge_pm', 'equipo'));
  if v_falta > 0 then
    raise exception 'CLUB: % filas con un código que no es un anfitrión activo del local', v_falta;
  end if;
end $$;
insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                     fecha_visita, registrado_en, origen, nota)
select m.location_id, m.id, 'tarjeta', p.personas, c.personas_por_credito, c.valor_credito_crc,
       (p.fecha::timestamp + time '12:00') at time zone 'America/Costa_Rica', now(), 'migracion',
       {_q(NOTA + ' · ')} || p.referencia
  from (values
  {valores}) p(codigo, personas, fecha, referencia)
  join public.club_miembros m on m.codigo = p.codigo and m.location_id = {_q(local)}
  join public.club_config c on c.location_id = m.location_id;
do $$
declare v_n int; v_p int;
begin
  -- validación dentro de la transacción: si no da, no queda nada
  select count(*), coalesce(sum(personas), 0) into v_n, v_p from public.club_movimientos where nota like {_q(NOTA + '%')};
  if v_n <> {n} or v_p <> {total} then
    raise exception 'CLUB: validación: % filas y % personas (se esperaban {n} y {total})', v_n, v_p;
  end if;
end $$;
"""


CABECERA = "begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '5min';\n"


def sql_carga(filas: list[dict], local: str, entorno: str) -> str:
    return CABECERA + cuerpo_sql(filas, local, entorno) + 'commit;\n'


def sql_ensayo(filas: list[dict], local: str, entorno: str, previo: str = '') -> str:
    """El mismo cuerpo, con ROLLBACK al final (y, en staging, el armado de anfitriones ficticios antes)."""
    return CABECERA + previo + cuerpo_sql(filas, local, entorno) + 'rollback;\n'


def resumen(filas: list[dict], sql: str, local: str) -> dict:
    """Lo único que viaja: conteos, totales y el sha256 del SQL. Sin códigos, referencias ni nombres."""
    total = sum(f['personas'] for f in filas)
    return {'local': local, 'filas': len(filas), 'anfitriones': len({f['codigo'] for f in filas}),
            'personas': total, 'creditos_aprox': round(total / 6, 1), 'sha256_sql': hashlib.sha256(sql.encode()).hexdigest()}


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
