#!/usr/bin/env python3
"""
Arma (y opcionalmente corre) scripts/sql/192_pruebas.sql: llena los marcadores con el cuerpo de la 192 y el de su
rollback, todo dentro de una transacción que termina en ROLLBACK. Sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/192_pruebas.py --armar [--compacto] [--mutar X]  # solo imprime el SQL (no conecta a nada)
  python3 scripts/sql/192_pruebas.py --local "<dsn>" [--mutar X|todas]  # psql contra un Postgres LOCAL (nunca prod), con 192_preludio_local.sql

En staging se corre pegando el SQL armado en una sola consulta (termina en ROLLBACK). Cada mutación rompe el arreglo
a propósito: los casos de su lista TIENEN que caer.
"""
from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sql_compacto import compactar  # noqa: E402  (respeta los cuerpos $$…$$: la huella md5 no cambia)

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/192_propinas_cada_uno_lo_suyo.sql'
ROLLBACK = RAIZ / 'scripts/sql/192_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/192_pruebas.sql'
PRELUDIO_LOCAL = RAIZ / 'scripts/sql/192_preludio_local.sql'  # solo --local: la base local como prod

# nombre → ([(texto de la 192, reemplazo, veces)], prefijos de casos que tienen que caer)
MUTACIONES: dict[str, tuple] = {
    # el personal vuelve a ver todo (la fuga de la 085)
    'personal_todo': ([("  using (employee_id in (select unnest(public.propinas_mis_empleados())));",
                        "  using (public.get_my_role() is not null);", 1)],
                      {'02', '03 embed salonero'}),
    # el contador pierde la lectura
    'contador_afuera': ([("array['owner', 'manager', 'cajero', 'contador']", "array['owner', 'manager', 'cajero']", 1)],
                        {'01 contador'}),
    # (owner/manager/cajero también leen por tip_entries_op_write, FOR ALL: sacarlos de la lista no muerde; el
    #  contador depende SOLO de tip_entries_lee_gestion.)
    # el helper no mira si el rol está activo
    'inactivo_ve': ([("  where e.profile_id = auth.uid()\n    and public.get_my_role() is not null\n",
                      "  where e.profile_id = auth.uid()\n", 1)],
                    {'04 salonero inactivo', '06 helper inactivo'}),
    # solo empleados activos (pierde la fila vieja del mismo perfil)
    'solo_activos': ([("  where e.profile_id = auth.uid()\n", "  where e.profile_id = auth.uid() and e.is_active\n", 1)],
                     {'02 salonero A', '03 embed salonero', '06 helper salonero'}),
    # anon conserva EXECUTE del helper
    'anon_ejecuta': ([("revoke all on function public.propinas_mis_empleados() from anon;\n", "", 1),
                      ("revoke all on function public.propinas_mis_empleados() from public;\n", "", 1)],
                     {'07 helper: anon'}),
    # la guarda no compara (siempre pasa)
    'guarda_floja': ([("       is distinct from r.esperado then\n", "       is distinct from r.esperado and false then\n", 1),
                      ("  if n <> 2 then\n    raise exception '192: tip_entries", "  if false then\n    raise exception '192: tip_entries", 1),
                      ("  if to_regprocedure('public.propinas_mis_empleados()') is not null then\n    raise exception '192: propinas",
                       "  if false then\n    raise exception '192: propinas", 1)],
                     {'08'}),
}


def _sin_beg_com(txt: str) -> str:
    return '\n'.join(l for l in txt.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def armar(mutar: str | None, local: bool = False) -> str:
    mig = MIG.read_text(encoding='utf-8')
    if mutar:
        for viejo, nuevo, veces in MUTACIONES[mutar][0]:
            if mig.count(viejo) != veces:
                sys.exit(f'mutación {mutar}: el ancla aparece {mig.count(viejo)} veces (se esperaban {veces})')
            mig = mig.replace(viejo, nuevo)
    bat = BATERIA.read_text(encoding='utf-8')
    for marca in ('-- @@192@@', '-- @@192R@@', '-- @@192G@@'):
        if bat.count(marca) != 1:
            sys.exit(f'falta el marcador {marca}')
    i = mig.index('do $guarda192$'); j = mig.index('$guarda192$;', i) + len('$guarda192$;')
    guarda = mig[i:j].replace('$guarda192$', '$g$')  # dentro de la función: el bloque do tal cual, con otro dólar
    bat = bat.replace('-- @@192G@@', 'execute ' + "$q$" + guarda.rstrip(';') + "$q$;")
    bat = bat.replace('-- @@192@@', _sin_beg_com(mig))
    bat = bat.replace('-- @@192R@@', _sin_beg_com(ROLLBACK.read_text(encoding='utf-8')))
    if local:
        bat = bat.replace('begin;\n', 'begin;\n' + PRELUDIO_LOCAL.read_text(encoding='utf-8') + '\n', 1)
    return bat


def main() -> int:
    args = sys.argv[1:]
    mutar = args[args.index('--mutar') + 1] if '--mutar' in args else None
    if mutar and mutar not in MUTACIONES and mutar != 'todas':
        sys.exit(f'mutaciones: {", ".join(MUTACIONES)} o todas')
    if '--armar' in args:
        if mutar == 'todas':
            sys.exit('--armar va con una sola mutación')
        sql = armar(mutar)
        if '--compacto' in args:  # sin líneas de comentario ni vacías (para pegarlo en una consulta de staging)
            sql = compactar(sql)
        print(sql)
        return 0
    if '--local' not in args:
        sys.exit(__doc__)
    dsn = args[args.index('--local') + 1]
    # El enum local no trae «proveedor» (en prod/staging se agregó a mano); no se puede usar en la misma transacción.
    subprocess.run(['psql', dsn, '-qc', "alter type public.user_role add value if not exists 'proveedor'"], check=True)
    fallas = 0
    for m in ([None] + list(MUTACIONES)) if mutar == 'todas' else [mutar]:
        out = subprocess.run(['psql', dsn, '-v', 'ON_ERROR_STOP=1', '-tA', '-c', armar(m, local=True)],
                             capture_output=True, text=True)
        filas = [l for l in out.stdout.splitlines() if l.startswith('{"total"')]
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
