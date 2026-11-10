#!/usr/bin/env python3
"""
G-61 sin que Claude lea prod (10-nov, paquete del pase del Club).

El dueño corre scripts/sql/gate61_catalogo.sql en el editor SQL de PROD (dentro de «begin read only; … rollback;») y
descarga el resultado con «Download CSV». Ese CSV tiene UNA columna («cat») y UNA fila: el catálogo entero, un hecho por
línea. Este script lo pasa al formato que lee gate61.sh --archivos (un hecho por línea), sin tocar ninguna base:

  python3 -I scripts/sql/gate61_desde_csv.py prod.csv prod.txt
  bash scripts/sql/gate61.sh --archivos staging.txt prod.txt --modo-prod

Se niega (sale 1, sin escribir nada) si el CSV no tiene exactamente el encabezado «cat» y una fila, o si el catálogo
viene vacío o «null». El catálogo no tiene datos de personas: nombres de objetos, roles y huellas md5.
"""
from __future__ import annotations
import csv, sys
from pathlib import Path


def convertir(entrada: Path) -> str:
    csv.field_size_limit(64 * 1024 * 1024)
    with entrada.open(encoding='utf-8-sig', newline='') as f:
        filas = list(csv.reader(f))
    if not filas or [c.strip() for c in filas[0]] != ['cat']:
        raise ValueError('el CSV tiene que tener una sola columna llamada «cat» (la salida de gate61_catalogo.sql)')
    datos = [r for r in filas[1:] if r != []]
    if len(datos) != 1 or len(datos[0]) != 1:
        raise ValueError(f'se esperaba exactamente 1 fila con 1 columna; vinieron {len(datos)} filas')
    cat = datos[0][0].replace('\r\n', '\n').strip('\n')
    if cat.strip() in ('', 'null'):
        raise ValueError('el catálogo viene vacío o «null»: ¿se corrió la consulta entera?')
    return cat + '\n'


def main() -> int:
    if len(sys.argv) != 3:
        print('uso: gate61_desde_csv.py <entrada.csv> <salida.txt>', file=sys.stderr)
        return 1
    try:
        txt = convertir(Path(sys.argv[1]))
    except (ValueError, OSError, csv.Error) as e:
        print(f'NEGADO: {e}', file=sys.stderr)
        return 1
    Path(sys.argv[2]).write_text(txt, encoding='utf-8')
    print(f'{txt.count(chr(10))} hechos → {sys.argv[2]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
