#!/usr/bin/env python3
"""
Batería de la 179 (origen club 124: «Reservar» del portal del socio abre el OpenTable de SU local): arma
scripts/sql/179_pruebas.sql con el cuerpo de la 179 y el de su rollback, todo en UNA transacción que termina en
ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/179_pruebas.py --local [--db m179] [--semilla-local]   # Postgres 16 local (PGHOST/PGPORT/PGUSER)
  python3 scripts/sql/179_pruebas.py --local --semilla-local --mutar todas    # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/179_pruebas.py --armar [--mutar X]                      # solo imprime el SQL (staging, con el OK del dueño)

La base tiene que tener la 167 y la 173 SIN la 179 (scripts/sql/local_armar_base.sh aplica todo el árbol: armala sin la
179 o corré su rollback antes). --semilla-local crea, DENTRO de la transacción descartada, un owner ficticio (la base local
no trae usuarios). En staging (ref hwiatgic…, nunca prod) se corre el SQL de --armar sin semilla: no deja nada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/179_club_portal_reserva_local.sql'
ROLLBACK = RAIZ / 'scripts/sql/179_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/179_pruebas.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8179-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8179-0000000000aa';
"""

# nombre → (texto de la 179, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # el guardado sin el chequeo de OpenTable (vuelve a aceptar cualquier https)
    'guardar_sin_dominio': ("  if v_url is not null and not public.club_reserva_url_ok(v_url) then\n",
                            "  if false then\n", {'02'}),
    # el host sin ancla: «opentable.com.otro.test» y «opentable.com@otro.test» pasan
    'host_sin_ancla': ("com\\.mx|com\\.tw)([/?#][^\\s<>\"]*)?$'", "com\\.mx|com\\.tw).*$'", {'02'}),
    # el portal devuelve el link aunque no sea de OpenTable (el viejo)
    'portal_sin_filtro': ("where k.location_id = v_loc and public.club_reserva_url_ok(k.reserva_url)",
                          "where k.location_id = v_loc", {'05'}),
    # el portal usa siempre el local de «Santa Teresa»
    'portal_local_fijo': ("select m.id, m.location_id into v_id, v_loc", "select m.id, 'prueba179st' into v_id, v_loc", {'04'}),
    # el portal no lo usa tal cual (lo reconstruye / le cambia algo)
    'portal_no_tal_cual': ("to_jsonb((select k.reserva_url from", "to_jsonb((select split_part(k.reserva_url, '&', 1) from", {'03', '04'}),
    # el portal se lo da también a quien no es socio (top-level)
    'portal_a_todos': ("  return v_j;\nend;", "  return v_j || jsonb_build_object('reserva_url', null);\nend;", {'06'}),
    # la interna queda abierta a la API (y sin la verificación de la propia 179, que si no aborta antes)
    'interna_abierta': (("revoke all on function public.club_reserva_url_ok(text) from public, anon, authenticated;\n",
                         "  if has_function_privilege('anon', 'public.club_reserva_url_ok(text)', 'EXECUTE')\n     or has_function_privilege('authenticated', 'public.club_reserva_url_ok(text)', 'EXECUTE')\n     or "),
                        ("grant execute on function public.club_reserva_url_ok(text) to anon;\n",
                         "  if "), {'08'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback no devuelve el portal de la 167
    'rollback_sin_portal': ("-- 3. club_portal: el de la 167\n", "-- 3. club_portal: el de la 167\ncreate function pg_temp.nada() returns void language sql as $x$ select $x$;\n/*", {'11'}),
    # el rollback deja la interna
    'rollback_deja_interna': ("drop function if exists public.club_reserva_url_ok(text);", "", {'11'}),
}


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def reemplazar(texto: str, mutar: str | None, tabla: dict, donde: str) -> str:
    if mutar in tabla:
        viejos, nuevos, _ = tabla[mutar]
        if isinstance(viejos, str):
            viejos, nuevos = (viejos,), (nuevos,)
        for viejo, nuevo in zip(viejos, nuevos):
            if texto.count(viejo) != 1:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en {donde}')
            texto = texto.replace(viejo, nuevo)
    return texto


def armar(mutar: str | None, semilla: bool) -> str:
    mig = sin_tx(reemplazar(MIG.read_text(encoding='utf-8'), mutar, MUTACIONES, 'la 179'))
    rbt = ROLLBACK.read_text(encoding='utf-8')
    if mutar == 'rollback_sin_portal':   # comenta el bloque del portal hasta el guardado
        rbt = rbt.replace("\n-- 2. club_cumple_config_guardar: el de la 173\n", "*/\n-- 2. club_cumple_config_guardar: el de la 173\n", 1)
    rb = reemplazar(rbt, mutar, MUTACIONES_ROLLBACK, '179_rollback.sql')
    rb = sin_tx(re.sub(r"(?m)^delete from supabase_migrations\.schema_migrations.*$", '', rb))
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@179@@.*$', lambda _: mig, sql)
    if n != 1:
        sys.exit('179_pruebas.sql: falta el marcador «-- @@179@@»')
    sql, n = re.subn(r'(?m)^-- @@179R@@.*$', lambda _: rb, sql)
    if n != 1:
        sys.exit('179_pruebas.sql: falta el marcador «-- @@179R@@»')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    p = subprocess.run(['psql', '-X', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    m = re.search(r'179-FALLAN: ([0-9a-z,()]+)', p.stderr)
    if m:
        filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
        if filas:
            return json.loads(filas[-1])
        return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
    if p.returncode != 0:
        sys.exit(f'ERROR: {p.stderr[:1500]}')
    filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
    if not filas:
        sys.exit(f'SIN RESULTADO: {p.stdout[-400:]}')
    return json.loads(filas[-1])


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    db = args[args.index('--db') + 1] if '--db' in args else 'm179'
    semilla = '--semilla-local' in args
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar and mutar != 'todas' and mutar not in todas:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(todas)})')
    if '--armar' in args:
        print(armar(mutar, semilla))
        return
    if '--local' not in args:
        sys.exit(__doc__)
    if mutar == 'todas':
        mal = 0
        for nombre, (_, _, deben) in todas.items():
            caidos = {r['caso'].split(' ')[0] for r in correr_local(armar(nombre, semilla), db) if not r['ok']}
            ok = deben <= caidos
            mal += not ok
            print(f"{'MUERDE' if ok else 'NO MUERDE'}  {nombre}: deben caer {sorted(deben)} · cayeron {sorted(caidos)}")
        sys.exit(1 if mal else 0)
    res = correr_local(armar(mutar, semilla), db)
    for r in res:
        print(f"{'OK ' if r['ok'] else 'MAL'} {r['caso']}" + ('' if r['ok'] else f"  · {r.get('detalle')}"))
    malos = [r for r in res if not r['ok']]
    if mutar:
        deben = todas[mutar][2]
        caidos = {r['caso'].split(' ')[0] for r in malos}
        print(f'mutación {mutar}: deben caer {sorted(deben)} · cayeron {sorted(caidos)}')
        sys.exit(0 if deben <= caidos else 1)
    print(f'{len(res) - len(malos)}/{len(res)}')
    sys.exit(1 if malos else 0)


if __name__ == '__main__':
    main()
