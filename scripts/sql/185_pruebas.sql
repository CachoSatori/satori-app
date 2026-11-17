-- 185_pruebas (origen caja 099) · Obligar a cambiar la contraseña al entrar. Postgres local o STAGING (nunca prod).
-- Aplica la 185 dentro de una transacción, corre la batería y TODAS las mutaciones (cada una en una subtransacción
-- descartada), prueba el rollback y termina en ROLLBACK: no deja nada. Se arma con scripts/sql/185_pruebas.py.
--
-- MARCADORES que llena el runner: «-- @@185@@» → cuerpo de supabase/migrations/185_seguridad_cambio_clave.sql sin
-- begin/commit; «-- @@185R@@» → cuerpo de scripts/sql/185_rollback.sql sin begin/commit.
--
-- Usuarios: el owner, el manager y el salonero ACTIVOS de la base (los primeros por id; solo se los usa como JWT, no se
-- les cambia nada: ni perfil ni contraseña; en local los crea 185_preludio_local.sql) y tres cuentas ficticias que crea la batería en auth.users (UUID fijos,
-- correos .test). El alta dispara handle_new_user (perfil salonero INACTIVO) como en la base real. No se hace ningún
-- UPDATE de profiles: la bitácora de permisos (165) no se dispara. Los «cambios de contraseña» son UPDATE de
-- auth.users.encrypted_password sobre las cuentas ficticias (como lo hace GoTrue), con hashes inventados.
-- JWT simulados con request.jwt.claims y `set local role authenticated|anon`.
-- NO PROBADO no da verde: si falta un objeto o un usuario de un rol, cae el 00.
begin;

-- @@185@@   (aquí va el cuerpo de la 185 sin begin/commit)

create temp table _r185 (n serial, ronda text, caso text, ok boolean, detalle text) on commit drop;
grant all on _r185 to public;
grant all on sequence _r185_n_seq to public;

create function pg_temp.caso(p_ronda text, p_caso text, p_ok boolean, p_det text default null) returns void language sql as $f$
  insert into _r185 (ronda, caso, ok, detalle) values (p_ronda, p_caso, coalesce(p_ok, false), p_det);
$f$;

create function pg_temp.reemplazar(p_fn regprocedure, p_viejo text, p_nuevo text) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_fn);
begin
  if position(p_viejo in d) = 0 then raise exception 'ANCLA: «%» no está en %', p_viejo, p_fn; end if;
  execute replace(d, p_viejo, p_nuevo);
end $f$;

-- Corre p_sql como p_rol ('authenticated' | 'anon') con el sub dado. Devuelve 'ok', 'ok:<valor>' si es un SELECT de un
-- valor, o '<SQLSTATE>:<mensaje>' si da error (el error se DEVUELVE como resultado del caso, no se pierde).
create function pg_temp.como(p_rol text, p_sub uuid, p_sql text) returns text language plpgsql as $f$
declare v text; r text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_rol)::text, true);
    execute format('set local role %I', p_rol);
    if p_sql ~* '^\s*select' then execute p_sql into v; r := 'ok:' || coalesce(v, 'null');
    else execute p_sql; r := 'ok'; end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return r;
  exception when others then
    -- el subbloque se descarta: el rol y los claims vuelven a los de antes
    return sqlstate || ':' || sqlerrm;
  end;
end $f$;

create function pg_temp.marca(p_user uuid) returns text language sql as $f$
  select huella_hash from public.seguridad_cambio_clave where user_id = p_user;
$f$;

create function pg_temp.t185(ro text) returns void language plpgsql as $t$
declare
  O  uuid := (select id from public.profiles where role::text = 'owner'    and is_active order by id limit 1);
  M  uuid := (select id from public.profiles where role::text = 'manager'  and is_active order by id limit 1);
  S  uuid := (select id from public.profiles where role::text = 'salonero' and is_active order by id limit 1);
  T1 uuid := '00000000-0000-4000-8185-000000000001';   -- cuenta ficticia que se marca
  T2 uuid := '00000000-0000-4000-8185-000000000002';   -- otra cuenta ficticia (perfil inactivo)
  T3 uuid := '00000000-0000-4000-8185-000000000003';   -- cuenta ficticia SIN contraseña
  H1 constant text := '$2a$10$ficticio185hashuno000000000000000000000000000000000000';
  H2 constant text := '$2a$10$ficticio185hashdos000000000000000000000000000000000000';
  H3 constant text := '$2a$10$ficticio185hashtres00000000000000000000000000000000000';
  v_t text; v_t2 text; v_ok boolean; v_n int;
