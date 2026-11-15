#!/usr/bin/env python3
"""
Batería de la 164 (origen 110, Club → alertas con umbral del Inicio): arma scripts/sql/164_pruebas.sql con el cuerpo de la
164 y el de su rollback, todo en UNA transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/164_pruebas.py --local [--db c164]          # Postgres 16 local (variable PSQL; por defecto puerto 5499)
  python3 scripts/sql/164_pruebas.py --local --mutar todas        # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/164_pruebas.py --armar [--mutar X]          # solo imprime el SQL (para staging, ref hwiatgic…)

Correrla en dos bases: una con las migraciones de main y otra con la 157 (equipo sin créditos) encima: tiene que dar lo
mismo. La base local necesita el shim de Supabase (roles anon/authenticated, auth.uid() que lee request.jwt.claims).
"""
from __future__ import annotations
import json, os, re, shlex, subprocess, sys
from pathlib import Path

PSQL = shlex.split(os.environ.get('PSQL', 'psql -h /tmp -p 5499 -U pgv'))
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/164_club_alertas_umbral.sql'
ROLLBACK = RAIZ / 'scripts/sql/164_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/164_pruebas.sql'

# nombre → (texto de la 164, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    'contador_entra': ("v_rol not in ('owner','manager') then", "v_rol not in ('owner','manager','contador') then", {'1c'}),
    'cajero_entra': ("v_rol not in ('owner','manager') then", "v_rol not in ('owner','manager','cajero') then", {'1d'}),
    'sin_local': ("  if not public.puede_ver_local(p_location) then", "  if false then", {'1g'}),
    'apagado_cuenta': ("  if not public.club_local_activo(p_location) then return; end if;", "", {'1j'}),
    # ventana de revisión en UTC: A10 (30 min antes del inicio de ayer CR) entra
    'ventana_utc': ("  v_desde := (v_hoy - 1)::timestamp at time zone 'America/Costa_Rica';",
                    "  v_desde := (v_hoy - 1)::timestamp at time zone 'UTC';", {'2h', '2j'}),
    'con_carga_inicial': ("       and m.origen <> 'migracion'                                     -- la carga inicial no cuenta (como la 155)\n",
                          "", {'2c', '2j'}),
    'sin_pendientes': ("     where pp.location_id = p_location and pp.movimiento_id is null",
                       "     where false and pp.location_id = p_location and pp.movimiento_id is null", {'2d', '2j'}),
    'aprobadas_doble': ("     where pp.location_id = p_location and pp.movimiento_id is null",
                        "     where pp.location_id = p_location", {'2g', '2j'}),
    'sin_ventana_24h': ("b.f > a.f - interval '24 hours' and b.f <= a.f", "b.f <= a.f", {'2e', '2j'}),
    'umbral_mayor_igual': ("   where mx.n > v_cfg.alerta_anfitrion_24h_max", "   where mx.n >= v_cfg.alerta_anfitrion_24h_max", {'2b', '2j'}),
    'sin_local_a': ("     where m.location_id = p_location and m.tipo = 'tarjeta' and m.personas > 0\n       and m.origen <> 'migracion'",
                    "     where m.tipo = 'tarjeta' and m.personas > 0\n       and m.origen <> 'migracion'", {'2i', '2j'}),
    'b_sin_usuario': ("b.miembro_id = a.miembro_id and b.usuario = a.usuario and b.que = a.que",
                      "b.miembro_id = a.miembro_id and b.que = a.que", {'3b', '3f'}),
    'b_sin_dias': ("               and b.f > a.f - make_interval(days => v_cfg.alerta_mismo_usuario_dias) and b.f <= a.f",
                   "               and b.f <= a.f", {'3c', '3f'}),
    'b_sin_equipo': ("       and mi.tipo = 'equipo' and m.registrado_por is not null",
                     "       and false and m.registrado_por is not null", {'3d', '3f'}),
    'b_todo_anfitrion': ("       and mi.tipo = 'equipo' and m.registrado_por is not null",
                         "       and m.registrado_por is not null", {'3e', '3f'}),
    'c_siempre': ("  if v_n > v_cfg.alerta_visitas_sin_factura_max then", "  if true then", {'1k'}),
    'd_con_resueltas': ("'CANJE_SIN_CODIGO') e where not e.resuelta;", "'CANJE_SIN_CODIGO') e;", {'4b'}),
    'd_umbral_fijo': ("  if v_n > v_cfg.alerta_canjes_sin_codigo_max then", "  if v_n > 0 then", {'5c'}),
    'sin_check': ("  check (alerta_anfitrion_24h_max between 1 and 100);", ";", {'5d'}),
    'invoker': ("security definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_rol   public.user_role",
                "security invoker\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_rol   public.user_role", {'0'}),
    'null_sin_filtro_local': ("                  where c.club_activo and public.puede_ver_local(c.location_id) order by c.location_id loop",
                              "                  where c.club_activo order by c.location_id loop", {'1m', '1n'}),
    'multilocal_fijo': ("a.detalle || jsonb_build_object('multilocal', v_multi)", "a.detalle || jsonb_build_object('multilocal', false)", {'1l'}),
    'refs_sin_local': ("'canjes-sin-codigo:' || p_location || ':' || v_hoy", "'canjes-sin-codigo:' || v_hoy", {'1o'}),
    'anon_ejecuta': ("grant execute on function public.club_alertas_inicio(text) to authenticated;",
                     "grant execute on function public.club_alertas_inicio(text) to authenticated, anon;", {'0'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    'rollback_deja_funcion': ("drop function if exists public.club_alertas_inicio(text);\n", "", {'7'}),
    'rollback_deja_ledger': ("delete from supabase_migrations.schema_migrations where version = '164';\n", "", {'7'}),
}


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def reemplazar(txt: str, mutar: str, tabla: dict, donde: str) -> str:
    viejo, nuevo, _ = tabla[mutar]
    if txt.count(viejo) != 1:
        sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en {donde}')
    return txt.replace(viejo, nuevo)


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        mig = reemplazar(mig, mutar, MUTACIONES, 'la 164')
    # la verificación final aborta con algunas mutaciones (invoker, anon): se saca para que caigan los CASOS
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\n\$\$;\n', '', mig)
    return sin_tx(mig)


def cuerpo_rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        rb = reemplazar(rb, mutar, MUTACIONES_ROLLBACK, '164_rollback.sql')
    rb = re.sub(r'(?s)\ndo \$\$\nbegin\n  if to_regprocedure.*?\nend \$\$;\n', '\n', rb)
    return sin_tx(rb)


def armar(mutar: str | None) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@164@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('164_pruebas.sql: falta el marcador «-- @@164@@»')
    sql, n = re.subn(r'(?m)^-- @@164R@@.*$', lambda _: cuerpo_rollback(mutar), sql)
    if n != 1:
        sys.exit('164_pruebas.sql: falta el marcador «-- @@164R@@»')
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    p = subprocess.run(PSQL + ['-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    m = re.search(r'164-FALLAN: ([0-9a-z,()]+)', p.stderr)
    if m:
        return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
    if p.returncode != 0:
        sys.exit(f'ERROR: {p.stderr[:800]}')
    filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
    if not filas:
        sys.exit(f'SIN RESULTADO: {p.stdout[-400:]}')
    return json.loads(filas[-1])


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    db = args[args.index('--db') + 1] if '--db' in args else 'c164'
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
