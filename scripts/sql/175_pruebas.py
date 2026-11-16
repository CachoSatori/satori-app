#!/usr/bin/env python3
"""
Corre scripts/sql/175_pruebas.sql (origen club 121): llena los marcadores con el cuerpo de la 175, la guarda y el cuerpo
de su rollback, todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/175_pruebas.py                         # STAGING (Management API; token del proxy o SUPABASE_ACCESS_TOKEN)
  python3 scripts/sql/175_pruebas.py --local "host=/tmp port=5499 user=pgv dbname=X" [--semilla-local]
                                                             # Postgres 16 local armado con las migraciones (con la 173)
  python3 scripts/sql/175_pruebas.py ... --mutar anio_de_hoy # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/175_pruebas.py ... --mutar todas       # todas, una por una
  python3 scripts/sql/175_pruebas.py --armar [--mutar X]     # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios).
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/175_club_cumple_uso_anual.sql'
ROLLBACK = RAIZ / 'scripts/sql/175_rollback.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8175-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8175-0000000000aa';
"""

# nombre → (texto de la 175, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # sin chequeo NI índice: la segunda marca del año entra (mismo local, otro local, ventana que cruza el año, públicas)
    'sin_freno': ([("  if coalesce((v_en->>'ya_uso')::boolean, false) then\n", "  if false then\n"),
                   ("create unique index if not exists club_cumple_usos_anio_uq on public.club_cumple_usos (miembro_id, anio) where deshecho_en is null;\n", "")],
                  None, {'02', '03', '05'}),   # 08 (misma visita) lo sigue frenando club_cumple_usos_visita_uq
    # el índice único es por local (no «en cualquier local»)
    'indice_por_local': ("on public.club_cumple_usos (miembro_id, anio) where deshecho_en is null;\n",
                         "on public.club_cumple_usos (miembro_id, anio, location_id) where deshecho_en is null;\n", {'03'}),
    # la caja mira solo los usos de ESTE local
    'ya_uso_por_local': ("where u.miembro_id = p_miembro and u.anio = extract(year from v_f)::int and u.deshecho_en is null))\n",
                         "where u.miembro_id = p_miembro and u.anio = extract(year from v_f)::int and u.deshecho_en is null and u.location_id = p_location))\n", {'03'}),
    # la caja nunca dice «ya lo usó»
    'caja_sin_ya_uso': ("           'ya_uso', exists (select 1 from public.club_cumple_usos u\n",
                        "           'ya_uso', false and exists (select 1 from public.club_cumple_usos u\n", {'01', '03', '08'}),
    # el año de la marca es el de HOY, no el del cumpleaños (el 3-ene por un 30-dic contaría para el año siguiente)
    'anio_de_hoy': ("    values (v_v.miembro_id, extract(year from v_f)::int, p_location,",
                    "    values (v_v.miembro_id, extract(year from p_hoy)::int, p_location,", {'01', '05'}),
    # la caja ve el año del cumpleaños
    'caja_ve_anio': ("  return jsonb_build_object('aplica', true,\n", "  return jsonb_build_object('aplica', true, 'anio', extract(year from v_f)::int,\n", {'01'}),
    # una marca deshecha sigue frenando (índice sin «where deshecho_en is null»)
    'deshecha_frena': ("on public.club_cumple_usos (miembro_id, anio) where deshecho_en is null;\n",
                       "on public.club_cumple_usos (miembro_id, anio);\n", {'07'}),
    # deshacer también el manager
    'deshacer_manager': ("  if public.get_my_role() is distinct from 'owner'::public.user_role then\n    raise exception 'Solo el owner",
                         "  if public.get_my_role() not in ('owner', 'manager') then\n    raise exception 'Solo el owner", {'07'}),
    # deshacer sin nota
    'deshacer_sin_nota': ("  if length(v_nota) not between 5 and 300 then\n", "  if false then\n", {'07'}),
    # la fila se edita a mano
    'guardia_libre': ("  if old.deshecho_en is not null\n     or (new.id,", "  if false and (new.id,", {'07'}),
    # marcar sin el chequeo de local del manager
    'usar_sin_local': ([("  perform public.club_exigir_local(p_location);\n  p_location := public.club_local(p_location, true);\n  return public.club_cumple_usar_dia(",
                         "  p_location := public.club_local(p_location, true);\n  return public.club_cumple_usar_dia(")], None, {'08'}),
    # marcar sobre una visita de otro día o de otro local
    'visita_cualquiera': ("  if not found or v_v.location_id is distinct from p_location or v_v.fecha is distinct from p_hoy then\n",
                          "  if not found then\n", {'06'}),
    # marcar fuera de la ventana / con el beneficio apagado / socio de otro local
    'sin_ventana': ("  if not coalesce((v_en->>'aplica')::boolean, false) then\n", "  if false then\n", {'06'}),
    # el resumen cuenta las deshechas como usos
    'resumen_con_deshechas': ("    select count(*) filter (where vigente) as usos,\n", "    select count(*) as usos,\n", {'09'}),
    # el resumen a precio de lista (sin el % de costo)
    'resumen_sin_pct': ("    'cortesias_costo_crc', round(t.lista * coalesce(c.cortesia_costo_pct, 0) / 100))\n",
                        "    'cortesias_costo_crc', round(t.lista))\n", {'09'}),
    # el contador ve la lista con nombres
    'lista_contador': ([("  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then\n    raise exception 'Sin permiso' using errcode = '42501';\n  end if;\n  perform public.club_exigir_local(p_location);\n  p_location := public.club_local(p_location, false);\n  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then\n    raise exception 'Período no válido (hasta 400 días)' using errcode = 'P0001';\n  end if;\n  return coalesce((",
                         "  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager','contador') then\n    raise exception 'Sin permiso' using errcode = '42501';\n  end if;\n  perform public.club_exigir_local(p_location);\n  p_location := public.club_local(p_location, false);\n  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then\n    raise exception 'Período no válido (hasta 400 días)' using errcode = 'P0001';\n  end if;\n  return coalesce((")],
                       None, {'09'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback borra las marcas sin avisar
    'rollback_sin_guarda': ("  if to_regclass('public.club_cumple_usos') is not null and exists (select 1 from public.club_cumple_usos) then\n",
                            "  if false then\n", {'11a'}),
    # el rollback deja la tabla
    'rollback_deja_tabla': ("drop table if exists public.club_cumple_usos;\ndrop function if exists public.club_cumple_usos_guardia();\n", "", {'11'}),
    # el rollback deja la caja con «ya_uso» (no vuelve el cuerpo de la 173)
    'rollback_sin_caja_173': ("create or replace function public.club_cumple_en_caja_dia(", "create or replace function pg_temp.club_cumple_en_caja_dia_mutada(", {'11'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        for v, n in (viejo if isinstance(viejo, list) else [(viejo, nuevo)]):
            if mig.count(v) != 1:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 175')
            mig = mig.replace(v, n)
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\nend\n\$\$;\n', '', mig)
    return _sacar_beg_com(mig)


def _rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en 175_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    return rb


def cuerpo_rollback(mutar: str | None) -> str:
    return _sacar_beg_com(_rollback(mutar))


def guarda_rollback(mutar: str | None) -> str:
    """Caso 11a: la guarda REAL del rollback (su primer bloque do), corrida con marcas: tiene que abortar."""
    rb = _rollback(mutar)
    m = re.search(r'(?s)\ndo \$\$\n.*?\nend \$\$;\n', rb)
    if not m:
        sys.exit('175_rollback.sql: falta su guarda (primer bloque do)')
    return ("insert into _r175 (caso, ok, detalle)\nselect '11a rollback con marcas → aborta (guarda real del rollback)', "
            "coalesce(e like '175 rollback: hay marcas de cumpleaños%', false), e\n  from (select pg_temp.error_de($rg$"
            + m.group(0).strip() + "$rg$) as e) x;")


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = (RAIZ / 'scripts/sql/175_pruebas.sql').read_text(encoding='utf-8')
    for marca, fn in (('@@175@@', cuerpo), ('@@175RG@@', guarda_rollback), ('@@175R@@', cuerpo_rollback)):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'175_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def _caidos_de(txt: str) -> list[dict] | None:
    m = re.search(r'175-FALLAN: ([0-9a-z,]+)', txt)
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
