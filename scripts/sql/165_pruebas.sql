-- 165_pruebas (origen club 111) · B10 · Bitácora de permisos. Postgres local o STAGING (nunca prod).
-- Aplica la 165 dentro de una transacción, corre la batería y TODAS las mutaciones, y termina en ROLLBACK: no deja nada.
--
-- MARCADOR que llena el runner (165_pruebas.py): la línea «-- @@165@@ …» → el cuerpo de
-- supabase/migrations/165_admin_bitacora_permisos.sql sin begin; / commit; (con --local, precedido de
-- scripts/sql/165_preludio_local.sql: policies de profiles como prod y permisos de Supabase).
--
-- La batería crea sus propios usuarios (UUID fijos, correos .test ficticios) en auth.users: el alta dispara
-- handle_new_user (perfil salonero inactivo) como en la base real. Los JWT se simulan con request.jwt.claims y
-- `set local role authenticated|service_role|anon`. Las rutas de actualización probadas son las reales del repo:
--   · Admin → Usuarios: updateProfileRole / setProfileActive (owner, PostgREST: update profiles set role|is_active);
--   · updateProfileName (update full_name), y un cambio de correo;
--   · alta-empleado (rama claude/alta-empleado-fn): createUser con service_role → update {role, is_active} con el JWT
--     del owner → compensación deleteUser (cascada);
--   · login: GoTrue actualiza auth.users (last_sign_in_at), nunca profiles; get_my_role() sigue igual;
--   · sesión sin JWT (Management API / postgres) y service_role.
-- Cada ronda corre en una subtransacción que se descarta. Una mutación rompe a propósito UNA pieza y declara qué casos
-- tienen que caer. NO PROBADO no da verde: si falta la tabla o un prerrequisito, cae el 00.
begin;

-- @@165@@   (aquí va el cuerpo de la 165 sin begin/commit)

create temp table _r165 (n serial, ronda text, caso text, ok boolean, detalle text) on commit drop;
grant all on _r165 to public;
grant all on sequence _r165_n_seq to public;

create function pg_temp.caso(p_ronda text, p_caso text, p_ok boolean, p_det text default null) returns void language sql as $f$
  insert into _r165 (ronda, caso, ok, detalle) values (p_ronda, p_caso, coalesce(p_ok, false), p_det);
$f$;

create function pg_temp.reemplazar(p_fn regprocedure, p_viejo text, p_nuevo text) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_fn);
begin
  if position(p_viejo in d) = 0 then raise exception 'ANCLA: «%» no está en %', p_viejo, p_fn; end if;
  execute replace(d, p_viejo, p_nuevo);
end $f$;

-- Corre p_sql como p_rol ('authenticated' | 'service_role' | 'anon' | NULL = sin JWT, el usuario de la sesión) con
-- el sub dado. Devuelve 'ok', o el SQLSTATE y el mensaje del error. Si p_sql es un SELECT de un número, 'ok:<n>'.
create function pg_temp.como(p_rol text, p_sub uuid, p_sql text) returns text language plpgsql as $f$
declare v bigint; r text;
begin
  begin
    perform set_config('request.jwt.claims',
      case when p_rol is null then ''
           else json_build_object('sub', p_sub, 'role', p_rol)::text end, true);
    if p_rol is not null then execute format('set local role %I', p_rol); end if;
    if p_sql ~* '^\s*select' then execute p_sql into v; r := 'ok:' || coalesce(v::text, 'null');
    else execute p_sql; r := 'ok'; end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return r;
  exception when others then
    -- el subbloque se descarta: el rol y los claims vuelven a los de antes
    return sqlstate || ':' || sqlerrm;
  end;
end $f$;

create function pg_temp.n_bit(p_perfil uuid) returns int language sql as $f$
  select count(*)::int from public.bitacora_permisos where profile_id = p_perfil;
$f$;

create function pg_temp.t165(ro text) returns void language plpgsql as $t$
declare
  O  uuid := '00000000-0000-4000-8000-000000016501';   -- owner de prueba
  M  uuid := '00000000-0000-4000-8000-000000016502';   -- manager
  C  uuid := '00000000-0000-4000-8000-000000016503';   -- cajero
  S  uuid := '00000000-0000-4000-8000-000000016504';   -- salonero al que se le cambian permisos
  N  uuid := '00000000-0000-4000-8000-000000016505';   -- alta-empleado (se compensa con deleteUser)
  N2 uuid := '00000000-0000-4000-8000-000000016506';   -- borrado con local asignado (cascada)
  v_n int; v_t text; v_ok boolean; v_r record; v_tot int; v_loc text;
