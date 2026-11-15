#!/usr/bin/env python3
"""
Batería de la 166 (origen 112, Club → campañas con grupo de control): arma scripts/sql/166_pruebas.sql con el cuerpo de la 166 y el de su
rollback, todo en UNA transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/166_pruebas.py --local [--db c166]          # Postgres 16 local (variable PSQL; por defecto puerto 5499)
  python3 scripts/sql/166_pruebas.py --local --mutar todas             # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/166_pruebas.py --armar [--mutar X]               # solo imprime el SQL (para staging, con firma)

La base local tiene que tener las migraciones de main (shim de Supabase: roles anon/authenticated, auth.uid() que
lee request.jwt.claims). En staging el SQL de --armar se corre igual (ref hwiatgic…, nunca prod): crea sus propios
locales, usuarios y miembros de prueba dentro de la transacción y no deja nada.
"""
from __future__ import annotations
import json, os, re, shlex, subprocess, sys
from pathlib import Path

PSQL = shlex.split(os.environ.get('PSQL', 'psql -h /tmp -p 5499 -U pgv'))
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/166_club_grupo_control.sql'
ROLLBACK = RAIZ / 'scripts/sql/166_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/166_pruebas.sql'

# nombre → (texto de la 166, reemplazo, casos que tienen que caer)
_ROL_CO = "  if v_rol is null or v_rol not in ('owner','manager','contador') then"
_ROL_RK = ("  -- Solo owner y manager: el ranking tiene nombres (el contador lee totales en otras pantallas).\n"
           "  if v_rol is null or v_rol not in ('owner','manager') then")
_ROL_CREAR = ("  if v_rol is null or v_rol <> 'owner' then\n    raise exception 'Sin permiso' using errcode = '42501';\n  end if;\n"
              "  if p_nombre is null")