begin
  perform pg_temp.caso(ro, '00 prerrequisitos: tabla, 4 funciones y owner/manager/salonero activos',
    to_regclass('public.seguridad_cambio_clave') is not null
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'seguridad\_%clave%') = 4
    and O is not null and M is not null and S is not null,
    concat_ws(' ', 'O', O is not null, 'M', M is not null, 'S', S is not null));
  if to_regclass('public.seguridad_cambio_clave') is null or O is null or M is null or S is null then return; end if;

  -- 01. catálogo
  perform pg_temp.caso(ro, '01a tabla: RLS · authenticated solo SELECT de user_id y marcado_en (sin huella) · anon y service_role nada',
    (select relrowsecurity from pg_class where oid = 'public.seguridad_cambio_clave'::regclass)
    and has_column_privilege('authenticated', 'public.seguridad_cambio_clave', 'user_id', 'SELECT')
    and has_column_privilege('authenticated', 'public.seguridad_cambio_clave', 'marcado_en', 'SELECT')
    and not has_column_privilege('authenticated', 'public.seguridad_cambio_clave', 'huella_hash', 'SELECT')
    and not has_column_privilege('authenticated', 'public.seguridad_cambio_clave', 'marcado_por', 'SELECT')
    and not has_table_privilege('authenticated', 'public.seguridad_cambio_clave', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('anon', 'public.seguridad_cambio_clave', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_any_column_privilege('anon', 'public.seguridad_cambio_clave', 'SELECT')
    and not has_table_privilege('service_role', 'public.seguridad_cambio_clave', 'INSERT,UPDATE,DELETE,TRUNCATE'));
  select bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
                  and not has_function_privilege('anon', p.oid, 'EXECUTE')
                  and has_function_privilege('authenticated', p.oid, 'EXECUTE')), count(*)
    into v_ok, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'seguridad\_%clave%';
  perform pg_temp.caso(ro, '01b funciones: SECURITY DEFINER · search_path fijo · anon no ejecuta · authenticated sí',
    v_ok and v_n = 4, v_n || ' funciones');

  -- cuentas ficticias (alta como GoTrue: sin JWT)
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values
    (T1, 't1-185@ejemplo.test', H1, '{"full_name":"Ficticia Uno"}'),
    (T2, 't2-185@ejemplo.test', H2, '{"full_name":"Ficticia Dos"}'),
    (T3, 't3-185@ejemplo.test', null, '{"full_name":"Ficticia Tres"}');

  -- 02. el owner marca
  v_t := pg_temp.como('authenticated', O, format('select public.seguridad_marcar_cambio_clave(%L)::text', T1));
  perform pg_temp.caso(ro, '02 owner activo marca: huella = md5 del hash actual, marcado_por = owner',
    v_t like 'ok:%' and pg_temp.marca(T1) = md5(H1)
    and (select marcado_por from public.seguridad_cambio_clave where user_id = T1) = O, v_t);

  -- 03–06. nadie más marca
  v_t := pg_temp.como('authenticated', M, format('select public.seguridad_marcar_cambio_clave(%L)::text', T2));
  perform pg_temp.caso(ro, '03 manager no marca (42501)', v_t like '42501:%' and pg_temp.marca(T2) is null, v_t);
  v_t := pg_temp.como('authenticated', S, format('select public.seguridad_marcar_cambio_clave(%L)::text', T2));
  perform pg_temp.caso(ro, '04 salonero no marca (42501)', v_t like '42501:%' and pg_temp.marca(T2) is null, v_t);
  v_t := pg_temp.como('authenticated', T2, format('select public.seguridad_marcar_cambio_clave(%L)::text', T2));
  perform pg_temp.caso(ro, '05 perfil inactivo no marca (42501)', v_t like '42501:%' and pg_temp.marca(T2) is null, v_t);
  v_t := pg_temp.como('anon', null, format('select public.seguridad_marcar_cambio_clave(%L)::text', T2));
  v_t2 := pg_temp.como('anon', null, 'select public.seguridad_debo_cambiar_clave()::text');
  perform pg_temp.caso(ro, '06 anon no ejecuta marcar ni consultar (42501)',
    v_t like '42501:%' and v_t2 like '42501:%' and pg_temp.marca(T2) is null, v_t || ' · ' || v_t2);

  -- 07. consulta del propio usuario
  v_t := pg_temp.como('authenticated', T1, 'select public.seguridad_debo_cambiar_clave()::text');
  v_t2 := pg_temp.como('authenticated', T2, 'select public.seguridad_debo_cambiar_clave()::text');
  perform pg_temp.caso(ro, '07 marcado → true; no marcado → false', v_t = 'ok:true' and v_t2 = 'ok:false', v_t || ' · ' || v_t2);

  -- 08. lectura directa: solo su fila y sin la huella
  v_t := pg_temp.como('authenticated', T1, 'select count(*)::text from public.seguridad_cambio_clave');
  v_t2 := pg_temp.como('authenticated', S, 'select count(*)::text from public.seguridad_cambio_clave');
  perform pg_temp.caso(ro, '08a cada uno ve solo su fila (T1 ve 1, otro ve 0)', v_t = 'ok:1' and v_t2 = 'ok:0', v_t || ' · ' || v_t2);
  v_t := pg_temp.como('authenticated', T1, 'select huella_hash from public.seguridad_cambio_clave');
  perform pg_temp.caso(ro, '08b la huella no se lee ni la propia (42501)', v_t like '42501:%', v_t);

  -- 09–10. nadie escribe directo (ni el propio usuario ni el owner)
  v_t := pg_temp.como('authenticated', T1, format('delete from public.seguridad_cambio_clave where user_id = %L', T1));
  v_t2 := pg_temp.como('authenticated', T1, format('update public.seguridad_cambio_clave set huella_hash = %L where user_id = %L', md5('x'), T1));
  v_ok := v_t like '42501:%' and v_t2 like '42501:%';
  v_t := pg_temp.como('authenticated', T2, format('insert into public.seguridad_cambio_clave (user_id, huella_hash) values (%L, %L)', T2, md5('x')));
  perform pg_temp.caso(ro, '09 el usuario no se borra, no se edita ni se inserta la marca (42501)',
    v_ok and v_t like '42501:%' and pg_temp.marca(T1) = md5(H1) and pg_temp.marca(T2) is null, v_t);
  v_t := pg_temp.como('authenticated', O, format('delete from public.seguridad_cambio_clave where user_id = %L', T1));
  perform pg_temp.caso(ro, '10 el owner tampoco escribe directo (42501): solo por las funciones',
    v_t like '42501:%' and pg_temp.marca(T1) = md5(H1), v_t);

  -- 11. liberación: cambió la contraseña (GoTrue actualiza el hash) → false y la fila se borra
  update auth.users set encrypted_password = H3 where id = T1;
  v_t := pg_temp.como('authenticated', T1, 'select public.seguridad_debo_cambiar_clave()::text');
  perform pg_temp.caso(ro, '11 cambió la contraseña → false y se borra la marca',
    v_t = 'ok:false' and pg_temp.marca(T1) is null, v_t || ' · marca ' || coalesce(pg_temp.marca(T1), 'sin'));

  -- 12. pendientes del owner: lista y limpia a los que ya cambiaron
  v_t := pg_temp.como('authenticated', O, format('select public.seguridad_marcar_cambio_clave(%L)::text', T1));
  v_t := pg_temp.como('authenticated', O, format('select public.seguridad_marcar_cambio_clave(%L)::text', T2));
  v_t := pg_temp.como('authenticated', O, format(
    'select string_agg(user_id::text, '','' order by user_id) from public.seguridad_cambio_clave_pendientes() where user_id in (%L, %L)', T1, T2));
  v_ok := v_t = format('ok:%s,%s', T1, T2);
  update auth.users set encrypted_password = H1 where id = T2;
  v_t2 := pg_temp.como('authenticated', O, format(
    'select string_agg(user_id::text, '','' order by user_id) from public.seguridad_cambio_clave_pendientes() where user_id in (%L, %L)', T1, T2));
  perform pg_temp.caso(ro, '12 pendientes: lista a los marcados; el que cambió sale y su fila se borra',
    v_ok and v_t2 = 'ok:' || T1 and pg_temp.marca(T2) is null, v_t || ' → ' || v_t2);

  -- 13. pendientes y desmarcar: solo owner
  v_t := pg_temp.como('authenticated', M, 'select count(*)::text from public.seguridad_cambio_clave_pendientes()');
  v_t2 := pg_temp.como('authenticated', M, format('select public.seguridad_desmarcar_cambio_clave(%L)::text', T1));
  perform pg_temp.caso(ro, '13 manager no ve pendientes ni desmarca (42501)',
    v_t like '42501:%' and v_t2 like '42501:%' and pg_temp.marca(T1) is not null, v_t || ' · ' || v_t2);

  -- 14. el owner desmarca
  v_t := pg_temp.como('authenticated', O, format('select public.seguridad_desmarcar_cambio_clave(%L)::text', T1));
  v_t2 := pg_temp.como('authenticated', T1, 'select public.seguridad_debo_cambiar_clave()::text');
  perform pg_temp.caso(ro, '14 owner desmarca → sin fila y libre', v_t = 'ok:true' and v_t2 = 'ok:false' and pg_temp.marca(T1) is null,
    v_t || ' · ' || v_t2);

  -- 15. errores claros
  v_t := pg_temp.como('authenticated', O, format('select public.seguridad_marcar_cambio_clave(%L)::text', '00000000-0000-4000-8185-0000000000ff'));
  v_t2 := pg_temp.como('authenticated', O, format('select public.seguridad_marcar_cambio_clave(%L)::text', T3));
  perform pg_temp.caso(ro, '15 usuario inexistente (P0002) · cuenta sin contraseña (22023)',
    v_t like 'P0002:%' and v_t2 like '22023:%' and pg_temp.marca(T3) is null, v_t || ' · ' || v_t2);

  -- 16. volver a marcar renueva la huella (después de un cambio)
  v_t := pg_temp.como('authenticated', O, format('select public.seguridad_marcar_cambio_clave(%L)::text', T1));   -- huella H3
  update auth.users set encrypted_password = H2 where id = T1;
  v_t := pg_temp.como('authenticated', O, format('select public.seguridad_marcar_cambio_clave(%L)::text', T1));   -- renueva a H2
  v_t2 := pg_temp.como('authenticated', T1, 'select public.seguridad_debo_cambiar_clave()::text');
  perform pg_temp.caso(ro, '16 re-marcar renueva la huella: sigue obligado con la contraseña de hoy',
    v_t like 'ok:%' and v_t2 = 'ok:true' and pg_temp.marca(T1) = md5(H2), v_t2);

  -- 17. borrar la cuenta borra la marca (cascada)
  delete from auth.users where id = T1;
  perform pg_temp.caso(ro, '17 borrar la cuenta borra su marca (on delete cascade)', pg_temp.marca(T1) is null);
end $t$;

-- Una ronda en una subtransacción descartada; los resultados salen por el DETAIL del error que la descarta.
create function pg_temp.correr(p_ronda text, p_mut text) returns void language plpgsql as $f$
declare d text;
begin
  begin
    if p_mut is not null then execute p_mut; end if;
    perform pg_temp.t185(p_ronda);
    raise exception 'FIN185' using detail = coalesce((select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n)
                                                        from _r185 where ronda = p_ronda), '[]')::text;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlerrm = 'FIN185' then
      insert into _r185 (ronda, caso, ok, detalle)
      select p_ronda, x->>'caso', (x->>'ok')::boolean, x->>'detalle' from jsonb_array_elements(d::jsonb) x;
    else
      insert into _r185 (ronda, caso, ok, detalle) values (p_ronda, 'ERROR', false, sqlerrm);
    end if;
  end;
