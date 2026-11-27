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
Con --local corre además C1/C2 en DOS sesiones (anotar no espera · reparar espera el candado de la ingesta) sobre una
COPIA descartable de la base local (create database … template; se borra al final). En staging C1/C2 no corren.
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
H205 = {'registrar': '7cc9af6883242326a8aab0d20b004cb7'}

GUARDA_198 = (f"  if v_reg <> '{H198['registrar']}' or v_abs <> '{H198['absorber']}' then")
GUARDA_YA = "  if to_regclass('public.pos_catalogo_fallas') is not null or to_regclass('public.pos_catalogo_reparaciones') is not null\n"
GUARDA_RB = f"  if v_reg is distinct from '{H205['registrar']}' or to_regclass('public.pos_catalogo_fallas') is null\n"
PROTEGE = ("    exception when others then\n"
           "      raise warning '205 pos_catalogo_registrar: no se pudo anotar la falla: % (%)', sqlerrm, sqlstate;\n")
TRY_LOCAL = "        if pg_try_advisory_xact_lock(hashtextextended('pos_catalogo_fallas:' || coalesce(r.local, ''), 0)) then"
SUMA = ("            ultima_en = now(), veces = f.veces + 1, facturas = f.facturas + excluded.facturas, mensaje = excluded.mensaje;\n"
        "        else\n          raise warning '205 pos_catalogo_registrar: fallas de %")
PATRON = "    v_patron := regexp_replace(regexp_replace(v_msg, "
CANDADO_INGESTA = "    perform pg_advisory_xact_lock(hashtextextended('pos_ndf_ingest:' || v_loc, 0));\n"

