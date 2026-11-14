#!/usr/bin/env python3
"""
Batería de la 162 (origen 108, Club → Embudo del anfitrión): arma scripts/sql/162_pruebas.sql con el cuerpo de la 162 y el
de su rollback, todo en UNA transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/162_pruebas.py --local [--db c162]          # Postgres 16 local (variable PSQL; por defecto puerto 5499)
  python3 scripts/sql/162_pruebas.py --local --mutar todas        # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/162_pruebas.py --armar [--mutar X]          # solo imprime el SQL (para staging, con firma)

Correrla en DOS bases: una con las migraciones de main (sin 157 ni 158) y otra con 157 y 158 encima: el caso 8a cambia
de camino según esté la columna del clic de reseña (las mutaciones marcadas «con 158» solo muerden en la segunda).
La base local tiene que tener las migraciones de main (shim de Supabase: roles anon/authenticated, auth.uid() que lee
request.jwt.claims). En staging el SQL de --armar se corre igual (ref hwiatgic…, nunca prod): crea sus propios locales,
usuarios y miembros de prueba dentro de la transacción y no deja nada.
"""
from __future__ import annotations
import json, os, re, shlex, subprocess, sys
from pathlib import Path

PSQL = shlex.split(os.environ.get('PSQL', 'psql -h /tmp -p 5499 -U pgv'))
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/162_club_embudo_anfitrion.sql'
ROLLBACK = RAIZ / 'scripts/sql/162_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/162_pruebas.sql'

_ROL = "  if v_rol is null or v_rol not in ('owner','manager') then"
# nombre → (texto de la 162, reemplazo, casos que tienen que caer, solo con la 158)
MUTACIONES: dict[str, tuple[str, str, set[str], bool]] = {
    'contador_entra': (_ROL, "  if v_rol is null or v_rol not in ('owner','manager','contador') then", {'1c', '6c'}, False),
    'cajero_entra': (_ROL, "  if v_rol is null or v_rol not in ('owner','manager','cajero') then", {'1d'}, False),
    'sin_mes_pasa': ("  if p_mes is null then\n    raise exception 'Mes no válido", "  if false then\n    raise exception 'Mes no válido",
                     {'1k'}, False),
    'sin_local': ("    if not public.puede_ver_local(p_location) then         -- 091: el manager ve solo sus locales\n"
                  "      raise exception 'Sin permiso' using errcode = '42501';\n    end if;\n", "", {'1h'}, False),
    'todos_sin_filtro': ("      from public.club_config c where c.location_id = any (public.mis_locales());",
                         "      from public.club_config c;", {'1i'}, False),
    # mes en UTC: C6 (31-mar 23:30 CR) pasa a abril y el de febrero (28-feb 23:00 CR) entra a marzo
    'mes_utc': ("  v_ini := v_mes::timestamp at time zone 'America/Costa_Rica';\n"
                "  v_fin := (v_mes + interval '1 month')::timestamp at time zone 'America/Costa_Rica';",
                "  v_ini := v_mes::timestamp at time zone 'UTC';\n"
                "  v_fin := (v_mes + interval '1 month')::timestamp at time zone 'UTC';", {'2b', '3a'}, False),
    # la anulada cuenta como factura (C3: elegida a mano una factura que después se anuló)
    'con_anuladas': ("from public.pos_ndf_tickets t where t.id in (select tid from cf) and t.estado = 'C'),",
                     "from public.pos_ndf_tickets t where t.id in (select tid from cf)),", {'2b', '3a'}, False),
    # venta = neta (sin restar la regalía)
    'sin_regalia': ("greatest(coalesce(n.neta, 0) - ft.regalia, 0) as cobrada", "coalesce(n.neta, 0) as cobrada", {'2c', '3a'}, False),
    # regalía mayor que la neta deja venta negativa
    'regalia_negativa': ("greatest(coalesce(n.neta, 0) - ft.regalia, 0) as cobrada", "coalesce(n.neta, 0) - ft.regalia as cobrada",
                         {'2c', '3a'}, False),
    'neta_con_17': ("sum(l.monto) filter (where l.familia is null or l.familia not in (6, 17, 20)) as neta",
                    "sum(l.monto) as neta", {'2c', '3a'}, False),
    # sin la factura elegida a mano
    'sin_cruce_manual': ("unnest(case when cm_t.id is not null then array[cm_t.id]\n"
                         "                                     else public.club_cruce_facturas(cu.location_id, cu.pos_ref, cu.factura_pos) end)",
                         "unnest(public.club_cruce_facturas(cu.location_id, cu.pos_ref, cu.factura_pos))", {'2f', '3a'}, False),
    # totales sumando las filas (F2 dos veces)
    'total_por_anfitrion': ("                  'facturas', count(fa.id),\n",
                            "                  'facturas', (select coalesce(sum(fi.facturas), 0) from fi),\n", {'3a'}, False),
    # el equipo no se distingue
    'sin_grupo_equipo': ("case when mi.tipo = 'equipo' then 'equipo' else 'anfitrion' end as grupo from mi",
                         "'anfitrion'::text as grupo from mi", {'2e', '2g', '3c', '8b'}, False),
    # sin cupones cuenta también bajas
    'sin_cupones_con_bajas': ("             where m.location_id = any (v_locs) and m.estado = 'activo'\n",
                              "             where m.location_id = any (v_locs)\n", {'3b'}, False),
    # vencido como vigente
    'vencido_vigente': ("count(*) filter (where cu.estado = 'vigente' and cu.vence_en > now()) as vigentes,",
                        "count(*) filter (where cu.estado = 'vigente') as vigentes,", {'2a'}, False),
    'sin_aviso_pos': ("       and not exists (select 1 from public.pos_ndf_tickets t\n",
                      "       and false and not exists (select 1 from public.pos_ndf_tickets t\n", {'5a', '5b'}, False),
    'sin_rastro': ("  perform public.club_auditar(case when p_exporte then 'exporte_embudo_anfitrion_csv' else 'ver_embudo_anfitrion' end,\n"
                   "    'club_embudo_anfitrion', null, null,\n"
                   "    jsonb_build_object('mes', to_char(v_mes, 'YYYY-MM'), 'local', coalesce(p_location, 'todos'), 'filas', v_n));\n",
                   "", {'6a', '6b'}, False),
    'exporte_sin_marca': ("case when p_exporte then 'exporte_embudo_anfitrion_csv' else 'ver_embudo_anfitrion' end",
                          "'ver_embudo_anfitrion'", {'6b'}, False),
    'anon_ejecuta': ("grant execute on function public.club_embudo_anfitrion(date, text, boolean) to authenticated;",
                     "grant execute on function public.club_embudo_anfitrion(date, text, boolean) to authenticated, anon;", {'0', '1j'}, False),
    # ── con la 158 ──
    'clic_apagado': ("  if v_resena then\n    execute", "  if false then\n    execute", {'8a'}, True),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str], bool]] = {
    'rollback_deja_funcion': ("drop function if exists public.club_embudo_anfitrion(date, text, boolean);\n", "", {'7'}, False),
}


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 162')
        mig = mig.replace(viejo, nuevo)
    # la verificación final aborta con algunas mutaciones (anon): se saca para que caigan los CASOS
    mig = re.sub(r'(?s)-- Verificación: la función existe.*?\nend \$\$;\n', '', mig)
    return sin_tx(mig)