end $f$;

-- Mutaciones: cada una rompe UNA pieza y declara qué casos tienen que caer.
create temp table _m185 (orden int, nombre text, sql text, caen text[]) on commit drop;
insert into _m185 values
  (1, 'marcar_sin_rol',      $q$select pg_temp.reemplazar('public.seguridad_marcar_cambio_clave(uuid)', 'if public.get_my_role() is distinct from ''owner'' then', 'if false then')$q$, '{03,04,05}'),
  (2, 'debo_sin_huella',     $q$select pg_temp.reemplazar('public.seguridad_debo_cambiar_clave()', 'md5(v_hash) = v_huella', 'true')$q$, '{11}'),
  (3, 'debo_no_libera',      $q$select pg_temp.reemplazar('public.seguridad_debo_cambiar_clave()', 'delete from public.seguridad_cambio_clave c where c.user_id = v_uid;', '')$q$, '{11}'),
  (4, 'lee_todas',           $q$alter policy seguridad_cambio_clave_lee_propia on public.seguridad_cambio_clave using (true)$q$, '{08a}'),
  (5, 'huella_visible',      $q$grant select on public.seguridad_cambio_clave to authenticated$q$, '{01a,08b}'),
  (6, 'escribe_directo',     $q$grant insert, update, delete on public.seguridad_cambio_clave to authenticated;
                                create policy _m6 on public.seguridad_cambio_clave for all to authenticated using (true) with check (true)$q$, '{01a,09,10}'),
  (7, 'anon_ejecuta',        $q$grant execute on function public.seguridad_marcar_cambio_clave(uuid) to anon;
                                grant execute on function public.seguridad_debo_cambiar_clave() to anon$q$, '{01b,06}'),
  (8, 'pendientes_sin_rol',  $q$select pg_temp.reemplazar('public.seguridad_cambio_clave_pendientes()', 'if public.get_my_role() is distinct from ''owner'' then', 'if false then')$q$, '{13}'),
  (9, 'pendientes_no_limpia', $q$select pg_temp.reemplazar('public.seguridad_cambio_clave_pendientes()', 'and md5(u.encrypted_password) = c.huella_hash);', 'or true);')$q$, '{12}'),
  (10, 'remarcar_sin_huella', $q$select pg_temp.reemplazar('public.seguridad_marcar_cambio_clave(uuid)', ', huella_hash = excluded.huella_hash;', ';')$q$, '{16}'),
  (11, 'sin_cascada',         $q$alter table public.seguridad_cambio_clave drop constraint seguridad_cambio_clave_user_id_fkey$q$, '{17}'),
  (12, 'desmarcar_sin_rol',   $q$select pg_temp.reemplazar('public.seguridad_desmarcar_cambio_clave(uuid)', 'if public.get_my_role() is distinct from ''owner'' then', 'if false then')$q$, '{13}');

