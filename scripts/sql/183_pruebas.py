#!/usr/bin/env python3
"""
Corre scripts/sql/183_pruebas.sql (origen club 128): llena los marcadores con el cuerpo de la 183 y el de su rollback,
todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/183_pruebas.py                         # STAGING sin la 183 (Management API; token del proxy o SUPABASE_ACCESS_TOKEN)
  python3 scripts/sql/183_pruebas.py --local "host=/tmp port=5498 user=pgv dbname=X" [--semilla-local]
                                                             # Postgres 16 local armado con las migraciones + 181 (sin la 183)
  python3 scripts/sql/183_pruebas.py ... --mutar umbral_sin_tolerancia   # una mutación: tienen que caer sus casos
  python3 scripts/sql/183_pruebas.py ... --mutar todas       # todas, una por una
  python3 scripts/sql/183_pruebas.py --armar [--mutar X]     # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios).
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REF = 'hwiatgicyyqyezqwldia'   # SOLO staging
RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/183_club_excepciones_rapida.sql'
ROLLBACK = RAIZ / 'scripts/sql/183_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/183_pruebas.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8183-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8183-0000000000aa';
"""

# Las mutaciones del núcleo cambian su md5 final: se apaga la guarda de md5 de la migración, y el rollback no puede
# volver ese núcleo (su propia guarda lo frena), así que se salta entero: además del caso propio cae el 07.
SIN_GUARDA_NUCLEO = ("  if md5(pg_get_functiondef(v_fn)) <> 'bd1b4d15e6ec6453d540c59b61d80d76' then", "  if false then")

# nombre → (texto de la 183, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # sin la tolerancia de 0,1 %: el día -3 de prueba183a pasa a dar excepciones que antes no daba
    'umbral_sin_tolerancia': ("               and (select sum(x.n) filter (where x.u <= k.u * 1.001)::numeric",
                              "               and (select sum(x.n) filter (where x.u < k.u)::numeric", {'01', '02', '03', '07'}),
    # cuenta filas (precios distintos) en vez de ventas: el cambio de lista del día -4 deja de detectarse
    'cuenta_por_filas': ("(select sum(x.n) filter (where x.u <= k.u * 1.001)::numeric / nullif(sum(x.n), 0)\n                      from unnest",
                         "(select count(*) filter (where x.u <= k.u * 1.001)::numeric / nullif(count(*), 0)\n                      from unnest",
                         {'01', '02', '03', '07'}),
    # el join pierde el día: cruza solo por artículo (mezcla las ventas de todos los días)
    'join_sin_dia': ("              left join ddia q on q.cod = k.cod and q.dia = k.dia   -- 183",
                     "              left join ddia q on q.cod = k.cod and q.dia = k.dia - 1   -- 183", {'01', '02', '03', '07'}),
    # sin el índice: la ventana de facturas vuelve a recorrer toda la tabla
    'sin_indice': ("create index if not exists pos_ndf_tickets_local_fecha_efectiva_idx\n  on public.pos_ndf_tickets (local, (coalesce(fecha_registra, fecha_cierra)));",
                   "", {'05'}),
}
MUTA_NUCLEO = {'umbral_sin_tolerancia', 'cuenta_por_filas', 'join_sin_dia'}
MUTACIONES_ROLLBACK: dict[str, tuple] = {
    # el rollback deja el índice
    'rollback_deja_indice': ("drop index if exists public.pos_ndf_tickets_local_fecha_efectiva_idx;\n", "", {'07'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar == 'sin_indice':
        # sin índice, la verificación final de la propia 183 abortaría antes de los casos: se apaga solo esa línea
        mig = mig.replace("  if to_regclass('public.pos_ndf_tickets_local_fecha_efectiva_idx') is null then",
                          "  if false then")
    if mutar in MUTACIONES:
        viejo, nuevo, _ = MUTACIONES[mutar]
        if mig.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 183')
        mig = mig.replace(viejo, nuevo)
        if mutar in MUTA_NUCLEO:
            if mig.count(SIN_GUARDA_NUCLEO[0]) != 1:
                sys.exit('la guarda de md5 del núcleo no está en la 183')
            mig = mig.replace(*SIN_GUARDA_NUCLEO)
    return _sacar_beg_com(mig)


def cuerpo_rollback(mutar: str | None) -> str:
    if mutar in MUTA_NUCLEO:
        return '-- (rollback salteado: el núcleo mutado no es el de la 183)'
    rb = ROLLBACK.read_text(encoding='utf-8')
    if mutar in MUTACIONES_ROLLBACK:
        viejo, nuevo, _ = MUTACIONES_ROLLBACK[mutar]
        if rb.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en 183_rollback.sql')
        rb = rb.replace(viejo, nuevo)
    return _sacar_beg_com(rb)


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    for marca, fn in (('@@183@@', cuerpo), ('@@183R@@', cuerpo_rollback)):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'183_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def _caidos_de(txt: str) -> list[dict] | None:
    m = re.search(r'183-FALLAN: ([0-9a-z,]+)', txt)
    return [{'caso': c, 'ok': False, 'detalle': 'ASSERT'} for c in m.group(1).split(',')] if m else None


def correr(sql: str, local: str | None) -> list[dict]:
    if local:
        p = subprocess.run(['psql', local, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
        if p.returncode != 0:
            caidos = _caidos_de(p.stderr)
            if caidos:
                for l in p.stderr.splitlines():
                    if '183 FALLA' in l or '183 RESUMEN' in l:
                        print('   ', l.split('WARNING:  ')[-1].split('NOTICE:  ')[-1][:300])
                return caidos
            sys.exit(f'ERROR: {p.stderr[:600]}')
        for l in p.stderr.splitlines():
            if '183 RESUMEN' in l:
                print('   ', l.split('NOTICE:  ')[-1])
        linea = next((l for l in p.stdout.splitlines() if l.startswith('[{')), None)
        if not linea:
            sys.exit(f'SIN RESULTADO: {p.stdout[:400]}')
        return json.loads(linea)
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': f"Bearer {os.environ.get('SUPABASE_ACCESS_TOKEN', 'x')}",
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        caidos = _caidos_de(txt)
        if caidos:
            return caidos
        sys.exit(f'ERROR: {txt[:400]}')
    casos = res[0].get('json_agg') if isinstance(res, list) and res else None
    if not isinstance(casos, list) or not casos:
        sys.exit(f'SIN RESULTADO: {str(res)[:400]}')
    return casos


def main() -> None:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    local = args[args.index('--local') + 1] if '--local' in args else None
    semilla = '--semilla-local' in args
    todas = {**MUTACIONES, **MUTACIONES_ROLLBACK}
    if mutar and mutar != 'todas' and mutar not in todas:
        sys.exit(f'mutación desconocida: {mutar} (hay: {", ".join(todas)})')
    if '--armar' in args:
        print(armar(None if mutar == 'todas' else mutar, semilla))
        return
    if mutar:
        malas = []
        for nombre in (todas if mutar == 'todas' else [mutar]):
            caen = {c['caso'].split(' ')[0] for c in correr(armar(nombre, semilla), local) if not c['ok']}
            esperadas = todas[nombre][2]
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
