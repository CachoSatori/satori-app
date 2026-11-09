-- Pruebas de la 089 (correr en STAGING con la 089 aplicada; solo lee). Todo tiene que dar ok = true.
with lista(t) as (select unnest(array['accounting_entries','cash_movements','cash_sessions','credit_applications',
  'movement_deletions','movement_edits','pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map',
  'punch_exceptions','sops','supplier_credits','suppliers','time_punches','tip_entries','tip_sessions','ventas_comps',
  'ventas_dias','ventas_hist','ventas_metas','salary_periods'])),
existe as (select t from lista where to_regclass('public.' || t) is not null)
select 'anon sin TRUNCATE/REFERENCES/TRIGGER en la lista' as caso,
       not exists (select 1 from existe, unnest(array['TRUNCATE','REFERENCES','TRIGGER']) p
                    where has_table_privilege('anon', ('public.' || t)::regclass, p)) as ok
union all
select 'anon sin SELECT/INSERT/UPDATE/DELETE sin política en la lista',
       not exists (select 1 from existe, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
                    where has_table_privilege('anon', ('public.' || t)::regclass, p)
                      and not exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = t
                                        and pp.roles && array['anon','public']::name[] and pp.cmd in ('ALL', p)))
union all
select 'PUBLIC sin ningún permiso en la lista (anon no hereda nada)',
       not exists (select 1 from existe, lateral aclexplode(coalesce((select relacl from pg_class where oid = ('public.' || t)::regclass),
                     acldefault('r', (select relowner from pg_class where oid = ('public.' || t)::regclass)))) a where a.grantee = 0)
union all
select 'son 23 tablas en la lista (22 de la prueba 82 + salary_periods)', (select count(*) from lista) = 23
union all
select 'authenticated conserva SELECT en todas (no se tocó)',
       not exists (select 1 from existe where not has_table_privilege('authenticated', ('public.' || t)::regclass, 'SELECT'))
union all
select 'service_role conserva todo (no se tocó)',
       not exists (select 1 from existe, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
                    where not has_table_privilege('service_role', ('public.' || t)::regclass, p))
union all
select 'RLS sigue prendida en todas', not exists (select 1 from existe join pg_class c on c.oid = ('public.' || t)::regclass
                                                  where not c.relrowsecurity)
union all
select 'ledger: la 089 registrada', exists (select 1 from supabase_migrations.schema_migrations where version = '089');
