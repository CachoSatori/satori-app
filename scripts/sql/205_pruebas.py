#!/usr/bin/env python3
"""
Arma scripts/sql/205_pruebas.sql (mig 205, hallazgo 256: falla del disparador del catálogo visible y reparable): llena
los marcadores con la 205 (rota a propósito con --mutar), la 205 como texto y su vuelta atrás, todo en una transacción
que termina en ROLLBACK.

  python3 scripts/sql/205_pruebas.py --armar [--local] [--mutar NOMBRE]                     # imprime el SQL armado
  python3 scripts/sql/205_pruebas.py --psql "<conexión>" [--local] [--mutar todas | NOMBRE]  # corre con psql y dice si muerde
  python3 scripts/sql/205_pruebas.py --lista                                                 # mutaciones y casos que caen
  python3 scripts/sql/205_pruebas.py --huellas                                               # md5 de los cuerpos

--local: suma scripts/sql/205_preludio_local.sql. Base: Postgres 16 local armado SIN la 205:
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv HASTA=203 bash scripts/sql/local_armar_base.sh b205
--mutar todas: corre primero SIN mutar (tiene que dar 0 fallas) y después cada mutación; sale 1 si alguna no muerde.
Sin modo compacto a propósito: borrar comentarios cambiaría los cuerpos y la guarda por md5 (que ignora espacios, no
comentarios) ya no reconocería la 205.

Antes de armar, verifica que las huellas de la guarda de la 205 y del rollback sean las de los cuerpos de los archivos
(md5 de lo que hay entre $function$ … $function$, sin espacios): si alguien toca un cuerpo y no la guarda, frena.
Corre en STAGING (ref hwiatgic…) o en un Postgres local descartable. Nunca contra PROD (ref yiczgdti…).
"""
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
M198 = RAIZ / 'supabase/migrations/198_pos_catalogo_productos.sql'
M205 = RAIZ / 'supabase/migrations/205_pos_catalogo_fallas.sql'
ROLLBACK = RAIZ / 'scripts/sql/205_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/205_pruebas.sql'
PRELUDIO = RAIZ / 'scripts/sql/205_preludio_local.sql'

H198 = {'registrar': '85609c26a1736ff174aec2832d101dc6', 'absorber': '75d332953001efe0734e99759106be19'}  # = prod (26-nov)
H205 = {'registrar': '9d79f68209caac275c98d2b8ce42ed71'}

GUARDA_198 = (f"  if v_reg <> '{H198['registrar']}' or v_abs <> '{H198['absorber']}' then")
GUARDA_YA = "  if to_regclass('public.pos_catalogo_fallas') is not null or to_regprocedure('public.pos_catalogo_reparar(text)') is not null then"
GUARDA_RB = f"  if v_reg is distinct from '{H205['registrar']}' or to_regclass('public.pos_catalogo_fallas') is null then"
PROTEGE = ("    exception when others then\n"
           "      raise warning '205 pos_catalogo_registrar: no se pudo anotar la falla: % (%)', sqlerrm, sqlstate;\n")
SUMA = "        ultima_en = now(), veces = f.veces + 1, facturas = f.facturas + excluded.facturas;\n      get diagnostics"

