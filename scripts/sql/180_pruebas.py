#!/usr/bin/env python3
"""
Batería de la 180 (origen club 125: el link de reservas es de cada local, Club → Locales, y la página del cupón
muestra «Reservar una mesa»): arma scripts/sql/180_pruebas.sql con el cuerpo de la 180 y el de su rollback, todo en UNA transacción que termina en
ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/180_pruebas.py --local [--db m180] [--semilla-local]   # Postgres 16 local (PGHOST/PGPORT/PGUSER)
  python3 scripts/sql/180_pruebas.py --local --semilla-local --mutar todas    # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/180_pruebas.py --armar [--mutar X]                      # solo imprime el SQL (staging, con el OK del dueño)

La base tiene que tener la 179 SIN la 180 (scripts/sql/local_armar_base.sh aplica todo el árbol: armala sin la 180
o corré su rollback antes). --semilla-local crea, DENTRO de la transacción descartada, un owner ficticio (la base local
no trae usuarios). En staging (ref hwiatgic…, nunca prod) se corre el SQL de --armar sin semilla: no deja nada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/180_club_reserva_url_por_local.sql'
ROLLBACK = RAIZ / 'scripts/sql/180_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/180_pruebas.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8180-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8180-0000000000aa';
"""

# nombre → (texto de la 180, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple, set[str]] = {
    # Locales acepta cualquier link (el trigger no valida)
    'trigger_sin_validar': ("  if new.reserva_url is not null and not public.club_reserva_url_ok(new.reserva_url) then\n",
                            "  if false then\n", {'04'}),
    # un local nuevo hereda el OpenTable del local copiado
    'insert_hereda': ("    new.reserva_url := null;   -- un local nuevo", "    null;   -- un local nuevo", {'09'}),
    # la copia no se hace (y sin la verificación de la propia 180, que si no aborta antes)
    'sin_copia': (("   and c.reserva_url is null\n", "    raise exception '180: la copia del link de reservas no coincide con Promociones';"),
                  ("   and false\n", "    null;"), {'01', '02'}),
    # el portal sigue leyendo Promociones (la columna vieja)
    'portal_lee_viejo': ("coalesce(to_jsonb((select g.reserva_url from public.club_config g\n",
                         "coalesce(to_jsonb((select g.reserva_url from public.club_cumple_config g\n", {'03'}),
    # el cupón no trae el link
    'cupon_sin_reserva': ("'reserva', case when public.club_reserva_url_ok(c.reserva_url) then c.reserva_url end",
                          "'reserva', null", {'05'}),
    # el cupón trae siempre el link de «Santa Teresa»
    'cupon_local_fijo': ("'reserva', case when public.club_reserva_url_ok(c.reserva_url) then c.reserva_url end",
                         "'reserva', (select g.reserva_url from public.club_config g where g.location_id = 'prueba180st')", {'05'}),
    # el WhatsApp / Promociones siguen leyendo la columna vieja
    'json_lee_viejo': ("    'reserva_url', (select g.reserva_url from public.club_config g\n                     where g.location_id = r.location_id and public.club_reserva_url_ok(g.reserva_url)),",
                       "    'reserva_url', r.reserva_url,", {'07'}),
    # «solo con reserva» ya no exige el link del local
    'guardar_sin_exigir': ("  if v_n.solo_reserva and not exists (select 1 from public.club_config g\n",
                           "  if false and not exists (select 1 from public.club_config g\n", {'08'}),
    # la función del trigger queda abierta a la API (y sin la verificación de la propia 180)
    'trigger_abierto': (("revoke all on function public.club_config_reserva_url_validar() from public, anon, authenticated;\n",
                         "  if has_function_privilege('anon', 'public.club_config_reserva_url_validar()', 'EXECUTE')\n     or has_function_privilege('authenticated', 'public.club_config_reserva_url_validar()', 'EXECUTE')\n     or "),
                        ("grant execute on function public.club_config_reserva_url_validar() to anon;\n", "  if "), {'06'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple, set[str]] = {
    # el rollback no devuelve a Promociones lo cargado en Locales
    'rollback_sin_devolver': ("   and k.reserva_url is distinct from c.reserva_url;", "   and false;", {'10'}),
    # el rollback deja la columna del local
    'rollback_deja_columna': ("alter table public.club_config drop column if exists reserva_url;", "", {'10'}),
    # el rollback no devuelve club_cupon_ver de la 158
    'rollback_sin_cupon': ("-- 8. club_cupon_ver: la de la 158\n", "-- 8. club_cupon_ver: la de la 158\ncreate function pg_temp.nada() returns void language sql as $x$ select $x$;\n/*", {'10'}),
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
    mig = sin_tx(reemplazar(MIG.read_text(encoding='utf-8'), mutar, MUTACIONES, 'la 180'))
    rbt = ROLLBACK.read_text(encoding='utf-8')
    if mutar == 'rollback_sin_cupon':   # comenta el bloque del cupón hasta el portal
        rbt = rbt.replace("\n-- 7. club_portal: la de la 179\n", "*/\n-- 7. club_portal: la de la 179\n", 1)
    rb = reemplazar(rbt, mutar, MUTACIONES_ROLLBACK, '180_rollback.sql')
    rb = sin_tx(re.sub(r"(?m)^delete from supabase_migrations\.schema_migrations.*$", '', rb))
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@180@@.*$', lambda _: mig, sql)
    if n != 1:
        sys.exit('180_pruebas.sql: falta el marcador «-- @@180@@»')
    sql, n = re.subn(r'(?m)^-- @@180R@@.*$', lambda _: rb, sql)
    if n != 1:
        sys.exit('180_pruebas.sql: falta el marcador «-- @@180R@@»')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    p = subprocess.run(['psql', '-X', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    m = re.search(r'180-FALLAN: ([0-9a-z,()]+)', p.stderr)
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
    db = args[args.index('--db') + 1] if '--db' in args else 'm180'
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
