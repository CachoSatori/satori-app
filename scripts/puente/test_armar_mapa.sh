#!/usr/bin/env bash
# Pruebas de armar_mapa_secretos.mjs contra el agente de prod REAL (4d3513a, extraído de git) con .env INVENTADOS.
# Sin red, sin secretos reales. Uso: bash scripts/puente/test_armar_mapa.sh
set -uo pipefail
RAIZ=$(git rev-parse --show-toplevel); T=$(mktemp -d); trap 'rm -rf -- "$T"' EXIT
AG="$T/agente"; mkdir -p "$AG"; git -C "$RAIZ" archive 4d3513a6df8e838dd5c0442b05a580e06ce9db9d pos-bridge src/shared | tar -x -C "$AG"
CL="$T/clon"; mkdir -p "$CL"; git -C "$RAIZ" archive HEAD src/shared scripts/puente | tar -x -C "$CL"
BASE='POS_DB_HOST=PC-PRUEBA\SQLPRUEBA
POS_DB_USER=lector
POS_DB_PASSWORD=x
POS_DB_DATABASE=ndf
LOCAL=santa-teresa
ENV=prod
POS_AGENTE_PROD_FIRMADO=2026-11-01
INGEST_URL=https://ejemplo.invalid/functions/v1/ingest-ndf'
LARGO="s3cr3t0-de-prueba-0123456789abcdef-XYZ"      # 38, inventado
ok=0; mal=0
correr() { ( cd "$T" && node --import "file://$AG/pos-bridge/register.mjs" "$CL/scripts/puente/armar_mapa_secretos.mjs" "$@" ) ; }
caso() { local nombre=$1 esperado=$2; shift 2; local out; out=$("$@" 2>&1); local rc=$?
  if { [ "$esperado" = ok ] && [ $rc -eq 0 ]; } || { [ "$esperado" != ok ] && [ $rc -ne 0 ] && grep -q -- "$esperado" <<<"$out"; }; then
    ok=$((ok+1)); echo "ok   $nombre"; else mal=$((mal+1)); echo "MAL  $nombre (rc=$rc): $out"; fi
  if grep -q -- "$LARGO" <<<"$out"; then mal=$((mal+1)); echo "MAL  $nombre: el secreto apareció en pantalla"; fi; }
# 1 · el de pos-bridge\.env pisa al de la raíz (orden del agente); el mapa trae ese y uno nuevo para nosara
printf '%s\nINGEST_SECRET=corto\n' "$BASE" > "$AG/.env"; printf 'INGEST_SECRET="%s"\r\n' "$LARGO" > "$AG/pos-bridge/.env"
caso "manda pos-bridge\\.env (con comillas y CRLF)" ok correr --agente "$AG" --clon "$CL" --salida "$T/s1.env"
J=$(sed -E "s/^POS_INGEST_SECRETS='(.*)'$/\1/" "$T/s1.env")
[ "$(jq -r '."santa-teresa"' <<<"$J")" = "$LARGO" ] && [ "$(jq -r '.nosara|length' <<<"$J")" = 64 ] && [ "$(jq -r 'keys|join(",")' <<<"$J")" = "nosara,santa-teresa" ] \
  && { ok=$((ok+1)); echo "ok   el archivo trae el secreto efectivo del agente y nosara de 64"; } || { mal=$((mal+1)); echo "MAL  contenido del archivo"; }
H=$(printf '%s' "$J" | sha256sum | cut -c1-64); OUT=$(correr --agente "$AG" --clon "$CL" --salida "$T/s1b.env" --huella-completa 2>&1)
grep -q '"archivo_que_manda":"pos-bridge/.env"' <<<"$OUT" && grep -q '"largo_santa_teresa":38' <<<"$OUT" \
  && { ok=$((ok+1)); echo "ok   informa el archivo que manda y el largo, sin el valor"; } || { mal=$((mal+1)); echo "MAL  resumen: $OUT"; }
grep -q "\"sha256_mapa\":\"$(printf '%s' "$(sed -E "s/^POS_INGEST_SECRETS='(.*)'$/\1/" "$T/s1b.env")" | sha256sum | cut -c1-64)\"" <<<"$OUT" \
  && { ok=$((ok+1)); echo "ok   el sha256 informado es el del mapa escrito"; } || { mal=$((mal+1)); echo "MAL  sha256"; }
