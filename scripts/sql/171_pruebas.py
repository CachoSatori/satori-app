#!/usr/bin/env python3
"""
Corre scripts/sql/171_pruebas.sql (origen club 117): llena el marcador con el cuerpo de la 171, todo dentro de una
transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/171_pruebas.py                         # STAGING (Management API)
  python3 scripts/sql/171_pruebas.py --local <base>          # Postgres local (psql -d <base>; PSQL="sudo -u postgres psql")
  python3 scripts/sql/171_pruebas.py [--local B] --mutar X   # una mutación: tienen que caer sus casos (sale 1 si no)
  python3 scripts/sql/171_pruebas.py [--local B] --mutar todas
  python3 scripts/sql/171_pruebas.py --armar [--mutar X]     # solo imprime el SQL armado (no conecta a nada)

Cada mutación cambia el cuerpo de la 171 (dentro de la transacción descartada) y declara qué casos caen. Las que solo
tienen sentido con la 170 (envoltorio + núcleo) se saltean, diciendo NO PROBADO, si la base no la tiene.
Token de la Management API: el proxy (o SUPABASE_ACCESS_TOKEN). Ref fijo de staging.
"""
from __future__ import annotations
import json, os, re, shlex, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/171_club_miembro_guardar_reune_156_157.sql'
MIG156 = RAIZ / 'supabase/migrations/156_club_alta_caja_link_portal.sql'
MIG157 = RAIZ / 'supabase/migrations/157_club_equipo_sin_creditos.sql'
CABEZA = 'create or replace function public.club_miembro_guardar('


def cuerpo_de(archivo: Path) -> str:
    """El texto de club_miembro_guardar en una migración, desde «(» hasta el $$ de cierre (sin «;»)."""
    t = archivo.read_text(encoding='utf-8')
    i = t.index(CABEZA) + len(CABEZA) - 1
    j = t.index('\n$$;', i)
    return t[i:j] + '\n$$'


def cuerpo_171() -> str:
    t = MIG.read_text(encoding='utf-8')
    return t[t.index('$cuerpo$') + len('$cuerpo$'):t.rindex('$cuerpo$')]


