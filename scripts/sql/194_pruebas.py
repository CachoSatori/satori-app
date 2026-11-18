#!/usr/bin/env python3
"""
Arma (y opcionalmente corre) scripts/sql/194_pruebas.sql: llena los marcadores con el cuerpo de la 191 (si la base no
la tiene, la 194 la necesita), el de la 194 y el de su rollback, todo dentro de una transacción que termina en ROLLBACK.

  python3 scripts/sql/194_pruebas.py --armar [--compacto] [--sin-drops] [--mutar X|todas]  # imprime el SQL
  python3 scripts/sql/194_pruebas.py --local "<dsn>" [--mutar todas]  # psql contra un Postgres LOCAL (nunca prod)

--sin-drops: para staging por el conector (cancela los `drop` de la vuelta atrás; el caso 09 queda NO PROBADO).

En staging se corre pegando el SQL armado en una sola consulta (termina en ROLLBACK). Cada mutación rompe el arreglo
a propósito: los casos de su lista TIENEN que caer.
"""
from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
# Las que la 194 necesita debajo (en orden) y la función que dice si ya están.
PREVIAS = [
    ('190_pos_ventas_resumen.sql', 'public.pos_ventas_resumen(text,date,date)'),
    ('191_pos_ventas_solo_lo_suyo.sql', 'public.pos_mis_logins()'),
    ('192_propinas_cada_uno_lo_suyo.sql', 'public.propinas_mis_empleados()'),
]
MIG = RAIZ / 'supabase/migrations/194_mi_rendimiento_equipo.sql'
ROLLBACK = RAIZ / 'scripts/sql/194_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/194_pruebas.sql'

# nombre → ([(texto de la 194, reemplazo, veces)], prefijos de casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # sin umbral anti-identificación (K = 1): con 2 personas sale el «general» y el equipo
    'sin_k': ([('k_min constant integer := 4;', 'k_min constant integer := 1;', 2)], {'04 chico: sin posición', '04b tres', '07 comp 3'}),
    # el año pasado corrido 365 días (deja de coincidir el día de semana)
    'corrido_365': ([('pos_rend_base(p_local, p_desde - 364, p_hasta - 364)', 'pos_rend_base(p_local, p_desde - 365, p_hasta - 365)', 1),
                     ("'desde', p_desde - 364, 'hasta', p_hasta - 364", "'desde', p_desde - 365, 'hasta', p_hasta - 365", 1)],
                    {'02 yo: año pasado'}),
    # el personal sin ventas en el período igual recibe los agregados
    'sin_ventas_ve': ([("    when not v_gerencia and not coalesce(c.soy, false) then\n", "    when false then\n", 1)],
                      {'05 sin ventas'}),
    # la familia 17 (cortesías) vuelve a contar como venta
    'neta_con_17': ([("(where l.familia is null or l.familia not in (6, 17, 20))", "(where true)", 1)], {'02 yo: general'}),
    # cualquier rol (cajero incluido) puede pedir
    'sin_rol': ([("  if v_rol is null or v_rol not in ('owner', 'contador', 'manager', 'salonero', 'barman', 'barback', 'runner', 'cocina') then\n",
                  "  if v_rol is null then\n", 1)], {'06 cajero', '07 comp: cajero'}),
    # el manager pide cualquier local
    'locales_libres': ([("  if v_rol not in ('owner', 'contador') and not (p_local = any (public.mis_locales())) then\n",
                         "  if false then\n", 1)], {'06 manager de otro local', '06 salonero de otro local'}),
    # el control de local solo para el manager (como estaba antes del verificador)
    'personal_sin_local': ([("  if v_rol not in ('owner', 'contador') and not (p_local = any (public.mis_locales())) then\n",
                             "  if v_rol = 'manager' and not (p_local = any (public.mis_locales())) then\n", 1)],
                           {'06 salonero de otro local'}),
    # el ICP del equipo vuelve a esconderse con menos de K (decisión B: siempre)
    'icp_con_k': ([("'icp_equipo', (select case when g.total > 0 then round(t.gen / g.total * 100, 1) end from gen g, tips t))",
                    "'icp_equipo', case when c.n >= k_min then (select case when g.total > 0 then round(t.gen / g.total * 100, 1) end from gen g, tips t) end)", 1)],
                  {'04 chico: ICP del equipo siempre'}),
    # cuántas personas sale aunque sean menos de K
    'personas_sin_k': ([("'personas', case when c.n >= k_min then c.n end,", "'personas', c.n,", 1)], {'04b tres: personas'}),
    # sin el multiplicador de las bebidas clasificadas a mano
    'sin_multiplicador': ([("case when coalesce(adj.q, 0) <> 0 then adj.q else por.ibeb end", "por.ibeb", 1)],
                          {'02 yo: mi posición', '02 yo: promedio'}),
    # el delivery cuenta como salón en la venta por persona (D4)
    'delivery_en_salon': ([("sum(b.total - b.delivery) as salon,", "sum(b.total) as salon,", 1)], {'02 yo: mediana'}),
    # sin el alias de personas (266 deja de ser 038)
    'sin_alias': ([("    ('266',  '038',  null::date, null::date)\n", "    ('266',  '266',  null::date, null::date)\n", 1)],
                  {'01 clave: alias 266'}),
    # la función interna queda abierta a la API
    'base_abierta': ([("revoke all on function public.pos_rend_base(text, date, date) from public, anon, authenticated;",
                       "grant execute on function public.pos_rend_base(text, date, date) to authenticated;", 1)],
                     {'06 interna base'}),
}


