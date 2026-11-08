#!/bin/bash
# Pruebas de la 085 (SEC-01c): matriz rol × activo/inactivo × tabla, con sesiones simuladas.
#
#   SUPABASE_ACCESS_TOKEN=… scripts/sql/085_pruebas.sh <REF>
#
# Cada caso es UNA transacción que termina en ROLLBACK: no escribe nada. Las cuentas se eligen por
# rol y estado (la más antigua de cada grupo); el script no imprime nombres ni correos, solo el
# rol del caso y los conteos. Un caso sin cuenta en esa base sale como «sin cuenta».
# El «owner inactivo» se simula: dentro de la transacción se marca inactivo a un owner (con
# session_replication_role = replica para saltar los triggers de la 068) y se vuelve atrás.
#
# Resultado esperado DESPUÉS de la 085:
#   · cuentas inactivas: 0 filas en employees, tip_entries, tip_sessions, role_tip_points y
#     exchange_rates; 1 fila en profiles (la propia); update de otro perfil = 0 filas.
#   · activos: los mismos conteos que ANTES de la 085 (correr el script antes y después y comparar).
#   · owner activo: update de otro perfil = 1 fila.
set -euo pipefail
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "Falta SUPABASE_ACCESS_TOKEN (token de la Management API de Supabase)." >&2; exit 2
fi
REF=${1:?Uso: $0 <REF>}
case $REF in
  yiczgdtirrkdvohdquzf) echo "REF=$REF (PROD)" >&2;;
  hwiatgicyyqyezqwldia) echo "REF=$REF (STAGING)" >&2;;
  *) echo "ref desconocido: $REF" >&2; exit 1;;
esac

q() {
  jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-
}

uid() { # $1 = rol, $2 = true|false (activo)
  q "select id from public.profiles where role = '$1' and is_active = $2 order by created_at limit 1" | jq -r '.[0].id // empty'
}

LECTURA="select
  (select count(*) from public.employees)       as employees,
  (select count(*) from public.tip_entries)     as tip_entries,
  (select count(*) from public.tip_sessions)    as tip_sessions,
  (select count(*) from public.role_tip_points) as role_tip_points,
  (select count(*) from public.exchange_rates)  as exchange_rates,
  (select count(*) from public.profiles)        as profiles"

caso() { # $1 = etiqueta, $2 = uid, $3 = sql previo como postgres (opcional)
  local etiqueta=$1 id=$2 previo=${3:-}
  if [ -z "$id" ]; then printf '%-24s sin cuenta\n' "$etiqueta"; return; fi
  local otro
  otro=$(q "select id from public.profiles where id <> '$id' order by created_at limit 1" | jq -r '.[0].id')
  local r
  r=$(q "begin;
    $previo
    set local role authenticated;
    select set_config('request.jwt.claims', '{\"sub\":\"$id\",\"role\":\"authenticated\"}', true);
    with u as (update public.profiles set full_name = full_name where id = '$otro' returning 1)
    select l.*, (select count(*) from u) as update_otro_perfil from ($LECTURA) l;
    rollback;")
  printf '%-24s %s\n' "$etiqueta" "$(echo "$r" | jq -c '.[0] // .')"
}

caso "owner activo"       "$(uid owner true)"
OWNER=$(uid owner true)
caso "owner inactivo (sim)" "$OWNER" "set local session_replication_role = replica; update public.profiles set is_active = false where id = '$OWNER'; set local session_replication_role = origin;"
for rol in manager contador cajero salonero barman cocina; do
  caso "$rol activo"   "$(uid $rol true)"
  caso "$rol inactivo" "$(uid $rol false)"
done
r=$(q "begin; set local role anon; $LECTURA; rollback;")
printf '%-24s %s\n' "anon" "$(echo "$r" | jq -c '.[0] // .')"
