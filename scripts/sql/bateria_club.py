#!/usr/bin/env python3
"""
Batería del Club (075) POR TRAMOS, en STAGING (10-nov). La batería entera ya tardaba 21–30 s y la Management API corta
a los 30 s: sin resultado no se sabe si está verde. Ahora cada tramo va en su propio request, con el mismo preámbulo.

El archivo sigue siendo UNO (scripts/sql/075_pruebas_staging.sql), con marcas:
  · preámbulo: desde el principio hasta la primera línea «-- ════════ TRAMO 1: …»;
  · tramo N: desde su marca hasta la siguiente (o hasta el cierre);
  · cierre: el «select json_agg(… from _res;» final y el «rollback;».
Cada request = preámbulo + tramo + cierre: corre en una transacción que termina en ROLLBACK (no deja nada en staging).
Los tramos van UNO DETRÁS DEL OTRO (en paralelo se podrían trabar en las mismas filas, por ejemplo club_config).

  CAJERO_UUID=… OWNER_UUID=… MANAGER_UUID=… SALONERO_UUID=… CONTADOR_UUID=… \\
    python3 scripts/sql/bateria_club.py [--tramo N] [--esperado 597] [--json salida.json]

Sale 0 solo si todos los tramos devolvieron resultados, todos los casos dieron ok y (con --esperado) el total es ese.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, re, sys, time, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
BATERIA = RAIZ / 'scripts/sql/075_pruebas_staging.sql'
UUIDS = ('CAJERO', 'OWNER', 'SALONERO', 'CONTADOR', 'MANAGER')
RE_TRAMO = re.compile(r'^-- ════════ TRAMO (\d+): (.*?) ════════$', re.M)
CIERRE = "select json_agg(json_build_object('p', prueba, 'caso', caso, 'ok', ok, 'detalle', left(detalle, 200)) order by n) from _res;"


def leer(con_uuids: bool = True) -> str:
    txt = BATERIA.read_text(encoding='utf-8')
    if con_uuids:
        for k in UUIDS:
            v = os.environ.get(f'{k}_UUID')
            if not v:
                sys.exit(f'falta {k}_UUID')
            txt = txt.replace(f'<{k}_UUID>', v)
    return txt


def partir(txt: str) -> tuple[str, list[tuple[int, str, str]], str]:
    """(preámbulo, [(n, título, cuerpo)], cierre). Falla si las marcas no están en orden 1, 2, 3…"""
    marcas = list(RE_TRAMO.finditer(txt))
    if not marcas:
        raise ValueError('la batería no tiene marcas de tramo')
    if [int(m.group(1)) for m in marcas] != list(range(1, len(marcas) + 1)):
        raise ValueError('las marcas de tramo no van 1, 2, 3… en orden')
    if txt.count(CIERRE) != 1:
        raise ValueError('el cierre (select json_agg … from _res;) no aparece exactamente una vez')
    i_cierre = txt.index(CIERRE)
    pre = txt[:marcas[0].start()]
    tramos = []
    for k, m in enumerate(marcas):
        fin = marcas[k + 1].start() if k + 1 < len(marcas) else i_cierre
        tramos.append((int(m.group(1)), m.group(2), txt[m.start():fin]))
    return pre, tramos, txt[i_cierre:]


def armar(pre: str, cuerpo: str, cierre: str) -> str:
    return pre + cuerpo + '\n' + cierre


def ejecutar(sql: str) -> object:
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'error': e.read().decode()[:600]}


def correr(sql: str) -> tuple[list[dict] | None, float, str]:
    """(casos o None, segundos, error). Reintenta si la API corta con «upstream request failed»."""
    for _ in range(3):
        t0 = time.time()
        r = ejecutar(sql)
        seg = time.time() - t0
        if 'upstream' not in str(r)[:200]:
            break
    try:
        casos = r[0]['json_agg']
        if not isinstance(casos, list) or not casos:
            return None, seg, 'el tramo no devolvió casos'
        return casos, seg, ''
    except Exception:
        return None, seg, str(r)[:600]


def main() -> None:
    args = sys.argv[1:]
    solo = int(args[args.index('--tramo') + 1]) if '--tramo' in args else None
    esperado = int(args[args.index('--esperado') + 1]) if '--esperado' in args else None
    salida = args[args.index('--json') + 1] if '--json' in args else None
    pre, tramos, cierre = partir(leer())
    todos, mal = [], False
    for n, titulo, cuerpo in tramos:
        if solo is not None and n != solo:
            continue
        casos, seg, err = correr(armar(pre, cuerpo, cierre))
        if casos is None:
            print(f'TRAMO {n} ({titulo}): SIN RESULTADO en {seg:.1f} s · {err}')
            mal = True
            continue
        caen = [c for c in casos if not c['ok']]
        print(f'TRAMO {n} ({titulo}): {len(casos)} casos · {len(casos) - len(caen)} ok · {seg:.1f} s')
        for c in caen:
            print(f"   FALLA {c['p']} · {c['caso'][:110]} · {str(c.get('detalle'))[:120]}")
        mal = mal or bool(caen)
        todos += [dict(c, tramo=n) for c in casos]
    print(f'── TOTAL: {len(todos)} casos · {sum(1 for c in todos if c["ok"])} ok')
    if esperado is not None and len(todos) != esperado:
        print(f'── el total no es el esperado ({esperado})'); mal = True
    if salida:
        Path(salida).write_text(json.dumps(todos, ensure_ascii=False), encoding='utf-8')
    sys.exit(1 if mal else 0)


if __name__ == '__main__':
    main()
