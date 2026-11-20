#!/usr/bin/env bash
# Cadena COMPLETA después de cada re-clonado de STAGING (SPEC-anonimizar-staging §3), en orden y parando en el primer error:
#   crear.sh → neutralizar-copias.sql → ensayo (ROLLBACK) → ensayo --idempotencia (ROLLBACK) → anonimizar REAL →
#   storage.sh --si → verificar → inventario.sql
# Después falta a mano la prueba de barreras de SPEC-staging-agentes. Escribe en staging para siempre: lo corre el
# coordinador con el OK del dueño por chat (D5 de SPEC-staging-agentes).
#   SUPABASE_ACCESS_TOKEN=... bash scripts/staging-anonimizar/cadena.sh --si
# Sin --si solo imprime los pasos. SOLO staging: el ref está fijo en lib.sh y en correr.py.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
UP="$AQUI/../staging-usuarios-prueba"
PASOS="1 crear.sh · 2 neutralizar-copias.sql · 3 ensayo · 4 ensayo --idempotencia · 5 real · 6 storage.sh --si · 7 verificar · 8 inventario.sql"
if [ "${1:-}" != "--si" ]; then echo "Pasos: $PASOS"; echo "Agregar --si para correrlos (con el OK del dueño)."; exit 0; fi

source "$UP/lib.sh"   # REF fijo de staging + sql()
paso() { echo; echo "── $1"; }

paso "1/8 usuarios de prueba (crear.sh, idempotente)";    bash "$UP/crear.sh"
paso "2/8 neutralizar las cuentas copiadas de prod";      sql "$(cat "$UP/neutralizar-copias.sql")" | jq -c '.'
paso "3/8 ensayo de la anonimización (ROLLBACK)";         python3 "$AQUI/correr.py" ensayo
paso "4/8 ensayo de idempotencia (ROLLBACK)";             python3 "$AQUI/correr.py" ensayo --idempotencia
paso "5/8 anonimización REAL (COMMIT)";                    python3 "$AQUI/correr.py" real --si
paso "6/8 Storage: imagen ficticia y borrado (D3)";       bash "$AQUI/storage.sh" --si
paso "7/8 verificación final (solo conteos)";             python3 "$AQUI/correr.py" verificar
paso "8/8 inventario de usuarios (solo conteos)";         sql "$(cat "$UP/inventario.sql")" | jq -c '.[]'
echo; echo "Listo. Falta la prueba de barreras (SPEC-staging-agentes) y anotar la corrida en STAGING.md."
