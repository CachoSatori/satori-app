#!/usr/bin/env python3
"""
Corre scripts/sql/197_pruebas.sql (origen 141: Competencias de Ventas, el contador solo mira; política `ventas_comps_write`): llena los
marcadores con el cuerpo de la 197 y de su vuelta atrás y manda todo en UNA transacción que termina en ROLLBACK. La
batería corre la ronda base, las 7 mutaciones (cada una en una subtransacción descartada) y la vuelta atrás. Si un caso
de la base falla o una mutación no muerde, el ASSERT final aborta con «197-FALLAN: …» y este script sale 1.

  python3 scripts/sql/197_pruebas.py            # STAGING (Management API). Nunca prod: el ref está fijo.
  python3 scripts/sql/197_pruebas.py --local    # Postgres local (psql; PGHOST/PGPORT/PGUSER/PGDATABASE del entorno)
  python3 scripts/sql/197_pruebas.py --armar [--local]   # solo imprime el SQL armado (no conecta); sirve para el MCP

Base local NUEVA, de cero (Postgres 16; nada de staging ni prod). local_armar_base.sh aplica TODO el árbol, 197 incluida:
antes de la batería se corre la vuelta atrás de la 197 sobre esa base, así la batería prueba la migración sin aplicar (R15):
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv bash scripts/sql/local_armar_base.sh b197
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv PGDATABASE=b197 psql -X -f scripts/sql/197_rollback.sql
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv PGDATABASE=b197 python3 scripts/sql/197_pruebas.py --local
Con --local, antes de la 197 (dentro de la misma transacción descartada) corren 165_preludio_local.sql (policies y
permisos por defecto de Supabase) y 197_preludio_local.sql (un owner, un manager, un contador y un salonero
ficticios). En staging usa como JWT al owner, manager, contador y salonero activos que ya existen (sin cambiarles nada)
y crea competencias ficticias `prueba197-*` dentro de la transacción descartada.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN).
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/197_ventas_comps_sin_contador.sql'
ROLLBACK = RAIZ / 'scripts/sql/197_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/197_pruebas.sql'


def sin_begin_commit(texto: str) -> str:
    return '\n'.join(l for l in texto.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(local: bool = False) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    previo = ''.join((RAIZ / f'scripts/sql/{f}').read_text(encoding='utf-8') + '\n'
                     for f in ('165_preludio_local.sql', '197_preludio_local.sql')) if local else ''
    for marca, archivo in (('@@197@@', MIG), ('@@197R@@', ROLLBACK)):
        cuerpo = (previo if marca == '@@197@@' else '') + sin_begin_commit(archivo.read_text(encoding='utf-8'))
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'(?!R).*$', lambda _: cuerpo, sql)
        if n != 1:
            sys.exit(f'197_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    return sql


def correr_staging(sql: str) -> object:
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode('utf-8', 'replace')
        m = re.search(r'197-FALLAN: [^"\\]*', cuerpo)
        print(m.group(0) if m else f'ERROR {e.code}: {cuerpo[:800]}')
        sys.exit(1)


def correr_local(sql: str) -> None:
    p = subprocess.run(['psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    for l in p.stderr.splitlines():
        if '197 FALLA' in l or '197 RESUMEN' in l:
            print('   ', l.split('WARNING:  ')[-1].split('NOTICE:  ')[-1][:400])
    linea = next((l for l in p.stdout.splitlines() if l.startswith('{')), None)
    if linea:
        r = json.loads(linea)
        for c in r['base']:
            print(('ok    ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if c.get('detalle') else ''))
        for m in r['mutaciones']:
            print(f"{'muerde   ' if m['muerde'] else 'NO MUERDE'} {m['m']}: caen {m['caen']} (esperan {m['esperan']})")
    if p.returncode != 0:
        m = re.search(r'197-FALLAN: [^\n]*', p.stderr)
        print(m.group(0) if m else f'ERROR: {p.stderr[:800]}')
        sys.exit(1)
    print('197: verde (la transacción terminó en ROLLBACK sin «197-FALLAN»)')


def main() -> None:
    local = '--local' in sys.argv[1:]
    sql = armar(local)
    if '--armar' in sys.argv[1:]:
        print(sql)
        return
    if local:
        correr_local(sql)
        return
    out = correr_staging(sql)
    print(json.dumps(out, ensure_ascii=False, indent=1)[:6000])
    print('197: verde (la transacción terminó en ROLLBACK sin «197-FALLAN»)')


if __name__ == '__main__':
    main()
