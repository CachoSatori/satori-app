-- 190_humo · pos_ventas_resumen: humo de SOLO LECTURA, antes y después del pase (PASE-190 §4 y §5).
-- Leer el ref antes de correr (regla 7). No escribe nada: `begin read only` … `rollback`.
-- Antes del merge: «existe» = false y el ledger termina en el número esperado. Después: todo true.
begin read only;

select
  (select max(version) from supabase_migrations.schema_migrations)                          as ledger_ultimo,
  (select count(*) from supabase_migrations.schema_migrations where version = '190')        as filas_190,
  to_regprocedure('public.pos_ventas_resumen(text, date, date)') is not null                as existe;

-- Lo que sigue solo tiene sentido con la función (después del merge).
select p.prosecdef                                                         as security_definer,
       p.proconfig = array['search_path=public, pg_temp']                  as search_path_fijo,
       p.provolatile = 's'                                                 as stable,
       p.prorettype = 'jsonb'::regtype                                     as devuelve_jsonb,
       not has_function_privilege('anon', p.oid, 'execute')                as anon_sin_execute,
       has_function_privilege('authenticated', p.oid, 'execute')           as authenticated_con_execute,
       not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0)
                                                                           as public_sin_execute
  from pg_proc p where p.oid = to_regprocedure('public.pos_ventas_resumen(text, date, date)');

-- Como un owner activo (JWT simulado, regla 4): ayer CR. Facturas del día = las C del día por la tabla.
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where is_active and role::text = 'owner' order by id limit 1),
                    'role', 'authenticated')::text, true);
set local role authenticated;
with h as (select public.pos_ventas_resumen('santa-teresa', (now() at time zone 'America/Costa_Rica')::date - 1,
                                             (now() at time zone 'America/Costa_Rica')::date - 1) as j)
select (select array_agg(k order by k) from h, jsonb_object_keys(h.j) k) = array['dias', 'facturas', 'lotes'] as tres_listas,
       coalesce((select sum((d->>6)::int) from h, jsonb_array_elements(h.j->'dias') d), 0)                  as facturas_funcion;
reset role;
select count(*) as facturas_tabla
  from public.pos_ndf_tickets
 where local = 'santa-teresa' and estado = 'C'
   and (fecha_registra at time zone 'America/Costa_Rica')::date = (now() at time zone 'America/Costa_Rica')::date - 1;

rollback;
