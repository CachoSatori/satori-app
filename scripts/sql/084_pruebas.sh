#!/bin/bash
# Pruebas de la 084 (SAL-AUD-01): una transacción por caso, SIEMPRE rollback, sin nombres reales.
#   SUPABASE_ACCESS_TOKEN=… scripts/sql/084_pruebas.sh hwiatgicyyqyezqwldia   (solo staging)
# En cada caso se crea (como postgres, dentro de la transacción) un empleado SINTÉTICO con tarifa
# 12.345 / 50.000, una fila de banco «BENEFICIARIO SINTETICO» y una tarifa en employee_wage_rates; después,
# con la sesión simulada del rol, se lee y se intenta GUARDAR una tarifa y el banco.
# Esperado DESPUÉS de la 084:
#   · owner y contador activos: tarifas 1 (12345), banco 1, wage_rates 1; guardan tarifa y banco.
#   · manager activo: tarifas 1 (12345), banco 0, wage_rates 1; guardar tarifa → 42501; guardar banco → 42501.
#   · manager inactivo, cajero, salonero: todo 0; guardar → 42501.
#   · TODOS: en employees la tarifa del sintético es 0 (la planilla ya no está ahí).
#   · escribir una tarifa en employees (como postgres) → 23514 (CHECK employees_planilla_en_employee_payroll).
#   · anon: permission denied en employee_payroll y en employee_bank_info.
# En staging no hay cuentas activas de manager ni de contador: se SIMULAN dentro de la transacción
# (una cuenta inactiva se marca activa, con session_replication_role = replica para saltar los
# triggers de la 068) y se descartan con el rollback.
set -euo pipefail
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo "Falta SUPABASE_ACCESS_TOKEN." >&2; exit 2; }
REF=${1:?Uso: $0 <REF>}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging (Salarios no está en prod)." >&2; exit 1; }
q() { jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-; }
uid() { q "select id from public.profiles where role = '$1' and is_active = $2 order by created_at limit 1" | jq -r '.[0].id // empty'; }
ID='00000000-0000-4000-8000-000000000084'
SINT="insert into public.employees (id, full_name, role, is_active) values ('$ID', 'EMPLEADO SINTETICO 084', 'cocina', true);
  insert into public.employee_payroll (employee_id, hourly_rate_crc, fixed_salary_crc) values ('$ID', 12345, 50000);
  insert into public.employee_bank_info (employee_id, nombre_homebanking) values ('$ID', 'BENEFICIARIO SINTETICO');
  insert into public.employee_wage_rates (employee_id, tipo, hourly_rate_crc, efectivo_desde) values ('$ID', 'hora', 12345, '2026-01-01');"
PRUEBA="create temp table r (k text, v text) on commit drop;
  grant all on r to authenticated;"
LEE_Y_ESCRIBE="insert into r select 'tarifas', (select count(*)::text from public.employee_payroll where employee_id = '$ID');
  insert into r select 'tarifa', (select max(hourly_rate_crc)::text from public.employee_payroll where employee_id = '$ID');
  insert into r select 'banco', (select count(*)::text from public.employee_bank_info where employee_id = '$ID');
  insert into r select 'wage_rates', (select count(*)::text from public.employee_wage_rates where employee_id = '$ID');
  insert into r select 'tarifa_en_employees', (select hourly_rate_crc::text from public.employees where id = '$ID');
  do \$\$ begin
    update public.employee_payroll set hourly_rate_crc = 999 where employee_id = '$ID';
    if not found then raise exception 'sin filas' using errcode = '42501'; end if;
    insert into r values ('guarda_tarifa', 'ok');
  exception when others then insert into r values ('guarda_tarifa', sqlstate); end \$\$;
  do \$\$ begin
    insert into public.employee_bank_info (employee_id, nombre_homebanking) values ('$ID', 'OTRO')
      on conflict (employee_id) do update set nombre_homebanking = excluded.nombre_homebanking;
    insert into r values ('guarda_banco', 'ok');
  exception when others then insert into r values ('guarda_banco', sqlstate); end \$\$;
  select json_object_agg(k, v) as resultado from r;"
caso() { # $1 etiqueta, $2 uid, $3 previo como postgres (opcional)
  if [ -z "$2" ]; then printf '%-24s sin cuenta\n' "$1"; return; fi
  printf '%-24s %s\n' "$1" "$(q "begin; $SINT $PRUEBA ${3:-}
    set local role authenticated;
    select set_config('request.jwt.claims', '{\"sub\":\"$2\",\"role\":\"authenticated\"}', true);
    $LEE_Y_ESCRIBE rollback;" | jq -c 'if type=="array" then .[0].resultado else . end' | head -c 300)"
}
SIM=$(uid manager false)
sim() { echo "set local session_replication_role = replica; update public.profiles set role = '$1', is_active = true where id = '$SIM'; set local session_replication_role = origin;"; }
caso "owner activo"          "$(uid owner true)"
caso "contador activo (sim)" "$SIM" "$(sim contador)"
caso "manager activo (sim)"  "$SIM" "$(sim manager)"
caso "manager inactivo"      "$SIM"
caso "cajero activo"         "$(uid cajero true)"
caso "salonero activo"       "$(uid salonero true)"
printf '%-24s %s\n' "check employees" "$(q "begin; $SINT update public.employees set hourly_rate_crc = 1 where id = '$ID'; rollback;" | jq -r 'if type=="array" then "sin error (MAL)" else .message end' | head -c 160)"
printf '%-24s %s\n' "anon tarifas" "$(q "begin; set local role anon; select count(*) from public.employee_payroll; rollback;" | jq -r 'if type=="array" then "lee (MAL)" else .message end' | head -c 120)"
printf '%-24s %s\n' "anon banco" "$(q "begin; set local role anon; select count(*) from public.employee_bank_info; rollback;" | jq -r 'if type=="array" then "lee (MAL)" else .message end' | head -c 120)"
