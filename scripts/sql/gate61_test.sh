#!/usr/bin/env bash
# Pruebas de la lógica de gate61.sh SIN base (modo --archivos): cada caso espera un código de salida.
#   bash scripts/sql/gate61_test.sh
set -uo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; G="$RAIZ/scripts/sql/gate61.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export LC_ALL=C
for i in $(seq 1 950); do echo "col club_x.c$i text"; done > "$T/a.txt"
cp "$T/a.txt" "$T/b.txt"
grep -v '^col club_x.c7 text$' "$T/a.txt" > "$T/b_falta.txt"                       # B no tiene un hecho de A
{ cat "$T/a.txt"; echo 'relacl club_x anon SELECT grant=f'; } > "$T/b_sobra.txt"   # B tiene uno de más
: > "$T/vacio.txt"; head -100 "$T/a.txt" > "$T/corto.txt"; echo null > "$T/null.txt"
firmar() { local e; e=$(grep -E '^[-+] ' "$1" | sha256sum | cut -d' ' -f1); echo "firma: Prueba 2026-11-08 sha256=$e" >> "$1"; }
echo '# vacío' > "$T/esp_vacio.txt"
{ echo '# B no tiene c7 (motivo de prueba)'; echo '- col club_x.c7 text'; } > "$T/esp_ok.txt"; firmar "$T/esp_ok.txt"
{ echo '- col club_x.c7 text'; echo '- col club_x.c8 text'; } > "$T/esp_sobra.txt"; firmar "$T/esp_sobra.txt"
{ echo '- col club_x.c7 text'; echo 'firma: Prueba 2026-11-08 sha256=0000000000000000000000000000000000000000000000000000000000000000'; } > "$T/esp_mala.txt"
echo '- col club_x.c7 text' > "$T/esp_sin_firma.txt"
{ echo '- col club_x.c7 text'; } > "$T/esp_editada.txt"; firmar "$T/esp_editada.txt"; sed -i 's/c7 text/c7 varchar/' "$T/esp_editada.txt"

fallas=0
caso() {   # caso NOMBRE CODIGO_ESPERADO args…
  local nom=$1 esp=$2; shift 2
  bash "$G" "$@" > "$T/out" 2>&1; local rc=$?
  if [ "$rc" = "$esp" ]; then echo "ok   $nom (sale $rc)"; else echo "FALLA $nom: salió $rc, esperaba $esp"; sed 's/^/     /' "$T/out" | head -5; fallas=$((fallas+1)); fi
}
caso 'idénticas, sin esperadas → 0'                         0 --archivos "$T/a.txt" "$T/b.txt" --esperadas "$T/esp_vacio.txt"
caso 'B sin un hecho y no esperado → 1'                     1 --archivos "$T/a.txt" "$T/b_falta.txt" --esperadas "$T/esp_vacio.txt"
caso 'B con un hecho de más (anon SELECT) → 1'              1 --archivos "$T/a.txt" "$T/b_sobra.txt" --esperadas "$T/esp_vacio.txt"
caso 'diferencia esperada y firmada → 0'                    0 --archivos "$T/a.txt" "$T/b_falta.txt" --esperadas "$T/esp_ok.txt"
caso 'esperada sobrante (ya no aparece) → 2'                2 --archivos "$T/a.txt" "$T/b_falta.txt" --esperadas "$T/esp_sobra.txt"
caso 'esperada pero las bases son iguales → 2'              2 --archivos "$T/a.txt" "$T/b.txt" --esperadas "$T/esp_ok.txt"
caso 'firma con sha256 que no coincide → 4'                 4 --archivos "$T/a.txt" "$T/b_falta.txt" --esperadas "$T/esp_mala.txt"
caso 'entradas sin firma → 4'                               4 --archivos "$T/a.txt" "$T/b_falta.txt" --esperadas "$T/esp_sin_firma.txt"
caso 'entrada editada después de firmar → 4'                4 --archivos "$T/a.txt" "$T/b_falta.txt" --esperadas "$T/esp_editada.txt"
caso 'salida A vacía → 3'                                   3 --archivos "$T/vacio.txt" "$T/b.txt" --esperadas "$T/esp_vacio.txt"
caso 'salida B corta (< 898) → 3'                           3 --archivos "$T/a.txt" "$T/corto.txt" --esperadas "$T/esp_vacio.txt"
caso 'salida «null» (error de la API) → 3'                  3 --archivos "$T/null.txt" "$T/null.txt" --esperadas "$T/esp_vacio.txt"
caso 'leer prod sin --prod-firmado → 5 (no conecta)'        5 --ref-a hwiatgicyyqyezqwldia --ref-b yiczgdtirrkdvohdquzf
echo "fallas: $fallas"
exit $fallas
