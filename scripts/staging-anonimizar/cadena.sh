#!/usr/bin/env bash
# Cadena COMPLETA después de cada re-clonado de STAGING (SPEC-anonimizar-staging §3), en orden y parando en el primer error:
#   club_marcar_staging.sql → crear.sh → neutralizar-copias.sql → ensayo (ROLLBACK) → ensayo --idempotencia (ROLLBACK) →
#   anonimizar REAL → storage.sh --si → verificar → inventario.sql
# El re-clonado copia club_entorno de prod (vacía): sin volver a marcarla, la guarda de anonimizar aborta.
# Después falta a mano la prueba de barreras de SPEC-staging-agentes. Escribe en staging para siempre: lo corre el
# coordinador con el OK del dueño por chat (D5 de SPEC-staging-agentes).
#   SUPABASE_ACCESS_TOKEN=... bash scripts/staging-anonimizar/cadena.sh --si
# Sin --si solo imprime los pasos. SOLO staging: el ref está fijo en lib.sh y en correr.py.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
UP="$AQUI/../staging-usuarios-prueba"
PASOS="1 club_marcar_staging.sql · 2 crear.sh · 3 neutralizar-copias.sql · 4 ensayo · 5 ensayo --idempotencia · 6 real · 7 storage.sh --si · 8 verificar · 9 inventario.sql"
if [ "${1:-}" != "--si" ]; then echo "Pasos: $PASOS"; echo "Agregar --si para correrlos (con el OK del dueño)."; exit 0; fi

source "$UP/lib.sh"   # REF fijo de staging + sql()
paso() { echo; echo "── $1"; }

paso "1/9 marcar la base como staging (club_entorno)";  sql "$(cat "$AQUI/../sql/club_marcar_staging.sql")" | jq -c '.'
MARCA=$(sql "select count(*) as n from public.club_entorno where nombre = 'staging'" | jq -r '.[0].n')
[ "$MARCA" = 1 ] || { echo '{"ok":false,"etapa":"club_entorno sin la marca de staging"}'; exit 2; }
paso "2/9 usuarios de prueba (crear.sh, idempotente)";    bash "$UP/crear.sh"
paso "3/9 neutralizar las cuentas copiadas de prod";      sql "$(cat "$UP/neutralizar-copias.sql")" | jq -c '.'
paso "4/9 ensayo de la anonimización (ROLLBACK)";         python3 "$AQUI/correr.py" ensayo
paso "5/9 ensayo de idempotencia (ROLLBACK)";             python3 "$AQUI/correr.py" ensayo --idempotencia
paso "6/9 anonimización REAL (COMMIT)";                    python3 "$AQUI/correr.py" real --si
paso "7/9 Storage: imagen ficticia y borrado (D3)";       bash "$AQUI/storage.sh" --si
paso "8/9 verificación final (solo conteos)";             python3 "$AQUI/correr.py" verificar
paso "9/9 inventario de usuarios (solo conteos)";         sql "$(cat "$UP/inventario.sql")" | jq -c '.[]'
echo; echo "Listo. Falta la prueba de barreras (SPEC-staging-agentes) y anotar la corrida en STAGING.md."
