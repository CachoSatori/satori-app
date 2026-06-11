#!/usr/bin/env bash
# Re-sincroniza el espejo de datos PROD → STAGING con un solo comando.
#   SUPABASE_ACCESS_TOKEN=sbp_xxx ./scripts/clone-prod-to-staging.sh --yes
# Guardrails (también dentro del .py): prod solo-lectura, escritura solo a
# staging hwiatgicyyqyezqwldia, aborta si falta el token o la confirmación.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "ABORT: exportá SUPABASE_ACCESS_TOKEN (token de la cuenta, p.ej. claude-code-staging)" >&2
  exit 1
fi
exec python3 scripts/clone_prod_to_staging.py "$@"
