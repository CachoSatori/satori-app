#!/usr/bin/env python3
"""
Corre scripts/sql/155_pruebas.sql (origen 102) en STAGING: llena el marcador con el cuerpo de la 155, todo dentro de una
transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado. El owner y el local los elige la
batería dentro de la transacción: no hacen falta UUID.

  python3 scripts/sql/155_pruebas.py
  python3 scripts/sql/155_pruebas.py --mutar sin_filtro    # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/155_pruebas.py --mutar todas         # todas, una por una
  python3 scripts/sql/155_pruebas.py --armar [--mutar X]   # solo imprime el SQL armado (no conecta a nada)

Cada mutación reemplaza un pedazo del cuerpo de la 155 (dentro de la transacción descartada) y declara qué casos caen.
El ASSERT final de la batería aborta con «155-FALLAN: <casos>»: el runner lee los casos de ese error.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/155_club_tope_sin_carga_inicial.sql'

# nombre → (texto de la 155, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # sin el arreglo (la versión de la 150): la carga inicial vuelve a contar
    'sin_filtro': ("                       and m.origen <> 'migracion'\n", '', {'1', '3', '4'}),
    # filtro demasiado ancho: también deja afuera las tarjetas de papel
    'solo_app': ("                       and m.origen <> 'migracion'\n", "                       and m.origen = 'app'\n", {'5', '6'}),
    'invoker': ('security definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_rol public.user_role := public.get_my_role();\n  v_cfg',
                'security invoker\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_rol public.user_role := public.get_my_role();\n  v_cfg',
                {'0'}),
    'grant_anon': ("grant execute on function public.club_excepciones(date, date, text, text) to authenticated;",
                   "grant execute on function public.club_excepciones(date, date, text, text) to authenticated, anon;", {'0'}),   # el 7 no cae: el chequeo de rol adentro tira 42501 igual
}


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 155')
        mig = mig.replace(viejo, nuevo)
    # la verificación final de la 155 aborta con algunas mutaciones (invoker, grant_anon): en la batería se saca
    # para que caigan los CASOS, no la migración
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\n\$\$;\n', '', mig)
    return '\n'.join(l for l in mig.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(mutar: str | None) -> str:
    sql = (RAIZ / 'scripts/sql/155_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@155@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('155_pruebas.sql: falta el marcador «-- @@155@@» (o está repetido)')
    return sql


def correr(sql: str) -> list[dict]:
    """Casos de la batería. Si el ASSERT final abortó, arma la lista desde «155-FALLAN: …» (solo los que cayeron)."""
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        m = re.search(r'155-FALLAN: ([0-9,]+)', txt)
        if m:
            return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
        sys.exit(f'ERROR: {txt[:400]}')
    casos = res[0].get('json_agg') if isinstance(res, list) and res else None
    if not isinstance(casos, list) or not casos:
        sys.exit(f'SIN RESULTADO: {str(res)[:400]}')
    return casos


def main() -> None:
    args = sys.argv[1:]
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
