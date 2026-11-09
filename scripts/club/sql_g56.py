#!/usr/bin/env python3
"""
Club Satori — filtro de sentencias de G-56 (RUNBOOK §12) con ANÁLISIS REAL del SQL, no con regex sobre el texto crudo.

Por qué (auditoría del 08-nov): el filtro viejo sacaba los literales con una regex y después buscaba palabras. Cuatro
archivos trucados lo pasaban: un comentario con una comilla («-- it's») que abría un literal falso y escondía un
`delete`; un `execute` dentro de un `do`; un `set local session_replication_role`; y un `insert` en otra tabla del Club.

Cómo:
  1. `tokenizar` lee el SQL como lo lee Postgres: literales '…' (con '' adentro), E'…' (con escapes \\), identificadores
     "…", dollar-quoting $tag$…$tag$ con cualquier tag, comentarios -- y /* */ ANIDADOS, números, palabras y puntuación.
     Lo que está en un comentario no existe; lo que está en un literal es dato. Cualquier cosa sin cerrar es un problema.
  2. Se parte en sentencias por «;» de nivel superior (fuera de literales, comentarios y paréntesis).
  3. LISTA BLANCA de sentencias de nivel superior: `begin`, `commit`/`rollback` (una transacción: begin primero, commit o
     rollback al final, ninguno en el medio); `set local lock_timeout|statement_timeout = '<literal>'`;
     `do $tag$ … $tag$` (cuyo cuerpo se vuelve a tokenizar y se revisa con su propia lista blanca de PL/pgSQL);
     `insert into public.<tabla permitida> [(columnas)] select|values …`.
  4. LISTA NEGRA de palabras en TODO el código, incluidos los cuerpos de los `do` (execute, delete, update, set, …).
  5. (09-nov, Grok 114) LISTA BLANCA de FUNCIONES: toda llamada `nombre(` o `esquema.nombre(` —en un `select … into`, un
     `:=`, un `insert … select|values`, un `create temp table … as select`, un `if`, donde sea— tiene que estar en
     `INMUTABLES` (built-ins de pg_catalog con TODAS sus versiones inmutables, verificado contra el catálogo en
     `test_sql_g56`) o en las EXCEPCIONES nombradas de cada perfil, cada una con su motivo. Todo lo demás se rechaza,
     aunque no esté en la lista negra (p. ej. `public.club_ajuste(…)` dentro de un `select … into`).

Uso: `revisar(sql)` → lista de problemas (vacía = pasa). Los mensajes nunca vuelcan el contenido de un literal.
"""
from __future__ import annotations

import re

# Palabras (o identificadores) prohibidas en cualquier lugar del código. Las de nivel superior permitidas (`set` de un
# `set local` y el `insert` permitido) se sacan antes de mirar.
PROHIBIDAS = frozenset({
    'execute', 'delete', 'update', 'truncate', 'drop', 'alter', 'grant', 'revoke', 'create', 'copy', 'call',
    'set', 'reset', 'set_config', 'perform', 'insert', 'merge', 'lock', 'listen', 'unlisten', 'notify',
    'vacuum', 'analyze', 'analyse', 'cluster', 'reindex', 'comment', 'security', 'prepare', 'deallocate',
    'discard', 'load', 'import', 'checkpoint', 'refresh', 'savepoint', 'release', 'commit', 'rollback',
    'dblink', 'lo_import', 'lo_export', 'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir',
    'pg_terminate_backend', 'pg_cancel_backend', 'session_replication_role', 'setval', 'nextval',
    'query_to_xml', 'query_to_xmlschema', 'query_to_xml_and_xmlschema', 'cursor_to_xml',
})
# Familias enteras: funciones del servidor (pg_…), dblink_… y objetos grandes (lo_…).
PREFIJOS_PROHIBIDOS = ('pg_', 'dblink', 'lo_')
SET_PERMITIDOS = ('lock_timeout', 'statement_timeout')
EXTRAS = (None, 'alta_ficticios')

