#!/usr/bin/env bash
# 177_pruebas · SOLO Postgres LOCAL. Arma una base nueva desde el repo (local_armar_base.sh, que ya aplica la 177),
# corre la batería scripts/sql/177_pruebas.sql (transacción descartada) con la 177 exacta y después con cada mutación:
# cada mutación TIENE que hacer caer al menos el caso indicado; si alguna no muerde, sale 1.
#
#   PGHOST=/tmp PGPORT=5499 PGUSER=pgv bash scripts/sql/177_pruebas.sh [base]
set -u
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
DB=${1:-p177_local}
MIG="$RAIZ/supabase/migrations/177_esquema_centimos_como_prod.sql"
BAT="$RAIZ/scripts/sql/177_pruebas.sql"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

bash "$RAIZ/scripts/sql/local_armar_base.sh" "$DB" "$RAIZ" | grep -v '^!! 003_\|^!! 094_'   # pg_cron y MAINTAIN: esperados

correr() {  # $1 = archivo de migración → imprime la salida de la batería
  psql -X -d "$DB" -v ON_ERROR_STOP=1 -v migracion="$1" -f "$BAT" 2>&1
}

fallo=0
out=$(correr "$MIG")
if grep -q '177-OK: 10/10' <<<"$out"; then echo "OK   177 exacta: 10/10"; else echo "MAL  177 exacta"; grep -E '^ +[0-9]+ \||177-' <<<"$out"; fallo=1; fi

mutar() {  # $1 nombre, $2 sed, $3 caso que tiene que caer
  local f="$TMP/$1.sql"
  sed "$2" "$MIG" > "$f"
  if cmp -s "$f" "$MIG"; then echo "MAL  mutación $1: el sed no cambió nada"; fallo=1; return; fi
  local o; o=$(correr "$f")
  if grep -q "177-FALLAN:.*$3" <<<"$o"; then echo "OK   mutación $1 → cae «$3»: $(grep -o '177-FALLAN:.*' <<<"$o" | head -1)"
  else echo "MAL  mutación $1 NO muerde (se esperaba que cayera «$3»)"; fallo=1; fi
}
mutar sin_guarda       's/if v_actual = v_tipo then/if false then/'                         '04 2.ª corrida'
mutar falta_tip_crc    "/\['tip_entries', *'tip_amount_crc'/d"                                  '02 después'
mutar sin_anti_redondeo 's/if v_malos > 0 then/if false then/'                               '07 no redondea'
mutar escala_mala      "s/\['cash_movements', *'amount_crc', *'numeric(12,2)'\]/['cash_movements', 'amount_crc', 'numeric(12,0)']/" '02 después'

psql -X -d postgres -qc "drop database if exists $DB" >/dev/null
exit $fallo
