#!/usr/bin/env bash
# CLUB-AUD-17: paridad de esquema. Compara el catálogo club_* de STAGING tal como está contra el de la
# 150 + 151 FINALES (antes 075 y 100) aplicadas desde cero (rollback + 150 + 151 dentro de una transacción que termina en ROLLBACK).
# Solo lectura en efectos: no deja nada. Salida: diff (vacío = paridad).
#   bash scripts/sql/club_paridad.sh [--antes <migración.sql>]
# (10-nov) --antes: el lado «staging» se lee con esa migración aplicada ENCIMA dentro de la misma transacción descartada
# (prueba una 150 nueva contra staging sin escribir: «aplicada sobre lo que hay» = «desde cero»).
set -euo pipefail
ANTES=""
if [ "${1:-}" = "--antes" ]; then ANTES=${2:?falta el archivo de --antes}; fi
REF=hwiatgicyyqyezqwldia   # staging
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
q() { jq -n --rawfile q "$1" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H 'Content-Type: application/json' --data-binary @- | jq -r '.[0].cat'; }
# (Grok 165, 10-nov) La misma normalización que con_antes de bateria_club.py: saca «begin;» y «commit;» con espacios
# alrededor y en cualquier mayúscula. Si después queda cualquier control de transacción (begin/commit/rollback con su «;»,
# «start transaction», «end transaction»), ABORTA: un commit en el medio confirmaría escrituras en staging.
cuerpo() {
  local out
  out=$(awk '{ l = tolower($0); gsub(/^[ \t\r]+|[ \t\r]+$/, "", l); if (l != "begin;" && l != "commit;") print }' "$1")
  if printf '%s\n' "$out" | grep -q -i -E '^[[:space:]]*(begin|commit|rollback|start[[:space:]]+transaction|end[[:space:]]+(transaction|work))([[:space:]]+(transaction|work))?[[:space:]]*;'; then
    echo "ABORTA (Grok 165): $1 tiene un control de transacción fuera de «begin;»/«commit;» en su propia línea" >&2
    exit 3
  fi
  printf '%s\n' "$out"
}
if [ -n "$ANTES" ]; then
  { echo 'begin;'; cuerpo "$ANTES"; cat "$RAIZ/scripts/sql/club_catalogo.sql"; echo '; rollback;'; } > "$TMP/a.sql"
else
  { echo 'begin; set transaction read only;'; cat "$RAIZ/scripts/sql/club_catalogo.sql"; echo '; rollback;'; } > "$TMP/a.sql"
fi
{ echo 'begin;'; cuerpo "$RAIZ/scripts/sql/150_rollback.sql"; cuerpo "$RAIZ/supabase/migrations/150_club_satori_esquema.sql";
  cuerpo "$RAIZ/supabase/migrations/151_club_catalogo_locales.sql";
  cat "$RAIZ/scripts/sql/club_catalogo.sql"; echo '; rollback;'; } > "$TMP/b.sql"
q "$TMP/a.sql" > "$TMP/staging.txt"; q "$TMP/b.sql" > "$TMP/limpia.txt"
echo "staging: $(wc -l < "$TMP/staging.txt") objetos · 150 + 151 desde cero: $(wc -l < "$TMP/limpia.txt") objetos"
# (08-nov) una salida vacía, «null» (la API devolvió un error) o corta NO es paridad: dos salidas vacías son iguales.
MIN_OBJETOS=${MIN_OBJETOS:-898}
for f in staging limpia; do
  n=$(grep -c . "$TMP/$f.txt" || true)
  if [ "$n" -lt "$MIN_OBJETOS" ] || grep -qx 'null' "$TMP/$f.txt"; then
    echo "SALIDA VACÍA O CORTA ($f: $n líneas; mínimo $MIN_OBJETOS): no hay paridad que comparar"; exit 2
  fi
done
if diff "$TMP/staging.txt" "$TMP/limpia.txt"; then echo 'PARIDAD: sin diferencias'; else echo 'HAY DIFERENCIAS (arriba)'; exit 1; fi
