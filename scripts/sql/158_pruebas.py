#!/usr/bin/env python3
"""
Corre scripts/sql/158_pruebas.sql (origen 105) en STAGING: llena el marcador con el cuerpo de la 158, todo dentro de una
transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado. El local y el owner los elige la
batería dentro de la transacción: no hacen falta UUID.

  python3 scripts/sql/158_pruebas.py
  python3 scripts/sql/158_pruebas.py --mutar sin_ventana    # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/158_pruebas.py --mutar todas          # todas, una por una
  python3 scripts/sql/158_pruebas.py --armar [--mutar X]    # solo imprime el SQL armado (no conecta a nada)

Cada mutación reemplaza un pedazo del cuerpo de la 158 (dentro de la transacción descartada) y declara qué casos caen.
El ASSERT final de la batería aborta con «158-FALLAN: <casos>»: el runner lee los casos de ese error.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging. Si la sesión no llega a
api.supabase.com, el SQL de --armar se corre igual en staging por el conector de Supabase (mismo resultado).
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/158_club_resena_cupon.sql'
ROLLBACK = RAIZ / 'scripts/sql/158_rollback.sql'
REGEX = ("'^https://(maps\\.app\\.goo\\.gl/[^[:space:]\"<>\\\\]+|g\\.page/[^[:space:]\"<>\\\\]+|(www\\.)?google\\.com/maps"
         "([/?][^[:space:]\"<>\\\\]*)?|search\\.google\\.com/local/writereview\\?[^[:space:]\"<>\\\\]+)$'")

# nombre → (texto de la 158, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # sin la ventana de 7 días: el cupón usado hace 8 días también pide la reseña
    'sin_ventana': ("    'resena', case when v_c.estado = 'usado' and v_c.usado_en > now() - interval '7 days'\n",
                    "    'resena', case when v_c.estado = 'usado'\n", {'5'}),
    # sin «usado»: el cupón vigente ya muestra el link
    'sin_usado': ("    'resena', case when v_c.estado = 'usado' and v_c.usado_en > now() - interval '7 days'\n",
                  "    'resena', case when true\n", {'3', '5', '6'}),
    # CHECK abierto: cualquier https entra
    'check_abierto': (REGEX, "'^https://'", {'2'}),
    # el clic pisa la marca anterior
    'clic_pisa': ("     and c.resena_clic_en is null\n", "", {'8'}),
    # el clic marca cupones no usados (y viejos)
    'clic_sin_usado': ("     and c.estado = 'usado'\n     and c.usado_en > now() - interval '7 days'\n", "", {'9'}),
    # el clic sin el portón de club-web
    'clic_sin_porton': ("  if not public.club_web_ok() then   -- CLUB-AUD-06: solo por club-web\n    raise exception 'Cupón no válido' using errcode = 'P0001';\n  end if;\n  if v_cod !~ '^[A-HJ-NP-Z2-9]{10}$' then\n    raise exception 'Cupón no válido' using errcode = 'P0001';\n  end if;\n  if not exists",
                        "  if v_cod !~ '^[A-HJ-NP-Z2-9]{10}$' then\n    raise exception 'Cupón no válido' using errcode = 'P0001';\n  end if;\n  if not exists",
                        {'10', '10b'}),
    # el clic marca aunque el local no tenga link
    'clic_sin_link': ("     and exists (select 1 from public.club_config g where g.location_id = c.location_id and g.resena_url is not null);\n",
                      ";\n", {'12'}),
    # el clic sin grant a anon (club-web no podría marcarlo)
    'clic_sin_anon': ("grant execute on function public.club_cupon_resena_clic(text) to anon, authenticated;",
                      "grant execute on function public.club_cupon_resena_clic(text) to authenticated;", {'0', '13'}),
}

# Mutaciones del ROLLBACK (caso 15): mismo formato, pero el ancla está en scripts/sql/158_rollback.sql
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback deja las filas de resena_url en el historial (lo que marcó el verificador, menor c)
    'rollback_deja_historial': ("delete from public.club_config_historial where campo = 'resena_url';\n", "", {'15'}),
    # el rollback borra TODO el historial de club_config (no solo lo de la 158)
    'rollback_borra_todo': ("delete from public.club_config_historial where campo = 'resena_url';\n",
                            "delete from public.club_config_historial;\n", {'15'}),
    # el rollback deja la función del clic
    'rollback_deja_clic': ("drop function if exists public.club_cupon_resena_clic(text);\n", "", {'15'}),
}


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 158')
        mig = mig.replace(viejo, nuevo)
    # la verificación final de la 158 aborta con algunas mutaciones: en la batería se saca para que caigan los CASOS
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\n\$\$;\n', '', mig)
    return '\n'.join(l for l in mig.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo_rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en 158_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    # su verificación final aborta con las mutaciones: en la batería se saca para que caiga el CASO 15
    rb = re.sub(r'(?s)\ndo \$\$\nbegin\n  if md5\(.*?\nend\n\$\$;\n', '\n', rb)
    return '\n'.join(l for l in rb.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(mutar: str | None) -> str:
    sql = (RAIZ / 'scripts/sql/158_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@158@@.*$', lambda _: cuerpo(mutar if mutar in MUTACIONES else None), sql)
    if n != 1:
        sys.exit('158_pruebas.sql: falta el marcador «-- @@158@@» (o está repetido)')
    sql, n = re.subn(r'(?m)^-- @@158R@@.*$', lambda _: cuerpo_rollback(mutar), sql)
    if n != 1:
        sys.exit('158_pruebas.sql: falta el marcador «-- @@158R@@» (o está repetido)')
    return sql


def correr(sql: str) -> list[dict]:
    """Casos de la batería. Si el ASSERT final abortó, arma la lista desde «158-FALLAN: …» (solo los que cayeron)."""
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        m = re.search(r'158-FALLAN: ([0-9a-z,]+)', txt)
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
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar and mutar != 'todas' and mutar not in todas:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(todas)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar))
        return
    if mutar:
        malas = []
        for nombre in (todas if mutar == 'todas' else [mutar]):
            caen = {c['caso'].split(' ')[0] for c in correr(armar(nombre)) if not c['ok']}
            esperadas = todas[nombre][2]
            print(f"{'muerde' if esperadas <= caen else 'NO MUERDE'} {nombre}: caen {sorted(caen)} (esperadas {sorted(esperadas)})")
            if not esperadas <= caen:
                malas.append(nombre)
        sys.exit(1 if malas else 0)
    casos = correr(armar(None))
    for c in casos:
        ver = c.get('detalle') and (not c['ok'] or c['caso'].startswith('00 '))
        print(('ok   ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if ver else ''))
    caen = [c for c in casos if not c['ok']]
    print(f'── {len(casos)} casos · {len(casos) - len(caen)} ok')
    sys.exit(1 if caen else 0)


if __name__ == '__main__':
    main()
