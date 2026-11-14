#!/usr/bin/env python3
"""
Batería de la 160 (origen 106, Club → Tablero): arma scripts/sql/160_pruebas.sql con el cuerpo de la 160 y el de su
rollback, todo en UNA transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/160_pruebas.py --local [--db satori_1b]          # Postgres 16 local (psql como postgres)
  python3 scripts/sql/160_pruebas.py --local --mutar todas             # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/160_pruebas.py --armar [--mutar X]               # solo imprime el SQL (para staging, con firma)

La base local tiene que tener las migraciones hasta la 155 (shim de Supabase: roles anon/authenticated, auth.uid() que
lee request.jwt.claims). En staging el SQL de --armar se corre igual (ref hwiatgic…, nunca prod): crea sus propios
locales, usuarios y miembros de prueba dentro de la transacción y no deja nada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/160_club_tablero_plata.sql'
ROLLBACK = RAIZ / 'scripts/sql/160_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/160_pruebas.sql'

# nombre → (texto de la 160, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # el contador queda afuera
    'sin_contador': ("if v_rol is null or v_rol not in ('owner','manager','contador') then",
                     "if v_rol is null or v_rol not in ('owner','manager') then", {'1c', '3j', '5a', '7'}),
    # el cajero entra
    'cajero_entra': ("if v_rol is null or v_rol not in ('owner','manager','contador') then",
                     "if v_rol is null or v_rol not in ('owner','manager','contador','cajero') then", {'1d'}),
    # sin el chequeo de local (091): el manager de otro local entra
    'sin_local': ("  if not public.puede_ver_local(p_location) then        -- 091: el manager ve solo sus locales\n"
                  "    raise exception 'Sin permiso' using errcode = '42501';\n  end if;\n", "", {'1h'}),
    # una factura cuenta una vez por motivo (T3: socio + canje → dos veces)
    'doble_conteo': ("      from tk left join neta n on n.ticket_id = tk.id left join fl on fl.tid = tk.id),",
                     "      from tk left join neta n on n.ticket_id = tk.id left join (select tid, motivo = 'socio' as socio, "
                     "motivo = 'cupon' as cupon, motivo = 'canje' as canje from reg where tid is not null) fl on fl.tid = tk.id),",
                     {'3a', '3b'}),
    # cortes de mes en UTC en vez de hora CR
    'mes_utc': ("  v_ini := v_mes::timestamp at time zone 'America/Costa_Rica';\n"
                "  v_fin := (v_mes + interval '1 month')::timestamp at time zone 'America/Costa_Rica';\n",
                "  v_ini := v_mes::timestamp at time zone 'UTC';\n"
                "  v_fin := (v_mes + interval '1 month')::timestamp at time zone 'UTC';\n", {'3c'}),
    # las anuladas cuentan
    'con_anuladas': ("     where t.local = p_location and t.estado = 'C'\n       and coalesce(t.fecha_registra, t.fecha_cierra) >= v_ini\n",
                     "     where t.local = p_location and t.estado in ('C','X')\n       and coalesce(t.fecha_registra, t.fecha_cierra) >= v_ini\n",
                     {'3c'}),   # la anulada no cruza (club_cruce_detalle solo mira C): cae el total del mes
    # la neta incluye cortesías de gerencia (familia 17)
    'neta_con_17': ("filter (where l.familia is null or l.familia not in (6, 17, 20)) as neta",
                    "filter (where true) as neta", {'3b'}),
    # la referencia toma también las facturas con marcador (856 a precio rebajado)
    'ref_con_marcador': ("       and not exists (select 1 from mk where mk.ticket_id = t.id)\n", "", {'3d', '3g'}),
    # % de cortesías fijo en 35 (ignora la config)
    'pct_fijo': ("'cortesias_costo_crc', round(ct.lista_crc * v_cfg.cortesia_costo_pct / 100),",
                 "'cortesias_costo_crc', round(ct.lista_crc * 35 / 100),", {'6b'}),
    # canjes a valor de la config de hoy en vez del movimiento (con valor distinto, cae; acá se fuerza 1)
    'canje_sin_valor': ("coalesce(sum(m.creditos * m.valor_credito_crc), 0) as crc", "coalesce(sum(m.creditos), 0) as crc",
                        {'3f', '3g'}),
    # el equipo cuenta en el pasivo
    'equipo_en_pasivo': ("(m.tipo = 'equipo' or (k.corte is not null and v.registrado_en <= k.corte)) as congelado",
                         "(k.corte is not null and v.registrado_en <= k.corte) as congelado", {'4a', '4c', '4d'}),
    # lo de antes del corte del equipo (157) revive en el pasivo
    'sin_corte': ("(m.tipo = 'equipo' or (k.corte is not null and v.registrado_en <= k.corte)) as congelado",
                  "(m.tipo = 'equipo') as congelado", {'4a', '4c', '4d'}),
    # sin rastro en club_auditoria
    'sin_rastro': ("  perform public.club_auditar('ver_tablero', 'club_tablero_mes', null, null,\n"
                   "    jsonb_build_object('mes', to_char(v_mes, 'YYYY-MM'), 'local', p_location));\n", "", {'7'}),
    # anon con EXECUTE
    'anon_ejecuta': ("grant execute on function public.club_tablero_mes(date, text) to authenticated;",
                     "grant execute on function public.club_tablero_mes(date, text) to authenticated, anon;", {'0', '1i'}),
}
# mutaciones del rollback
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    'rollback_deja_columna': ("alter table public.club_config drop column if exists cortesia_costo_pct;\n", "", {'8'}),
}


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 160')
        mig = mig.replace(viejo, nuevo)
    # la verificación final de la 160 aborta con algunas mutaciones (anon): se saca para que caigan los CASOS
    mig = re.sub(r'(?s)-- Verificación: la función existe.*?\nend \$\$;\n', '', mig)
    return sin_tx(mig)


def cuerpo_rollback(mutar: str | None) -> str:
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está en 160_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    rb = re.sub(r'(?s)\ndo \$\$\nbegin\n  if to_regprocedure.*?\nend \$\$;\n', '\n', rb)
    return sin_tx(rb)


def armar(mutar: str | None) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@160@@.*$', lambda _: cuerpo(mutar), sql)
    if n != 1:
        sys.exit('160_pruebas.sql: falta el marcador «-- @@160@@»')
    sql, n = re.subn(r'(?m)^-- @@160R@@.*$', lambda _: cuerpo_rollback(mutar), sql)
    if n != 1:
        sys.exit('160_pruebas.sql: falta el marcador «-- @@160R@@»')
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    p = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, capture_output=True, text=True)
    m = re.search(r'160-FALLAN: ([0-9a-z,()]+)', p.stderr)
    if m:
        return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
    if p.returncode != 0:
        sys.exit(f'ERROR: {p.stderr[:600]}')
    filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
    if not filas:
        sys.exit(f'SIN RESULTADO: {p.stdout[-400:]}')
    return json.loads(filas[-1])


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    db = args[args.index('--db') + 1] if '--db' in args else 'satori_1b'
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar and mutar != 'todas' and mutar not in todas:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(todas)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar))
        return
    if '--local' not in args:
        sys.exit('usá --local (Postgres local) o --armar (imprime el SQL para staging)')
    if mutar:
        malas = []
        for nombre in (todas if mutar == 'todas' else [mutar]):
            caen = {c['caso'].split(' ')[0] for c in correr_local(armar(nombre), db) if not c['ok']}
            esperadas = todas[nombre][2]
            print(f"{'muerde' if esperadas <= caen else 'NO MUERDE'} {nombre}: caen {sorted(caen)} (esperadas {sorted(esperadas)})")
            if not esperadas <= caen:
                malas.append(nombre)
        sys.exit(1 if malas else 0)
    casos = correr_local(armar(None), db)
    for c in casos:
        print(f"{'OK ' if c['ok'] else 'MAL'} {c['caso']}" + ('' if c['ok'] else f"  ← {c.get('detalle')}"))
    malos = [c for c in casos if not c['ok']]
    print(f"\n{len(casos) - len(malos)}/{len(casos)} casos OK")
    sys.exit(1 if malos else 0)


if __name__ == '__main__':
    main()
