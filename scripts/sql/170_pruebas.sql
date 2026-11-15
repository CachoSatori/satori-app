-- 170_pruebas (origen club 116) · el manager solo ve y opera el Club en SUS locales. Aplica la 170 dentro de una
-- transacción, arma datos ficticios, prueba y termina en ROLLBACK: no deja nada. Al final un ASSERT: si algún caso
-- falla, aborta con «170-FALLAN: <casos>». Se corre con scripts/sql/170_pruebas.py (--local: Postgres 16 local;
-- --armar: imprime el SQL para staging, con el OK del dueño).
--
-- MARCADORES que llena el runner: «-- @@170@@» → cuerpo de supabase/migrations/170_club_local_manager.sql sin
-- begin/commit; «-- @@170R@@» → cuerpo de scripts/sql/170_rollback.sql sin begin/commit (sin el delete del ledger).
--
-- Todo ficticio: dos locales nuevos (p170-a y p170-b, los dos con el Club encendido), usuarios de prueba por rol y un
-- negocio y un referente en p170-b. JWT simulado con set_config('request.jwt.claims', …, true).
--   M_A: manager de p170-a · M_B: manager de p170-b · M_AB: manager de los dos · M_0: manager sin asignación (091: solo
--   santa-teresa) · M_X: manager inactivo · OW: owner · CO: contador · CA: cajero de p170-a · SA: salonero de p170-a.
-- «Igual que hoy» se prueba comparando, para el mismo usuario y los mismos argumentos, la respuesta del envoltorio con la
-- del núcleo (la función original): tienen que ser idénticas (ok o el mismo error).
begin;

-- huellas de las funciones ANTES de la 170 (el núcleo tiene que quedar byte a byte igual)
create temp table _antes170 on commit drop as
select p.proname::text as nom, md5(p.prosrc) as md5, p.provolatile as vol, pg_get_function_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as res
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = any (array[
   'club_pendientes_listar','club_pedidos_abiertos','club_facturas_recientes','club_excepciones','club_excepcion_resolver',
   'club_reporte_mes','club_comparacion_cargar','club_comparacion','club_reporte_altas','club_reporte_visitas',
   'club_reporte_descuentos','club_alertas_prioritarias','club_promociones_listar','club_promocion_guardar','club_productos',
   'club_cortesias_listar','club_cortesia_guardar','club_marcadores_listar','club_marcador_guardar',
   'club_descuentos_tipo_listar','club_descuento_tipo_guardar','club_socio_alta_caja','club_socio_validar',
   'club_socio_visita','club_negocio_guardar','club_miembro_guardar']);

-- @@170@@   (aquí va el cuerpo de la 170 sin begin/commit)

create temp table _r170 (n serial, caso text, ok boolean, detalle text) on commit drop;