# ── (09-nov, Grok 114) Funciones que se pueden llamar ─────────────────────────────────────────────────────────────
# Built-ins de pg_catalog con TODAS sus versiones IMMUTABLE (provolatile = 'i'); test_sql_g56 lo verifica contra el
# catálogo de staging. Las que tienen alguna versión estable (date_trunc, length, generate_series, numeric, …) no entran.
INMUTABLES = frozenset({
    'abs', 'array_agg', 'array_length', 'bool_and', 'bool_or', 'btrim', 'cardinality', 'ceil', 'char_length', 'count',
    'decode', 'encode', 'floor', 'jsonb_array_elements', 'jsonb_array_elements_text', 'jsonb_array_length', 'jsonb_each',
    'jsonb_each_text', 'jsonb_extract_path_text', 'jsonb_object_keys', 'jsonb_set', 'jsonb_strip_nulls', 'jsonb_typeof',
    'left', 'lower', 'lpad', 'ltrim', 'make_interval', 'max', 'md5', 'min', 'mod', 'position', 'regexp_match',
    'regexp_matches', 'regexp_replace', 'replace', 'right', 'round', 'rpad', 'rtrim', 'sha256', 'sign', 'split_part',
    'string_agg', 'strpos', 'substr', 'sum', 'translate', 'trunc', 'unnest', 'upper',
})
# Expresiones condicionales de SQL con forma de llamada (no son funciones del catálogo).
CONSTRUCCIONES = frozenset({'coalesce', 'nullif', 'greatest', 'least'})
# Excepciones NOMBRADAS (no inmutables), una por una, con su motivo. Las estables no pueden escribir (Postgres rechaza un
# INSERT/UPDATE/DELETE dentro de una función que no es volatile); las volátiles solo generan códigos al azar.
EXCEPCIONES_G56 = {
    'now': 'estable · fecha del movimiento y de la carga',
    'to_char': 'estable · la nota del movimiento lleva la fecha como texto',
}
EXCEPCIONES_MIGRADOR = {
    **EXCEPCIONES_G56,
    'jsonb_to_recordset': 'estable · el export viaja como UN literal jsonb',
    'json_build_object': 'estable · el resumen de la validación',
    'json_object_agg': 'estable · el resumen de la validación',
    'array_to_string': 'estable · mensajes de la validación',
    'has_table_privilege': 'estable · el barrido de permisos de anon de la validación',
    'public.club_vencer_candidatos': 'estable (del Club) · el chequeo de 12 meses',
    'public.club_gen_codigo': 'volátil (del Club) · el código de cada miembro migrado; solo LEE (test_sql_g56 lo verifica)',
    'extensions.gen_random_bytes': 'volátil · el token del portal de cada miembro',
}
# Palabras que pueden ir antes de «(» sin ser una llamada (palabras clave y tipos con modificador).
NO_LLAMADA = frozenset({
    'values', 'in', 'exists', 'any', 'all', 'some', 'as', 'from', 'join', 'on', 'using', 'and', 'or', 'not', 'select',
    'where', 'then', 'else', 'when', 'over', 'filter', 'within', 'lateral', 'with', 'row', 'array', 'by', 'partition',
    'having', 'returning', 'distinct', 'is', 'case', 'if', 'elsif', 'between', 'like', 'ilike', 'similar', 'union',
    'except', 'intersect', 'limit', 'offset', 'into', 'cast', 'numeric', 'decimal', 'varchar', 'char', 'character',
    'varying', 'timestamp', 'timestamptz', 'time', 'interval', 'bit', 'loop', 'by',
})

_LETRA = r'A-Za-z_\u0080-\U0010ffff'
RE_PALABRA = re.compile(rf'[{_LETRA}][{_LETRA}0-9$]*')
RE_NUMERO = re.compile(r'(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?')
RE_DOLAR = re.compile(rf'\$(?:[{_LETRA}][{_LETRA}0-9]*)?\$')

