#!/usr/bin/env bash
# Prueba del rollback de la 085 — SOLO STAGING, en UNA transacción que termina en ROLLBACK (no deja nada).
#   1. Aplica scripts/sql/085_rollback.sql (sin su begin/commit) dentro de la transacción.
#   2. Lee las policies de las 6 tablas y las compara, campo por campo (permissive, roles, cmd, qual, with_check),
#      con el respaldo del catálogo de ANTES de la 085 (archivo fuera del repo; prod = staging antes de la 085).
#   3. Descarta, y verifica que la 085 siga puesta (las 6 lecturas con «get_my_role() is not null»).
# Salida: 0 = verde · 1 = falla · 2 = error de uso. Sin falsos verdes: si algo no se puede leer, es falla.
# Uso: SUPABASE_ACCESS_TOKEN=… scripts/sql/085_prueba_rollback.sh hwiatgicyyqyezqwldia <respaldo.json>
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN}"
REF=${1:?Uso: $0 <REF de staging> <respaldo.json>}; RESPALDO=${2:?falta el respaldo del catálogo (json)}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging. Nada en prod." >&2; exit 2; }
[ -s "$RESPALDO" ] || { echo "No encuentro el respaldo: $RESPALDO" >&2; exit 2; }
RAIZ=$(git rev-parse --show-toplevel)
ROLLBACK=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/scripts/sql/085_rollback.sql")
API="https://api.supabase.com/v1/projects/$REF/database/query"
q() {
  local body
  body=$(jq -n --arg q "$1" '{query:$q}' | curl -sS --fail-with-body -X POST "$API" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-) || {
    echo "ERROR de la API: $body" >&2; return 1; }
  jq -e 'type == "array"' >/dev/null <<<"$body" || { echo "ERROR: no es un arreglo: $body" >&2; return 1; }
  echo "$body"
}
TABLAS="'employees','tip_entries','tip_sessions','role_tip_points','exchange_rates','profiles'"
POL="select coalesce(json_agg(json_build_object('tablename', tablename, 'policyname', policyname, 'permissive', permissive,
       'roles', roles::text, 'cmd', cmd, 'qual', qual, 'with_check', with_check) order by tablename, policyname), '[]') as p
     from pg_policies where schemaname = 'public' and tablename in ($TABLAS)"
norm='map({tablename, policyname, permissive, roles, cmd, qual, with_check}) | sort_by(.tablename, .policyname)'
fallas=0

DESPUES_ROLLBACK=$(q "begin; $ROLLBACK; $POL; rollback;" | jq -c ".[-1].p | $norm")
ESPERADO=$(jq -c ".policies | map(select(.tablename as \$t | [\"employees\",\"tip_entries\",\"tip_sessions\",\"role_tip_points\",\"exchange_rates\",\"profiles\"] | index(\$t))) | $norm" "$RESPALDO")
n=$(jq length <<<"$ESPERADO")
if [ "$n" -ne 15 ]; then echo "FALLA el respaldo no trae las 15 policies (trae $n)"; fallas=$((fallas+1)); fi
if [ "$DESPUES_ROLLBACK" = "$ESPERADO" ]; then
  echo "OK    rollback: las $n policies quedan IGUALES al respaldo de antes de la 085"
else
  echo "FALLA rollback: las policies no coinciden con el respaldo"
  diff <(jq '.[]' <<<"$ESPERADO") <(jq '.[]' <<<"$DESPUES_ROLLBACK") | head -40 || true
  fallas=$((fallas+1))
fi

# Descartado: la 085 tiene que seguir puesta.
SIGUE=$(q "select count(*) as n from pg_policies where schemaname = 'public' and (tablename, policyname) in (
  ('employees','Todos ven empleados activos'), ('tip_entries','Todos ven entradas de propinas'),
  ('tip_sessions','Todos ven sesiones de propinas'), ('role_tip_points','Todos ven puntos por rol'),
  ('exchange_rates','Todos ven tipos de cambio'), ('exchange_rates','exchange_rates_read'))
  and qual ~* 'get_my_role\\(\\) is not null'" | jq -r '.[0].n')
if [ "$SIGUE" = 6 ]; then echo "OK    descartado: la 085 sigue puesta (6 de 6 lecturas con rol activo)"
else echo "FALLA después de descartar, la 085 no está entera ($SIGUE de 6)"; fallas=$((fallas+1)); fi

echo "── Resultado: $fallas falla(s) ──"
[ "$fallas" -eq 0 ]
