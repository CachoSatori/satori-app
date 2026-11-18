#!/usr/bin/env python3
"""
Arma (y opcionalmente corre) scripts/sql/192_pruebas.sql: llena los marcadores con el cuerpo de la 191 (si la base no
la tiene, la 192 la necesita), el de la 192 y el de su rollback, todo dentro de una transacción que termina en ROLLBACK.

  python3 scripts/sql/192_pruebas.py --armar [--compacto] [--sin-drops] [--mutar X|todas]  # imprime el SQL
  python3 scripts/sql/192_pruebas.py --local "<dsn>" [--mutar todas]  # psql contra un Postgres LOCAL (nunca prod)

--sin-drops: para staging por el conector (cancela los `drop` de la vuelta atrás; el caso 09 queda NO PROBADO).

En staging se corre pegando el SQL armado en una sola consulta (termina en ROLLBACK). Cada mutación rompe el arreglo
a propósito: los casos de su lista TIENEN que caer.
"""
from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG191 = RAIZ / 'supabase/migrations/191_pos_ventas_solo_lo_suyo.sql'
MIG = RAIZ / 'supabase/migrations/192_mi_rendimiento_equipo.sql'
ROLLBACK = RAIZ / 'scripts/sql/192_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/192_pruebas.sql'

# nombre → ([(texto de la 192, reemplazo, veces)], prefijos de casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # sin umbral anti-identificación (K = 1): con 2 personas sale el «general» y el equipo
    'sin_k': ([('k_min constant integer := 4;', 'k_min constant integer := 1;', 2)], {'04 chico', '07 comp 3'}),
    # el personal sin ventas en el período igual recibe los agregados
    'sin_ventas_ve': ([("    when not v_gerencia and not coalesce(c.soy, false) then\n", "    when false then\n", 1)],
                      {'05 sin ventas'}),
    # la familia 17 (cortesías) vuelve a contar como venta
    'neta_con_17': ([("(where l.familia is null or l.familia not in (6, 17, 20))", "(where true)", 1)], {'02 yo: general'}),
    # cualquier rol (cajero incluido) puede pedir
    'sin_rol': ([("  if v_rol is null or v_rol not in ('owner', 'contador', 'manager', 'salonero', 'barman', 'barback', 'runner', 'cocina') then\n",
                  "  if v_rol is null then\n", 1)], {'06 cajero', '07 comp: cajero'}),
    # el manager pide cualquier local
    'manager_sin_local': ([("  if v_rol = 'manager' and not (p_local = any (public.mis_locales())) then\n",
                            "  if false then\n", 1)], {'06 manager de otro local'}),
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


def armar(mutar: str | None, todas: bool = False, sin_drops: bool = False) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        for viejo, nuevo, veces in MUTACIONES[mutar][0]:
            if mig.count(viejo) != veces:
                sys.exit(f'mutación {mutar}: el ancla aparece {mig.count(viejo)} veces (se esperaban {veces})')
            mig = mig.replace(viejo, nuevo)
    bat = BATERIA.read_text(encoding='utf-8')
    for marca in ('-- @@191@@', '-- @@192@@', '-- @@192R@@', '-- @@MUTACIONES@@'):
        if bat.count(marca) != 1:
            sys.exit(f'falta el marcador {marca}')
    # De la 191 la 192 usa SOLO `pos_mis_logins()`: si la base no la tiene (staging, al 18-nov), se crea esa función,
    # copiada tal cual del archivo de la 191 (el resto de la 191 no hace falta para estas pruebas).
    m191 = MIG191.read_text(encoding='utf-8')
    i = m191.index('create or replace function public.pos_mis_logins()')
    j = m191.index("grant execute on function public.pos_mis_logins() to service_role;", i)
    j = m191.index('\n', j) + 1
    bat = bat.replace('-- @@191@@', "do $si191$ begin if to_regprocedure('public.pos_mis_logins()') is null then execute "
                      + "$c191$" + _norm(m191[i:j]).replace(';\n', ';\n', 1) + "$c191$; end if; end $si191$;")
    # La 192 (mutada o no) viaja UNA vez, como texto en una tabla temporal, y se aplica con execute.
    bat = bat.replace('-- @@192@@', "create temp table _m192 on commit drop as select $m192$" + _norm(_sin_beg_com(mig))
                      + "$m192$::text as sql;\ndo $x$ declare q text; begin select m.sql into q from _m192 m; execute q; end $x$;")
    # Con «todas»: en la MISMA transacción, cada mutación se aplica encima (create or replace) con replace() del lado
    # del servidor y se vuelven a correr los casos con su etiqueta. Al final se reaplica la 192 sin mutar.
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
            bloques.append(f"do $x$ declare q text; begin select {expr} into q from _m192 m; execute q; end $x$;")
            bloques.append(f"select set_config('t192.tag', '{nombre}', true); select pg_temp.casos();")
        bloques.append("do $x$ declare q text; begin select m.sql into q from _m192 m; execute q; end $x$;")
        bat = bat.replace('-- @@MUTACIONES@@', '\n'.join(bloques))
    if sin_drops:
        return bat.replace('-- @@192R@@', '')
    caso09 = ("insert into _r192 (caso, ok, detalle) select '09 rollback: funciones borradas', count(*) = 0, "
              "string_agg(proname, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname in "
              "('pos_persona_clave', 'pos_rend_base', 'pos_rend_productos', 'pos_rend_yo', 'pos_mi_rendimiento_equipo', "
              "'pos_mi_competencia');")
    return bat.replace('-- @@192R@@', _sin_beg_com(ROLLBACK.read_text(encoding='utf-8')) + '\n' + caso09)


def main() -> int:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    if mutar and mutar not in MUTACIONES and mutar != 'todas':
        sys.exit(f'mutaciones: {", ".join(MUTACIONES)} o todas')
    if '--armar' in args:
        sql = armar(mutar if mutar != 'todas' else None, todas=mutar == 'todas', sin_drops='--sin-drops' in args)
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
