#!/usr/bin/env python3
"""
Batería de la 161 (origen 107, Club → Cohortes y Ranking): arma scripts/sql/161_pruebas.sql con el cuerpo de la 161 y el de su
rollback, todo en UNA transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/161_pruebas.py --local [--db c161]          # Postgres 16 local (variable PSQL; por defecto puerto 5499)
  python3 scripts/sql/161_pruebas.py --local --mutar todas             # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/161_pruebas.py --armar [--mutar X]               # solo imprime el SQL (para staging, con firma)

La base local tiene que tener las migraciones de main (shim de Supabase: roles anon/authenticated, auth.uid() que
lee request.jwt.claims). En staging el SQL de --armar se corre igual (ref hwiatgic…, nunca prod): crea sus propios
locales, usuarios y miembros de prueba dentro de la transacción y no deja nada.
"""
from __future__ import annotations
import json, os, re, shlex, subprocess, sys
from pathlib import Path

PSQL = shlex.split(os.environ.get('PSQL', 'psql -h /tmp -p 5499 -U pgv'))
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/161_club_cohortes_ranking.sql'
ROLLBACK = RAIZ / 'scripts/sql/161_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/161_pruebas.sql'

# nombre → (texto de la 161, reemplazo, casos que tienen que caer)
_ROL_CO = "  if v_rol is null or v_rol not in ('owner','manager','contador') then"
_ROL_RK = ("  -- Solo owner y manager: el ranking tiene nombres (el contador lee totales en otras pantallas).\n"
           "  if v_rol is null or v_rol not in ('owner','manager') then")
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # ── Cohortes ──
    'co_sin_contador': (_ROL_CO, "  if v_rol is null or v_rol not in ('owner','manager') then", {'1c', '3g', '6c'}),
    'co_cajero_entra': (_ROL_CO, "  if v_rol is null or v_rol not in ('owner','manager','contador','cajero') then", {'1d'}),
    # cohorte por mes UTC (S2, 31-ene 23:30 CR, pasa a febrero)
    'co_mes_utc': ("date_trunc('month', (r.desde at time zone 'America/Costa_Rica'))::date as cohorte",
                   "date_trunc('month', (r.desde at time zone 'UTC'))::date as cohorte", {'3a', '3c'}),
    # cuentan las visitas de antes del alta
    'co_visitas_antes_alta': ("on v.miembro_id = so.id and v.registrada_en >= so.desde", "on v.miembro_id = so.id", {'3a', '3e'}),
    # el pendiente cuenta como socio
    'co_con_pendientes': ("     where r.rol = 'socio' and r.estado <> 'pendiente' and m.location_id = any (v_locs)),",
                          "     where r.rol = 'socio' and m.location_id = any (v_locs)),", {'3c', '3e'}),
    # «aún no» como 0
    'co_aun_no_cero': ("'activos_30', case when co.ultimo_dia + 30 < v_hoy then co.a30 end,",
                       "'activos_30', co.a30,", {'3d'}),
    # el día del alta cuenta como «activo a 30»
    'co_dia_alta_activo': ("bool_or(v.fecha - so.alta between 1 and 30)  as a30", "bool_or(v.fecha - so.alta between 0 and 30)  as a30",
                           {'3b'}),
    # sin el chequeo de local (091)
    'sin_local': ("  if not public.puede_ver_local(p_location) then         -- 091: el manager ve solo sus locales\n"
                  "    raise exception 'Sin permiso' using errcode = '42501';\n  end if;\n", "", {'1h', '2h'}),
    # «todos» sin filtrar por mis_locales(): el manager de otro local ve p161-a
    'todos_sin_filtro': ("      from public.club_config c where c.location_id = any (public.mis_locales());",
                         "      from public.club_config c;", {'2i'}),
    'co_sin_rastro': ("  perform public.club_auditar_lectura('ver_cohortes', 'club_cohortes_socios', p_apertura,\n"
                      "    jsonb_build_object('local', coalesce(p_location, 'todos')));\n", "", {'6c', '6d'}),
    # una fila por CADA lectura (sin mirar la apertura)
    'rastro_por_lectura': ("  if p_apertura is not null and exists (", "  if false and exists (", {'6d'}),
    # ── Ranking ──
    'rk_contador_entra': (_ROL_RK, "  if v_rol is null or v_rol not in ('owner','manager','contador') then", {'2c', '6c'}),
    'rk_cajero_entra': (_ROL_RK, "  if v_rol is null or v_rol not in ('owner','manager','cajero') then", {'2d'}),
    'rk_sin_tope': ("p_hasta < p_desde or p_hasta - p_desde > 400 then", "p_hasta < p_desde then", {'2k'}),
    # una factura cuenta una vez por cada visita (F1 dos veces)
    'rk_factura_por_visita': ("  sf as (select distinct vp.miembro_id, x.tid from vp cross join lateral unnest(vp.tids) as x(tid)),",
                              "  sf as (select vp.miembro_id, x.tid from vp cross join lateral unnest(vp.tids) as x(tid)),", {'4a', '4b'}),
    # totales sumando las filas de los socios (F2 dos veces)
    'rk_total_por_socio': ("                  'facturas', count(fa.id), 'venta_respaldada_crc', round(coalesce(sum(fa.neta), 0)),",
                           "                  'facturas', count(fa.id), 'venta_respaldada_crc', (select round(coalesce(sum(venta), 0)) from fi),",
                           {'4f'}),
    # tiquete por visita en vez de por mesa
    'rk_tiquete_por_visita': ("'tiquete_promedio_crc', case when fi.mesas > 0 then round(fi.venta / fi.mesas) end,",
                              "'tiquete_promedio_crc', case when fi.visitas > 0 then round(fi.venta / fi.visitas) end,", {'4a'}),
    'rk_neta_con_17': ("sum(l.monto) filter (where l.familia is null or l.familia not in (6, 17, 20)) as neta,",
                       "sum(l.monto) as neta,", {'4a', '4f'}),
    # invitados con el 856 en vez del 857
    'rk_invitados_856': ("filter (where l.codigo_producto = cf.lc_invitado_codigo) as invitados",
                         "filter (where l.codigo_producto = cf.lc_articulo_codigo) as invitados", {'4b', '4c', '4f'}),
    # la referencia toma facturas del Club (F1 a ₡8.500 empata con G1 y no hay descuento en el P1 de F2)
    'rk_ref_con_club': ("  dday as (select local, cod, dia, u, sum(n) as n from pr where not con_mk and not club group by 1, 2, 3, 4),",
                        "  dday as (select local, cod, dia, u, sum(n) as n from pr where not con_mk group by 1, 2, 3, 4),", {'4b', '4c', '4f'}),
    # la referencia toma facturas con marcador (₡7.000 ×4 sería la moda de febrero)
    'rk_ref_con_marcador': ("  dday as (select local, cod, dia, u, sum(n) as n from pr where not con_mk and not club group by 1, 2, 3, 4),",
                            "  dday as (select local, cod, dia, u, sum(n) as n from pr where not club group by 1, 2, 3, 4),", {'4b', '4f'}),
    # sin la regla del cambio de lista (P4 a ₡8.000 el día que bajó la lista se estima como descuento de ₡2.000)
    'rk_sin_cambio_lista': ("                  and coalesce(dl.parte_dia, 0) < 0.6) as es_desc", "                  ) as es_desc",
                            {'4b', '4c', '4f', '4j'}),
    # el cambio de lista cuenta las ventas del Club (F2 sola haría «lista nueva»: P1 y P2 ya no serían descuento)
    'rk_cambio_lista_con_club': ("  ddia as (select local, cod, dia, u, sum(n) as n from pr where not mk_total and not club group by 1, 2, 3, 4),",
                                 "  ddia as (select local, cod, dia, u, sum(n) as n from pr where not mk_total group by 1, 2, 3, 4),",
                                 {'4b', '4c', '4f'}),
    # se estiman también las líneas de cortesía (K1)
    'rk_estima_cortesias': ("     where x.cantidad > 0 and x.monto > 0 and x.cod is not null and not x.fuera),",
                            "     where x.cantidad > 0 and x.monto > 0 and x.cod is not null),", {'4f'}),
    # los pendientes entran al ranking
    'rk_con_pendientes': ("     where r.rol = 'socio' and r.estado <> 'pendiente'\n       and (m.location_id",
                          "     where r.rol = 'socio'\n       and (m.location_id", {'4e'}),
    # las visitas de un pendiente entran a los totales (F3)
    'rk_vp_con_pendientes': ("      join public.club_miembro_roles rv on rv.miembro_id = v.miembro_id and rv.rol = 'socio' and rv.estado <> 'pendiente'\n",
                             "", {'4f'}),
    # sin aviso de local sin PoS (lista vacía siempre)
    'rk_sin_aviso_pos': ("     where not exists (select 1 from public.pos_ndf_tickets t\n",
                         "     where false and not exists (select 1 from public.pos_ndf_tickets t\n", {'5a', '5b'}),
    'rk_sin_rastro': ("    perform public.club_auditar_lectura('ver_ranking_socios', 'club_ranking_socios', p_apertura,\n",
                      "    perform 1; perform jsonb_build_object(\n", {'6a', '6b', '6d'}),
    # el exporte también se deduplica (dos exportes → una fila)
    'rk_exporte_dedup': ("  if p_exporte then\n    perform public.club_auditar('exporte_ranking_socios_csv', 'club_ranking_socios', p_apertura, null,",
                         "  if p_exporte then\n    perform public.club_auditar_lectura('exporte_ranking_socios_csv', 'club_ranking_socios', p_apertura,",
                         {'6d'}),
    'rk_exporte_sin_marca': ("    perform public.club_auditar('exporte_ranking_socios_csv', 'club_ranking_socios', p_apertura, null,",
                             "    perform public.club_auditar('ver_ranking_socios', 'club_ranking_socios', p_apertura, null,", {'6b', '6d'}),
    'anon_ejecuta': ("grant execute on function public.club_ranking_socios(date, date, text, boolean, uuid) to authenticated;",
                     "grant execute on function public.club_ranking_socios(date, date, text, boolean, uuid) to authenticated, anon;", {'0', '2j'}),
}
# mutaciones del rollback
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    'rollback_deja_ranking': ("drop function if exists public.club_ranking_socios(date, date, text, boolean, uuid);\n", "", {'7'}),
    'rollback_deja_rastro': ("drop function if exists public.club_auditar_lectura(text, text, uuid, jsonb);\n", "", {'7'}),
}


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 161')
        mig = mig.replace(viejo, nuevo)
    # la verificación final de la 161 aborta con algunas mutaciones (anon): se saca para que caigan los CASOS
    mig = re.sub(r'(?s)-- Verificación: las funciones existen.*?\nend \$\$;\n', '', mig)
    return sin_tx(mig)


