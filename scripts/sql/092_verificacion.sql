-- Verificación de la 092 — SOLO LECTURA. Sirve antes (todo false/0) y después de aplicar (todo true).
-- No lee datos de personas: solo catálogo y conteos.
select json_build_object(
  'ledger_092',        exists (select 1 from supabase_migrations.schema_migrations where version = '092'),
  'tabla',             to_regclass('public.employee_bajas') is not null,
  'rls_tabla',         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.employee_bajas')), false),
  'politicas',         (select coalesce(json_agg(policyname || ':' || cmd order by policyname), '[]'::json)
                          from pg_policies where schemaname = 'public' and tablename = 'employee_bajas'),
  'anon_sin_permisos', to_regclass('public.employee_bajas') is null
                       or not exists (select 1 from information_schema.role_table_grants
                                       where table_schema = 'public' and table_name = 'employee_bajas' and grantee = 'anon'),
  'funcion_definer',   coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.employees_borrado_guardia()')), false),
  'funcion_no_publica', to_regprocedure('public.employees_borrado_guardia()') is null
                       or not (has_function_privilege('anon', 'public.employees_borrado_guardia()', 'execute')
                            or has_function_privilege('authenticated', 'public.employees_borrado_guardia()', 'execute')),
  'trigger_activo',    exists (select 1 from pg_trigger where tgname = 'trg_employees_borrado_guardia'
                                and tgrelid = 'public.employees'::regclass and tgenabled = 'O'),
  'bajas',             case when to_regclass('public.employee_bajas') is null then null
                            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.employee_bajas', false, true, '')))[1]::text::int end
) as x;