# Un token es (tipo, valor): 'w' palabra (en minúsculas), 'q' identificador entre comillas (tal cual),
# 's' literal, 'd' cuerpo entre $tag$, 'n' número, 'p' puntuación (':=' va junto).
Token = tuple[str, str]


# ── Tokenizador ──────────────────────────────────────────────────────────────
def tokenizar(sql: str, barra_en_literal: bool = False) -> tuple[list[Token], list[str]]:
    """`barra_en_literal` (solo el perfil del migrador): acepta `\\` dentro de un literal '…' — con
    standard_conforming_strings = on (el default de Postgres) es un carácter más; quien aplica lo verifica antes."""
    toks: list[Token] = []
    probs: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        c = sql[i]
        if c.isspace():
            i += 1
            continue
        if sql.startswith('--', i):                       # comentario de línea: hasta el fin de línea
            j = sql.find('\n', i)
            i = n if j < 0 else j + 1
            continue
        if sql.startswith('/*', i):                       # comentario de bloque, anidado como en Postgres
            prof, j = 1, i + 2
            while j < n and prof:
                if sql.startswith('/*', j):
                    prof += 1; j += 2
                elif sql.startswith('*/', j):
                    prof -= 1; j += 2
                else:
                    j += 1
            if prof:
                return toks, probs + ['comentario /* … */ sin cerrar']
            i = j
            continue
        if c in 'eE' and i + 1 < n and sql[i + 1] == "'":   # E'…': la barra escapa el carácter siguiente
            j = i + 2
            while True:
                if j >= n:
                    return toks, probs + ['literal E\'…\' sin cerrar']
                if sql[j] == '\\':
                    j += 2
                    continue
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            toks.append(('s', sql[i + 2:j]))
            i = j + 1
            continue
        if c == "'":                                      # literal estándar: '' es una comilla
            j = i + 1
            while True:
                k = sql.find("'", j)
                if k < 0:
                    return toks, probs + ['literal \'…\' sin cerrar']
                if k + 1 < n and sql[k + 1] == "'":
                    j = k + 2
                    continue
                break
            cuerpo = sql[i + 1:k]
            if '\\' in cuerpo:
                # Con standard_conforming_strings apagado la barra escaparía la comilla y el servidor leería otro SQL.
                if not barra_en_literal:
                    probs.append('barra invertida dentro de un literal \'…\' (el servidor lo podría leer distinto)')
            toks.append(('s', cuerpo.replace("''", "'")))
            i = k + 1
            continue
        if c == '"':                                      # identificador entre comillas: "" es una comilla
            j = i + 1
            while True:
                k = sql.find('"', j)
                if k < 0:
                    return toks, probs + ['identificador "…" sin cerrar']
                if k + 1 < n and sql[k + 1] == '"':
                    j = k + 2
                    continue
                break
            toks.append(('q', sql[i + 1:k].replace('""', '"')))
            i = k + 1
            continue
        if c == '$':
            m = RE_DOLAR.match(sql, i)
            if m:
                tag = m.group(0)
                k = sql.find(tag, m.end())
                if k < 0:
                    return toks, probs + ['dollar-quote sin cerrar']
                toks.append(('d', sql[m.end():k]))
                i = k + len(tag)
                continue
            if i + 1 < n and sql[i + 1].isdigit():
                probs.append('parámetro posicional ($n) no permitido')
                i += 1
                while i < n and sql[i].isdigit():
                    i += 1
                continue
            probs.append('signo $ suelto')
            i += 1
            continue
        m = RE_PALABRA.match(sql, i)
        if m:
            toks.append(('w', m.group(0).lower()))
            i = m.end()
            continue
        m = RE_NUMERO.match(sql, i)
        if m:
            toks.append(('n', m.group(0)))
            i = m.end()
            continue
        if c == '\\':
            probs.append('barra invertida fuera de un literal (comando de psql)')
            i += 1
            continue
        if c == ':' and i + 1 < n and sql[i + 1] == '=':
            toks.append(('p', ':='))
            i += 2
            continue
        toks.append(('p', c))
        i += 1
    return toks, probs


