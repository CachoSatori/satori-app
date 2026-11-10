#!/usr/bin/env python3
"""
Corre scripts/sql/151_pruebas.sql en STAGING (Grok 180, 10-nov): llena los marcadores (el cuerpo de la 151 y los UUID),
todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  OWNER_UUID=… CAJERO_UUID=… python3 scripts/sql/151_pruebas.py

Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]


def armar() -> str:
    mig = (RAIZ / 'supabase/migrations/151_club_catalogo_locales.sql').read_text(encoding='utf-8')
    cuerpo = '\n'.join(l for l in mig.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))
    sql = (RAIZ / 'scripts/sql/151_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@151@@.*$', lambda _: cuerpo, sql)
    if n != 1:
        sys.exit('151_pruebas.sql: falta el marcador «-- @@151@@» (o está repetido)')
    for k in ('OWNER', 'CAJERO'):
        v = os.environ.get(f'{k}_UUID')
        if not v or not re.fullmatch(r'[0-9a-f-]{36}', v):
            sys.exit(f'falta {k}_UUID')
        sql = sql.replace(f'<{k}_UUID>', v)
    return sql


def main() -> None:
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': armar()}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'ERROR: {e.read().decode()[:400]}')
    casos = res[0].get('json_agg') if isinstance(res, list) and res else None
    if not isinstance(casos, list) or not casos:
        sys.exit(f'SIN RESULTADO: {str(res)[:400]}')
    for c in casos:
        print(('ok   ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if not c['ok'] and c.get('detalle') else ''))
    caen = [c for c in casos if not c['ok']]
    print(f'── {len(casos)} casos · {len(casos) - len(caen)} ok')
    sys.exit(1 if caen else 0)


if __name__ == '__main__':
    main()
