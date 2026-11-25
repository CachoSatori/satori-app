#!/usr/bin/env python3
"""
Arma y corre scripts/sql/198_pruebas.sql (catálogo por código y pos_ventas_productos): llena los marcadores con el
cuerpo de la 198 y el de su vuelta atrás, todo en una transacción que termina en ROLLBACK.

  python3 scripts/sql/198_pruebas.py --armar [--medir] [--local] [--mutar X]   # imprime el SQL armado (MCP / editor)
  python3 scripts/sql/198_pruebas.py --psql "<conexión>" [--local] [--mutar todas | X]   # corre con psql y dice si muerde

--local  : suma scripts/sql/198_preludio_local.sql (Postgres vacío con 193_base_local.sql + la 190).
--compacto: sin líneas de comentario ni sangría (para pegar en el conector MCP, que tiene tope de tamaño).
--medir  : suma marcas de tiempo dentro de la 198 (crear el disparador, carga inicial, herencia, y del disparador al
           final de la migración = lo que la tabla de líneas queda bloqueada para la ingesta dentro de la transacción).
Corre en staging (ref hwiatgic…, con el conector MCP: se arma con --armar --medir y se pega) o en un Postgres local.
Nunca contra PROD (ref yiczgdti…): la batería crea usuarios y facturas ficticias dentro de la transacción descartada.
"""
from __future__ import annotations
import re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/198_pos_catalogo_productos.sql'
ROLLBACK = RAIZ / 'scripts/sql/198_rollback.sql'
PRELUDIO = RAIZ / 'scripts/sql/198_preludio_local.sql'
BATERIA = RAIZ / 'scripts/sql/198_pruebas.sql'

MGR = "  if v_rol = 'manager' and not public.puede_ver_local(p_local) then"
GERENCIA = "  if v_rol is null or v_rol not in ('owner', 'manager', 'contador') then"
LISTA = ("  if p_categoria is not null\n     and p_categoria not in ('comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros') then\n"
         "    raise exception 'Categoría fuera de la lista' using errcode = '22023';\n  end if;\n")
REGLA_NO_VENTA = ("    when p_familia = 17 then 'cortesia'\n    when p_familia = 6  then 'personal'\n"
                  "    when p_familia = 20 then 'ingredientes'\n")
CHECK_AJUSTE = "  categoria       text        check (categoria in ('comida', 'bebida', 'menu_especial', 'extras', 'merch', 'otros')),"
POLITICA_PRODUCTOS = ("create policy pos_productos_leer on public.pos_productos\n  for select to authenticated\n"
                      "  using ((select public.get_my_role()) in ('owner', 'contador')\n"
                      "         or ((select public.get_my_role()) = 'manager' and public.puede_ver_local(local)));")

