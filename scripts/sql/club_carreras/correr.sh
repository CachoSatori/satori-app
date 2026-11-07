#!/usr/bin/env bash
# Carreras de dos sesiones del Club (CLUB-AUD-03, 04, 07, 08 y 15; R-01: 16). SOLO STAGING (ref fijo).
#
#   CAJERO_UUID=<perfil cajero activo> OWNER_UUID=<perfil owner activo> scripts/sql/club_carreras/correr.sh
#
# Cada carrera: dos pedidos a la Management API en paralelo (dos sesiones de Postgres de verdad).
# Datos sintéticos («Carrera …», factura 990951), que se borran al final aunque algo falle.
# club_vencer y club_reporte_cerrar corren SIEMPRE en una sesión que termina en ROLLBACK.
# Token: SUPABASE_ACCESS_TOKEN (en las sesiones de Claude Code lo inyecta el proxy).
set -euo pipefail
REF=hwiatgicyyqyezqwldia            # staging. No se acepta otro.
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${CAJERO_UUID:?falta CAJERO_UUID}" "${OWNER_UUID:?falta OWNER_UUID}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

sql() {   # sql <archivo> → JSON de la respuesta
  sed -e "s/<CAJERO_UUID>/$CAJERO_UUID/g" -e "s/<OWNER_UUID>/$OWNER_UUID/g" "$1" > "$TMP/q.sql"
  jq -n --rawfile q "$TMP/q.sql" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H 'Content-Type: application/json' --data-binary @-
}
par() {   # par <n>: s1 arranca, a los 1,5 s arranca s2; espera a las dos
  sql "$DIR/${1}_s1.sql" > "$TMP/${1}_s1.json" & sleep 1.5; sql "$DIR/${1}_s2.sql" > "$TMP/${1}_s2.json" & wait
}

limpiar() { local r; r=$(sql "$DIR/limpiar.sql"); case "$r" in *message*) echo "LIMPIEZA FALLÓ: $r" >&2; return 1;; esac; }
trap 'limpiar; rm -rf "$TMP"' EXIT
limpiar
sql "$DIR/prep.sql" > /dev/null

for n in 03 07 08 15 16; do
  par "$n"
  sql "$DIR/${n}_chk.sql" | jq -c '.[0].json_build_object'
done
echo "  07 · lo que vio la caja: $(jq -r '.[0].resultado' "$TMP/07_s2.json")"
echo "  08 · s1: $(jq -c '.[0].r' "$TMP/08_s1.json") · s2 (replay): $(jq -c '.[0].r' "$TMP/08_s2.json")"
echo "  15 · lo que vio la caja en s2: $(jq -r '.[0].resultado' "$TMP/15_s2.json")"
echo "  16 · s1: $(jq -c '.[0].r' "$TMP/16_s1.json") · s2 (mismo código): $(jq -r '.[0].resultado' "$TMP/16_s2.json")"

par 04   # cierre concurrente: s2 tiene que esperar a que termine s1
t1=$(jq -r '.[0].fin_tx // empty' "$TMP/04_s1.json"); t2=$(jq -r '.[0].fin_tx // empty' "$TMP/04_s2.json")
v1=$(jq -r '.[0].version // empty' "$TMP/04_s1.json"); v2=$(jq -r '.[0].version // empty' "$TMP/04_s2.json")
jq -nc --arg a "$t1" --arg b "$t2" --arg v1 "$v1" --arg v2 "$v2" \
  '{caso:"04 cierre concurrente", s1_termina:$a, s2_termina:$b, version_s1:$v1, version_s2:$v2,
    ok:($a != "" and $b != "" and $b > $a and $v1 == "1" and $v2 == "1")}'
