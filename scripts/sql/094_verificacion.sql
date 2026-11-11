-- Verificación de la 094 — SOLO LECTURA. Antes: anon_maintain = tablas; después: 0. Sin datos de personas.
with lista(t) as (values ('accounting_entries'),('cash_movements'),('cash_sessions'),('credit_applications'),
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
) as x;
