#!/usr/bin/env bash
# Pruebas de la 093 (Grok 126) — SOLO STAGING. Cada caso corre en una transacción que termina en ROLLBACK: la 093,
# las filas de prueba y los cambios de rol simulados se descartan. No deja nada.
# Sin falsos verdes:
#   · cada tabla recibe una fila sintética dentro de la transacción, así nunca se compara «0 = 0» por tabla vacía;
#   · cada caso tiene su esperado; «antes» se mide SIN la 093 y tiene que mostrar el hueco (la cuenta inactiva lee);
#   · los errores se clasifican por SQLSTATE y NUNCA se imprime el detalle de un error (puede traer datos de perfiles).
# No lleva el ref de prod: solo acepta el de staging.
# Uso: SUPABASE_ACCESS_TOKEN=… scripts/sql/093_pruebas.sh hwiatgicyyqyezqwldia
# Salida: 0 = verde · 1 = falla o no probado · 2 = uso.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN}"
REF=${1:?Uso: $0 <REF de staging>}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging. Nada en prod." >&2; exit 2; }
RAIZ=$(git rev-parse --show-toplevel)
MIG=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/supabase/migrations/093_ventas_lectura_rol_activo.sql")
RB=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/scripts/sql/093_rollback.sql")
API="https://api.supabase.com/v1/projects/$REF/database/query"
q() {
  local body
  body=$(jq -n --arg q "$1" '{query:$q}' | curl -sS --fail-with-body -X POST "$API" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-) || {
    echo "ERROR de la API: $(jq -r '.message? // .' <<<"$body" 2>/dev/null | head -1 | sed -E 's/DETAIL:.*//' | head -c 160)" >&2; return 1; }
  jq -e 'type == "array"' >/dev/null <<<"$body" || { echo "ERROR: no es un arreglo" >&2; return 1; }
  echo "$body"
}
echo "093_pruebas · $(TZ=America/Costa_Rica date '+%Y-%m-%d %H:%M CR') · REF=$REF · script @ $(git -C "$RAIZ" rev-parse --short HEAD)"

TABLAS="'ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map'"
SEMILLA="insert into public.product_map (nombre) values ('PRUEBA 093') on conflict do nothing;
  insert into public.ventas_dias (session_date, file_name) values ('1900-01-01', 'prueba-093');
  insert into public.ventas_hist (session_date, source) values ('1900-01-01', 'prueba-093') on conflict do nothing;
  insert into public.ventas_metas (key) values ('prueba-093') on conflict do nothing;
  insert into public.ventas_comps (data) values ('{}'::jsonb);"
CONT="json_build_object('ventas_dias', (select count(*) from public.ventas_dias), 'ventas_hist', (select count(*) from public.ventas_hist),
  'ventas_metas', (select count(*) from public.ventas_metas), 'ventas_comps', (select count(*) from public.ventas_comps),
  'product_map', (select count(*) from public.product_map))"
CEROS='{"product_map":0,"ventas_comps":0,"ventas_dias":0,"ventas_hist":0,"ventas_metas":0}'

PID=$(q "select id from public.profiles where role <> 'owner' order by created_at limit 1" | jq -r '.[0].id // empty')
[ -n "$PID" ] || { echo "NO PROBADO: no hay perfil para simular"; echo "NO VERDE"; exit 1; }
sim() { # $1 rol · $2 activo → la sesión de ese perfil con ese rol (cambio descartado con la transacción)
  echo "set local session_replication_role = replica; update public.profiles set role = '$1', is_active = $2 where id = '$PID';
        set local session_replication_role = origin; set local role authenticated;
        select set_config('request.jwt.claims', '{\"sub\":\"$PID\",\"role\":\"authenticated\"}', true);"
}
ok=0; fallas=0
compara() { if [ -n "$3" ] && [ "$(jq -cS . <<<"$2" 2>/dev/null)" = "$(jq -cS . <<<"$3" 2>/dev/null)" ]; then echo "OK    $1"; ok=$((ok+1));
            else echo "FALLA $1"; echo "      esperado: $2"; echo "      obtenido: ${3:-(sin respuesta)}"; fallas=$((fallas+1)); fi; }
mide() { q "begin; $SEMILLA $1 select $CONT as x; rollback;" | jq -c '.[-1].x' || true; }

echo "== Base (postgres, con una fila sintética por tabla) =="
BASE=$(mide "")
if [ -z "$BASE" ] || jq -e 'to_entries | any(.value < 1)' >/dev/null <<<"$BASE"; then
  echo "NO PROBADO: la base no tiene filas en las 5 tablas (la semilla falló)"; echo "NO VERDE"; exit 1
