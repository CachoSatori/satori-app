#!/bin/bash
# Pruebas de la 084 (SAL-AUD-01): una transacción por caso, SIEMPRE rollback, sin nombres reales.
#   SUPABASE_ACCESS_TOKEN=… scripts/sql/084_pruebas.sh hwiatgicyyqyezqwldia   (solo staging)
# En cada caso se crea (como postgres, dentro de la transacción) un empleado SINTÉTICO con planilla
# 12.345 / 50.000 / «BENEFICIARIO SINTETICO» y una tarifa en employee_wage_rates; después se lee
# con la sesión simulada del rol.
# Esperado DESPUÉS de la 084:
#   · owner y contador activos: planilla = 1 fila (12345); wage_rates = 1 fila.
#   · manager activo, manager inactivo, cajero, salonero: planilla = 0 filas; wage_rates = 0 filas.
#   · TODOS: en employees, la tarifa del sintético es 0 y el banco null (la planilla ya no está ahí).
#   · escribir una tarifa en employees (como postgres) → 23514 (CHECK employees_planilla_en_employee_payroll).
#   · anon: permission denied en employee_payroll.
set -euo pipefail
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo "Falta SUPABASE_ACCESS_TOKEN." >&2; exit 2; }
REF=${1:?Uso: $0 <REF>}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging (Salarios no está en prod)." >&2; exit 1; }
q() { jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-; }
uid() { q "select id from public.profiles where role = '$1' and is_active = $2 order by created_at limit 1" | jq -r '.[0].id // empty'; }
SINT="insert into public.employees (id, full_name, role, is_active) values ('00000000-0000-4000-8000-000000000083', 'EMPLEADO SINTETICO 084', 'cocina', true);
  insert into public.employee_payroll (employee_id, hourly_rate_crc, fixed_salary_crc, nombre_homebanking)
    values ('00000000-0000-4000-8000-000000000083', 12345, 50000, 'BENEFICIARIO SINTETICO');
  insert into public.employee_wage_rates (employee_id, tipo, hourly_rate_crc, efectivo_desde)
    values ('00000000-0000-4000-8000-000000000083', 'hora', 12345, '2026-01-01');"
LEE="select
  (select count(*) from public.employee_payroll where employee_id = '00000000-0000-4000-8000-000000000083') as planilla,
  (select max(hourly_rate_crc) from public.employee_payroll where employee_id = '00000000-0000-4000-8000-000000000083') as tarifa_planilla,
  (select count(*) from public.employee_wage_rates where employee_id = '00000000-0000-4000-8000-000000000083') as wage_rates,
  (select hourly_rate_crc from public.employees where id = '00000000-0000-4000-8000-000000000083') as tarifa_en_employees"
caso() {
  if [ -z "$2" ]; then printf '%-20s sin cuenta\n' "$1"; return; fi
  printf '%-20s %s\n' "$1" "$(q "begin; $SINT
    set local role authenticated;
    select set_config('request.jwt.claims', '{\"sub\":\"$2\",\"role\":\"authenticated\"}', true);
    $LEE; rollback;" | jq -c '.[0] // .' | head -c 300)"
}
for c in "owner true" "contador true" "manager true" "manager false" "cajero true" "salonero true"; do
  set -- $c; caso "$1 $([ "$2" = true ] && echo activo || echo inactivo)" "$(uid $1 $2)"
done
printf '%-20s %s\n' "check employees" "$(q "begin; $SINT update public.employees set hourly_rate_crc = 1 where id = '00000000-0000-4000-8000-000000000083'; rollback;" | head -c 200)"
printf '%-20s %s\n' "anon" "$(q "begin; set local role anon; select count(*) from public.employee_payroll; rollback;" | head -c 200)"
