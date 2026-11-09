#!/usr/bin/env bash
# Pruebas de la 092 (R7-01) — SOLO STAGING, cada caso en una transacción que termina en ROLLBACK (no deja nada).
# Sin falsos verdes: cada caso tiene su resultado esperado; los errores se capturan por SQLSTATE dentro de la
# transacción y NUNCA se imprime el detalle de un error (puede traer la fila de un perfil).
# Uso: SUPABASE_ACCESS_TOKEN=… scripts/sql/092_pruebas.sh hwiatgicyyqyezqwldia
# Salida: 0 = verde · 1 = falla · 2 = uso.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN}"
REF=${1:?Uso: $0 <REF de staging>}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging. Nada en prod." >&2; exit 2; }
RAIZ=$(git rev-parse --show-toplevel)
MIG=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/supabase/migrations/092_employees_borrado_solo_owner.sql")
RB=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/scripts/sql/092_rollback.sql")
API="https://api.supabase.com/v1/projects/$REF/database/query"
q() {
  local body
  body=$(jq -n --arg q "$1" '{query:$q}' | curl -sS --fail-with-body -X POST "$API" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-) || {
    echo "ERROR de la API: $(jq -r '.message? // .' <<<"$body" 2>/dev/null | head -1 | sed -E 's/DETAIL:.*//' | head -c 160)" >&2; return 1; }
  jq -e 'type == "array"' >/dev/null <<<"$body" || { echo "ERROR: no es un arreglo" >&2; return 1; }
  echo "$body"
}
echo "092_pruebas · $(TZ=America/Costa_Rica date '+%Y-%m-%d %H:%M CR') · REF=$REF · script @ $(git -C "$RAIZ" rev-parse --short HEAD)"
PID=$(q "select id from public.profiles where role <> 'owner' order by created_at limit 1" | jq -r '.[0].id // empty')
[ -n "$PID" ] || { echo "FALLA no hay perfil para simular"; exit 1; }
E1='00000000-0000-4000-8000-000000000921'; E2='00000000-0000-4000-8000-000000000922'
SEMILLA="insert into public.employees (id, full_name, role, is_active, pos_login) values ('$E1', 'EMPLEADO SINTETICO 092 A', 'salonero', true, '9921');
         insert into public.employees (id, full_name, role, is_active) values ('$E2', 'EMPLEADO SINTETICO 092 B', 'salonero', true);
         create temp table r (k text, v text) on commit drop; grant all on r to authenticated;"
sim() { # $1 rol · $2 activo
  echo "set local session_replication_role = replica; update public.profiles set role = '$1', is_active = $2 where id = '$PID';
        set local session_replication_role = origin; set local role authenticated;
        select set_config('request.jwt.claims', '{\"sub\":\"$PID\",\"role\":\"authenticated\"}', true);"
}
intenta() { # $1 id a borrar → guarda en r: estado (ok | <sqlstate>) y filas borradas
  echo "do \$\$ declare n int; begin
          delete from public.employees where id = '$1'; get diagnostics n = row_count;
          insert into r values ('borrar', 'ok'), ('filas', n::text);
        exception when others then insert into r values ('borrar', sqlstate), ('filas', '0'); end \$\$;"
}
LEE="reset role; select set_config('request.jwt.claims', '', true);
     select json_build_object('borrar', (select v from r where k = 'borrar'), 'filas', (select v from r where k = 'filas')::int,
       'bajas', (select count(*) from public.employee_bajas), 'bajas_con_autor', (select count(*) from public.employee_bajas where borrado_por is not null)) as x;"
ok=0; fallas=0
compara() { if [ -n "$3" ] && [ "$(jq -cS . <<<"$2")" = "$(jq -cS . <<<"$3")" ]; then echo "OK    $1"; ok=$((ok+1)); else echo "FALLA $1"; echo "      esperado: $2"; echo "      obtenido: $3"; fallas=$((fallas+1)); fi; }
caso() { # $1 etiqueta · $2 sesión · $3 id · $4 esperado
  local r; r=$(q "begin; $MIG $SEMILLA $2 $(intenta "$3") $LEE rollback;" | jq -c '.[-1].x') || r=""
  compara "$1" "$4" "$r"
}
caso "manager borra un empleado CON login → 42501, nada borrado"   "$(sim manager true)" "$E1" '{"borrar":"42501","filas":0,"bajas":0,"bajas_con_autor":0}'
caso "manager borra un empleado SIN login → se borra, con rastro"   "$(sim manager true)" "$E2" '{"borrar":"ok","filas":1,"bajas":1,"bajas_con_autor":1}'
caso "owner borra un empleado con login → se borra, con rastro"     "$(sim owner true)"   "$E1" '{"borrar":"ok","filas":1,"bajas":1,"bajas_con_autor":1}'
caso "owner INACTIVO → la RLS no lo deja (0 filas)"                 "$(sim owner false)"  "$E1" '{"borrar":"ok","filas":0,"bajas":0,"bajas_con_autor":0}'
caso "cajero → la RLS no lo deja (0 filas)"                         "$(sim cajero true)"  "$E1" '{"borrar":"ok","filas":0,"bajas":0,"bajas_con_autor":0}'
caso "canal admin (sin JWT) → se borra, rastro sin autor"           ""                    "$E1" '{"borrar":"ok","filas":1,"bajas":1,"bajas_con_autor":0}'
r=$(q "begin; $MIG set local role anon; do \$\$ begin perform count(*) from public.employee_bajas; raise exception 'leyó' using errcode = 'P0001';
       exception when insufficient_privilege then raise notice 'ok'; end \$\$; select 'sin_permiso' as x; rollback;" | jq -r '.[-1].x') || r=""
compara "anon no lee employee_bajas (42501)" '"sin_permiso"' "\"$r\""
r=$(q "begin; $MIG $RB select json_build_object('tabla', to_regclass('public.employee_bajas') is null,
       'trigger', not exists (select 1 from pg_trigger where tgname = 'trg_employees_borrado_guardia'),
       'funcion', to_regprocedure('public.employees_borrado_guardia()') is null) as x; rollback;" | jq -c '.[-1].x') || r=""
compara "rollback: sin tabla, sin trigger, sin función" '{"tabla":true,"trigger":true,"funcion":true}' "$r"
echo "── Resultado: $ok OK · $fallas FALLA ──"
[ "$fallas" -eq 0 ] && echo VERDE || { echo "NO VERDE"; exit 1; }
