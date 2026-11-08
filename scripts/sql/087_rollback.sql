-- Rollback de la 087 (auditoría de employees). Se pierden las trazas guardadas.
begin;
drop trigger if exists trg_employees_audit on public.employees;
drop function if exists public.log_employee_edit();
drop table if exists public.employee_edits;
delete from supabase_migrations.schema_migrations where version = '087';
commit;
