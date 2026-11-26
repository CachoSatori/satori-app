#!/usr/bin/env python3
"""
Arma scripts/sql/202_pruebas.sql (pos_familia_nombre_guardar): llena los marcadores con el cuerpo de la 202 y el de su
vuelta atrás, todo en una transacción que termina en ROLLBACK.

  python3 scripts/sql/202_pruebas.py --armar [--local] [--mutar NOMBRE] [--compacto]   # imprime el SQL armado (MCP / editor)
  python3 scripts/sql/202_pruebas.py --psql "<conexión>" [--local] [--mutar todas | NOMBRE]   # corre con psql y dice si muerde
  python3 scripts/sql/202_pruebas.py --lista                                   # mutaciones y los casos que tienen que caer

--local: suma scripts/sql/202_preludio_local.sql (Postgres 16 vacío armado con scripts/sql/local_armar_base.sh).
--mutar todas: corre primero SIN mutar (tiene que dar 0 fallas) y después cada mutación; sale 1 si alguna no muerde.

Corre en STAGING (ref hwiatgic…) o en un Postgres local descartable. Nunca contra PROD (ref yiczgdti…): la batería crea
usuarios, un local y familias ficticias dentro de la transacción descartada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/202_pos_familia_nombre.sql'
ROLLBACK = RAIZ / 'scripts/sql/202_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/202_pruebas.sql'
PRELUDIO = RAIZ / 'scripts/sql/202_preludio_local.sql'

CHARS = "  if v_nom !~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ ().,/&''+#-]+$' then"
ROL = "  if v_rol is distinct from 'owner' then"

# nombre → ([(texto de la 202, reemplazo)], casos que tienen que caer)
MUTACIONES: dict[str, tuple[list[tuple[str, str]], set[str]]] = {
    'sin_rol': ([(ROL, "  if false then")], {'07', '08', '09', '10'}),
    'manager_pasa': ([(ROL, "  if v_rol is null or v_rol not in ('owner', 'manager') then")], {'07'}),
    'contador_pasa': ([(ROL, "  if v_rol is null or v_rol not in ('owner', 'contador') then")], {'08'}),
    'sin_largo': ([("  if char_length(v_nom) > 40 then", "  if false then")], {'14'}),
    'sin_caracteres': ([(CHARS, "  if false then")], {'15'}),
    'caracteres_de_mas': ([(CHARS, "  if v_nom !~ '^[^<>;]+$' then")], {'15'}),
    'sin_normalizar': ([("  v_nom text := regexp_replace(btrim(coalesce(p_nombre, '')), '\\s+', ' ', 'g');",
                         "  v_nom text := coalesce(p_nombre, '');")], {'01', '13'}),
    # El vacío lo frenan dos cosas (el chequeo y el «+» de la lista): se rompen las dos; el `check` de la tabla lo para
    # igual, pero con otro código (23514), así que el caso 13 cae.
    'sin_vacio': ([("  if p_local is null or p_familia is null or v_nom = '' then",
                    "  if p_local is null or p_familia is null then"),
                   (CHARS, CHARS.replace("#-]+$'", "#-]*$'"))], {'13'}),
    'crea_familia': ([("    raise exception 'Familia desconocida en este local' using errcode = '22023';",
                       "    insert into public.pos_familias (local, familia, nombre, categoria) values (p_local, p_familia, v_nom, 'otros');")], {'16'}),
    'toca_orden': ([("  update public.pos_familias f set nombre = v_nom\n", "  update public.pos_familias f set nombre = v_nom, orden = 0\n")], {'02'}),
    'toca_todas': ([("   where f.local = p_local and f.familia = p_familia;", "   where f.local = p_local;")], {'02'}),
    'anon_ejecuta': ([("revoke all on function public.pos_familia_nombre_guardar(text, integer, text) from public, anon;",
                       "grant execute on function public.pos_familia_nombre_guardar(text, integer, text) to anon;")], {'11'}),
    'sin_search_path': ([("set search_path = public, pg_temp\nas $function$", "as $function$")], {'18'}),
    'sin_definer': ([("volatile\nsecurity definer\n", "volatile\n")], {'18'}),
    'sin_guarda': ([("  if to_regprocedure('public.pos_familia_nombre_guardar(text,integer,text)') is not null then",
                     "  if false then")], {'19'}),   # se rompe también en el texto que se vuelve a correr (caso 19)
}

def cuerpo(mutar: str | None) -> str:
    s = MIG.read_text()
    if mutar:
        for viejo, nuevo in MUTACIONES[mutar][0]:
            if s.count(viejo) != 1:
                sys.exit(f'mutación {mutar}: el ancla aparece {s.count(viejo)} veces (tiene que ser 1)')
            s = s.replace(viejo, nuevo)
    return s


def armar(mutar: str | None = None, compacto: bool = False, local: bool = False) -> str:
    b = BATERIA.read_text()
    for m in ('-- @@202@@', '-- @@202_texto@@', '-- @@202_rollback@@', '-- @@preludio@@'):
        if b.count(m) != 1:
            sys.exit(f'marcador {m}: aparece {b.count(m)} veces')
    original = cuerpo(mutar) if mutar == 'sin_guarda' else MIG.read_text()
    if '$m202$' in original:
        sys.exit('la 202 no puede contener $m202$ (se usa para meterla como texto)')
    b = b.replace('-- @@preludio@@', PRELUDIO.read_text() if local else '')
    b = b.replace('-- @@202@@', cuerpo(mutar)).replace('-- @@202_texto@@', original).replace('-- @@202_rollback@@', ROLLBACK.read_text())
    if compacto:
        b = '\n'.join(l.strip() for l in b.splitlines() if l.strip() and not l.strip().startswith('--'))
    return b


def resultado(salida: str) -> dict | None:
    """El json de la batería, o None si la corrida no llegó al final (un error abortó la transacción)."""
    m = re.search(r'\{"ok".*\}', salida)
    return json.loads(m.group(0)) if m else None


def main(argv: list[str]) -> int:
    mutar = argv[argv.index('--mutar') + 1] if '--mutar' in argv else None
    if '--lista' in argv:
        for k, (_, caen) in MUTACIONES.items():
            print(k, '→', ', '.join(sorted(caen)) or '(sin caso propio, ver nota)')
        return 0
    if '--armar' in argv:
        print(armar(mutar, '--compacto' in argv, '--local' in argv))
        return 0
    if '--psql' in argv:
        con = argv[argv.index('--psql') + 1]
        if 'yiczgdti' in con:
            sys.exit('NUNCA contra PROD')
        nombres = [None, *MUTACIONES] if mutar == 'todas' else ([mutar] if mutar else [None])
        malo = 0
        for n in nombres:
            sql = armar(n, local='--local' in argv)
            out = subprocess.run(['psql', con, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
            r = resultado(out.stdout + out.stderr)
            if r is None:   # no se corta la lista: se reporta y sigue con la próxima
                err = [l for l in (out.stdout + out.stderr).splitlines() if 'ERROR' in l][:1]
                print(f"{n or 'sin mutar'}: ERROR, la batería no terminó ({err[0][:200] if err else 'sin salida'})")
                malo = 1
                continue
            caidos = {f[0] for f in (r.get('fallaron') or [])}
            if n is None:
                print(f"sin mutar: ok={r['ok']} fallas={r['fallas']}")
                malo |= r['fallas'] != 0
            else:
                esperados = MUTACIONES[n][1]
                muerde = bool(esperados) and esperados <= caidos
                print(f"{n}: caen {sorted(caidos)} (esperados {sorted(esperados)}) → {'MUERDE' if muerde else 'NO MUERDE'}")
                malo |= not muerde
        return 1 if malo else 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
