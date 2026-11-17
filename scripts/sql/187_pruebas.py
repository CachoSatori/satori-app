#!/usr/bin/env python3
"""
Corre scripts/sql/187_pruebas.sql (retos por local: un reto pertenece a un solo local): llena los marcadores con el
cuerpo de la 187 y el de su rollback, todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso
falla o no hay resultado. Corre ANTES de aplicar (R15): Postgres 16 local armado con local_armar_base.sh (sin la 187).

  python3 scripts/sql/187_pruebas.py --local "host=/tmp port=5499 user=pgv dbname=X" --semilla-local
  python3 scripts/sql/187_pruebas.py ... --mutar todas   # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/187_pruebas.py --armar [--mutar X] # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios).
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/187_club_reto_un_local.sql'
ROLLBACK = RAIZ / 'scripts/sql/187_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/187_pruebas.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8187-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8187-0000000000aa';
"""

GUARDA_FINAL = ("    raise exception '187: el CHECK, el trigger o sus permisos no quedaron como se esperaba';", "    null;")
# nombre → ([(texto de la 187, reemplazo, veces)], casos que tienen que caer). Toda mutación apaga además la guarda final
# de la 187 (si no, la migración mutada aborta entera y no se ve qué caso muerde).
MUTACIONES: dict[str, tuple] = {
    # sin el CHECK: solo queda el trigger
    'sin_check': ([("alter table public.club_retos add constraint club_retos_un_local check (cardinality(locales) = 1);\n", "", 1)], {'03', '06'}),
    # el trigger no frena nada: solo el CHECK (mensaje genérico de club_reto_guardar)
    'sin_trigger': ([("  if cardinality(new.locales) is distinct from 1 then\n", "  if false then\n", 1)], {'01', '02', '03'}),
    # el trigger solo mira los INSERT: editar un borrador a dos locales da el mensaje genérico
    'trigger_solo_insert': ([("before insert or update of locales on public.club_retos", "before insert on public.club_retos", 1)], {'02'}),
    # el pre-chequeo no mira los retos existentes
    'sin_prechequeo': ([("  if exists (select 1 from public.club_retos r where cardinality(r.locales) <> 1) then\n",
                         "  if false then\n", 1)], {'08'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        for viejo, nuevo, veces in MUTACIONES[mutar][0] + [GUARDA_FINAL + (1,)]:
            if mig.count(viejo) != veces:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 187')
            mig = mig.replace(viejo, nuevo)
    return _sacar_beg_com(mig)


def cuerpo_rollback(_mutar: str | None) -> str:
    return _sacar_beg_com(ROLLBACK.read_text(encoding='utf-8'))


def prechequeo(mutar: str | None) -> str:
    m = re.search(r'(?ms)^do \$\$\n.*?^end \$\$;', cuerpo(mutar))
    if not m:
        sys.exit('187: no encontré el primer bloque «do $$ … $$;» (pre-chequeo)')
    return ('create function pg_temp.prechequeo() returns void language plpgsql as $p187$ begin execute $q187$'
            + m.group(0) + '$q187$; end $p187$;')


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    for marca, fn in (('@@187PRE@@', prechequeo), ('@@187@@', cuerpo), ('@@187R@@', cuerpo_rollback)):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'187_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def correr(sql: str, local: str) -> list[dict]:
    p = subprocess.run(['psql', local, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    for l in p.stderr.splitlines():
        if '187 FALLA' in l or '187 RESUMEN' in l:
            print('   ', l.split('WARNING:  ')[-1].split('NOTICE:  ')[-1][:300])
    if p.returncode != 0:
        m = re.search(r'187-FALLAN: ([0-9a-z,]+)', p.stderr)
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
            esperadas = MUTACIONES[nombre][1]
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
