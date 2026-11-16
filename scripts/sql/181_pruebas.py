#!/usr/bin/env python3
"""
Corre scripts/sql/181_pruebas.sql (origen club 126): llena los marcadores con el cuerpo de la 181 y el de su rollback,
todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/181_pruebas.py                         # STAGING sin la 181 (Management API; token del proxy o SUPABASE_ACCESS_TOKEN)
  python3 scripts/sql/181_pruebas.py --local "host=/tmp port=5499 user=pgv dbname=X" [--semilla-local]
                                                             # Postgres 16 local armado con las migraciones (sin la 181)
  python3 scripts/sql/181_pruebas.py ... --mutar tope_por_dia # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/181_pruebas.py ... --mutar todas       # todas, una por una
  python3 scripts/sql/181_pruebas.py --armar [--mutar X]     # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios).
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/181_club_tope_almuerzo_cena.sql'
ROLLBACK = RAIZ / 'scripts/sql/181_rollback.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8181-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8181-0000000000aa';
"""

# Las mutaciones del núcleo de excepciones cambian su md5 final: apagan la guarda de md5 de la migración y el rollback
# no puede volver ese núcleo (su guarda lo frena), así que se salta ese bloque del rollback y además cae el caso 12.
SIN_GUARDA_NUCLEO = ("  if md5(pg_get_functiondef(v_fn)) <> '94cf0df9d0b189322b27d4d8b208a3e0' then", "  if false then")
MUTA_NUCLEO = {'anomalo_por_dia', 'semana_por_visitas'}
SALTA_NUCLEO_RB = ("begin\n  if md5(v_def) <> '94cf0df9d0b189322b27d4d8b208a3e0' then", "begin\n  return;\n  if md5(v_def) <> '94cf0df9d0b189322b27d4d8b208a3e0' then")

