#!/usr/bin/env python3
"""
Arma scripts/sql/203_pruebas.sql (mig 203, endurecer reemplazar_pago_caja): llena los marcadores con la 200 tal cual
(= prod hoy), la 203 (rota a propósito con --mutar) y su vuelta atrás, todo en una transacción que termina en ROLLBACK.

  python3 scripts/sql/203_pruebas.py --armar [--local] [--mutar NOMBRE] [--compacto]       # imprime el SQL armado
  python3 scripts/sql/203_pruebas.py --psql "<conexión>" [--local] [--mutar todas | NOMBRE] # corre con psql y dice si muerde
  python3 scripts/sql/203_pruebas.py --lista                                                # mutaciones y casos que caen
  python3 scripts/sql/203_pruebas.py --huellas                                              # md5 de los cuerpos (200 / 203 / rollback)

--local: suma scripts/sql/200_preludio_local.sql. Base: Postgres 16 local vacío armado SIN la 203:
  PGHOST=/tmp PGPORT=5499 PGUSER=pgv HASTA=200 bash scripts/sql/local_armar_base.sh b203
--mutar todas: corre primero SIN mutar (tiene que dar 0 fallas) y después cada mutación; sale 1 si alguna no muerde.

Antes de armar, verifica que las huellas escritas en la guarda de la 203 y en 203_rollback.sql sean las de los cuerpos
de los archivos (md5 de lo que hay entre $$ … $$, sin espacios): si alguien toca un cuerpo y no la guarda, frena.
Corre en STAGING (ref hwiatgic…) o en un Postgres local descartable. Nunca contra PROD (ref yiczgdti…).
"""
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
M200 = RAIZ / 'supabase/migrations/200_caja_reemplazo_pago_atomico.sql'
M203 = RAIZ / 'supabase/migrations/203_caja_reemplazo_pago_endurecer.sql'
ROLLBACK = RAIZ / 'scripts/sql/203_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/203_pruebas.sql'
PRELUDIO = RAIZ / 'scripts/sql/200_preludio_local.sql'

H200 = {'reemplazar': '636d3776826384ff46ed87a1cfe0db25', 'coincide': '98dae10d63e704afd7ff02930e655bbd'}   # = prod (26-nov)
H203 = {'reemplazar': 'f010a305df2234dbb9f8a6745f4a466f', 'coincide': 'af19ee44359cc6b7622ca2f60069d095'}

BORRADO = ("  perform public.delete_movement_cascade(p_viejo, c_nota, p_manager_email, p_manager_password);\n"
           "  if exists (select 1 from public.cash_movements where id = p_viejo) then\n"
           "    raise exception 'No se pudo borrar el pago anterior' using errcode = 'P0001';\n  end if;\n")
GUARDA_200 = f"  if v_r <> '{H200['reemplazar']}' or v_c <> '{H200['coincide']}' then"
GUARDA_YA = f"  if v_r = '{H203['reemplazar']}' and v_c = '{H203['coincide']}' then"
GUARDA_RB = f"  if v_r is distinct from '{H203['reemplazar']}' or v_c is distinct from '{H203['coincide']}' then"

