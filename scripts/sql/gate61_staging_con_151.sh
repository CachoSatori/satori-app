#!/usr/bin/env bash
# G-61, lado STAGING para el pase del Club (10-nov). Staging tiene la 150 (como 075) pero NO la 151: para comparar con
# prod después del merge (que va a tener las dos), este script lee el catálogo de staging CON la 151 aplicada dentro de
# una transacción que termina en ROLLBACK. No deja nada en staging.
#
#   bash scripts/sql/gate61_staging_con_151.sh staging_con_151.txt
#   python3 -I scripts/sql/gate61_desde_csv.py prod.csv prod.txt          # el CSV que descarga el dueño en PROD
#   bash scripts/sql/gate61.sh --archivos staging_con_151.txt prod.txt --modo-prod
#
# Si staging ya tiene la 151 (fila 151 en su ledger), se niega: en ese caso se usa gate61.sh tal cual.
# Ref FIJO de staging. Este script no lee ni acepta otro ref.
set -euo pipefail
STAGING=hwiatgicyyqyezqwldia
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
SALIDA=${1:?uso: gate61_staging_con_151.sh <salida.txt>}
api() { curl -sS -X POST "https://api.supabase.com/v1/projects/$STAGING/database/query" \
          -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H 'Content-Type: application/json' --data-binary @-; }
ya=$(jq -n '{query:"select count(*) as n from supabase_migrations.schema_migrations where version in ($$151$$, $$100$$)"}' | api | jq -r '.[0].n // "error"')
if [ "$ya" != 0 ]; then echo "NEGADO: staging ya tiene la 151 (o la 100) en el ledger ($ya), o la lectura falló: usar gate61.sh" >&2; exit 5; fi
cuerpo151=$(grep -viE '^[[:space:]]*(begin|commit)[[:space:]]*;[[:space:]]*$' "$RAIZ/supabase/migrations/151_club_catalogo_locales.sql")
jq -n --arg m "$cuerpo151" --rawfile q "$RAIZ/scripts/sql/gate61_catalogo.sql" '{query:("begin; " + $m + "\n; " + $q + "; rollback;")}' \
  | api | jq -r 'if type == "array" then (.[0].cat // "null") else "null" end' > "$SALIDA"
n=$(grep -c . "$SALIDA" || true)
if [ "$n" -lt 3000 ] || grep -qx null "$SALIDA"; then echo "SALIDA VACÍA O CORTA ($n líneas)" >&2; exit 3; fi
echo "staging con la 151 (descartada): $n hechos → $SALIDA"
