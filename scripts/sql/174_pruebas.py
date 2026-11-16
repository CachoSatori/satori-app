#!/usr/bin/env python3
"""
Batería de la 174 (origen club 120, plan B de Escanear: facturas de HOY + búsqueda por tiquete de 3 días CR + factura
ya usada no se elige otra vez): arma scripts/sql/174_pruebas.sql con el cuerpo de la 174 y el de su rollback, todo en
UNA transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/174_pruebas.py --local [--db f174]            # Postgres 16 local (PGHOST/PGPORT/PGUSER del entorno)
  python3 scripts/sql/174_pruebas.py --local --mutar todas          # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/174_pruebas.py --armar [--mutar X]            # solo imprime el SQL (para staging, con el OK del dueño)

La base local tiene que tener las migraciones de main (scripts/sql/local_armar_base.sh), con o sin la 172 y la 173.
En staging el SQL de --armar se corre igual (ref hwiatgic…, nunca prod): crea sus datos dentro de la transacción y no
deja nada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/174_club_facturas_dia_busqueda.sql'
ROLLBACK = RAIZ / 'scripts/sql/174_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/174_pruebas.sql'

FRENO = "  if p_pos is not null and p_pos->>'modo' = 'factura' and public.club_visita_con_tarjeta(p_location, p_visita) then\n"
# nombre → (texto de la 174, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # el servidor vuelve a las 2 h 15 min
    'ventana_2h': ("    if t.fecha_registra < public.club_facturas_desde(now(), public.club_facturas_dias_busqueda()) then\n",
                   "    if t.fecha_registra < now() - interval '2 hours 15 minutes' then\n", {'3a', '3g'}),
    # la lista trae también ayer
    'lista_con_ayer': ("case when v_bus is null then 0 else public.club_facturas_dias_busqueda() end",
                       "case when v_bus is null then 1 else public.club_facturas_dias_busqueda() end", {'1a', '1b', '1f', '2a'}),
    # la búsqueda (y el servidor) sin el tope de 3 días
    'sin_tope_3_dias': ("as $$ select 3 $$;", "as $$ select 30 $$;", {'1c', '1g', '2b', '3b'}),
    # el corte en UTC en vez de la hora de Costa Rica
    'utc': ("  select (((p_ahora at time zone 'America/Costa_Rica')::date - greatest(coalesce(p_dias_atras, 0), 0))::timestamp)\n"
            "         at time zone 'America/Costa_Rica'\n",
            "  select (((p_ahora at time zone 'UTC')::date - greatest(coalesce(p_dias_atras, 0), 0))::timestamp)\n"
            "         at time zone 'UTC'\n", {'1f', '1g'}),
    # sin el freno de la factura ya usada
    'sin_freno_usada': (FRENO, "  if false then\n", {'3c', '3h'}),
    # el freno también con el pedido abierto (rompería CLUB-AUD-02)
    'freno_en_pedido': (FRENO, "  if public.club_visita_con_tarjeta(p_location, p_visita) then\n", {'3i'}),
    # «usada» sin mirar las personas pendientes
    'usada_sin_pendientes': ("    or exists (select 1 from public.club_personas_pendientes pp\n",
                             "    or false and exists (select 1 from public.club_personas_pendientes pp\n", {'3h', '3j'}),
    # con anuladas
    'con_anuladas': ("t.estado in ('C', 'R')                       -- cobradas",
                     "t.estado in ('C', 'R', 'X')                  -- cobradas", {'1d', '2b'}),
    # sin mínimo de dígitos
    'sin_minimo': ("length(v_bus) not between 4 and 20", "length(v_bus) not between 1 and 20", {'1e'}),
    # sin el chequeo de local del manager en el envoltorio nuevo
    'sin_chequeo_local': ("  perform public.club_exigir_local(p_location);\n  return query select * from public.club_facturas_buscar__nucleo",
                          "  return query select * from public.club_facturas_buscar__nucleo", {'2c'}),
    # el núcleo nuevo queda llamable por la API
    'nucleo_abierto': ("revoke all on function public.club_facturas_buscar__nucleo(text, text) from public, anon, authenticated;",
                       "grant execute on function public.club_facturas_buscar__nucleo(text, text) to authenticated;", {'0b', '2e'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback no devuelve club_pos_ref
    'rollback_sin_pos_ref': ("create or replace function public.club_pos_ref(", "create or replace function pg_temp.x_pos_ref(", {'4a', '4b'}),
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
    mig = sin_tx(reemplazar(MIG.read_text(encoding='utf-8'), mutar, MUTACIONES, 'la 174'))
    rb = reemplazar(ROLLBACK.read_text(encoding='utf-8'), mutar, MUTACIONES_ROLLBACK, '174_rollback.sql')
    rb = sin_tx(re.sub(r"(?m)^delete from supabase_migrations\.schema_migrations.*$", '', rb))
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@174@@.*$', lambda _: mig, sql)
    if n != 1:
        sys.exit('174_pruebas.sql: falta el marcador «-- @@174@@»')
    sql, n = re.subn(r'(?m)^-- @@174R@@.*$', lambda _: rb, sql)
    if n != 1:
        sys.exit('174_pruebas.sql: falta el marcador «-- @@174R@@»')
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    p = subprocess.run(['psql', '-X', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    m = re.search(r'174-FALLAN: ([0-9a-z,()]+)', p.stderr)
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
    db = args[args.index('--db') + 1] if '--db' in args else 'f174'
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
