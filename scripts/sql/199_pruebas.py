#!/usr/bin/env python3
"""
Arma y corre scripts/sql/199_pruebas.sql (compras F1: tablas fe_*, funciones de la Edge, pantalla de control): llena los
marcadores con el cuerpo de la 199 y el de su vuelta atrás, todo en una transacción que termina en ROLLBACK.

  python3 scripts/sql/199_pruebas.py --armar [--local] [--compacto] [--mutar X]   # imprime el SQL armado (MCP / editor)
  python3 scripts/sql/199_pruebas.py --psql "<conexión>" [--local] [--mutar todas | X]   # corre con psql y dice si muerde

--local   : suma scripts/sql/199_preludio_local.sql (Postgres vacío armado con scripts/sql/193_base_local.sql).
--compacto: sin comentarios ni sangría (para el conector MCP, que tiene tope de tamaño).
Corre en staging (ref hwiatgic…) o en un Postgres local. Nunca contra PROD (ref yiczgdti…): crea usuarios y
comprobantes ficticios dentro de la transacción descartada.
"""
from __future__ import annotations
import re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/199_fe_ingesta.sql'
ROLLBACK = RAIZ / 'scripts/sql/199_rollback.sql'
PRELUDIO = RAIZ / 'scripts/sql/199_preludio_local.sql'
BATERIA = RAIZ / 'scripts/sql/199_pruebas.sql'

POL_COMP = "         or ((select public.get_my_role()) = 'manager' and location_id is not null and public.puede_ver_local(location_id)));"
POL_LIN = ("create policy fe_lineas_leer on public.fe_lineas\n  for select to authenticated\n"
           "  using ((select public.get_my_role()) in ('owner', 'contador')\n")

# nombre → ([(archivo 'mig'|'rb', texto, reemplazo)], casos que tienen que caer, casos que NO pueden caer)
MUTACIONES: dict[str, tuple] = {
    'sin_idempotencia': ([('mig', "  clave              text        not null unique check", "  clave              text        not null check"),
                          ('mig', "  on conflict (clave) do nothing\n  returning id into v_id;", "  returning id into v_id;")],
                         {'11', '12', '13'}, {'10'}),
    'receptor_cualquiera': ([('mig', "  where r.cedula = c ->> 'receptor_cedula' and r.activo;", "  order by r.cedula desc limit 1;")],
                            {'14', '16'}, set()),
    'inactivo_vale': ([('mig', "  where r.cedula = c ->> 'receptor_cedula' and r.activo;", "  where r.cedula = c ->> 'receptor_cedula';")],
                      {'15'}, {'14', '17'}),
    'manager_cualquier_local': ([('mig', POL_COMP, "         or ((select public.get_my_role()) = 'manager'));")], {'52', '53'}, {'55'}),
    'lineas_abiertas': ([('mig', POL_LIN, "create policy fe_lineas_leer on public.fe_lineas\n  for select to authenticated\n  using (true or (select public.get_my_role()) in ('owner', 'contador')\n")],
                        {'54', '55'}, set()),
    'resumen_para_manager': ([('mig', "  if v_rol is null or v_rol not in ('owner', 'contador') then", "  if v_rol is null or v_rol not in ('owner', 'contador', 'manager') then")],
                             {'58'}, set()),
    'insert_abierto': ([('mig', "grant insert (cedula, location_id, activo), update (location_id, activo) on table public.fe_receptores to authenticated;",
                         "grant insert (cedula, location_id, activo), update (location_id, activo) on table public.fe_receptores to authenticated;\n"
                         "grant insert on table public.fe_comprobantes to authenticated;")], {'02'}, set()),
    'duplicado_sin_aviso': ([('mig', "           case when x.xml_sha256 is distinct from p ->> 'xml_sha256' then 'misma clave con otro XML (queda el primero)' end",
                              "           null")], {'13'}, {'11'}),
    'sello_falsificable': ([('mig', "grant insert (cedula, location_id, activo), update", "grant insert (cedula, location_id, activo, actualizado_por), update")],
                           {'61'}, set()),
    'anotar_cualquier_cosa': ([('mig', "  where p_resultado in ('no_comprobante', 'sin_xml', 'error');", "  where true;")], {'40'}, set()),
    'edge_ejecutable_por_usuarios': ([('mig', "grant execute on function public.fe_ingestar(jsonb) to service_role;",
                                       "grant execute on function public.fe_ingestar(jsonb) to service_role, authenticated;")], {'03'}, set()),
    'contador_carga_receptores': ([('mig', "  with check ((select public.get_my_role()) = 'owner');\ncreate policy fe_receptores_cambio",
                                    "  with check ((select public.get_my_role()) in ('owner', 'contador'));\ncreate policy fe_receptores_cambio")], {'62'}, set()),
    'rollback_deja_bucket': ([('rb', "delete from storage.buckets where id = 'fe-xml';\n", "")], {'90'}, set()),
}


def reemplazar(cuerpo: str, viejo: str, nuevo: str, nombre: str) -> str:
    if cuerpo.count(viejo) != 1:
        raise SystemExit(f'mutación {nombre}: el texto aparece {cuerpo.count(viejo)} veces (tiene que ser 1)')
    return cuerpo.replace(viejo, nuevo)


def armar(mutar: str | None = None, local: bool = False) -> str:
    cuerpo, rb = MIG.read_text(), ROLLBACK.read_text()
    if mutar:
        for donde, viejo, nuevo in MUTACIONES[mutar][0]:
            if donde == 'mig':
                cuerpo = reemplazar(cuerpo, viejo, nuevo, mutar)
            else:
                rb = reemplazar(rb, viejo, nuevo, mutar)
    sql = BATERIA.read_text()
    for marcador, texto in (('-- @@199@@\n', cuerpo + '\n'), ('-- @@199_rollback@@\n', rb + '\n'),
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
            sql = '\n'.join(l.strip() for l in sql.splitlines() if l.strip() and not l.strip().startswith('--'))
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
