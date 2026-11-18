#!/usr/bin/env python3
"""
Arma (y opcionalmente corre) scripts/sql/191_pruebas.sql: llena los marcadores con el cuerpo de la 191 y el de su
rollback, todo dentro de una transacción que termina en ROLLBACK. Sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/191_pruebas.py --armar [--compacto] [--mutar X]  # solo imprime el SQL (no conecta a nada)
  python3 scripts/sql/191_pruebas.py --local "<dsn>" [--mutar X] # psql contra un Postgres LOCAL (nunca prod)

En staging se corre pegando el SQL armado en una sola consulta (termina en ROLLBACK). Cada mutación rompe el arreglo
a propósito: los casos de su lista TIENEN que caer.
"""
from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/191_pos_ventas_solo_lo_suyo.sql'
ROLLBACK = RAIZ / 'scripts/sql/191_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/191_pruebas.sql'

PROPIO = ("       or (yo.rol in ('salonero', 'barman', 'barback', 'runner', 'cocina')\n"
          "           and btrim(t.salonero_login) = any (yo.logins))\n")

# nombre → ([(texto de la 191, reemplazo, veces)], prefijos de casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # el personal vuelve a ver todo (la fuga de la 067)
    'personal_todo': ([(PROPIO, "       or (yo.rol in ('salonero', 'barman', 'barback', 'runner', 'cocina'))\n", 2)],
                      {'04', '06 salonero'}),
    # el manager sin control de local
    'manager_sin_local': ([("       or (yo.rol = 'manager' and t.local = any (yo.locs))\n",
                            "       or (yo.rol = 'manager')\n", 2)], {'03 manager NO', '06 manager'}),
    # nombres para cualquier rol
    'nombres_todos': ([("  where public.get_my_role() in ('owner', 'manager', 'contador')\n    and nullif(btrim(e.pos_login)",
                        "  where public.get_my_role() is not null\n    and nullif(btrim(e.pos_login)", 1)],
                      {'08 salonero'}),
    # sin recortar el login (los espacios del PoS dejan afuera facturas propias)
    'sin_trim': ([("and btrim(t.salonero_login) = any (yo.logins)", "and t.salonero_login = any (yo.logins)", 2)],
                 {'04 salonero ve solo lo suyo A', '06 salonero'}),
}


def _sin_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(mutar: str | None) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        for viejo, nuevo, veces in MUTACIONES[mutar][0]:
            if mig.count(viejo) != veces:
                sys.exit(f'mutación {mutar}: el ancla aparece {mig.count(viejo)} veces (se esperaban {veces})')
            mig = mig.replace(viejo, nuevo)
    bat = BATERIA.read_text(encoding='utf-8')
    for marca in ('-- @@191@@', '-- @@191R@@'):
        if bat.count(marca) != 1:
            sys.exit(f'falta el marcador {marca}')
    bat = bat.replace('-- @@191@@', _sin_beg_com(mig))
    return bat.replace('-- @@191R@@', _sin_beg_com(ROLLBACK.read_text(encoding='utf-8')))


def main() -> int:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    if mutar and mutar not in MUTACIONES and mutar != 'todas':
        sys.exit(f'mutaciones: {", ".join(MUTACIONES)} o todas')
    if '--armar' in args:
        sql = armar(mutar)
        if '--compacto' in args:  # sin líneas de comentario ni vacías (para pegarlo en una consulta de staging)
            sql = '\n'.join(l for l in sql.splitlines() if l.strip() and not l.lstrip().startswith('--'))
        print(sql)
        return 0
    if '--local' not in args:
        sys.exit(__doc__)
    dsn = args[args.index('--local') + 1]
    fallas = 0
    for m in ([None] + list(MUTACIONES)) if mutar == 'todas' else [mutar]:
        out = subprocess.run(['psql', dsn, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', armar(m)],
                             capture_output=True, text=True)
        filas = [l for l in out.stdout.splitlines() if l.startswith('{')]
        if not filas:
            print(m or 'sin mutar', 'SIN RESULTADO', out.stderr[-400:]); fallas += 1; continue
        r = json.loads(filas[-1])
        caidos = {f['caso'] for f in r['fallan']}
        if m is None:
            print('sin mutar:', r['ok'], '/', r['total']); fallas += r['ok'] != r['total']
        else:
            esperan = MUTACIONES[m][1]
            ok = all(any(c.startswith(p) for c in caidos) for p in esperan)
            print(f'mutación {m}: caen {len(caidos)} → {"OK" if ok else "NO MUERDE"}'); fallas += not ok
    return 1 if fallas else 0


if __name__ == '__main__':
    sys.exit(main())
