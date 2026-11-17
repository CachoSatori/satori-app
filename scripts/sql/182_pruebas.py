#!/usr/bin/env python3
"""
Batería de la 182 (origen club 127: «Reservar una mesa» para TODO anfitrión; club_portal devuelve `reserva_url` arriba):
arma scripts/sql/182_pruebas.sql con el cuerpo de la 182 y el de su rollback, todo en UNA transacción que termina en
ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/182_pruebas.py --local [--db m182]          # Postgres 16 local (PGHOST/PGPORT/PGUSER)
  python3 scripts/sql/182_pruebas.py --local --mutar todas         # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/182_pruebas.py --armar [--mutar X]           # solo imprime el SQL (staging, nunca prod)

La base tiene que tener la 180 SIN la 182 (scripts/sql/local_armar_base.sh con el árbol de main, o con la 182 y su
rollback corrido antes). No necesita usuarios: el portal se llama como anon con el portón x-club-web.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/182_club_portal_reserva_anfitrion.sql'
ROLLBACK = RAIZ / 'scripts/sql/182_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/182_pruebas.sql'

# nombre → (texto de la 182, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # el anfitrión no recibe el link arriba (lo de la 180)
    'sin_clave': ("    v_j := v_j || jsonb_build_object('reserva_url', v_url);\n", "    null;\n", {'01', '02', '04', '05'}),
    # se le da a todos, también al socio puro y al anfitrión de baja
    'a_todos': ("  if v_j->'anfitrion' = 'true'::jsonb then\n", "  if true then\n", {'03'}),
    # sin el filtro de OpenTable: el link viejo que no es de OpenTable se devuelve
    'sin_filtro': ("   where g.location_id = v_loc and public.club_reserva_url_ok(g.reserva_url);\n",
                   "   where g.location_id = v_loc;\n", {'04'}),
    # siempre el link de un local fijo (no el del anfitrión)
    'local_fijo': ("   where g.location_id = v_loc and public.club_reserva_url_ok(g.reserva_url);\n",
                   "   where g.location_id = 'prueba182st' and public.club_reserva_url_ok(g.reserva_url);\n", {'01', '04', '05', '06'}),
    # se abre la interna a anon (y sin la verificación de la propia 182, que si no aborta antes)
    'abre_interna': (("revoke all on function public.club_portal(text) from public, anon, authenticated;\n",
                      "  if has_function_privilege('anon', 'public.club_portal_datos(text)', 'EXECUTE')\n     or "),
                     ("revoke all on function public.club_portal(text) from public, anon, authenticated;\n"
                      "grant execute on function public.club_portal_datos(text) to anon;\n", "  if "), {'07'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple] = {
    # el rollback no vuelve club_portal (queda la de la 182)
    'rollback_no_vuelve': ("create or replace function public.club_portal(p_token text)", "create or replace function pg_temp.nada182(p_token text)", {'08'}),
}


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def reemplazar(texto: str, mutar: str | None, tabla: dict, donde: str) -> str:
    if mutar in tabla:
        viejos, nuevos, _ = tabla[mutar]
        if isinstance(viejos, str):
            viejos, nuevos = (viejos,), (nuevos,)
        for viejo, nuevo in zip(viejos, nuevos):
            if texto.count(viejo) != 1:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en {donde}')
            texto = texto.replace(viejo, nuevo)
    return texto


def armar(mutar: str | None) -> str:
    mig = sin_tx(reemplazar(MIG.read_text(encoding='utf-8'), mutar, MUTACIONES, 'la 182'))
    rb = reemplazar(ROLLBACK.read_text(encoding='utf-8'), mutar, MUTACIONES_ROLLBACK, '182_rollback.sql')
    if mutar == 'rollback_no_vuelve':   # sin el comment/grant sobre la función que ya no se crea
        rb = re.sub(r"(?ms)^comment on function public\.club_portal\(text\) is.*?;\n", '', rb)
    rb = sin_tx(re.sub(r"(?m)^delete from supabase_migrations\.schema_migrations.*$", '', rb))
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@182@@.*$', lambda _: mig, sql)
    if n != 1:
        sys.exit('182_pruebas.sql: falta el marcador «-- @@182@@»')
    sql, n = re.subn(r'(?m)^-- @@182R@@.*$', lambda _: rb, sql)
    if n != 1:
        sys.exit('182_pruebas.sql: falta el marcador «-- @@182R@@»')
    return sql


def correr_local(sql: str, db: str) -> tuple[list[dict], str]:
    p = subprocess.run(['psql', '-X', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    resumen = next((l for l in p.stderr.splitlines() if '182 RESUMEN' in l), '')
    filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
    if '182-FALLAN' in p.stderr and filas:
        return json.loads(filas[-1]), resumen
    if p.returncode != 0:
        sys.exit(f'ERROR: {p.stderr[:1500]}')
    if not filas:
        sys.exit(f'SIN RESULTADO: {p.stdout[-400:]}')
    return json.loads(filas[-1]), resumen


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    db = args[args.index('--db') + 1] if '--db' in args else 'm182'
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar and mutar != 'todas' and mutar not in todas:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(todas)})')
    if '--armar' in args:
        print(armar(mutar))
        return
    if '--local' not in args:
        sys.exit(__doc__)
    if mutar == 'todas':
        mal = 0
        for nombre, (_, _, deben) in todas.items():
            res, _ = correr_local(armar(nombre), db)
            caidos = {r['caso'].split(' ')[0] for r in res if not r['ok']}
            ok = deben <= caidos
            mal += not ok
            print(f"{'MUERDE' if ok else 'NO MUERDE'}  {nombre}: deben caer {sorted(deben)} · cayeron {sorted(caidos)}")
        sys.exit(1 if mal else 0)
    res, resumen = correr_local(armar(mutar), db)
    for r in res:
        print(f"{'OK ' if r['ok'] else 'MAL'} {r['caso']}" + ('' if r['ok'] else f"  · {r.get('detalle')}"))
    print(resumen)
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
