#!/usr/bin/env bash
# Pruebas de la 085 (SEC-01c: las lecturas «para todos» exigen rol activo) — SIN FALSOS VERDES (Grok 87 + residuales).
#
# Uso: SUPABASE_ACCESS_TOKEN=… scripts/sql/085_pruebas.sh <REF> <MODO> [respaldo.json]
#   MODO = ANTES     la base NO tiene la 085 (catálogo viejo). Espera los resultados de antes.
#          DESPUES   la base SÍ tiene la 085. Espera los resultados nuevos.
#          ROLLBACK  (solo staging) la base tiene la 085; cada caso aplica 085_rollback.sql dentro de su transacción
#                    descartada y espera los resultados de ANTES; además compara las 15 policies con el respaldo.
#   El modo se CHEQUEA contra el catálogo antes de correr nada: si no coincide (p. ej. DESPUES en una base sin la
#   085, o ANTES en una base con la 085), se corta con error. Nunca se corre un modo con los esperados de otro.
#   respaldo.json: obligatorio en ROLLBACK. Se valida por sha256 y por corte (ref, hora de lectura, ledger), no por
#   «el archivo existe».
#
# Cada caso tiene su resultado ESPERADO (conteos como postgres + la regla de cada policy en ese modo) y se compara
# exacto. Los errores se clasifican por SQLSTATE y operación: solo un 42501 «permission denied for table <la tabla>»
# del SELECT de anon cuenta como «sin permiso»; un error de SET ROLE, de red o de otra cosa es FALLA.
#
# STAGING (hwiatgicyyqyezqwldia): matriz completa (10 roles activos e inactivos simulados, rol NULL, perfil ausente,
#   anon, service_role), todo en transacciones con ROLLBACK.
# PROD (el ref sale de SATORI_REF_PROD: regla del dueño del 09-nov, ningún script de prueba tiene escrito el ref de
#   prod; sin esa variable, este script no reconoce prod): SOLO LECTURA (modos ANTES y DESPUES). Lo que no se puede probar sin escribir queda
#   «NO PROBADO» y la salida NUNCA es verde (3).
#
# Salida: 0 = todo verde · 1 = alguna FALLA · 3 = sin fallas pero con NO PROBADOS (no es verde) · 2 = error de uso.
# Log: la salida estándar no tiene secretos (no imprime el token ni datos de personas: solo conteos e ids técnicos).
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN (token de la Management API)}"
REF=${1:?Uso: $0 <REF> <ANTES|DESPUES|ROLLBACK> [respaldo.json]}
MODO=${2:?Falta el modo: ANTES, DESPUES o ROLLBACK}
RESPALDO=${3:-}
case $REF in
  hwiatgicyyqyezqwldia) ENTORNO=staging;;
  "${SATORI_REF_PROD:-__sin_SATORI_REF_PROD__}") ENTORNO=prod;;   # el ref de prod NO se escribe acá (regla del 09-nov)
  *) echo "ref desconocido: $REF" >&2; exit 2;;
esac
case $MODO in ANTES|DESPUES|ROLLBACK) ;; *) echo "modo inválido: $MODO" >&2; exit 2;; esac
[ "$MODO" = ROLLBACK ] && [ "$ENTORNO" != staging ] && { echo "ROLLBACK solo en staging" >&2; exit 2; }
command -v jq >/dev/null || { echo "falta jq" >&2; exit 2; }
RAIZ=$(git rev-parse --show-toplevel)
echo "085_pruebas · $(TZ=America/Costa_Rica date '+%Y-%m-%d %H:%M CR') · REF=$REF ($ENTORNO) · MODO=$MODO · script @ $(git -C "$RAIZ" rev-parse --short HEAD)"

# ── Respaldo del catálogo: hash + corte ───────────────────────────────────────────────────────
RESPALDO_SHA=4db2c15b5847e9b73459ce0a5ef538cdf2ed3293f7d3ec4f27fc5d41bba90b58
if [ "$MODO" = ROLLBACK ]; then
  [ -s "$RESPALDO" ] || { echo "ROLLBACK necesita el respaldo del catálogo (json)" >&2; exit 2; }
  sha=$(sha256sum "$RESPALDO" | cut -d' ' -f1)
  [ "$sha" = "$RESPALDO_SHA" ] || { echo "FALLA el respaldo no es el del paquete (sha256 $sha ≠ $RESPALDO_SHA)"; exit 1; }
  corte=$(jq -c '{ref, leido_utc, n: .ledger.n, ultimo: .ledger.ultimo, pols: (.policies|length)}' "$RESPALDO")
  # el sha256 ya fija el archivo; el ref de prod se compara solo si viene en SATORI_REF_PROD (nunca escrito acá)
  { [ -z "${SATORI_REF_PROD:-}" ] || [ "$(jq -r --arg p "$SATORI_REF_PROD" '.ref|startswith($p)' <<<"$corte")" = true ]; } && [ "$(jq -r .leido_utc <<<"$corte")" = "2026-11-08T15-20-24Z" ] \
    && [ "$(jq -r .n <<<"$corte")" = 55 ] && [ "$(jq -r .ultimo <<<"$corte")" = 080 ] && [ "$(jq -r .pols <<<"$corte")" = 15 ] \
    || { echo "FALLA el corte del respaldo no es el esperado: $corte"; exit 1; }
  echo "Respaldo OK: sha256 ${sha:0:12}… · corte $corte"