def cuerpo_rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está en 162_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    rb = re.sub(r'(?s)\ndo \$\$\nbegin\n  if to_regprocedure.*?\nend \$\$;\n', '\n', rb)
    return sin_tx(rb)


def armar(mutar: str | None) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@162@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('162_pruebas.sql: falta el marcador «-- @@162@@»')
    sql, n = re.subn(r'(?m)^-- @@162R@@.*$', lambda _: cuerpo_rollback(mutar), sql)
    if n != 1:
        sys.exit('162_pruebas.sql: falta el marcador «-- @@162R@@»')
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    p = subprocess.run(PSQL + ['-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    m = re.search(r'162-FALLAN: ([0-9a-z,()]+)', p.stderr)
    if m:
        return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
    if p.returncode != 0:
        sys.exit(f'ERROR: {p.stderr[:600]}')
    filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
    if not filas:
        sys.exit(f'SIN RESULTADO: {p.stdout[-400:]}')
    return json.loads(filas[-1])


def tiene_158(db: str) -> bool:
    q = ("select count(*) from pg_attribute where attrelid = 'public.club_cupones'::regclass "
         "and attname = 'resena_clic_en' and not attisdropped")
    p = subprocess.run(PSQL + ['-d', db, '-Atc', q], capture_output=True, text=True)
    return p.stdout.strip() == '1'


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    db = args[args.index('--db') + 1] if '--db' in args else 'c162'
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar and mutar != 'todas' and mutar not in todas:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(todas)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar))
        return
    if '--local' not in args:
        sys.exit('usá --local (Postgres local) o --armar (imprime el SQL para staging)')
    if mutar:
        con158 = tiene_158(db)
        malas = []
        for nombre in (todas if mutar == 'todas' else [mutar]):
            if todas[nombre][3] and not con158:
                print(f'(se salta) {nombre}: necesita la 158 en la base')
                continue
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