# nombre → ([(texto de la 198, reemplazo, n.º de aparición o 0 = todas)], casos que tienen que caer, casos que NO pueden caer)
MUTACIONES: dict[str, tuple] = {
    'fam17_es_venta': ([("filter (where l.familia is null or l.familia not in (6, 17, 20)), 0)",
                         "filter (where l.familia is null or l.familia not in (6, 20)), 0)", 0)], {'26', '27'}, set()),
    'cuenta_anuladas': ([("      and tk.estado = 'C'\n      and tk.fecha_registra >= (p_desde", "      and tk.fecha_registra >= (p_desde", 0)],
                        {'26', '27', '30'}, set()),
    'dia_corta_un_dia_despues': ([("((p_hasta + 1)::timestamp at time zone 'America/Costa_Rica')",
                                   "((p_hasta + 2)::timestamp at time zone 'America/Costa_Rica')", 0)], {'26', '27', '31'}, set()),
    'sin_lineas_no_suma': ([("from l) + (select sl.cts from sl)", "from l) + 0", 0)], {'26', '27'}, set()),
    'categoria_pisa_familia': ([(REGLA_NO_VENTA, "", 0)], {'46', '48'}, {'27', '47'}),
    'menu_especial_no_es_venta': ([("    else coalesce(p_de_codigo, p_de_familia, 'otros')",
                                    "    when p_de_codigo = 'menu_especial' then 'cortesia'\n    else coalesce(p_de_codigo, p_de_familia, 'otros')", 0)],
                                  {'51', '52'}, {'27', '47'}),
    'guardado_sin_lista': ([(LISTA, "", 0)], {'53', '54', '55', '56', '57', '58', '59', '60'}, set()),
    'guardado_deja_cambiar_familia_fija': ([("  if p_categoria is not null and (v_fam in (6, 17, 20) or v_cat_fam in ('giftcard', 'pax', 'duenos')) then",
                                             "  if false then", 0)], {'61', '62', '63', '64', '66'}, {'71'}),
    # las tres defensas rotas a la vez: el reparto se rompe; la NETA contra la 190 no se mueve (27, 47, 51 no caen)
    'tres_defensas_rotas': ([(CHECK_AJUSTE, "  categoria       text,", 0), (LISTA, "", 0), (REGLA_NO_VENTA, "", 0),
                             ("  if p_categoria is not null and (v_fam in (6, 17, 20) or v_cat_fam in ('giftcard', 'pax', 'duenos')) then",
                              "  if false then", 0)],
                            {'53', '54', '55', '61', '73'}, {'26', '27', '47'}),
    'familia_cualquiera_cortesia': ([("  constraint pos_familias_no_venta_chk\n    check ((familia in (6, 17, 20)) = (categoria in ('cortesia', 'personal', 'ingredientes')))\n",
                                      "  constraint pos_familias_no_venta_chk check (true)\n", 0)], {'14'}, set()),
    'categoria_fuera_de_mixtas': ([(" and p.familia in (1, 9, 11, 15, 25)\n", "\n", 0)], {'08'}, set()),
    'mixtas_sin_1_y_9': ([(" and p.familia in (1, 9, 11, 15, 25)\n", " and p.familia in (11, 15, 25)\n", 0)], {'09', '93'}, set()),
    'sin_regla_fijas': ([("    when p_de_familia in ('giftcard', 'pax', 'duenos') then p_de_familia\n", "", 0)], {'94'}, set()),
    'cero_cuenta_todas': ([("filter (where l.monto_cts = 0)", "filter (where true)", 0)], {'34'}, set()),
    'manager_lee_cualquier_local': ([(MGR, "  if false then", 1)], {'79'}, set()),
    'manager_catalogo_cualquier_local': ([(MGR, "  if false then", 2)], {'80'}, set()),
    'manager_guarda_cualquier_local': ([(MGR, "  if false then", 3)], {'81'}, set()),
    'contador_guarda': ([("  if v_rol is null or v_rol not in ('owner', 'manager') then", GERENCIA, 0)], {'76'}, set()),
    'catalogo_cualquier_rol': ([(GERENCIA, "  if v_rol is null then", 2)], {'83', '84'}, set()),
    'factura_vieja_pisa': ([("    nombre         = case when excluded.visto_hasta >= p.visto_hasta then excluded.nombre  else p.nombre  end,\n"
                             "    familia        = case when excluded.visto_hasta >= p.visto_hasta then excluded.familia else p.familia end,",
                             "    nombre         = excluded.nombre,\n    familia        = excluded.familia,", 0)], {'22'}, set()),
    'politica_abierta': ([(POLITICA_PRODUCTOS, "create policy pos_productos_leer on public.pos_productos\n  for select to authenticated\n  using (true);", 0)],
                         {'78', '82', '83'}, set()),
    'disparador_sin_captura': ([("  exception when others then\n    raise warning '198 pos_catalogo_registrar: % (%)', sqlerrm, sqlstate;\n", "", 0)],
                               {'89'}, set()),
    'internas_abiertas': ([("revoke all on function public.pos_categoria_efectiva(integer, text, text) from public, anon, authenticated;",
                            "grant execute on function public.pos_categoria_efectiva(integer, text, text) to authenticated;", 0)], {'86', '87'}, set()),
}