def cuerpo_rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está en 161_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    rb = re.sub(r'(?s)\ndo \$\$\nbegin\n  if to_regprocedure.*?\nend \$\$;\n', '\n', rb)
    return sin_tx(rb)


def armar(mutar: str | None) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@161@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('161_pruebas.sql: falta el marcador «-- @@161@@»')
    sql, n = re.subn(r'(?m)^-- @@161R@@.*$', lambda _: cuerpo_rollback(mutar), sql)
    if n != 1:
        sys.exit('161_pruebas.sql: falta el marcador «-- @@161R@@»')
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    # PSQL: cómo conectarse (por defecto, el Postgres 16 local del puerto 5499; p. ej. PSQL="sudo -u postgres psql")
    p = subprocess.run(PSQL + ['-d', db, '-At', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, capture_output=True, text=True)
    m = re.search(r'161-FALLAN: ([0-9a-z,()]+)', p.stderr)
    if m:
        return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
    if p.returncode != 0:
        sys.exit(f'ERROR: {p.stderr[:600]}')
    filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
    if not filas:
        sys.exit(f'SIN RESULTADO: {p.stdout[-400:]}')
    return json.loads(filas[-1])


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    db = args[args.index('--db') + 1] if '--db' in args else 'c161'
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar and mutar != 'todas' and mutar not in todas:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(todas)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar))
        return
    if '--local' not in args:
        sys.exit('usá --local (Postgres local) o --armar (imprime el SQL para staging)')
    if mutar:
        malas = []
        for nombre in (todas if mutar == 'todas' else [mutar]):
            caen = {c['caso'].split(' ')[0] for c in correr_local(armar(nombre), db) if not c['ok']}
            esperadas = todas[nombre][2]
            print(f"{'muerde' if esperadas <= caen else 'NO MUERDE'} {nombre}: caen {sorted(caen)} (esperadas {sorted(esperadas)})")
            if not esperadas <= caen:
                malas.append(nombre)
        sys.exit(1 if malas else 0)
    casos = correr_local(armar(None), db)
    for c in casos:
        print(f"{'OK ' if c['ok'] else 'MAL'} {c['caso']}" + ('' if c['ok'] else f"  ← {c.get('detalle')}"))
    malos = [c for c in casos if not c['ok']]
    print(f"\n{len(casos) - len(malos)}/{len(casos)} casos OK")
    sys.exit(1 if malos else 0)


if __name__ == '__main__':
    main()
