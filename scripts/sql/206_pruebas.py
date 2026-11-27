#!/usr/bin/env python3
"""
Arma scripts/sql/206_pruebas.sql (mig 206, freno de 0,5 s en la clave de gerencia de reemplazar_pago_caja, hallazgo
259): llena los marcadores con la 200 y la 202 tal cual (= prod hoy), la 206 (rota a propósito con --mutar) y su
vuelta atrás, todo en una transacción que termina en ROLLBACK.

  python3 scripts/sql/206_pruebas.py --armar [--local | --staging] [--mutar NOMBRE]       # imprime el SQL armado
  python3 scripts/sql/206_pruebas.py --psql "<conexión>" [--local] [--mutar todas | NOMBRE] # corre con psql y dice si muerde
  python3 scripts/sql/206_pruebas.py --lista                                                # mutaciones y casos que caen
  python3 scripts/sql/206_pruebas.py --huellas                                              # md5 de los cuerpos (202 / 206 / rollback)

--local: suma scripts/sql/200_preludio_local.sql. Base: Postgres 16 local vacío armado SIN la 200:
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv HASTA=199 bash scripts/sql/local_armar_base.sh b206
--staging (solo con --armar, sin --mutar): versión corta para pegar en el SQL de staging (conector, sin psql). Supone
  que staging tiene la 200 tal cual (hoy, 27-nov; la guarda de la 202 lo exige): no la saca ni la recarga, y la 206 entra
  desde el texto cargado una sola vez. Mismos casos y mismos asserts.
--mutar todas: corre primero SIN mutar (tiene que dar 0 fallas) y después cada mutación; sale 1 si alguna no muerde.

Antes de armar, verifica que las huellas escritas en la guarda de la 206 y en 206_rollback.sql sean las de los cuerpos
de los archivos (md5 de lo que hay entre $$ … $$, sin espacios): si alguien toca un cuerpo y no la guarda, frena.
Corre en STAGING (ref hwiatgic…) o en un Postgres local descartable. Nunca contra PROD (ref yiczgdti…).
"""
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
M200 = RAIZ / 'supabase/migrations/200_caja_reemplazo_pago_atomico.sql'
M202 = RAIZ / 'supabase/migrations/202_caja_reemplazo_pago_endurecer.sql'
M206 = RAIZ / 'supabase/migrations/206_caja_reemplazo_freno_clave.sql'
ROLLBACK = RAIZ / 'scripts/sql/206_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/206_pruebas.sql'
PRELUDIO = RAIZ / 'scripts/sql/200_preludio_local.sql'

H202 = {'reemplazar': '3ca9211052b3b977f2e5a4f3432b99f1', 'coincide': 'ec56e5b77dad0552543a037e0ccf34c3'}   # = prod (27-nov)
H206 = '8545' '6458e90e0f14c1fe3025a5ea8d1b'   # partida: los 8 primeros dígitos parecen un teléfono (privacidadRepo.test.ts)

FRENO = "      perform pg_sleep(0.5);   -- 206 · hallazgo 259: el mismo freno que verify_manager_password (045) en el fallo\n"
GUARDA_202 = f"  if v_r <> '{H202['reemplazar']}' or v_c <> '{H202['coincide']}' then"
GUARDA_YA = f"  if v_r = '{H206}' then"
GUARDA_RB = f"  if v_r is distinct from '{H206}' then"
BORRADO = ("  perform public.delete_movement_cascade(p_viejo, c_nota, p_manager_email, p_manager_password);\n"
           "  if exists (select 1 from public.cash_movements where id = p_viejo) then\n"
           "    raise exception 'No se pudo borrar el pago anterior' using errcode = 'P0001';\n  end if;\n")