-- ── Usuarios, locales y datos ficticios ───────────────────────────────────────────────────────────────────────────
insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000170a01', '{"full_name":"Prueba P170"}'),
  ('00000000-0000-4000-8000-000000170a02', '{"full_name":"Prueba P170"}'),
  ('00000000-0000-4000-8000-000000170a03', '{"full_name":"Prueba P170"}'),
  ('00000000-0000-4000-8000-000000170a04', '{"full_name":"Prueba P170"}'),
  ('00000000-0000-4000-8000-000000170a05', '{"full_name":"Prueba P170"}'),
  ('00000000-0000-4000-8000-000000170a06', '{"full_name":"Prueba P170"}'),
  ('00000000-0000-4000-8000-000000170a07', '{"full_name":"Prueba P170"}'),
  ('00000000-0000-4000-8000-000000170a08', '{"full_name":"Prueba P170"}'),
  ('00000000-0000-4000-8000-000000170a09', '{"full_name":"Prueba P170"}')
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000170a01', 'Prueba Owner', 'owner', true),
  ('00000000-0000-4000-8000-000000170a02', 'Prueba Contador', 'contador', true),
  ('00000000-0000-4000-8000-000000170a03', 'Prueba Manager A', 'manager', true),
  ('00000000-0000-4000-8000-000000170a04', 'Prueba Manager B', 'manager', true),
  ('00000000-0000-4000-8000-000000170a05', 'Prueba Manager AB', 'manager', true),
  ('00000000-0000-4000-8000-000000170a06', 'Prueba Manager Sin Local', 'manager', true),
  ('00000000-0000-4000-8000-000000170a07', 'Prueba Manager Inactivo', 'manager', false),
  ('00000000-0000-4000-8000-000000170a08', 'Prueba Cajero', 'cajero', true),
  ('00000000-0000-4000-8000-000000170a09', 'Prueba Salonero', 'salonero', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
insert into public.locations (id, name) values ('p170-a', 'Local P170 A'), ('p170-b', 'Local P170 B') on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values ('p170-a', 'Local P170 A', true), ('p170-b', 'Local P170 B', true);
insert into public.profile_locations (profile_id, location_id, principal) values
  ('00000000-0000-4000-8000-000000170a03', 'p170-a', true),
  ('00000000-0000-4000-8000-000000170a04', 'p170-b', true),
  ('00000000-0000-4000-8000-000000170a05', 'p170-a', true),
  ('00000000-0000-4000-8000-000000170a05', 'p170-b', false),
  ('00000000-0000-4000-8000-000000170a07', 'p170-b', true),
  ('00000000-0000-4000-8000-000000170a08', 'p170-a', true),
  ('00000000-0000-4000-8000-000000170a09', 'p170-a', true);
insert into public.club_negocios (id, location_id, nombre, tipo) values
  ('00000000-0000-4000-8000-000000170c01', 'p170-b', 'Negocio Prueba P170', 'hotel');
insert into public.club_miembros (id, location_id, tipo, nombre, negocio_id) values
  ('00000000-0000-4000-8000-000000170b01', 'p170-b', 'referente', 'Prueba Referente P170', '00000000-0000-4000-8000-000000170c01'),
  ('00000000-0000-4000-8000-000000170b02', 'p170-a', 'referente', 'Prueba Referente A P170', null);

-- Llama una función como el usuario dado y devuelve 'ok' o 'SQLSTATE mensaje'. Sin usuario = sin sesión (anon). Lo
-- que la llamada escribe se DESHACE siempre (subtransacción que termina en un error propio): cada llamada ve la misma
-- base, así el envoltorio y el núcleo se comparan sobre los mismos datos.
create function pg_temp.como(p_uid text, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  begin
    execute p_sql;
    raise exception using errcode = 'P0170', message = 'deshacer';
  exception when others then
    v := case when sqlstate = 'P0170' then 'ok' else sqlstate || ' ' || sqlerrm end;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;
create function pg_temp.uid(p text) returns text language sql immutable as $f$
  select '00000000-0000-4000-8000-000000170a0' || case p when 'OW' then '1' when 'CO' then '2' when 'M_A' then '3'
    when 'M_B' then '4' when 'M_AB' then '5' when 'M_0' then '6' when 'M_X' then '7' when 'CA' then '8' when 'SA' then '9' end
$f$;

-- Las llamadas: {F} = nombre de la función (envoltorio o núcleo), {L} = local. lectura = el owner tiene que dar 'ok'.
create temp table _f170 (fn text, llamada text, lectura boolean) on commit drop;
insert into _f170 values
  ('club_pendientes_listar',      $q$select * from public.{F}({L})$q$, true),
  ('club_pedidos_abiertos',       $q$select * from public.{F}({L})$q$, false),   -- sin puente fresco: P0001 de negocio
  ('club_facturas_recientes',     $q$select * from public.{F}({L})$q$, true),
  ('club_excepciones',            $q$select * from public.{F}('2001-03-01', '2001-03-31', {L}, null)$q$, true),
  ('club_excepcion_resolver',     $q$select public.{F}('SIN_CRUCE', 'p170-ref', 'nota de prueba', {L})$q$, false),
  ('club_reporte_mes',            $q$select public.{F}('2001-03-01', {L}, false)$q$, true),
  ('club_comparacion_cargar',     $q$select public.{F}('[]'::jsonb, {L})$q$, false),
  ('club_comparacion',            $q$select * from public.{F}('2001-03-01', '2001-03-31', {L})$q$, true),
  ('club_reporte_altas',          $q$select * from public.{F}('2001-03-01', '2001-03-31', {L})$q$, true),
  ('club_reporte_visitas',        $q$select * from public.{F}('2001-03-01', '2001-03-31', {L})$q$, true),
  ('club_reporte_descuentos',     $q$select * from public.{F}('2001-03-01', '2001-03-31', {L})$q$, true),
  ('club_alertas_prioritarias',   $q$select * from public.{F}({L})$q$, true),
  ('club_promociones_listar',     $q$select * from public.{F}({L})$q$, true),
  ('club_promocion_guardar',      $q$select public.{F}(null, '{}'::jsonb, {L})$q$, false),
  ('club_productos',              $q$select * from public.{F}(null, {L})$q$, true),
  ('club_cortesias_listar',       $q$select * from public.{F}({L})$q$, true),
  ('club_cortesia_guardar',       $q$select public.{F}(null, 'P170C', 'Cortesia de prueba', true, {L})$q$, false),
  ('club_marcadores_listar',      $q$select * from public.{F}({L})$q$, true),
  ('club_marcador_guardar',       $q$select public.{F}(null, 'P170M', 'Marcador de prueba', 10, true, {L})$q$, false),
  ('club_descuentos_tipo_listar', $q$select * from public.{F}({L})$q$, true),
  ('club_descuento_tipo_guardar', $q$select public.{F}(null, 'Tipo de prueba P170', 10, true, {L})$q$, false),
  ('club_socio_alta_caja',        $q$select public.{F}('Socio Prueba', '00000000', null, true, {L})$q$, false),
  ('club_socio_validar',          $q$select public.{F}('00000000-0000-4000-8000-000000170fff', true, {L})$q$, false),
  ('club_socio_visita',           $q$select public.{F}('00000000-0000-4000-8000-000000170fff', '{}'::jsonb, '00000000-0000-4000-8000-000000170eee', {L})$q$, false),
  ('club_negocio_guardar',        $q$select public.{F}(null, 'Negocio Nuevo P170', 'hotel', true, {L})$q$, false),
  ('club_miembro_guardar',        $q$select public.{F}(null, 'referente', 'Referente Nuevo P170', null, null, null, {L})$q$, false);

create function pg_temp.sql_de(p_fn text, p_llamada text, p_nucleo boolean, p_local text) returns text language sql immutable as $f$
  select replace(replace(p_llamada, '{F}', p_fn || case when p_nucleo then '__nucleo' else '' end),
                 '{L}', coalesce(quote_literal(p_local), 'null'))
$f$;

-- 0. catálogo ──────────────────────────────────────────────────────────────────────────────────────────────────────
insert into _r170 (caso, ok, detalle)
select '0a 26 envoltorios y 26 núcleos; mismo nombre, argumentos, defaults, resultado y volatilidad que antes',
       count(*) = 26 and count(*) filter (where w.oid is not null and k.oid is not null) = 26
       and count(*) filter (where pg_get_function_arguments(w.oid) = a.args and pg_get_function_result(w.oid) = a.res
                               and w.provolatile = a.vol and w.prosecdef
                               and w.proconfig = array['search_path=public, pg_temp']) = 26,
       string_agg(a.nom, ',') filter (where w.oid is null or pg_get_function_arguments(w.oid) <> a.args or w.provolatile <> a.vol)
  from _antes170 a
  left join pg_proc w on w.proname = a.nom and w.pronamespace = 'public'::regnamespace
  left join pg_proc k on k.proname = a.nom || '__nucleo' and k.pronamespace = 'public'::regnamespace;

insert into _r170 (caso, ok, detalle)
select '0b el núcleo es la función original byte a byte (md5 del cuerpo igual al de antes)',
       count(*) = 26 and bool_and(md5(k.prosrc) = a.md5), string_agg(a.nom, ',') filter (where md5(k.prosrc) <> a.md5)
  from _antes170 a join pg_proc k on k.proname = a.nom || '__nucleo' and k.pronamespace = 'public'::regnamespace;

insert into _r170 (caso, ok, detalle)
select '0c permisos: envoltorio con EXECUTE para authenticated (no anon ni public); núcleo SIN EXECUTE para authenticated, anon ni public',
       bool_and(has_function_privilege('authenticated', w.oid, 'EXECUTE') and not has_function_privilege('anon', w.oid, 'EXECUTE')
                and not has_function_privilege('authenticated', k.oid, 'EXECUTE')
                and not has_function_privilege('anon', k.oid, 'EXECUTE')
                and not exists (select 1 from aclexplode(k.proacl) x where x.grantee = 0)
                and not exists (select 1 from aclexplode(w.proacl) x where x.grantee = 0)),
       string_agg(a.nom, ',') filter (where has_function_privilege('authenticated', k.oid, 'EXECUTE'))
  from _antes170 a
  join pg_proc w on w.proname = a.nom and w.pronamespace = 'public'::regnamespace
  join pg_proc k on k.proname = a.nom || '__nucleo' and k.pronamespace = 'public'::regnamespace;

insert into _r170 (caso, ok, detalle)
select '0d club_exigir_local: definer, sin EXECUTE para authenticated/anon · club_puede_ver_local: authenticated sí, anon no',
       not has_function_privilege('authenticated', 'public.club_exigir_local(text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_exigir_local(text)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.club_puede_ver_local(text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_puede_ver_local(text)', 'EXECUTE')
       and (select prosecdef from pg_proc where oid = 'public.club_exigir_local(text)'::regprocedure), null;

-- 1. club_puede_ver_local por rol ──────────────────────────────────────────────────────────────────────────────────
create temp table _v170 on commit drop as
select u.r, l.loc,
       (select pg_temp.como(pg_temp.uid(u.r), format('do $d$ begin if not public.club_puede_ver_local(%L) then raise exception ''NO''; end if; end $d$', l.loc))) = 'ok' as ve
  from (values ('OW'), ('CO'), ('M_A'), ('M_B'), ('M_AB'), ('M_0'), ('M_X'), ('CA'), ('SA')) u(r),
       (values ('p170-a'), ('p170-b'), ('santa-teresa')) l(loc);
insert into _r170 (caso, ok, detalle)
select '1a puede_ver_local: owner y contador todos; M_A solo a; M_B solo b; M_AB a y b; M_0 solo santa-teresa; inactivo, cajero y salonero ninguno',
       string_agg(r || ':' || loc || '=' || ve::text, ' ' order by r, loc) =
       'CA:p170-a=false CA:p170-b=false CA:santa-teresa=false CO:p170-a=true CO:p170-b=true CO:santa-teresa=true '
       'M_0:p170-a=false M_0:p170-b=false M_0:santa-teresa=true M_A:p170-a=true M_A:p170-b=false M_A:santa-teresa=false '
       'M_AB:p170-a=true M_AB:p170-b=true M_AB:santa-teresa=false M_B:p170-a=false M_B:p170-b=true M_B:santa-teresa=false '
       'M_X:p170-a=false M_X:p170-b=false M_X:santa-teresa=false OW:p170-a=true OW:p170-b=true OW:santa-teresa=true '
       'SA:p170-a=false SA:p170-b=false SA:santa-teresa=false',
       string_agg(r || ':' || loc || '=' || ve::text, ' ' order by r, loc)
  from _v170;

-- 2. el manager, en cada función ───────────────────────────────────────────────────────────────────────────────────
create temp table _m170 on commit drop as
select f.fn, f.lectura,
       pg_temp.como(pg_temp.uid('M_A'),  pg_temp.sql_de(f.fn, f.llamada, false, 'p170-b')) as ma_b,
       pg_temp.como(pg_temp.uid('M_0'),  pg_temp.sql_de(f.fn, f.llamada, false, 'p170-a')) as m0_a,
       pg_temp.como(pg_temp.uid('M_A'),  pg_temp.sql_de(f.fn, f.llamada, false, 'p170-a')) as ma_a,
       pg_temp.como(pg_temp.uid('M_AB'), pg_temp.sql_de(f.fn, f.llamada, false, 'p170-b')) as mab_b,
       pg_temp.como(pg_temp.uid('M_B'),  pg_temp.sql_de(f.fn, f.llamada, false, 'p170-b')) as mb_b
  from _f170 f;
insert into _r170 (caso, ok, detalle)
select '2a manager de A pidiendo B → 42501 «Sin permiso en ese local» en las 26',
       count(*) = 26 and bool_and(ma_b = '42501 Sin permiso en ese local'),
       string_agg(fn || ' → ' || ma_b, ' | ') filter (where ma_b <> '42501 Sin permiso en ese local')
  from _m170;
insert into _r170 (caso, ok, detalle)
select '2b manager sin asignación (solo santa-teresa) pidiendo A → 42501 en las 26',
       count(*) = 26 and bool_and(m0_a = '42501 Sin permiso en ese local'),
       string_agg(fn || ' → ' || m0_a, ' | ') filter (where m0_a <> '42501 Sin permiso en ese local')
  from _m170;
insert into _r170 (caso, ok, detalle)
select '2c manager en SU local (A en A, B en B, AB en B): pasa el chequeo; las lecturas dan ok',
       bool_and(ma_a not like '%Sin permiso en ese local%' and mb_b not like '%Sin permiso en ese local%'
                and mab_b not like '%Sin permiso en ese local%')
       and bool_and(not lectura or (ma_a = 'ok' and mb_b = 'ok' and mab_b = 'ok')),
       string_agg(fn || ' → ' || ma_a || ' / ' || mb_b || ' / ' || mab_b, ' | ')
         filter (where (lectura and (ma_a <> 'ok' or mb_b <> 'ok' or mab_b <> 'ok')) or ma_a like '%Sin permiso en ese local%'
                    or mb_b like '%Sin permiso en ese local%' or mab_b like '%Sin permiso en ese local%')
  from _m170;

-- 3. todos los demás, igual que hoy: envoltorio = núcleo, para el mismo usuario y argumentos ───────────────────────
create temp table _i170 on commit drop as
select f.fn, f.lectura, u.r,
       pg_temp.como(case when u.r = 'ANON' then null else pg_temp.uid(u.r) end, pg_temp.sql_de(f.fn, f.llamada, false, 'p170-b')) as env,
       pg_temp.como(case when u.r = 'ANON' then null else pg_temp.uid(u.r) end, pg_temp.sql_de(f.fn, f.llamada, true,  'p170-b')) as nuc
  from _f170 f, (values ('OW'), ('CO'), ('CA'), ('SA'), ('M_X'), ('ANON')) u(r);
insert into _r170 (caso, ok, detalle)
select '3a owner, contador, cajero (de A, pidiendo B), salonero, manager inactivo y sin sesión: la misma respuesta que la función original',
       count(*) = 26 * 6 and bool_and(env = nuc),
       string_agg(r || ' ' || fn || ': ' || env || ' ≠ ' || nuc, ' | ') filter (where env <> nuc)
  from _i170;
insert into _r170 (caso, ok, detalle)
select '3b el owner lee todo en B (las lecturas dan ok)',
       bool_and(env = 'ok'), string_agg(fn || ' → ' || env, ' | ') filter (where env <> 'ok')
  from _i170 where r = 'OW' and lectura;
insert into _r170 (caso, ok, detalle)
select '3c el contador sigue entrando donde ya entraba (marcadores y tipos de descuento en B)',
       bool_and(env = 'ok') and count(*) = 2, string_agg(fn || ' → ' || env, ' | ')
  from _i170 where r = 'CO' and fn in ('club_marcadores_listar', 'club_descuentos_tipo_listar');

-- 4. «todos mis locales» = solo los suyos: sin local, la base usa el único encendido ─────────────────────────────────
update public.club_config set club_activo = false where location_id <> 'p170-a' and club_activo;
insert into _r170 (caso, ok, detalle)
select '4a sin local (único encendido = A): M_A ok; M_B → 42501; owner ok',
       pg_temp.como(pg_temp.uid('M_A'), $q$select * from public.club_reporte_visitas('2001-03-01', '2001-03-31', null)$q$) = 'ok'
       and pg_temp.como(pg_temp.uid('M_B'), $q$select * from public.club_reporte_visitas('2001-03-01', '2001-03-31', null)$q$)
           = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('OW'), $q$select * from public.club_reporte_visitas('2001-03-01', '2001-03-31', null)$q$) = 'ok',
       null;
update public.club_config set club_activo = true where location_id = 'p170-b';

-- 5. cubiertas por nombre (sin envoltorio propio) ──────────────────────────────────────────────────────────────────
insert into _r170 (caso, ok, detalle)
select '5a club_excepciones_abiertas y club_reporte_exportar: M_A pidiendo B → 42501; en A pasa',
       pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_excepciones_abiertas(30, 'p170-b')$q$) = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_reporte_exportar('2001-03-01', 'p170-b', 'csv')$q$) = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_excepciones_abiertas(30, 'p170-a')$q$) = 'ok'
       and pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_reporte_exportar('2001-03-01', 'p170-a', 'csv')$q$) = 'ok',
       pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_reporte_exportar('2001-03-01', 'p170-a', 'csv')$q$);

