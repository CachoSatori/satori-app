-- G-61 (08-nov): catálogo NORMALIZADO para el diff exacto staging ↔ prod. Lo corre scripts/sql/gate61.sh, siempre dentro
-- de «begin; set transaction read only; … ; rollback;». Una línea por hecho, ordenadas con collate "C".
-- Normalización: los ACL se expanden con aclexplode (grantee, privilegio, grantable; sin el grantor ni el orden del
-- arreglo, que cambian entre proyectos sin cambiar el permiso); los cuerpos van como md5; las opciones, ordenadas; nada
-- depende de OIDs (se excluye pg_toast).
-- Cubre: club_* (columnas, constraints, índices, relaciones con dueño/RLS/FORCE/reloptions, ACL de tablas y columnas,
-- funciones en columnas + ACL, dueños de SECURITY DEFINER con rolsuper/rolbypassrls, policies con PERMISSIVE, triggers
-- con tgenabled, vistas, secuencias con OWNED BY, pg_depend), triggers sobre auth.users, publicaciones, pg_cron, extensiones
-- (existencia, esquema y versión mínima), privilegios por defecto y esquema public, roles de la API y dependencias fuera de
-- club_* (get_my_role, auth.uid, user_role, profiles, employees, pos_ndf_*).
with
rels as (
  select c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity, c.reloptions, c.relpersistence
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'club\_%' and c.relkind in ('r','p','v','m','S','i')
),
fns as (
  select p.oid, p.proname, p.proowner, p.proacl, p.prosecdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'public' and (p.proname like 'club\_%' or p.proname in ('get_my_role')))
      or (n.nspname = 'auth' and p.proname = 'uid')
),
gr as (   -- nombre del grantee (0 = PUBLIC)
  select 0::oid as oid, 'PUBLIC'::text as nombre
  union all select r.oid, r.rolname::text from pg_roles r
),
lineas as (
  -- columnas de club_* (y de las tablas de las que depende el Club)
  select format('col %s.%s %s notnull=%s def=%s ident=%s gen=%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
                a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), nullif(a.attidentity, ''), nullif(a.attgenerated, '')) l
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind in ('r','p','v','m') and a.attnum > 0 and not a.attisdropped
     and (c.relname like 'club\_%' or c.relname in ('profiles', 'employees') or c.relname like 'pos\_ndf\_%')
  union all
  select format('con %s %s %s valid=%s deferrable=%s', c.relname, co.conname, pg_get_constraintdef(co.oid), co.convalidated, co.condeferrable)
    from pg_constraint co join rels c on c.oid = co.conrelid
  union all
  select format('idx %s', pg_get_indexdef(i.indexrelid))
    from pg_index i join rels c on c.oid = i.indrelid
  union all
  -- relaciones: dueño, RLS, FORCE RLS, reloptions ordenadas, persistencia
  select format('rel %s kind=%s owner=%s rls=%s force=%s persist=%s opts=%s', r.relname, r.relkind, pg_get_userbyid(r.relowner),
                r.relrowsecurity, r.relforcerowsecurity, r.relpersistence,
                coalesce((select string_agg(o, ',' order by o collate "C") from unnest(r.reloptions) o), '-'))
    from rels r
  union all
  -- ACL de tablas, vistas y secuencias (sin ACL propio = el de defecto del tipo)
  select format('relacl %s %s %s grant=%s', r.relname, g.nombre, x.privilege_type, x.is_grantable)
    from rels r
    cross join lateral aclexplode(coalesce(r.relacl, acldefault(case when r.relkind = 'S' then 's'::"char" else 'r'::"char" end, r.relowner))) x
    join gr g on g.oid = x.grantee
   where r.relkind <> 'i'
  union all
  select format('colacl %s.%s %s %s grant=%s', c.relname, a.attname, g.nombre, x.privilege_type, x.is_grantable)
    from pg_attribute a join rels c on c.oid = a.attrelid
    cross join lateral aclexplode(a.attacl) x join gr g on g.oid = x.grantee
   where a.attacl is not null
  union all
  -- funciones en columnas (no solo el md5): dueño, lenguaje, SECURITY DEFINER, volatilidad, estricta, leakproof,
  -- paralelismo, retorno, config (search_path) ordenada y md5 del cuerpo
  select format('fn %s owner=%s lang=%s secdef=%s vol=%s strict=%s leak=%s par=%s ret=%s%s config=%s md5=%s',
                p.oid::regprocedure, pg_get_userbyid(p.proowner), l.lanname, p.prosecdef, p.provolatile, p.proisstrict,
                p.proleakproof, p.proparallel, format_type(p.prorettype, null), case when p.proretset then '[set]' else '' end,
                coalesce((select string_agg(o, ',' order by o collate "C") from unnest(p.proconfig) o), '-'), md5(p.prosrc))
    from pg_proc p join fns f on f.oid = p.oid join pg_language l on l.oid = p.prolang
  union all
  select format('fnacl %s %s %s grant=%s', f.oid::regprocedure, g.nombre, x.privilege_type, x.is_grantable)
    from fns f cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) x join gr g on g.oid = x.grantee
  union all
  -- dueños de las SECURITY DEFINER: si es superusuario o salta RLS, todo lo que hace la función también
  select distinct format('secdef_owner %s super=%s bypassrls=%s', r.rolname, r.rolsuper, r.rolbypassrls)
    from fns f join pg_roles r on r.oid = f.proowner where f.prosecdef
  union all
  -- policies (con PERMISSIVE/RESTRICTIVE y roles ordenados)
  select format('pol %s %s cmd=%s permissive=%s roles=%s using=%s check=%s', c.relname, po.polname, po.polcmd, po.polpermissive,
                (select string_agg(rn, ',' order by rn collate "C") from (select case when x = 0 then 'PUBLIC' else pg_get_userbyid(x)::text end rn from unnest(po.polroles) x) z),
                coalesce(pg_get_expr(po.polqual, po.polrelid), '-'), coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '-'))
    from pg_policy po join rels c on c.oid = po.polrelid
  union all
  -- triggers de club_* con su estado (O = activo, D = desactivado, R/A = réplica/siempre)
  select format('trg %s enabled=%s %s', c.relname, t.tgenabled, pg_get_triggerdef(t.oid))
    from pg_trigger t join rels c on c.oid = t.tgrelid where not t.tgisinternal
  union all
  -- triggers sobre auth.users (un trigger de otro frente puede escribir en tablas del Club o romper altas)
  select format('authtrg %s enabled=%s fn=%s md5=%s', t.tgname, t.tgenabled, t.tgfoid::regprocedure, md5(p.prosrc))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
  union all
  select format('view %s md5=%s', r.relname, md5(pg_get_viewdef(r.oid))) from rels r where r.relkind in ('v','m')
  union all
  -- secuencias: tipo, parámetros y OWNED BY (dependencia auto o de identidad hacia la columna)
  select format('seq %s type=%s inc=%s min=%s max=%s cycle=%s owned_by=%s', r.relname, format_type(s.seqtypid, null),
                s.seqincrement, s.seqmin, s.seqmax, s.seqcycle,
                coalesce((select tc.relname || '.' || ta.attname || ' (' || d.deptype::text || ')'
                            from pg_depend d join pg_class tc on tc.oid = d.refobjid
                            join pg_attribute ta on ta.attrelid = d.refobjid and ta.attnum = d.refobjsubid
                           where d.classid = 'pg_class'::regclass and d.objid = r.oid and d.deptype in ('a','i') limit 1), '-'))
    from rels r join pg_sequence s on s.seqrelid = r.oid
  union all
  -- pg_depend: todo lo que involucra a club_* y apunta afuera (o viceversa), por descripción (sin OIDs)
  select format('dep %s -> %s (%s)', x.a, x.b, x.deptype)
    from (select pg_describe_object(d.classid, d.objid, d.objsubid) a, pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) b, d.deptype
            from pg_depend d
           where d.deptype in ('n','a','i','e')
             and (d.objid in (select oid from rels) or d.objid in (select oid from fns)
                  or d.refobjid in (select oid from rels) or d.refobjid in (select oid from fns)
                  or (d.classid in ('pg_trigger'::regclass, 'pg_policy'::regclass, 'pg_constraint'::regclass, 'pg_attrdef'::regclass)
                      and d.refobjid in (select oid from rels)))) x
   where x.a !~ 'pg_toast' and x.b !~ 'pg_toast'
  union all
  -- publicaciones (realtime u otras) que incluyan club_*; y las de «todas las tablas»
  select format('pub %s %s', pt.pubname, pt.tablename) from pg_publication_tables pt where pt.schemaname = 'public' and pt.tablename like 'club\_%'
  union all
  select format('pub_all %s ins=%s upd=%s del=%s', p.pubname, p.pubinsert, p.pubupdate, p.pubdelete) from pg_publication p where p.puballtables
  union all
  -- pg_cron: los jobs del Club (si pg_cron no está, sale «cron ausente»)
  select coalesce(x.l, 'cron ausente')
    from (select 1) uno
    left join lateral xmltable('/table/row' passing query_to_xml(
           case when to_regclass('cron.job') is not null then
             $q$select format('cron %s schedule=%s active=%s user=%s db=%s cmd_md5=%s', jobname, schedule, active, username, database, md5(command)) as l
                  from cron.job where jobname like 'club%'$q$
           else $q$select 'cron ausente'::text as l$q$ end, false, false, '') columns l text path 'l') x on true
  union all
  -- extensiones que usa la 075: existencia, esquema y versión mínima (la versión exacta puede cambiar entre proyectos)
  select format('ext %s existe=%s esquema=%s version_min_%s=%s', m.nombre, e.extname is not null, coalesce(n.nspname, '-'), m.minima,
                case when e.extname is null then 'no' when string_to_array(regexp_replace(e.extversion, '[^0-9.]', '', 'g'), '.')::int[]
                     >= string_to_array(m.minima, '.')::int[] then 'ok' else 'NO' end)
    from (values ('pgcrypto', '1.3'), ('pg_cron', '1.4')) m(nombre, minima)
    left join pg_extension e on e.extname = m.nombre left join pg_namespace n on n.oid = e.extnamespace
  union all
  -- privilegios por defecto en public (deciden el ACL de cada objeto nuevo) y el esquema public
  select format('defacl %s type=%s %s %s grant=%s', pg_get_userbyid(d.defaclrole), d.defaclobjtype, g.nombre, x.privilege_type, x.is_grantable)
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) x join gr g on g.oid = x.grantee
   where d.defaclnamespace in (0, 'public'::regnamespace)
  union all
  select format('schema public owner=%s', pg_get_userbyid(nspowner)) from pg_namespace where nspname = 'public'
  union all
  select format('schemaacl public %s %s grant=%s', g.nombre, x.privilege_type, x.is_grantable)
    from pg_namespace s cross join lateral aclexplode(coalesce(s.nspacl, acldefault('n', s.nspowner))) x join gr g on g.oid = x.grantee
   where s.nspname = 'public'
  union all
  -- roles de la API: que ninguno salte RLS ni sea superusuario
  select format('role %s super=%s bypassrls=%s inherit=%s login=%s', r.rolname, r.rolsuper, r.rolbypassrls, r.rolinherit, r.rolcanlogin)
    from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')
  union all
  -- el enum de roles de la app
  select format('enum user_role %s', string_agg(e.enumlabel, ',' order by e.enumsortorder))
    from pg_enum e where e.enumtypid = 'public.user_role'::regtype
  union all
  -- RLS de las tablas de las que depende el Club
  select format('deprel %s rls=%s force=%s owner=%s', c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and (c.relname in ('profiles', 'employees') or c.relname like 'pos\_ndf\_%')
)
-- espacios y saltos de línea de pg_get_expr/pg_get_viewdef colapsados: una línea por hecho, siempre
select coalesce(string_agg(ln, E'\n' order by ln collate "C"), '') as cat
  from (select btrim(regexp_replace(l, '\s+', ' ', 'g')) as ln from lineas) z
