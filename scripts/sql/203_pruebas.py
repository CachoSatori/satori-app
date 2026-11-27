#!/usr/bin/env python3
"""
Arma y corre scripts/sql/203_pruebas.sql (compras F1, «Es un proveedor real · recordar»): llena los marcadores con el
cuerpo de la 203 y el de su vuelta atrás, todo en una transacción que termina en ROLLBACK.

  python3 scripts/sql/203_pruebas.py --armar [--local] [--compacto] [--mutar X]      # imprime el SQL armado
  python3 scripts/sql/203_pruebas.py --psql "<conexión>" [--local] [--mutar todas | X]  # corre con psql y dice si muerde

--local: suma scripts/sql/203_preludio_local.sql (Postgres 16 armado con `HASTA=201 bash scripts/sql/local_armar_base.sh`).
Necesita la 201 aplicada y la 203 NO. Corre en staging (ref hwiatgic…) o local. Nunca contra PROD (ref yiczgdti…).
"""
from __future__ import annotations
import re, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sql_compacto import compactar  # noqa: E402  (respeta los cuerpos $$…$$: la huella md5 no cambia)

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/203_fe_emisor_recordar.sql'
ROLLBACK = RAIZ / 'scripts/sql/203_rollback.sql'
PRELUDIO = RAIZ / 'scripts/sql/203_preludio_local.sql'
BATERIA = RAIZ / 'scripts/sql/203_pruebas.sql'

DEF_RECORDAR = "security definer\nset search_path = public, pg_temp\nas $function$\ndeclare\n  v_uid    uuid := auth.uid();\n  v_rol    text := (select public.get_my_role())::text;\n  v_nombre text;"

# nombre → ([(archivo 'mig'|'rb', texto, reemplazo)], casos que tienen que caer, casos que NO pueden caer)
MUTACIONES: dict[str, tuple] = {
    'manager_recuerda': ([('mig', "v_rol not in ('owner', 'contador') then\n    raise exception 'Solo el owner y el contador recuerdan",
                           "v_rol not in ('owner', 'contador', 'manager') then\n    raise exception 'Solo el owner y el contador recuerdan")], {'10'}, set()),
    'sin_chequeo_rol': ([('mig', "  if v_uid is null or v_rol is null or v_rol not in ('owner', 'contador') then", "  if false then")], {'10'}, set()),
    'contador_reactiva': ([('mig', "    if v_rol <> 'owner' then\n      raise exception 'Ese emisor", "    if false then\n      raise exception 'Ese emisor")], {'14'}, {'11'}),
    'quita_todo_motivo': ([('mig', "    if v_resto is null and v_c.estado_parseo = 'revisar' then", "    if v_c.estado_parseo = 'revisar' then")], {'11'}, {'13'}),
    'resuelve_otro_xml': ([('mig', "       and m_emisor = any (string_to_array(c.motivo, ' · '))\n", "")], {'15'}, {'13'}),
    'sin_bitacora': ([('mig', "    insert into public.fe_emisores_bitacora (cedula, accion, por, rol, pasan_a_ok, siguen_revisar)\n    values (p_cedula, v_accion, v_uid, v_rol, v_ok, v_siguen);\n",
                       "    null;\n")], {'11', '14', '19'}, {'10'}),
    'bitacora_siempre': ([('mig', "  if v_accion is not null then\n    insert into public.fe_emisores_bitacora", "  if true then\n    insert into public.fe_emisores_bitacora")], {'12'}, {'11'}),
    'cedula_inventada': ([('mig', "  if not found then\n    raise exception 'fe_emisor_recordar: no llegó", "  if false then\n    raise exception 'fe_emisor_recordar: no llegó")], {'16'}, {'11'}),
    'receptor_distinto_habilita': ([('mig', "     and c.estado_parseo <> 'receptor_distinto'   -- una factura que no era para Satori no habilita un emisor\n", "")], {'22'}, {'11'}),
    'contador_desactiva': ([('mig', "  if v_uid is null or v_rol is distinct from 'owner' then", "  if v_uid is null or v_rol not in ('owner', 'contador') then")], {'17'}, set()),
    'anon_ejecuta': ([('mig', "grant execute on function public.fe_emisor_recordar(text) to authenticated;", "grant execute on function public.fe_emisor_recordar(text) to authenticated, anon;")], {'02'}, set()),
    'sin_revoke_bitacora': ([('mig', "revoke all on table public.fe_emisores_bitacora from public, anon, authenticated;\n", "")], {'01'}, set()),
    'invoker': ([('mig', DEF_RECORDAR, DEF_RECORDAR.replace('security definer\n', 'security invoker\n'))], {'02', '11'}, set()),
    'sin_guarda_md5': ([('mig', "         where n.nspname = 'public' and p.proname = o) is distinct from h then",
                         "         where n.nspname = 'public' and p.proname = o) is distinct from h and false then")], {'92'}, {'90'}),
    'rollback_deja_funcion': ([('rb', "drop function if exists public.fe_emisor_recordar(text);\n", "")], {'90'}, set()),
    'rollback_deja_columna': ([('rb', "  drop column if exists origen,\n", "")], {'90'}, set()),
}