-- 6. edición por id: cuenta el local del objeto, no el que se manda ────────────────────────────────────────────────
insert into _r170 (caso, ok, detalle)
select '6a M_A edita el negocio y el referente de B mandando p_location = A → 42501; M_B los edita',
       pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_negocio_guardar('00000000-0000-4000-8000-000000170c01', 'Negocio Cambiado', 'hotel', true, 'p170-a')$q$)
         = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_miembro_guardar('00000000-0000-4000-8000-000000170b01', 'referente', 'Referente Cambiado', null, 'baja', null, 'p170-a')$q$)
         = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('M_B'), $q$select public.club_negocio_guardar('00000000-0000-4000-8000-000000170c01', 'Negocio Cambiado', 'hotel', true, 'p170-b')$q$) = 'ok'
       and pg_temp.como(pg_temp.uid('M_B'), $q$select public.club_miembro_guardar('00000000-0000-4000-8000-000000170b01', 'referente', 'Referente Cambiado', '00000000-0000-4000-8000-000000170c01', null, null, 'p170-b')$q$) = 'ok',
       null;
insert into _r170 (caso, ok, detalle)
select '6b alta de referente sin local, con negocio de B: M_A → 42501 (el local sale del negocio)',
       pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_miembro_guardar(null, 'referente', 'Otro Referente P170', '00000000-0000-4000-8000-000000170c01', null, null, null)$q$)
         = '42501 Sin permiso en ese local', null;

