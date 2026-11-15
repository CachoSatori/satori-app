#!/usr/bin/env python3
"""
Corre scripts/sql/167_pruebas.sql (origen 113): llena los marcadores con el cuerpo de la 167 y de su rollback, todo dentro
de una transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/167_pruebas.py                         # STAGING (Management API; token del proxy o SUPABASE_ACCESS_TOKEN)
  python3 scripts/sql/167_pruebas.py --local "host=/tmp port=5499 user=pgv dbname=X" [--semilla-local]
                                                             # Postgres 16 local armado con 155→158 (con o sin la 157)
  python3 scripts/sql/167_pruebas.py ... --mutar sin_espera  # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/167_pruebas.py ... --mutar todas       # todas, una por una
  python3 scripts/sql/167_pruebas.py --armar [--mutar X]     # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios). En
staging no se usa: la batería toma un owner activo de la base.
Cada mutación reemplaza un pedazo del cuerpo de la 167 (o del rollback) y declara qué casos caen. El ASSERT final aborta
con «167-FALLAN: <casos>»: el runner lee los casos de ese error.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/167_club_resena_socios.sql'
ROLLBACK = RAIZ / 'scripts/sql/167_rollback.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8167-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8167-0000000000aa';
"""

# nombre → (texto de la 167, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # sin la espera de 90 días: vuelve enseguida
    'sin_espera': ("  if v_ult.id is not null and v_ult.mostrada_en > now() - make_interval(days => coalesce(v_g.resena_socio_espera_dias, 90)) then\n    return;   -- máximo un pedido cada X días\n  end if;\n",
                   "", {'7'}),
    # cuenta todas las visitas (no solo las que tienen beneficio)
    'cuenta_todas': ("   where vs.miembro_id = v_m.id and vs.estado_beneficio in ('aplica','pendiente_configuracion')\n     and (v_desde",
                     "   where vs.miembro_id = v_m.id\n     and (v_desde", {'3'}),
    # cuenta desde siempre (no desde el pedido anterior)
    'cuenta_desde_siempre': ("     and (v_desde is null or vs.registrada_en > v_desde);\n", ";\n", {'9'}),
    # el equipo también la recibe
    'equipo_si': ("  if v_m.tipo = 'equipo'\n     or exists (select 1 from public.club_miembro_roles r where r.miembro_id = v_m.id and r.rol = 'equipo' and r.estado = 'activo') then\n    return;\n  end if;\n",
                  "", {'11'}),
    # el socio pendiente también
    'pendiente_si': ("r.rol = 'socio' and r.estado = 'activo') then\n    return;", "r.rol = 'socio' and r.estado <> 'baja') then\n    return;", {'12'}),
    # sin link: se muestra igual (con el link de otro local o null)
    'sin_link_igual': ("                 from public.club_config c where c.location_id = v_loc and c.resena_url is not null;\n",
                       "                 from public.club_config c where c.resena_url is not null limit 1;\n", {'4'}),
    # el pedido mostrado sin cerrar no se sostiene (la cerrada no corta)
    'cerrada_no_corta': ("  if found and v_ult.cerrada_en is null and v_ult.clic_en is null then\n",
                         "  if found and v_ult.clic_en is null then\n", {'6'}),
    # el clic no corta la tarjeta (sigue a la vista después de tocar «Escribir una reseña»)
    'clic_no_corta': ("  if found and v_ult.cerrada_en is null and v_ult.clic_en is null then\n",
                      "  if found and v_ult.cerrada_en is null then\n", {'10', '10b'}),
    # la marca sin el portón de club-web
    'marca_sin_porton': ("  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  if v_tok !~ '^[0-9a-f]{64}$' then\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  if v_acc",
                         "  if v_tok !~ '^[0-9a-f]{64}$' then\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  if v_acc", {'14'}),
    # la interna queda abierta a anon
    'toca_abierta': ("revoke all on function public.club_resena_socio_toca(uuid) from public, anon, authenticated;\n",
                     "grant execute on function public.club_resena_socio_toca(uuid) to anon, authenticated;\n", {'0', '15'}),
    # la marca sin grant a anon
    'marca_sin_anon': ("grant execute on function public.club_portal_resena(text, text) to anon, authenticated;",
                       "grant execute on function public.club_portal_resena(text, text) to authenticated;", {'0', '15'}),
    # el N fijo en 5 (no lee la config)
    'n_fijo': ("  if v_n < coalesce(v_g.resena_socio_cada, 5) then return; end if;\n", "  if v_n < 5 then return; end if;\n", {'16'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback deja el envoltorio (no le devuelve el nombre a la de antes)
    'rollback_deja_envoltorio': ("    drop function if exists public.club_portal(text);\n    alter function public.club_portal_datos(text) rename to club_portal;\n",
                                 "    null;\n", {'18'}),
    # el rollback se olvida de volver a dar el portal a anon
    'rollback_sin_anon': ("grant execute on function public.club_portal(text) to anon, authenticated;\n",
                          "grant execute on function public.club_portal(text) to authenticated;\n", {'18'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 167')
        mig = mig.replace(viejo, nuevo)
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\n\$\$;\n', '', mig)
    return _sacar_beg_com(mig)


def cuerpo_rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en 167_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    rb = re.sub(r'(?s)\ndo \$\$\nbegin\n  if to_regprocedure\(\'public\.club_portal\(text\)\'\) is null.*?\nend\n\$\$;\n', '\n', rb)
    return _sacar_beg_com(rb)


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = (RAIZ / 'scripts/sql/167_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@167@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('167_pruebas.sql: falta el marcador «-- @@167@@» (o está repetido)')
    sql, n = re.subn(r'(?m)^-- @@167R@@.*$', lambda _: cuerpo_rollback(mutar), sql)
    if n != 1:
        sys.exit('167_pruebas.sql: falta el marcador «-- @@167R@@» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def _caidos_de(txt: str) -> list[dict] | None:
    m = re.search(r'167-FALLAN: ([0-9a-z,]+)', txt)
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
