#!/usr/bin/env python3
"""
Corre scripts/sql/163_pruebas.sql (origen 109): llena el marcador con el cuerpo de la 159 (re-ejecutable) y el de la
163, todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado. El owner,
el manager y el local los elige la batería dentro de la transacción: no hacen falta UUID.

  python3 scripts/sql/163_pruebas.py                              # STAGING (Management API; ref fijo)
  python3 scripts/sql/163_pruebas.py --mutar trigger_sin_activa   # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/163_pruebas.py --mutar todas                # todas, una por una
  python3 scripts/sql/163_pruebas.py --armar [--mutar X]          # solo imprime el SQL armado (no conecta a nada)
  python3 scripts/sql/163_pruebas.py --psql "host=/tmp port=5499 user=pgv dbname=…" [--mutar todas]   # base LOCAL descartable
    (14-nov: corrida en una Postgres 16 local con 150, 151, 153, 155, 156 y 159 aplicadas, un owner, un manager y un
     local encendido; no reemplaza la corrida en staging. Conectar como superusuario local: el armado apaga y vuelve a
     encender el trigger de edad dentro de la transacción.)

Cada mutación reemplaza un pedazo del cuerpo de la 163 (dentro de la transacción descartada) y declara qué casos caen.
El ASSERT final de la batería aborta con «163-FALLAN: <casos>»: el runner lee los casos de ese error.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG159 = RAIZ / 'supabase/migrations/159_club_aviso_v1_2.sql'
MIG = RAIZ / 'supabase/migrations/163_club_edad_validar_reactivar.sql'

# nombre → (texto de la 163, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # el trigger vuelve a mirar solo el alta (como la 159): los clientes viejos activan sin edad
    'trigger_sin_activa': ("     and not v_activa then\n", " then\n", {'04', '09'}),
    # el paso a activo pide la edad solo si el alta fue por caja o autoalta (se escapa un socio de la carga inicial)
    'trigger_solo_caja_autoalta': ("          or (v_activa and r.estado = 'activo')) then", "          ) then", {'17'}),
    # la interna no pide la casilla: registra la edad igual
    'registrar_sin_pedir': ("  if coalesce(p_mayor_edad, false) is not true then\n", "  if false then\n", {'03', '08'}),
    # la interna no deja rastro
    'registrar_sin_auditar': ("  perform public.club_auditar('socio_mayor_edad',", "  perform null, ('socio_mayor_edad',", {'05', '10'}),
    # la interna nunca registra (sale como si la persona ya tuviera la edad)
    'registrar_nunca': ("                  where miembro_id = p_miembro and rol = 'socio' and mayor_edad_en is null) then\n    return;",
                        "                  where miembro_id = p_miembro and rol = 'socio' and false) then\n    return;", {'03', '05', '08', '10'}),
    # la interna pide la casilla aunque la persona ya tenga la edad
    'registrar_pide_siempre': ("  if not exists (select 1 from public.club_miembro_roles\n", "  if false and not exists (select 1 from public.club_miembro_roles\n", {'06', '11'}),
    # validar_v2 no pide/registra la edad
    'validar_sin_edad': ("  perform public.club_socio_mayor_edad_registrar(p_miembro, p_mayor_edad, 'validar');\n", "", {'03', '05'}),
    # guardar_v2 no detecta la reactivación
    'guardar_sin_reactiva': ("    select m.estado = 'baja' into v_reactiva", "    select false into v_reactiva", {'08', '10'}),
    # guardar_v2 pide la edad en cualquier edición (rompe editar a un socio de antes)
    'guardar_siempre': ("  if coalesce(v_reactiva, false)\n", "  if true\n", {'13'}),
    # guardar_v2 pide la edad aunque el socio vuelva a pendiente
    'guardar_aun_pendiente': ("rol = 'socio' and estado = 'activo') then\n    perform public.club_socio_mayor_edad_registrar(v_id",
                              "rol = 'socio') then\n    perform public.club_socio_mayor_edad_registrar(v_id", {'12'}),
    # validar_v2 abierta a anon
    'validar_anon': ("grant execute on function public.club_socio_validar_v2(uuid, boolean, boolean, text) to authenticated;",
                     "grant execute on function public.club_socio_validar_v2(uuid, boolean, boolean, text) to authenticated, anon;", {'02', '15'}),
    # la interna queda abierta a authenticated
    'registrar_abierta': ("revoke all on function public.club_socio_mayor_edad_registrar(uuid, boolean, text) from public, anon, authenticated;",
                          "grant execute on function public.club_socio_mayor_edad_registrar(uuid, boolean, text) to authenticated;", {'02'}),
}


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 163')
        mig = mig.replace(viejo, nuevo)
    return sin_tx(MIG159.read_text(encoding='utf-8')) + '\n' + sin_tx(mig)


def armar(mutar: str | None) -> str:
    sql = (RAIZ / 'scripts/sql/163_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@163@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('163_pruebas.sql: falta el marcador «-- @@163@@» (o está repetido)')
    return sql


PSQL: str | None = None   # --psql "<conexión>": corre contra una base LOCAL descartable en vez de staging


def correr(sql: str) -> list[dict]:
    """Casos de la batería. Si el ASSERT final abortó, arma la lista desde «163-FALLAN: …» (solo los que cayeron)."""
    if PSQL:
        import subprocess
        r = subprocess.run(['psql', PSQL, '-At', '-v', 'ON_ERROR_STOP=0'], input=sql, capture_output=True, text=True)
        m = re.search(r'163-FALLAN: ([0-9,]+)', r.stderr)
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
        m = re.search(r'163-FALLAN: ([0-9,]+)', txt)
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
