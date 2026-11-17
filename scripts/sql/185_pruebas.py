#!/usr/bin/env python3
"""
Corre scripts/sql/185_pruebas.sql (origen caja 099: obligar a cambiar la contraseña al entrar): llena los marcadores
con el cuerpo de la 185 y del rollback y manda todo en UNA transacción que termina en ROLLBACK. La batería corre la
ronda base, las 12 mutaciones (cada una en una subtransacción descartada) y la vuelta atrás. Si un caso de la base
falla o una mutación no muerde, el ASSERT final aborta con «185-FALLAN: …» y este script sale 1.

  python3 scripts/sql/185_pruebas.py            # STAGING (Management API). Nunca prod: el ref está fijo.
  python3 scripts/sql/185_pruebas.py --local    # Postgres local (psql; PGHOST/PGPORT/PGUSER/PGDATABASE del entorno)
  python3 scripts/sql/185_pruebas.py --armar [--local]   # solo imprime el SQL armado (no conecta); sirve para el MCP

Base local NUEVA, de cero (Postgres 16; nada de staging ni prod). local_armar_base.sh aplica TODO el árbol, 185 incluida:
antes de la batería se corre el rollback de la 185 sobre esa base, así la batería prueba la migración sin aplicar (R15):
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv bash scripts/sql/local_armar_base.sh b185
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv PGDATABASE=b185 psql -X -f scripts/sql/185_rollback.sql
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv PGDATABASE=b185 python3 scripts/sql/185_pruebas.py --local
Con --local, antes de la 185 (dentro de la misma transacción descartada) corren 165_preludio_local.sql (policies y
permisos por defecto de Supabase) y 185_preludio_local.sql (encrypted_password y un owner/manager/salonero ficticios).
En staging usa como JWT al owner, manager y salonero activos que ya existen (sin cambiarles nada); en los dos casos crea
tres cuentas ficticias en auth.users dentro de la transacción descartada.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN).
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/185_seguridad_cambio_clave.sql'
ROLLBACK = RAIZ / 'scripts/sql/185_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/185_pruebas.sql'


def sin_begin_commit(texto: str) -> str:
    return '\n'.join(l for l in texto.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(local: bool = False) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    previo = ''.join((RAIZ / f'scripts/sql/{f}').read_text(encoding='utf-8') + '\n'
                     for f in ('165_preludio_local.sql', '185_preludio_local.sql')) if local else ''
    for marca, archivo in (('@@185@@', MIG), ('@@185R@@', ROLLBACK)):
        cuerpo = (previo if marca == '@@185@@' else '') + sin_begin_commit(archivo.read_text(encoding='utf-8'))
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'(?!R).*$', lambda _: cuerpo, sql)
        if n != 1:
            sys.exit(f'185_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
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
        m = re.search(r'185-FALLAN: [^"\\]*', cuerpo)
        print(m.group(0) if m else f'ERROR {e.code}: {cuerpo[:800]}')
        sys.exit(1)


def correr_local(sql: str) -> None:
    p = subprocess.run(['psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    for l in p.stderr.splitlines():
        if '185 FALLA' in l or '185 RESUMEN' in l:
            print('   ', l.split('WARNING:  ')[-1].split('NOTICE:  ')[-1][:400])
    linea = next((l for l in p.stdout.splitlines() if l.startswith('{')), None)
    if linea:
        r = json.loads(linea)
        for c in r['base']:
            print(('ok    ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if c.get('detalle') else ''))
        for m in r['mutaciones']:
            print(f"{'muerde   ' if m['muerde'] else 'NO MUERDE'} {m['m']}: caen {m['caen']} (esperan {m['esperan']})")
    if p.returncode != 0:
        m = re.search(r'185-FALLAN: [^\n]*', p.stderr)
        print(m.group(0) if m else f'ERROR: {p.stderr[:800]}')
        sys.exit(1)
    print('185: verde (la transacción terminó en ROLLBACK sin «185-FALLAN»)')


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
    print('185: verde (la transacción terminó en ROLLBACK sin «185-FALLAN»)')


if __name__ == '__main__':
    main()
