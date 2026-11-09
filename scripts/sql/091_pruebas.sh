#!/usr/bin/env bash
# Pruebas de la 091 (multilocal fase 0) — SOLO STAGING. Cada caso corre en su propia transacción que termina en
# ROLLBACK: la 091 se aplica adentro y se descarta. No deja nada.
#
# Demuestra que Santa Teresa queda IDÉNTICA:
#   · como postgres: mismas filas (md5 de cada fila sin location_id), mismos totales, mismo saldo de Caja Fuerte
#     (misma regla que saldoCajaFuerte) y mismos cierres, antes y después;
#   · como owner, manager, contador, cajero y salonero (sesión simulada): ven exactamente lo mismo antes y después;
#   · aislamiento: con un segundo local y un movimiento suyo, manager y cajero sin asignación NO lo ven; owner y
#     contador sí; un manager asignado a ese local lo ve.
# Uso: SUPABASE_ACCESS_TOKEN=… scripts/sql/091_pruebas.sh hwiatgicyyqyezqwldia
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN}"
REF=${1:?Uso: $0 <REF de staging>}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging (hwiatgicyyqyezqwldia). Nada en prod." >&2; exit 1; }
RAIZ=$(git rev-parse --show-toplevel)
MIG=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/supabase/migrations/091_multilocal_fase0.sql")

q() {
  jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-
}
uno() { jq -c 'if type=="array" then .[-1] else . end'; }
uid() { q "select id from public.profiles where role = '$1' and is_active order by created_at limit 1" | jq -r '.[0].id // empty'; }

FOTO="select json_build_object(
  'cash_movements', (select json_build_object('n', count(*), 'crc', sum(amount_crc), 'usd', sum(amount_usd),
       'h', md5(coalesce(string_agg((to_jsonb(x) - 'location_id')::text, '|' order by x.id), ''))) from public.cash_movements x),
  'cash_sessions', (select json_build_object('n', count(*),
       'h', md5(coalesce(string_agg((to_jsonb(x) - 'location_id')::text, '|' order by x.id), ''))) from public.cash_sessions x),
  'cash_cierres_dia', (select json_build_object('n', count(*), 'dif', sum(diferencia_crc), 'rem', sum(remanente_crc),
       'h', md5(coalesce(string_agg((to_jsonb(x) - 'location_id')::text, '|' order by x.id), ''))) from public.cash_cierres_dia x),
  'tip_sessions', (select json_build_object('n', count(*), 'pozo', sum(pool_total_crc),
       'h', md5(coalesce(string_agg((to_jsonb(x) - 'location_id')::text, '|' order by x.id), ''))) from public.tip_sessions x),
  'tip_entries', (select json_build_object('n', count(*), 'pagado', sum(payout_crc),
       'h', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), ''))) from public.tip_entries x),
  'saldo_caja_fuerte', (select json_build_object(
       'crc', sum(case when movement_type = 'ingreso' then amount_crc when movement_type like 'egreso%' then -amount_crc
                        when movement_type = 'traspaso' then case when subcategory ~* '→\s*caja fuerte' then amount_crc else -amount_crc end else 0 end),
       'usd', sum(case when movement_type = 'ingreso' then amount_usd when movement_type like 'egreso%' then -amount_usd
                        when movement_type = 'traspaso' then case when subcategory ~* '→\s*caja fuerte' then amount_usd else -amount_usd end else 0 end))
       from public.cash_movements where caja_origen = 'Caja Fuerte' and coalesce(status, '') <> 'pendiente')
) as foto"

como() { # $1 = uid → SQL para simular su sesión
  echo "set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', true);"
}

fallas=0
compara() { # $1 etiqueta, $2 antes, $3 después
  if [ "$2" = "$3" ] && [ -n "$2" ] && [ "$2" != "null" ]; then echo "OK    $1"; else echo "FALLA $1"; echo "  antes:   $2"; echo "  después: $3"; fallas=$((fallas+1)); fi
}

echo "== Santa Teresa idéntica (postgres) =="
A=$(q "begin; $FOTO; rollback;" | uno)
D=$(q "begin; $MIG; $FOTO; rollback;" | uno)
compara "postgres: filas, totales, saldo CF y cierres" "$A" "$D"

echo "== Lo que ve cada rol, antes y después =="
for rol in owner manager contador cajero salonero; do
  id=$(uid $rol)
  if [ -z "$id" ]; then echo "--    $rol: sin cuenta activa en staging"; continue; fi
  A=$(q "begin; $(como "$id") $FOTO; rollback;" | uno)
  D=$(q "begin; $MIG; $(como "$id") $FOTO; rollback;" | uno)
  compara "$rol ve lo mismo" "$A" "$D"