# nombre → ([(archivo 'mig' | 'rb', texto, reemplazo)], casos que tienen que caer). 'mig' rompe la 203 que se aplica;
# las de la guarda ('guarda_*') rompen también la 203 que se re-corre como texto (casos 19, 37, 38, 39).
MUTACIONES: dict[str, tuple[list[tuple[str, str, str]], set[str]]] = {
    # ── 203: los 4 Menores ──
    'm1_sin_chequeo_de_local': ([('mig', "    if v_ya.location_id is distinct from v_viejo.location_id or not public.puede_ver_local(v_ya.location_id) then\n",
                                  "    if false then\n")], {'28'}),
    'm3_orden_invertido': ([('mig', "order by (id = v_id) desc limit 1 for update;", "order by (id = v_id) asc limit 1 for update;")], {'29'}),
    'm4_sin_btrim_nuevo': ([('mig', "btrim(coalesce(m.method, '')) = btrim(coalesce(d->>'method', ''))",
                             "btrim(coalesce(m.method, '')) = coalesce(d->>'method', '')")], {'30'}),
    'm4_sin_btrim_guardado': ([('mig', "btrim(coalesce(m.method, '')) = btrim(coalesce(d->>'method', ''))",
                                "coalesce(m.method, '') = btrim(coalesce(d->>'method', ''))")], {'30'}),
    'c_sin_client_op_id': ([('mig', "      if v_ya.id = v_id and v_ya.client_op_id = v_id and v_ya.movement_type",
                             "      if v_ya.id = v_id and v_ya.movement_type")], {'24'}),
    'c_sin_local_del_borrado': ([('mig', "                        and d.movement_snapshot->>'location_id' = v_ya.location_id\n", "")], {'25'}),
    'c_sin_puede_ver_local': ([('mig', "    if found and public.puede_ver_local(v_ya.location_id) then", "    if found then")], {'26'}),
    'e_sin_id': ([('mig', "    if v_ya.id <> v_id or not public._reemplazo_pago_coincide(v_ya, p_nuevo) then",
                   "    if not public._reemplazo_pago_coincide(v_ya, p_nuevo) then")], {'27'}),
    'cmp_sin_proveedor': ([('mig', "     and m.supplier_id is not distinct from nullif(d->>'supplier_id', '')::uuid\n", "")], {'31'}),
    'cmp_sin_dolares': ([('mig', "     and coalesce(m.amount_usd, 0) = coalesce((d->>'amount_usd')::numeric, 0)\n", "")], {'32'}),
    'cmp_sin_descripcion': ([('mig', "     and coalesce(m.description, '') = coalesce(d->>'description', '')\n", "")], {'33'}),
    'cmp_sin_metodo': ([('mig', "     and btrim(coalesce(m.method, '')) = btrim(coalesce(d->>'method', ''))   -- 203 · M4: = el btrim del alta\n", "")], {'34'}),
    'cmp_sin_caja': ([('mig', "     and coalesce(m.caja_origen, '') = coalesce(d->>'caja_origen', '')\n", "")], {'35'}),
    # ── guarda por huella y vuelta atrás ──
    'guarda_sin_huella_200': ([('mig', GUARDA_200, "  if false then")], {'37'}),
    'guarda_sin_ya_aplicada': ([('mig', GUARDA_YA, "  if false then")], {'19'}),
    'rollback_sin_guarda': ([('rb', GUARDA_RB, "  if false then")], {'20'}),
    'rollback_cuerpo_distinto': ([('rb', "-- = NOTA_REEMPLAZO del aparato", "-- = la nota del aparato")], {'20'}),
    'rollback_comentario_distinto': ([('rb', "  '200 · Cambiar un pago", "  '203 · Cambiar un pago")], {'20'}),
    # ── regresión: las de la 200, ahora sobre el cuerpo de la 203 ──
    'sin_rol': ([('mig', "  if v_uid is null or v_rol is null or v_rol not in ('owner', 'manager', 'cajero') then", "  if false then")], {'23'}),
    'sin_local': ([('mig', "  if not public.puede_ver_local(v_viejo.location_id) then", "  if false then")], {'10'}),
    'sin_local_del_que_autoriza': ([('mig', "     and not exists (select 1 from public.profile_locations pl where pl.profile_id = v_aut and pl.location_id = v_viejo.location_id) then",
                                     "     and false then")], {'11'}),
    'sin_clave': ([('mig', "       and u.encrypted_password = extensions.crypt(p_manager_password, u.encrypted_password)\n", "")], {'11'}),
    'sin_idempotencia': ([('mig', "    if found and public.puede_ver_local(v_ya.location_id) then", "    if false then")], {'03'}),
    'repetido_sin_comparar': ([('mig', "        if public._reemplazo_pago_coincide(v_ya, p_nuevo) then", "        if true then")], {'21'}),
    'repetido_con_cualquier_id': ([('mig', "      if v_ya.id = v_id and v_ya.client_op_id = v_id and v_ya.movement_type = 'egreso_mercaderia'\n",
                                    "      if true or v_ya.id = v_id\n")], {'22'}),
    'sin_comparar': ([('mig', " or not public._reemplazo_pago_coincide(v_ya, p_nuevo) then", " then")], {'05'}),
    'sin_monto': ([('mig', "v_crc = 'NaN'::numeric or v_crc <= 0 or v_crc >= 1e12", "v_crc = 'NaN'::numeric")], {'14'}),
    'sin_turno': ([('mig', "       or (v_viejo.session_id is not null and v_ses_id <> v_viejo.session_id)\n", "")], {'15'}),
    'sin_bloqueo': ([('mig', "where id = p_viejo for update;", "where id = p_viejo;")], {'08'}),
    'borrado_tragado': ([('mig', BORRADO, "  begin\n    perform public.delete_movement_cascade(p_viejo, c_nota, p_manager_email, p_manager_password);\n"
                                          "  exception when others then null;\n  end;\n")], {'18'}),
    'sin_tipo': ([('mig', "  if v_viejo.movement_type <> 'egreso_mercaderia' then", "  if false then")], {'16'}),
    'anon_ejecuta': ([('mig', "revoke all on function public.reemplazar_pago_caja(uuid, jsonb, text, text) from public, anon;",
                       "grant execute on function public.reemplazar_pago_caja(uuid, jsonb, text, text) to anon;")], {'13'}),
}
# Nota: con una mutación del CUERPO de la 203 también caen 19, 20 y 39 (la huella ya no es la de la 203): es lo
# esperado; «muerde» exige que caigan los casos propios de cada mutación.


