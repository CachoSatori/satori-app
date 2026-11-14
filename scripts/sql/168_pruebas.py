#!/usr/bin/env python3
"""
Corre scripts/sql/168_pruebas.sql (origen 114): llena los marcadores con el cuerpo de la 168, la guarda y el cuerpo de su
rollback, todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/168_pruebas.py                         # STAGING (Management API; token del proxy o SUPABASE_ACCESS_TOKEN)
  python3 scripts/sql/168_pruebas.py --local "host=/tmp port=5499 user=pgv dbname=X" [--semilla-local]
                                                             # Postgres 16 local armado con las migraciones (con o sin la 157)
  python3 scripts/sql/168_pruebas.py ... --mutar dos_veces   # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/168_pruebas.py ... --mutar todas       # todas, una por una
  python3 scripts/sql/168_pruebas.py --armar [--mutar X]     # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios). En
staging no se usa: la batería toma un owner activo de la base.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/168_club_primeros_90.sql'
ROLLBACK = RAIZ / 'scripts/sql/168_rollback.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8168-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8168-0000000000aa';
"""

# nombre → (texto de la 168, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # el alta NO cuenta como la 1.ª visita
    'alta_no_cuenta': ("  select 1 + count(distinct vs.fecha)::int\n", "  select count(distinct vs.fecha)::int\n", {'2', '3'}),
    # cuenta visitas, no días (dos visitas el mismo día suman dos)
    'cuenta_visitas': ("  select 1 + count(distinct vs.fecha)::int\n", "  select 1 + count(*)::int\n", {'3'}),
    # sin ventana de 90 días al ganar (la visita del día 95 gana igual)
    'sin_ventana': ("     and v_v.fecha - v_alta < v_g.primeros90_dias\n", "", {'5'}),
    # el equipo también participa
    'equipo_si': ("     and m.tipo <> 'equipo'   -- D7: el equipo no es cliente (con y sin la 157)\n     and not exists (select 1 from public.club_miembro_roles e where e.miembro_id = m.id and e.rol = 'equipo' and e.estado = 'activo')\n",
                  "\n", {'6'}),
    # el grupo de control también
    'control_si': ("where m.id = p_miembro and m.estado = 'activo' and not m.sin_avance\n",
                   "where m.id = p_miembro and m.estado = 'activo'\n", {'7'}),
    # encendido por defecto
    'encendido': ("add column if not exists primeros90_activo boolean not null default false;",
                  "add column if not exists primeros90_activo boolean not null default true;", {'0', '1'}),
    # se ofrece dos veces: ni el SELECT ni el UPDATE miran el estado (cualquiera de los dos solo ya la frena)
    'dos_veces': ([("  select * into v_p from public.club_primeros90 p where p.miembro_id = v_v.miembro_id and p.estado = 'disponible' for update;\n",
                    "  select * into v_p from public.club_primeros90 p where p.miembro_id = v_v.miembro_id for update;\n"),
                   ("   where p.id = v_p.id and p.estado = 'disponible'\n  returning p.id into v_id;",
                    "   where p.id = v_p.id\n  returning p.id into v_id;")], None, {'4'}),
    # (el UPDATE condicionado «where estado = 'disponible'» lo muerde 168_concurrencia.sh: dos conexiones a la vez)
    # no chequea que el artículo esté activo
    'sin_activa': ("   where k.id = v_cfg.primeros90_cortesia_id and k.location_id = v_v.location_id and k.activa;\n",
                   "   where k.id = v_cfg.primeros90_cortesia_id;\n", {'9'}),
    # sin la regla fija (va aunque la factura no tenga beneficio)
    'sin_regla_fija': ("  if v_est not in ('aplica','pendiente_configuracion') then\n", "  if false then\n", {'10'}),
    # no vence
    'no_vence': ("  if v_p.vence_en <= now() then\n", "  if false then\n", {'14'}),
    # el portal sin el portón de club-web
    'portal_sin_porton': ("  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  if v_tok !~ '^[0-9a-f]{64}$' then\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  select m.id into v_id",
                          "  if v_tok !~ '^[0-9a-f]{64}$' then\n    raise exception 'Enlace no válido' using errcode = 'P0001';\n  end if;\n  select m.id into v_id", {'12'}),
    # el owner puede elegir una cortesía inactiva
    'config_inactiva': ("    if not v_k.activa then raise exception", "    if false then raise exception", {'13'}),
    # la interna queda abierta
    'interna_abierta': ("revoke all on function public.club_primeros90_avance(uuid)               from public, anon, authenticated;\n",
                        "grant execute on function public.club_primeros90_avance(uuid) to anon, authenticated;\n", {'0'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback no mira si hay cortesías ganadas
    'rollback_sin_guarda': ("  if to_regclass('public.club_primeros90') is not null and exists (select 1 from public.club_primeros90) then\n",
                            "  if false then\n", {'15a'}),
    # el rollback se olvida de devolverle la visita a la caja
    'rollback_sin_grant': ("grant execute on function public.club_socio_visita(uuid, jsonb, uuid, text) to authenticated;\n",
                           "\n", {'15b'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        for v, n in (viejo if isinstance(viejo, list) else [(viejo, nuevo)]):
            if mig.count(v) != 1:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 168')
            mig = mig.replace(v, n)
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\n\$\$;\n', '', mig)
    return _sacar_beg_com(mig)


def _rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en 168_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    return rb


def guarda(mutar: str | None) -> str:
    m = re.search(r'(?s)-- GUARDA-168 \(inicio\)\n(.*?)  -- GUARDA-168 \(fin\)', _rollback(mutar))
    if not m:
        sys.exit('168_rollback.sql: falta la GUARDA-168')
    return m.group(1)


def cuerpo_rollback(mutar: str | None) -> str:
    rb = _rollback(mutar)
    # sin la verificación final (la hace el caso 15b, para que una mutación caiga como caso y no como error)
    rb = re.sub(r'(?s)\ndo \$\$\nbegin\n  if to_regprocedure\(\'public\.club_socio_visita\(uuid,jsonb,uuid,text\)\'\) is null.*?\nend\n\$\$;\n', '\n', rb)
    return _sacar_beg_com(rb)


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = (RAIZ / 'scripts/sql/168_pruebas.sql').read_text(encoding='utf-8')
    for marca, fn in (('@@168@@', cuerpo), ('@@168G@@', guarda), ('@@168R@@', cuerpo_rollback)):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'168_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def _caidos_de(txt: str) -> list[dict] | None:
    m = re.search(r'168-FALLAN: ([0-9a-z,]+)', txt)
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