fi
echo "      base: $BASE"

echo "== Catálogo =="
r=$(q "select count(*) filter (where qual = 'true') as abiertas from pg_policies where schemaname = 'public'
       and tablename in ($TABLAS) and policyname = tablename || '_read'" | jq -c '.[-1].abiertas // empty') || r=""
compara "staging hoy (sin la 093): las 5 lecturas abiertas (using true)" '5' "$r"
r=$(q "begin; create temp table w on commit drop as select tablename, qual, with_check from pg_policies where schemaname = 'public'
       and tablename in ($TABLAS) and policyname = tablename || '_write'; $MIG
       select json_build_object('lecturas_con_rol', (select count(*) from pg_policies where schemaname = 'public' and tablename in ($TABLAS)
           and policyname = tablename || '_read' and cmd = 'SELECT' and qual ~ 'get_my_role\(\)' and qual ~ 'IS NOT NULL'),
         'escrituras_iguales', (select count(*) from pg_policies p join w using (tablename) where p.schemaname = 'public'
           and p.policyname = p.tablename || '_write' and p.qual is not distinct from w.qual and p.with_check is not distinct from w.with_check)) as x;
       rollback;" | jq -c '.[-1].x') || r=""
compara "con la 093: 5 lecturas exigen rol; las 5 escrituras sin cambios" '{"lecturas_con_rol":5,"escrituras_iguales":5}' "$r"

echo "== Cuentas activas: ven lo mismo que la base, sin y con la 093 =="
for rol in owner manager contador cajero salonero; do
  compara "$rol activo, sin la 093" "$BASE" "$(mide "$(sim $rol true)")"
  compara "$rol activo, con la 093" "$BASE" "$(mide "$MIG $(sim $rol true)")"
done

echo "== Cuentas inactivas: sin la 093 leen (el hueco); con la 093, 0 =="
for rol in cajero owner; do
  compara "$rol INACTIVO, sin la 093 (hueco de Grok 126)" "$BASE" "$(mide "$(sim $rol false)")"
  compara "$rol INACTIVO, con la 093" "$CEROS" "$(mide "$MIG $(sim $rol false)")"
done

echo "== anon: no lee (sin permiso o 0 filas), sin y con la 093 =="
ANON="set local role anon; do \$\$ declare t text; n bigint; ok boolean := true; begin
        foreach t in array array[$TABLAS] loop
          begin execute format('select count(*) from public.%I', t) into n; if n > 0 then ok := false; end if;
          exception when insufficient_privilege then null; end;
        end loop; perform set_config('t093.anon', ok::text, true); end \$\$; reset role;"
for con in "" "$MIG"; do
  et=$([ -z "$con" ] && echo "sin" || echo "con")
  r=$(q "begin; $SEMILLA $con $ANON select current_setting('t093.anon') as x; rollback;" | jq -r '.[-1].x // empty') || r=""
  compara "anon no lee ninguna de las 5, $et la 093" '"true"' "\"$r\""
done

echo "== Vuelta atrás (descartada) =="
compara "093 + rollback: la cuenta inactiva vuelve a leer como antes" "$BASE" "$(mide "$MIG $RB $(sim cajero false)")"
r=$(q "begin; $MIG $RB select count(*) filter (where qual = 'true') as x from pg_policies where schemaname = 'public'
       and tablename in ($TABLAS) and policyname = tablename || '_read'; rollback;" | jq -c '.[-1].x // empty') || r=""
compara "093 + rollback: las 5 lecturas otra vez en using (true)" '5' "$r"

echo "== Estado final de staging (nada quedó) =="
r=$(q "select json_build_object('abiertas', (select count(*) from pg_policies where schemaname = 'public' and tablename in ($TABLAS)
         and policyname = tablename || '_read' and qual = 'true'),
       'filas_prueba', (select count(*) from public.product_map where nombre = 'PRUEBA 093') + (select count(*) from public.ventas_metas where key = 'prueba-093')
         + (select count(*) from public.ventas_dias where file_name = 'prueba-093') + (select count(*) from public.ventas_hist where source = 'prueba-093'),
       'ledger_093', (select count(*) from supabase_migrations.schema_migrations where version = '093')) as x" | jq -c '.[-1].x') || r=""
compara "staging sigue sin la 093 y sin filas de prueba" '{"abiertas":5,"filas_prueba":0,"ledger_093":0}' "$r"

echo "── Resultado: $ok OK · $fallas FALLA ──"
[ "$fallas" -eq 0 ] && echo VERDE || { echo "NO VERDE"; exit 1; }
