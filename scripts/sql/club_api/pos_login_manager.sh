#!/usr/bin/env bash
# Grok 106 · prueba NEGATIVA por la API real (PostgREST), como un MANAGER: no puede cambiar el login del PoS de un
# empleado. SOLO STAGING (ref fijo). Nunca imprime claves, tokens ni correos.
#   bash scripts/sql/club_api/pos_login_manager.sh
# (09-nov, Grok 116) Higiene:
#   · ninguna clave ni token en argv: las cabeceras van en ARCHIVOS (umask 077, dentro de un mktemp -d) y curl las lee
#     con `-H @archivo`; jq recibe los secretos por stdin, nunca con --arg;
#   · todo temporal en un mktemp -d que borra el trap (también si falla a la mitad);
#   · usuario SINTÉTICO de staging: se crea para la prueba (correo .invalid al azar, rol manager, activo) y se borra al
#     final con su empleado. No se toca ningún usuario existente.
# Pasos: (1) claves del proyecto por la Management API (el proxy pone el token); (2) usuario sintético y su sesión real
# con un magic link generado por la API de admin (no manda correo); (3) empleado sintético; (4) PATCH pos_login como
# manager → tiene que fallar (42501) y la fila no cambia; (5) PATCH del nombre → pasa; (6) limpieza verificada.
set -euo pipefail
umask 077
REF=hwiatgicyyqyezqwldia; URL="https://$REF.supabase.co"; MGMT="https://api.supabase.com/v1/projects/$REF"
T=$(mktemp -d)
EMP=""; UID_SINT=""
H_MGMT="$T/h_mgmt"; H_SRV="$T/h_srv"; H_ANON="$T/h_anon"; H_TOK="$T/h_tok"
printf 'Authorization: Bearer %s\n' "${SUPABASE_ACCESS_TOKEN:-x}" > "$H_MGMT"   # el proxy reemplaza el valor
sql() { jq -Rs '{query: .}' <<<"$1" | curl -sS -X POST "$MGMT/database/query" -H @"$H_MGMT" \
          -H 'Content-Type: application/json' --data-binary @-; }
borrar_sinteticos() {
  [ -n "$EMP" ] && sql "delete from public.employees where id = '$EMP'" >/dev/null
  if [ -n "$UID_SINT" ]; then
    sql "delete from public.profiles where id = '$UID_SINT'" >/dev/null
    [ -s "$H_SRV" ] && curl -sS -o /dev/null -X DELETE "$URL/auth/v1/admin/users/$UID_SINT" -H @"$H_SRV"
  fi
  EMP=""; UID_SINT=""
}
limpiar() { set +e; borrar_sinteticos; rm -rf -- "$T"; }
trap limpiar EXIT

# (1) claves: se escriben DIRECTO a los archivos de cabeceras (nunca en una variable de la línea de comandos)
curl -sS "$MGMT/api-keys?reveal=true" -H @"$H_MGMT" > "$T/keys.json"
jq -r '.[] | select(.name=="service_role") | "apikey: \(.api_key)\nAuthorization: Bearer \(.api_key)"' "$T/keys.json" > "$H_SRV"
jq -r '.[] | select(.name=="anon") | "apikey: \(.api_key)"' "$T/keys.json" > "$H_ANON"
rm -f -- "$T/keys.json"
[ -s "$H_SRV" ] && [ -s "$H_ANON" ] || { echo "no hay claves"; exit 2; }

# (2) usuario sintético: correo al azar en un dominio .invalid (no existe; no se manda nada)
CORREO="api116.$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')@prueba.invalid"
printf '%s' "$CORREO" | jq -Rc '{email: ., email_confirm: true}' > "$T/alta.json"
UID_SINT=$(curl -sS -X POST "$URL/auth/v1/admin/users" -H @"$H_SRV" -H 'Content-Type: application/json' \
             --data-binary @"$T/alta.json" | jq -r '.id // empty')
[ -n "$UID_SINT" ] || { echo "no se pudo crear el usuario sintético"; exit 2; }
sql "insert into public.profiles (id, full_name, role, is_active) values ('$UID_SINT', 'Manager Sintético API 116', 'manager', true)
     on conflict (id) do update set role = 'manager', is_active = true, full_name = excluded.full_name" >/dev/null
ROL=$(sql "select role from public.profiles where id = '$UID_SINT' and is_active" | jq -r '.[0].role // empty')
[ "$ROL" = manager ] || { echo "el usuario sintético no quedó manager activo"; exit 2; }
printf '%s' "$CORREO" | jq -Rc '{type: "magiclink", email: .}' > "$T/link.json"
unset CORREO
curl -sS -X POST "$URL/auth/v1/admin/generate_link" -H @"$H_SRV" -H 'Content-Type: application/json' \
     --data-binary @"$T/link.json" | jq -c '{type: "magiclink", token_hash: (.hashed_token // .properties.hashed_token // "")}' > "$T/verify.json"
curl -sS -X POST "$URL/auth/v1/verify" -H @"$H_ANON" -H 'Content-Type: application/json' --data-binary @"$T/verify.json" \
  | jq -r 'if .access_token then "Authorization: Bearer \(.access_token)" else empty end' > "$H_TOK"
rm -f -- "$T/link.json" "$T/verify.json"
[ -s "$H_TOK" ] || { echo "no se pudo abrir la sesión del manager sintético"; exit 2; }

# (3) empleado sintético
EMP=$(sql "insert into public.employees (full_name, role) values ('Empleado Prueba API 106', 'salonero') returning id" | jq -r '.[0].id')
# (4) el manager intenta cargarle un login del PoS
R=$(curl -sS -o "$T/r106.json" -w '%{http_code}' -X PATCH "$URL/rest/v1/employees?id=eq.$EMP" -H @"$H_ANON" -H @"$H_TOK" \
      -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"pos_login":"9106"}')
CODE=$(jq -r '.code // empty' "$T/r106.json" 2>/dev/null || true)
QUEDO=$(sql "select coalesce(pos_login, 'null') l from public.employees where id = '$EMP'" | jq -r '.[0].l')
jq -nc --arg h "$R" --arg c "$CODE" --arg l "$QUEDO" '{caso:"106 · manager por la API cambia pos_login", http:$h, code:$c, pos_login_queda:$l, ok:(($h|startswith("4")) and $c=="42501" and $l=="null")}'
# (5) el mismo manager sí edita el nombre (la política sigue igual para lo demás)
R=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$URL/rest/v1/employees?id=eq.$EMP" -H @"$H_ANON" -H @"$H_TOK" \
      -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"full_name":"Empleado Prueba API 106 (editado)"}')
N=$(sql "select full_name from public.employees where id = '$EMP'" | jq -r '.[0].full_name')
jq -nc --arg h "$R" --arg n "$N" '{caso:"106 · el manager por la API sigue editando el nombre", http:$h, ok:(($h|startswith("2")) and ($n|endswith("(editado)")))}'

# (6) limpieza verificada: el trap borra; acá se comprueba que no quedó nada
U=$UID_SINT; E=$EMP
borrar_sinteticos
RESTO=$(sql "select (select count(*) from auth.users where id = '$U') + (select count(*) from public.profiles where id = '$U')
                    + (select count(*) from public.employees where id = '$E') n" | jq -r '.[0].n')
jq -nc --arg n "$RESTO" '{caso:"116 · sin residuos (usuario, perfil y empleado sintéticos borrados)", residuos:($n|tonumber), ok:($n=="0")}'
