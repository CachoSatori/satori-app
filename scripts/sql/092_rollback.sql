-- Rollback de la 092. Se pierde el rastro de las bajas guardado en employee_bajas.
begin;
drop trigger if exists trg_employees_borrado_guardia on public.employees;
drop function if exists public.employees_borrado_guardia();
drop table if exists public.employee_bajas;
delete from supabase_migrations.schema_migrations where version = '092';
commit;
