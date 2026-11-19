#!/usr/bin/env python3
"""
Corre scripts/sql/188_pruebas.sql (club_socio_edad: rol de socio por función con control de local): llena los marcadores con el
cuerpo de la 188 y el de su rollback, todo dentro de una transacción que termina en ROLLBACK, y sale 1 si algún caso
falla o no hay resultado. Corre ANTES de aplicar (R15): Postgres 16 local armado con local_armar_base.sh (sin la 188).

  python3 scripts/sql/188_pruebas.py --local "host=/tmp port=5499 user=pgv dbname=X" --semilla-local
  python3 scripts/sql/188_pruebas.py ... --mutar todas   # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/188_pruebas.py --armar [--mutar X] # solo imprime el SQL armado (no conecta a nada)

--semilla-local: crea, DENTRO de la transacción descartada, un owner ficticio (la base local no trae usuarios).
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/188_club_socio_edad.sql'
ROLLBACK = RAIZ / 'scripts/sql/188_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/188_pruebas.sql'
SEMILLA = """
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8188-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8188-0000000000aa';
"""

# nombre → ([(texto de la 188, reemplazo, veces)], casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # sin control de local: el manager lee fichas de otro local
    'sin_local': ([("  perform public.club_exigir_local_de((select m.location_id from public.club_miembros m where m.id = p_miembro));\n", "", 1)], {'02'}),
    # cualquier rol con sesión entra
    'sin_rol': ([("  if public.get_my_role() is null or public.get_my_role() not in ('owner','manager','cajero','contador') then\n",
                  "  if public.get_my_role() is null then\n", 1)], {'04'}),
    # devuelve el rol equivocado
    'otro_rol': ([("           where r.miembro_id = p_miembro and r.rol = 'socio');", "           where r.miembro_id = p_miembro and r.rol = 'referente');", 1)],
                 {'01', '05'}),
    # le falta un campo (la casilla dependería de un campo ausente)
    'sin_mayor_edad': ([(",\n                                    'validado_en', r.validado_en, 'mayor_edad_en', r.mayor_edad_en)",
                         ",\n                                    'validado_en', r.validado_en)", 1)], {'01', '02', '03'}),
}


def _sacar_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def cuerpo(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        for viejo, nuevo, veces in MUTACIONES[mutar][0]:
            if mig.count(viejo) != veces:
                sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en la 188')
            mig = mig.replace(viejo, nuevo)
    return _sacar_beg_com(mig)


def cuerpo_rollback(_mutar: str | None) -> str:
    return _sacar_beg_com(ROLLBACK.read_text(encoding='utf-8'))


def armar(mutar: str | None, semilla: bool = False) -> str:
    sql = BATERIA.read_text(encoding='utf-8')
    for marca, fn in (('@@188@@', cuerpo), ('@@188R@@', cuerpo_rollback)):
        sql, n = re.subn(r'(?m)^ *-- ' + re.escape(marca) + r'.*$', lambda _: fn(mutar), sql)
        if n != 1:
            sys.exit(f'188_pruebas.sql: falta el marcador «-- {marca}» (o está repetido)')
    if semilla:
        sql = sql.replace('\nbegin;\n', '\nbegin;\n' + SEMILLA, 1)
    return sql


def correr(sql: str, local: str) -> list[dict]:
    p = subprocess.run(['psql', local, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    for l in p.stderr.splitlines():
        if '188 FALLA' in l or '188 RESUMEN' in l:
            print('   ', l.split('WARNING:  ')[-1].split('NOTICE:  ')[-1][:300])
    if p.returncode != 0:
        m = re.search(r'188-FALLAN: ([0-9a-z,]+)', p.stderr)
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