# nombre → ([(archivo 'mig' | 'rb', texto, reemplazo)], casos que tienen que caer). Con una mutación del CUERPO también
# caen 04, 12 y 14 (la huella ya no es la de la 206): es lo esperado; «muerde» exige que caigan los casos propios.
MUTACIONES: dict[str, tuple[list[tuple[str, str, str]], set[str]]] = {
    # ── el arreglo ──
    'sin_freno': ([('mig', FRENO, '')], {'07'}),
    'freno_corto': ([('mig', 'perform pg_sleep(0.5);', 'perform pg_sleep(0.1);')], {'07'}),
    'freno_siempre': ([('mig', "  -- ── A. Quién llama y quién autoriza", "  perform pg_sleep(0.5);\n  -- ── A. Quién llama y quién autoriza")], {'10'}),
    # ── regresión: lo que no tiene que cambiar ──
    'sin_clave': ([('mig', "       and u.encrypted_password = extensions.crypt(p_manager_password, u.encrypted_password)\n", "")], {'07'}),
    'sin_rol_manager': ([('mig', "       and p.role in ('owner', 'manager') and p.is_active;\n", "       and p.is_active;\n")], {'07'}),
    'correo_sin_lower': ([('mig', "     where lower(u.email) = lower(btrim(p_manager_email))", "     where u.email = p_manager_email")], {'06'}),
    'borrado_tragado': ([('mig', BORRADO, "  begin\n    perform public.delete_movement_cascade(p_viejo, c_nota, p_manager_email, p_manager_password);\n"
                                          "  exception when others then null;\n  end;\n")], {'11'}),
    'anon_ejecuta': ([('mig', "revoke all on function public.reemplazar_pago_caja(uuid, jsonb, text, text) from public, anon;",
                       "grant execute on function public.reemplazar_pago_caja(uuid, jsonb, text, text) to anon;")], {'03'}),
    # ── guarda por huella y vuelta atrás ──
    'guarda_sin_huella_202': ([('mig', GUARDA_202, "  if false then")], {'01'}),
    'guarda_sin_ya_aplicada': ([('mig', GUARDA_YA, "  if false then")], {'12'}),
    'rollback_sin_guarda': ([('rb', GUARDA_RB, "  if false then")], {'13'}),
    'rollback_cuerpo_distinto': ([('rb', "-- = NOTA_REEMPLAZO del aparato", "-- = la nota del aparato")], {'13'}),
    'rollback_comentario_distinto': ([('rb', "método con btrim.';", "método con btrim. 206.';")], {'13'}),
}


def huellas(texto: str) -> list[str]:
    """md5 (sin espacios) de cada cuerpo $$ … $$ del archivo, en orden."""
    return [hashlib.md5(re.sub(r'\s', '', b).encode()).hexdigest() for b in re.findall(r'\$\$(.*?)\$\$', texto, re.S)]


def verificar_huellas() -> None:
    if huellas(M202.read_text()) != [H202['coincide'], H202['reemplazar']]:
        sys.exit('la 202 del árbol no tiene las huellas de prod (3ca92110 / ec56e5b7)')
    if huellas(M206.read_text()) != [H206]:
        sys.exit(f'el cuerpo de la 206 cambió: huellas {huellas(M206.read_text())}; actualizá la guarda, el rollback, la batería y H206')
    if huellas(ROLLBACK.read_text()) != [H202['reemplazar']]:
        sys.exit('206_rollback.sql no tiene el cuerpo EXACTO de la 202')
    m, rb = M206.read_text(), ROLLBACK.read_text()
    for t, donde in ((GUARDA_202, m), (GUARDA_YA, m), (GUARDA_RB, rb), (FRENO, m)):
        if donde.count(t) != 1:
            sys.exit(f'guarda: no está (o está repetida) la línea {t.strip()[:60]}…')


def textos(mutar: str | None) -> tuple[str, str]:
    m, rb = M206.read_text(), ROLLBACK.read_text()
    if mutar:
        for archivo, viejo, nuevo in MUTACIONES[mutar][0]:
            s = m if archivo == 'mig' else rb
            if s.count(viejo) != 1:
                sys.exit(f'mutación {mutar}: el ancla aparece {s.count(viejo)} veces en {archivo} (tiene que ser 1)')
            s = s.replace(viejo, nuevo)
            if archivo == 'mig':
                m = s
            else:
                rb = s
    return m, rb


DROPS = ("drop function if exists public.reemplazar_pago_caja(uuid, jsonb, text, text);\n"
         "drop function if exists public._reemplazo_pago_coincide(public.cash_movements, jsonb);\n")


