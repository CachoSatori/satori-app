#!/usr/bin/env bash
# Grok 106 · prueba NEGATIVA por la API real (PostgREST), como el usuario MANAGER de staging: no puede cambiar el login
# del PoS de un empleado. SOLO STAGING (ref fijo). Nunca imprime claves, tokens ni correos.
#   MANAGER_UUID=<uuid del manager de staging> bash scripts/sql/club_api/pos_login_manager.sh
# Pasos: (1) claves del proyecto por la Management API (el proxy pone el token); (2) sesión real del manager con un
# magic link generado por la API de admin (no manda correo); (3) empleado sintético creado y borrado al final;
# (4) PATCH pos_login como manager → tiene que fallar (42501) y la fila no cambia; (5) PATCH del nombre → pasa.
set -euo pipefail
REF=hwiatgicyyqyezqwldia; URL="https://$REF.supabase.co"; MGMT="https://api.supabase.com/v1/projects/$REF"
: "${MANAGER_UUID:?falta MANAGER_UUID}"
sql() { jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "$MGMT/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" \
          -H 'Content-Type: application/json' --data-binary @-; }
KEYS=$(curl -sS "$MGMT/api-keys?reveal=true" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}")
ANON=$(jq -r '.[] | select(.name=="anon") | .api_key' <<<"$KEYS"); SRV=$(jq -r '.[] | select(.name=="service_role") | .api_key' <<<"$KEYS")
unset KEYS
[ -n "$ANON" ] && [ -n "$SRV" ] || { echo "no hay claves"; exit 2; }
EMAIL=$(sql "select email from auth.users where id = '$MANAGER_UUID'" | jq -r '.[0].email // empty')
ROL=$(sql "select role from public.profiles where id = '$MANAGER_UUID'" | jq -r '.[0].role // empty')
[ "$ROL" = manager ] || { echo "el usuario no es manager ($ROL)"; exit 2; }
# El manager de prueba de staging queda INACTIVO fuera de la batería (la batería lo activa dentro de su ROLLBACK). Acá se
# activa solo mientras dura la prueba y se deja como estaba al salir (trap).
ACT=$(sql "select is_active::text a from public.profiles where id = '$MANAGER_UUID'" | jq -r '.[0].a')
EMP=""
limpiar() {
  [ -n "$EMP" ] && sql "delete from public.employees where id = '$EMP'" >/dev/null
  sql "update public.profiles set is_active = $ACT where id = '$MANAGER_UUID'" >/dev/null
}
trap limpiar EXIT
sql "update public.profiles set is_active = true where id = '$MANAGER_UUID'" >/dev/null
HASH=$(jq -n --arg e "$EMAIL" '{type:"magiclink", email:$e}' | curl -sS -X POST "$URL/auth/v1/admin/generate_link" \
         -H "apikey: $SRV" -H "Authorization: Bearer $SRV" -H 'Content-Type: application/json' --data-binary @- | jq -r '.hashed_token // .properties.hashed_token // empty')
unset EMAIL
TOK=$(jq -n --arg h "$HASH" '{type:"magiclink", token_hash:$h}' | curl -sS -X POST "$URL/auth/v1/verify" -H "apikey: $ANON" \
        -H 'Content-Type: application/json' --data-binary @- | jq -r '.access_token // empty')
unset HASH SRV
[ -n "$TOK" ] || { echo "no se pudo abrir la sesión del manager"; exit 2; }
EMP=$(sql "insert into public.employees (full_name, role) values ('Empleado Prueba API 106', 'salonero') returning id" | jq -r '.[0].id')
# (4) el manager intenta cargarle un login del PoS
R=$(curl -sS -o /tmp/r106.json -w '%{http_code}' -X PATCH "$URL/rest/v1/employees?id=eq.$EMP" -H "apikey: $ANON" \
      -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"pos_login":"9106"}')
CODE=$(jq -r '.code // empty' /tmp/r106.json 2>/dev/null || true); rm -f /tmp/r106.json
QUEDO=$(sql "select coalesce(pos_login, 'null') l from public.employees where id = '$EMP'" | jq -r '.[0].l')
jq -nc --arg h "$R" --arg c "$CODE" --arg l "$QUEDO" '{caso:"106 · manager por la API cambia pos_login", http:$h, code:$c, pos_login_queda:$l, ok:(($h|startswith("4")) and $c=="42501" and $l=="null")}'
# (5) el mismo manager sí edita el nombre (la política sigue igual para lo demás)
R=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$URL/rest/v1/employees?id=eq.$EMP" -H "apikey: $ANON" \
      -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"full_name":"Empleado Prueba API 106 (editado)"}')
N=$(sql "select full_name from public.employees where id = '$EMP'" | jq -r '.[0].full_name')
jq -nc --arg h "$R" --arg n "$N" '{caso:"106 · el manager por la API sigue editando el nombre", http:$h, ok:(($h|startswith("2")) and ($n|endswith("(editado)")))}'
unset TOK ANON