# nombre → (texto de la 171, reemplazo, casos que tienen que caer, solo con la 170)
MUTACIONES: dict[str, tuple[str, str, set[str], bool]] = {
    # la regresión de prod: el cuerpo de la 157 tal cual (sin lo de la 156)
    'cuerpo_157': ('@CUERPO@', '@157@', {'0', '1', '3', '4', '7'}, False),
    # el cuerpo de la 156 tal cual (sin D7 A)
    'cuerpo_156': ('@CUERPO@', '@156@', {'0', '6'}, False),
    'sin_socio': ("  if p_tipo is null or p_tipo not in ('referente','concierge_pm','equipo','socio') then\n",
                  "  if p_tipo is null or p_tipo not in ('referente','concierge_pm','equipo') then\n", {'0', '1', '3', '7'}, False),
    'crea_socio': ("    if p_tipo = 'socio' then\n      raise exception", "    if false then\n      raise exception", {'0', '2'}, False),
    'reactiva_socio': ("    if v_tipo_antes = 'socio' and v_antes = 'baja' and p_estado = 'activo' then\n",
                       "    if false then\n", {'0', '3'}, False),
    'sin_regenerar': ("           token_portal = case when v_a_anfitrion then encode(extensions.gen_random_bytes(32), 'hex') else token_portal end,\n",
                      "           token_portal = token_portal,\n", {'0', '4'}, False),
    'sin_auditar': ("      perform public.club_auditar('tipo_a_anfitrion',", "      perform public.club_auditar('otra_accion',", {'0', '4'}, False),
    'regenera_siempre': ("    v_a_anfitrion := v_tipo_antes is not null and v_tipo_antes not in ('referente','concierge_pm','equipo')\n",
                         "    v_a_anfitrion := v_tipo_antes is not null\n", {'0', '5'}, False),
    'saldo_total': ("      v_saldo := coalesce(public.club_saldo_canjeable(v_id), 0);\n",
                    "      v_saldo := public.club_saldo_personas(v_id);\n", {'0', '6'}, False),
    # con la 170: escribir la pública en vez del núcleo pisa el envoltorio (se pierde el chequeo de local)
    'pisa_envoltorio': ("  v_fn := case when v_nucleo then 'club_miembro_guardar__nucleo' else 'club_miembro_guardar' end;\n",
                        "  v_fn := 'club_miembro_guardar';\n", {'0', '9'}, True),
    # con la 170: el núcleo queda llamable por la API
    'nucleo_abierto': ("from public, anon, authenticated';\n  end if;\nend\n$mig$;",
                       "from public, anon, authenticated';\n    execute 'grant execute on function public.club_miembro_guardar__nucleo"
                       "(uuid, text, text, uuid, text, jsonb, text) to authenticated';\n  end if;\nend\n$mig$;", {'0'}, True),
}


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        viejo, nuevo, _, _ = MUTACIONES[mutar]
        if viejo == '@CUERPO@':
            viejo = cuerpo_171()
            nuevo = cuerpo_de(MIG157 if nuevo == '@157@' else MIG156)
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 171')
        mig = mig.replace(viejo, nuevo)
        # la verificación final de la 171 abortaría la migración: se saca para que caigan los CASOS
        mig = re.sub(r'(?s)-- Verificación \(si algo.*?\nend\n\$\$;\n', '', mig)
    return '\n'.join(l for l in mig.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(mutar: str | None) -> str:
    sql = (RAIZ / 'scripts/sql/171_pruebas.sql').read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@171@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('171_pruebas.sql: falta el marcador «-- @@171@@» (o está repetido)')
    return sql


def _de_fallan(txt: str) -> list[dict] | None:
    m = re.search(r'171-FALLAN: ([0-9a-z,]+)', txt)
    return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')] if m else None


def correr(sql: str, local: str | None) -> list[dict]:
    """Casos de la batería. Si el ASSERT final abortó, arma la lista desde «171-FALLAN: …» (solo los que cayeron)."""
    if local:
        psql = shlex.split(os.environ.get('PSQL', 'psql'))
        p = subprocess.run(psql + ['-d', local, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
        f = _de_fallan(p.stderr)
        if f:
            return f
        if p.returncode:
            sys.exit(f'ERROR: {p.stderr[:600]}')
        return json.loads(next(l for l in p.stdout.splitlines() if l.startswith('[{')))
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        f = _de_fallan(txt)
        if f:
            return f
        sys.exit(f'ERROR: {txt[:400]}')
    casos = res[0].get('json_agg') if isinstance(res, list) and res else None
    if not isinstance(casos, list) or not casos:
        sys.exit(f'SIN RESULTADO: {str(res)[:400]}')
    return casos


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    local = args[args.index('--local') + 1] if '--local' in args else None
    if mutar and mutar != 'todas' and mutar not in MUTACIONES:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(MUTACIONES)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar))
        return
    casos = correr(armar(None), local)
    con_170 = any(c['caso'].startswith('9 ') for c in casos)
    if not mutar:
        for c in casos:
            ver = c.get('detalle') and (not c['ok'] or c['caso'].startswith('00 '))
            print(('ok   ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if ver else ''))
        caen = [c for c in casos if not c['ok']]
        print(f'── {len(casos)} casos · {len(casos) - len(caen)} ok')
        sys.exit(1 if caen else 0)
    if any(not c['ok'] for c in casos):
        sys.exit('la base falla: primero sin --mutar')
    malas = []
    for nombre in (MUTACIONES if mutar == 'todas' else [mutar]):
        esperadas, solo_170 = MUTACIONES[nombre][2], MUTACIONES[nombre][3]
        if solo_170 and not con_170:
            print(f'NO PROBADO {nombre}: la base no tiene la 170')
            continue
        caen = {c['caso'].split(' ')[0] for c in correr(armar(nombre), local) if not c['ok']}
        print(f"{'muerde' if esperadas <= caen else 'NO MUERDE'} {nombre}: caen {sorted(caen)} (esperadas {sorted(esperadas)})")
        if not esperadas <= caen:
            malas.append(nombre)
    sys.exit(1 if malas else 0)


if __name__ == '__main__':
    main()
