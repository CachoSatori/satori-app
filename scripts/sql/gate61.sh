#!/usr/bin/env bash
# G-61 (08-nov): diff EXACTO del catálogo entre dos bases (staging ↔ prod). Mecánico: sin criterio humano en la corrida.
#
#   bash scripts/sql/gate61.sh [--ref-a REF] [--ref-b REF] [--esperadas ARCHIVO] [--salida DIR] [--prod-firmado]
#   bash scripts/sql/gate61.sh --archivos A.txt B.txt [--esperadas ARCHIVO]     # sin base (lo usan las pruebas)
#
# · Corre scripts/sql/gate61_catalogo.sql en cada base dentro de «begin; set transaction read only; …; rollback;»
#   (Management API; el token lo pone el proxy o SUPABASE_ACCESS_TOKEN). Nunca escribe nada.
# · Por defecto A = staging y B = prod. Leer prod exige --prod-firmado (la firma de Ismael para esa lectura).
# · Diferencias esperadas: archivo versionado (por defecto scripts/sql/gate61_esperadas.txt). Cada entrada es una línea
#   «- <hecho>» (está en A y no en B) o «+ <hecho>» (está en B y no en A). Si hay entradas, la línea
#   «firma: <quién> <fecha> sha256=<hex>» tiene que tener el sha256 de las entradas (en el orden del archivo, unidas con
#   \n y con \n final). Cambiar una entrada sin volver a firmar invalida el archivo.
#
# Sale 0 SOLO si no hay diferencias sin esperar NI esperadas sobrantes. Códigos:
#   1 diferencias que no están en las esperadas · 2 esperadas que ya no aparecen (sobrantes)
#   3 una salida vacía, «null» o con menos de MIN_OBJETOS (898) líneas · 4 firma ausente o inválida
#   5 uso incorrecto o lectura de prod sin --prod-firmado
set -euo pipefail
STAGING=hwiatgicyyqyezqwldia
PROD=yiczgdtirrkdvohdquzf
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
MIN_OBJETOS=${MIN_OBJETOS:-898}
REF_A=$STAGING; REF_B=$PROD; ESPERADAS="$RAIZ/scripts/sql/gate61_esperadas.txt"; SALIDA=""; FIRMADO=0; ARCH_A=""; ARCH_B=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ref-a) REF_A=$2; shift 2 ;;
    --ref-b) REF_B=$2; shift 2 ;;
    --esperadas) ESPERADAS=$2; shift 2 ;;
    --salida) SALIDA=$2; shift 2 ;;
    --prod-firmado) FIRMADO=1; shift ;;
    --archivos) ARCH_A=$2; ARCH_B=$3; shift 3 ;;
    *) echo "uso: ver el encabezado de $0" >&2; exit 5 ;;
  esac
done
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export LC_ALL=C

leer() {   # leer REF DESTINO
  local ref=$1 dest=$2
  if ! [[ "$ref" =~ ^[a-z]{20}$ ]]; then echo "ref no válido: $ref" >&2; exit 5; fi
  if [ "$ref" = "$PROD" ] && [ "$FIRMADO" != 1 ]; then echo "NEGADO: leer prod exige --prod-firmado (firma de Ismael)." >&2; exit 5; fi
  jq -n --rawfile q "$RAIZ/scripts/sql/gate61_catalogo.sql" '{query:("begin; set transaction read only; " + $q + "; rollback;")}' \
    | curl -sS -X POST "https://api.supabase.com/v1/projects/$ref/database/query" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H 'Content-Type: application/json' --data-binary @- \
    | jq -r 'if type == "array" then (.[0].cat // "null") else "null" end' > "$dest" || echo null > "$dest"
}

if [ -n "$ARCH_A" ]; then cp "$ARCH_A" "$TMP/a.txt"; cp "$ARCH_B" "$TMP/b.txt"; NOM_A="A ($ARCH_A)"; NOM_B="B ($ARCH_B)"
else leer "$REF_A" "$TMP/a.txt"; leer "$REF_B" "$TMP/b.txt"; NOM_A="A ($REF_A)"; NOM_B="B ($REF_B)"; fi

for f in a b; do
  n=$(grep -c . "$TMP/$f.txt" || true)
  if [ "$n" -lt "$MIN_OBJETOS" ] || grep -qx 'null' "$TMP/$f.txt"; then
    echo "SALIDA VACÍA O CORTA ($f: $n líneas; mínimo $MIN_OBJETOS)"; exit 3
  fi
done
sort "$TMP/a.txt" > "$TMP/a.s"; sort "$TMP/b.txt" > "$TMP/b.s"   # sin -u: un hecho repetido en una sola base también es diferencia
{ comm -23 "$TMP/a.s" "$TMP/b.s" | sed 's/^/- /'; comm -13 "$TMP/a.s" "$TMP/b.s" | sed 's/^/+ /'; } | sort > "$TMP/dif"
echo "$NOM_A: $(wc -l < "$TMP/a.s") hechos · $NOM_B: $(wc -l < "$TMP/b.s") hechos · diferencias: $(wc -l < "$TMP/dif")"
[ -n "$SALIDA" ] && { mkdir -p "$SALIDA"; cp "$TMP/a.s" "$SALIDA/a.txt"; cp "$TMP/b.s" "$SALIDA/b.txt"; cp "$TMP/dif" "$SALIDA/diferencias.txt"; }

# Esperadas: entradas «- …»/«+ …» y su firma
: > "$TMP/esp"
if [ -f "$ESPERADAS" ]; then grep -E '^[-+] ' "$ESPERADAS" > "$TMP/esp" || true; fi
if [ -s "$TMP/esp" ]; then
  firma=$(grep -E '^firma: ' "$ESPERADAS" | tail -1 || true)
  sha_dec=$(sed -n 's/.*sha256=\([0-9a-f]\{64\}\).*/\1/p' <<< "$firma")
  sha_real=$(sha256sum "$TMP/esp" | cut -d' ' -f1)
  if [ -z "$firma" ] || [ "$sha_dec" != "$sha_real" ]; then
    echo "FIRMA AUSENTE O INVÁLIDA en $ESPERADAS (sha256 de las entradas: $sha_real)"; exit 4
  fi
  echo "esperadas: $(wc -l < "$TMP/esp") · $firma"
fi
sort -u "$TMP/esp" > "$TMP/esp.s"
comm -23 "$TMP/dif" "$TMP/esp.s" > "$TMP/inesperadas"
comm -13 "$TMP/dif" "$TMP/esp.s" > "$TMP/sobrantes"
rc=0
if [ -s "$TMP/sobrantes" ]; then echo "ESPERADAS SOBRANTES (ya no aparecen; sacarlas y volver a firmar):"; cat "$TMP/sobrantes"; rc=2; fi
if [ -s "$TMP/inesperadas" ]; then echo "DIFERENCIAS SIN ESPERAR:"; cat "$TMP/inesperadas"; rc=1; fi
[ $rc = 0 ] && echo "GATE 61: sin diferencias (fuera de las esperadas firmadas)"
exit $rc
