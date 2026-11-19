#!/usr/bin/env bash
# Gate único de satori-app: lo corre el CI (job «Gate») y lo corre cada sesión antes de abrir el PR.
#   bash scripts/ci/gate.sh
# Cada paso escribe su log completo a un archivo temporal; a pantalla va solo el nombre del paso y, si falla, las
# líneas de falla. Última línea (copiarla tal cual en el trailer `Verificado:`):
#   GATE: PASS sha=<8> tests=<n> lint=<n>/<tope> build=ok
#   GATE: FAIL paso=<nombre> sha=<8>      (y exit 1; también si no se pudo leer el conteo de tests o de lint: paso=vitest-conteo / lint-conteo)
# Variables: GATE_SKIP_INSTALL=1 salta `npm ci` (dependencias ya instaladas); GATE_PASOS_EXTRA="nombre:comando" agrega
# un paso al final; GATE_LOGS=<dir> fija dónde van los logs; GATE_ROOT=<dir> corre el gate en otra carpeta (pruebas).
# En el CI de un PR: GATE_SHA = cabeza del PR (el commit que se revisa, no el de fusión), GATE_BASE = base de las
# guardas R04/R14/R16 (en un PR del CI se calcula sola: HEAD^1 de la fusión) y GATE_LABELS = etiquetas del PR (excepción `ok-dueno-edge`). Sin GATE_BASE, la base es el merge-base con origin/main.
set -euo pipefail

cd "${GATE_ROOT:-$(dirname "${BASH_SOURCE[0]}")/../..}"
if [ -n "${GATE_SHA:-}" ]; then SHA="${GATE_SHA:0:8}"; else SHA="$(git rev-parse --short=8 HEAD 2>/dev/null || echo desconocido)"; fi
# CI de un PR: HEAD es la fusión del PR con la cabeza actual de main, y su primer padre es esa cabeza. Esa es la base (no el
# base.sha del evento, que queda viejo si main avanzó y haría pasar por del PR lo que entró a main después).
if [ -z "${GATE_BASE:-}" ] && [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then GATE_BASE="$(git rev-parse HEAD^1 2>/dev/null || true)"; fi
export GATE_BASE="${GATE_BASE:-}" GATE_LABELS="${GATE_LABELS:-}"
LOGS="${GATE_LOGS:-$(mktemp -d "${TMPDIR:-/tmp}/gate.XXXXXX")}"
mkdir -p "$LOGS"
export NO_COLOR=1 FORCE_COLOR=0
TESTS="?"; LINT="?"; TOPE="?"; BUILD="?"

fallar() { # $1 = paso, $2 = log
  echo "--- líneas de falla ($1) · log completo: $2"
  case "$1" in
    vitest)
      grep -E '^\s*(FAIL|×|✗|AssertionError|Error:)|Test Files|Tests ' "$2" | head -60 || true ;;
    lint)
      # primeras 60 líneas + todo error (archivo y línea del formato stylish, y los ::error), aunque pasen de las 60
      grep -vE '^\s*$' "$2" | head -60 || true
      echo "--- errores (archivo · línea) y ::error de todo el log"
      awk '/^[^ \t]/ {arch=$0; dicho=0} /^[ \t]+[0-9]+:[0-9]+[ \t]+error[ \t]/ {if(!dicho){print arch; dicho=1} print} /^::error/ {print}' "$2" | head -80 || true ;;
    *)
      grep -iE 'error|fail|✘|TS[0-9]+|diagn' "$2" | head -40 || tail -20 "$2" ;;
  esac
  echo "GATE: FAIL paso=$1 sha=$SHA"
  exit 1
}

paso() { # $1 = nombre, resto = comando
  local nombre="$1"; shift
  local log="$LOGS/$nombre.log"
  echo "== $nombre"
  if ! "$@" >"$log" 2>&1; then fallar "$nombre" "$log"; fi
}

# Guardas del diff del PR contra su base (R04 supabase/functions, R14 migraciones existentes). Baratas: van primero.
paso guardas-pr node scripts/ci/guardas-pr.mjs
# (19-nov) La línea de resultado de las guardas va a PANTALLA, no solo al log: si se saltaron por no tener base (sin origin/main)
# se ve acá. En el CI de un PR eso ya es FAIL dentro de guardas-pr.mjs.
grep -E '^guardas-pr:' "$LOGS/guardas-pr.log" | sed 's/^/   /' || true

if [ "${GATE_SKIP_INSTALL:-0}" != "1" ]; then
  paso npm-ci npm ci
  paso club-web-npm-ci npm ci --prefix club-web
fi

paso tsc npx tsc -b

export VITE_APP_ENV=production
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://proyecto-ficticio.supabase.co}"
export VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-clave-ficticia-solo-ci}"
paso build npx vite build
BUILD=ok

# El bundle de producción no lleva diagnóstico de staging (mismo chequeo que deploy.yml). grep: 0 = encontró = mal.
echo "== anti-diagnostico"
ANTI="$LOGS/anti-diagnostico.log"
set +e
grep -rlE "armBootHang|__satoriDiag|boot-hang|realtimeReproSwitch" dist/ >"$ANTI" 2>&1
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  echo "El build de producción trae código de diagnóstico de staging:" >>"$ANTI"
  fallar anti-diagnostico "$ANTI"
elif [ "$RC" -ne 1 ]; then
  fallar anti-diagnostico "$ANTI"
fi

# Todas las pruebas del repo, incluidas las de club-web (vitest vive en la raíz).
paso vitest npx vitest run
TESTS="$(sed -nE 's/^\s*Tests\s+.*[^0-9]([0-9]+) passed.*/\1/p;s/^\s*Tests\s+([0-9]+) passed.*/\1/p' "$LOGS/vitest.log" | tail -1)"
TESTS="${TESTS:-?}"
if [ "$TESTS" = "?" ]; then # sin conteo no hay PASS: puede ser que vitest cambió su formato o no corrió nada
  echo "No se pudo leer «Tests N passed» del log de vitest ($LOGS/vitest.log)."
  echo "GATE: FAIL paso=vitest-conteo sha=$SHA"; exit 1
fi

# Lint contra la línea base (falla solo si la cantidad sube).
paso lint node scripts/ci/lint-linea-base.mjs
LINT="$(sed -nE 's/^eslint: ([0-9]+) problemas.*/\1/p' "$LOGS/lint.log" | tail -1)"
TOPE="$(sed -nE 's/.*línea base: ([0-9]+).*/\1/p' "$LOGS/lint.log" | tail -1)"
if [ -z "$LINT" ] || [ -z "$TOPE" ]; then
  echo "No se pudo leer «eslint: N problemas … línea base: M» del log de lint ($LOGS/lint.log)."
  echo "GATE: FAIL paso=lint-conteo sha=$SHA"; exit 1
fi

paso club-web-build env VITE_CLUB_URL=https://club.ejemplo.com npm run build --prefix club-web

# Pasos extra "nombre:comando" separados por ';' (solo para probar el propio gate).
if [ -n "${GATE_PASOS_EXTRA:-}" ]; then
  IFS=';' read -ra EXTRAS <<<"$GATE_PASOS_EXTRA"
  for e in "${EXTRAS[@]}"; do
    paso "${e%%:*}" bash -c "${e#*:}"
  done
fi

echo "GATE: PASS sha=$SHA tests=$TESTS lint=$LINT/$TOPE build=$BUILD"
