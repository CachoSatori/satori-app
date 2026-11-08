#!/bin/bash
# Pruebas de la 082 (my_turno_stats): una transacción por caso, siempre ROLLBACK, sin nombres.
#   SUPABASE_ACCESS_TOKEN=… scripts/sql/082_pruebas.sh hwiatgicyyqyezqwldia   (solo staging: en prod
#   la función no existe)
# Esperado DESPUÉS de la 082: anon → permission denied · salonero/barman inactivo → 42501 ·
# salonero activo → jsonb con sus números (igual que antes de la 082).
set -euo pipefail
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo "Falta SUPABASE_ACCESS_TOKEN." >&2; exit 2; }
REF=${1:?Uso: $0 <REF>}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging (en prod la función no existe)." >&2; exit 1; }
q() { jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-; }
uid() { q "select id from public.profiles where role = '$1' and is_active = $2 order by created_at limit 1" | jq -r '.[0].id // empty'; }
caso() {
  if [ -z "$2" ]; then printf '%-20s sin cuenta\n' "$1"; return; fi
  printf '%-20s %s\n' "$1" "$(q "begin; set local role authenticated;
    select set_config('request.jwt.claims', '{\"sub\":\"$2\",\"role\":\"authenticated\"}', true);
    select public.my_turno_stats() is not null as ok; rollback;" | head -c 200)"
}
caso "salonero activo"   "$(uid salonero true)"
caso "salonero inactivo" "$(uid salonero false)"
caso "barman inactivo"   "$(uid barman false)"
printf '%-20s %s\n' "anon" "$(q "begin; set local role anon; select public.my_turno_stats(); rollback;" | head -c 200)"