select pg_temp.correr('base', null);
select pg_temp.correr(m.nombre, m.sql) from _m185 m order by m.orden;

-- Vuelta atrás (en esta misma transacción descartada): sin tabla, sin funciones y sin fila 185 en el ledger.
-- @@185R@@   (aquí va el cuerpo de scripts/sql/185_rollback.sql sin begin/commit)
insert into _r185 (ronda, caso, ok, detalle)
select 'rollback', '18 rollback: sin tabla, sin funciones seguridad_*clave* y sin fila 185',
       to_regclass('public.seguridad_cambio_clave') is null
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.proname like 'seguridad\_%clave%')
       and not exists (select 1 from supabase_migrations.schema_migrations where version = '185'),
       null;

-- Resultado legible
select jsonb_build_object(
  'base', (select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r185 where ronda in ('base', 'rollback')),
  'mutaciones', (select jsonb_agg(jsonb_build_object('m', m.nombre, 'esperan', m.caen, 'caen', c.caen,
                                                     'muerde', m.caen <@ coalesce(c.caen, '{}')) order by m.orden)
                   from _m185 m
                   left join lateral (select array_agg(distinct split_part(r.caso, ' ', 1)) as caen from _r185 r
                                       where r.ronda = m.nombre and not r.ok) c on true)) as resultado;