def partir(toks: list[Token]) -> tuple[list[list[Token]], list[str]]:
    """Sentencias por «;» fuera de paréntesis y corchetes."""
    out: list[list[Token]] = []
    actual: list[Token] = []
    prof = 0
    probs: list[str] = []
    for t in toks:
        if t in (('p', '('), ('p', '[')):
            prof += 1
        elif t in (('p', ')'), ('p', ']')):
            prof -= 1
            if prof < 0:
                probs.append('paréntesis de cierre de más')
                prof = 0
        if t == ('p', ';') and prof == 0:
            if actual:
                out.append(actual)
            actual = []
        else:
            actual.append(t)
    if prof:
        probs.append('paréntesis sin cerrar')
    if actual:
        out.append(actual)
    return out, probs


# ── Reglas ───────────────────────────────────────────────────────────────────
def _prohibidas(toks: list[Token], pre: str, tambien: frozenset = frozenset(), excepto: frozenset = frozenset()) -> list[str]:
    out = []
    for tipo, v in toks:
        if tipo not in ('w', 'q'):
            continue
        v = v.lower()
        if v in excepto:
            continue
        if v in PROHIBIDAS or v in tambien or v.startswith(PREFIJOS_PROHIBIDOS):
            out.append(f'{pre}: palabra prohibida «{v}»')
    return out


def _llamadas(toks: list[Token], pre: str, permitidas: frozenset | set) -> list[str]:
    """(Grok 114) Toda `palabra(` o `esquema.palabra(` que no sea palabra clave ni la lista de columnas de un alias
    (`… as j(a int)` / `…) j(a int)`) es una LLAMADA y tiene que estar en `permitidas`. Un identificador entre comillas
    nunca es palabra clave: `"values"(…)` es una llamada."""
    out = []
    for i, t in enumerate(toks):
        if t[0] not in ('w', 'q') or i + 1 >= len(toks) or toks[i + 1] != ('p', '('):
            continue
        prev = toks[i - 1] if i else None
        if t[0] == 'w' and t[1] in NO_LLAMADA:
            continue
        if prev in (('w', 'as'), ('p', ')')):              # alias con su lista de columnas
            continue
        nombre = t[1]
        if prev == ('p', '.') and i >= 2 and toks[i - 2][0] in ('w', 'q'):
            nombre = f'{toks[i - 2][1]}.{nombre}'
        if nombre not in permitidas and nombre not in CONSTRUCCIONES:
            out.append(f'{pre}: llamada a una función fuera de la lista blanca («{nombre}»)')
    return out


def _nombre(t: Token) -> str:
    return t[1] if t[0] == 'q' else '«literal»' if t[0] in ('s', 'd') else t[1]


def _set(s: list[Token], pre: str) -> list[str]:
    ok = (len(s) == 5 and s[1] == ('w', 'local') and s[2][0] == 'w' and s[2][1] in SET_PERMITIDOS
          and s[3] in (('p', '='), ('w', 'to')) and s[4][0] == 's')
    if ok:
        return []
    que = s[2][1] if len(s) > 2 and s[1] == ('w', 'local') and s[2][0] in ('w', 'q') else None
    return [f'{pre}: set no permitido' + (f' («{que}»)' if que else '')
            + ' (solo set local lock_timeout / statement_timeout = \'…\')']