def reemplazar(cuerpo: str, viejo: str, nuevo: str, nombre: str) -> str:
    if cuerpo.count(viejo) != 1:
        raise SystemExit(f'mutación {nombre}: el texto aparece {cuerpo.count(viejo)} veces (tiene que ser 1)')
    return cuerpo.replace(viejo, nuevo)


def armar(mutar: str | None = None, local: bool = False) -> str:
    cuerpo, rb = MIG.read_text(), ROLLBACK.read_text()
    if re.search(r'storage\.(buckets|objects)', '\n'.join(l for l in rb.splitlines() if not l.strip().startswith('--')), re.I):
        raise SystemExit('203_rollback.sql no puede tocar storage.buckets/objects por SQL')
    if mutar:
        for donde, viejo, nuevo in MUTACIONES[mutar][0]:
            if donde == 'mig':
                cuerpo = reemplazar(cuerpo, viejo, nuevo, mutar)
            else:
                rb = reemplazar(rb, viejo, nuevo, mutar)
    sql = BATERIA.read_text()
    if '$mig203$' in cuerpo:
        raise SystemExit('la 203 no puede contener $mig203$ (se usa para pasarla como texto al caso 92)')
    for marcador, texto in (('-- @@203@@\n', cuerpo + '\n'), ('-- @@203_rollback@@\n', rb + '\n'),
                            ('-- @@203_texto@@\n', '$mig203$' + cuerpo + '$mig203$\n'),
                            ('-- @@preludio@@\n', (PRELUDIO.read_text() + '\n') if local else '')):
        if sql.count(marcador) != 1:
            raise SystemExit(f'falta el marcador {marcador.strip()}')
        sql = sql.replace(marcador, texto, 1)
    return sql


def correr(conn: str, sql: str) -> dict[str, bool]:
    out = subprocess.run(['psql', conn, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|'], input=sql, text=True, capture_output=True)
    if out.returncode != 0:
        return {'ERROR': False, '_': out.stderr.strip().splitlines()[-1] if out.stderr.strip() else 'psql falló'}  # type: ignore[dict-item]
    res: dict[str, bool] = {}
    for linea in out.stdout.splitlines():
        m = re.match(r'^\d+\|(\d\d) [^|]*\|(OK|FALLA)\|', linea)
        if m:
            res[m.group(1)] = m.group(2) == 'OK'
    return res


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    local = '--local' in args
    if '--armar' in args:
        sql = armar(mutar if mutar != 'todas' else None, local)
        if '--compacto' in args:
            sql = compactar(sql)
        print(sql)
        return
    conn = args[args.index('--psql') + 1]
    base = correr(conn, armar(local=local))
    fallan = sorted(c for c, ok in base.items() if not ok)
    print(f'sin mutar: {len(base)} casos,', 'todo OK' if base and not fallan else f'FALLAN {fallan} {base.get("_", "")}')
    if not mutar:
        sys.exit(0 if base and not fallan else 1)
    mal = []
    for nombre in (MUTACIONES if mutar == 'todas' else [mutar]):
        _, deben, no_deben = MUTACIONES[nombre]
        r = correr(conn, armar(nombre, local=local))
        cayeron = {c for c, ok in r.items() if not ok}
        muerde = 'ERROR' not in r and deben <= cayeron and not (no_deben & cayeron)
        print(f'{nombre}: caen {sorted(cayeron)}', 'MUERDE' if muerde else
              f'NO MUERDE (esperaba {sorted(deben)}{", sin " + str(sorted(no_deben)) if no_deben else ""}) {r.get("_", "")}')
        if not muerde:
            mal.append(nombre)
    total = len(MUTACIONES if mutar == 'todas' else [mutar])
    print(f'── mutaciones: {total - len(mal)} muerden · {len(mal)} con problema {mal or ""}')
    sys.exit(1 if mal else 0)


if __name__ == '__main__':
    main()