def _espacios(txt: str) -> str:
    """Junta los espacios repetidos FUERA de los literales '…' (el SQL armado entra en una sola consulta)."""
    out, en_lit, prev = [], False, ''
    for ch in txt:
        if ch == "'":
            en_lit = not en_lit
        if ch == ' ' and prev == ' ' and not en_lit:
            continue
        out.append(ch); prev = ch
    return ''.join(out)


def _norm(txt: str) -> str:
    """Sin sangría, sin líneas vacías ni de comentario y sin espacios repetidos: así el texto guardado y las anclas de
    las mutaciones coinciden aunque el SQL armado se compacte."""
    return _espacios('\n'.join(l.strip() for l in txt.split('\n') if l.strip() and not l.lstrip().startswith('--'))) + '\n'


def _sin_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(mutar: str | None, todas: bool = False, sin_drops: bool = False, paridad: str | None = None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        for viejo, nuevo, veces in MUTACIONES[mutar][0]:
            if mig.count(viejo) != veces:
                sys.exit(f'mutación {mutar}: el ancla aparece {mig.count(viejo)} veces (se esperaban {veces})')
            mig = mig.replace(viejo, nuevo)
    bat = BATERIA.read_text(encoding='utf-8')
    for marca in ('-- @@191@@', '-- @@194@@', '-- @@194G@@', '-- @@194R@@', '-- @@MUTACIONES@@'):
        if bat.count(marca) != 1:
            sys.exit(f'falta el marcador {marca}')
    # Staging puede no tener 190–192 (al 18-nov está en 188): se aplican antes, TAL CUAL, en la misma transacción,
    # cada una solo si falta (la 191 trae su guarda md5 de la 067 y la 192 la de las policies de tip_entries).
    previas = []
    for archivo, sonda in PREVIAS:
        cuerpo = _norm(_sin_beg_com((RAIZ / 'supabase/migrations' / archivo).read_text(encoding='utf-8')))
        tag = '$c' + archivo[:3] + '$'
        if tag in cuerpo:
            sys.exit(f'{archivo} contiene {tag}')
        if sin_drops and archivo.startswith('192_'):
            # El conector de staging cancela cualquier `drop`: el `drop policy` + `create policy` de la 192 se cambia por
            # un `alter policy` de la vieja al MISMO predicado (RLS equivalente; el nombre de la policy queda el viejo).
            viejo = ('drop policy "Todos ven entradas de propinas" on public.tip_entries;\n'
                     'create policy tip_entries_lee_gestion on public.tip_entries\nfor select to authenticated\nusing (')
            if cuerpo.count(viejo) != 1:
                sys.exit('192: no encuentro el drop/create policy para el modo --sin-drops')
            cuerpo = cuerpo.replace(viejo, 'alter policy "Todos ven entradas de propinas" on public.tip_entries\nto authenticated\nusing (')
        previas.append(f"do $si$ begin if to_regprocedure('{sonda}') is null then execute {tag}{cuerpo}{tag}; end if; end $si$;")
    bat = bat.replace('-- @@191@@', '\n'.join(previas))
    # La 194 (mutada o no) viaja UNA vez, como texto en una tabla temporal, y se aplica con execute.
    # La guarda R13 de la 194 corre UNA vez, tal cual; el texto que se reaplica (mutaciones) va sin ella.
    i = mig.index('do $guarda194$'); j = mig.index('$guarda194$;', i) + len('$guarda194$;')
    guarda, sin_guarda = mig[i:j], mig[:i] + mig[j:]
    bat = bat.replace('-- @@194G@@', 'execute ' + '$q$' + _norm(guarda.replace('$guarda194$', '$g$')).rstrip().rstrip(';') + '$q$;')
    bat = bat.replace('-- @@194@@', _norm(guarda) + "create temp table _m194 on commit drop as select $m194$" + _norm(_sin_beg_com(sin_guarda))
                      + "$m194$::text as sql;\ndo $x$ declare q text; begin select m.sql into q from _m194 m; execute q; end $x$;")
    # Con --paridad <archivo>: la fixture de `equipo194.fixture.ts` (SQL que imprime su prueba con PARIDAD194_SQL=1)
    # se carga en el local `paridad194` y la salida de la función, como un salonero ficticio con login p1, va como un
    # caso más («paridad: salida», ok) con el JSON en el detalle: es lo que se copia a `equipo194.staging.json`.
    if paridad:
        fx = Path(paridad).read_text(encoding='utf-8')
        bloque = (
            "insert into public.locations (id, name) values ('paridad194', 'Local Paridad 194') on conflict (id) do nothing;\n"
            "insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8194-0000000000f1', '{\"full_name\":\"Persona Uno\"}');\n"
            "select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c194), 'role', 'authenticated')::text, true);\n"
            "update public.profiles set role = 'salonero', is_active = true where id = '00000000-0000-4000-8194-0000000000f1';\n"
            "select set_config('request.jwt.claims', '', true);\n"
            "insert into public.profile_locations (profile_id, location_id, principal) values ('00000000-0000-4000-8194-0000000000f1', 'paridad194', true);\n"
            "insert into public.employees (full_name, role, profile_id, is_active, pos_login, created_at) values "
            "('Persona Uno', 'salonero', '00000000-0000-4000-8194-0000000000f1', true, 'p1', now());\n"
            "insert into public.product_map (nombre, tipo, multiplicador) values ('TRAGO PARIDAD', 'bebida', 2) "
            "on conflict (nombre) do update set tipo = excluded.tipo, multiplicador = excluded.multiplicador;\n"
            + fx + "\n"
            "insert into _r194 (caso, ok, detalle) select 'paridad: salida', true, "
            "pg_temp.como('00000000-0000-4000-8194-0000000000f1', $q$select public.pos_mi_rendimiento_equipo('paridad194', '2026-05-08', '2026-05-10')$q$)::text;\n"
        )
        bat = bat.replace('-- @@MUTACIONES@@', bloque + '-- @@MUTACIONES@@')
    # Con «todas»: en la MISMA transacción, cada mutación se aplica encima (create or replace) con replace() del lado
    # del servidor y se vuelven a correr los casos con su etiqueta. Al final se reaplica la 194 sin mutar.
    if todas:
        orig = _norm(_sin_beg_com(MIG.read_text(encoding='utf-8')))
        bloques = []
        for nombre, (cambios, _) in MUTACIONES.items():
            expr = 'm.sql'
            for viejo, nuevo, veces in cambios:
                viejo, nuevo = _norm(viejo).rstrip('\n') + ('\n' if viejo.endswith('\n') else ''), \
                               _norm(nuevo).rstrip('\n') + ('\n' if nuevo.endswith('\n') else '')
                if orig.count(viejo) != veces:
                    sys.exit(f'mutación {nombre}: el ancla aparece {orig.count(viejo)} veces (se esperaban {veces})')
                expr = f'replace({expr}, $v${viejo}$v$, $n${nuevo}$n$)'
            bloques.append(f"do $x$ declare q text; begin select {expr} into q from _m194 m; execute q; end $x$;")
            bloques.append(f"select set_config('t194.tag', '{nombre}', true); select pg_temp.casos();")
        bloques.append("do $x$ declare q text; begin select m.sql into q from _m194 m; execute q; end $x$;")
        bat = bat.replace('-- @@MUTACIONES@@', '\n'.join(bloques))
    if sin_drops:
        return bat.replace('-- @@194R@@', '')
    caso09 = ("insert into _r194 (caso, ok, detalle) select '09 rollback: funciones borradas', count(*) = 0, "
              "string_agg(proname, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname in "
              "('pos_persona_clave', 'pos_rend_base', 'pos_rend_productos', 'pos_rend_yo', 'pos_mi_rendimiento_equipo', "
              "'pos_mi_competencia');")
    return bat.replace('-- @@194R@@', _sin_beg_com(ROLLBACK.read_text(encoding='utf-8')) + '\n' + caso09)


def main() -> int:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    if mutar and mutar not in MUTACIONES and mutar != 'todas':
        sys.exit(f'mutaciones: {", ".join(MUTACIONES)} o todas')
    if '--armar' in args:
        paridad = args[args.index('--paridad') + 1] if '--paridad' in args else None
        sql = armar(mutar if mutar != 'todas' else None, todas=mutar == 'todas', sin_drops='--sin-drops' in args, paridad=paridad)
        if '--compacto' in args:
            sql = _norm(sql)
        print(sql)
        return 0
    if '--local' not in args:
        sys.exit(__doc__)
    dsn = args[args.index('--local') + 1]
    # Una sola corrida: la batería sin mutar y, con «todas», cada mutación encima en la misma transacción.
    out = subprocess.run(['psql', dsn, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', armar(None, todas=mutar == 'todas')],
                         capture_output=True, text=True)
    filas = [l for l in out.stdout.splitlines() if l.startswith('{')]
    if not filas:
        print('SIN RESULTADO', out.stderr[-400:]); return 1
    r = json.loads(filas[-1])
    fallas = 0
    for tag, res in sorted(r.items()):
        if tag == 'sin mutar':
            print('sin mutar:', res['ok'], '/', res['total']); fallas += res['ok'] != res['total']
            for f in res['fallan']: print('   cae:', f)
        else:
            caidos = set(res['fallan'])
            ok = all(any(c.startswith(p) for c in caidos) for p in MUTACIONES[tag][1])
            print(f'mutación {tag}: caen {len(caidos)} → {"OK" if ok else "NO MUERDE"}'); fallas += not ok
    return 1 if fallas else 0


if __name__ == '__main__':
    sys.exit(main())