def _insert(s: list[Token], pre: str, permitidas: set[str], extra: str | None, altas: list[int],
            excepto: frozenset = frozenset(), funciones: frozenset | set = frozenset()) -> list[str]:
    if len(s) < 6 or s[1] != ('w', 'into'):
        return [f'{pre}: insert mal formado']
    a = s[2]
    if a[0] not in ('w', 'q') or s[3] != ('p', '.') or s[4][0] not in ('w', 'q'):
        return [f'{pre}: insert sin esquema (se exige public.<tabla>)']
    tabla = f'{a[1]}.{s[4][1]}'                           # palabras ya en minúsculas; "…" tal cual (como Postgres)
    if tabla not in permitidas:
        if extra == 'alta_ficticios' and tabla == 'public.club_miembros' and not altas:
            altas.append(1)
        else:
            return [f'{pre}: insert en una tabla no permitida ({tabla})']
    resto = s[5:]
    if resto and resto[0] == ('p', '('):
        j = 1
        while j < len(resto) and resto[j] != ('p', ')'):
            if resto[j][0] not in ('w', 'q') and resto[j] != ('p', ','):
                return [f'{pre}: lista de columnas mal formada']
            j += 1
        if j >= len(resto):
            return [f'{pre}: lista de columnas sin cerrar']
        resto = resto[j + 1:]
    if not resto or resto[0] not in (('w', 'select'), ('w', 'values')):
        return [f'{pre}: el insert tiene que seguir con select o values']
    out = _prohibidas(resto, pre, frozenset({'into'}), excepto) + _llamadas(resto, pre, funciones)
    # `on conflict` solo como `on conflict do nothing` (un `do update` ya cae por «update»)
    for i, t in enumerate(resto):
        if t == ('w', 'conflict') and resto[i + 1:i + 3] != [('w', 'do'), ('w', 'nothing')]:
            out.append(f'{pre}: on conflict solo con do nothing')
    return out


def _hasta_then(r: list[Token]) -> int | None:
    prof = casos = 0
    for i, t in enumerate(r):
        if t == ('p', '('):
            prof += 1
        elif t == ('p', ')'):
            prof -= 1
        elif prof == 0 and t == ('w', 'case'):
            casos += 1
        elif prof == 0 and t == ('w', 'end') and casos:
            casos -= 1
        elif prof == 0 and casos == 0 and t == ('w', 'then'):
            return i
    return None


def _sin_into(r: list[Token], pre: str) -> list[str]:
    return [f'{pre}: «into» fuera de un select … into <variables>'] if ('w', 'into') in r else []


