#!/usr/bin/env python3
"""
Arma scripts/sql/200_pruebas.sql (reemplazar_pago_caja): llena los marcadores con el cuerpo de la 200 y el de su vuelta
atrás, todo en una transacción que termina en ROLLBACK.

  python3 scripts/sql/200_pruebas.py --armar [--mutar NOMBRE] [--compacto]   # imprime el SQL armado (conector MCP / editor)
  python3 scripts/sql/200_pruebas.py --psql "<conexión>" [--mutar todas | NOMBRE]   # corre con psql y dice si muerde
  python3 scripts/sql/200_pruebas.py --lista                                   # mutaciones y los casos que tienen que caer

Corre en STAGING (ref hwiatgic…). Nunca contra PROD (ref yiczgdti…): la batería crea usuarios, un local, un proveedor
y pagos ficticios dentro de la transacción descartada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/200_caja_reemplazo_pago_atomico.sql'
ROLLBACK = RAIZ / 'scripts/sql/200_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/200_pruebas.sql'

BORRADO = ("  perform public.delete_movement_cascade(p_viejo, c_nota, p_manager_email, p_manager_password);\n"
           "  if exists (select 1 from public.cash_movements where id = p_viejo) then\n"
           "    raise exception 'No se pudo borrar el pago anterior' using errcode = 'P0001';\n  end if;\n")

# nombre → ([(texto de la 200, reemplazo)], casos que tienen que caer)
MUTACIONES: dict[str, tuple[list[tuple[str, str]], set[str]]] = {
    'sin_rol': ([("  if v_uid is null or v_rol is null or v_rol not in ('owner', 'manager', 'cajero') then",
                  "  if false then")], {'09'}),
    'sin_local': ([("  if not public.puede_ver_local(v_viejo.location_id) then", "  if false then")], {'10'}),
    'sin_local_del_que_autoriza': ([("     and not exists (select 1 from public.profile_locations pl where pl.profile_id = v_aut and pl.location_id = v_viejo.location_id) then",
                                     "     and false then")], {'11'}),
    'sin_clave': ([("       and u.encrypted_password = extensions.crypt(p_manager_password, u.encrypted_password)\n", "")], set()),
    'sin_idempotencia': ([("    if found and public.puede_ver_local(v_ya.location_id) then", "    if false then")], {'03'}),
    'sin_comparar': ([(" or not public._reemplazo_pago_coincide(v_ya, p_nuevo) then", " then")], {'05'}),
    'sin_monto': ([("v_crc = 'NaN'::numeric or v_crc <= 0 or v_crc >= 1e12", "v_crc = 'NaN'::numeric")], {'14'}),
    'sin_turno': ([("       or (v_viejo.session_id is not null and v_ses_id <> v_viejo.session_id)\n", "")], {'15'}),
    'sin_bloqueo': ([("where id = p_viejo for update;", "where id = p_viejo;")], {'08'}),
    'borrado_tragado': ([(BORRADO, "  begin\n    perform public.delete_movement_cascade(p_viejo, c_nota, p_manager_email, p_manager_password);\n"
                                   "  exception when others then null;\n  end;\n")], {'18'}),
    'sin_tipo': ([("  if v_viejo.movement_type <> 'egreso_mercaderia' then", "  if false then")], {'16'}),
    'anon_ejecuta': ([("revoke all on function public.reemplazar_pago_caja(uuid, jsonb, text, text) from public, anon;",
                       "grant execute on function public.reemplazar_pago_caja(uuid, jsonb, text, text) to anon;")], {'13'}),
    'sin_guarda': ([("  if to_regprocedure('public.reemplazar_pago_caja(uuid,jsonb,text,text)') is not null\n"
                     "     or to_regprocedure('public._reemplazo_pago_coincide(public.cash_movements,jsonb)') is not null then",
                     "  if false then")], {'19'}),   # se rompe también en el texto que se vuelve a correr (caso 19)
}
# Notas: «sin_clave» no tiene caso propio que caiga porque delete_movement_cascade vuelve a verificar la clave (la
# defensa queda doble): r11b sigue en 42501; se lista para que se vea que se miró.


def cuerpo(mutar: str | None) -> str:
    s = MIG.read_text()
    if mutar:
        for viejo, nuevo in MUTACIONES[mutar][0]:
            if s.count(viejo) != 1:
                sys.exit(f'mutación {mutar}: el ancla aparece {s.count(viejo)} veces (tiene que ser 1)')
            s = s.replace(viejo, nuevo)
    return s


def armar(mutar: str | None = None, compacto: bool = False) -> str:
    b = BATERIA.read_text()
    for m in ('-- @@200@@', '-- @@200_texto@@', '-- @@200_rollback@@'):
        if b.count(m) != 1:
            sys.exit(f'marcador {m}: aparece {b.count(m)} veces')
    original = cuerpo(mutar) if mutar == 'sin_guarda' else MIG.read_text()
    if '$m200$' in original:
        sys.exit('la 200 no puede contener $m200$ (se usa para meterla como texto)')
    b = b.replace('-- @@200@@', cuerpo(mutar)).replace('-- @@200_texto@@', original).replace('-- @@200_rollback@@', ROLLBACK.read_text())
    if compacto:
        b = '\n'.join(l.strip() for l in b.splitlines() if l.strip() and not l.strip().startswith('--'))
    return b


def resultado(salida: str) -> dict:
    m = re.search(r'\{"ok".*\}', salida)
    if not m:
        sys.exit('sin resultado:\n' + salida[-2000:])
    return json.loads(m.group(0))


def main(argv: list[str]) -> int:
    mutar = argv[argv.index('--mutar') + 1] if '--mutar' in argv else None
    if '--lista' in argv:
        for k, (_, caen) in MUTACIONES.items():
            print(k, '→', ', '.join(sorted(caen)) or '(sin caso propio, ver nota)')
        return 0
    if '--armar' in argv:
        print(armar(mutar, '--compacto' in argv))
        return 0
    if '--psql' in argv:
        con = argv[argv.index('--psql') + 1]
        if 'yiczgdti' in con:
            sys.exit('NUNCA contra PROD')
        nombres = list(MUTACIONES) if mutar == 'todas' else ([mutar] if mutar else [None])
        malo = 0
        for n in nombres:
            sql = armar(n)
            out = subprocess.run(['psql', con, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
            r = resultado(out.stdout + out.stderr)
            caidos = {f[0] for f in (r.get('fallaron') or [])}
            if n is None:
                print(f"sin mutar: ok={r['ok']} fallas={r['fallas']}")
                malo |= r['fallas'] != 0
            else:
                esperados = MUTACIONES[n][1]
                muerde = esperados <= caidos if esperados else True
                print(f"{n}: caen {sorted(caidos)} (esperados {sorted(esperados)}) → {'MUERDE' if muerde else 'NO MUERDE'}")
                malo |= not muerde
        return 1 if malo else 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
