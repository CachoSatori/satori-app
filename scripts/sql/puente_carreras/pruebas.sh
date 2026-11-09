#!/usr/bin/env bash
# Pruebas de pos_ndf_ingestar con la 082 DE ESTA RAMA, en STAGING, en una sola transacción que se DESCARTA:
#   begin → la 082 del archivo (sin su begin/commit) → pruebas.sql (sin su begin/rollback) → raise con el resultado.
# Nada queda en staging (ni la función, ni la columna, ni las filas de prueba). Token: el proxy (SUPABASE_ACCESS_TOKEN).
set -euo pipefail
REF=hwiatgicyyqyezqwldia
RAIZ=$(git rev-parse --show-toplevel); DIR="$RAIZ/scripts/sql/puente_carreras"
M="$RAIZ/supabase/migrations/082_pos_ndf_ingesta_transaccional.sql"
CUERPO=$(sed -E '/^\s*(begin|commit|rollback)\s*;\s*$/Id' "$DIR/pruebas.sql" | sed -E 's/^select json_agg\(/select json_agg(/')
Q="begin;
$(sed -E '/^\s*(begin|commit)\s*;\s*$/Id' "$M")
$(printf '%s\n' "$CUERPO" | sed '/^select json_agg(/,$d')
do \$r\$ begin raise exception 'RES:%', (select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', left(detalle, 200))) from _r); end \$r\$;"
jq -n --arg q "$Q" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H 'Content-Type: application/json' --data-binary @- \
  | jq -r '.message' | sed -n 's/.*RES:\(\[.*\]\).*/\1/p' | jq -c '.[] | {ok, caso}' | tee /dev/stderr \
  | jq -s 'map(.ok) | "\(map(select(.)) | length)/\(length)"' -r | { read -r x; echo "pruebas: $x"; [[ "${x%/*}" == "${x#*/}" ]]; }
echo "082 md5=$(md5sum < "$M" | cut -c1-32)"