def _plpgsql(cuerpo: str, pre: str, con_for: bool = False, funciones: frozenset | set = frozenset()) -> list[str]:
    """Lista blanca del cuerpo de un `do`: declare de variables, begin, end, if/elsif/else … then, raise exception '…',
    select … into <variables declaradas>, <variable> := …, null. Con `con_for` (perfil del migrador), además
    `for <variable declarada> in select … loop` … `end loop`."""
    toks, probs = tokenizar(cuerpo)
    if probs:
        return [f'{pre} (cuerpo del do): {p}' for p in probs]
    probs = _prohibidas(toks, pre) + _llamadas(toks, pre, funciones)
    trozos, p2 = partir(toks)
    probs += [f'{pre} (cuerpo del do): {p}' for p in p2]
    declarando = False
    variables: set[str] = set()

    def sentencia(r: list[Token]) -> list[str]:
        nonlocal declarando
        while r:
            w = r[0]
            if w == ('w', 'declare'):
                declarando = True; r = r[1:]; continue
            if w == ('w', 'begin'):
                declarando = False; r = r[1:]; continue
            if declarando:
                if w[0] != 'w' or w[1] in PROHIBIDAS:
                    return [f'{pre}: declaración mal formada']
                variables.add(w[1])
                return _sin_into(r[1:], pre)
            if w in (('w', 'if'), ('w', 'elsif')):
                k = _hasta_then(r)
                if k is None:
                    return [f'{pre}: if sin then']
                malos = _sin_into(r[1:k], pre)
                if malos:
                    return malos
                r = r[k + 1:]
                continue
            if w == ('w', 'else'):
                r = r[1:]; continue
            if con_for and w == ('w', 'for'):
                if len(r) < 4 or r[1][0] != 'w' or r[1][1] not in variables or r[2] != ('w', 'in') or r[3] != ('w', 'select'):
                    return [f'{pre}: solo for <variable declarada> in select … loop']
                if ('w', 'loop') not in r:
                    return [f'{pre}: for sin loop']
                k = r.index(('w', 'loop'))
                malos = _sin_into(r[4:k], pre)
                if malos:
                    return malos
                r = r[k + 1:]
                continue
            if w == ('w', 'end'):
                fines = ([], [('w', 'if')]) + (([('w', 'loop')],) if con_for else ())
                return [] if r[1:] in fines else [f'{pre}: end mal formado']
            if w == ('w', 'raise'):
                if len(r) < 3 or r[1] != ('w', 'exception') or r[2][0] != 's':
                    return [f'{pre}: solo se permite raise exception \'…\'']
                return _sin_into(r[3:], pre)
            if w == ('w', 'null') and len(r) == 1:
                return []
            if w == ('w', 'select'):
                return _select_into(r)
            if w[0] == 'w' and len(r) > 1 and r[1] == ('p', ':='):
                if w[1] not in variables:
                    return [f'{pre}: asignación a una variable no declarada ({w[1]})']
                return _sin_into(r[2:], pre)
            return [f'{pre}: sentencia no permitida dentro del do (empieza con «{_nombre(w)}»)']
        return []

    def _select_into(r: list[Token]) -> list[str]:
        prof, pos = 0, []
        for i, t in enumerate(r):
            if t == ('p', '('):
                prof += 1
            elif t == ('p', ')'):
                prof -= 1
            elif t == ('w', 'into'):
                if prof:
                    return [f'{pre}: «into» dentro de una subconsulta']
                pos.append(i)
        if len(pos) != 1 or pos[0] < 2:
            return [f'{pre}: select dentro del do sin un único «into <variables>»']
        j = pos[0] + 1
        while True:
            if j >= len(r) or r[j][0] != 'w' or r[j][1] not in variables:
                return [f'{pre}: select … into a algo que no es una variable declarada']
            j += 1
            if j < len(r) and r[j] == ('p', ','):
                j += 1
                continue
            break
        if j < len(r) and r[j] != ('w', 'from'):
            return [f'{pre}: después de «into <variables>» va «from»']
        return []

    for t in trozos:
        probs += sentencia(t)
    return probs


def _do(s: list[Token], pre: str, con_for: bool = False, funciones: frozenset | set = frozenset()) -> list[str]:
    resto = s[1:]
    lang = [('w', 'language'), ('w', 'plpgsql')]
    if resto[:2] == lang:
        resto = resto[2:]
    elif resto[1:] == lang:
        resto = resto[:1]
    if len(resto) != 1:
        return [f'{pre}: do mal formado (solo do $tag$ … $tag$ [language plpgsql])']
    if resto[0][0] != 'd':
        return [f'{pre}: el cuerpo del do tiene que ir entre $tag$ … $tag$']
    return _plpgsql(resto[0][1], pre, con_for, funciones)


def _lock(s: list[Token], pre: str, permitidas: set[str]) -> list[str]:
    """(09-nov, Grok 109) Solo `lock table public.<tabla permitida> in exclusive mode`, tal cual."""
    if (len(s) == 8 and s[1] == ('w', 'table') and s[2][0] in ('w', 'q') and s[3] == ('p', '.') and s[4][0] in ('w', 'q')
            and s[5:] == [('w', 'in'), ('w', 'exclusive'), ('w', 'mode')] and f'{s[2][1]}.{s[4][1]}' in permitidas):
        return []
    return [f'{pre}: lock no permitido (solo lock table <tabla de la carga> in exclusive mode)']


