#!/usr/bin/env python3
"""
Corre scripts/sql/159_pruebas.sql (origen 101) en STAGING: llena el marcador con el cuerpo de la 159, todo dentro de una
transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado. El owner, el manager y el local
los elige la batería dentro de la transacción: no hacen falta UUID.

  python3 scripts/sql/159_pruebas.py
  python3 scripts/sql/159_pruebas.py --mutar sin_trigger_edad   # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/159_pruebas.py --mutar todas              # todas, una por una
  python3 scripts/sql/159_pruebas.py --armar [--mutar X]        # solo imprime el SQL armado (no conecta a nada)
  python3 scripts/sql/159_pruebas.py --psql "host=… port=… user=postgres" [--mutar todas]   # base LOCAL descartable
    (14-nov: corrida en una Postgres 16 local con 150, 151, 153 y 155 aplicadas, un owner, un manager, un local
     encendido y club_config_global.club_url cargado; no reemplaza la corrida en staging)

Cada mutación reemplaza un pedazo del cuerpo de la 159 (dentro de la transacción descartada) y declara qué casos caen.
El ASSERT final de la batería aborta con «159-FALLAN: <casos>»: el runner lee los casos de ese error.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/159_club_aviso_v1_2.sql'

# nombre → (texto de la 159, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # la autoalta no pide la edad (el trigger diferido igual la frena, pero con otro mensaje y recién al confirmar)
    'autoalta_sin_edad': ("  if (p_datos->'mayor_edad') is distinct from 'true'::jsonb then\n", "  if false then\n", {'03', '04'}),
    # la autoalta acepta el cumpleaños sin el permiso
    'autoalta_sin_permiso': ("       or (p_datos->'cumple_permiso') is distinct from 'true'::jsonb\n", "", {'05'}),
    # sin el trigger diferido: la de 5 argumentos da de alta sin edad
    'sin_trigger_edad': ("create constraint trigger club_roles_mayor_edad_trg after insert or update on public.club_miembro_roles\n"
                         "  deferrable initially deferred\n"
                         "  for each row execute function public.club_roles_mayor_edad_chk();\n", "", {'02', '17'}),
    # el check de la tabla deja pasar el 31 de abril
    'check_31_todos': ("then 30 else 31 end)));", "then 31 else 31 end)));", {'09'}),
    # la guardia deja cambiar el cumpleaños a cualquiera
    'guardia_abierta': ("  raise exception 'El cumpleaños no se cambia después del alta: lo corrige solo el owner' using errcode = '42501';\n",
                        "  return new;\n", {'11', '12'}),
    # la guardia deja cargarlo después del alta (sin mirar que la fila nazca en la transacción)
    'guardia_sin_created_at': ("current_user = 'postgres' and new.created_at = now() then", "current_user = 'postgres' then", {'12'}),
    # la baja no borra el cumpleaños
    'baja_no_borra': ("  if new.rol = 'socio' and new.estado = 'baja' and old.estado is distinct from 'baja' then\n",
                      "  if false then\n", {'14'}),
    # la v2 no pide la edad (la frena el trigger, con otro mensaje)
    'v2_sin_edad': ("  if coalesce(p_mayor_edad, false) is not true then\n", "  if false then\n", {'15'}),
    # se olvida el revoke de la de 5 argumentos
    'alta_caja_abierta': ("revoke all on function public.club_socio_alta_caja(text, text, text, boolean, text) from public, anon, authenticated;\n",
                          "", {'02', '18'}),
    # la corrección no exige owner
    'corregir_manager': ("  if public.get_my_role() is null or public.get_my_role() <> 'owner' then\n",
                         "  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager') then\n", {'10'}),
}


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 159')
        mig = mig.replace(viejo, nuevo)
    return '\n'.join(l for l in mig.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(mutar: str | None) -> str:
    sql = (RAIZ / 'scripts/sql/159_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@159@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('159_pruebas.sql: falta el marcador «-- @@159@@» (o está repetido)')
    return sql


PSQL: str | None = None   # --psql "<conexión>": corre contra una base LOCAL descartable en vez de staging


def correr(sql: str) -> list[dict]:
    """Casos de la batería. Si el ASSERT final abortó, arma la lista desde «159-FALLAN: …» (solo los que cayeron)."""
    if PSQL:
        import subprocess
        r = subprocess.run(['psql', PSQL, '-At', '-v', 'ON_ERROR_STOP=0'], input=sql, capture_output=True, text=True)
        m = re.search(r'159-FALLAN: ([0-9,]+)', r.stderr)
        if m:
            return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
        filas = [l for l in r.stdout.splitlines() if l.startswith('[{')]
        if not filas:
            sys.exit(f'SIN RESULTADO: {r.stderr[:400]}')
        return json.loads(filas[-1])
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        m = re.search(r'159-FALLAN: ([0-9,]+)', txt)
        if m:
            return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
        sys.exit(f'ERROR: {txt[:400]}')
    casos = res[0].get('json_agg') if isinstance(res, list) and res else None
    if not isinstance(casos, list) or not casos:
        sys.exit(f'SIN RESULTADO: {str(res)[:400]}')
    return casos


def main() -> None:
    global PSQL
    args = sys.argv[1:]
    if '--psql' in args:
        PSQL = args[args.index('--psql') + 1]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    if mutar and mutar != 'todas' and mutar not in MUTACIONES:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(MUTACIONES)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar))
        return
    if mutar:
        malas = []
        for nombre in (MUTACIONES if mutar == 'todas' else [mutar]):
            caen = {c['caso'].split(' ')[0] for c in correr(armar(nombre)) if not c['ok']}
            esperadas = MUTACIONES[nombre][2]
            print(f"{'muerde' if esperadas <= caen else 'NO MUERDE'} {nombre}: caen {sorted(caen)} (esperadas {sorted(esperadas)})")
            if not esperadas <= caen:
                malas.append(nombre)
        sys.exit(1 if malas else 0)
    casos = correr(armar(None))
    for c in casos:
        ver = c.get('detalle') and (not c['ok'] or c['caso'].startswith('00 '))   # el 00 dice con qué rol se escribió
        print(('ok   ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if ver else ''))
    caen = [c for c in casos if not c['ok']]
    print(f'── {len(casos)} casos · {len(casos) - len(caen)} ok')
    sys.exit(1 if caen else 0)


if __name__ == '__main__':
    main()
