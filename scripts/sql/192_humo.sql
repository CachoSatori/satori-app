-- 192_humo · SOLO LECTURA (begin read only … rollback). Se corre en prod ANTES y DESPUÉS de la 192 (regla: después =
-- antes salvo lo esperado). Devuelve solo conteos y huellas: ningún monto, nombre ni id.
-- Esperado ANTES: 2 policies (lectura md5 a4d0a0e9…, op_write md5 da4dc6bf…), helper ausente, salonero_ve = total.
-- Esperado DESPUÉS: 3 policies (op_write igual), helper presente, salonero_ve = salonero_propias < total, total igual.
begin read only;
select json_build_object(
  'policies', (select json_agg(policyname || '=' || md5(coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd
                                || '|' || permissive || '|' || roles::text) order by policyname)
               from pg_policies where schemaname = 'public' and tablename = 'tip_entries'),
  'helper', to_regprocedure('public.propinas_mis_empleados()') is not null,
  'total', (select count(*) from public.tip_entries),
  'ledger', (select max(version) from supabase_migrations.schema_migrations)
);
-- Un salonero activo con empleado (el primero por id), con su JWT simulado (regla 4): cuántas filas ve.
select set_config('request.jwt.claims', json_build_object('sub',
  (select p.id from public.profiles p join public.employees e on e.profile_id = p.id
   where p.is_active and p.role = 'salonero' order by p.id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select json_build_object(
  'salonero_ve', (select count(*) from public.tip_entries),
  'salonero_empleados_distintos', (select count(distinct employee_id) from public.tip_entries),
  'salonero_propias', (select count(*) from public.tip_entries
                       where employee_id in (select id from public.employees where profile_id = auth.uid()))
);
rollback;
