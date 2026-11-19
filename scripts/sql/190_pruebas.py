#!/usr/bin/env python3
"""
Arma scripts/sql/190_pruebas.sql (pos_ventas_resumen: Resumen de Ventas v2 por función): llena los marcadores con el
cuerpo de la 190 y el de su rollback, todo dentro de una transacción que termina en ROLLBACK. Necesita una base con
facturas del PoS (staging): la batería compara contra el cálculo por factura de esa misma base.

  python3 scripts/sql/190_pruebas.py --armar [--mutar X]   # imprime el SQL armado (para el editor SQL o la MCP)
  python3 scripts/sql/190_pruebas.py --psql "<conexión>" [--mutar todas]   # corre con psql y dice si muerde

Nunca contra PROD (ref yiczgdti…): la batería crea usuarios ficticios dentro de la transacción descartada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/190_pos_ventas_resumen.sql'
ROLLBACK = RAIZ / 'scripts/sql/190_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/190_pruebas.sql'

# nombre → ([(texto de la 190, reemplazo, veces)], casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # cualquier rol con sesión entra
    'sin_rol': ([("  if v_rol is null or v_rol not in ('owner', 'manager', 'contador') then\n",
                  "  if v_rol is null then\n", 1)], {'05'}),
    # (La mutación «la neta vuelve a contar las familias 6/17/20» NO muerde con datos reales: en el PoS esas líneas
    #  vienen con monto 0 (medido en staging, may–nov 2026). La cuida src/modules/ventas/resumenV2Agregado.test.ts.)
    # el lote deja de mirar las facturas que no son de salón
    'lotes_solo_salon': ([("    select f.cajero_login, f.fecha_cierra, min(f.fecha_registra) as apertura\n    from f\n",
                           "    select f.cajero_login, f.fecha_cierra, min(f.fecha_registra) as apertura\n    from f where f.canal = 'salon'\n", 1)], {'03'}),
    # la ventana sin el día de atrás
    'sin_dia_atras': ([("((p_desde - 1)::timestamp at time zone", "((p_desde)::timestamp at time zone", 1)], {'02', '03'}),
    # queda abierta a anon
    'anon': ([("revoke all on function public.pos_ventas_resumen(text, date, date) from public, anon;",
               "revoke all on function public.pos_ventas_resumen(text, date, date) from public;\n"
               "grant execute on function public.pos_ventas_resumen(text, date, date) to anon;", 1)], {'05'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        for viejo, nuevo, veces in MUTACIONES[mutar][0]:
            if mig.count(viejo) != veces:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 190')
            mig = mig.replace(viejo, nuevo)
    return _sacar_beg_com(mig)


def armar(mutar: str | None) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    for marca, fn in (('@@190@@', cuerpo), ('@@190R@@', lambda _m: _sacar_beg_com(ROLLBACK.read_text(encoding='utf-8')))):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'190_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    return sql


def correr(sql: str, conn: str) -> list[dict]:
    if 'yiczgdti' in conn:
        sys.exit('NO: eso es PROD')
    p = subprocess.run(['psql', conn, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    if p.returncode != 0:
        m = re.search(r'190-FALLAN: ([0-9a-z,]+)', p.stderr)
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
    if mutar and mutar != 'todas' and mutar not in MUTACIONES:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(MUTACIONES)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar))
        return
    if '--psql' not in args:
        sys.exit('falta --armar o --psql "<conexión>"')
    conn = args[args.index('--psql') + 1]
    if mutar:
        malas = []
        for nombre in (MUTACIONES if mutar == 'todas' else [mutar]):
            caen = {c['caso'].split(' ')[0] for c in correr(armar(nombre), conn) if not c['ok']}
            esperadas = MUTACIONES[nombre][1]
            print(f"{'muerde' if esperadas <= caen else 'NO MUERDE'} {nombre}: caen {sorted(caen)} (esperadas {sorted(esperadas)})")
            if not esperadas <= caen:
                malas.append(nombre)
        sys.exit(1 if malas else 0)
    casos = correr(armar(None), conn)
    for c in casos:
        print(('ok   ' if c['ok'] else 'FALLA ') + c['caso'] + (f" · {c['detalle']}" if c.get('detalle') else ''))
    sys.exit(1 if any(not c['ok'] for c in casos) else 0)


if __name__ == '__main__':
    main()