-- ASSERT: cada caso de la base que falla y cada mutación que NO muerde sale como WARNING («185 FALLA …»), después el
-- resumen («185 RESUMEN: pasaron X / fallaron Y de N») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «185-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 21;    -- 20 casos de la base + el 18 (rollback)
  v_mut constant int := 12;
  v_tot int; v_ok int; v_mal int; v_lista text; v_nm int;
begin
  for r in select caso, detalle from _r185 where ronda in ('base', 'rollback') and ok is not true order by n loop
    raise warning '185 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true),
         string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r185 where ronda in ('base', 'rollback');
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '185 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  -- mutaciones: cada una tiene que hacer caer TODOS los casos que declara
  select count(*) into v_nm from _m185;
  for r in select m.nombre, m.caen, c.caen as cayeron
             from _m185 m
             left join lateral (select array_agg(distinct split_part(x.caso, ' ', 1)) as caen from _r185 x
                                 where x.ronda = m.nombre and not x.ok) c on true
            where not (m.caen <@ coalesce(c.caen, '{}')) order by m.orden loop
    raise warning '185 FALLA mutación % no muerde: esperaba % y cayeron %', r.nombre, r.caen, coalesce(r.cayeron::text, '{}');
    v_mal := v_mal + 1;
    v_lista := concat_ws(',', v_lista, 'mut:' || r.nombre);
  end loop;
  if v_nm <> v_mut then
    raise warning '185 FALLA cantidad de mutaciones: se esperaban % y hay %', v_mut, v_nm;
    v_mal := v_mal + 1;
    v_lista := concat_ws(',', v_lista, 'mutaciones');
  end if;
  raise notice '185 RESUMEN: pasaron % / fallaron % de % (+ % mutaciones)', v_ok, v_mal, v_esp, v_mut;
  if v_mal > 0 then raise exception '185-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