def compactar(b: str) -> str:
    """Saca líneas vacías y de comentario FUERA de los cuerpos $$ … $$ (adentro son parte de la huella)."""
    dentro, out = False, []
    for l in b.splitlines():
        if dentro or (l.strip() and not l.strip().startswith('--')):
            out.append(l)
        if len(re.findall(r'(?<![\w$])\$\$(?![\w$])', l)) % 2:
            dentro = not dentro
    return '\n'.join(out) + '\n'


def armar(mutar: str | None = None, local: bool = False, staging: bool = False) -> str:
    verificar_huellas()
    b = BATERIA.read_text()
    for mk, n in (('-- @@200@@', 1), ('-- @@202@@', 1), ('-- @@206@@', 1), ('-- @@206_texto@@', 1), ('-- @@206_rollback@@', 1), ('-- @@preludio@@', 1)):
        if b.count(mk) != n:
            sys.exit(f'marcador {mk}: aparece {b.count(mk)} veces (tienen que ser {n})')
    m, rb = textos(mutar)
    texto = m if (mutar or '').startswith('guarda_') else M206.read_text()
    for t, tag in ((texto, '$m206$'), (rb, '$rb206$')):
        if tag in t:
            sys.exit(f'el texto no puede contener {tag}')
    if staging:
        if mutar or local or b.count(DROPS) != 1:
            sys.exit('--staging: sin --mutar ni --local (y la batería tiene que traer los drops tal cual)')
        b = b.replace(DROPS, '').replace('-- @@200@@', '')
        b = b.replace('-- @@206@@', "do $x$ begin execute (select v from _t206 where k = 'm206'); end $x$;")
    b = b.replace('-- @@preludio@@', PRELUDIO.read_text() if local else '')
    b = b.replace('-- @@200@@', M200.read_text()).replace('-- @@202@@', M202.read_text()).replace('-- @@206@@', m)
    b = b.replace('-- @@206_texto@@', texto).replace('-- @@206_rollback@@', rb)
    return compactar(b) if staging else b


def resultado(salida: str) -> dict | None:
    m = re.search(r'\{"ok".*\}', salida)
    return json.loads(m.group(0)) if m else None


def main(argv: list[str]) -> int:
    mutar = argv[argv.index('--mutar') + 1] if '--mutar' in argv else None
    if '--lista' in argv:
        for k, (_, caen) in MUTACIONES.items():
            print(k, '→', ', '.join(sorted(caen)))
        return 0
    if '--huellas' in argv:
        verificar_huellas()
        print('202 =', H202, '\n206 =', H206, '\nrollback = 202: ok')
        return 0
    if '--armar' in argv:
        print(armar(mutar, '--local' in argv, '--staging' in argv))
        return 0
    if '--psql' in argv:
        con = argv[argv.index('--psql') + 1]
        if 'yiczgdti' in con:
            sys.exit('NUNCA contra PROD')
        nombres = [None, *MUTACIONES] if mutar == 'todas' else ([mutar] if mutar else [None])
        malo = 0
        for n in nombres:
            sql = armar(n, local='--local' in argv)
            out = subprocess.run(['psql', con, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
            r = resultado(out.stdout + out.stderr)
            if r is None:
                err = [l for l in (out.stdout + out.stderr).splitlines() if 'ERROR' in l][:1]
                print(f"{n or 'sin mutar'}: ERROR, la batería no terminó ({err[0][:200] if err else 'sin salida'})")
                malo = 1
                continue
            caidos = {f[0] for f in (r.get('fallaron') or [])}
            if n is None:
                print(f"sin mutar: ok={r['ok']} fallas={r['fallas']}" + (f" {r['fallaron']}" if r['fallas'] else ''))
                malo |= r['fallas'] != 0
            else:
                esperados = MUTACIONES[n][1]
                muerde = bool(esperados) and esperados <= caidos
                print(f"{n}: caen {sorted(caidos)} (esperados {sorted(esperados)}) → {'MUERDE' if muerde else 'NO MUERDE'}")
                malo |= not muerde
        return 1 if malo else 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
