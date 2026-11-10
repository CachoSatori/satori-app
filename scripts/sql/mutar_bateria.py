#!/usr/bin/env python3
"""
Prueba que FALLA sin el arreglo (IDS-AUDITOR.md): corre la batería 075 en STAGING con UN arreglo deshecho dentro de la
misma transacción que la batería ya descarta (termina en ROLLBACK: nada queda en staging) y lista qué casos caen.
10-nov: por TRAMOS (bateria_club.py). Como en la batería entera la mutación sigue puesta hasta el final, se corre en el
tramo que tiene su ancla (justo antes del ancla) y en TODOS los tramos siguientes (al empezar, después de su puesta a
punto). Cada request (preámbulo + tramo con la mutación + cierre) entra holgado en los 30 s de la Management API.

  CAJERO_UUID=… OWNER_UUID=… MANAGER_UUID=… SALONERO_UUID=… CONTADOR_UUID=… \\
    python3 scripts/sql/mutar_bateria.py scripts/sql/mutaciones_r7.json [NOMBRE…]

Cada mutación del JSON: {"antes_de": "<línea ancla de la batería>", y una de:
  "sql": "<SQL que deshace el arreglo>"  |  "funciones_de": {"commit": "<sha>", "funciones": ["public.f(", …]}}
  (con «funciones_de», «sql_antes» opcional corre antes: por ejemplo un drop si la versión vieja devuelve otro tipo)
«funciones_de» vuelve a crear las funciones tal como estaban en ese commit (el de ANTES del arreglo), sacadas con git.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, subprocess, sys, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bateria_club   # noqa: E402  (partir la batería en preámbulo, tramos y cierre)

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
    pre, tramos, cierre = bateria_club.partir(bateria_club.leer())
    for nombre in pedidas:
        m = muts[nombre]
        if 'sql' in m:
            deshacer = m['sql']
        else:
            src = subprocess.run(['git', '-C', str(RAIZ), 'show', f"{m['funciones_de']['commit']}:supabase/migrations/075_club_satori_esquema.sql"],
                                 capture_output=True, text=True, check=True).stdout
            # «sql_antes»: lo que hay que correr antes (p. ej. un drop si la versión vieja devuelve otro tipo)
            deshacer = m.get('sql_antes', '') + '\n' + '\n'.join(funcion(src, f) for f in m['funciones_de']['funciones'])
        donde = [(n, cuerpo) for n, _, cuerpo in tramos if cuerpo.count(m['antes_de']) == 1]
        if len(donde) != 1 or sum(cuerpo.count(m['antes_de']) for _, _, cuerpo in tramos) != 1:
            print(nombre, 'ancla no encontrada (o repetida)'); continue
        n_tramo = donde[0][0]
        res, err = [], ''
        for n, _, cuerpo in tramos:
            if n < n_tramo:
                continue
            if n == n_tramo:
                mutado = cuerpo.replace(m['antes_de'], deshacer + '\n' + m['antes_de'])
            else:   # al empezar el tramo: después de su marca y de su puesta a punto (antes del primer bloque)
                i = cuerpo.index('\n-- ═══ ') + 1
                mutado = cuerpo[:i] + deshacer + '\n' + cuerpo[i:]
            for _ in range(4):   # la API a veces corta con «upstream request failed»: se reintenta
                r = ejecutar(bateria_club.armar(pre, mutado, cierre))
                if 'upstream' not in str(r)[:200]:
                    break
            try:
                res += [dict(x, tramo=n) for x in r[0]['json_agg']]
            except Exception:
                err += f' · tramo {n}: {str(r)[:300]}'
        if err and not res:
            print(nombre, 'ERROR', err); continue
        caen = [x for x in res if not x['ok']]
        por_tramo = ', '.join(f"T{n} {sum(1 for x in caen if x['tramo'] == n)}" for n in sorted({x['tramo'] for x in res}))
        print(f"{nombre} (ancla en el tramo {n_tramo}): {len(res)} casos · caen {len(caen)} ({por_tramo}){' · ERROR' + err if err else ''}")
        for x in caen:
            print(f"   T{x['tramo']} {x['p']} · {x['caso'][:100]}")


if __name__ == '__main__':
    main()
