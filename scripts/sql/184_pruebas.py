#!/usr/bin/env python3
"""
Corre scripts/sql/184_pruebas.sql (origen club 129: el reporte de descuentos suma todas las líneas sin respaldo): llena
los marcadores con el cuerpo de la 184 y el de su rollback, todo dentro de una transacción que termina en ROLLBACK, y
sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/184_pruebas.py --local "host=/tmp port=5499 user=pgv dbname=X" [--semilla-local]
                                                         # Postgres 16 local armado con local_armar_base.sh (con la 183, sin la 184)
  python3 scripts/sql/184_pruebas.py ... --mutar todas   # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/184_pruebas.py --armar [--mutar X] # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios).
La batería escribe datos ficticios en tablas: en staging la herramienta de SQL lo cancela, así que corre en local. En
staging corren, en transacciones descartadas, las lecturas con datos reales (PASE-184 §3).
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/184_club_descuentos_todas_lineas.sql'
ROLLBACK = RAIZ / 'scripts/sql/184_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/184_pruebas.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8184-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8184-0000000000aa';
"""

# Una mutación cambia el md5 final: se apagan las guardas de md5 de la migración y el rollback se saltea (su propia
# guarda lo frenaría), así que además de los casos propios caen el 01 y el 12.
SIN_GUARDAS = (("  if md5(pg_get_functiondef(v_fn)) <> '0b7b956e5670f617ace9ff9e6637f222' then", "  if false then"),
               ("  if md5(pg_get_functiondef('public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure)) <> '7a5e33e2565a1dc493965c007fa76058' then",
                "  if false then"))

# nombre → (texto de la 184, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # el reporte vuelve a sumar solo la línea ejemplo
    'solo_ejemplo': ("coalesce(sum((l.v->>'descuento_crc')::numeric), 0)",
                     "coalesce(sum(distinct (e.detalle->>'descuento_crc')::numeric), 0)", {'06', '10', '11'}),
    # cada línea en la clasificación de la ejemplo, no en la suya
    # (el ancla está 2 veces: el select y el order by; se cambian las dos)
    'clase_de_la_ejemplo': ("coalesce(l.v->>'clasificacion', 'sin clasificar')", "coalesce(e.detalle->>'clasificacion', 'sin clasificar')",
                            {'06'}, 2),
    # «facturas» cuenta líneas, no facturas
    'facturas_cuenta_lineas': ("count(distinct e.n)::int", "count(*)::int", {'06', '11'}),
    # la ventana acumula (sin el marco): la ejemplo ve solo sus primeras líneas
    'ventana_acumulada': ("\n                 rows between unbounded preceding and unbounded following)", ")", {'04', '05', '06', '11'}),
    # el mes en UTC, no en hora de Costa Rica
    'mes_en_utc': ("    select to_char(e.fecha at time zone 'America/Costa_Rica', 'YYYY-MM'),\n           coalesce(l.v",
                   "    select to_char(e.fecha, 'YYYY-MM'),\n           coalesce(l.v", {'06', '08'}),
    # la clasificación de cada línea sin la tolerancia de ±1,5 puntos: ninguna línea queda tipificada
    'clas_sin_tolerancia': ("                       and abs(100 * (1 - k.u / r.ref) - dt.pct) <= 1.5\n",
                            "                       and abs(100 * (1 - k.u / r.ref) - dt.pct) < 0\n", {'02', '03', '04', '05', '06'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        viejo, nuevo = MUTACIONES[mutar][:2]
        veces = MUTACIONES[mutar][3] if len(MUTACIONES[mutar]) > 3 else 1
        if mig.count(viejo) != veces:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 184')
        mig = mig.replace(viejo, nuevo)
        for v, n in SIN_GUARDAS:
            if mig.count(v) != 1:
                sys.exit('una guarda de md5 no está en la 184')
            mig = mig.replace(v, n)
    return _sacar_beg_com(mig)


def cuerpo_rollback(mutar: str | None) -> str:
    if mutar:
        return '-- (rollback salteado: la función mutada no es la de la 184)'
    return _sacar_beg_com(ROLLBACK.read_text(encoding='utf-8')).replace(
        "delete from supabase_migrations.schema_migrations where version = '184';",
        "-- (batería: sin fila 184 que borrar)")


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    for marca, fn in (('@@184@@', cuerpo), ('@@184R@@', cuerpo_rollback)):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'184_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def correr(sql: str, local: str) -> list[dict]:
    p = subprocess.run(['psql', local, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    for l in p.stderr.splitlines():
        if '184 FALLA' in l or '184 RESUMEN' in l:
            print('   ', l.split('WARNING:  ')[-1].split('NOTICE:  ')[-1][:300])
    if p.returncode != 0:
        m = re.search(r'184-FALLAN: ([0-9a-z,]+)', p.stderr)
        if m:
            return [{'caso': c, 'ok': False} for c in m.group(1).split(',')]
        sys.exit(f'ERROR: {p.stderr[:800]}')
    linea = next((l for l in p.stdout.splitlines() if l.startswith('[{')), None)
    if not linea:
        sys.exit(f'SIN RESULTADO: {p.stdout[:400]}')
    return json.loads(linea)


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    semilla = '--semilla-local' in args
    if mutar and mutar != 'todas' and mutar not in MUTACIONES:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(MUTACIONES)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar, semilla))
        return
    if '--local' not in args:
        sys.exit('falta --local "<conexión>" (la batería escribe datos ficticios: solo Postgres local)')
    local = args[args.index('--local') + 1]
    if mutar:
        malas = []
        for nombre in (MUTACIONES if mutar == 'todas' else [mutar]):
            caen = {c['caso'].split(' ')[0] for c in correr(armar(nombre, semilla), local) if not c['ok']}
            esperadas = MUTACIONES[nombre][2]
            print(f"{'muerde' if esperadas <= caen else 'NO MUERDE'} {nombre}: caen {sorted(caen)} (esperadas {sorted(esperadas)})")
            if not esperadas <= caen:
                malas.append(nombre)
        sys.exit(1 if malas else 0)
    casos = correr(armar(None, semilla), local)
    for c in casos:
        print(('ok   ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if c.get('detalle') else ''))
    caen = [c for c in casos if not c['ok']]
    print(f'── {len(casos)} casos · {len(casos) - len(caen)} ok')
    sys.exit(1 if caen else 0)


if __name__ == '__main__':
    main()
