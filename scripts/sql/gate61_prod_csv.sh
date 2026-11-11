#!/usr/bin/env bash
# G-61 con el CSV de PROD (11-nov). Claude no lee prod: el dueño corre scripts/sql/gate61_catalogo.sql en el editor SQL de
# prod (entre «begin read only;» y «rollback;»), baja el CSV y se lo pasa. Este script lo compara con STAGING (solo lectura).
#
#   bash scripts/sql/gate61_prod_csv.sh <prod.csv> --antes   [--esperadas ARCHIVO]   # PASE-150-151 §1.5 (prod sin el Club)
#   bash scripts/sql/gate61_prod_csv.sh <prod.csv> --despues [--esperadas ARCHIVO]   # PASE-150-151 §5.4 (prod con la 150/151)
#
# · --antes: prod todavía no tiene nada del Club. Se sacan de los dos lados las líneas del Club: las que nombran algo
#   `club_` y las `cron …` (el catálogo solo lista las tareas `club%` de pg_cron y escribe «cron ausente» cuando no hay
#   ninguna; que pg_cron esté instalado lo dice la línea `ext pg_cron`). Sin modo prod: son ~330–400 hechos, por debajo del
#   piso de 3000 del catálogo completo. Si el CSV ya tiene hechos del Club, se niega (sale 5).
# · --despues: el catálogo COMPLETO en modo prod (piso de 3000, A ≠ B). Los hechos del Club tienen que coincidir uno por uno.
# · Las mismas esperadas en los dos (scripts/sql/gate61_esperadas.txt): son las diferencias de afuera del Club.
# · Sale con el código de gate61.sh (0 = solo diferencias esperadas y firmadas).
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
CSV=${1:?uso: gate61_prod_csv.sh <prod.csv> --antes|--despues [--esperadas ARCHIVO]}
MODO=${2:?falta --antes o --despues}; shift 2
case "$MODO" in --antes|--despues) ;; *) echo "uso: gate61_prod_csv.sh <prod.csv> --antes|--despues" >&2; exit 5 ;; esac
ESPERADAS="$RAIZ/scripts/sql/gate61_esperadas.txt"
if [ "${1:-}" = "--esperadas" ]; then ESPERADAS=${2:?falta el archivo}; fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export LC_ALL=C
python3 -I "$RAIZ/scripts/sql/gate61_desde_csv.py" "$CSV" "$TMP/prod_todo.txt" >/dev/null
STAGING=hwiatgicyyqyezqwldia   # SOLO staging: el ref de prod no está en este script
bash "$RAIZ/scripts/sql/gate61.sh" --ref-a "$STAGING" --ref-b "$STAGING" --esperadas /dev/null --salida "$TMP/st" >/dev/null 2>&1 || true
[ -s "$TMP/st/a.txt" ] || { echo "no se pudo leer el catálogo de staging"; exit 3; }
if [ "$MODO" = --antes ]; then
  if grep -q 'club_' "$TMP/prod_todo.txt"; then echo "PROD YA TIENE HECHOS DEL CLUB: esto no es el «antes» (usar --despues)."; exit 5; fi
  fuera() { grep -v -E 'club_|^cron ' "$1" || true; }
  fuera "$TMP/st/a.txt" > "$TMP/staging.txt"; fuera "$TMP/prod_todo.txt" > "$TMP/prod.txt"
  echo "staging: $(wc -l < "$TMP/st/a.txt") hechos ($(wc -l < "$TMP/staging.txt") de afuera del Club) · prod: $(wc -l < "$TMP/prod_todo.txt") hechos"
  MIN_OBJETOS=200 bash "$RAIZ/scripts/sql/gate61.sh" --archivos "$TMP/staging.txt" "$TMP/prod.txt" --esperadas "$ESPERADAS"
else
  bash "$RAIZ/scripts/sql/gate61.sh" --archivos "$TMP/st/a.txt" "$TMP/prod_todo.txt" --esperadas "$ESPERADAS" --modo-prod
fi
