#!/usr/bin/env bash
# Pruebas de la 085 (SEC-01c: las lecturas «para todos» exigen rol activo) — SIN FALSOS VERDES (Grok 87).
#
# Cada caso tiene un resultado ESPERADO calculado de antes (conteos como postgres + la regla de cada policy) y se
# compara con lo que devuelve la base con la sesión simulada. Un caso que no se puede correr NO es verde: cuenta como
# «NO PROBADO» y el script termina con error.
#
# Matriz:
#   · los 10 roles (owner, manager, contador, cajero, salonero, barman, barback, runner, cocina, proveedor),
#     ACTIVOS e INACTIVOS (en staging se simulan sobre un perfil de prueba, dentro de una transacción descartada);
#   · rol NULL (la columna es NOT NULL: se espera que la base lo rechace);
#   · perfil ausente (un JWT de alguien sin fila en profiles);
#   · anon y service_role;
#   · catálogo: las 7 policies con su condición nueva.
#
# STAGING (hwiatgicyyqyezqwldia): matriz completa; todo en transacciones que terminan en ROLLBACK.
# PROD (yiczgdtirrkdvohdquzf): SOLO LECTURA. No escribe nada: los roles se prueban solo con cuentas activas que existan
#   (las simulaciones e inactivos quedan «NO PROBADO» → salida 3, nunca verde).
#
# Salida: 0 = todo verde · 1 = alguna FALLA · 3 = sin fallas pero con casos NO PROBADOS · 2 = error de uso.
# Uso: SUPABASE_ACCESS_TOKEN=… scripts/sql/085_pruebas.sh <REF>
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN (token de la Management API)}"
REF=${1:?Uso: $0 <REF>}
case $REF in
  hwiatgicyyqyezqwldia) MODO=staging; echo "REF=$REF (STAGING) · matriz completa, todo descartado" >&2;;
  yiczgdtirrkdvohdquzf) MODO=prod;    echo "REF=$REF (PROD) · solo lectura" >&2;;
  *) echo "ref desconocido: $REF" >&2; exit 2;;
esac
command -v jq >/dev/null || { echo "falta jq" >&2; exit 2; }

API="https://api.supabase.com/v1/projects/$REF/database/query"
# q: la consulta tiene que responder 2xx y un arreglo JSON; si no, corta (curl --fail-with-body).
q() {
  local body
  body=$(jq -n --arg q "$1" '{query:$q}' | curl -sS --fail-with-body -X POST "$API" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-) || {
    echo "ERROR de la API: $body" >&2; return 1; }
  echo "$body" | jq -e 'type == "array"' >/dev/null || { echo "ERROR: respuesta no es un arreglo: $body" >&2; return 1; }
  echo "$body"
}
# q_crudo: para los casos donde el ERROR es el resultado esperado (no corta; devuelve el cuerpo tal cual).
q_crudo() {
  jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "$API" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @- || true
}

ROLES=(owner manager contador cajero salonero barman barback runner cocina proveedor)
VE_TODO=(owner manager)          # «Owners y managers …»: ven todos los empleados y todos los perfiles
AUSENTE='00000000-0000-4000-8000-0000000085aa'

LECTURA="select json_build_object(
  'employees',       (select count(*) from public.employees),
  'tip_entries',     (select count(*) from public.tip_entries),
  'tip_sessions',    (select count(*) from public.tip_sessions),
  'role_tip_points', (select count(*) from public.role_tip_points),
  'exchange_rates',  (select count(*) from public.exchange_rates),
  'profiles',        (select count(*) from public.profiles)) as r"

# ── Verdad de base (como postgres) ────────────────────────────────────────────────────────────
G=$(q "select json_build_object(
  'emp_all', (select count(*) from public.employees),
  'emp_act', (select count(*) from public.employees where is_active),
  'te', (select count(*) from public.tip_entries), 'ts', (select count(*) from public.tip_sessions),
  'rtp', (select count(*) from public.role_tip_points), 'er', (select count(*) from public.exchange_rates),
  'prof', (select count(*) from public.profiles)) as g" | jq -c '.[0].g')