# nombre → ([(archivo 'mig' | 'rb', texto, reemplazo)], casos que tienen que caer).
MUTACIONES: dict[str, tuple[list[tuple[str, str, str]], set[str]]] = {
    # ── disparador ──
    'no_anota': ([('mig', "       where t.id in (select distinct ticket_id from nuevas)\n       group by t.local\n",
                       "       where false\n       group by t.local\n"),
                  ('mig', "count(distinct ticket_id)::integer from nuevas\n", "count(distinct ticket_id)::integer from nuevas where false\n")], {'06'}),
    'sin_local': ([('mig', "      select t.local, v_estado, v_msg, count(*)::integer\n", "      select null::text, v_estado, v_msg, count(*)::integer\n")], {'06', '09'}),
    'no_suma': ([('mig', SUMA, "        ultima_en = now();\n      get diagnostics")], {'07'}),
    'anotar_sin_proteccion': ([('mig', PROTEGE, "")], {'08'}),
    'disparador_frena_ingesta': ([('mig', "  exception when others then\n    v_estado := sqlstate;", "  exception when no_data_found then\n    v_estado := sqlstate;")], {'06'}),
    # ── lectura ──
    'manager_ve_todo': ([('mig', "(select public.get_my_role()) = 'manager' and local is not null and public.puede_ver_local(local)",
                          "(select public.get_my_role()) = 'manager'")], {'09'}),
    'personal_ve': ([('mig', "  using ((select public.get_my_role()) in ('owner', 'contador')\n         or ((select public.get_my_role()) = 'manager' and local",
                      "  using (true or ((select public.get_my_role()) = 'manager' and local")], {'09'}),
    'api_escribe': ([('mig', "grant select on table public.pos_catalogo_fallas to authenticated;",
                      "grant select, insert, update, delete on table public.pos_catalogo_fallas to authenticated;\n"
                      "create policy _abierta on public.pos_catalogo_fallas for all to authenticated using (true) with check (true);")], {'03', '10'}),
    # ── reparar ──
    'sin_rol': ([('mig', "  if v_rol is null or v_rol not in ('owner', 'manager') then", "  if false then")], {'12'}),
    'manager_cualquier_local': ([('mig', "  if v_rol = 'manager' and not public.puede_ver_local(p_local) then", "  if false then")], {'12'}),
    'manager_null': ([('mig', "  if p_local is null and v_rol <> 'owner' then", "  if false then"),
                      ('mig', "  if v_rol = 'manager' and not public.puede_ver_local(p_local) then",
                              "  if v_rol = 'manager' and p_local is not null and not public.puede_ver_local(p_local) then")], {'12'}),
    'sin_absorber': ([('mig', "  v_escritos := public.pos_catalogo_absorber(array(", "  v_escritos := 0 * cardinality(array(")], {'11', '13'}),
    'cierra_todo': ([('mig', "   where f.resuelta_en is null and (p_local is null or f.local = p_local);",
                      "   where f.resuelta_en is null;")], {'13', '15'}),
    'sin_quien': ([('mig', "set resuelta_en = now(), resuelta_por = auth.uid()", "set resuelta_en = now(), resuelta_por = null")], {'13'}),
    'anon_ejecuta': ([('mig', "revoke all on function public.pos_catalogo_reparar(text) from public, anon;",
                       "grant execute on function public.pos_catalogo_reparar(text) to anon;")], {'03'}),
    'reparar_sin_definer': ([('mig', "returns jsonb\nlanguage plpgsql\nvolatile\nsecurity definer", "returns jsonb\nlanguage plpgsql\nvolatile\nsecurity invoker")], {'03', '13'}),
    # ── guarda y vuelta atrás ──
    'guarda_sin_huella_198': ([('mig', GUARDA_198, "  if false then")], {'02'}),
    'guarda_sin_ya_aplicada': ([('mig', GUARDA_YA, "  if false then")], {'18'}),
    'rollback_sin_guarda': ([('rb', GUARDA_RB, "  if false then")], {'19'}),
    'rollback_cuerpo_distinto': ([('rb', "    raise warning '198 pos_catalogo_registrar: % (%)', sqlerrm, sqlstate;",
                                   "    raise warning '198 pos_catalogo_registrar: %', sqlerrm;")], {'19'}),
    'rollback_deja_reparar': ([('rb', "drop function public.pos_catalogo_reparar(text);\n", "")], {'19'}),
}
# Nota: con una mutación del CUERPO del disparador también cae el 19/20 (la huella ya no es la de la 205): es lo
# esperado; «muerde» exige que caigan los casos propios de cada mutación.


def cuerpos(texto: str) -> dict[str, str]:
    """md5 (sin espacios) de cada función del archivo: nombre → huella."""
    out = {}
    for m in re.finditer(r'create (?:or replace )?function public\.(\w+)\(.*?as (\$\w*\$)(.*?)\2', texto, re.S):
        out[m.group(1)] = hashlib.md5(re.sub(r'\s', '', m.group(3)).encode()).hexdigest()
    return out


def verificar_huellas() -> None:
    c198 = cuerpos(M198.read_text())
    if c198.get('pos_catalogo_registrar') != H198['registrar'] or c198.get('pos_catalogo_absorber') != H198['absorber']:
        sys.exit('la 198 del árbol no tiene las huellas de prod (85609c26 / 75d33295)')
    if cuerpos(M205.read_text()).get('pos_catalogo_registrar') != H205['registrar']:
        sys.exit(f"el disparador de la 205 cambió: {cuerpos(M205.read_text())}; actualizá H205 y 205_rollback.sql")
    if cuerpos(ROLLBACK.read_text()) != {'pos_catalogo_registrar': H198['registrar']}:
        sys.exit('205_rollback.sql no tiene el cuerpo EXACTO de la 198')
    m, rb = M205.read_text(), ROLLBACK.read_text()
    for t, donde in ((GUARDA_198, m), (GUARDA_YA, m), (GUARDA_RB, rb)):
        if donde.count(t) != 1:
            sys.exit(f'guarda: no está (o está repetida) la línea {t.strip()[:60]}…')


def textos(mutar: str | None) -> tuple[str, str]:
    m, rb = M205.read_text(), ROLLBACK.read_text()
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


def armar(mutar: str | None = None, local: bool = False) -> str:
    verificar_huellas()
    b = BATERIA.read_text()
    for mk, n in (('-- @@205@@', 1), ('-- @@205_texto@@', 3), ('-- @@205_rollback@@', 2), ('-- @@preludio@@', 1)):
        if b.count(mk) != n:
            sys.exit(f'marcador {mk}: aparece {b.count(mk)} veces (tienen que ser {n})')
    m, rb = textos(mutar)
    texto = m if (mutar or '').startswith('guarda_') else M205.read_text()
    for t, tag in ((texto, '$m205$'), (rb, '$rb205$')):
        if tag in t:
            sys.exit(f'el texto no puede contener {tag}')
    b = b.replace('-- @@preludio@@', PRELUDIO.read_text() if local else '')
    b = b.replace('-- @@205@@', m).replace('-- @@205_texto@@', texto).replace('-- @@205_rollback@@', rb)
    return b


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
        print('198 =', H198, '\n205 =', H205, '\nrollback = 198: ok')
        return 0
    if '--armar' in argv:
        print(armar(mutar, '--local' in argv))
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
                if '--detalle' in argv:
                    print('\n'.join(l for l in out.stdout.splitlines() if '|' in l))
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
