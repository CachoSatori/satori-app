#!/usr/bin/env bash
# CLUB-AUD-17: paridad de esquema. Compara el catálogo club_* de STAGING tal como está contra el de la
# 075 FINAL aplicada desde cero (rollback + 075 dentro de una transacción que termina en ROLLBACK).
# Solo lectura en efectos: no deja nada. Salida: diff (vacío = paridad).
set -euo pipefail
REF=hwiatgicyyqyezqwldia   # staging
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
q() { jq -n --rawfile q "$1" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H 'Content-Type: application/json' --data-binary @- | jq -r '.[0].cat'; }
cuerpo() { grep -v -x -e 'begin;' -e 'commit;' "$1"; }
{ echo 'begin; set transaction read only;'; cat "$RAIZ/scripts/sql/club_catalogo.sql"; echo '; rollback;'; } > "$TMP/a.sql"
{ echo 'begin;'; cuerpo "$RAIZ/scripts/sql/075_rollback.sql"; cuerpo "$RAIZ/supabase/migrations/075_club_satori_esquema.sql";
  cat "$RAIZ/scripts/sql/club_catalogo.sql"; echo '; rollback;'; } > "$TMP/b.sql"
q "$TMP/a.sql" > "$TMP/staging.txt"; q "$TMP/b.sql" > "$TMP/limpia.txt"
echo "staging: $(wc -l < "$TMP/staging.txt") objetos · 075 desde cero: $(wc -l < "$TMP/limpia.txt") objetos"
if diff "$TMP/staging.txt" "$TMP/limpia.txt"; then echo 'PARIDAD: sin diferencias'; else echo 'HAY DIFERENCIAS (arriba)'; exit 1; fi