def revisar(sql: str, permitir_insert_en: tuple[str, ...] = ('public.club_movimientos', 'public.club_cargas_papel'),
            permitir_extra: str | None = None,
            permitir_lock: tuple[str, ...] = ('public.club_cargas_papel',)) -> list[str]:
    """Problemas del archivo; vacío = pasa. `permitir_extra='alta_ficticios'` admite además UN insert en
    public.club_miembros (solo el ensayo de staging con anfitriones ficticios). (09-nov, Grok 109) la carga de papel
    registra su lote en public.club_cargas_papel y toma un lock exclusivo de esa tabla antes de mirar la línea de base."""
    if permitir_extra not in EXTRAS:
        raise ValueError(f'permitir_extra desconocido: {permitir_extra!r}')
    toks, probs = tokenizar(sql)
    if probs:
        return probs
    sentencias, probs = partir(toks)
    if not sentencias:
        return probs + ['archivo vacío']
    permitidas = {t.lower() for t in permitir_insert_en}
    funciones = INMUTABLES | set(EXCEPCIONES_G56)
    altas: list[int] = []
    ultima = len(sentencias)
    for k, s in enumerate(sentencias, 1):
        pre = f'sentencia {k}'
        w = s[0]
        if len(s) == 1 and w in (('w', 'begin'), ('w', 'commit'), ('w', 'rollback')):
            if (w == ('w', 'begin')) != (k == 1) or (w != ('w', 'begin') and k != ultima):
                probs.append(f'{pre}: {w[1]} fuera de lugar (una sola transacción: begin al principio, commit o rollback al final)')
            continue
        if w == ('w', 'set'):
            probs += _set(s, pre)
        elif w == ('w', 'do'):
            probs += _do(s, pre, funciones=funciones)
        elif w == ('w', 'insert'):
            probs += _insert(s, pre, permitidas, permitir_extra, altas, funciones=funciones)
        elif w == ('w', 'lock'):
            probs += _lock(s, pre, {t.lower() for t in permitir_lock})
        else:
            probs.append(f'{pre}: sentencia no permitida (empieza con «{_nombre(w)}»)')
            probs += _prohibidas(s, pre)
    if sentencias[0] != [('w', 'begin')]:
        probs.append('el archivo no empieza con begin')
    if sentencias[-1] not in ([('w', 'commit')], [('w', 'rollback')]):
        probs.append('el archivo no termina con commit o rollback')
    return probs


# ── Perfil del MIGRADOR (09-nov, punto 4): la primera carga del lanzamiento ─────────────────────────────────────
# Lista cerrada propia: el SQL de `migrar_firestore.sql_apply(..., primera=True)` usa tablas temporales para pasar el
# export como UN literal jsonb y para validar adentro de la transacción. Se permite SOLO esto:
#   begin · set local statement_timeout|lock_timeout = '…' · do $tag$…$tag$ (lo de siempre + for … in select … loop)
#   · create temp table _<nombre> [(columnas)] on commit drop [as select|with …]   (sin esquema, empieza con «_»)
#   · insert into public.<tabla del migrador> (…) select|values … [on conflict do nothing]
#   · lock table public.club_cargas_papel in exclusive mode   (cuando entra el papel en la misma transacción)
#   · select <columna> from _<temporal>   (la lectura final de la validación) · commit|rollback al final.
# Ningún delete, truncate, update, alter, drop, execute, set de otra cosa (ni club.libro_mantenimiento), etc.
# Excepción documentada: la validación lee TRES catálogos de solo lectura (pg_class, pg_namespace, pg_policies) para el
# barrido de permisos de anon; el resto de pg_* sigue prohibido. El modo de STAGING del migrador (--apply, con deletes)
# NO pasa por este filtro: no es para prod y el script se niega a usarlo fuera de staging.
TABLAS_MIGRADOR = ('public.club_negocios', 'public.club_miembros', 'public.club_miembros_contacto', 'public.club_movimientos',
                   'public.club_pm_cargos', 'public.club_pm_pagos', 'public.club_cargas_papel')
CATALOGOS_LECTURA = frozenset({'pg_class', 'pg_namespace', 'pg_policies'})


