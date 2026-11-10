#!/usr/bin/env bash
# Pruebas de la 095 (el contador lee caja) — SOLO STAGING. Cada caso en una transacción que termina en ROLLBACK: la 095
# (y la 091 donde se prueba la convivencia), los roles simulados y las filas de prueba se descartan. No deja nada.
# Sin falsos verdes: esperado por caso; «sin la 095» muestra el hueco (el contador ve 0); las escrituras se miden por
# filas afectadas (GET DIAGNOSTICS) o por SQLSTATE; nunca se imprime el detalle de un error. Sin el ref de prod.
# Uso: SUPABASE_ACCESS_TOKEN=… scripts/sql/095_pruebas.sh hwiatgicyyqyezqwldia
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN}"
REF=${1:?Uso: $0 <REF de staging>}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging. Nada en prod." >&2; exit 2; }
RAIZ=$(git rev-parse --show-toplevel)
sinbc() { grep -viE '^\s*(begin|commit)\s*;\s*$' "$1"; }
MIG=$(sinbc "$RAIZ/supabase/migrations/095_contador_lee_caja.sql")
RB=$(sinbc "$RAIZ/scripts/sql/095_rollback.sql")
M091=$(sinbc "$RAIZ/supabase/migrations/091_multilocal_fase0.sql")
API="https://api.supabase.com/v1/projects/$REF/database/query"
q() { jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "$API" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-; }
x() { q "$1" | jq -c 'if type=="array" then .[-1].x else empty end' 2>/dev/null || true; }
echo "095_pruebas · $(TZ=America/Costa_Rica date '+%Y-%m-%d %H:%M CR') · REF=$REF · script @ $(git -C "$RAIZ" rev-parse --short HEAD)"
ok=0; fallas=0
compara() { if [ -n "$3" ] && [ "$3" != '""' ] && [ "$3" != "null" ] && [ "$(jq -cS . <<<"$2" 2>/dev/null)" = "$(jq -cS . <<<"$3" 2>/dev/null)" ]; then echo "OK    $1"; ok=$((ok+1));
            else echo "FALLA $1"; echo "      esperado: $2"; echo "      obtenido: ${3:-(sin respuesta)}"; fallas=$((fallas+1)); fi; }