_ROL_OWNER = ("  if v_rol is null or v_rol <> 'owner' then\n    raise exception 'Sin permiso' using errcode = '42501';\n  end if;\n"
              "  select * into v_c from public.club_campanas c where c.id = p_campana;")
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # el sorteo no es fijo (azar en cada inserción): no se puede recalcular
    'sorteo_al_azar': ("  new.sorteo := public.club_campana_sorteo(v_c.semilla, v_c.id, new.miembro_id);\n",
                       "  new.sorteo := round(random()::numeric, 9);\n", {'4a', '5e'}),
    # el grupo lo elige quien inserta (todo entra como 'oferta')
    'grupo_de_quien_inserta': ("  new.grupo := case when new.sorteo < v_c.control_pct / 100 then 'control' else 'oferta' end;\n", "",
                               {'3b', '3c', '4a', '5e'}),
    # se puede reasignar y borrar
    'reasigna': ("create trigger club_campana_asig_inmutable_trg before update or delete on public.club_campana_asignaciones\n"
                 "  for each row execute function public.club_campana_inmutable();\n", "", {'5a', '5b'}),
    'cambia_semilla': ("create trigger club_campanas_inmutable_trg before update or delete on public.club_campanas\n"
                       "  for each row execute function public.club_campana_guardia();\n", "", {'5c', '10e'}),
    # ── una campaña abierta por local y fuente; cierre explícito (verificador de #185) ──
    'dos_abiertas': ("  if found then\n    raise exception 'Ya hay una campaña abierta", "  if false then\n    raise exception 'Ya hay una campaña abierta", {'10a'}),
    'sin_indice': ("create unique index if not exists club_campanas_una_abierta_uq on public.club_campanas (location_id, fuente) where cerrada_en is null;\n",
                   "", {'10e'}),
    'reabre': ("  if tg_op = 'UPDATE' and old.cerrada_en is null and new.cerrada_en is not null\n", "  if tg_op = 'UPDATE'\n", {'10e'}),
    'cierre_sin_rastro': ("  perform public.club_auditar('campana_cerrar', 'club_campanas', v_c.id, null,\n",
                          "  perform public.club_auditar('otra_cosa', 'club_campanas', null, null,\n", {'10d'}),
    'cerrada_suma': ("  if v_c.cerrada_en is not null then\n    raise exception 'La campaña está cerrada: no suma a nadie'",
                     "  if false then\n    raise exception 'La campaña está cerrada: no suma a nadie'", {'10c'}),
    'semilla_elegida': ("  new.semilla := encode(extensions.gen_random_bytes(16), 'hex');\n", "", {'10f'}),
    # el CSV no filtra a quien pasó a baja después de asignado
    'csv_con_baja': ("\n     and (not coalesce(p_exporte, false) or m.estado = 'activo');", "\n     ;", {'6b', '6e'}),
    'truncate_libre': ("create trigger club_campana_asig_truncate_trg before truncate on public.club_campana_asignaciones\n"
                       "  for each statement execute function public.club_campana_inmutable();\n", "", {'5f'}),
    # el CSV y la lista traen también al control
    'csv_con_control': ("   where a.campana_id = v_c.id and a.grupo = 'oferta'      --", "   where a.campana_id = v_c.id      --", {'6a', '6b'}),
    # el contacto sale sin permiso
    'contacto_sin_optin': ("'whatsapp', case when k.optin_whatsapp then k.telefono end,", "'whatsapp', k.telefono,", {'6b'}),
    'manager_arma': (_ROL_CREAR, _ROL_CREAR.replace("v_rol <> 'owner'", "v_rol not in ('owner','manager')"), {'1b'}),
    'manager_ve': (_ROL_OWNER, _ROL_OWNER.replace("v_rol <> 'owner'", "v_rol not in ('owner','manager')"), {'1g'}),
    'pct_sin_tope': ("p_control_pct < 0 or p_control_pct > 50 then", "p_control_pct < 0 or p_control_pct > 100 then", {'2a'}),
    # (TRUNCATE de club_campanas: su trigger y la FK con TRUNCATE de asignaciones (que también lo rechaza) se cubren
    # entre sí; sacar uno solo no lo abre: no hay mutación de uno)
    # (la fuente «reto» tiene dos guardas, en crear y en sumar: sacar una sola no la abre; no hay mutación de una)
    # «A contactar» con los ya vencidos y con el equipo
    'con_vencidos': ("   where s.creditos > 0 and s.vence_en >= now() and", "   where s.creditos > 0 and", {'3a'}),
    'con_equipo': ("m.tipo in ('referente', 'concierge_pm') and m.estado = 'activo'", "m.estado = 'activo'", {'3a'}),
    'con_baja': ("m.tipo in ('referente', 'concierge_pm') and m.estado = 'activo'", "m.tipo in ('referente', 'concierge_pm')", {'3a'}),
    'sin_rastro_semilla': ("                       'semilla', v_c.semilla, 'inicio', v_c.inicio) || v_t);",
                           "                       'inicio', v_c.inicio) || v_t);", {'4b'}),
    # una factura cuenta una vez por miembro, no por grupo (F1 dos veces)
    'factura_por_miembro': ("  fg as (select distinct a.grupo, reg.tid from reg", "  fg as (select a.grupo, reg.tid from reg", {'7a'}),
    'neta_con_17': ("sum(l.monto) filter (where l.familia is null or l.familia not in (6, 17, 20))\n",
                    "sum(l.monto)\n", {'7a'}),
    'sin_regalia': ("                    - coalesce(t.regalia_crc, 0), 0) as cobrada", "                    , 0) as cobrada", {'7a'}),
    'anulada_cuenta': ("      from fg join public.pos_ndf_tickets t on t.id = fg.tid and t.estado = 'C'),",
                       "      from fg join public.pos_ndf_tickets t on t.id = fg.tid),", {'7b'}),
    'sin_cruce_manual': ("unnest(case when cm_t.id is not null then array[cm_t.id]", "unnest(case when false then array[cm_t.id]", {'7a'}),
    # la ventana no arranca el día de la asignación (cuenta la visita de ayer de O3)
    'ventana_sin_inicio': ("     where v.location_id = v_c.location_id and v.registrada_en >= a.ini and v.registrada_en < a.fin\n    union\n    select m.miembro_id, (m.fecha_visita",
                           "     where v.location_id = v_c.location_id and v.registrada_en < a.fin\n    union\n    select m.miembro_id, (m.fecha_visita",
                           {'7a'}),
    # cualquier local
    'otro_local': ("     where v.location_id = v_c.location_id and v.registrada_en >= a.ini and v.registrada_en < a.fin\n    union\n    select m.miembro_id, (m.fecha_visita",
                   "     where v.registrada_en >= a.ini and v.registrada_en < a.fin\n    union\n    select m.miembro_id, (m.fecha_visita",
                   {'7b'}),
    'nunca_no_concluyente': ("    'no_concluyente', (select bool_or(g.miembros < c_minimo) from g),", "    'no_concluyente', false,", {'7e', '7f'}),
    'promedio_cero': ("'venta_por_miembro_crc', case when g.miembros > 0 then round(g.venta / g.miembros) end)",
                      "'venta_por_miembro_crc', case when g.miembros > 0 then round(g.venta / g.miembros) else 0 end)", {'7f'}),
    'lectura_sin_dedup': ("  if p_apertura is not null and exists (", "  if false and exists (", {'8a'}),
    'exporte_sin_rastro': ("    perform public.club_auditar('exporte_campana_csv', 'club_campanas', v_c.id, null,\n"
                           "      jsonb_build_object('campana', v_c.id, 'local', v_c.location_id, 'filas', v_n));\n", "    null;\n", {'8b'}),
    'anon_ejecuta': ("grant execute on function public.club_campana_reporte(uuid, uuid)                      to authenticated;",
                     "grant execute on function public.club_campana_reporte(uuid, uuid)                      to authenticated, anon;", {'0'}),
    'tabla_abierta': ("revoke all on public.club_campana_asignaciones from public, anon, authenticated;",
                      "revoke all on public.club_campana_asignaciones from public, anon;\ngrant select on public.club_campana_asignaciones to authenticated;\n"
                      "create policy p166 on public.club_campana_asignaciones for select to authenticated using (true);", {'0', '5g'}),
}
# mutaciones del rollback
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    'rollback_deja_reporte': ("drop function if exists public.club_campana_reporte(uuid, uuid);\n", "", {'9'}),
    'rollback_deja_sorteo': ("drop function if exists public.club_campana_sorteo(text, uuid, uuid);\n", "", {'9'}),
    'rollback_deja_ledger': ("delete from supabase_migrations.schema_migrations where version = '166';\n", "", {'9'}),
}

