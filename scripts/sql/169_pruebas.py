#!/usr/bin/env python3
"""
Corre scripts/sql/169_pruebas.sql (origen 115): llena los marcadores con el cuerpo de la 169, la guarda y el cuerpo de su
rollback, todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/169_pruebas.py                         # STAGING (Management API; token del proxy o SUPABASE_ACCESS_TOKEN)
  python3 scripts/sql/169_pruebas.py --local "host=/tmp port=5499 user=pgv dbname=X" [--semilla-local]
                                                             # Postgres 16 local armado con las migraciones (con o sin la 168)
  python3 scripts/sql/169_pruebas.py ... --mutar dos_veces   # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/169_pruebas.py ... --mutar todas       # todas, una por una
  python3 scripts/sql/169_pruebas.py --armar [--mutar X]     # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios). En
staging no se usa: la batería toma un owner activo de la base.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/169_club_retos.sql'
ROLLBACK = RAIZ / 'scripts/sql/169_rollback.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8169-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8169-0000000000aa';
"""

# nombre → (texto de la 169, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # un borrador también cuenta (gana sin que el owner lo arme)
    'borrador_cuenta': ("     where r.estado = 'vigente' and v_v.location_id = any(r.locales)\n",
                        "     where r.estado <> 'terminada' and v_v.location_id = any(r.locales)\n", {'1'}),
    # el día de la semana en UTC en lugar de hora CR
    'franja_utc': ("     and extract(isodow from p_ts at time zone 'America/Costa_Rica')::int = any(p_reto.dias)\n",
                   "     and extract(isodow from p_ts at time zone 'UTC')::int = any(p_reto.dias)\n", {'2'}),
    # el fin de la franja incluido (15:00 cuenta)
    'franja_fin_incluido': ("                                                      and (p_ts at time zone 'America/Costa_Rica')::time <  p_reto.hora_hasta)\n",
                            "                                                      and (p_ts at time zone 'America/Costa_Rica')::time <= p_reto.hora_hasta)\n", {'2'}),
    # sin tope por año
    'sin_tope': ("  if v_n >= 3 then\n", "  if v_n >= 30 then\n", {'3'}),
    # sin chequeo de superposición
    'sin_superposicion': ("  if v_otro.id is not null then\n", "  if false then\n", {'4'}),
    # un reto armado se puede editar
    'armado_editable': ("       or new.estado <> 'terminada' then\n", "       and false then\n", {'5'}),
    # cuenta visitas, no días
    'cuenta_visitas': ("  select count(distinct j.jornada)::int\n",
                       "  select count(*)::int\n", {'6'}),
    # se entrega dos veces: ni el SELECT ni el UPDATE miran el estado, ni se mira si la visita ya se resolvió
    'dos_veces': ([("     where g.miembro_id = v_v.miembro_id and g.estado = 'disponible'\n     order by g.vence_en, g.ganada_en limit 1 for update;\n    exit when v_g.id is null or v_g.vence_en > now();\n",
                    "     where g.miembro_id = v_v.miembro_id and g.estado in ('disponible','usada')\n     order by g.vence_en, g.ganada_en limit 1 for update;\n    exit when v_g.id is null or v_g.vence_en > now();\n"),
                   ("   where g.id = v_g.id and g.estado = 'disponible'\n  returning g.id into v_id;",
                    "   where g.id = v_g.id\n  returning g.id into v_id;"),
                   ("  if v_a ? 'reto' or v_v.fecha <> v_hoy then\n", "  if v_v.fecha <> v_hoy then\n")], None, {'7'}),
    # el equipo también participa
    'equipo_si': ("       and m.tipo <> 'equipo'   -- D7: el equipo no es cliente (con y sin la 157)\n       and not exists (select 1 from public.club_miembro_roles e where e.miembro_id = m.id and e.rol = 'equipo' and e.estado = 'activo'))\n",
                  "       )\n", {'8'}),
    # el grupo de control también gana
    'control_gana': ("     and not public.club_reto_control(p_reto.id, p_reto.control_pct, p_miembro)\n", "\n", {'9'}),
    # sin la regla fija (va aunque la factura no tenga beneficio)
    'sin_regla_fija': ("  if v_v.estado_beneficio not in ('aplica','pendiente_configuracion') then\n", "  if false then\n", {'10'}),
    # no chequea que el artículo sea de ese local y esté activo
    'sin_activa': ("     and k.location_id = v_v.location_id and k.activa;\n", "     ;\n", {'11'}),
    # no vence
    'no_vence': ("    exit when v_g.id is null or v_g.vence_en > now();\n", "    exit when true;\n", {'12'}),
    # el portal sin el portón de club-web
    'portal_sin_porton': ("  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  if v_tok !~ '^[0-9a-f]{64}$' then\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  select m.id into v_id from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';\n  if not found then\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  return jsonb_build_object('retos'",
                          "  if v_tok !~ '^[0-9a-f]{64}$' then\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  select m.id into v_id from public.club_miembros m where m.token_portal = v_tok and m.estado = 'activo';\n  if not found then\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  return jsonb_build_object('retos'", {'13'}),
    # se puede armar un reto que empezó en el pasado
    'pasado': ("  if nullif(p_datos->>'desde', '')::date < v_hoy then\n", "  if false then\n", {'14'}),
    # opción B al revés: con la exigencia prendida cuenta cualquier visita (escaneos sin factura ganan)
    'exige_invertida': ("          or not coalesce((select g.retos_exige_factura", "          or coalesce((select g.retos_exige_factura", {'17'}),
    # vence a la hora en que se ganó (no al final del día CR mostrado)
    'vence_hora': ("    values (v_r.id, v_v.miembro_id, v_v.id, ((v_v.fecha + v_r.vence_dias + 1)::timestamp at time zone 'America/Costa_Rica'))",
                   "    values (v_r.id, v_v.miembro_id, v_v.id, now() + make_interval(days => v_r.vence_dias))", {'18'}),
    # la jornada es el día calendario (una noche que cruza la medianoche cuenta dos)
    'jornada_calendario': ("         - case when p_reto.hora_desde > p_reto.hora_hasta\n", "         - case when false\n", {'19'}),
    # se apilan las cortesías de premio (bienvenida/referir + reto en la misma visita)
    'premio_apilado': ("              where x->>'motivo' in ('primeros_90', 'premio_referido')) then\n",
                       "              where false) then\n", {'20'}),
    # se puede armar un reto en un local sin PoS con la exigencia prendida
    'sin_pos': ("      if not exists (select 1 from public.pos_ndf_tickets t\n", "      if false and not exists (select 1 from public.pos_ndf_tickets t\n", {'21'}),
    # un reto terminado sigue bloqueando su local
    'terminado_bloquea': ("   where r.estado = 'vigente' and new.estado = 'vigente' and r.id <> new.id and r.locales && new.locales",
                          "   where r.armado_en is not null and r.id <> new.id and r.locales && new.locales", {'4'}),
    # el manager (o cualquiera) guarda retos
    'guardar_sin_rol': ("  if v_rol is null or v_rol <> 'owner' then raise exception 'Sin permiso' using errcode = '42501'; end if;\n  if p_datos is null",
                        "  if p_datos is null", {'14'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback no mira si hay premios ganados
    'rollback_sin_guarda': ("  if to_regclass('public.club_retos_ganados') is not null and exists (select 1 from public.club_retos_ganados) then\n",
                            "  if false then\n", {'16a'}),
    # el rollback se olvida de la función del trigger (sin el DROP del trigger el rollback ni siquiera corre: lo frena Postgres)
    'rollback_sin_funcion': ("drop function if exists public.club_retos_visita_trg();\n", "", {'16b'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        for v, n in (viejo if isinstance(viejo, list) else [(viejo, nuevo)]):
            if mig.count(v) != 1:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 169')
            mig = mig.replace(v, n)
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\n\$\$;\n', '', mig)
    return _sacar_beg_com(mig)


def _rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en 169_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    return rb


def guarda(mutar: str | None) -> str:
    m = re.search(r'(?s)-- GUARDA-169 \(inicio\)\n(.*?)  -- GUARDA-169 \(fin\)', _rollback(mutar))
    if not m:
        sys.exit('169_rollback.sql: falta la GUARDA-169')
    return m.group(1)


def cuerpo_rollback(mutar: str | None) -> str:
    rb = _rollback(mutar)
    # sin la verificación final (la hace el caso 16b, para que una mutación caiga como caso y no como error)
    rb = re.sub(r'(?s)\ndo \$\$\nbegin\n  if to_regclass\(\'public\.club_retos\'\) is not null or.*?\nend\n\$\$;\n', '\n', rb)
    return _sacar_beg_com(rb)


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = (RAIZ / 'scripts/sql/169_pruebas.sql').read_text(encoding='utf-8')
    for marca, fn in (('@@169@@', cuerpo), ('@@169G@@', guarda), ('@@169R@@', cuerpo_rollback)):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'169_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def _caidos_de(txt: str) -> list[dict] | None:
    m = re.search(r'169-FALLAN: ([0-9a-z,]+)', txt)
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
