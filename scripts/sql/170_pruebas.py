#!/usr/bin/env python3
"""
Batería de la 170 (origen club 116, el manager solo en sus locales): arma scripts/sql/170_pruebas.sql con el cuerpo de
la 170 y el de su rollback, todo en UNA transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay
resultado.

  python3 scripts/sql/170_pruebas.py --local [--db sec170]          # Postgres 16 local (PGHOST/PGPORT/PGUSER del entorno)
  python3 scripts/sql/170_pruebas.py --local --mutar todas          # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/170_pruebas.py --armar [--mutar X]            # solo imprime el SQL (para staging, con el OK del dueño)

La base local tiene que tener las migraciones de main (shim de Supabase: roles anon/authenticated, auth.uid() que lee
request.jwt.claims; p. ej. scripts/sql/local_armar_base.sh del #184). En staging el SQL de --armar se corre igual (ref
hwiatgic…, nunca prod): crea sus propios locales, usuarios y datos dentro de la transacción y no deja nada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/170_club_local_manager.sql'
ROLLBACK = RAIZ / 'scripts/sql/170_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/170_pruebas.sql'

CHEQUEO = "  if not public.club_puede_ver_local(public.club_local(p_location, false)) then\n"
# nombre → (texto de la 170, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # sin el chequeo: vuelve el hallazgo
    'sin_chequeo': (CHEQUEO, "  if false then\n", {'2a', '2b', '4a', '5a', '6a', '6b'}),
    # el manager ve todos los locales
    'manager_todos': ("    when public.get_my_role() = 'manager' then p_location = any (public.mis_locales())\n",
                      "    when public.get_my_role() = 'manager' then true\n", {'1a', '2a', '2b', '4a', '5a', '6a', '6b'}),
    # el contador queda afuera de la regla
    'sin_contador': ("    when public.get_my_role() in ('owner', 'contador') then true",
                     "    when public.get_my_role() in ('owner') then true", {'1a'}),
    # el chequeo se aplica a todos los roles (cajero/contador/salonero cambian respecto de hoy)
    'todos_los_roles': ("  if public.get_my_role() is distinct from 'manager'::public.user_role then\n    return;\n  end if;\n",
                        "", {'3a'}),   # el contador ve todo: 3c no cambia
    # el núcleo queda llamable por la API
    'nucleo_abierto': ("    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_nom || '__nucleo', v_ident);\n",
                       "", {'0c', '7a'}),
    # la edición por id mira el local que manda el cliente
    'id_sin_objeto': ("         'case when p_id is not null then coalesce((select n.location_id from public.club_negocios n where n.id = p_id), p_location) '\n"
                      "         'else p_location end'),\n", "         'p_location'),\n", {'6a'}),
    # el envoltorio ignora el local del negocio en el alta
    'alta_sin_negocio': ("         'else coalesce(p_location, (select n.location_id from public.club_negocios n where n.id = p_negocio_id)) end')\n",
                         "         'else p_location end')\n", {'6b'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback no devuelve el EXECUTE de authenticated
    'rollback_sin_grant': ("    execute format('grant execute on function public.%I(%s) to authenticated', r.nom, v_ident);",
                           "    null;", {'8a'}),
}


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def reemplazar(texto: str, mutar: str | None, tabla: dict, donde: str) -> str:
    if mutar in tabla:
        viejo, nuevo, _ = tabla[mutar]
        if texto.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en {donde}')
        texto = texto.replace(viejo, nuevo)
    return texto


def armar(mutar: str | None) -> str:
    mig = sin_tx(reemplazar(MIG.read_text(encoding='utf-8'), mutar, MUTACIONES, 'la 170'))
    rb = reemplazar(ROLLBACK.read_text(encoding='utf-8'), mutar, MUTACIONES_ROLLBACK, '170_rollback.sql')
    rb = sin_tx(re.sub(r"(?m)^delete from supabase_migrations\.schema_migrations.*$", '', rb))
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@170@@.*$', lambda _: mig, sql)
    if n != 1:
        sys.exit('170_pruebas.sql: falta el marcador «-- @@170@@»')
    sql, n = re.subn(r'(?m)^-- @@170R@@.*$', lambda _: rb, sql)
    if n != 1:
        sys.exit('170_pruebas.sql: falta el marcador «-- @@170R@@»')
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    p = subprocess.run(['psql', '-X', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    m = re.search(r'170-FALLAN: ([0-9a-z,()]+)', p.stderr)
    if m:
        return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
    if p.returncode != 0:
        sys.exit(f'ERROR: {p.stderr[:800]}')
    filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
    if not filas:
        sys.exit(f'SIN RESULTADO: {p.stdout[-400:]}')
    return json.loads(filas[-1])


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    db = args[args.index('--db') + 1] if '--db' in args else 'sec170'
    if '--armar' in args:
        print(armar(mutar))
        return
    if '--local' not in args:
        sys.exit(__doc__)
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar == 'todas':
        mal = 0
        for nombre, (_, _, deben) in todas.items():
            caidos = {r['caso'].split(' ')[0] for r in correr_local(armar(nombre), db) if not r['ok']}
            ok = deben <= caidos
            mal += not ok
            print(f"{'MUERDE' if ok else 'NO MUERDE'}  {nombre}: deben caer {sorted(deben)} · cayeron {sorted(caidos)}")
        sys.exit(1 if mal else 0)
    res = correr_local(armar(mutar), db)
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