def _create_temp(s: list[Token], pre: str, funciones: frozenset | set = frozenset()) -> list[str]:
    if len(s) < 7 or s[1] not in (('w', 'temp'), ('w', 'temporary')) or s[2] != ('w', 'table'):
        return [f'{pre}: create solo como create temp table (nada permanente)']
    if s[3][0] != 'w' or not s[3][1].startswith('_') or s[4] == ('p', '.'):
        return [f'{pre}: la temporal va sin esquema y con nombre que empieza con «_»']
    resto = s[4:]
    if resto[0] == ('p', '('):
        prof, j = 0, 0
        for j, t in enumerate(resto):
            if t[0] not in ('w', 'p') or (t[0] == 'p' and t[1] not in '(),[]'):
                return [f'{pre}: lista de columnas de la temporal mal formada']
            if t == ('p', '('):
                prof += 1
            elif t == ('p', ')'):
                prof -= 1
                if prof == 0:
                    break
        out = _prohibidas(resto[:j + 1], pre)
        if out:
            return out
        resto = resto[j + 1:]
    if resto[:3] != [('w', 'on'), ('w', 'commit'), ('w', 'drop')]:
        return [f'{pre}: la temporal tiene que ser on commit drop']
    resto = resto[3:]
    if not resto:
        return []
    if resto[0] != ('w', 'as') or len(resto) < 2 or resto[1] not in (('w', 'select'), ('w', 'with')):
        return [f'{pre}: la temporal se llena solo con as select|with …']
    return _prohibidas(resto[1:], pre, frozenset({'into'}), CATALOGOS_LECTURA) + _llamadas(resto[1:], pre, funciones)


def revisar_migrador(sql: str, papel: bool = True) -> list[str]:
    """Problemas del SQL de la PRIMERA CARGA del migrador (vacío = pasa). `papel` = admite la carga de papel en la misma
    transacción (su lock, su registro en club_cargas_papel). Las barras invertidas en literales '…' se aceptan (las
    regex de la normalización y del barrido): quien aplica exige standard_conforming_strings = on en el servidor."""
    toks, probs = tokenizar(sql, barra_en_literal=True)
    if probs:
        return probs
    sentencias, probs = partir(toks)
    if not sentencias:
        return probs + ['archivo vacío']
    permitidas = set(TABLAS_MIGRADOR if papel else TABLAS_MIGRADOR[:-1])
    funciones = INMUTABLES | set(EXCEPCIONES_MIGRADOR)
    ultima = len(sentencias)
    for k, s in enumerate(sentencias, 1):
        pre = f'sentencia {k}'
        w = s[0]
        if len(s) == 1 and w in (('w', 'begin'), ('w', 'commit'), ('w', 'rollback')):
            if (w == ('w', 'begin')) != (k == 1) or (w != ('w', 'begin') and k != ultima):
                probs.append(f'{pre}: {w[1]} fuera de lugar (una sola transacción: begin al principio, commit o rollback al final)')
            continue
        if w == ('w', 'set'):
            probs += _set(s, pre)
        elif w == ('w', 'do'):
            probs += _do(s, pre, con_for=True, funciones=funciones)
        elif w == ('w', 'insert'):
            probs += _insert(s, pre, permitidas, None, [], CATALOGOS_LECTURA, funciones)
        elif w == ('w', 'create'):
            probs += _create_temp(s, pre, funciones)
        elif w == ('w', 'lock'):
            probs += _lock(s, pre, {'public.club_cargas_papel'} if papel else set())
        elif w == ('w', 'select'):
            if not (len(s) == 4 and s[1][0] == 'w' and s[2] == ('w', 'from') and s[3][0] == 'w' and s[3][1].startswith('_')):
                probs.append(f'{pre}: el único select suelto es «select <columna> from _<temporal>»')
            probs += _prohibidas(s, pre)
        else:
            probs.append(f'{pre}: sentencia no permitida (empieza con «{_nombre(w)}»)')
            probs += _prohibidas(s, pre)
    if sentencias[0] != [('w', 'begin')]:
        probs.append('el archivo no empieza con begin')
    if sentencias[-1] not in ([('w', 'commit')], [('w', 'rollback')]):
        probs.append('el archivo no termina con commit o rollback')
    return probs