fi

API="https://api.supabase.com/v1/projects/$REF/database/query"
# q: 2xx y arreglo JSON, o corta (red, HTTP o SQL inesperado = FALLA, nunca verde).
q() {
  local body
  body=$(jq -n --arg q "$1" '{query:$q}' | curl -sS --fail-with-body -X POST "$API" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-) || {
    echo "ERROR de la API (red o SQL): ${body:0:300}" >&2; return 1; }
  jq -e 'type == "array"' >/dev/null <<<"$body" || { echo "ERROR: respuesta no es un arreglo: ${body:0:300}" >&2; return 1; }
  echo "$body"
}
# q_crudo: para los casos donde un ERROR es el resultado esperado. Devuelve «HTTP<código> <cuerpo>».
q_crudo() {
  jq -n --arg q "$1" '{query:$q}' | curl -sS -o /dev/stdout -w '\nHTTP%{http_code}' -X POST "$API" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @- || echo "HTTP000"
}
sqlstate() { grep -oE 'ERROR:[[:space:]]+[0-9A-Z]{5}' <<<"$1" | head -1 | grep -oE '[0-9A-Z]{5}$' || true; }
# Lo que se imprime de un error: SQLSTATE + la primera línea del mensaje. NUNCA el DETAIL (Postgres pone ahí la fila
# entera, con datos de personas) ni el HINT.
limpio() { jq -r '.message? // .' <<<"${1%HTTP*}" 2>/dev/null | sed -E 's/\\n|\n.*//' | sed -E 's/DETAIL:.*//; s/Failing row contains \([^)]*\)/Failing row contains (…)/' | head -c 220; }

ROLES=(owner manager contador cajero salonero barman barback runner cocina proveedor)
VE_TODO=(owner manager)
AUSENTE='00000000-0000-4000-8000-0000000085aa'
TABLAS=(employees tip_entries tip_sessions role_tip_points exchange_rates profiles)
ROLLBACK_SQL=""
[ "$MODO" = ROLLBACK ] && ROLLBACK_SQL=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/scripts/sql/085_rollback.sql")
# En ANTES y ROLLBACK se espera el comportamiento de antes de la 085; en DESPUES, el nuevo.
REGLA=$([ "$MODO" = DESPUES ] && echo nueva || echo vieja)

LECTURA="select json_build_object(
  'employees',       (select count(*) from public.employees),
  'tip_entries',     (select count(*) from public.tip_entries),
  'tip_sessions',    (select count(*) from public.tip_sessions),
  'role_tip_points', (select count(*) from public.role_tip_points),
  'exchange_rates',  (select count(*) from public.exchange_rates),
  'profiles',        (select count(*) from public.profiles))"

ok=0; fallas=0; noprob=0
verde()     { echo "OK          $1"; ok=$((ok+1)); }
falla()     { echo "FALLA       $1"; echo "            esperado: $2"; echo "            obtenido: $(limpio "$3")"; fallas=$((fallas+1)); }
noprobado() { echo "NO PROBADO  $1 — $2"; noprob=$((noprob+1)); }
compara() { if [ -n "$3" ] && [ "$(jq -cS . <<<"$2" 2>/dev/null)" = "$(jq -cS . <<<"$3" 2>/dev/null)" ]; then verde "$1"; else falla "$1" "$2" "$3"; fi; }

# ── 1. El catálogo está en el estado del modo (si no, no se corre nada) ──────────────────────
LECT6="('employees','Todos ven empleados activos'), ('tip_entries','Todos ven entradas de propinas'),
  ('tip_sessions','Todos ven sesiones de propinas'), ('role_tip_points','Todos ven puntos por rol'),
  ('exchange_rates','Todos ven tipos de cambio'), ('exchange_rates','exchange_rates_read')"
CAT="select json_build_object(
  'nuevas', count(*) filter (where (tablename, policyname) in ($LECT6) and qual ~* 'get_my_role\\(\\) is not null'),
  'viejas', count(*) filter (where (tablename, policyname) in ($LECT6) and qual !~* 'get_my_role'),
  'profiles_check', count(*) filter (where tablename = 'profiles' and policyname = 'Solo owners crean/editan perfiles' and with_check is not null))
  from pg_policies where schemaname = 'public'"