echo "Base (postgres): $G"
# Sin datos, un 0 = 0 no prueba nada: se exige que haya filas en cada tabla.
if echo "$G" | jq -e 'to_entries | map(select(.value == 0)) | length > 0' >/dev/null; then
  echo "FALLA alguna tabla está vacía: los conteos no distinguirían «ve» de «no ve» ($G)"; exit 1
fi
if [ "$(echo "$G" | jq '.emp_all == .emp_act')" = true ]; then
  echo "AVISO: no hay empleados inactivos; «owner/manager ven todos» y «el resto ve activos» darán el mismo número" >&2
fi

ok=0; fallas=0; noprob=0
verde()   { echo "OK          $1"; ok=$((ok+1)); }
falla()   { echo "FALLA       $1"; echo "            esperado: $2"; echo "            obtenido: $3"; fallas=$((fallas+1)); }
noprobado() { echo "NO PROBADO  $1 — $2"; noprob=$((noprob+1)); }
compara() { # $1 etiqueta · $2 esperado (json) · $3 obtenido (json)
  if [ -n "$3" ] && [ "$(jq -cS . <<<"$2")" = "$(jq -cS . <<<"$3")" ]; then verde "$1"; else falla "$1" "$2" "$3"; fi
}
esperado() { # $1 rol · $2 activo (true|false) · $3 escribe (true|false: si el caso mide la escritura)
  local todo=false; for r in "${VE_TODO[@]}"; do [ "$1" = "$r" ] && todo=true; done
  jq -cn --argjson g "$G" --arg rol "$1" --argjson act "$2" --argjson todo "$todo" --argjson esc "$3" '
    (if $act then {
        employees: (if $todo then $g.emp_all else $g.emp_act end),
        tip_entries: $g.te, tip_sessions: $g.ts, role_tip_points: $g.rtp, exchange_rates: $g.er,
        profiles: (if $todo then $g.prof else 1 end) }
     else { employees: 0, tip_entries: 0, tip_sessions: 0, role_tip_points: 0, exchange_rates: 0, profiles: 1 } end)
    + (if $esc then { edita_otro_perfil: (if $act and $rol == "owner" then 1 else 0 end) } else {} end)'
}
como() { echo "set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', true);"; }

# ── Catálogo: las 7 policies con su condición nueva ───────────────────────────────────────────
CAT=$(q "select count(*) filter (where (tablename, policyname) in (
    ('employees','Todos ven empleados activos'), ('tip_entries','Todos ven entradas de propinas'),
    ('tip_sessions','Todos ven sesiones de propinas'), ('role_tip_points','Todos ven puntos por rol'),
    ('exchange_rates','Todos ven tipos de cambio'), ('exchange_rates','exchange_rates_read'))
    and qual ~* 'get_my_role\\(\\) is not null') as lecturas,
  count(*) filter (where tablename = 'profiles' and policyname = 'Solo owners crean/editan perfiles'
    and with_check is not null and with_check ~* 'owner') as profiles_check
  from pg_policies where schemaname = 'public'" | jq -c '.[0]')
compara "catálogo: 6 lecturas con «get_my_role() is not null» + WITH CHECK de profiles" '{"lecturas":6,"profiles_check":1}' "$CAT"