# nombre → ([(archivo 'mig' | 'rb', texto, reemplazo)], casos que tienen que caer). Casos 'C1'/'C2' = prueba de
# concurrencia en DOS sesiones (--concurrencia, solo local): C1 anotar no espera · C2 reparar espera a la ingesta.
MUTACIONES: dict[str, tuple[list[tuple[str, str, str]], set[str]]] = {
    # ── disparador ──
    'no_anota': ([('mig', TRY_LOCAL, "        if false then")], {'06'}),
    'sin_local': ([('mig', "          values (r.local, v_estado, v_patron, v_msg, r.n)", "          values (null, v_estado, v_patron, v_msg, r.n)")], {'06', '09'}),
    'no_suma': ([('mig', SUMA, SUMA.replace("veces = f.veces + 1, facturas = f.facturas + excluded.facturas, ", ""))], {'07'}),
    'anotar_sin_proteccion': ([('mig', PROTEGE, "")], {'08'}),
    'disparador_frena_ingesta': ([('mig', "  exception when others then\n    v_estado := sqlstate;", "  exception when no_data_found then\n    v_estado := sqlstate;")], {'06'}),
    # ── 3: la clave no lleva el mensaje crudo ──
    'clave_cruda': ([('mig', PATRON, "    v_patron := v_msg || regexp_replace(regexp_replace(v_msg, ")], {'21'}),
    # ── 1: anotar nunca espera (dos sesiones) ──
    'anotar_espera_candado': ([('mig', TRY_LOCAL, "        if (select true from (select pg_advisory_xact_lock(hashtextextended('pos_catalogo_fallas:' || coalesce(r.local, ''), 0))) x) then")], {'C1'}),
    'anotar_sin_candado': ([('mig', TRY_LOCAL, "        if true then")], {'C1'}),
    # ── lectura ──
    'manager_ve_todo': ([('mig', "(select public.get_my_role()) = 'manager' and local is not null and public.puede_ver_local(local)",
                          "(select public.get_my_role()) = 'manager'")], {'09'}),
    'personal_ve': ([('mig', "  using ((select public.get_my_role()) in ('owner', 'contador')\n         or ((select public.get_my_role()) = 'manager' and local",
                      "  using (true or ((select public.get_my_role()) = 'manager' and local")], {'09'}),
    'api_escribe': ([('mig', "grant select on table public.pos_catalogo_fallas to authenticated;",
                      "grant select, insert, update, delete on table public.pos_catalogo_fallas to authenticated;\n"
                      "create policy _abierta on public.pos_catalogo_fallas for all to authenticated using (true) with check (true);")], {'03', '10'}),
    'reparaciones_legible': ([('mig', "revoke all on table public.pos_catalogo_reparaciones from public, anon, authenticated;",
                               "grant select on table public.pos_catalogo_reparaciones to authenticated;")], {'03'}),
    # ── reparar ──
    'sin_rol': ([('mig', "  if v_rol is null or v_rol not in ('owner', 'manager') then", "  if false then")], {'12'}),
    'manager_cualquier_local': ([('mig', "  if v_rol = 'manager' and not public.puede_ver_local(p_local) then", "  if false then")], {'12'}),
    'manager_null': ([('mig', "  if p_local is null and v_rol <> 'owner' then", "  if false then"),
                      ('mig', "  if v_rol = 'manager' and not public.puede_ver_local(p_local) then",
                              "  if v_rol = 'manager' and p_local is not null and not public.puede_ver_local(p_local) then")], {'12'}),
    'sin_absorber': ([('mig', "    v_escritos := v_escritos + public.pos_catalogo_absorber(array(", "    v_escritos := v_escritos + 0 * cardinality(array(")], {'11', '13'}),
    'cierra_todo': ([('mig', "     where f.resuelta_en is null and f.local = v_loc;", "     where f.resuelta_en is null;")], {'13', '15'}),
    'sin_quien': ([('mig', "set resuelta_en = now(), resuelta_por = auth.uid()\n     where f.resuelta_en is null and f.local = v_loc;",
                    "set resuelta_en = now(), resuelta_por = null\n     where f.resuelta_en is null and f.local = v_loc;")], {'13'}),
    'anon_ejecuta': ([('mig', "revoke all on function public.pos_catalogo_reparar(text) from public, anon;",
                       "grant execute on function public.pos_catalogo_reparar(text) to anon;")], {'03'}),
    'reparar_sin_definer': ([('mig', "returns jsonb\nlanguage plpgsql\nvolatile\nsecurity definer", "returns jsonb\nlanguage plpgsql\nvolatile\nsecurity invoker")], {'03', '13'}),
    # ── 2: candado de la ingesta y enfriamiento ──
    'reparar_sin_candado_ingesta': ([('mig', CANDADO_INGESTA, "")], {'C2'}),
    'sin_enfriamiento': ([('mig', "r.local = v_loc and r.ultima_en > now() - interval '60 seconds';", "r.local = v_loc and false;")], {'14'}),
    # ── guarda y vuelta atrás ──
    'guarda_sin_huella_198': ([('mig', GUARDA_198, "  if false then")], {'02'}),
    'guarda_sin_ya_aplicada': ([('mig', GUARDA_YA + "     or to_regprocedure('public.pos_catalogo_reparar(text)') is not null then", "  if false then")], {'18'}),
    'rollback_sin_guarda': ([('rb', GUARDA_RB + "     or to_regclass('public.pos_catalogo_reparaciones') is null then", "  if false then")], {'19'}),
    'rollback_cuerpo_distinto': ([('rb', "    raise warning '198 pos_catalogo_registrar: % (%)', sqlerrm, sqlstate;",
                                   "    raise warning '198 pos_catalogo_registrar: %', sqlerrm;")], {'19'}),
    'rollback_deja_reparar': ([('rb', "drop function public.pos_catalogo_reparar(text);\n", "")], {'19'}),
    'rollback_deja_reparaciones': ([('rb', "drop table public.pos_catalogo_reparaciones;\n", "")], {'19'}),
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


OWNER_C = '00000000-0000-4000-8205-0000000000c9'
LINEA_C = ("insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia) "
           "select id, '{cod}', 'FICTICIO 205C', 1, 1000, 3 from public.pos_ndf_tickets where local = 'prueba-205c' and numero_factura = '{fac}';")


def _psql(con: str, sql: str) -> subprocess.CompletedProcess:
    return subprocess.run(['psql', con, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)


def concurrencia(con: str, mutar: str | None) -> set[str] | None:
    """C1 y C2 en DOS sesiones, sobre una copia descartable de la base local (se borra al final). Devuelve los casos
    que caen, o None si no se pudo armar. Solo Postgres local (host=/tmp): hace COMMIT en la copia."""
    import time
    m = re.search(r'dbname=(\w+)', con)
    if 'host=/tmp' not in con or not m:
        return None
    base, copia = m.group(1), m.group(1) + '_c205'
    adm, cc = con.replace(f'dbname={base}', 'dbname=postgres'), con.replace(f'dbname={base}', f'dbname={copia}')
    _psql(adm, f'drop database if exists {copia};')
    if _psql(adm, f'create database {copia} template {base};').returncode != 0:
        return None
    try:
        mig, _ = textos(mutar)
        arme = _psql(cc, mig + f"""
insert into public.locations (id, name, is_active) values ('prueba-205c', 'Local de prueba 205c', false) on conflict (id) do nothing;
insert into auth.users (id, raw_user_meta_data) values ('{OWNER_C}', '{{"full_name":"Ficticio 205c"}}');
update public.profiles set role = 'owner', is_active = true where id = '{OWNER_C}';
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, valor_servido_crc)
values ('prueba-205c', 'C1', '2026-11-20 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-205c', 'C2', '2026-11-21 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0);
alter table public.pos_productos add constraint _roto_205c check (false) not valid;""")
        if arme.returncode != 0:
            return None
        caen: set[str] = set()
        # C1: A anota su falla y NO confirma (3 s); B (mismo local, sin el candado de la ingesta, statement_timeout 1,5 s)
        # falla igual: su línea tiene que entrar sin esperar la fila de A.
        a = subprocess.Popen(['psql', cc, '-X', '-At'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        a.stdin.write('begin;\n' + LINEA_C.format(cod='9101', fac='C1') + '\nselect pg_sleep(3);\ncommit;\n'); a.stdin.flush()
        time.sleep(1)
        b = _psql(cc, "set statement_timeout = '1500ms';\n" + LINEA_C.format(cod='9102', fac='C2'))
        a.communicate()
        if b.returncode != 0 or 'ERROR' in b.stderr:
            caen.add('C1')
        _psql(cc, 'alter table public.pos_productos drop constraint _roto_205c;')
        # C2: A tiene el candado de la ingesta de prueba-205c (3 s); B (owner, lock_timeout 1 s) repara: tiene que esperarlo.
        a = subprocess.Popen(['psql', cc, '-X', '-At'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        a.stdin.write("begin;\nselect pg_advisory_xact_lock(hashtextextended('pos_ndf_ingest:prueba-205c', 0));\nselect pg_sleep(3);\ncommit;\n"); a.stdin.flush()
        time.sleep(1)
        b = _psql(cc, "set lock_timeout = '1s';\n"
                      f"""select set_config('request.jwt.claims', '{{"sub":"{OWNER_C}","role":"authenticated"}}', false);\n"""
                      "select public.pos_catalogo_reparar('prueba-205c');")
        a.communicate()
        if 'lock timeout' not in b.stderr:
            caen.add('C2')
        return caen
    finally:
        _psql(adm, f'drop database if exists {copia};')


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
            if n and '--local' not in argv and any(x.startswith('C') for x in MUTACIONES[n][1]):
                print(f'{n}: solo local (dos sesiones), se salta')
                continue
            sql = armar(n, local='--local' in argv)
            out = subprocess.run(['psql', con, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
            r = resultado(out.stdout + out.stderr)
            if r is None:
                err = [l for l in (out.stdout + out.stderr).splitlines() if 'ERROR' in l][:1]
                print(f"{n or 'sin mutar'}: ERROR, la batería no terminó ({err[0][:200] if err else 'sin salida'})")
                malo = 1
                continue
            caidos = {f[0] for f in (r.get('fallaron') or [])}
            if '--local' in argv:
                c = concurrencia(con, n)
                if c is None:
                    print(f"{n or 'sin mutar'}: concurrencia NO PROBADA (no se pudo armar la copia local)")
                    malo = 1
                else:
                    caidos |= c
                    r['fallas'] += len(c)
                    r.setdefault('fallaron', None)
                    r['fallaron'] = (r['fallaron'] or []) + [[x, 'dos sesiones'] for x in sorted(c)]
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
