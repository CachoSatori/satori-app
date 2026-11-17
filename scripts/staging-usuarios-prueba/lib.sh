# Usuarios de prueba de STAGING — funciones comunes. Se usa con `source`, no se corre solo.
# SOLO STAGING (ref fijo). Nunca imprime claves, tokens, enlaces ni contraseñas.
# Higiene (misma que scripts/sql/club_api/pos_login_manager.sh): cabeceras en ARCHIVOS dentro de un mktemp -d
# (umask 077), curl las lee con `-H @archivo`, el trap borra todo al salir.
set -euo pipefail
umask 077
REF=hwiatgicyyqyezqwldia
URL="https://$REF.supabase.co"
MGMT="https://api.supabase.com/v1/projects/$REF"
DOMINIO_PRUEBA="staging-satori.test"           # .test: reservado (RFC 2606) y aceptado por src/privacidadRepo.test.ts
ROLES_PRUEBA="owner manager contador cajero salonero barman barback runner cocina proveedor"
ROLES_CON_EMPLEADO="cajero salonero barman barback runner cocina"

[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "ABORT: este script es solo para staging"; exit 2; }

T=$(mktemp -d)
H_MGMT="$T/h_mgmt"; H_SRV="$T/h_srv"; H_ANON="$T/h_anon"
trap 'rm -rf -- "$T"' EXIT
printf 'Authorization: Bearer %s\n' "${SUPABASE_ACCESS_TOKEN:-x}" > "$H_MGMT"   # el proxy reemplaza el valor

sql() { jq -Rs '{query: .}' <<<"$1" | curl -sS -X POST "$MGMT/database/query" -H @"$H_MGMT" \
          -H 'Content-Type: application/json' --data-binary @-; }

cargar_claves() {
  curl -sS "$MGMT/api-keys?reveal=true" -H @"$H_MGMT" > "$T/keys.json"
  jq -r '.[] | select(.name=="service_role") | "apikey: \(.api_key)\nAuthorization: Bearer \(.api_key)"' "$T/keys.json" > "$H_SRV"
  jq -r '.[] | select(.name=="anon") | "apikey: \(.api_key)"' "$T/keys.json" > "$H_ANON"
  rm -f -- "$T/keys.json"
  [ -s "$H_SRV" ] && [ -s "$H_ANON" ] || { echo "no hay claves de staging"; exit 2; }
}

correo_de() { printf 'prueba-%s@%s' "$1" "$DOMINIO_PRUEBA"; }
