#!/usr/bin/env python3
"""
Corre scripts/sql/165_pruebas.sql (origen club 111, B10: bitácora de permisos): llena el marcador con el cuerpo de la
165 y manda todo en UNA transacción que termina en ROLLBACK. La batería corre la ronda base y TODAS las mutaciones (cada
una en una subtransacción descartada) y devuelve un JSON. Sale 1 si algún caso de la base falla o alguna mutación no
muerde.

  python3 scripts/sql/165_pruebas.py            # STAGING (Management API). Nunca prod: el ref está fijo.
  python3 scripts/sql/165_pruebas.py --local    # Postgres local (psql; PGHOST/PGPORT/PGUSER/PGDATABASE del entorno)
  python3 scripts/sql/165_pruebas.py --armar    # solo imprime el SQL armado (no conecta a nada); sirve para el MCP

Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN).
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/165_admin_bitacora_permisos.sql'
MIN_CASOS = 19


def cuerpo() -> str:
    mig = MIG.read_text(encoding='utf-8')
    return '\n'.join(l for l in mig.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar() -> str:
    sql = (RAIZ / 'scripts/sql/165_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@165@@.*$', lambda _: cuerpo(), sql)
    if n != 1:
        sys.exit('165_pruebas.sql: falta el marcador «-- @@165@@» (o está repetido)')
    return sql


def desempaquetar(out: object) -> dict:
    if isinstance(out, str):
        out = json.loads(out)
    if not isinstance(out, dict):
        sys.exit(f'SIN RESULTADO: {str(out)[:400]}')
    return out


def correr_staging(sql: str) -> dict:
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'ERROR: {e.read().decode()[:600]}')
    return desempaquetar(res[0].get('resultado') if isinstance(res, list) and res else res)


def correr_local(sql: str) -> dict:
    r = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'ERROR psql: {r.stderr[:600]}')
    lineas = [l for l in r.stdout.splitlines() if l.startswith('{')]
    if not lineas:
        sys.exit(f'SIN RESULTADO: {r.stdout[:400]}')
    return desempaquetar(lineas[-1])


def main() -> None:
    args = sys.argv[1:]
    if '--armar' in args:
        print(armar())
        return
    r = correr_local(armar()) if '--local' in args else correr_staging(armar())
    print(f"base: {r['base_casos']} casos · fallan {len(r['base_fallan'])}")
    for c in r['base_fallan']:
        print(f"  FALLA {c['caso']} · {c.get('detalle')}")
    malas = [m for m in r['mutaciones'] if not m['muerde']]
    for m in r['mutaciones']:
        print(f"{'muerde' if m['muerde'] else 'NO MUERDE'} {m['m']}: caen {m['caen']} (esperadas {m['esperan']})")
    sys.exit(1 if r['base_fallan'] or malas or r['base_casos'] < MIN_CASOS else 0)


if __name__ == '__main__':
    main()
