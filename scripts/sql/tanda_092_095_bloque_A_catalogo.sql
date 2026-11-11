-- BLOQUE A (ANTES) · catálogo de la tanda 092 → 095, una sola fila JSON, con freno (Grok 178). SOLO LECTURA.
begin read only;
select set_config('tanda.a', (json_build_object(
  -- 1.1 ledger
  'ledger', (select json_build_object('filas', count(*),
               'ultima', max(version) filter (where version ~ '^[0-9]{3}$'),
               'desde_092', coalesce(json_agg(version order by version) filter (where version ~ '^[0-9]{3}$' and version >= '092'), '[]'::json))
             from supabase_migrations.schema_migrations),
  -- 092 · 1.2 la verificación (scripts/sql/092_verificacion.sql)
  'v092', (select json_build_object(
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
)),
  -- 092 · 1.3 qué protege (solo conteos) y 1.4 los triggers de employees
  'v092_empleados', (select json_build_object('con_login', count(*) filter (where pos_login is not null),
                        'con_login_sin_propinas', count(*) filter (where pos_login is not null
                          and not exists (select 1 from public.tip_entries t where t.employee_id = e.id)))
                     from public.employees e),
  'v092_triggers_employees', (select coalesce(json_agg(tgname order by tgname), '[]'::json) from pg_trigger
                               where tgrelid = 'public.employees'::regclass and not tgisinternal),
  -- 093 · 1.2 las 10 policies de ventas (las _read y la huella de las _write) y la RLS de las 5
  'v093', (select json_build_object(
              'read_abiertas', count(*) filter (where policyname = tablename || '_read' and qual = 'true'),
              'read_con_rol',  count(*) filter (where policyname = tablename || '_read' and qual ~ 'get_my_role' and qual ~ 'IS NOT NULL'),
              'write', count(*) filter (where policyname = tablename || '_write'),
              'write_md5', md5(coalesce(string_agg(tablename || '|' || qual || '|' || coalesce(with_check, ''), E'\n' order by tablename)
                                        filter (where policyname = tablename || '_write'), '')))
           from pg_policies where schemaname = 'public'
            and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')),
  'v093_rls', (select count(*) filter (where relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace
                 and relname in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')),
  -- 093 · 1.3 vistas y funciones SECURITY DEFINER que leen ventas sin pasar por las policies
  'v093_lectores_sin_rls', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select distinct 'vista ' || r.ev_class::regclass::text as x
        from pg_depend d join pg_rewrite r on r.oid = d.objid
       where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
         and d.refobjid in ('public.ventas_dias'::regclass, 'public.ventas_hist'::regclass, 'public.ventas_metas'::regclass,
                            'public.ventas_comps'::regclass, 'public.product_map'::regclass)
         and r.ev_class not in ('public.ventas_dias'::regclass, 'public.ventas_hist'::regclass, 'public.ventas_metas'::regclass,
                                'public.ventas_comps'::regclass, 'public.product_map'::regclass)
      union all
      select 'funcion ' || p.oid::regprocedure::text from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosecdef
         and p.prosrc ~* '\m(ventas_dias|ventas_hist|ventas_metas|ventas_comps|product_map)\M') q),
  -- 094 · 1.2 la verificación (scripts/sql/094_verificacion.sql)
  'v094', (with lista(t) as (values ('accounting_entries'),('cash_movements'),('cash_sessions'),('credit_applications'),
  ('movement_deletions'),('movement_edits'),('pos_ndf_cursor'),('pos_ndf_open'),('pos_ndf_ticket_lines'),('pos_ndf_tickets'),
  ('product_map'),('punch_exceptions'),('sops'),('supplier_credits'),('suppliers'),('time_punches'),('tip_entries'),
  ('tip_sessions'),('ventas_comps'),('ventas_dias'),('ventas_hist'),('ventas_metas'),('salary_periods')),
ex as (select t, ('public.' || t)::regclass as r from lista where to_regclass('public.' || t) is not null)
select json_build_object(
  'tablas', (select count(*) from ex),
  'anon_maintain', (select count(*) from ex where has_table_privilege('anon', r, 'MAINTAIN')),
  'anon_otros', (select count(*) from ex cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege('anon', r, p)),
  'anon_trt', (select count(*) from ex cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('anon', r, p)),
  'public', (select count(*) from ex join pg_class c on c.oid = ex.r cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0),
  'authenticated_maintain', (select count(*) from ex where has_table_privilege('authenticated', r, 'MAINTAIN')),
  'ledger_094', exists (select 1 from supabase_migrations.schema_migrations where version = '094')
)),
  -- 095 · 1.2 las policies de las 3 tablas de caja
  'v095', (select json_build_object('contador_select', count(*) filter (where policyname like '%\_contador\_select'),
              'policies', json_agg(tablename || '.' || policyname || ':' || cmd order by tablename, policyname))
           from pg_policies where schemaname = 'public' and tablename in ('cash_movements','cash_sessions','suppliers')),
  -- 177 · huella de las 5 _read y de las 3 *_contador_select (tabla, nombre, cmd, roles, qual, with_check)
  'v093_read_md5', (select md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename), ''))
                      from pg_policies where schemaname = 'public' and policyname = tablename || '_read'
                       and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')),
  'v095_contador_md5', (select md5(coalesce(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename), ''))
                      from pg_policies where schemaname = 'public'
                       and policyname in ('cash_movements_contador_select','cash_sessions_contador_select','suppliers_contador_select')),
  'v093_v095_texto', (select json_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || permissive || '|' || coalesce(qual, '') order by tablename, policyname)
                      from pg_policies where schemaname = 'public' and (policyname = tablename || '_read'
                       and tablename in ('ventas_dias','ventas_hist','ventas_metas','ventas_comps','product_map')
                       or policyname in ('cash_movements_contador_select','cash_sessions_contador_select','suppliers_contador_select')))
))::text, true);
-- 178 · freno: si algo no da lo esperado, PARADA (el error lista qué). Se sigue leyendo en voz alta el JSON igual.
do $chk$
declare j jsonb := current_setting('tanda.a')::jsonb; m text := '';
begin
  if not ((j#>>'{ledger,filas}')::int = 61) then m := m || ' · ledger.filas≠61'; end if;
  if not (j#>>'{ledger,ultima}' = '091') then m := m || ' · ledger.ultima≠091'; end if;
  if not (j#>'{ledger,desde_092}' = '[]'::jsonb) then m := m || ' · hay versiones ≥092'; end if;
  if not (j->'v092' = '{"ledger_092":false,"tabla":false,"rls_tabla":false,"politicas":[],"anon_sin_permisos":true,"funcion_definer":false,"funcion_no_publica":true,"trigger_activo":false,"bajas":null}'::jsonb) then m := m || ' · v092≠antes'; end if;
  if not (not (j->'v092_triggers_employees') ? 'trg_employees_borrado_guardia') then m := m || ' · ya existe trg_employees_borrado_guardia'; end if;
  if not ((j#>>'{v093,read_abiertas}')::int = 5 and (j#>>'{v093,read_con_rol}')::int = 0 and (j#>>'{v093,write}')::int = 5) then m := m || ' · v093≠5·0·5'; end if;
  if not ((j->>'v093_rls')::int = 5) then m := m || ' · v093_rls≠5'; end if;
  if not (j->'v093_lectores_sin_rls' = '[]'::jsonb) then m := m || ' · hay lectores de ventas sin RLS'; end if;
  if not ((j#>>'{v094,tablas}')::int = 20 and (j#>>'{v094,anon_maintain}')::int = 20 and (j#>>'{v094,anon_trt}')::int = 0 and (j#>>'{v094,public}')::int = 0 and (j#>>'{v094,ledger_094}')::boolean = false) then m := m || ' · v094≠20·20·0·0·false'; end if;
  if not ((j#>>'{v095,contador_select}')::int = 0) then m := m || ' · v095.contador_select≠0'; end if;
  if m <> '' then raise exception 'PARADA (bloque A antes): no da%', m; end if;
end $chk$;
select current_setting('tanda.a')::json as tanda_antes;
rollback;