insert into _r170 (caso, ok, detalle)
select '6c M_A cuelga un referente de A del negocio de B (edición y alta con p_location = A) → 42501; M_AB puede; el owner, igual que hoy',
       pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_miembro_guardar('00000000-0000-4000-8000-000000170b02', 'referente', 'Referente A', '00000000-0000-4000-8000-000000170c01', null, null, 'p170-a')$q$)
         = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_miembro_guardar(null, 'referente', 'Otro Referente A', '00000000-0000-4000-8000-000000170c01', null, null, 'p170-a')$q$)
         = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_miembro_guardar('00000000-0000-4000-8000-000000170b02', 'referente', 'Referente A', null, null, null, 'p170-a')$q$) = 'ok'
       and pg_temp.como(pg_temp.uid('M_AB'), $q$select public.club_miembro_guardar('00000000-0000-4000-8000-000000170b02', 'referente', 'Referente A', '00000000-0000-4000-8000-000000170c01', null, null, 'p170-a')$q$) = 'ok'
       and pg_temp.como(pg_temp.uid('OW'), $q$select public.club_miembro_guardar('00000000-0000-4000-8000-000000170b02', 'referente', 'Referente A', '00000000-0000-4000-8000-000000170c01', null, null, 'p170-a')$q$)
         = pg_temp.como(pg_temp.uid('OW'), $q$select public.club_miembro_guardar__nucleo('00000000-0000-4000-8000-000000170b02', 'referente', 'Referente A', '00000000-0000-4000-8000-000000170c01', null, null, 'p170-a')$q$),
       null;