cat_ahora=$(q "$CAT" | jq -c '.[0].json_build_object')
case $MODO in
  ANTES)    esperado_cat='{"nuevas":0,"viejas":6,"profiles_check":0}';;
  DESPUES)  esperado_cat='{"nuevas":6,"viejas":0,"profiles_check":1}';;
  ROLLBACK) esperado_cat='{"nuevas":6,"viejas":0,"profiles_check":1}';;
esac
if [ "$(jq -cS . <<<"$cat_ahora")" != "$(jq -cS . <<<"$esperado_cat")" ]; then
  echo "FALLA el catálogo no está en el estado del modo $MODO: $cat_ahora (se esperaba $esperado_cat). No se corre nada."
  exit 1
fi
verde "catálogo en el estado del modo $MODO: $cat_ahora"
if [ "$MODO" = ROLLBACK ]; then
  cat_rb=$(q "begin; $ROLLBACK_SQL; $CAT; rollback;" | jq -c '.[-1].json_build_object') || cat_rb=""
  compara "con el rollback aplicado (descartado), el catálogo queda en el estado de ANTES" '{"nuevas":0,"viejas":6,"profiles_check":0}' "$cat_rb"
  POL="select coalesce(json_agg(json_build_object('tablename', tablename, 'policyname', policyname, 'permissive', permissive,
         'roles', roles::text, 'cmd', cmd, 'qual', qual, 'with_check', with_check) order by tablename, policyname), '[]') as p
       from pg_policies where schemaname = 'public' and tablename in ('employees','tip_entries','tip_sessions','role_tip_points','exchange_rates','profiles')"
  norm='map({tablename, policyname, permissive, roles, cmd, qual, with_check}) | sort_by(.tablename, .policyname)'
  despues_rb=$(q "begin; $ROLLBACK_SQL; $POL; rollback;" | jq -c ".[-1].p | $norm") || despues_rb=""
  compara "rollback: las 15 policies iguales al respaldo, campo por campo" "$(jq -c ".policies | $norm" "$RESPALDO")" "$despues_rb"
fi

# ── 2. Verdad de base (como postgres) ─────────────────────────────────────────────────────────
G=$(q "select json_build_object(
  'emp_all', (select count(*) from public.employees), 'emp_act', (select count(*) from public.employees where is_active),
  'te', (select count(*) from public.tip_entries), 'ts', (select count(*) from public.tip_sessions),
  'rtp', (select count(*) from public.role_tip_points), 'er', (select count(*) from public.exchange_rates),
  'prof', (select count(*) from public.profiles)) as g" | jq -c '.[0].g')
echo "Base (postgres): $G"
if jq -e 'to_entries | map(select(.value == 0)) | length > 0' >/dev/null <<<"$G"; then
  echo "FALLA alguna tabla está vacía: un 0 no distinguiría «ve» de «no ve» ($G)"; exit 1
fi

esperado() { # $1 rol ('' = sin perfil) · $2 activo · $3 mide la escritura
  local todo=false; for r in "${VE_TODO[@]}"; do [ "$1" = "$r" ] && todo=true; done
  jq -cn --argjson g "$G" --arg rol "$1" --argjson act "$2" --argjson todo "$todo" --argjson esc "$3" --arg regla "$REGLA" '
    ($rol != "") as $perfil | ($perfil and $act) as $conrol |
    {
      employees: (if $conrol and $todo then $g.emp_all
                  elif $regla == "nueva" then (if $conrol then $g.emp_act else 0 end)
                  else $g.emp_act end),
      tip_entries:     (if $regla == "nueva" and ($conrol | not) then 0 else $g.te end),
      tip_sessions:    (if $regla == "nueva" and ($conrol | not) then 0 else $g.ts end),
      role_tip_points: (if $regla == "nueva" and ($conrol | not) then 0 else $g.rtp end),
      exchange_rates:  (if $regla == "nueva" and ($conrol | not) then 0 else $g.er end),
      profiles:        (if $conrol and $todo then $g.prof elif $perfil then 1 else 0 end)
    } + (if $esc then { edita_otro_perfil: (if $conrol and $rol == "owner" then 1 else 0 end) } else {} end)'
}
como() { echo "set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', true);"; }

