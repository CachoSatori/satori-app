#!/usr/bin/env python3
"""
Batería de la 176 (origen club 122: el manager ve en las LISTAS del Club solo las fichas de sus locales): arma
scripts/sql/176_pruebas.sql con el cuerpo de la 176 y el de su rollback, todo en UNA transacción que termina en
ROLLBACK, y sale 1 si algún caso falla o no hay resultado.

  python3 scripts/sql/176_pruebas.py --local [--db m176]           # Postgres 16 local (PGHOST/PGPORT/PGUSER del entorno)
  python3 scripts/sql/176_pruebas.py --local --mutar todas          # cada mutación tiene que hacer caer sus casos
  python3 scripts/sql/176_pruebas.py --armar [--mutar X]            # solo imprime el SQL (para staging, con el OK del dueño)

La base local tiene que tener las migraciones hasta la 172 (y la 173–175 si ya están) SIN la 176:
scripts/sql/local_armar_base.sh aplica todo el árbol, así que para probar se arma la base sin la 176 (o se corre su
rollback antes). En staging el SQL de --armar se corre igual (ref hwiatgic…, nunca prod) con la 170 y la 172 aplicadas:
crea sus propios locales, usuarios y datos dentro de la transacción y no deja nada.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
MIG = RAIZ / 'supabase/migrations/176_club_local_manager_listas.sql'
ROLLBACK = RAIZ / 'scripts/sql/176_rollback.sql'
BATERIA = RAIZ / 'scripts/sql/176_pruebas.sql'

# nombre → (texto de la 176, reemplazo, casos que tienen que caer)
MUTACIONES: dict[str, tuple[str, str, set[str]]] = {
    # (el filtro del ENVOLTORIO de club_buscar quedó redundante desde que el núcleo filtra antes del límite: sacarlo
    #  no cambia nada y por eso no tiene mutación propia; la del núcleo es buscar_filtro_despues_del_limite)
    # el filtro se aplica a todos los roles (cajero y owner pierden lo de otros locales)
    'filtro_todos_los_roles': ("  select public.get_my_role() is distinct from 'manager'::public.user_role\n      or public.club_puede_ver_local(p_location)",
                               "  select public.club_puede_ver_local(p_location)", {'1b'}),
    # club_buscar con el filtro solo en el envoltorio (el límite de 20 corta antes de filtrar)
    'buscar_filtro_despues_del_limite': ("       and public.club_ve_ficha(m.location_id)   -- 176: el manager, solo sus locales (ANTES del limit y de la auditoría)\n",
                                         "", {'0a', '1k'}),
    # retos: el reto de los dos locales sigue con la cortesía del otro local
    'retos_con_cortesia_ajena': ("'where public.club_ve_ficha(k.key)), ''{}''::jsonb))", "'), ''{}''::jsonb))", {'1e'}),
    # resolver sin cortar el cupón de otro local
    'resolver_sin_cupon': ("'elsif v->>''tipo'' = ''cupon'' then '", "'elsif false then '", {'1h'}),
    # resolver corta también el QR del socio (rompe el Club compartido)
    'resolver_corta_socio': ("'if v->>''tipo'' in (''referente'', ''canje'') then '",
                             "'if v->>''tipo'' in (''referente'', ''canje'', ''socio'') then '", {'1i'}),
    # RLS de miembros sin el local
    'rls_miembros_sin_local': ("alter policy club_staff_select on public.club_miembros using (\n  get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador')\n  and ((select public.get_my_role()) is distinct from 'manager'::public.user_role\n       or location_id = any ((select public.mis_locales())::text[])));",
                               "", {'2b', '2c'}),
    # RLS de movimientos solo por el local del movimiento: el saldo del anfitrión de B queda incompleto para su manager
    'movimientos_sin_miembro': ("       or exists (select 1 from public.club_miembros m\n                   where m.id = club_movimientos.miembro_id",
                                "       or false and exists (select 1 from public.club_miembros m\n                   where m.id = club_movimientos.miembro_id", {'2e'}),
    # primeros 90 sin el local del miembro cuando el local es nulo
    'primeros90_sin_miembro': ("       or (location_id is null and exists (select 1 from public.club_miembros m\n                   where m.id = club_primeros90.miembro_id",
                               "       or (false and exists (select 1 from public.club_miembros m\n                   where m.id = club_primeros90.miembro_id", {'2b', '2c'}),
    # contacto sin WITH CHECK por local
    'contacto_sin_check': ("  with check (\n    get_my_role() is not null and get_my_role() in ('owner','manager')\n    and ((select public.get_my_role()) is distinct from 'manager'::public.user_role\n         or location_id = any ((select public.mis_locales())::text[])));",
                           "  with check (get_my_role() is not null and get_my_role() in ('owner','manager'));", {'2f'}),
    # el mensaje de siempre
    'mensaje_viejo': ("    raise exception 'Ficha de otro local' using errcode = '42501';", "    raise exception 'Sin permiso en ese local' using errcode = '42501';", {'1h', '3a'}),
    # el núcleo queda llamable por la API
    'nucleo_abierto': ("    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_nom || '__nucleo', v_ident);\n",
                       "", {'0c'}),
}
MUTACIONES_ROLLBACK: dict[str, tuple[str, str, set[str]]] = {
    # el rollback no devuelve las políticas
    'rollback_sin_politicas': ("alter policy club_staff_select on public.club_miembros\n  using (get_my_role() is not null and get_my_role() in ('owner','manager','cajero','contador'));",
                               "", {'4a', '4b'}),
    # el rollback no devuelve el mensaje de la 172
    'rollback_sin_mensaje': ("    raise exception 'Sin permiso en ese local' using errcode = '42501';", "    raise exception 'Ficha de otro local' using errcode = '42501';", {'4a'}),
    # el rollback deja el núcleo de club_buscar con el filtro (no vuelve al cuerpo de la 150)
    'rollback_buscar_con_filtro': ("     where m.tipo in ('referente','concierge_pm','equipo')\n       and case when v_dig then",
                                   "     where m.tipo in ('referente','concierge_pm','equipo')\n       and public.club_ve_ficha(m.location_id)\n       and case when v_dig then", {'4a'}),
    # el rollback no devuelve el EXECUTE de authenticated
    'rollback_sin_grant': ("    execute format('grant execute on function public.%I(%s) to authenticated', r.nom, v_ident);", "    null;", {'4a'}),
}


def sin_tx(sql: str) -> str:
    return '\n'.join(l for l in sql.splitlines() if l.strip().lower() not in ('begin;', 'commit;'))


def reemplazar(texto: str, mutar: str | None, tabla: dict, donde: str) -> str:
    if mutar in tabla:
        viejo, nuevo, _ = tabla[mutar]
        if texto.count(viejo) != 1:
            sys.exit(f'mutación {mutar}: el ancla no está (o está repetida) en {donde}')
        texto = texto.replace(viejo, nuevo)
    return texto


def armar(mutar: str | None) -> str:
    mig = sin_tx(reemplazar(MIG.read_text(encoding='utf-8'), mutar, MUTACIONES, 'la 176'))
    rb = reemplazar(ROLLBACK.read_text(encoding='utf-8'), mutar, MUTACIONES_ROLLBACK, '176_rollback.sql')
    rb = sin_tx(re.sub(r"(?m)^delete from supabase_migrations\.schema_migrations.*$", '', rb))
    sql = BATERIA.read_text(encoding='utf-8')
    sql, n = re.subn(r'(?m)^-- @@176@@.*$', lambda _: mig, sql)
    if n != 1:
        sys.exit('176_pruebas.sql: falta el marcador «-- @@176@@»')
    sql, n = re.subn(r'(?m)^-- @@176R@@.*$', lambda _: rb, sql)
    if n != 1:
        sys.exit('176_pruebas.sql: falta el marcador «-- @@176R@@»')
    return sql


def correr_local(sql: str, db: str) -> list[dict]:
    p = subprocess.run(['psql', '-X', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    m = re.search(r'176-FALLAN: ([0-9a-z,()]+)', p.stderr)
    if m:
        filas = [l for l in p.stdout.splitlines() if l.startswith('[{')]
        if filas:
            return json.loads(filas[-1])
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
    db = args[args.index('--db') + 1] if '--db' in args else 'm176'
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
