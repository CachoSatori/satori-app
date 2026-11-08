#!/bin/bash
# Prueba del ROLLBACK de la 084 (SAL-AUD-01) en UNA transacción que termina en ROLLBACK (no deja nada).
#   SUPABASE_ACCESS_TOKEN=… scripts/sql/084_prueba_rollback.sh hwiatgicyyqyezqwldia
# Sirve antes de aplicar la 084 (corre migración + rollback dentro de la transacción). Después de
# aplicarla también corre, pero el paso «antes» ya no es el estado previo real: la prueba que vale
# después es 084_pruebas.sh.
# Empleado SINTÉTICO con planilla 12.345 / 50.000 / «BENEFICIARIO SINTETICO» / banco y cuenta de prueba.
# Esperado: después de la 084 → employee_payroll tiene sus TARIFAS, employee_bank_info sus DATOS
# BANCARIOS, y employees los tiene vacíos, con el CHECK; después del rollback → employees tiene OTRA VEZ
# los 5 datos, no hay CHECK y no hay tablas.
set -euo pipefail
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo "Falta SUPABASE_ACCESS_TOKEN." >&2; exit 2; }
REF=${1:?Uso: $0 <REF>}
[ "$REF" = hwiatgicyyqyezqwldia ] || { echo "Solo staging." >&2; exit 1; }
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
cuerpo() { sed -E '/^(begin|commit);$/d' "$1"; }
ID='00000000-0000-4000-8000-000000000084'
# employee_payroll solo se lee en el paso en que existe: Postgres resuelve las tablas al ejecutar cada
# sentencia, así que nombrarla antes de crearla (o después del rollback) da 42P01.
EMP="'en_employees', (select json_build_object('hora', hourly_rate_crc, 'fijo', fixed_salary_crc, 'homebanking', nombre_homebanking, 'banco', banco, 'cuenta', cuenta_iban_alias) from public.employees where id = '$ID'),
  'check', exists (select 1 from pg_constraint where conname = 'employees_planilla_en_employee_payroll'),
  'tabla', to_regclass('public.employee_payroll') is not null"
ESTADO_SIN="select json_build_object($EMP)"
ESTADO_CON="select json_build_object($EMP,
  'en_tarifas', (select to_json(p) from (select hourly_rate_crc as hora, fixed_salary_crc as fijo from public.employee_payroll where employee_id = '$ID') p),
  'en_banco',   (select to_json(b) from (select nombre_homebanking as homebanking, banco, cuenta_iban_alias as cuenta from public.employee_bank_info where employee_id = '$ID') b),
  'tabla_banco', to_regclass('public.employee_bank_info') is not null)"
SQL="begin;
-- Estado de antes: el sintético con su planilla en employees (si la 084 ya está aplicada, se suelta
-- el CHECK solo dentro de esta transacción para poder sembrarlo como estaba antes).
alter table public.employees drop constraint if exists employees_planilla_en_employee_payroll;
insert into public.employees (id, full_name, role, is_active, hourly_rate_crc, fixed_salary_crc, nombre_homebanking, banco, cuenta_iban_alias)
  values ('$ID', 'EMPLEADO SINTETICO 084', 'cocina', true, 12345, 50000, 'BENEFICIARIO SINTETICO', 'BANCO DE PRUEBA', 'CUENTA-PRUEBA');
create temp table pasos (n int, paso text, estado json) on commit drop;
insert into pasos select 1, 'antes', ($ESTADO_SIN);
$(cuerpo "$RAIZ/supabase/migrations/084_employee_payroll.sql")
insert into pasos select 2, 'despues_084', ($ESTADO_CON);
$(cuerpo "$RAIZ/scripts/sql/084_rollback.sql")
insert into pasos select 3, 'despues_rollback', ($ESTADO_SIN);
select n, paso, estado from pasos order by n;
rollback;"
jq -n --arg q "$SQL" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @- | jq -c '.[]? // .'
