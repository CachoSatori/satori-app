#!/usr/bin/env python3
"""
Corre scripts/sql/157_pruebas.sql (origen 104) en STAGING: llena el marcador con el cuerpo de la 157 y manda todo en UNA
transacción que termina en ROLLBACK. La batería corre la ronda base y TODAS las mutaciones (cada una en una
subtransacción descartada) y devuelve un JSON. Sale 1 si algún caso de la base falla o alguna mutación no muerde.

  python3 scripts/sql/157_pruebas.py            # corre en staging (Management API)
  python3 scripts/sql/157_pruebas.py --armar    # solo imprime el SQL armado (no conecta a nada); sirve para el MCP

Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/157_club_equipo_sin_creditos.sql'


def cuerpo() -> str:
    mig = MIG.read_text(encoding='utf-8')
    return '\n'.join(l for l in mig.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar() -> str:
    sql = (RAIZ / 'scripts/sql/157_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@157@@.*$', lambda _: cuerpo(), sql)
    if n != 1:
        sys.exit('157_pruebas.sql: falta el marcador «-- @@157@@» (o está repetido)')
    return sql


def correr(sql: str) -> dict:
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'ERROR: {e.read().decode()[:600]}')
    out = res[0].get('resultado') if isinstance(res, list) and res else None
    if isinstance(out, str):
        out = json.loads(out)
    if not isinstance(out, dict):
        sys.exit(f'SIN RESULTADO: {str(res)[:400]}')
    return out


def main() -> None:
    if '--armar' in sys.argv[1:]:
        print(armar())
        return
    r = correr(armar())
    print(f"base: {r['base_casos']} casos · fallan {len(r['base_fallan'])}")
    for c in r['base_fallan']:
        print(f"  FALLA {c['caso']} · {c.get('detalle')}")
    malas = [m for m in r['mutaciones'] if not m['muerde']]
    for m in r['mutaciones']:
        print(f"{'muerde' if m['muerde'] else 'NO MUERDE'} {m['m']}: caen {m['caen']} (esperadas {m['esperan']})")
    sys.exit(1 if r['base_fallan'] or malas or r["base_casos"] < 26 else 0)


if __name__ == '__main__':
    main()