# ── Roles activos e inactivos ─────────────────────────────────────────────────────────────────
if [ "$MODO" = staging ]; then
  # Perfil de prueba para simular cada rol: uno que no sea owner (si se corrompe algo, la transacción se descarta igual).
  PID=$(q "select id from public.profiles where role <> 'owner' order by created_at limit 1" | jq -r '.[0].id // empty')
  OTRO=$(q "select id from public.profiles where id <> '${PID:-x}' order by created_at limit 1" | jq -r '.[0].id // empty')
  [ -n "$PID" ] && [ -n "$OTRO" ] || { echo "FALLA no hay perfiles para simular"; exit 1; }
  for rol in "${ROLES[@]}"; do
    for act in true false; do
      etiqueta="$rol $( [ $act = true ] && echo activo || echo inactivo )"
      r=$(q "begin;
        set local session_replication_role = replica;
        update public.profiles set role = '$rol', is_active = $act where id = '$PID';
        set local session_replication_role = origin;
        $(como "$PID")
        with u as (update public.profiles set full_name = full_name where id = '$OTRO' returning 1)
        select (($LECTURA)::jsonb || jsonb_build_object('edita_otro_perfil', (select count(*) from u)))::json as r;
        rollback;" | jq -c '.[-1].r') || r=""
      compara "$etiqueta" "$(esperado "$rol" "$act" true)" "$r"
    done
  done
  # rol NULL: la columna es NOT NULL → la base tiene que rechazarlo (23502). Si lo aceptara, se prueba que no vea nada.
  cuerpo=$(q_crudo "begin; set local session_replication_role = replica;
    update public.profiles set role = null where id = '$PID'; rollback;")
  if grep -qiE 'null value in column|23502|violates not-null' <<<"$cuerpo"; then
    verde "rol NULL: la base lo rechaza (profiles.role es NOT NULL)"
  else
    r=$(q "begin; set local session_replication_role = replica;
      update public.profiles set role = null where id = '$PID'; set local session_replication_role = origin;
      $(como "$PID") select ($LECTURA) as r; rollback;" | jq -c '.[-1].r') || r=""
    compara "rol NULL (la base lo aceptó): no ve nada salvo su perfil" "$(esperado salonero false false)" "$r"
  fi
else
  for rol in "${ROLES[@]}"; do
    id=$(q "select id from public.profiles where role = '$rol' and is_active order by created_at limit 1" | jq -r '.[0].id // empty')
    if [ -z "$id" ]; then noprobado "$rol activo" "no hay cuenta activa en prod (y en prod no se simula)"; continue; fi
    r=$(q "begin; $(como "$id") select ($LECTURA) as r; rollback;" | jq -c '.[-1].r') || r=""
    compara "$rol activo" "$(esperado "$rol" true false)" "$r"
  done
  for rol in "${ROLES[@]}"; do noprobado "$rol inactivo" "en prod no se simula (escribe); se prueba en staging"; done
  noprobado "rol NULL" "en prod no se simula (escribe); se prueba en staging"
fi

# ── Perfil ausente, anon y service_role (solo lectura en los dos entornos) ────────────────────
r=$(q "begin; $(como "$AUSENTE") select ($LECTURA) as r; rollback;" | jq -c '.[-1].r') || r=""
compara "perfil ausente (JWT sin fila en profiles)" \
  '{"employees":0,"tip_entries":0,"tip_sessions":0,"role_tip_points":0,"exchange_rates":0,"profiles":0}' "$r"

# anon: 0 filas en cada tabla, o «permission denied» (sin grant). Cualquier otra cosa es falla.
for t in employees tip_entries tip_sessions role_tip_points exchange_rates profiles; do
  cuerpo=$(q_crudo "begin; set local role anon; select count(*) as n from public.$t; rollback;")
  n=$(jq -r 'if type=="array" then (.[-1].n|tostring) else empty end' <<<"$cuerpo" 2>/dev/null || true)
  if [ "$n" = "0" ]; then verde "anon · $t: 0 filas"
  elif grep -qi 'permission denied' <<<"$cuerpo"; then verde "anon · $t: sin permiso"
  else falla "anon · $t" "0 filas o permission denied" "$cuerpo"; fi
done

# service_role: ve TODO (no pasa por RLS).
r=$(q "begin; set local role service_role; select ($LECTURA) as r; rollback;" | jq -c '.[-1].r') || r=""
compara "service_role ve todo" "$(jq -cn --argjson g "$G" '{employees:$g.emp_all, tip_entries:$g.te, tip_sessions:$g.ts, role_tip_points:$g.rtp, exchange_rates:$g.er, profiles:$g.prof}')" "$r"

echo "── Resultado: $ok OK · $fallas FALLA · $noprob NO PROBADO ──"
[ "$fallas" -gt 0 ] && exit 1
[ "$noprob" -gt 0 ] && exit 3
exit 0
