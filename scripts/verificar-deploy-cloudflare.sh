#!/usr/bin/env bash
# Verifica el deploy de staging caminando el GRAFO DE CHUNKS desde el entry.
# NO confía en el código HTTP: el fallback SPA de Cloudflare responde index.html (~2.7 kB)
# con 200 a CUALQUIER ruta /assets/*.js inexistente. Por eso todo se valida por
# TAMAÑO + CONTENIDO, y se descartan explícitamente las respuestas que son HTML.
set -uo pipefail
BASE="https://satori-staging.pages.dev"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { curl -fsSL --max-time 30 "$BASE/$1?cb=$RANDOM" 2>/dev/null; }

# Descarga un asset y RECHAZA el falso 200 (fallback SPA = HTML).
get_asset() { # $1=ruta relativa  $2=archivo destino
  fetch "$1" > "$2" || return 1
  head -c 400 "$2" | grep -qiE '<!doctype html|<html' && return 2   # falso 200
  return 0
}

echo "═══ 1. IDENTIDAD DEL BUILD ═══"
VJ=$(fetch "version.json"); echo "  version.json: $VJ"
COMMIT=$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' <<<"$VJ")
echo "  commit servido: $COMMIT"

echo
echo "═══ 2. ENTRY desde index.html REMOTO ═══"
fetch "" > "$TMP/index.html"
ENTRY=$(grep -oE 'assets/[A-Za-z0-9._-]+\.js' "$TMP/index.html" | head -1)
echo "  entry: $ENTRY"

echo
echo "═══ 3. CAMINATA DEL GRAFO (BFS desde el entry) ═══"
: > "$TMP/seen"; echo "$ENTRY" > "$TMP/queue"
FOUND_CIERRE=""; FOUND_CASHMOV=""
rounds=0
while [ -s "$TMP/queue" ] && [ $rounds -lt 8 ]; do
  rounds=$((rounds+1))
  cp "$TMP/queue" "$TMP/cur"; : > "$TMP/queue"
  while read -r a; do
    [ -z "$a" ] && continue
    grep -qxF "$a" "$TMP/seen" && continue
    echo "$a" >> "$TMP/seen"
    out="$TMP/$(echo "$a" | tr '/' '_')"
    get_asset "$a" "$out"; rc=$?
    if [ $rc -eq 2 ]; then echo "  ⚠️  FALSO 200 (HTML) → $a"; continue; fi
    [ $rc -ne 0 ] && { echo "  ❌ no descargó: $a"; continue; }
    sz=$(wc -c < "$out" | tr -d ' ')
    case "$a" in
      *cierrePozo*)      FOUND_CIERRE="$a|$sz";;
      *CashMovimientos*) FOUND_CASHMOV="$a|$sz";;
    esac
    # imports estáticos y dinámicos que aparecen dentro del chunk
    grep -oE '"\./[A-Za-z0-9._-]+\.js"|assets/[A-Za-z0-9._-]+\.js' "$out" 2>/dev/null \
      | tr -d '"' | sed 's|^\./|assets/|' | sort -u >> "$TMP/queue"
  done < "$TMP/cur"
  sort -u "$TMP/queue" -o "$TMP/queue"
done
echo "  chunks alcanzados desde el entry: $(wc -l < "$TMP/seen" | tr -d ' ')  (rondas: $rounds)"

echo
echo "═══ 4. CHUNKS DE CAJA — alcanzables, con tamaño real ═══"
for pair in "cierrePozo|$FOUND_CIERRE" "CashMovimientos|$FOUND_CASHMOV"; do
  name="${pair%%|*}"; val="${pair#*|}"
  if [ -n "$val" ]; then echo "  ✅ $name → ${val%|*}  (${val#*|} bytes)"
  else echo "  ❌ $name NO alcanzado desde el entry"; fi
done

echo
echo "═══ 5. CONTENIDO — el corte y el filtro nuevo, EN EL BUNDLE SERVIDO ═══"
CP="${FOUND_CIERRE%|*}"; CM="${FOUND_CASHMOV%|*}"
if [ -n "$CP" ]; then
  f="$TMP/$(echo "$CP" | tr '/' '_')"
  grep -q "2026-07-22" "$f" && echo "  ✅ corte '2026-07-22' presente en $CP" \
                            || echo "  ❌ corte '2026-07-22' AUSENTE en $CP"
  echo -n "     contexto: "; grep -oE '.{0,60}2026-07-22.{0,20}' "$f" | head -1
fi
if [ -n "$CM" ]; then
  f="$TMP/$(echo "$CM" | tr '/' '_')"
  grep -q "Apertura pozo" "$f" && echo "  ✅ exclusión del asiento de arranque ('Apertura pozo') presente en $CM" \
                               || echo "  ❌ 'Apertura pozo' AUSENTE en $CM"
  grep -q "ajuste apertura" "$f" && echo "  ✅ regla 'ajuste apertura' presente (filtro de Ingresos del período)" \
                                 || echo "  ⚠️  'ajuste apertura' no encontrada"
fi

echo
echo "═══ 6. CONTROL NEGATIVO — probar que el falso 200 existe y lo detectamos ═══"
BOGUS="assets/NO-EXISTE-ESTE-CHUNK-zzz999.js"
code=$(curl -s -o "$TMP/bogus" -w '%{http_code}' "$BASE/$BOGUS")
bsz=$(wc -c < "$TMP/bogus" | tr -d ' ')
echo "  GET /$BOGUS → HTTP $code, $bsz bytes"
if head -c 400 "$TMP/bogus" | grep -qiE '<!doctype html|<html'; then
  echo "  ✅ confirmado: un chunk inexistente devuelve $code con HTML (por eso NO se verifica por código HTTP)"
else
  echo "  (el fallback no devolvió HTML)"
fi
