-- Rollback de la 092. Grok 140: si employee_bajas tiene filas, FRENA sin tocar nada (el rastro se perdería):
-- primero el owner lo exporta y decide.
begin;
do $$ begin
  if to_regclass('public.employee_bajas') is not null and exists (select 1 from public.employee_bajas) then
    raise exception '092 rollback: employee_bajas tiene filas: exportarlas antes; no se toca nada';
  end if;
end $$;
drop trigger if exists trg_employees_borrado_guardia on public.employees;
drop function if exists public.employees_borrado_guardia();
drop table if exists public.employee_bajas;
delete from supabase_migrations.schema_migrations where version = '092';
commit;
