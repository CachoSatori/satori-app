"""
Compacta el SQL armado de una batería (modo --compacto de scripts/sql/*_pruebas.py) SIN tocar el texto que va adentro
de un literal: cuerpos dollar-quoted ($$…$$, $function$…$function$, $q$…$q$), strings '…', identificadores "…" ni
comentarios de bloque.

Fuera de esos literales saca las líneas vacías, las de comentario (-- …) y la sangría. Una línea que EMPIEZA adentro
de un literal sale tal cual (con sus comentarios y su sangría), y a una que TERMINA adentro no se le recorta el final.

Por qué (26-nov): el compacto viejo borraba las líneas de comentario de TODO el SQL, también las de adentro de los
cuerpos de funciones; la huella md5 del cuerpo cambiaba (la 200 completa da 636d3776, compacta daba 4efd18f4) y la
batería 202 en staging se frenó con «los cuerpos no son los de la 200».

  python3 scripts/sql/sql_compacto.py --cuerpos < archivo.sql   # md5 sin espacios de cada cuerpo dollar-quoted, uno por línea
"""
from __future__ import annotations
import hashlib, re, sys

NORMAL, STRING, IDENT, BLOQUE, DOLAR = 'normal', 'string', 'ident', 'bloque', 'dolar'
_TAG = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*)?\$')


def _estados(sql: str) -> list[tuple[str, str]]:
    """Para cada línea (split por '\\n'): (estado al empezar, estado al terminar)."""
    out: list[tuple[str, str]] = []
    estado, tag = NORMAL, ''
    i, n = 0, len(sql)
    inicio = estado
    while i < n:
        c = sql[i]
        if c == '\n':
            out.append((inicio, estado))
            inicio = estado
            i += 1
            continue
        if estado == NORMAL:
            if sql.startswith('--', i):
                j = sql.find('\n', i)
                i = n if j < 0 else j
                continue
            if sql.startswith('/*', i):
                estado, i = BLOQUE, i + 2
                continue
            if c == "'":
                estado, i = STRING, i + 1
                continue
            if c == '"':
                estado, i = IDENT, i + 1
                continue
            if c == '$' and (i == 0 or not (sql[i - 1].isalnum() or sql[i - 1] == '_')):
                m = _TAG.match(sql, i)
                if m:
                    estado, tag, i = DOLAR, m.group(0), m.end()
                    continue
            i += 1
        elif estado == STRING:
            if c == "'":
                if sql.startswith("''", i):
                    i += 2
                    continue
                estado = NORMAL
            i += 1
        elif estado == IDENT:
            if c == '"':
                if sql.startswith('""', i):
                    i += 2
                    continue
                estado = NORMAL
            i += 1
        elif estado == BLOQUE:
            if sql.startswith('*/', i):
                estado, i = NORMAL, i + 2
                continue
            i += 1
        else:  # DOLAR: solo importa la etiqueta que cierra
            j = sql.find(tag, i)
            if j < 0:
                # cuerpo sin cerrar: todo lo que queda está adentro
                for _ in range(sql.count('\n', i)):
                    out.append((inicio, estado))
                    inicio = estado
                i = n
                break
            for _ in range(sql.count('\n', i, j)):
                out.append((inicio, estado))
                inicio = estado
            estado, tag, i = NORMAL, '', j + len(tag)
    out.append((inicio, estado))
    return out


def compactar(sql: str) -> str:
    lineas = sql.split('\n')
    res: list[str] = []
    for linea, (ini, fin) in zip(lineas, _estados(sql)):
        if ini != NORMAL:
            res.append(linea if fin != NORMAL else linea.rstrip())
            continue
        s = linea.lstrip()
        if not s.strip() or s.startswith('--'):
            continue
        res.append(s.rstrip() if fin == NORMAL else s)
    return '\n'.join(res)


def huellas_cuerpos(sql: str) -> list[str]:
    """md5 (sin espacios, como `md5(regexp_replace(prosrc, '\\s', '', 'g'))`) de cada cuerpo dollar-quoted de
    primer nivel, en orden."""
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith('--', i):
            j = sql.find('\n', i)
            i = n if j < 0 else j
        elif sql.startswith('/*', i):
            j = sql.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and not sql.startswith("''", j):
                    break
                j += 2 if sql.startswith("''", j) else 1
            i = j + 1
        elif c == '$' and (i == 0 or not (sql[i - 1].isalnum() or sql[i - 1] == '_')) and (m := _TAG.match(sql, i)):
            j = sql.find(m.group(0), m.end())
            if j < 0:
                break
            out.append(hashlib.md5(re.sub(r'\s', '', sql[m.end():j]).encode()).hexdigest())
            i = j + len(m.group(0))
        else:
            i += 1
    return out


if __name__ == '__main__':
    if '--cuerpos' in sys.argv[1:]:
        print('\n'.join(huellas_cuerpos(sys.stdin.read())))
    else:
        sys.stdout.write(compactar(sys.stdin.read()))
