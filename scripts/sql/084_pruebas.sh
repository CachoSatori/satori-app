#!/usr/bin/env bash
# Pruebas de la 084 (SAL-AUD-01, diseño de dos tablas) — SOLO STAGING, sin falsos verdes (mismo esquema que la 085).
#
# Uso: SUPABASE_ACCESS_TOKEN=… scripts/sql/084_pruebas.sh hwiatgicyyqyezqwldia <CON|SIN>
#   CON  la 084 está aplicada (se chequea antes). Cada rol con su resultado ESPERADO:
#        · owner y contador: ven tarifa y banco; guardan tarifa y banco.
#        · manager: ve la tarifa, NO el banco; guardar tarifa o banco → 42501.
#        · manager inactivo, cajero, salonero: no ven nada; guardar → 42501.
#        · tarifa escrita en employees → 23514 (CHECK). anon → 42501 en las dos tablas.
#   SIN  demuestra que sin el arreglo las pruebas de seguridad FALLAN: cada caso aplica 084_rollback.sql dentro de su
#        transacción descartada (la planilla vuelve a employees) y corre las mismas lecturas. Se espera que el
#        manager VEA el banco y el cajero VEA la tarifa (las dos pruebas «manager no lee banco» y «cajero no lee
#        tarifas» fallan). Verde en este modo = las dos fallas aparecen.
# Cada caso corre en una transacción con ROLLBACK, con un empleado SINTÉTICO (datos inventados). Los errores se
# capturan por SQLSTATE dentro de la transacción; nunca se imprime el detalle de un error (puede traer una fila).
# Salida: 0 = verde · 1 = falla · 2 = uso.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?Falta SUPABASE_ACCESS_TOKEN}"
REF=${1:?Uso: $0 <REF de staging> <CON|SIN>}; MODO=${2:?Falta el modo: CON o SIN}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging (Salarios no está en prod)." >&2; exit 2; }
case $MODO in CON|SIN) ;; *) echo "modo inválido: $MODO" >&2; exit 2;; esac
RAIZ=$(git rev-parse --show-toplevel)
API="https://api.supabase.com/v1/projects/$REF/database/query"
q() {
  local body
  body=$(jq -n --arg q "$1" '{query:$q}' | curl -sS --fail-with-body -X POST "$API" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-) || {
    echo "ERROR de la API: $(jq -r '.message? // .' <<<"$body" 2>/dev/null | head -1 | sed -E 's/DETAIL:.*//' | head -c 160)" >&2; return 1; }
  jq -e 'type == "array"' >/dev/null <<<"$body" || { echo "ERROR: no es un arreglo" >&2; return 1; }
  echo "$body"
}
echo "084_pruebas · $(TZ=America/Costa_Rica date '+%Y-%m-%d %H:%M CR') · REF=$REF · MODO=$MODO · script @ $(git -C "$RAIZ" rev-parse --short HEAD)"

# ── el estado de la base tiene que ser el de la 084 aplicada (en los dos modos: SIN la deshace adentro) ──
EST=$(q "select json_build_object('payroll', to_regclass('public.employee_payroll') is not null,
  'bank', to_regclass('public.employee_bank_info') is not null,
  'check', exists (select 1 from pg_constraint where conname = 'employees_planilla_en_employee_payroll')) as e" | jq -c '.[0].e')
[ "$EST" = '{"payroll":true,"bank":true,"check":true}' ] || { echo "FALLA la base no tiene la 084 (nueva) aplicada: $EST. No se corre nada."; exit 1; }

RB=""; [ "$MODO" = SIN ] && RB=$(grep -viE '^\s*(begin|commit)\s*;\s*$' "$RAIZ/scripts/sql/084_rollback.sql")
PID=$(q "select id from public.profiles where role <> 'owner' order by created_at limit 1" | jq -r '.[0].id // empty')
[ -n "$PID" ] || { echo "FALLA no hay perfil para simular"; exit 1; }
ID='00000000-0000-4000-8000-000000000084'
# Sembrado (como postgres): con la 084, en las tablas nuevas; sin ella (SIN, después del rollback), en employees.
if [ "$MODO" = CON ]; then
  SEMILLA="insert into public.employees (id, full_name, role, is_active) values ('$ID', 'EMPLEADO SINTETICO 084', 'cocina', true);
    insert into public.employee_payroll (employee_id, hourly_rate_crc, fixed_salary_crc) values ('$ID', 12345, 50000);
    insert into public.employee_bank_info (employee_id, nombre_homebanking) values ('$ID', 'BENEFICIARIO SINTETICO');"
else
  SEMILLA="$RB
    insert into public.employees (id, full_name, role, is_active, hourly_rate_crc, fixed_salary_crc, nombre_homebanking)
      values ('$ID', 'EMPLEADO SINTETICO 084', 'cocina', true, 12345, 50000, 'BENEFICIARIO SINTETICO');"
fi
SEMILLA="$SEMILLA
  create temp table r (k text, v text) on commit drop; grant all on r to authenticated;"
