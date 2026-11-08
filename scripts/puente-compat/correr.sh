#!/usr/bin/env bash
# A7 (auditoría 08-nov): agente de prod (4d3513a) contra el Edge nuevo (e4678b3), en seco. Solo lee git.
# Uso: scripts/puente-compat/correr.sh [VIEJO=4d3513a] [NUEVO=e4678b3]   (desde la raíz del repo, con node_modules)
set -euo pipefail
VIEJO=${1:-4d3513a}; NUEVO=${2:-e4678b3}
RAIZ=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/VIEJO" "$TMP/NUEVO"
git -C "$RAIZ" archive "$VIEJO" pos-bridge src/shared | tar -x -C "$TMP/VIEJO"
git -C "$RAIZ" archive "$NUEVO" src/shared | tar -x -C "$TMP/NUEVO"
# Se guarda como .caso.ts para que la suite normal del repo no lo levante (importa carpetas temporales).
cp "$RAIZ/scripts/puente-compat/compat.caso.ts" "$TMP/compat.test.ts"
ln -s "$RAIZ/node_modules" "$TMP/node_modules"
echo "VIEJO=$(git -C "$RAIZ" rev-parse "$VIEJO") NUEVO=$(git -C "$RAIZ" rev-parse "$NUEVO")"
cd "$TMP" && "$RAIZ/node_modules/.bin/vitest" run --root "$TMP" compat.test.ts