# --medir: (ancla en la 198, qué va antes, qué va después) — marcas de tiempo, no cambian nada de la migración.
def _ms(k: str, desde: str) -> str:
    return (f"insert into _m198 values ('{k}', round(extract(epoch from clock_timestamp() - "
            f"current_setting('p198.{desde}')::timestamptz) * 1000)::text);")

def _marca(k: str) -> str:
    return f"select set_config('p198.{k}', clock_timestamp()::text, true);"

MEDIR = [
    ("create trigger trg_pos_catalogo_registrar\n", _marca('t_trg'), None),
    ("  for each statement execute function public.pos_catalogo_registrar();\n", None, _ms('crear_disparador_ms', 't_trg')),
    ("select x.local, public.pos_catalogo_refrescar(x.local) as productos\n", _marca('t_carga'), None),
    ("from (select distinct local from public.pos_ndf_tickets) x;\n", None, _ms('carga_inicial_ms', 't_carga')),
    ("with pm as (\n", _marca('t_her'), None),
    ("where pm.rinde is not null or cc.categoria is not null;\n", None, _ms('herencia_ms', 't_her')),
]


def reemplazar(cuerpo: str, viejo: str, nuevo: str, vez: int, nombre: str) -> str:
    n = cuerpo.count(viejo)
    if n == 0 or (vez and n < vez):
        raise SystemExit(f'mutación {nombre}: no encuentro el texto (aparece {n} veces)')
    if not vez:
        return cuerpo.replace(viejo, nuevo)
    i = -1
    for _ in range(vez):
        i = cuerpo.index(viejo, i + 1)
    return cuerpo[:i] + nuevo + cuerpo[i + len(viejo):]


def armar(mutar: str | None = None, medir: bool = False, local: bool = False) -> str:
    cuerpo = MIG.read_text()
    if mutar:
        for viejo, nuevo, vez in MUTACIONES[mutar][0]:
            cuerpo = reemplazar(cuerpo, viejo, nuevo, vez, mutar)
    if medir:
        for ancla, antes, despues in MEDIR:
            if cuerpo.count(ancla) != 1:
                raise SystemExit(f'--medir: el ancla «{ancla.strip()}» no aparece una sola vez')
            cuerpo = cuerpo.replace(ancla, (antes + '\n' if antes else '') + ancla + (despues + '\n' if despues else ''))
        cuerpo += '\n' + _ms('disparador_hasta_fin_de_la_migracion_ms', 't_trg') + '\n'
    sql = BATERIA.read_text()
    for marcador, texto in (('-- @@198@@\n', cuerpo + '\n'), ('-- @@198_rollback@@\n', ROLLBACK.read_text() + '\n'),
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
    local, medir = '--local' in args, '--medir' in args
    if '--armar' in args:
        sql = armar(mutar if mutar != 'todas' else None, medir, local)
        if '--compacto' in args:
            sql = '\n'.join(l.strip() for l in sql.splitlines() if l.strip() and not l.strip().startswith('--'))
            # los rótulos de los casos quedan en su número (el texto está en el .sql): entra en el tope del conector
            sql = re.sub(r"^select '(\d\d) [^']*',", r"select '\1',", sql, flags=re.M)
            sql = re.sub(r"format\('%s [^']*'", "format('%s'", sql)
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
        extra = f' · y NO cayeron, como debe ser: {sorted(no_deben)}' if no_deben and muerde else ''
        print(f'{nombre}: caen {sorted(cayeron)}', ('MUERDE' + extra) if muerde else
              f'NO MUERDE (esperaba {sorted(deben)}{", sin " + str(sorted(no_deben)) if no_deben else ""}) {r.get("_", "")}')
        if not muerde:
            mal.append(nombre)
    print(f'── mutaciones: {len(MUTACIONES if mutar == "todas" else [mutar]) - len(mal)} muerden · {len(mal)} con problema {mal or ""}')
    sys.exit(1 if mal else 0)


if __name__ == '__main__':
    main()