sim() { echo "set local session_replication_role = replica; update public.profiles set role = '$1', is_active = $2 where id = '$PID';
  set local session_replication_role = origin; set local role authenticated;
  select set_config('request.jwt.claims', '{\"sub\":\"$PID\",\"role\":\"authenticated\"}', true);"; }
# Lo que el rol VE del sintético, esté donde esté la planilla (tablas nuevas o employees), y si puede guardar.
LEE="do \$\$ declare v boolean; begin
  v := false;
  if to_regclass('public.employee_payroll') is not null then
    execute 'select exists (select 1 from public.employee_payroll where employee_id = ''$ID'' and hourly_rate_crc = 12345)' into v; end if;
  v := v or exists (select 1 from public.employees where id = '$ID' and hourly_rate_crc = 12345);
  insert into r values ('ve_tarifa', v::text);
  v := false;
  if to_regclass('public.employee_bank_info') is not null then
    execute 'select exists (select 1 from public.employee_bank_info where employee_id = ''$ID'' and nombre_homebanking is not null)' into v; end if;
  v := v or exists (select 1 from public.employees where id = '$ID' and nombre_homebanking is not null);
  insert into r values ('ve_banco', v::text);
end \$\$;
do \$\$ declare n int; begin
  if to_regclass('public.employee_payroll') is null then insert into r values ('guarda_tarifa', 'n/a'); return; end if;
  -- EXECUTE no actualiza FOUND (PL/pgSQL): se mide con GET DIAGNOSTICS. 0 filas = la RLS no lo dejó.
  execute 'update public.employee_payroll set hourly_rate_crc = 999 where employee_id = ''$ID''';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'sin filas' using errcode = '42501'; end if;
  insert into r values ('guarda_tarifa', 'ok');
exception when others then insert into r values ('guarda_tarifa', sqlstate); end \$\$;
do \$\$ begin
  if to_regclass('public.employee_bank_info') is null then insert into r values ('guarda_banco', 'n/a'); return; end if;
  execute 'insert into public.employee_bank_info (employee_id, nombre_homebanking) values (''$ID'', ''OTRO'')
           on conflict (employee_id) do update set nombre_homebanking = excluded.nombre_homebanking';
  insert into r values ('guarda_banco', 'ok');
exception when others then insert into r values ('guarda_banco', sqlstate); end \$\$;
reset role; select json_object_agg(k, v) as x from r;"
corre() { q "begin; $SEMILLA $(sim "$1" "$2") $LEE rollback;" | jq -c '.[-1].x' 2>/dev/null || echo ""; }

ok=0; fallas=0
compara() { if [ -n "$3" ] && [ "$(jq -cS . <<<"$2")" = "$(jq -cS . <<<"$3")" ]; then echo "OK    $1"; ok=$((ok+1)); else echo "FALLA $1"; echo "      esperado: $2"; echo "      obtenido: $3"; fallas=$((fallas+1)); fi; }

if [ "$MODO" = CON ]; then
  TODO='{"ve_tarifa":"true","ve_banco":"true","guarda_tarifa":"ok","guarda_banco":"ok"}'
  NADA='{"ve_tarifa":"false","ve_banco":"false","guarda_tarifa":"42501","guarda_banco":"42501"}'
  compara "owner activo"     "$TODO" "$(corre owner true)"
  compara "contador activo"  "$TODO" "$(corre contador true)"
  compara "manager activo: ve tarifa, NO banco, no guarda" '{"ve_tarifa":"true","ve_banco":"false","guarda_tarifa":"42501","guarda_banco":"42501"}' "$(corre manager true)"
  compara "manager inactivo" "$NADA" "$(corre manager false)"
  compara "cajero activo"    "$NADA" "$(corre cajero true)"
  compara "salonero activo"  "$NADA" "$(corre salonero true)"
  r=$(q "begin; $SEMILLA do \$\$ begin update public.employees set hourly_rate_crc = 1 where id = '$ID'; insert into r values ('x', 'ok');
         exception when others then insert into r values ('x', sqlstate); end \$\$; select (select v from r where k = 'x') as x; rollback;" | jq -r '.[-1].x') || r=""
  compara "tarifa escrita en employees → 23514 (CHECK)" '"23514"' "\"$r\""
  for t in employee_payroll employee_bank_info; do
    r=$(q "begin; create temp table r (k text, v text) on commit drop; grant all on r to anon; set local role anon;
           do \$\$ begin perform count(*) from public.$t; insert into r values ('x', 'lee'); exception when others then insert into r values ('x', sqlstate); end \$\$;
           reset role; select (select v from r where k = 'x') as x; rollback;" | jq -r '.[-1].x') || r=""
    compara "anon en $t → 42501" '"42501"' "\"$r\""
  done
else
  r=$(corre manager true); m=$(jq -r '.ve_banco' <<<"$r" 2>/dev/null || echo "")
  if [ "$m" = true ]; then echo "OK    sin la 084, el manager VE el banco → la prueba «manager no lee banco» FALLA, como se espera"; ok=$((ok+1))
  else echo "FALLA sin la 084 se esperaba que el manager viera el banco (obtenido: $r)"; fallas=$((fallas+1)); fi
  r=$(corre cajero true); c=$(jq -r '.ve_tarifa' <<<"$r" 2>/dev/null || echo "")
  if [ "$c" = true ]; then echo "OK    sin la 084, el cajero VE la tarifa → la prueba «cajero no lee tarifas» FALLA, como se espera"; ok=$((ok+1))
  else echo "FALLA sin la 084 se esperaba que el cajero viera la tarifa (obtenido: $r)"; fallas=$((fallas+1)); fi
fi

# Al terminar, el estado sigue como al empezar (todo se descartó).
FIN=$(q "select json_build_object('payroll', to_regclass('public.employee_payroll') is not null,
  'bank', to_regclass('public.employee_bank_info') is not null,
  'check', exists (select 1 from pg_constraint where conname = 'employees_planilla_en_employee_payroll'),
  'sintetico', (select count(*) from public.employees where id = '$ID')) as e" | jq -c '.[0].e')
compara "al terminar: la 084 sigue puesta y no quedó el sintético" '{"payroll":true,"bank":true,"check":true,"sintetico":0}' "$FIN"
echo "── Resultado ($MODO): $ok OK · $fallas FALLA ──"
[ "$fallas" -eq 0 ] && echo VERDE || { echo "NO VERDE"; exit 1; }
