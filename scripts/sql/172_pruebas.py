#!/usr/bin/env python3
"""
Batería de la 172 (origen club 118, hallazgo 231: el manager solo en sus locales, segunda tanda): arma
scripts/sql/172_pruebas.sql con el cuerpo de la 172 y el de su rollback, todo en UNA transacción que termina en
ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/172_pruebas.py --local [--db w231]           # Postgres 16 local (PGHOST/PGPORT/PGUSER del entorno)
  python3 scripts/sql/172_pruebas.py --local --mutar todas          # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/172_pruebas.py --armar [--mutar X]            # solo imprime el SQL (para staging, con el OK del dueño)

La base local tiene que tener las migraciones de main hasta la 171 (scripts/sql/local_armar_base.sh, que con este PR ya
aplica la 172: para probar, armar la base desde main o sin la 172). En staging el SQL de --armar se corre igual (ref
hwiatgic…, nunca prod) con la 170 aplicada: crea sus propios locales, usuarios y datos dentro de la transacción y no
deja nada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/172_club_local_manager_2.sql'
ROLLBACK = RAIZ / 'scripts/sql/172_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/172_pruebas.sql'

# nombre → (texto de la 172, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # sin el chequeo por id: vuelve el hallazgo en las por objeto
    'sin_chequeo_objeto': ("  if not public.club_puede_ver_local(p_location) then\n", "  if false then\n", {'2a', '2b'}),
    # el chequeo por id corta también sin objeto (el manager pierde el «no encontrado»)
    'objeto_null_corta': ("  if p_location is null then\n    return;\n  end if;\n", "", {'4a'}),
    # el chequeo por id se aplica a todos los roles (cajero/owner cambian respecto de hoy)
    'todos_los_roles': ("  if public.get_my_role() is distinct from 'manager'::public.user_role then\n    return;\n  end if;\n  -- Objeto",
                        "  -- Objeto", {'3a', '3c'}),
    # ranking del equipo sin envolver (el hallazgo tal cual)
    'sin_equipo': ("        ('public.club_reporte_equipo(date,text)',                       null::text),\n", "", {'0a', '2a', '2b', '6a'}),
    # reto: el local del parámetro, no el de la visita
    'reto_por_parametro': ("         'perform public.club_exigir_local(coalesce((select v.location_id from public.club_visitas_socio v where v.id = p_visita), p_location));'),\n",
                           "         null),\n", {'5a'}),
    # cupón sin normalizar el código: el manager de A con el código en minúsculas pasa el chequeo
    'cupon_sin_normalizar': ("where c.codigo = upper(btrim(coalesce(p_codigo, ''''))))", "where c.codigo = p_codigo)", {'2a', '2b'}),
    # el núcleo queda llamable por la API
    'nucleo_abierto': ("    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_nom || '__nucleo', v_ident);\n",
                       "", {'0c', '7a'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback no devuelve el EXECUTE de authenticated
    'rollback_sin_grant': ("    execute format('grant execute on function public.%I(%s) to authenticated', r.nom, v_ident);",
                           "    null;", {'8a'}),
    # el rollback se lleva también los de la 170
    'rollback_toca_170': ("     where n.nspname = 'public' and p.proname = any (array[",
                          "     where n.nspname = 'public' and (p.proname like 'club\\_%\\_\\_nucleo' or p.proname = any (array[", {'8a'}),
}
_RB_CIERRE = ("       'club_alerta_revisar__nucleo'])\n", "       'club_alerta_revisar__nucleo']))\n")


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def reemplazar(texto: str, mutar: str | None, tabla: dict, donde: str) -> str:
    if mutar in tabla:
        viejo, nuevo, _ = tabla[mutar]
        if texto.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en {donde}')
        texto = texto.replace(viejo, nuevo)
        if mutar == 'rollback_toca_170':
            texto = texto.replace(*_RB_CIERRE)
    return texto


def armar(mutar: str | None) -> str:
    mig = sin_tx(reemplazar(MIG.read_text(encoding='utf-8'), mutar, MUTACIONES, 'la 172'))
    rb = reemplazar(ROLLBACK.read_text(encoding='utf-8'), mutar, MUTACIONES_ROLLBACK, '172_rollback.sql')
    rb = sin_tx(re.sub(r"(?m)^delete from supabase_migrations\.schema_migrations.*$", '', rb))
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@172@@.*$', lambda _: mig, sql)
    if n != 1:
        sys.exit('172_pruebas.sql: falta el marcador «-- @@172@@»')
    sql, n = re.subn(r'(?m)^-- @@172R@@.*$', lambda _: rb, sql)
    if n != 1:
        sys.exit('172_pruebas.sql: falta el marcador «-- @@172R@@»')
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    p = subprocess.run(['psql', '-X', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    m = re.search(r'172-FALLAN: ([0-9a-z,()]+)', p.stderr)
    if m:
        return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')]
    if p.returncode != 0:
        sys.exit(f'ERROR: {p.stderr[:1500]}')
    filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
    if not filas:
        sys.exit(f'SIN RESULTADO: {p.stdout[-400:]}')
    return json.loads(filas[-1])


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    db = args[args.index('--db') + 1] if '--db' in args else 'w231'
    if '--armar' in args:
        print(armar(mutar))
        return
    if '--local' not in args:
        sys.exit(__doc__)
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar == 'todas':
        mal = 0
        for nombre, (_, _, deben) in todas.items():
            caidos = {r['caso'].split(' ')[0] for r in correr_local(armar(nombre), db) if not r['ok']}
            ok = deben <= caidos
            mal += not ok
            print(f"{'MUERDE' if ok else 'NO MUERDE'}  {nombre}: deben caer {sorted(deben)} · cayeron {sorted(caidos)}")
        sys.exit(1 if mal else 0)
    res = correr_local(armar(mutar), db)
    for r in res:
        print(f"{'OK ' if r['ok'] else 'MAL'} {r['caso']}" + ('' if r['ok'] else f"  · {r.get('detalle')}"))
    malos = [r for r in res if not r['ok']]
    if mutar:
        deben = todas[mutar][2]
        caidos = {r['caso'].split(' ')[0] for r in malos}
        print(f'mutación {mutar}: deben caer {sorted(deben)} · cayeron {sorted(caidos)}')
        sys.exit(0 if deben <= caidos else 1)
    print(f'{len(res) - len(malos)}/{len(res)}')
    sys.exit(1 if malos else 0)


if __name__ == '__main__':
    main()
