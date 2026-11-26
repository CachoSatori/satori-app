#!/usr/bin/env python3
"""
Arma y corre scripts/sql/201_pruebas.sql (compras F1, hallazgos 257/258): llena los marcadores con el cuerpo de la 201 y
el de su vuelta atrás, todo en una transacción que termina en ROLLBACK.

  python3 scripts/sql/201_pruebas.py --armar [--local] [--compacto] [--mutar X]      # imprime el SQL armado
  python3 scripts/sql/201_pruebas.py --psql "<conexión>" [--local] [--mutar todas | X]  # corre con psql y dice si muerde

--local: suma scripts/sql/201_preludio_local.sql (Postgres 16 armado con `HASTA=200 bash scripts/sql/local_armar_base.sh`).
Necesita la 199 aplicada y la 201 NO. Corre en staging (ref hwiatgic…) o local. Nunca contra PROD (ref yiczgdti…).
"""
from __future__ import annotations
import re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/201_fe_versiones_revisar.sql'
ROLLBACK = RAIZ / 'scripts/sql/201_rollback.sql'
PRELUDIO = RAIZ / 'scripts/sql/201_preludio_local.sql'
BATERIA = RAIZ / 'scripts/sql/201_pruebas.sql'

POL_VER = ("create policy fe_comprobante_versiones_leer on public.fe_comprobante_versiones\n  for select to authenticated\n"
           "  using ((select public.get_my_role()) in ('owner', 'contador')\n")

# nombre → ([(archivo 'mig'|'rb', texto, reemplazo)], casos que tienen que caer, casos que NO pueden caer)
MUTACIONES: dict[str, tuple] = {
    'primero_gana': ([('mig', "    if v_ver is null then\n      -- mismo XML", "    if true then\n      -- mismo XML")],
                     {'12', '14', '15'}, {'10', '11'}),
    'sin_version_al_crear': ([('mig', "  insert into public.fe_comprobante_versiones (comprobante_id, xml_sha256, xml_path, fuente, lote)\n  values (v_id, v_sha, v_path, v_fuente, p ->> 'lote');\n", "")],
                             {'10'}, set()),
    'motivo_repetido': ([('mig', "  select left(case when p_nuevo is null or position(p_nuevo in coalesce(p_motivo, '')) > 0 then p_motivo",
                          "  select left(case when p_nuevo is null then p_motivo")], {'13'}, {'12'}),
    'emisor_cualquiera': ([('mig', "  if not exists (select 1 from public.fe_emisores_conocidos e where e.cedula = c ->> 'emisor_cedula' and e.activo) then",
                            "  if false then")], {'16', '17', '18'}, {'10'}),
    'emisor_inactivo_vale': ([('mig', "e.cedula = c ->> 'emisor_cedula' and e.activo)", "e.cedula = c ->> 'emisor_cedula')")], {'17'}, {'16'}),
    'ruta_sin_sha': ([('mig', "  if v_path is null or right(v_path, 69) <> '/' || v_sha || '.xml' then", "  if v_path is null then")], {'20'}, set()),
    'respuesta_primera_gana': ([('mig', "    if v_ver is null then\n      v_res := 'duplicado';", "    if true then\n      v_res := 'duplicado';")],
                               {'31', '32', '33', '34'}, {'30'}),
    'respuesta_no_marca_comprobante': ([('mig', "             motivo = public.fe_motivo_sumar(x.motivo, m_resp)\n       where x.clave = v_clave;",
                                         "             motivo = public.fe_motivo_sumar(x.motivo, m_resp)\n       where false;")], {'33'}, {'31'}),
    'huella_sin_receptor': ([('mig', "coalesce(v_det, ''), coalesce(r ->> 'receptor_cedula', '')), 'UTF8')), 'hex');\n  perform",
                              "coalesce(v_det, '')), 'UTF8')), 'hex');\n  perform")], {'34'}, {'31'}),
    'edge_ejecutable_por_usuarios': ([('mig', "grant execute on function public.fe_ingestar(jsonb) to service_role;",
                                       "grant execute on function public.fe_ingestar(jsonb) to service_role, authenticated;")], {'03'}, set()),
    'versiones_abiertas': ([('mig', POL_VER, POL_VER.replace("using ((select", "using (true or (select"))], {'51', '52'}, set()),
    'contador_carga_emisores': ([('mig', "create policy fe_emisores_conocidos_alta on public.fe_emisores_conocidos\n  for insert to authenticated\n  with check ((select public.get_my_role()) = 'owner');",
                                  "create policy fe_emisores_conocidos_alta on public.fe_emisores_conocidos\n  for insert to authenticated\n  with check ((select public.get_my_role()) in ('owner', 'contador'));")], {'55'}, set()),
    'sin_revoke_tablas': ([('mig', "revoke all on table public.fe_comprobante_versiones, public.fe_respuesta_versiones, public.fe_emisores_conocidos\n  from public, anon, authenticated;", "")],
                          {'02'}, set()),
    'resumen_sin_respuestas': ([('mig', "                               where x.estado = 'revisar'\n", "                               where false\n")], {'56'}, set()),
    'sin_relleno': ([('mig', "select c.id, c.xml_sha256, c.xml_path, c.fuente, null, c.recibido_en from public.fe_comprobantes c;",
                      "select c.id, c.xml_sha256, c.xml_path, c.fuente, null, c.recibido_en from public.fe_comprobantes c where false;")], {'05'}, set()),
    'rollback_deja_tabla': ([('rb', "drop table if exists public.fe_emisores_conocidos;\n", "")], {'90'}, set()),
    'rollback_no_restaura_ingestar': ([('rb', "'misma clave con otro XML (queda el primero)'", "'misma clave con otro XML'")], {'90'}, {'91'}),
    'rollback_sin_permisos': ([('rb', "grant execute on function public.fe_respuesta_registrar(jsonb) to service_role;", "grant execute on function public.fe_respuesta_registrar(jsonb) to service_role, authenticated;")], {'90'}, set()),
}


def reemplazar(cuerpo: str, viejo: str, nuevo: str, nombre: str) -> str:
    if cuerpo.count(viejo) != 1:
        raise SystemExit(f'mutación {nombre}: el texto aparece {cuerpo.count(viejo)} veces (tiene que ser 1)')
    return cuerpo.replace(viejo, nuevo)


def armar(mutar: str | None = None, local: bool = False) -> str:
    cuerpo, rb = MIG.read_text(), ROLLBACK.read_text()
    if re.search(r'storage\.(buckets|objects)', '\n'.join(l for l in rb.splitlines() if not l.strip().startswith('--')), re.I):
        raise SystemExit('201_rollback.sql no puede tocar storage.buckets/objects por SQL')
    if mutar:
        for donde, viejo, nuevo in MUTACIONES[mutar][0]:
            if donde == 'mig':
                cuerpo = reemplazar(cuerpo, viejo, nuevo, mutar)
            else:
                rb = reemplazar(rb, viejo, nuevo, mutar)
    sql = BATERIA.read_text()
    for marcador, texto in (('-- @@201@@\n', cuerpo + '\n'), ('-- @@201_rollback@@\n', rb + '\n'),
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
