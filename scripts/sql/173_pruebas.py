#!/usr/bin/env python3
"""
Corre scripts/sql/173_pruebas.sql (origen club 119): llena los marcadores con el cuerpo de la 173 y el de su rollback,
todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/173_pruebas.py                         # STAGING (Management API; token del proxy o SUPABASE_ACCESS_TOKEN)
  python3 scripts/sql/173_pruebas.py --local "host=/tmp port=5499 user=pgv dbname=X" [--semilla-local]
                                                             # Postgres 16 local armado con las migraciones (con o sin la 172)
  python3 scripts/sql/173_pruebas.py ... --mutar sin_marca   # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/173_pruebas.py ... --mutar todas       # todas, una por una
  python3 scripts/sql/173_pruebas.py --armar [--mutar X]     # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios).
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/173_club_cumple_caja_portal_beneficio.sql'
ROLLBACK = RAIZ / 'scripts/sql/173_rollback.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8173-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8173-0000000000aa';
"""

# nombre → (texto de la 173, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # la guardia deja cargar sin que la función lo pida (cualquier función del dueño carga a un contacto viejo)
    'sin_marca': ("  if not v_tenia and v_base and v_carga in ('alta_caja', 'portal') then\n",
                  "  if not v_tenia and v_base then\n", {'05'}),
    # la marca deja también CAMBIAR uno cargado
    'marca_cambia': ("  if not v_tenia and v_base and v_carga in ('alta_caja', 'portal') then\n",
                     "  if v_base and v_carga in ('alta_caja', 'portal') then\n", {'05'}),
    # la marca del portal se puede borrar/poner a mano
    'marca_portal_libre': ("     and not (v_portal_antes is null and v_base and v_carga = 'portal') then\n",
                           "     and false then\n", {'09'}),
    # el portal deja cargarlo otra vez
    'portal_dos_veces': ("  if v_c.cumple_portal_en is not null or v_c.cumple_dia is not null then\n",
                         "  if v_c.cumple_dia is not null then\n", {'07'}),
    # el portal sin el portón de club-web
    'portal_sin_porton': ("  if not public.club_web_ok() then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;\n  if v_tok !~ '^[0-9a-f]{64}$' then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;\n  select m.id into v_id from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';\n  if not found or not exists",
                          "  if v_tok !~ '^[0-9a-f]{64}$' then raise exception 'Enlace no válido' using errcode = 'P0001'; end if;\n  select m.id into v_id from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';\n  if not found or not exists", {'08'}),
    # el portal sin exigir el permiso
    'portal_sin_permiso': ("  if p_permiso is not true or not public.club_cumple_valido(p_dia, p_mes) then\n",
                           "  if not public.club_cumple_valido(p_dia, p_mes) then\n", {'08'}),
    # la caja guarda sin el permiso (y sin validar antes del alta)
    'caja_sin_permiso': ("    if coalesce(p_cumple_permiso, false) is not true then\n      raise exception 'Para guardar",
                         "    if false then\n      raise exception 'Para guardar", {'03'}),
    # la caja pisa el que ya tenía
    'caja_pisa': ("    if exists (select 1 from public.club_miembros_contacto c where c.miembro_id = v_id and c.cumple_dia is not null) then\n",
                  "    if false then\n", {'04'}),
    # la caja no marca la carga (la guardia la rechaza: el alta con cumpleaños falla)
    'caja_sin_marcar': ("      perform set_config('club.cumple_carga', 'alta_caja', true);\n      update",
                        "      update", {'04'}),
    # el año de la marca es el de HOY (no el del cumpleaños): el 2-ene avisado el 28-dic vuelve a salir
    'anio_de_hoy': ([("  values (p_miembro, extract(year from v_f)::int, p_location, auth.uid())\n",
                      "  values (p_miembro, extract(year from p_hoy)::int, p_location, auth.uid())\n")], None, {'11'}),
    # el próximo cumpleaños sin cruzar el año
    'sin_cruzar_anio': ("              else public.club_cumple_fecha(p_dia, p_mes, extract(year from p_hoy)::int + 1) end\n",
                        "              else public.club_cumple_fecha(p_dia, p_mes, extract(year from p_hoy)::int) end\n", {'10', '11'}),
    # la ventana solo mira el año actual (el 3-ene no ve el 30-dic)
    'ventana_un_anio': ("                   from generate_series(-1, 1) k) x\n", "                   from generate_series(0, 0) k) x\n", {'10', '13'}),
    # el 29-feb no cae al 28 en año no bisiesto
    'sin_bisiesto': ("                   and not (p_anio % 4 = 0 and (p_anio % 100 <> 0 or p_anio % 400 = 0))\n",
                     "                   and false\n", {'10'}),
    # la lista no filtra los ya enviados
    'lista_sin_envios': ("                        where e.miembro_id = m.id and e.anio = extract(year from f.cumple)::int))\n",
                         "                        where false))\n", {'11'}),
    # la lista trae socios de baja
    'lista_bajas': ("      join public.club_miembro_roles r on r.miembro_id = m.id and r.rol = 'socio' and r.estado = 'activo'\n      join public.club_miembros_contacto c on c.miembro_id = m.id and c.cumple_dia",
                    "      join public.club_miembro_roles r on r.miembro_id = m.id and r.rol = 'socio'\n      join public.club_miembros_contacto c on c.miembro_id = m.id and c.cumple_dia", {'12'}),
    # la caja devuelve la fecha
    'caja_con_fecha': ("  return jsonb_build_object('aplica', true) || (",
                       "  return jsonb_build_object('aplica', true, 'cumple', public.club_cumple_en_ventana(v_c.cumple_dia, v_c.cumple_mes, p_hoy, v_cfg.dias_antes, v_cfg.dias_despues)) || (", {'13'}),
    # la caja aplica con el beneficio apagado
    'caja_apagado': ("  if not v_cfg.activo or v_c.cumple_dia is null", "  if v_c.cumple_dia is null", {'13'}),
    # guardar config sin chequeo de local del manager
    'config_sin_local': ([("  perform public.club_exigir_local(p_location);\n  p_location := public.club_local(p_location, false);\n  if jsonb_typeof(p_datos)",
                           "  p_location := public.club_local(p_location, false);\n  if jsonb_typeof(p_datos)")], None, {'14'}),
    # el cajero guarda la configuración
    'config_cajero': ([("  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then\n    raise exception 'Sin permiso' using errcode = '42501';\n  end if;\n  perform public.club_exigir_local(p_location);\n  p_location := public.club_local(p_location, false);\n  if jsonb_typeof",
                        "  if public.get_my_role() is null then\n    raise exception 'Sin permiso' using errcode = '42501';\n  end if;\n  perform public.club_exigir_local(p_location);\n  p_location := public.club_local(p_location, false);\n  if jsonb_typeof")], None, {'14'}),
    # encender sin artículo de cortesía
    'encender_sin_cortesia': ("  if v_n.activo and v_n.cortesia_id is null then\n", "  if false then\n", {'14'}),
    # el Inicio sin chequeo de local del manager
    'proximos_sin_local': ([("  perform public.club_exigir_local(p_location);\n  p_location := public.club_local(p_location, false);\n  return public.club_cumple_lista(",
                             "  p_location := public.club_local(p_location, false);\n  return public.club_cumple_lista(")], None, {'15'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback deja la guardia de la 173
    'rollback_sin_guardia': ("create or replace function public.club_contacto_cumple_guardia()\n",
                             "create or replace function pg_temp.club_contacto_cumple_guardia_mutada()\n", {'18'}),
    # el rollback no vuelve el aviso a v1.2
    'rollback_sin_aviso': ("update public.club_config set aviso_privacidad_version = 'v1.2' where aviso_privacidad_version = 'v1.3';\n", "", {'18'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        for v, n in (viejo if isinstance(viejo, list) else [(viejo, nuevo)]):
            if mig.count(v) != 1:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 173')
            mig = mig.replace(v, n)
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\nend\n\$\$;\n', '', mig)
    return _sacar_beg_com(mig)


def _rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en 173_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    return rb


def cuerpo_rollback(mutar: str | None) -> str:
    return _sacar_beg_com(_rollback(mutar))


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = (RAIZ / 'scripts/sql/173_pruebas.sql').read_text(encoding='utf-8')
    for marca, fn in (('@@173@@', cuerpo), ('@@173R@@', cuerpo_rollback)):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'173_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def _caidos_de(txt: str) -> list[dict] | None:
    m = re.search(r'173-FALLAN: ([0-9a-z,]+)', txt)
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
