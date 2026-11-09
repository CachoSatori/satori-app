#!/usr/bin/env python3
"""
Prueba que FALLA sin el arreglo (IDS-AUDITOR.md): corre la batería 075 en STAGING con UN arreglo deshecho dentro de la
misma transacción que la batería ya descarta (termina en ROLLBACK: nada queda en staging) y lista qué casos caen.

  CAJERO_UUID=… OWNER_UUID=… MANAGER_UUID=… SALONERO_UUID=… CONTADOR_UUID=… \\
    python3 scripts/sql/mutar_bateria.py scripts/sql/mutaciones_r7.json [NOMBRE…]

Cada mutación del JSON: {"antes_de": "<línea ancla de la batería>", y una de:
  "sql": "<SQL que deshace el arreglo>"  |  "funciones_de": {"commit": "<sha>", "funciones": ["public.f(", …]}}
«funciones_de» vuelve a crear las funciones tal como estaban en ese commit (el de ANTES del arreglo), sacadas con git.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
UUIDS = ('CAJERO', 'OWNER', 'SALONERO', 'CONTADOR', 'MANAGER')


def funcion(src: str, firma: str) -> str:
    i = src.index(f'create or replace function {firma}')
    a = src.index('as $$', i)
    j = src.index('$$', a + 5) + 2
    return src[i:j] + ';'


def ejecutar(sql: str) -> object:
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'error': e.read().decode()[:400]}


def main() -> None:
    muts = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    pedidas = sys.argv[2:] or list(muts)
    bat = (RAIZ / 'scripts/sql/075_pruebas_staging.sql').read_text(encoding='utf-8')
    for k in UUIDS:
        v = os.environ.get(f'{k}_UUID')
        if not v:
            sys.exit(f'falta {k}_UUID')
        bat = bat.replace(f'<{k}_UUID>', v)
    for nombre in pedidas:
        m = muts[nombre]
        if 'sql' in m:
            deshacer = m['sql']
        else:
            src = subprocess.run(['git', '-C', str(RAIZ), 'show', f"{m['funciones_de']['commit']}:supabase/migrations/075_club_satori_esquema.sql"],
                                 capture_output=True, text=True, check=True).stdout
            deshacer = '\n'.join(funcion(src, f) for f in m['funciones_de']['funciones'])
        if bat.count(m['antes_de']) != 1:
            print(nombre, 'ancla no encontrada (o repetida)'); continue
        for _ in range(4):   # la API a veces corta con «upstream request failed»: se reintenta
            r = ejecutar(bat.replace(m['antes_de'], deshacer + '\n' + m['antes_de']))
            if 'upstream' not in str(r)[:200]:
                break
        try:
            res = r[0]['json_agg']
        except Exception:
            print(nombre, 'ERROR', str(r)[:400]); continue
        caen = [x for x in res if not x['ok']]
        print(f"{nombre}: {len(res)} casos · caen {len(caen)}")
        for x in caen:
            print(f"   {x['p']} · {x['caso'][:100]}")


if __name__ == '__main__':
    main()