def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 166')
        mig = mig.replace(viejo, nuevo)
    # la verificación final de la 166 aborta con algunas mutaciones (anon): se saca para que caigan los CASOS
    mig = re.sub(r'(?s)-- Verificación: tablas con RLS.*?\nend \$\$;\n', '', mig)
    return sin_tx(mig)


def cuerpo_rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está en 166_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    rb = re.sub(r'(?s)\ndo \$\$\nbegin\n  if to_regclass\(\'public.club_campanas\'\) is not null or.*?\nend \$\$;\n', '\n', rb)
    return sin_tx(rb)


def armar(mutar: str | None) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@166@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('166_pruebas.sql: falta el marcador «-- @@166@@»')
    sql, n = re.subn(r'(?m)^-- @@166R@@.*$', lambda _: cuerpo_rollback(mutar), sql)
    if n != 1:
        sys.exit('166_pruebas.sql: falta el marcador «-- @@166R@@»')
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    # PSQL: cómo conectarse (por defecto, el Postgres 16 local del puerto 5499; p. ej. PSQL="sudo -u postgres psql")
    p = subprocess.run(PSQL + ['-d', db, '-At', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, capture_output=True, text=True)
    m = re.search(r'166-FALLAN: ([0-9a-z,()]+)', p.stderr)
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
    db = args[args.index('--db') + 1] if '--db' in args else 'c166'
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