PID=$(q "select id from public.profiles where role <> 'owner' order by created_at limit 1" | jq -r '.[0].id // empty')
[ -n "$PID" ] || { echo "NO PROBADO: no hay perfil para simular"; echo "NO VERDE"; exit 1; }
sim() { echo "set local session_replication_role = replica; update public.profiles set role = '$1', is_active = $2 where id = '$PID';
  set local session_replication_role = origin; set local role authenticated;
  select set_config('request.jwt.claims', '{\"sub\":\"$PID\",\"role\":\"authenticated\"}', true);"; }
TRES="'cash_movements', (select count(*) from public.cash_movements), 'cash_sessions', (select count(*) from public.cash_sessions), 'suppliers', (select count(*) from public.suppliers)"
YA="'cash_cierres_dia', (select count(*) from public.cash_cierres_dia), 'movement_edits', (select count(*) from public.movement_edits), 'movement_deletions', (select count(*) from public.movement_deletions), 'supplier_credits', (select count(*) from public.supplier_credits), 'credit_applications', (select count(*) from public.credit_applications), 'documents', (select count(*) from public.documents), 'exchange_rates', (select count(*) from public.exchange_rates), 'tip_sessions', (select count(*) from public.tip_sessions), 'tip_entries', (select count(*) from public.tip_entries)"
ve() { x "begin; $1 select json_build_object($TRES) as x; rollback;"; }
BASE=$(x "select json_build_object($TRES) as x")
if [ -z "$BASE" ] || jq -e 'to_entries | any(.value < 1)' >/dev/null <<<"$BASE"; then echo "NO PROBADO: alguna de las 3 tablas está vacía en staging ($BASE)"; echo "NO VERDE"; exit 1; fi
CEROS='{"cash_movements":0,"cash_sessions":0,"suppliers":0}'
echo "      base (postgres): $BASE"

echo "== Lectura =="
compara "sin la 095, el contador ve 0 en las 3 (el hueco)" "$CEROS" "$(ve "$(sim contador true)")"
compara "con la 095, el contador ve lo mismo que la base en las 3" "$BASE" "$(ve "$MIG $(sim contador true)")"
OWN=$(x "begin; $MIG $(sim owner true) select json_build_object($TRES, $YA) as x; rollback;")
CON=$(x "begin; $MIG $(sim contador true) select json_build_object($TRES, $YA) as x; rollback;")
compara "con la 095, el contador ve lo mismo que el owner en las 12 tablas de la pantalla de Caja" "$OWN" "$CON"
compara "con la 095, el contador INACTIVO ve 0 en las 3" "$CEROS" "$(ve "$MIG $(sim contador false)")"
for rol in owner manager cajero salonero proveedor; do
  compara "$rol no cambia (sin y con la 095)" "$(ve "$(sim $rol true)")" "$(ve "$MIG $(sim $rol true)")"
done

echo "== Escritura del contador con la 095: ninguna pasa =="
w() { # $1 etiqueta · $2 sentencia → OK si 0 filas o 42501
  local r; r=$(x "begin; $MIG create temp table r (v text) on commit drop; grant all on r to authenticated; $(sim contador true)
     do \$\$ declare n int; begin $2; get diagnostics n = row_count; insert into r values (n::text);
     exception when others then insert into r values (sqlstate); end \$\$;
     reset role; select (select v from r) as x; rollback;")
  if [ "$r" = '"0"' ] || [ "$r" = '"42501"' ]; then echo "OK    $1 → ${r//\"/}"; ok=$((ok+1)); else echo "FALLA $1 → ${r:-(sin respuesta)}"; fallas=$((fallas+1)); fi
}
w "editar movimientos" "update public.cash_movements set description = description"
w "borrar movimientos" "delete from public.cash_movements"
w "crear un movimiento en efectivo, aprobado" "insert into public.cash_movements (created_by, movement_type, amount_crc, amount_usd, currency, description, caja_origen, method, status) values ('$PID', 'ingreso', 1, 0, 'CRC', 'prueba 095', 'Caja Fuerte', 'Efectivo', 'aprobado')"
w "abrir un turno (cash_sessions)" "insert into public.cash_sessions (opened_by, session_date) values ('$PID', '1900-01-01')"
w "editar turnos" "update public.cash_sessions set notes = notes"
w "borrar turnos" "delete from public.cash_sessions"
w "crear un proveedor" "insert into public.suppliers (name) values ('PROVEEDOR PRUEBA 095')"
w "editar proveedores" "update public.suppliers set name = name"
w "borrar proveedores" "delete from public.suppliers"

echo "== Lo de antes (mig 038), igual con y sin la 095 =="
P038="insert into public.cash_movements (created_by, movement_type, amount_crc, amount_usd, currency, description, caja_origen, method, status) values ('$PID', 'egreso_operativo', 1, 0, 'CRC', 'prueba 095 bandeja', 'Caja Fuerte', 'Transferencia', 'pendiente')"
i038() { x "begin; $1 create temp table r (v text) on commit drop; grant all on r to authenticated; $(sim contador true)
  do \$\$ begin $P038; insert into r values ('ok'); exception when others then insert into r values (sqlstate); end \$\$;
  reset role; select (select v from r) as x; rollback;"; }
compara "el contador crea un movimiento pendiente que no es efectivo (038): mismo resultado sin y con la 095" "$(i038 "")" "$(i038 "$MIG")"

echo "== Convive con la 091 (RLS por local), todo descartado =="
OTRO="insert into public.locations (id, name) values ('local-prueba-095', 'Local de prueba') on conflict (id) do nothing;
  insert into public.cash_movements (created_by, movement_type, amount_crc, amount_usd, currency, description, caja_origen, method, status, location_id)
  values ((select id from public.profiles where role = 'owner' order by created_at limit 1), 'ingreso', 1, 0, 'CRC', 'prueba 095 local', 'Caja Fuerte', 'Efectivo', 'aprobado', 'local-prueba-095');"
CU="select json_build_object('otro_local', (select count(*) from public.cash_movements where location_id = 'local-prueba-095'), 'total', (select count(*) from public.cash_movements)) as x"
O91=$(x "begin; $M091 $MIG $OTRO $(sim owner true) $CU; rollback;")
C91=$(x "begin; $M091 $MIG $OTRO $(sim contador true) $CU; rollback;")
compara "con la 091 y la 095, el contador ve lo mismo que el owner (todos los locales de mis_locales())" "$O91" "$C91"
compara "con la 091 y la 095, el cajero sin asignación no ve el otro local" "0" "$(x "begin; $M091 $MIG $OTRO $(sim cajero true) $CU; rollback;" | jq -c '.otro_local')"

echo "== Vuelta atrás y estado final =="
compara "095 + rollback: el contador vuelve a ver 0" "$CEROS" "$(ve "$MIG $RB $(sim contador true)")"
compara "estado final: staging sin las 3 policies ni la fila 095" '{"pols":0,"ledger":0}' "$(x "select json_build_object('pols', (select count(*) from pg_policies where policyname like '%contador_select'), 'ledger', (select count(*) from supabase_migrations.schema_migrations where version = '095')) as x")"
echo "── Resultado: $ok OK · $fallas FALLA ──"
[ "$fallas" -eq 0 ] && echo VERDE || { echo "NO VERDE"; exit 1; }
