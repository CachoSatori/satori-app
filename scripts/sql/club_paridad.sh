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
cuerpo() { grep -v -x -e 'begin;' -e 'commit;' "$1"; }
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
