#!/usr/bin/env python3
"""
Corre scripts/sql/156_pruebas.sql (origen 103) en STAGING: llena el marcador con el cuerpo de la 156, todo dentro de una
transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado. El owner y el local los elige la
batería dentro de la transacción: no hacen falta UUID.

  python3 scripts/sql/156_pruebas.py
  python3 scripts/sql/156_pruebas.py --mutar sin_token     # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/156_pruebas.py --mutar todas         # todas, una por una
  python3 scripts/sql/156_pruebas.py --armar [--mutar X]   # solo imprime el SQL armado (no conecta a nada)

Cada mutación reemplaza un pedazo del cuerpo de la 156 (dentro de la transacción descartada) y declara qué casos caen.
El ASSERT final de la batería aborta con «156-FALLAN: <casos>»: el runner lee los casos de ese error.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/156_club_alta_caja_link_portal.sql'

# nombre → (texto de la 156, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # sin la 156 (la versión de la 150): el alta no devuelve token a nadie
    'sin_token': ("                            'token_portal', v_tok);\n", "                            'token_portal', null::text);\n", {'1', '8'}),
    # sin el chequeo «teléfono de nadie»: el socio dado de baja (creado en esta misma transacción) se lleva su token
    'sin_nuevo': ("  v_nuevo := public.club_miembro_por_telefono(v_tel) is null;\n", "  v_nuevo := true;\n", {'6'}),
    # sin ninguna de las dos guardas: el cajero se lleva el token del anfitrión que ya existía
    'sin_guardas': ("  if v_nuevo then\n    select m.token_portal into v_tok from public.club_miembros m\n     where m.id = v_id and m.created_at = now();",
                    "  if true then\n    select m.token_portal into v_tok from public.club_miembros m\n     where m.id = v_id;", {'5', '6'}),
    # sin la auditoría del token
    'sin_auditoria': ("      perform public.club_auditar('ver_link_portal', 'club_miembros', v_id, null, jsonb_build_object('via', 'alta_caja'));\n",
                      "      null;\n", {'2'}),
    # (verificador, 14-nov) activar un anfitrión sin regenerar el token: el link del alta abre el portal de canje
    'sin_regenerar': ("  update public.club_miembros set tipo = p_rol, token_portal = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = now()\n",
                      "  update public.club_miembros set tipo = p_rol, updated_at = now()\n", {'12', '13', '14'}),
    # (re-verificador, 14-nov) «Editar» socio → anfitrión sin regenerar el token: el link del alta llega al canje
    'guardar_sin_regenerar': ("           token_portal = case when v_a_anfitrion then encode(extensions.gen_random_bytes(32), 'hex') else token_portal end,\n",
                              "           token_portal = token_portal,\n", {'17'}),
    # «Editar» sobre un socio vuelve a fallar con «Tipo no válido»
    'guardar_sin_socio': ("  if p_tipo is null or p_tipo not in ('referente','concierge_pm','equipo','socio') then\n",
                          "  if p_tipo is null or p_tipo not in ('referente','concierge_pm','equipo') then\n", {'15'}),
    # LC-DES-01: sin el chequeo, un socio de baja vuelve a activo por «Editar» sin verificación
    'guardar_reactiva_socio': ("    if v_tipo_antes = 'socio' and v_antes = 'baja' and p_estado = 'activo' then\n",
                               "    if false then\n", {'18'}),
    'grant_anon': ("grant execute on function public.club_socio_alta_caja(text, text, text, boolean, text) to authenticated;",
                   "grant execute on function public.club_socio_alta_caja(text, text, text, boolean, text) to authenticated, anon;", {'0'}),   # el 10 no cae: el chequeo de rol adentro tira 42501 igual
}


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 156')
        mig = mig.replace(viejo, nuevo)
    # la verificación final de la 156 aborta con algunas mutaciones (sin_nuevo, sin_token, grant_anon): en la batería se saca
    # para que caigan los CASOS, no la migración
    mig = re.sub(r'(?s)-- Verificación \(si algo.*?\n\$\$;\n', '', mig)
    return '\n'.join(l for l in mig.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(mutar: str | None) -> str:
    sql = (RAIZ / 'scripts/sql/156_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@156@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('156_pruebas.sql: falta el marcador «-- @@156@@» (o está repetido)')
    return sql


def correr(sql: str) -> list[dict]:
    """Casos de la batería. Si el ASSERT final abortó, arma la lista desde «156-FALLAN: …» (solo los que cayeron)."""
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        m = re.search(r'156-FALLAN: ([0-9,]+)', txt)
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
