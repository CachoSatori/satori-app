#!/usr/bin/env bash
# Abre una sesión real de un usuario de prueba de STAGING sin contraseña y la deja en un archivo 0600 FUERA del repo.
#   SUPABASE_ACCESS_TOKEN=... bash scripts/staging-usuarios-prueba/sesion.sh <rol> <archivo_salida>
# Salida: JSON de sesión de GoTrue ({access_token, refresh_token, expires_at, user...}).
#   · Pruebas por API: `Authorization: Bearer <access_token>` + apikey anon (ESTADO regla 4: usuario real del rol).
#   · Pantallas (navegador): guardar el JSON tal cual en localStorage con la clave `sb-hwiatgicyyqyezqwldia-auth-token`
#     antes de abrir la app de staging, y recargar.
# El archivo es un secreto de corta vida (1 h): borrarlo al terminar. Nunca se imprime ni se pega en el chat.
source "$(dirname "$0")/lib.sh"
ROL="${1:-}"; SALIDA="${2:-}"
[[ " $ROLES_PRUEBA " == *" $ROL "* ]] || { echo "rol inválido. Roles: $ROLES_PRUEBA"; exit 2; }
[ -n "$SALIDA" ] || { echo "falta <archivo_salida>"; exit 2; }
case "$(realpath -m "$SALIDA")" in "$(git rev-parse --show-toplevel 2>/dev/null || echo /nada)"/*)
  echo "ABORT: el archivo de sesión no puede quedar dentro del repo"; exit 2;; esac
cargar_claves

jq -nc --arg e "$(correo_de "$ROL")" '{type: "magiclink", email: $e}' > "$T/link.json"
curl -sS -X POST "$URL/auth/v1/admin/generate_link" -H @"$H_SRV" -H 'Content-Type: application/json' \
     --data-binary @"$T/link.json" | jq -c '{type: "magiclink", token_hash: (.hashed_token // .properties.hashed_token // "")}' > "$T/verify.json"
( umask 077; curl -sS -X POST "$URL/auth/v1/verify" -H @"$H_ANON" -H 'Content-Type: application/json' \
     --data-binary @"$T/verify.json" | jq 'if .access_token then . else empty end' > "$SALIDA" )
[ -s "$SALIDA" ] || { rm -f -- "$SALIDA"; echo "{\"rol\":\"$ROL\",\"ok\":false}"; exit 2; }
echo "{\"rol\":\"$ROL\",\"ok\":true}"