begin
  perform pg_temp.caso(ro, '00 prerrequisitos: tabla, triggers y un local',
    to_regclass('public.bitacora_permisos') is not null
    and exists (select 1 from public.locations)
    and (select count(*) from pg_trigger where not tgisinternal and tgname in
          ('trg_profiles_bitacora_permisos','trg_profile_locations_bitacora_permisos',
           'trg_bitacora_permisos_inmutable','trg_bitacora_permisos_sin_truncate')) >= 2);
  if to_regclass('public.bitacora_permisos') is null or not exists (select 1 from public.locations) then return; end if;
  select id into v_loc from public.locations order by id limit 1;

  -- 01. arranca vacía: la 165 no inventa historia
  select count(*) into v_n from public.bitacora_permisos;
  perform pg_temp.caso(ro, '01 la bitácora arranca vacía (sin carga inicial)', v_n = 0, v_n || ' filas');

  -- 02. catálogo: definer + search_path donde escribe; nada ejecutable por anon/authenticated; la tabla solo SELECT
  select bool_and(case when p.proname in ('bitacora_permisos_profiles','bitacora_permisos_locales') then p.prosecdef
                       else not p.prosecdef end
                  and p.proconfig = array['search_path=public, pg_temp']
                  and not has_function_privilege('anon', p.oid, 'EXECUTE')
                  and not has_function_privilege('authenticated', p.oid, 'EXECUTE')), count(*)
    into v_ok, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'bitacora_permisos%';
  perform pg_temp.caso(ro, '02a funciones: definer solo las que escriben · search_path fijo · sin anon ni authenticated',
    v_ok and v_n = 4, v_n || ' funciones');
  perform pg_temp.caso(ro, '02b tabla: RLS · authenticated y service_role solo SELECT · anon nada',
    (select relrowsecurity from pg_class where oid = 'public.bitacora_permisos'::regclass)
    and has_table_privilege('authenticated', 'public.bitacora_permisos', 'SELECT')
    and not has_table_privilege('authenticated', 'public.bitacora_permisos', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('service_role', 'public.bitacora_permisos', 'INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('anon', 'public.bitacora_permisos', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));

  -- ── usuarios de prueba (alta como lo hace GoTrue: sin JWT) ──
  insert into auth.users (id, email, raw_user_meta_data) values
    (O, 'o165@ejemplo.test', '{"full_name":"Owner Prueba"}'), (M, 'm165@ejemplo.test', '{"full_name":"Manager Prueba"}'),
    (C, 'c165@ejemplo.test', '{"full_name":"Cajero Prueba"}'), (S, 's165@ejemplo.test', '{"full_name":"Salonero Prueba"}');
  select count(*) into v_n from public.bitacora_permisos;
  perform pg_temp.caso(ro, '03a el alta (INSERT de profiles, handle_new_user) no registra', v_n = 0
    and (select count(*) from public.profiles where id in (O, M, C, S) and role = 'salonero' and not is_active) = 4);
  -- sin JWT (Management API / postgres): queda como «sistema»
  update public.profiles set role = 'owner', is_active = true where id = O;
  update public.profiles set role = 'manager', is_active = true where id = M;
  update public.profiles set role = 'cajero', is_active = true where id = C;
  update public.profiles set is_active = true where id = S;
  select count(*) into v_n from public.bitacora_permisos
   where profile_id = O and cambiado_por is null and origen = 'sistema'
     and ((campo = 'rol' and antes = 'salonero' and despues = 'owner') or (campo = 'activo' and antes = 'false' and despues = 'true'));
  perform pg_temp.caso(ro, '03b sin sesión: rol y activo, de qué a qué, como sistema', v_n = 2 and pg_temp.n_bit(S) = 1, v_n || ' filas de O');

  -- 04. Admin → Usuarios: updateProfileRole (owner)
  v_t := pg_temp.como('authenticated', O, format('update public.profiles set role = %L where id = %L', 'cajero', S));
  select * into v_r from public.bitacora_permisos where profile_id = S and campo = 'rol' order by id desc limit 1;
  perform pg_temp.caso(ro, '04 cambiar rol (owner): quién, cuándo, de qué a qué',
    v_t = 'ok' and v_r.antes = 'salonero' and v_r.despues = 'cajero' and v_r.cambiado_por = O and v_r.origen = 'sesion'
    and v_r.cambiado_en = now() and (select role::text from public.profiles where id = S) = 'cajero', v_t);

  -- 05. setProfileActive(false) y vuelta
  v_t := pg_temp.como('authenticated', O, format('update public.profiles set is_active = false where id = %L', S));
  select * into v_r from public.bitacora_permisos where profile_id = S and campo = 'activo' order by id desc limit 1;
  v_ok := v_t = 'ok' and v_r.antes = 'true' and v_r.despues = 'false' and v_r.cambiado_por = O;
  v_t := pg_temp.como('authenticated', O, format('update public.profiles set is_active = true where id = %L', S));
  perform pg_temp.caso(ro, '05 deshabilitar / habilitar: una fila por cambio', v_ok and v_t = 'ok' and pg_temp.n_bit(S) = 4, v_t);

  -- 06. updateProfileName y correo: funcionan y no registran
  v_n := pg_temp.n_bit(S);
  v_t := pg_temp.como('authenticated', O, format('update public.profiles set full_name = %L, email = %L where id = %L',
                                                 'Salonero Renombrado', 's165b@ejemplo.test', S));
  perform pg_temp.caso(ro, '06 nombre y correo: el update pasa y no registra (no son permisos)',
    v_t = 'ok' and pg_temp.n_bit(S) = v_n and (select full_name from public.profiles where id = S) = 'Salonero Renombrado', v_t);

  -- 07. mismo valor (el select de Admin manda el rol que ya tiene): no registra
  v_t := pg_temp.como('authenticated', O, format('update public.profiles set role = %L, is_active = true where id = %L', 'cajero', S));
  perform pg_temp.caso(ro, '07 mismo rol y misma activación: no registra', v_t = 'ok' and pg_temp.n_bit(S) = v_n, v_t);

  -- 08. alta-empleado: createUser → update {role, is_active} con el JWT del owner → deleteUser. createUser/deleteUser
  --     los ejecuta GoTrue con su propio rol de base (sin JWT de PostgREST): acá, la sesión sin claims.
  v_t := pg_temp.como(null, null, format('insert into auth.users (id, email, raw_user_meta_data) values (%L, %L, %L)',
                                                   N, 'n165@ejemplo.test', '{"full_name":"Alta Prueba"}'));
  v_ok := v_t = 'ok' and pg_temp.n_bit(N) = 0;
  v_t := pg_temp.como('authenticated', O, format('update public.profiles set role = %L, is_active = true where id = %L', 'manager', N));
  v_ok := v_ok and v_t = 'ok'
    and (select count(*) from public.bitacora_permisos where profile_id = N and cambiado_por = O and origen = 'sesion'
           and ((campo = 'rol' and antes = 'salonero' and despues = 'manager') or (campo = 'activo' and despues = 'true'))) = 2;
  v_t := pg_temp.como(null, null, format('delete from auth.users where id = %L', N));
  perform pg_temp.caso(ro, '08 alta-empleado: rol y activación del owner quedan; la compensación (deleteUser) no se traba',
    v_ok and v_t = 'ok' and not exists (select 1 from public.profiles where id = N) and pg_temp.n_bit(N) = 2, v_t);

  -- 09. service_role cambia un permiso: queda como service_role, sin actor
  v_t := pg_temp.como('service_role', null, format('update public.profiles set role = %L where id = %L', 'salonero', S));
  select * into v_r from public.bitacora_permisos where profile_id = S and campo = 'rol' order by id desc limit 1;
  perform pg_temp.caso(ro, '09 service_role: registrado como service_role',
    v_t = 'ok' and v_r.despues = 'salonero' and v_r.cambiado_por is null and v_r.origen = 'service_role', v_t);

  -- 10. un manager no puede cambiar roles (RLS: 0 filas; si llegara, la guarda de la 068 frena) y no queda nada
  v_n := pg_temp.n_bit(S);
  v_t := pg_temp.como('authenticated', M, format('update public.profiles set role = %L where id = %L', 'owner', S));
  perform pg_temp.caso(ro, '10 manager intenta cambiar un rol: no pasa y no registra',
    v_t not like '%B10%' and pg_temp.n_bit(S) = v_n and (select role::text from public.profiles where id = S) = 'salonero', v_t);

  -- 11. login: GoTrue toca auth.users, no profiles; get_my_role sigue
  v_n := (select count(*) from public.bitacora_permisos);
  update auth.users set last_sign_in_at = now() where id in (O, S);
  v_t := pg_temp.como('authenticated', O, 'select count(*) from public.profiles where id = auth.uid() and public.get_my_role() = ''owner''');
  perform pg_temp.caso(ro, '11 login: sin error, sin filas, get_my_role igual',
    v_t = 'ok:1' and (select count(*) from public.bitacora_permisos) = v_n, v_t);

  -- 12. lectura: owner ve todo; manager, cajero y anon no
  v_tot := (select count(*) from public.bitacora_permisos);
  v_t := pg_temp.como('authenticated', O, 'select count(*) from public.bitacora_permisos');
  v_ok := v_t = 'ok:' || v_tot and v_tot > 0;
  v_t := pg_temp.como('authenticated', M, 'select count(*) from public.bitacora_permisos');
  v_ok := v_ok and v_t = 'ok:0';
  v_t := pg_temp.como('authenticated', C, 'select count(*) from public.bitacora_permisos');
  v_ok := v_ok and v_t = 'ok:0';
  v_t := pg_temp.como('anon', null, 'select count(*) from public.bitacora_permisos');
  perform pg_temp.caso(ro, '12 lectura: owner todo; manager, cajero 0; anon sin permiso', v_ok and v_t like '42501:%', v_t);

  -- 13. authenticated (aunque sea owner) no inserta, no edita, no borra, no trunca
  v_t := pg_temp.como('authenticated', O, format(
    'insert into public.bitacora_permisos (profile_id, campo, antes, despues, cambiado_por, origen) values (%L, ''rol'', ''owner'', ''salonero'', %L, ''sesion'')', S, M));
  v_ok := v_t like '42501:%';
  v_t := pg_temp.como('authenticated', O, 'update public.bitacora_permisos set despues = ''owner''');
  v_ok := v_ok and v_t like '42501:%';
  v_t := pg_temp.como('authenticated', O, 'delete from public.bitacora_permisos');
  v_ok := v_ok and v_t like '42501:%';
  v_t := pg_temp.como('authenticated', O, 'truncate public.bitacora_permisos');
  perform pg_temp.caso(ro, '13 authenticated (owner): no inserta falsas, no edita, no borra, no trunca',
    v_ok and v_t like '42501:%' and (select count(*) from public.bitacora_permisos) = v_tot, v_t);

  -- 14. service_role: sin privilegio; el dueño de la tabla: frenado por el trigger
  v_t := pg_temp.como('service_role', null, 'update public.bitacora_permisos set despues = ''owner''');
  v_ok := v_t like '42501:permission denied%';
  v_t := pg_temp.como('service_role', null, 'delete from public.bitacora_permisos');
  v_ok := v_ok and v_t like '42501:permission denied%';
  v_t := pg_temp.como('service_role', null, 'insert into public.bitacora_permisos (profile_id, campo, origen) values (gen_random_uuid(), ''rol'', ''sistema'')');
  v_ok := v_ok and v_t like '42501:permission denied%';
  v_t := pg_temp.como(null, null, 'update public.bitacora_permisos set despues = ''owner''');
  v_ok := v_ok and v_t like '42501:B10%';
  v_t := pg_temp.como(null, null, 'delete from public.bitacora_permisos');
  v_ok := v_ok and v_t like '42501:B10%';
  v_t := pg_temp.como(null, null, 'truncate public.bitacora_permisos');
  perform pg_temp.caso(ro, '14 service_role sin privilegio; dueño de la tabla frenado (update/delete/truncate)',
    v_ok and v_t like '42501:B10%' and (select count(*) from public.bitacora_permisos) = v_tot, v_t);

  -- 15. local asignado (profile_locations): asignar, marcar principal, quitar
  v_t := pg_temp.como('authenticated', O, format('insert into public.profile_locations (profile_id, location_id) values (%L, %L)', S, v_loc));
  v_ok := v_t = 'ok' and exists (select 1 from public.bitacora_permisos where profile_id = S and campo = 'local'
                                   and antes is null and despues = v_loc and cambiado_por = O);
  v_t := pg_temp.como('authenticated', O, format('update public.profile_locations set principal = true where profile_id = %L', S));
  v_ok := v_ok and v_t = 'ok' and exists (select 1 from public.bitacora_permisos where profile_id = S and campo = 'local'
                                            and antes = v_loc and despues = v_loc || ' (principal)');
  v_t := pg_temp.como('authenticated', O, format('delete from public.profile_locations where profile_id = %L', S));
  perform pg_temp.caso(ro, '15 local asignado: alta, principal y baja quedan',
    v_ok and v_t = 'ok' and exists (select 1 from public.bitacora_permisos where profile_id = S and campo = 'local'
                                      and antes = v_loc || ' (principal)' and despues is null), v_t);

  -- 16. borrar una cuenta con local asignado (cascada): no falla y no se registra como «local quitado»
  insert into auth.users (id, email) values (N2, 'n2165@ejemplo.test');
  insert into public.profile_locations (profile_id, location_id) values (N2, v_loc);
  v_n := pg_temp.n_bit(N2);
  v_t := pg_temp.como(null, null, format('delete from auth.users where id = %L', N2));
  perform pg_temp.caso(ro, '16 borrado en cascada con local: pasa y no registra la baja del local',
    v_t = 'ok' and v_n = 1 and pg_temp.n_bit(N2) = 1, v_t || ' · antes ' || v_n);

  -- 17. fail closed (decisión): si la bitácora no puede insertar, el cambio de permiso no pasa
  begin
    alter table public.bitacora_permisos add constraint _165_imposible check (false) not valid;
    v_t := pg_temp.como('authenticated', O, format('update public.profiles set role = %L where id = %L', 'runner', S));
    v_ok := v_t like '23514:%' and (select role::text from public.profiles where id = S) = 'salonero';
    -- y el resto de profiles (nombre) sigue funcionando aunque la bitácora esté rota
    v_t := pg_temp.como('authenticated', O, format('update public.profiles set full_name = %L where id = %L', 'Otro Nombre', S));
    v_ok := v_ok and v_t = 'ok';
    raise exception 'FIN17';
  exception when others then
    if sqlerrm <> 'FIN17' then v_ok := false; v_t := sqlerrm; end if;
  end;
  perform pg_temp.caso(ro, '17 bitácora que no puede insertar: el cambio de rol falla; nombre sigue andando', v_ok, v_t);

  -- 18. salida de urgencia (guía 6.6): con la bitácora rota, soporte (dueño de la tabla, sin JWT) desactiva en UNA
  --     transacción apagando y prendiendo el trigger; cuando la bitácora vuelve, lo anota a mano con origen 'manual'.
  begin
    alter table public.bitacora_permisos add constraint _165_rota check (false) not valid;
    v_t := pg_temp.como(null, null, format('update public.profiles set is_active = false where id = %L', C));
    v_ok := v_t like '23514:%';   -- sin la salida, ni el editor SQL puede
    v_t := pg_temp.como(null, null, format(
      'alter table public.profiles disable trigger trg_profiles_bitacora_permisos; '
      'update public.profiles set is_active = false where id = %L; '
      'alter table public.profiles enable trigger trg_profiles_bitacora_permisos', C));
    v_ok := v_ok and v_t = 'ok' and not (select is_active from public.profiles where id = C)
      and (select tgenabled = 'O' from pg_trigger where tgname = 'trg_profiles_bitacora_permisos');
    alter table public.bitacora_permisos drop constraint _165_rota;
    v_t := pg_temp.como(null, null, format(
      'insert into public.bitacora_permisos (profile_id, campo, antes, despues, cambiado_por, origen, cambiado_en) '
      'values (%L, ''activo'', ''true'', ''false'', null, ''manual'', %L)', C, '2026-11-14 23:30:00-06'));
    v_ok := v_ok and v_t = 'ok' and exists (select 1 from public.bitacora_permisos where profile_id = C and origen = 'manual'
                                              and cambiado_en = '2026-11-15 05:30:00+00');
    raise exception 'FIN18';
  exception when others then
    if sqlerrm <> 'FIN18' then v_ok := false; v_t := sqlerrm; end if;
  end;
  perform pg_temp.caso(ro, '18 urgencia: con la bitácora rota, desactivar apagando y prendiendo el trigger; anotar a mano', v_ok, v_t);
end $t$;

-- Una ronda en una subtransacción descartada; los resultados salen por el DETAIL del error que la descarta.
create function pg_temp.correr(p_ronda text, p_mut text) returns void language plpgsql as $f$
declare d text;
begin
  begin
    if p_mut is not null then execute p_mut; end if;
    perform pg_temp.t165(p_ronda);
    raise exception 'FIN165' using detail = coalesce((select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n)
                                                        from _r165 where ronda = p_ronda), '[]')::text;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlerrm = 'FIN165' then
      insert into _r165 (ronda, caso, ok, detalle)
      select p_ronda, x->>'caso', (x->>'ok')::boolean, x->>'detalle' from jsonb_array_elements(d::jsonb) x;
    else
      insert into _r165 (ronda, caso, ok, detalle) values (p_ronda, 'ERROR', false, sqlerrm);
    end if;
  end;
end $f$;

create temp table _m165 (orden int, nombre text, sql text, caen text[]) on commit drop;
insert into _m165 values
  (1, 'sin_trigger_profiles', $q$drop trigger trg_profiles_bitacora_permisos on public.profiles$q$, '{03b,04,05,08,09}'),
  (2, 'sin_actor',            $q$select pg_temp.reemplazar('public.bitacora_permisos_actor()', 'actor := auth.uid();', 'actor := null;')$q$, '{04,05,08}'),
  (3, 'registra_todo',        $q$drop trigger trg_profiles_bitacora_permisos on public.profiles;
                                 select pg_temp.reemplazar('public.bitacora_permisos_profiles()', 'if old.role is distinct from new.role then', 'if true then');
                                 create trigger trg_profiles_bitacora_permisos after update on public.profiles
                                   for each row execute function public.bitacora_permisos_profiles()$q$, '{06,07}'),
  (4, 'insert_abierto',       $q$grant insert on public.bitacora_permisos to authenticated;
                                 create policy _m4 on public.bitacora_permisos for insert to authenticated with check (true)$q$, '{02b,13}'),
  (5, 'service_role_escribe', $q$grant update, delete on public.bitacora_permisos to service_role$q$, '{02b,14}'),
  (6, 'sin_inmutable',        $q$drop trigger trg_bitacora_permisos_inmutable on public.bitacora_permisos;
                                 drop trigger trg_bitacora_permisos_sin_truncate on public.bitacora_permisos$q$, '{14}'),
  (7, 'lee_cualquier_rol',    $q$alter policy bitacora_permisos_lee_owner on public.bitacora_permisos using (public.get_my_role() is not null)$q$, '{12}'),
  (8, 'sin_trigger_locales',  $q$drop trigger trg_profile_locations_bitacora_permisos on public.profile_locations$q$, '{15}'),
  (9, 'cascada_registra',     $q$select pg_temp.reemplazar('public.bitacora_permisos_locales()', 'if not exists (select 1 from public.profiles p where p.id = old.profile_id) then', 'if false then')$q$, '{16}'),
  (10, 'traga_errores',       $q$select pg_temp.reemplazar('public.bitacora_permisos_profiles()', 'return null;
end;', 'return null;
exception when others then return null;
end;')$q$, '{17}'),
  (11, 'carga_inicial',       $q$insert into public.bitacora_permisos (profile_id, campo, antes, despues, origen)
                                 values (gen_random_uuid(), 'rol', null, 'owner', 'sistema')$q$, '{01}'),
  (12, 'sin_origen_manual',   $q$alter table public.bitacora_permisos drop constraint bitacora_permisos_origen_check;
                                 alter table public.bitacora_permisos add constraint bitacora_permisos_origen_check
                                   check (origen in ('sesion', 'service_role', 'sistema'))$q$, '{18}');

select pg_temp.correr('base', null);
select pg_temp.correr(m.nombre, m.sql) from _m165 m order by m.orden;

select jsonb_build_object(
  'base_casos', (select count(*) from _r165 where ronda = 'base'),
  'base_fallan', (select coalesce(jsonb_agg(jsonb_build_object('caso', caso, 'detalle', detalle) order by n), '[]') from _r165 where ronda = 'base' and not ok),
  'mutaciones', (select jsonb_agg(jsonb_build_object('m', m.nombre, 'esperan', m.caen, 'caen', c.caen,
                                                     'muerde', m.caen <@ coalesce(c.caen, '{}')) order by m.orden)
                   from _m165 m
                   left join lateral (select array_agg(distinct split_part(r.caso, ' ', 1)) as caen from _r165 r
                                       where r.ronda = m.nombre and not r.ok) c on true)) as resultado;

rollback;
