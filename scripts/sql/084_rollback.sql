-- 084_rollback · deshace supabase/migrations/084_employee_payroll.sql (PASO 1)
-- Devuelve la planilla a employees, saca el CHECK, vuelve employee_wage_rates a owner/manager/
-- contador (056) y borra employee_payroll. Antes de correrlo, volver el CÓDIGO atrás (la app del
-- paso 1 lee y escribe employee_payroll). NO toca el ledger: borrar la fila 084 en la misma
-- transacción si se corre.
begin;

alter table public.employees drop constraint if exists employees_planilla_en_employee_payroll;

update public.employees e
   set hourly_rate_crc    = p.hourly_rate_crc,
       fixed_salary_crc   = p.fixed_salary_crc,
       nombre_homebanking = p.nombre_homebanking,
       banco              = p.banco,
       cuenta_iban_alias  = p.cuenta_iban_alias
  from public.employee_payroll p
 where p.employee_id = e.id;

alter policy employee_wage_rates_select on public.employee_wage_rates
  using (get_my_role() in ('owner','manager','contador'));
alter policy employee_wage_rates_write on public.employee_wage_rates
  using      (get_my_role() in ('owner','manager','contador'))
  with check (get_my_role() in ('owner','manager','contador'));

drop table if exists public.employee_payroll;

commit;
