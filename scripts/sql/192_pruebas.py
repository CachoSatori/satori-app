#!/usr/bin/env python3
"""
Arma y corre scripts/sql/192_pruebas.sql (pos_mesas_internas, pos_ventas_internas, pos_ventas_tiempos): llena el
marcador con el cuerpo de la 192, todo en una transacción que termina en ROLLBACK.

  python3 scripts/sql/192_pruebas.py --armar [--mutar X]            # imprime el SQL armado
  python3 scripts/sql/192_pruebas.py --psql "<conexión>" [--mutar todas]  # corre con psql y dice si muerde

La batería usa un local ficticio y sus propias facturas: corre en staging o en un Postgres vacío al que antes se le
cargó scripts/sql/192_base_local.sql. Nunca contra PROD (ref yiczgdti…).
"""
from __future__ import annotations
import re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/192_pos_ventas_tiempos.sql'
BATERIA = RAIZ / 'scripts/sql/192_pruebas.sql'

# nombre → ([(texto de la 192, reemplazo)], casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    'internas_en_horas': ([("where dia between p_desde and p_hasta and not interna\n", "where dia between p_desde and p_hasta\n")], {'01'}),
    'sin_ceros': ([("nullif(ltrim(btrim(p_mesa), '0'), '')", "nullif(btrim(p_mesa), '')")], {'03', '01'}),
    'solo_mesa_pedido': ([(", nullif(ltrim(btrim(p_mesa_factura), '0'), '')", "")], {'03'}),
    'pedido_por_factura': ([("    group by s.numero_pedido, s.pedido_abierto_en\n", "    group by s.numero_pedido, s.pedido_abierto_en, s.id\n")], {'04'}),
    'pax_max': ([("           sum(s.pax_d) as pax,\n", "           max(s.pax_d) as pax,\n")], {'04'}),
    'sin_tope_240': ([("and minutos <= 240", "and minutos <= 100000")], {'04'}),
    'dia_de_apertura': ([("where (ped.cobro at time zone 'America/Costa_Rica')::date between", "where (ped.pedido_abierto_en at time zone 'America/Costa_Rica')::date between")], {'06'}),
    'familia_20': ([("filter (where ln.familia is null or ln.familia not in (6, 17, 20)), 0) as neta\n    from public.pos_ndf_ticket_lines ln\n    where ln.ticket_id = any (array(select id from t))\n    group by ln.ticket_id\n  ),\n  f as",
                     "filter (where true), 0) as neta\n    from public.pos_ndf_ticket_lines ln\n    where ln.ticket_id = any (array(select id from t))\n    group by ln.ticket_id\n  ),\n  f as")], {'01'}),
    'manager_cualquier_local': ([("  if v_rol = 'manager' and not public.puede_ver_local(p_local) then", "  if false then")], {'07'}),
    'sin_rol': ([("  if v_rol is null or v_rol not in ('owner', 'manager', 'contador') then", "  if v_rol is null then")], {'07'}),
    'manager_edita': ([("  with check (public.get_my_role() = 'owner');", "  with check (public.get_my_role() in ('owner', 'manager'));")], {'09'}),
    'helper_abierto': ([("revoke all on function public.pos_es_mesa_interna(text, text, text) from public, anon, authenticated;",
                         "grant execute on function public.pos_es_mesa_interna(text, text, text) to authenticated;")], {'08'}),
}


def armar(mutar: str | None = None) -> str:
    cuerpo = MIG.read_text()
    if mutar:
        for viejo, nuevo in MUTACIONES[mutar][0]:
            if viejo not in cuerpo:
                raise SystemExit(f'mutación {mutar}: no encuentro el texto')
            cuerpo = cuerpo.replace(viejo, nuevo, 1)
    return BATERIA.read_text().replace('-- @@192@@   (aquí va el cuerpo de la 192)', cuerpo, 1)


def correr(conn: str, sql: str) -> dict[str, bool]:
    out = subprocess.run(['psql', conn, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|'], input=sql, text=True,
                         capture_output=True)
    if out.returncode != 0:
        raise SystemExit(out.stderr)
    res = {}
    for linea in out.stdout.splitlines():
        m = re.match(r'^\d+\|(\d\d) [^|]*\|(OK|FALLA)\|', linea)
        if m:
            res[m.group(1)] = m.group(2) == 'OK'
    return res


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    if '--armar' in args:
        print(armar(mutar if mutar != 'todas' else None))
        return
    conn = args[args.index('--psql') + 1]
    base = correr(conn, armar())
    print('sin mutar:', 'todo OK' if base and all(base.values()) else base)
    if mutar == 'todas':
        for nombre, (_, deben) in MUTACIONES.items():
            r = correr(conn, armar(nombre))
            cayeron = {c for c, ok in r.items() if not ok}
            print(f'{nombre}: caen {sorted(cayeron)}', 'MUERDE' if deben <= cayeron else f'NO MUERDE (esperaba {sorted(deben)})')


if __name__ == '__main__':
    main()