def huellas(texto: str) -> list[str]:
    """md5 (sin espacios) de cada cuerpo $$ … $$ del archivo, en orden: [coincide, reemplazar]."""
    return [hashlib.md5(re.sub(r'\s', '', b).encode()).hexdigest() for b in re.findall(r'\$\$(.*?)\$\$', texto, re.S)]


def verificar_huellas() -> None:
    if huellas(M200.read_text()) != [H200['coincide'], H200['reemplazar']]:
        sys.exit('la 200 del árbol no tiene las huellas de prod (636d3776 / 98dae10d)')
    if huellas(M203.read_text()) != [H203['coincide'], H203['reemplazar']]:
        sys.exit(f'los cuerpos de la 203 cambiaron: huellas {huellas(M203.read_text())}; actualizá la guarda, el rollback y H203')
    if huellas(ROLLBACK.read_text()) != [H200['coincide'], H200['reemplazar']]:
        sys.exit('203_rollback.sql no tiene los cuerpos EXACTOS de la 200')
    m, rb = M203.read_text(), ROLLBACK.read_text()
    for t, donde in ((GUARDA_200, m), (GUARDA_YA, m), (GUARDA_RB, rb)):
        if donde.count(t) != 1:
            sys.exit(f'guarda: no está (o está repetida) la línea {t.strip()[:60]}…')


def textos(mutar: str | None) -> tuple[str, str]:
    m, rb = M203.read_text(), ROLLBACK.read_text()
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


def armar(mutar: str | None = None, compacto: bool = False, local: bool = False) -> str:
    verificar_huellas()
    b = BATERIA.read_text()
    for mk, n in (('-- @@200@@', 1), ('-- @@203@@', 1), ('-- @@203_texto@@', 4), ('-- @@203_rollback@@', 2), ('-- @@preludio@@', 1)):
        if b.count(mk) != n:
            sys.exit(f'marcador {mk}: aparece {b.count(mk)} veces (tienen que ser {n})')
    m, rb = textos(mutar)
    texto = m if (mutar or '').startswith('guarda_') else M203.read_text()
    for t, tag in ((texto, '$m203$'), (rb, '$rb203$')):
        if tag in t:
            sys.exit(f'el texto no puede contener {tag}')
    b = b.replace('-- @@preludio@@', PRELUDIO.read_text() if local else '')
    b = b.replace('-- @@200@@', M200.read_text()).replace('-- @@203@@', m)
    b = b.replace('-- @@203_texto@@', texto).replace('-- @@203_rollback@@', rb)
    if compacto:
        b = '\n'.join(l.strip() for l in b.splitlines() if l.strip() and not l.strip().startswith('--'))
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
        print('200 =', H200, '\n203 =', H203, '\nrollback = 200: ok')
        return 0
    if '--armar' in argv:
        print(armar(mutar, '--compacto' in argv, '--local' in argv))
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
