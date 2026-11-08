-- Grok 61 (PROPUESTA, 08-nov): catálogo EXTENDIDO para el diff exacto staging ↔ prod. Complementa club_catalogo.sql
-- (que ya cubre columnas, constraints, índices, md5 de funciones con su ACL y SECURITY DEFINER, policies, triggers, ACL
-- de tablas y columnas, vistas) con: dueños, reloptions, FORCE RLS, privilegios por defecto, el esquema public, las
-- dependencias fuera de club_* (get_my_role, user_role, profiles, pos_ndf_*), extensiones, publicaciones y event triggers.
-- SOLO LECTURA: correr dentro de «begin; set transaction read only; … ; rollback;». Ver RUNBOOK-piloto.md §12 (G-61).
select string_agg(l, E'\n' order by l) as cat from (
  -- dueños de tablas, vistas y secuencias club_*, y opciones de relación (security_invoker, fillfactor…) y FORCE RLS
  select format('own %s %s kind=%s relopt=%s force_rls=%s', c.relname, pg_get_userbyid(c.relowner), c.relkind,
                coalesce(array_to_string(c.reloptions, ','), '-'), c.relforcerowsecurity) l
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'club\_%' and c.relkind in ('r','v','m','S','p','i')
  union all
  -- dueños de funciones club_*
  select format('fnown %s %s', p.oid::regprocedure, pg_get_userbyid(p.proowner))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'club\_%'
  union all
  -- privilegios por defecto (deciden el ACL de cada objeto NUEVO que crea ese rol en public)
  select format('defacl %s schema=%s type=%s acl=%s', pg_get_userbyid(d.defaclrole), coalesce(d.defaclnamespace::regnamespace::text, '*'),
                d.defaclobjtype, d.defaclacl::text)
    from pg_default_acl d where d.defaclnamespace in (0, 'public'::regnamespace)
  union all
  -- el esquema public (dueño y ACL)
  select format('schema public %s %s', pg_get_userbyid(nspowner), nspacl::text) from pg_namespace where nspname = 'public'
  union all
  -- dependencias fuera de club_*: funciones y tipos que la 075 usa
  select format('dep fn %s md5=%s owner=%s acl=%s', p.oid::regprocedure, md5(pg_get_functiondef(p.oid)), pg_get_userbyid(p.proowner), coalesce(p.proacl::text, 'default'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('get_my_role', 'set_updated_at')
  union all
  select format('dep enum %s %s', t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder))
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'user_role' group by t.typname
  union all
  select format('dep col %s.%s %s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod))
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and (c.relname = 'profiles' or c.relname like 'pos\_ndf\_%') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  union all
  -- extensiones que usa el Club, publicaciones (realtime) y el job de pg_cron
  select format('ext %s %s', extname, extversion) from pg_extension where extname in ('pgcrypto', 'pg_cron', 'pg_net')
  union all
  select format('pub %s %s', p.pubname, c.relname) from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
    join pg_class c on c.oid = pr.prrelid where c.relname like 'club\_%'
  union all
  select format('evtrg %s %s %s', evtname, evtevent, evtenabled) from pg_event_trigger
) x
