#!/usr/bin/env bash
# A7 (auditoría 08-nov) y ID 83 (Grok, 09-nov): el agente de prod (4d3513a, sin cambios) contra el Edge y la 082 nuevos.
#   compat   · en seco (solo git): un ciclo real del agente viejo pasa validarPayload/normalizarLote sin descartes.
#   cursor83 · contra la RPC REAL en STAGING, ciclo por ciclo, en transacciones que terminan descartadas (nada queda
#              en staging). Corre la 082 de CONTROL (la de e4678b3: reproduce el bug del ID 83), la de CONTROL v2 (la de
#              2aa7b98: reproduce el 113) y la NUEVA (la de esta rama).
# Uso: scripts/puente-compat/correr.sh [VIEJO=4d3513a] [NUEVO=HEAD] [CONTROL=e4678b3] [CONTROL_V2=2aa7b98]
#      (desde la raíz, con node_modules)
#      SOLO_SECO=1 → solo compat (sin red).
set -euo pipefail
VIEJO=${1:-4d3513a6df8e838dd5c0442b05a580e06ce9db9d}; NUEVO=${2:-HEAD}; CONTROL=${3:-e4678b395647d079863f8b7975c5935fd6cadcb5}
CONTROL_V2=${4:-2aa7b98b6f4bb5b878364d423ac7076244fb1335}
RAIZ=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/VIEJO" "$TMP/NUEVO"
git -C "$RAIZ" archive "$VIEJO" pos-bridge src/shared | tar -x -C "$TMP/VIEJO"
git -C "$RAIZ" archive "$NUEVO" src/shared | tar -x -C "$TMP/NUEVO"
# Se guardan como .caso.ts para que la suite normal del repo no los levante (importan carpetas temporales).
cp "$RAIZ/scripts/puente-compat/compat.caso.ts" "$TMP/compat.test.ts"
cp "$RAIZ/scripts/puente-compat/posMock.caso.ts" "$TMP/posMock.ts"     # PoS simulado ESTRICTO (Grok 111)
ARCH=compat.test.ts
if [ -z "${SOLO_SECO:-}" ]; then
  M=supabase/migrations/082_pos_ndf_ingesta_transaccional.sql
  git -C "$RAIZ" show "$NUEVO:$M" > "$TMP/082_nueva.sql"
  git -C "$RAIZ" show "$CONTROL:$M" > "$TMP/082_vieja.sql"
  git -C "$RAIZ" show "$CONTROL_V2:$M" > "$TMP/082_v2.sql"
  cp "$RAIZ/scripts/puente-compat/cursor83.caso.ts" "$TMP/cursor83.test.ts"
  ARCH="$ARCH cursor83.test.ts"
  echo "082 nueva md5=$(md5sum < "$TMP/082_nueva.sql" | cut -c1-32) · control md5=$(md5sum < "$TMP/082_vieja.sql" | cut -c1-32) · control v2 md5=$(md5sum < "$TMP/082_v2.sql" | cut -c1-32)"
fi
ln -s "$RAIZ/node_modules" "$TMP/node_modules"
echo "VIEJO=$(git -C "$RAIZ" rev-parse "$VIEJO") NUEVO=$(git -C "$RAIZ" rev-parse "$NUEVO") CONTROL=$(git -C "$RAIZ" rev-parse "$CONTROL")"
cd "$TMP" && "$RAIZ/node_modules/.bin/vitest" run --root "$TMP" $ARCH
