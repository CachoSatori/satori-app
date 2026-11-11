-- Catálogo de todos los objetos club_* (CLUB-AUD-17): columnas, constraints, índices, funciones (md5 del cuerpo + ACL),
-- policies, triggers, ACL de tablas y columnas, vistas. Una línea por objeto, ordenado. Ver club_paridad.sh.
-- (10-nov) Las ACL se listan con sus entradas ORDENADAS: aplicar la 150 dos veces (staging) reordena las entradas
-- (revoke + grant) sin cambiar ningún permiso; el orden no es un permiso.
select string_agg(l, E'\n' order by l) as cat from (
  -- columnas
  select format('col %s.%s %s null=%s def=%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod), not a.attnotnull,
                coalesce(pg_get_expr(d.adbin, d.adrelid), '-')) l
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relname like 'club\_%' and c.relkind in ('r','v') and a.attnum > 0 and not a.attisdropped
  union all
  select format('con %s %s %s', c.relname, co.conname, pg_get_constraintdef(co.oid)) from pg_constraint co join pg_class c on c.oid = co.conrelid
    join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'club\_%'
  union all
  select format('idx %s', pg_get_indexdef(i.indexrelid)) from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'club\_%'
  union all
  select format('fn %s secdef=%s md5=%s acl=%s', p.oid::regprocedure, p.prosecdef, md5(pg_get_functiondef(p.oid)), coalesce('{' || (select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x) || '}', 'default'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'club\_%'
  union all
  select format('pol %s %s %s %s %s %s', tablename, policyname, cmd, roles, qual, with_check) from pg_policies where schemaname = 'public' and tablename like 'club\_%'
  union all
  select format('trg %s %s', c.relname, pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'club\_%' and not t.tgisinternal
  union all
  select format('acl %s %s rls=%s', c.relname, coalesce('{' || (select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x) || '}', 'default'), c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'club\_%' and c.relkind in ('r','v','S')
  union all
  select format('colacl %s.%s %s', c.relname, a.attname, '{' || (select string_agg(x::text, ',' order by x::text) from unnest(a.attacl) x) || '}') from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'club\_%' and a.attacl is not null
  union all
  select format('view %s md5=%s', c.relname, md5(pg_get_viewdef(c.oid))) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'club\_%' and c.relkind = 'v'
) x
