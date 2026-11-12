#!/usr/bin/env bash
# G-61 (08-nov): diff EXACTO del catálogo entre dos bases (staging ↔ prod). Mecánico: sin criterio humano en la corrida.
#
#   bash scripts/sql/gate61.sh [--ref-a REF] [--ref-b REF] [--esperadas ARCHIVO] [--salida DIR] [--prod-firmado]
#   bash scripts/sql/gate61.sh --archivos A.txt B.txt [--esperadas ARCHIVO] [--modo-prod]   # sin base (lo usan las pruebas)
#
# · Corre scripts/sql/gate61_catalogo.sql en cada base dentro de «begin; set transaction read only; …; rollback;»
#   (Management API; el token lo pone el proxy o SUPABASE_ACCESS_TOKEN). Nunca escribe nada.
# · Por defecto A = staging y B = prod. Leer prod exige --prod-firmado (la firma de Ismael para esa lectura).
# · Diferencias esperadas: archivo versionado (por defecto scripts/sql/gate61_esperadas.txt). Cada entrada es una línea
#   «- <hecho>» (está en A y no en B) o «+ <hecho>» (está en B y no en A). Si hay entradas, la línea
#   «firma: <quién> <fecha> sha256=<hex>» tiene que tener el sha256 de las entradas (en el orden del archivo, unidas con
#   \n y con \n final). Cambiar una entrada sin volver a firmar invalida el archivo.
#   La línea «firma:» es solo un control de integridad (cualquiera puede recalcular el sha256): NO es la autorización.
#   La autorización de una esperada es el PR revisado y mergeado que la agrega o la cambia: el archivo solo cambia por PR
#   revisado (nunca en un commit directo ni en la corrida), y el gate se corre contra el archivo de la rama mergeada.
#
# · MODO PROD (cuando A o B es prod, o con --modo-prod en las pruebas) — auditoría del 08-nov:
#   - A y B tienen que ser distintos: el mismo ref, o el mismo archivo con --archivos, se rechaza (sale 5). Comparar una
#     base consigo misma siempre «pasa» y no prueba nada. (Dos bases distintas con el catálogo idéntico sí pasan: es el
#     objetivo.)
#   - MIN_OBJETOS no puede bajar del piso fijo PISO_PROD = 3000 (staging, 08-nov: 3.505 hechos; el piso deja ~14 % de
#     margen para cambios legítimos y frena una salida truncada). Un MIN_OBJETOS menor por variable de entorno se rechaza
#     (sale 5). Si el catálogo achica de verdad por debajo del piso, el piso se cambia en un PR revisado.
#
# Sale 0 SOLO si no hay diferencias sin esperar NI esperadas sobrantes. Códigos:
#   1 diferencias que no están en las esperadas · 2 esperadas que ya no aparecen (sobrantes)
#   3 una salida vacía, «null» o con menos de MIN_OBJETOS (por defecto el piso, 3000) líneas · 4 firma ausente o inválida
#   5 uso incorrecto, lectura de prod sin --prod-firmado, A = B en modo prod o MIN_OBJETOS bajo el piso en modo prod
set -euo pipefail
STAGING=hwiatgicyyqyezqwldia
PROD=yiczgdtirrkdvohdquzf
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
PISO_PROD=3000  # fijo: en modo prod MIN_OBJETOS no puede ser menor (cambiarlo es un PR revisado)
MIN_OBJETOS=${MIN_OBJETOS:-$PISO_PROD}
REF_A=$STAGING; REF_B=$PROD; ESPERADAS="$RAIZ/scripts/sql/gate61_esperadas.txt"; SALIDA=""; FIRMADO=0; ARCH_A=""; ARCH_B=""; MODO_PROD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ref-a) REF_A=$2; shift 2 ;;
    --ref-b) REF_B=$2; shift 2 ;;
    --esperadas) ESPERADAS=$2; shift 2 ;;
    --salida) SALIDA=$2; shift 2 ;;
    --prod-firmado) FIRMADO=1; shift ;;
    --archivos) ARCH_A=$2; ARCH_B=$3; shift 3 ;;
    --modo-prod) MODO_PROD=1; shift ;;
    *) echo "uso: ver el encabezado de $0" >&2; exit 5 ;;
  esac
done
if [ -z "$ARCH_A" ] && { [ "$REF_A" = "$PROD" ] || [ "$REF_B" = "$PROD" ]; }; then MODO_PROD=1; fi
if [ "$MODO_PROD" = 1 ]; then
  if ! [[ "$MIN_OBJETOS" =~ ^[0-9]+$ ]] || [ "$MIN_OBJETOS" -lt "$PISO_PROD" ]; then
    echo "NEGADO (modo prod): MIN_OBJETOS=$MIN_OBJETOS está por debajo del piso $PISO_PROD." >&2; exit 5
  fi
  if [ -n "$ARCH_A" ]; then
    if [ "$(realpath -- "$ARCH_A")" = "$(realpath -- "$ARCH_B")" ]; then echo "NEGADO (modo prod): A y B son el mismo archivo." >&2; exit 5; fi
  elif [ "$REF_A" = "$REF_B" ]; then echo "NEGADO (modo prod): A y B son la misma base ($REF_A)." >&2; exit 5; fi
fi
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
# (11-nov) SIN -u: un hecho que sale dos veces (p. ej. una policy que usa get_my_role en USING y en WITH CHECK) se
# espera dos veces. Con -u, la segunda copia quedaba como «sin esperar».
sort "$TMP/esp" > "$TMP/esp.s"
comm -23 "$TMP/dif" "$TMP/esp.s" > "$TMP/inesperadas"
comm -13 "$TMP/dif" "$TMP/esp.s" > "$TMP/sobrantes"
rc=0
if [ -s "$TMP/sobrantes" ]; then echo "ESPERADAS SOBRANTES (ya no aparecen; sacarlas y volver a firmar):"; cat "$TMP/sobrantes"; rc=2; fi
if [ -s "$TMP/inesperadas" ]; then echo "DIFERENCIAS SIN ESPERAR:"; cat "$TMP/inesperadas"; rc=1; fi
[ $rc = 0 ] && echo "GATE 61: sin diferencias (fuera de las esperadas firmadas)"
exit $rc