# 1b · Grok 119: sin --huella-completa, por pantalla solo 12 caracteres de la huella
OUT=$(correr --agente "$AG" --clon "$CL" --salida "$T/s1c.env" 2>&1)
H12=$(printf '%s' "$(sed -E "s/^POS_INGEST_SECRETS='(.*)'$/\1/" "$T/s1c.env")" | sha256sum | cut -c1-12)
grep -q "\"huella_12\":\"$H12\"" <<<"$OUT" && ! grep -q 'sha256_mapa' <<<"$OUT" && ! grep -Eq '[0-9a-f]{13,}' <<<"$OUT" \
  && { ok=$((ok+1)); echo "ok   sin --huella-completa: solo los 12 primeros de la huella"; } || { mal=$((mal+1)); echo "MAL  huella 12: $OUT"; }
# 1c · Grok 119: --solo-medir no escribe nada, no arma mapa y dice el largo
OUT=$(correr --agente "$AG" --clon "$CL" --solo-medir 2>&1); rc=$?
[ $rc -eq 0 ] && grep -q '"largo_santa_teresa":38' <<<"$OUT" && grep -q '"cumple_32":true' <<<"$OUT" && ! grep -q 'huella\|sha256' <<<"$OUT" \
  && { ok=$((ok+1)); echo "ok   --solo-medir: largo y cumple_32, sin mapa ni huella"; } || { mal=$((mal+1)); echo "MAL  solo-medir: $OUT"; }
caso "--solo-medir con --salida → no" "va sin --salida" correr --agente "$AG" --clon "$CL" --solo-medir --salida "$T/x.env"
# 2 · ya existe la salida / ruta relativa / variable de entorno
caso "no pisa una salida existente" "ya existe" correr --agente "$AG" --clon "$CL" --salida "$T/s1.env"
caso "ruta relativa → no" "ruta absoluta" correr --agente "$AG" --clon "$CL" --salida "s2.env"
caso "INGEST_SECRET en la consola → no" "variable de entorno" env INGEST_SECRET=x node --import "file://$AG/pos-bridge/register.mjs" "$CL/scripts/puente/armar_mapa_secretos.mjs" --agente "$AG" --clon "$CL" --salida "$T/s3.env"
[ -e "$T/s3.env" ] && { mal=$((mal+1)); echo "MAL  dejó archivo"; }
# 3 · secreto corto: sin la opción no sigue y no deja archivo; con la opción lo cambia en el archivo que manda
printf 'INGEST_SECRET=corto-de-prueba\n' > "$AG/pos-bridge/.env"
caso "secreto < 32 sin --nuevo-santa-teresa → no" "menos de 32\|< 32" correr --agente "$AG" --clon "$CL" --salida "$T/s4.env"
[ -e "$T/s4.env" ] && { mal=$((mal+1)); echo "MAL  dejó archivo"; } || { ok=$((ok+1)); echo "ok   sin archivo de salida"; }
OUT=$(correr --agente "$AG" --clon "$CL" --solo-medir 2>&1); rc=$?
[ $rc -eq 0 ] && grep -q '"cumple_32":false' <<<"$OUT" && grep -q '"largo_santa_teresa":15' <<<"$OUT" \
  && { ok=$((ok+1)); echo "ok   --solo-medir con secreto corto: sale 0 y dice cumple_32 false (no corta 1.9)"; } || { mal=$((mal+1)); echo "MAL  solo-medir corto: $OUT"; }
caso "secreto < 32 con --nuevo-santa-teresa → lo cambia" ok correr --agente "$AG" --clon "$CL" --salida "$T/s5.env" --nuevo-santa-teresa
N=$(grep '^INGEST_SECRET=' "$AG/pos-bridge/.env" | cut -d= -f2-); J=$(sed -E "s/^POS_INGEST_SECRETS='(.*)'$/\1/" "$T/s5.env")
[ ${#N} = 64 ] && [ "$(jq -r '."santa-teresa"' <<<"$J")" = "$N" ] && grep -q '^INGEST_SECRET=corto-de-prueba' "$AG/pos-bridge/.env.antes-pase" \
  && { ok=$((ok+1)); echo "ok   el nuevo quedó en el archivo que manda, el mapa lo trae y hay copia .antes-pase"; } || { mal=$((mal+1)); echo "MAL  cambio del secreto"; }
# 4 · secreto con comilla → no; sin ningún INGEST_SECRET → no
printf "INGEST_SECRET=con'comilla-0123456789abcdef0123456789\n" > "$AG/pos-bridge/.env"
caso "secreto con comilla → no (no se puede escribir seguro)" "comillas" correr --agente "$AG" --clon "$CL" --salida "$T/s6.env"
rm "$AG/pos-bridge/.env"; printf '%s\n' "$BASE" > "$AG/.env"
caso "ningún .env define INGEST_SECRET → no" "ningún .env" correr --agente "$AG" --clon "$CL" --salida "$T/s7.env"
echo "pruebas: $ok ok, $mal mal"; [ $mal -eq 0 ]