# ── 3. Roles activos e inactivos ──────────────────────────────────────────────────────────────
if [ "$ENTORNO" = staging ]; then
  PID=$(q "select id from public.profiles where role <> 'owner' order by created_at limit 1" | jq -r '.[0].id // empty')
  OTRO=$(q "select id from public.profiles where id <> '${PID:-x}' order by created_at limit 1" | jq -r '.[0].id // empty')
  [ -n "$PID" ] && [ -n "$OTRO" ] || { echo "FALLA no hay perfiles para simular"; exit 1; }
  for rol in "${ROLES[@]}"; do
    for act in true false; do
      r=$(q "begin;
        $ROLLBACK_SQL
        set local session_replication_role = replica;
        update public.profiles set role = '$rol', is_active = $act where id = '$PID';
        set local session_replication_role = origin;
        $(como "$PID")
        with u as (update public.profiles set full_name = full_name where id = '$OTRO' returning 1)
        select (($LECTURA)::jsonb || jsonb_build_object('edita_otro_perfil', (select count(*) from u)))::json as r;
        rollback;" | jq -c '.[-1].r') || r=""
      compara "$rol $([ "$act" = true ] && echo activo || echo inactivo)" "$(esperado "$rol" "$act" true)" "$r"
    done
  done
  cuerpo=$(q_crudo "begin; set local session_replication_role = replica; update public.profiles set role = null where id = '$PID'; rollback;")
  if [ "$(sqlstate "$cuerpo")" = 23502 ] && grep -qE 'column .{0,2}role.{0,2} of relation .{0,2}profiles' <<<"$cuerpo"; then
    verde "rol NULL: la base lo rechaza (23502 en profiles.role)"
  else
    falla "rol NULL" "23502 not-null en profiles.role" "$cuerpo"
  fi
else
  for rol in "${ROLES[@]}"; do
    id=$(q "select id from public.profiles where role = '$rol' and is_active order by created_at limit 1" | jq -r '.[0].id // empty')
    if [ -z "$id" ]; then noprobado "$rol activo" "no hay cuenta activa en prod y en prod no se simula"; continue; fi
    r=$(q "begin; $(como "$id") select ($LECTURA) as r; rollback;" | jq -c '.[-1].r') || r=""
    compara "$rol activo" "$(esperado "$rol" true false)" "$r"
  done
  for rol in "${ROLES[@]}"; do noprobado "$rol inactivo" "en prod no se simula (escribe); se prueba en staging"; done
  noprobado "rol NULL" "en prod no se simula (escribe); se prueba en staging"
  noprobado "editar otro perfil" "en prod no se prueba (escribe); se prueba en staging"
fi

# ── 4. Perfil ausente, anon y service_role ────────────────────────────────────────────────────
r=$(q "begin; $ROLLBACK_SQL $(como "$AUSENTE") select ($LECTURA) as r; rollback;" | jq -c '.[-1].r') || r=""
compara "perfil ausente (JWT sin fila en profiles)" "$(esperado '' false false)" "$r"

for t in "${TABLAS[@]}"; do
  cuerpo=$(q_crudo "begin; $ROLLBACK_SQL set local role anon; select count(*) as n from public.$t; rollback;")
  http=${cuerpo##*HTTP}; json=${cuerpo%HTTP*}
  if [[ "$http" == 2* ]]; then
    n=$(jq -r 'if type=="array" then (.[-1].n|tostring) else "?" end' <<<"$json" 2>/dev/null || echo "?")
    if [ "$n" = 0 ]; then verde "anon · $t: 0 filas"; else falla "anon · $t" "0 filas o 42501 en el SELECT" "n=$n"; fi
  elif [ "$(sqlstate "$json")" = 42501 ] && grep -qiE "permission denied for (table|relation) $t" <<<"$json"; then
    verde "anon · $t: sin permiso (42501 en el SELECT de $t)"
  else
    falla "anon · $t" "0 filas o 42501 «permission denied for table $t»" "HTTP$http $json"
  fi
done

r=$(q "begin; $ROLLBACK_SQL set local role service_role; select ($LECTURA) as r; rollback;" | jq -c '.[-1].r') || r=""
compara "service_role ve todo" "$(jq -cn --argjson g "$G" '{employees:$g.emp_all, tip_entries:$g.te, tip_sessions:$g.ts, role_tip_points:$g.rtp, exchange_rates:$g.er, profiles:$g.prof}')" "$r"

# ── 5. Después de todo, el catálogo sigue como al empezar (nada quedó aplicado) ───────────────
fin=$(q "$CAT" | jq -c '.[0].json_build_object') || fin=""
compara "al terminar, el catálogo sigue igual que al empezar" "$cat_ahora" "$fin"

echo "── Resultado ($MODO): $ok OK · $fallas FALLA · $noprob NO PROBADO ──"
[ "$fallas" -gt 0 ] && { echo "NO VERDE (fallas)"; exit 1; }
[ "$noprob" -gt 0 ] && { echo "NO VERDE (hay casos no probados)"; exit 3; }
echo "VERDE"
exit 0