done

echo "== Aislamiento con un segundo local (todo descartado) =="
OTRO="insert into public.locations (id, name) values ('local-prueba-091', 'Local de prueba') on conflict (id) do nothing;
      insert into public.cash_movements (created_by, movement_type, amount_crc, amount_usd, currency, description, caja_origen, method, status, location_id)
      values ((select id from public.profiles where role = 'owner' order by created_at limit 1), 'ingreso', 1, 0, 'CRC', 'prueba 091', 'Caja Fuerte', 'Efectivo', 'aprobado', 'local-prueba-091');"
CUENTA="select count(*) as n from public.cash_movements where location_id = 'local-prueba-091'"
for caso in "owner:1" "contador:1" "manager:0" "cajero:0"; do
  rol=${caso%%:*}; esperado=${caso##*:}; id=$(uid $rol)
  [ -z "$id" ] && { echo "--    $rol: sin cuenta"; continue; }
  n=$(q "begin; $MIG; $OTRO; $(como "$id") $CUENTA; rollback;" | jq -r 'if type=="array" then .[-1].n else "error: \(.)" end')
  compara "$rol ve $esperado fila(s) del otro local" "$esperado" "$n"
done
id=$(uid manager)
if [ -n "$id" ]; then
  n=$(q "begin; $MIG; $OTRO; insert into public.profile_locations (profile_id, location_id) values ('$id', 'local-prueba-091'); $(como "$id") $CUENTA; rollback;" | jq -r 'if type=="array" then .[-1].n else "error: \(.)" end')
  compara "manager asignado al otro local lo ve" "1" "$n"
  n=$(q "begin; $MIG; $OTRO; insert into public.profile_locations (profile_id, location_id) values ('$id', 'local-prueba-091'); $(como "$id") select count(*) as n from public.cash_movements where location_id = 'santa-teresa'; rollback;" | jq -r 'if type=="array" then .[-1].n else "error" end')
  compara "manager asignado SOLO al otro local deja de ver santa-teresa" "0" "$n"
fi

echo "== Una escritura de un manager sin asignación a otro local se rechaza =="
id=$(uid manager)
if [ -n "$id" ]; then
  r=$(q "begin; $MIG; $OTRO; $(como "$id")
         insert into public.cash_movements (created_by, movement_type, amount_crc, amount_usd, currency, description, caja_origen, method, status, location_id)
         values ('$id', 'ingreso', 1, 0, 'CRC', 'prueba 091 b', 'Caja Fuerte', 'Efectivo', 'aprobado', 'local-prueba-091'); rollback;")
  if echo "$r" | grep -qi "row-level security"; then echo "OK    insert en otro local rechazado por RLS"; else echo "FALLA insert en otro local: $r"; fallas=$((fallas+1)); fi
fi

echo "== Las políticas se crean con la forma correcta y el rollback deja todo como antes (descartado) =="
POLS="select count(*) as n from pg_policies where schemaname = 'public' and policyname like '%_por_local'
        and permissive = 'RESTRICTIVE' and qual ~ 'mis_locales' and with_check ~ 'mis_locales'"
n=$(q "begin; $MIG; $POLS; rollback;" | jq -r 'if type=="array" then .[-1].n else "error: \(.)" end')
compara "las 4 políticas por local existen, restrictivas, con using y with check" "4" "$n"
ROLLBACK=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/scripts/sql/091_rollback.sql")
A=$(q "begin; $FOTO; rollback;" | uno)
D=$(q "begin; $MIG; $ROLLBACK; $FOTO; rollback;" | uno)
compara "rollback: filas, totales, saldo y cierres iguales a antes" "$A" "$D"
r=$(q "begin; $MIG; $ROLLBACK; select (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'location_id'
        and table_name in ('cash_sessions','cash_movements','cash_cierres_dia','tip_sessions')) as cols,
        (select count(*) from pg_policies where policyname like '%_por_local') as pols,
        to_regprocedure('public.mis_locales()') is null as sin_fn; rollback;" | jq -c 'if type=="array" then .[-1] else . end')
compara "rollback: sin columnas, sin políticas y sin función" '{"cols":0,"pols":0,"sin_fn":true}' "$r"

echo "== Resultado: $fallas falla(s) =="
[ "$fallas" -eq 0 ]