# nombre → (texto de la 181, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # el tope vuelve a ser por DÍA (sin mirar la comida)
    'tope_por_dia': ("     and public.club_comida(v.location_id, v.registrada_en) = v_comida;\n", "     ;\n", {'01', '04', '05', '08'}),
    # cada visita con el corte del local de la CAJA, no el de su propio local
    'corte_de_la_caja': ("     and public.club_comida(v.location_id, v.registrada_en) = v_comida;\n",
                         "     and public.club_comida(p_location, v.registrada_en) = v_comida;\n", {'05'}),
    # el tope por local (no «en cualquier Satori»)
    'tope_por_local': ("   where v.miembro_id = p_miembro and v.fecha = v_dia and v.estado_beneficio",
                       "   where v.location_id = p_location and v.miembro_id = p_miembro and v.fecha = v_dia and v.estado_beneficio", {'05'}),
    # el corte en punto todavía es almuerzo
    'corte_inclusivo': ("  select case when (p_ts at time zone 'America/Costa_Rica')::time\n                   < coalesce(",
                        "  select case when (p_ts at time zone 'America/Costa_Rica')::time\n                   <= coalesce(", {'04'}),
    # la comida en hora UTC
    'comida_utc': ("  select case when (p_ts at time zone 'America/Costa_Rica')::time\n",
                   "  select case when (p_ts at time zone 'UTC')::time\n", {'01', '02', '04', '05'}),
    # el día en UTC
    'dia_utc': ("  v_dia    date := (p_ahora at time zone 'America/Costa_Rica')::date;\n",
                "  v_dia    date := (p_ahora at time zone 'UTC')::date;\n", {'06'}),
    # las visitas sin beneficio gastan la comida
    'cuenta_sin_beneficio': (" and v.estado_beneficio in ('aplica','pendiente_configuracion')\n",
                             " and v.estado_beneficio is not null\n", {'07'}),
    # el tope ignora la configuración
    'tope_fijo': ("  v_tope := coalesce(v_tope, 1);\n  -- en TODOS", "  v_tope := 1;\n  -- en TODOS", {'10'}),
    # la caja no frena (la base ignora el tope)
    'caja_sin_tope': ("  if not coalesce((v_tc->>'libre')::boolean, false) then\n", "  if false then\n", {'08'}),
    # la caja sigue con el texto viejo
    'texto_viejo': ("'texto', v_tc->>'texto', 'avisos'", "'texto', 'Ya usó su beneficio hoy en otro pedido: NO aplicar beneficio', 'avisos'", {'08'}),
    # el texto no dice desde cuándo vuelve
    'sin_vuelve': ("    'avisos', jsonb_build_array(v_vuelve, v_regla", "    'avisos', jsonb_build_array(v_regla, v_regla", {'02', '08'}),
    # la interna abierta a la API
    'interna_abierta': ("revoke all on function public.club_socio_tope_comida(uuid, text, timestamptz) from public, anon, authenticated;\n",
                        "grant execute on function public.club_socio_tope_comida(uuid, text, timestamptz) to authenticated;\n", {'11'}),
    # SOCIO_USO_ANOMALO vuelve a «dos mesas el mismo día» (sin la comida)
    'anomalo_por_dia': ([("'socio-comida:' || v.miembro_id || ':' || v.fecha || ':' || public.club_comida(v.location_id, v.registrada_en),",
                          "'socio-comida:' || v.miembro_id || ':' || v.fecha || ':almuerzo',"),
                         ("                              'comida', public.club_comida(v.location_id, v.registrada_en),\n",
                          "                              'comida', 'almuerzo',\n"),
                         ("     group by v.miembro_id, v.fecha, public.club_comida(v.location_id, v.registrada_en)\n",
                          "     group by v.miembro_id, v.fecha\n"), SIN_GUARDA_NUCLEO], None, {'13', '12'}),
    # el máximo semanal vuelve a contar visitas
    'semana_por_visitas': ([("    having count(distinct v.fecha) > v_cfg.socio_visitas_semana_max",
                             "    having count(*) > v_cfg.socio_visitas_semana_max"), SIN_GUARDA_NUCLEO], None, {'14', '12'}),
    # MISMO_USUARIO vuelve a contar visitas
    'mismo_usuario_por_visitas': ("(select case when a.que = 'socio' then count(distinct (b.f at time zone 'America/Costa_Rica')::date) else count(*) end",
                                  "(select count(*)", {'15'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback no vuelve el cuerpo de la 150 (deja el tope por comida)
    'rollback_sin_base': ("create or replace function public.club_socio_visita_base(", "create or replace function pg_temp.club_socio_visita_base_mutada(", {'12'}),
    # el rollback deja las alertas de la 181 (no vuelve la 164)
    'rollback_deja_alertas': ("create or replace function public.club_alertas_inicio(", "create or replace function pg_temp.club_alertas_inicio_mutada(", {'12'}),
    # el rollback deja las excepciones de la 181 (no vuelve la 155)
    'rollback_deja_excepciones': ("begin\n  if md5(v_def) <> '94cf0df9d0b189322b27d4d8b208a3e0' then", "begin\n  return;\n  if md5(v_def) <> '94cf0df9d0b189322b27d4d8b208a3e0' then", {'12'}),
    # el rollback deja la columna
    'rollback_deja_columna': ("alter table public.club_config_global drop column if exists socio_visitas_por_comida;\n", "", {'12'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        for v, n in (viejo if isinstance(viejo, list) else [(viejo, nuevo)]):
            if mig.count(v) != 1:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 181')
            mig = mig.replace(v, n)
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\nend\n\$\$;\n', '', mig)
    return _sacar_beg_com(mig)


def _rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTA_NUCLEO:
        rb = rb.replace(*SALTA_NUCLEO_RB)
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en 181_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    return rb


def cuerpo_rollback(mutar: str | None) -> str:
    return _sacar_beg_com(_rollback(mutar))


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = (RAIZ / 'scripts/sql/181_pruebas.sql').read_text(encoding='utf-8')
    for marca, fn in (('@@181@@', cuerpo), ('@@181R@@', cuerpo_rollback)):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'181_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def _caidos_de(txt: str) -> list[dict] | None:
    m = re.search(r'181-FALLAN: ([0-9a-z,]+)', txt)
    return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')] if m else None


def correr(sql: str, local: str | None) -> list[dict]:
    if local:
        p = subprocess.run(['psql', local, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
        if p.returncode != 0:
            caidos = _caidos_de(p.stderr)
            if caidos:
                return caidos
            sys.exit(f'ERROR: {p.stderr[:600]}')
        linea = next((l for l in p.stdout.splitlines() if l.startswith('[{')), None)
        if not linea:
            sys.exit(f'SIN RESULTADO: {p.stdout[:400]}')
        return json.loads(linea)
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        caidos = _caidos_de(txt)
        if caidos:
            return caidos
        sys.exit(f'ERROR: {txt[:400]}')
    casos = res[0].get('json_agg') if isinstance(res, list) and res else None
    if not isinstance(casos, list) or not casos:
        sys.exit(f'SIN RESULTADO: {str(res)[:400]}')
    return casos


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    local = args[args.index('--local') + 1] if '--local' in args else None
    semilla = '--semilla-local' in args
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar and mutar != 'todas' and mutar not in todas:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(todas)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar, semilla))
        return
    if mutar:
        malas = []
        for nombre in (todas if mutar == 'todas' else [mutar]):
            caen = {c['caso'].split(' ')[0] for c in correr(armar(nombre, semilla), local) if not c['ok']}
            esperadas = todas[nombre][2]
            print(f"{'muerde' if esperadas <= caen else 'NO MUERDE'} {nombre}: caen {sorted(caen)} (esperadas {sorted(esperadas)})")
            if not esperadas <= caen:
                malas.append(nombre)
        sys.exit(1 if malas else 0)
    casos = correr(armar(None, semilla), local)
    for c in casos:
        ver = c.get('detalle') and (not c['ok'] or c['caso'].startswith('00 '))
        print(('ok   ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if ver else ''))
    caen = [c for c in casos if not c['ok']]
    print(f'── {len(casos)} casos · {len(casos) - len(caen)} ok')
    sys.exit(1 if caen else 0)


if __name__ == '__main__':
    main()