-- 7. la API no llega al núcleo: authenticated no lo puede ejecutar ─────────────────────────────────────────────────
create temp table _k170 (r text) on commit drop;
grant insert on _k170 to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000170a03', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform * from public.club_reporte_visitas__nucleo('2001-03-01', '2001-03-31', 'p170-b');
    insert into _k170 values ('ok');
  exception when others then insert into _k170 values (sqlstate);
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
insert into _r170 (caso, ok, detalle)
select '7a como authenticated (rol de la API), el núcleo da 42501 (permission denied)', r = '42501', r from _k170;

-- 8. vuelta atrás (en esta misma transacción descartada) ───────────────────────────────────────────────────────────
-- @@170R@@   (aquí va el cuerpo de scripts/sql/170_rollback.sql sin begin/commit)
insert into _r170 (caso, ok, detalle)
select '8a rollback: sin núcleos ni helpers; las 26 vuelven con el cuerpo, la volatilidad y authenticated con EXECUTE',
       not exists (select 1 from pg_proc where proname like 'club\_%\_\_nucleo')
       and to_regprocedure('public.club_exigir_local(text)') is null
       and to_regprocedure('public.club_puede_ver_local(text)') is null
       and (select count(*) from _antes170 a join pg_proc p on p.proname = a.nom and p.pronamespace = 'public'::regnamespace
             where md5(p.prosrc) = a.md5 and p.provolatile = a.vol and pg_get_function_arguments(p.oid) = a.args
               and has_function_privilege('authenticated', p.oid, 'EXECUTE')
               and not has_function_privilege('anon', p.oid, 'EXECUTE')) = 26, null;
insert into _r170 (caso, ok, detalle)
select '8b rollback: vuelve el hallazgo (M_A otra vez lee B): la prueba distingue',
       pg_temp.como(pg_temp.uid('M_A'), $q$select * from public.club_reporte_visitas('2001-03-01', '2001-03-31', 'p170-b')$q$) = 'ok', null;

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r170;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r170 where not ok or ok is null;
  if v is not null then raise exception '170-FALLAN: %', v; end if;
  if (select count(*) from _r170) < 19 then raise exception '170-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
