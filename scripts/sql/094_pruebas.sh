#!/usr/bin/env bash
# Pruebas de la 094 (anon sin MAINTAIN) — SOLO STAGING. Cada caso en una transacción que termina en ROLLBACK.
# Sin falsos verdes: esperado por caso; «sin la 094» tiene que mostrar el hueco (anon con MAINTAIN); la autoverificación
# de la migración se prueba haciéndola abortar; nunca se imprime el detalle de un error. Sin el ref de prod.
# Uso: SUPABASE_ACCESS_TOKEN=… scripts/sql/094_pruebas.sh hwiatgicyyqyezqwldia
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN}"
REF=${1:?Uso: $0 <REF de staging>}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging. Nada en prod." >&2; exit 2; }
RAIZ=$(git rev-parse --show-toplevel)
MIG=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/supabase/migrations/094_anon_sin_maintain.sql")
RB=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/scripts/sql/094_rollback.sql")
VER=$(grep -v '^--' "$RAIZ/scripts/sql/094_verificacion.sql")
API="https://api.supabase.com/v1/projects/$REF/database/query"
q() { jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "$API" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-; }
x() { q "$1" | jq -c 'if type=="array" then .[-1].x else empty end' 2>/dev/null || true; }
limpio() { jq -r 'if type=="object" and has("message") then (.message | split("\n")[0] | sub("DETAIL:.*"; "")) else tostring end' <<<"$1" 2>/dev/null | head -c 200; }
echo "094_pruebas · $(TZ=America/Costa_Rica date '+%Y-%m-%d %H:%M CR') · REF=$REF · script @ $(git -C "$RAIZ" rev-parse --short HEAD)"
ok=0; fallas=0
compara() { if [ -n "$3" ] && [ "$(jq -cS . <<<"$2" 2>/dev/null)" = "$(jq -cS . <<<"$3" 2>/dev/null)" ]; then echo "OK    $1"; ok=$((ok+1));
            else echo "FALLA $1"; echo "      esperado: $2"; echo "      obtenido: ${3:-(sin respuesta)}"; fallas=$((fallas+1)); fi; }
LISTA="'accounting_entries','cash_movements','cash_sessions','credit_applications','movement_deletions','movement_edits','pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map','punch_exceptions','sops','supplier_credits','suppliers','time_punches','tip_entries','tip_sessions','ventas_comps','ventas_dias','ventas_hist','ventas_metas','salary_periods'"
# ACL normalizado (rol:permiso:re-otorgable, ordenado) de la lista; $1 = condición extra sobre las entradas
ACL() { echo "select md5(string_agg(c.relname || '|' || coalesce((select string_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by 1)
          from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where $1), ''), E'\n' order by c.relname)) as x
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ($LISTA);"; }
SIN_ANON_M="not (a.grantee = 'anon'::regrole and a.privilege_type = 'MAINTAIN')"

N=$(x "$VER" | jq -r '.tablas // empty')
[ -n "$N" ] && [ "$N" -gt 0 ] || { echo "NO PROBADO: no se pudo leer la lista"; echo "NO VERDE"; exit 1; }
ANTES=$(x "$VER")
echo "      staging hoy: $ANTES"
compara "sin la 094: anon tiene MAINTAIN en las $N tablas (el hueco)" "$N" "$(jq -r '.anon_maintain' <<<"$ANTES")"
ESP=$(jq -c '.anon_maintain = 0' <<<"$ANTES")
compara "con la 094: anon sin MAINTAIN; lo demás igual (otros permisos de anon, PUBLIC, authenticated)" "$ESP" "$(x "begin; $MIG $VER rollback;")"
A=$(x "$(ACL "$SIN_ANON_M")"); D=$(x "begin; $MIG $(ACL "$SIN_ANON_M") rollback;")
compara "con la 094: el ACL de las $N tablas cambia SOLO en anon:MAINTAIN" "\"$A\"" "\"$D\""
r=$(q "begin; grant truncate on table public.sops to anon; $MIG rollback;")
if echo "$r" | grep -q "094: anon conserva permisos"; then echo "OK    la autoverificación aborta si anon conserva algo (TRUNCATE plantado)"; ok=$((ok+1));
else echo "FALLA la autoverificación no abortó: $(limpio "$r")"; fallas=$((fallas+1)); fi
r=$(q "begin; grant select on table public.sops to public; $MIG rollback;")
if echo "$r" | grep -qE "094: (PUBLIC conserva|anon conserva)"; then echo "OK    la autoverificación aborta si PUBLIC tiene algo (SELECT plantado)"; ok=$((ok+1));
else echo "FALLA la autoverificación no abortó con PUBLIC: $(limpio "$r")"; fallas=$((fallas+1)); fi
compara "094 + rollback: la verificación vuelve a la de hoy" "$ANTES" "$(x "begin; $MIG $RB $VER rollback;")"
AT=$(x "$(ACL true)"); DT=$(x "begin; $MIG $RB $(ACL true) rollback;")
compara "094 + rollback: el ACL completo (normalizado) igual al de hoy" "\"$AT\"" "\"$DT\""
compara "estado final de staging: igual que al empezar (la 094 no quedó)" "$ANTES" "$(x "$VER")"
echo "── Resultado: $ok OK · $fallas FALLA ──"
[ "$fallas" -eq 0 ] && echo VERDE || { echo "NO VERDE"; exit 1; }
