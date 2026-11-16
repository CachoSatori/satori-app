#!/usr/bin/env bash
# 178_pruebas · SOLO Postgres LOCAL. Arma una base nueva desde el repo (local_armar_base.sh, que ya aplica la 178),
# corre la batería scripts/sql/178_pruebas.sql (transacciones descartadas) con la 178 exacta y después con cada
# mutación: cada mutación TIENE que hacer caer al menos el caso indicado; si alguna no muerde, sale 1.
#
#   PGHOST=/tmp PGPORT=5499 PGUSER=pgv bash scripts/sql/178_pruebas.sh [base]
set -u
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
DB=${1:-p178_local}
MIG="$RAIZ/supabase/migrations/178_esquema_columnas_caja_como_prod.sql"
BAT="$RAIZ/scripts/sql/178_pruebas.sql"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

bash "$RAIZ/scripts/sql/local_armar_base.sh" "$DB" "$RAIZ" | grep -v '^!! 003_\|^!! 094_'   # pg_cron y MAINTAIN: esperados

correr() {  # $1 = archivo de migración → imprime la salida de la batería
  psql -X -d "$DB" -v ON_ERROR_STOP=1 -v migracion="$1" -f "$BAT" 2>&1
}

fallo=0
out=$(correr "$MIG")
if grep -q '178-OK: 12/12' <<<"$out"; then echo "OK   178 exacta: 12/12"; else echo "MAL  178 exacta"; grep -E '^ +[0-9]+ \||178-' <<<"$out"; fallo=1; fi

mutar() {  # $1 nombre, $2 sed, $3 caso que tiene que caer
  local f="$TMP/$1.sql"
  sed "$2" "$MIG" > "$f"
  if cmp -s "$f" "$MIG"; then echo "MAL  mutación $1: el sed no cambió nada"; fallo=1; return; fi
  local o; o=$(correr "$f")
  if grep -q "178-FALLAN:.*$3" <<<"$o"; then echo "OK   mutación $1 → cae «$3»: $(grep -o '178-FALLAN:.*' <<<"$o" | head -1)"
  else echo "MAL  mutación $1 NO muerde (se esperaba que cayera «$3»)"; fallo=1; fi
}
# sin la guarda del catálogo: ALTER aunque la columna exista (en prod tomaría el lock exclusivo de las dos tablas)
mutar sin_guarda        's/if coalesce(v_existe, false) then/if false then/'                         '09 base como prod: 0 locks'
mutar falta_amount_usd  "/\['cash_movements', *'amount_usd'/d"                                        '02 después'
mutar default_malo      "s/\['cash_sessions',  'initial_cash_usd', 'numeric', '0'\]/['cash_sessions',  'initial_cash_usd', 'numeric', '']/" '02 después'
mutar con_escala        "s/\['cash_sessions',  'final_cash_crc',   'numeric', ''\]/['cash_sessions',  'final_cash_crc',   'numeric(12,2)', '']/" '02 después'
mutar not_null          "s/v_tipo, case when v_def <> '' then ' default ' || v_def else '' end/v_tipo, case when v_def <> '' then ' not null default ' || v_def else '' end/" '02 después'
mutar sin_verificacion  's/if v_actual <> v_tipo or v_nonull or v_def_actual <> v_def then/if false then/' '07 distinta a prod'

psql -X -d postgres -qc "drop database if exists $DB" >/dev/null
exit $fallo
