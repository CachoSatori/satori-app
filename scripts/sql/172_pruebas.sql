-- 172_pruebas (origen club 118, hallazgo 231) · el manager solo ve y opera el Club en SUS locales, segunda tanda.
-- Aplica la 172 dentro de una transacción, arma datos ficticios, prueba y termina en ROLLBACK: no deja nada. Al final un
-- ASSERT: si algún caso falla, aborta con «172-FALLAN: <casos>». Se corre con scripts/sql/172_pruebas.py (--local:
-- Postgres 16 local; --armar: imprime el SQL para staging, con el OK del dueño). Necesita la 170 en la base.
--
-- MARCADORES que llena el runner: «-- @@172@@» → cuerpo de supabase/migrations/172_club_local_manager_2.sql sin
-- begin/commit; «-- @@172R@@» → cuerpo de scripts/sql/172_rollback.sql sin begin/commit (sin el delete del ledger).
--
-- Todo ficticio: dos locales nuevos (p172-a y p172-b, los dos con el Club encendido), usuarios de prueba por rol y, en
-- p172-b, un negocio, un anfitrión, un socio con alta provisional, un cupón, un canje con pedido, un pendiente, una
-- alerta y una visita de socio. JWT simulado con set_config('request.jwt.claims', …, true).
--   M_A: manager de p172-a · M_B: manager de p172-b · M_AB: manager de los dos · M_0: manager sin asignación (091: solo
--   santa-teresa) · M_X: manager inactivo · OW: owner · CO: contador · CA: cajero de p172-a · SA: salonero de p172-a.
-- «Igual que hoy» se prueba comparando, para el mismo usuario y los mismos argumentos, la respuesta del envoltorio con la
-- del núcleo (la función original): tienen que ser idénticas (ok o el mismo error).
begin;

-- huellas de las funciones ANTES de la 172 (el núcleo tiene que quedar byte a byte igual)
create temp table _antes172 on commit drop as
select p.proname::text as nom, md5(p.prosrc) as md5, p.provolatile as vol, pg_get_function_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as res
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = any (array[
   'club_reporte_equipo','club_primeros90_config_ver','club_reto_en_visita','club_miembro_contacto_ver','club_miembro_codigo',
   'club_miembro_token','club_miembro_regenerar_codigo','club_pase_token','club_rol_activar_anfitrion','club_socio_confirmar',
   'club_resolver_miembro','club_canje','club_canje_aprobado','club_tarjeta_manual','club_cupon_usar','club_canje_aviso',
   'club_sin_cruce_candidatas','club_sin_cruce_elegir','club_pendiente_resolver','club_alerta_revisar']);
create temp table _n170 on commit drop as
select count(*) as n from pg_proc where proname like 'club\_%\_\_nucleo' and pronamespace = 'public'::regnamespace;

-- @@172@@   (aquí va el cuerpo de la 172 sin begin/commit)

create temp table _r172 (n serial, caso text, ok boolean, detalle text) on commit drop;

-- ── Usuarios, locales y datos ficticios ───────────────────────────────────────────────────────────────────────────
insert into auth.users (id, raw_user_meta_data)
select ('00000000-0000-4000-8000-000000172a0' || i)::uuid, '{"full_name":"Prueba P172"}'::jsonb from generate_series(1, 9) i
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000172a01', 'Prueba Owner', 'owner', true),
  ('00000000-0000-4000-8000-000000172a02', 'Prueba Contador', 'contador', true),
  ('00000000-0000-4000-8000-000000172a03', 'Prueba Manager A', 'manager', true),
  ('00000000-0000-4000-8000-000000172a04', 'Prueba Manager B', 'manager', true),
  ('00000000-0000-4000-8000-000000172a05', 'Prueba Manager AB', 'manager', true),
  ('00000000-0000-4000-8000-000000172a06', 'Prueba Manager Sin Local', 'manager', true),
  ('00000000-0000-4000-8000-000000172a07', 'Prueba Manager Inactivo', 'manager', false),
  ('00000000-0000-4000-8000-000000172a08', 'Prueba Cajero', 'cajero', true),
  ('00000000-0000-4000-8000-000000172a09', 'Prueba Salonero', 'salonero', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
insert into public.locations (id, name) values ('p172-a', 'Local P172 A'), ('p172-b', 'Local P172 B') on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values ('p172-a', 'Local P172 A', true), ('p172-b', 'Local P172 B', true);
insert into public.profile_locations (profile_id, location_id, principal) values
  ('00000000-0000-4000-8000-000000172a03', 'p172-a', true),
  ('00000000-0000-4000-8000-000000172a04', 'p172-b', true),
  ('00000000-0000-4000-8000-000000172a05', 'p172-a', true),
  ('00000000-0000-4000-8000-000000172a05', 'p172-b', false),
  ('00000000-0000-4000-8000-000000172a07', 'p172-b', true),
  ('00000000-0000-4000-8000-000000172a08', 'p172-a', true),
  ('00000000-0000-4000-8000-000000172a09', 'p172-a', true);
insert into public.club_negocios (id, location_id, nombre, tipo) values
  ('00000000-0000-4000-8000-000000172c01', 'p172-b', 'Negocio Prueba P172', 'hotel');
insert into public.club_miembros (id, location_id, tipo, nombre, negocio_id) values
  ('00000000-0000-4000-8000-000000172b01', 'p172-b', 'referente', 'Prueba Anfitrion P172', '00000000-0000-4000-8000-000000172c01'),
  ('00000000-0000-4000-8000-000000172b02', 'p172-b', 'socio', 'Prueba Socio P172', null);
insert into public.club_miembros_contacto (miembro_id, location_id, telefono) values ('00000000-0000-4000-8000-000000172b01', 'p172-b', '+50600000172')
on conflict do nothing;
-- el socio: alta provisional cargada por otra persona (la confirma un manager)
update public.club_miembro_roles set estado = 'activo', provisional_hasta = now() + interval '1 day',
       registrado_por = '00000000-0000-4000-8000-000000172a01'
 where miembro_id = '00000000-0000-4000-8000-000000172b02' and rol = 'socio';
insert into public.club_cupones (id, location_id, referente_id, codigo, vence_en) values
  ('00000000-0000-4000-8000-000000172d01', 'p172-b', '00000000-0000-4000-8000-000000172b01', 'PQRSTUVWXY', now() + interval '10 days');
insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc, pos_ref, registrado_por) values
  ('00000000-0000-4000-8000-000000172e01', 'p172-b', '00000000-0000-4000-8000-000000172b01', 'canje', -1, 1, 1, 1000,
   '{"modo":"pedido"}'::jsonb, '00000000-0000-4000-8000-000000172a01');
insert into public.club_personas_pendientes (id, location_id, miembro_id, personas, personas_por_credito, valor_credito_crc, client_op_id, ganado_mes_crc, registrado_por) values
  ('00000000-0000-4000-8000-000000172f01', 'p172-b', '00000000-0000-4000-8000-000000172b01', 2, 1, 1000,
   '00000000-0000-4000-8000-000000172f99', 0, '00000000-0000-4000-8000-000000172a01');
insert into public.club_alertas (id, location_id, tipo, prioritaria) overriding system value values (-172001, 'p172-b', 'autoalta_cupo', true);
insert into public.club_visitas_socio (id, location_id, miembro_id, fecha, client_op_id, estado_beneficio, aplicar) values
  ('00000000-0000-4000-8000-000000172d11', 'p172-b', '00000000-0000-4000-8000-000000172b02', '2001-03-01',
   '00000000-0000-4000-8000-000000172d99', 'sin_promocion', '{}'::jsonb);

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
    raise exception using errcode = 'P0172', message = 'deshacer';
  exception when others then
    v := case when sqlstate = 'P0172' then 'ok' else sqlstate || ' ' || sqlerrm end;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;
create function pg_temp.uid(p text) returns text language sql immutable as $f$
  select '00000000-0000-4000-8000-000000172a0' || case p when 'OW' then '1' when 'CO' then '2' when 'M_A' then '3'
    when 'M_B' then '4' when 'M_AB' then '5' when 'M_0' then '6' when 'M_X' then '7' when 'CA' then '8' when 'SA' then '9' end
$f$;

-- Las llamadas: {F} = nombre de la función (envoltorio o núcleo), {L} = local (solo las que tienen p_location).
-- Las por id apuntan siempre a objetos de p172-b. lectura = el owner tiene que dar 'ok'.
create temp table _f172 (fn text, llamada text, lectura boolean) on commit drop;
insert into _f172 values
  ('club_reporte_equipo',           $q$select * from public.{F}('2001-03-01', {L})$q$, true),
  ('club_primeros90_config_ver',    $q$select * from public.{F}({L})$q$, true),
  ('club_reto_en_visita',           $q$select * from public.{F}('00000000-0000-4000-8000-000000172d11', {L})$q$, false),
  ('club_miembro_contacto_ver',     $q$select * from public.{F}('00000000-0000-4000-8000-000000172b01')$q$, true),
  ('club_miembro_codigo',           $q$select * from public.{F}('00000000-0000-4000-8000-000000172b01')$q$, true),
  ('club_miembro_token',            $q$select * from public.{F}('00000000-0000-4000-8000-000000172b01')$q$, true),
  ('club_miembro_regenerar_codigo', $q$select * from public.{F}('00000000-0000-4000-8000-000000172b01')$q$, true),
  ('club_pase_token',               $q$select * from public.{F}('00000000-0000-4000-8000-000000172b01', 'revocar')$q$, true),
  ('club_rol_activar_anfitrion',    $q$select * from public.{F}('00000000-0000-4000-8000-000000172b02', 'referente', 'nota de prueba P172')$q$, false),
  ('club_socio_confirmar',          $q$select * from public.{F}('00000000-0000-4000-8000-000000172b02', 'nota de prueba')$q$, false),
  ('club_resolver_miembro',         $q$select * from public.{F}('00000000-0000-4000-8000-000000172b01')$q$, true),
  ('club_canje',                    $q$select * from public.{F}('00000000-0000-4000-8000-000000172b01', 'ZZZZ', 1, 'F172', '00000000-0000-4000-8000-000000172f11', null)$q$, false),
  ('club_canje_aprobado',           $q$select * from public.{F}('00000000-0000-4000-8000-000000172b01', 1, 'F172', '00000000-0000-4000-8000-000000172f12', null, 'nota de prueba P172')$q$, false),
  ('club_tarjeta_manual',           $q$select * from public.{F}('00000000-0000-4000-8000-000000172b01', 2, 'F172', '00000000-0000-4000-8000-000000172f13', null)$q$, false),
  ('club_cupon_usar',               $q$select * from public.{F}('pqrstuvwxy ', 2, 'F172', '00000000-0000-4000-8000-000000172f14', null)$q$, false),
  ('club_canje_aviso',              $q$select * from public.{F}('00000000-0000-4000-8000-000000172e01')$q$, true),
  ('club_sin_cruce_candidatas',     $q$select * from public.{F}('00000000-0000-4000-8000-000000172e01', null)$q$, false),
  ('club_sin_cruce_elegir',         $q$select * from public.{F}('00000000-0000-4000-8000-000000172e01', '00100001010000000001', null)$q$, false),
  ('club_pendiente_resolver',       $q$select * from public.{F}('00000000-0000-4000-8000-000000172f01', false, 'nota de prueba')$q$, false),
  ('club_alerta_revisar',           $q$select * from public.{F}(-172001, 'nota de prueba')$q$, true);

create function pg_temp.sql_de(p_fn text, p_llamada text, p_nucleo boolean, p_local text) returns text language sql immutable as $f$
  select replace(replace(p_llamada, '{F}', p_fn || case when p_nucleo then '__nucleo' else '' end),
                 '{L}', coalesce(quote_literal(p_local), 'null'))
$f$;

-- 0. catálogo ──────────────────────────────────────────────────────────────────────────────────────────────────────
insert into _r172 (caso, ok, detalle)
select '0a 20 envoltorios y 20 núcleos nuevos; mismo nombre, argumentos, defaults, resultado y volatilidad que antes; los 26 de la 170 siguen',
       count(*) = 20 and count(*) filter (where w.oid is not null and k.oid is not null) = 20
       and count(*) filter (where pg_get_function_arguments(w.oid) = a.args and pg_get_function_result(w.oid) = a.res
                               and w.provolatile = a.vol and w.prosecdef
                               and w.proconfig = array['search_path=public, pg_temp']) = 20
       and (select count(*) from pg_proc where proname like 'club\_%\_\_nucleo' and pronamespace = 'public'::regnamespace)
           = (select n from _n170) + 20,
       string_agg(a.nom, ',') filter (where w.oid is null or pg_get_function_arguments(w.oid) <> a.args or w.provolatile <> a.vol)
  from _antes172 a
  left join pg_proc w on w.proname = a.nom and w.pronamespace = 'public'::regnamespace
  left join pg_proc k on k.proname = a.nom || '__nucleo' and k.pronamespace = 'public'::regnamespace;

insert into _r172 (caso, ok, detalle)
select '0b el núcleo es la función original byte a byte (md5 del cuerpo igual al de antes)',
       count(*) = 20 and bool_and(md5(k.prosrc) = a.md5), string_agg(a.nom, ',') filter (where md5(k.prosrc) <> a.md5)
  from _antes172 a join pg_proc k on k.proname = a.nom || '__nucleo' and k.pronamespace = 'public'::regnamespace;

insert into _r172 (caso, ok, detalle)
select '0c permisos: envoltorio con EXECUTE para authenticated (no anon ni public); núcleo SIN EXECUTE para authenticated, anon ni public',
       count(*) = 20
       and bool_and(has_function_privilege('authenticated', w.oid, 'EXECUTE') and not has_function_privilege('anon', w.oid, 'EXECUTE')
                and not has_function_privilege('authenticated', k.oid, 'EXECUTE')
                and not has_function_privilege('anon', k.oid, 'EXECUTE')
                and not exists (select 1 from aclexplode(k.proacl) x where x.grantee = 0)
                and not exists (select 1 from aclexplode(w.proacl) x where x.grantee = 0)),
       string_agg(a.nom, ',') filter (where has_function_privilege('authenticated', k.oid, 'EXECUTE'))
  from _antes172 a
  join pg_proc w on w.proname = a.nom and w.pronamespace = 'public'::regnamespace
  join pg_proc k on k.proname = a.nom || '__nucleo' and k.pronamespace = 'public'::regnamespace;

insert into _r172 (caso, ok, detalle)
select '0d club_exigir_local_de: definer, sin EXECUTE para authenticated ni anon',
       not has_function_privilege('authenticated', 'public.club_exigir_local_de(text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_exigir_local_de(text)', 'EXECUTE')
       and (select prosecdef from pg_proc where oid = 'public.club_exigir_local_de(text)'::regprocedure), null;

-- 2. el manager, en cada función ───────────────────────────────────────────────────────────────────────────────────
create temp table _m172 on commit drop as
select f.fn, f.lectura,
       pg_temp.como(pg_temp.uid('M_A'),  pg_temp.sql_de(f.fn, f.llamada, false, 'p172-b')) as ma_b,
       pg_temp.como(pg_temp.uid('M_0'),  pg_temp.sql_de(f.fn, f.llamada, false, 'p172-b')) as m0_b,
       pg_temp.como(pg_temp.uid('M_B'),  pg_temp.sql_de(f.fn, f.llamada, false, 'p172-b')) as mb_b,
       pg_temp.como(pg_temp.uid('M_B'),  pg_temp.sql_de(f.fn, f.llamada, true,  'p172-b')) as mb_b_nuc,
       pg_temp.como(pg_temp.uid('M_AB'), pg_temp.sql_de(f.fn, f.llamada, false, 'p172-b')) as mab_b,
       pg_temp.como(pg_temp.uid('M_AB'), pg_temp.sql_de(f.fn, f.llamada, true,  'p172-b')) as mab_b_nuc
  from _f172 f;
insert into _r172 (caso, ok, detalle)
select '2a manager de A con el local o el objeto de B → 42501 «Sin permiso en ese local» en las 20',
       count(*) = 20 and bool_and(ma_b = '42501 Sin permiso en ese local'),
       string_agg(fn || ' → ' || ma_b, ' | ') filter (where ma_b <> '42501 Sin permiso en ese local')
  from _m172;
insert into _r172 (caso, ok, detalle)
select '2b manager sin asignación (solo santa-teresa) con B → 42501 en las 20',
       count(*) = 20 and bool_and(m0_b = '42501 Sin permiso en ese local'),
       string_agg(fn || ' → ' || m0_b, ' | ') filter (where m0_b <> '42501 Sin permiso en ese local')
  from _m172;
insert into _r172 (caso, ok, detalle)
select '2c manager de B y manager de A+B en B: igual que hoy (envoltorio = núcleo); las lecturas dan ok',
       count(*) = 20 and bool_and(mb_b = mb_b_nuc and mab_b = mab_b_nuc)
       and bool_and(not lectura or (mb_b = 'ok' and mab_b = 'ok')),
       string_agg(fn || ' → ' || mb_b || ' ≠ ' || mb_b_nuc || ' / ' || mab_b || ' ≠ ' || mab_b_nuc, ' | ')
         filter (where mb_b <> mb_b_nuc or mab_b <> mab_b_nuc or (lectura and (mb_b <> 'ok' or mab_b <> 'ok')))
  from _m172;

-- 3. todos los demás, igual que hoy: envoltorio = núcleo, para el mismo usuario y argumentos ───────────────────────
create temp table _i172 on commit drop as
select f.fn, f.lectura, u.r,
       pg_temp.como(case when u.r = 'ANON' then null else pg_temp.uid(u.r) end, pg_temp.sql_de(f.fn, f.llamada, false, 'p172-b')) as env,
       pg_temp.como(case when u.r = 'ANON' then null else pg_temp.uid(u.r) end, pg_temp.sql_de(f.fn, f.llamada, true,  'p172-b')) as nuc
  from _f172 f, (values ('OW'), ('CO'), ('CA'), ('SA'), ('M_X'), ('ANON')) u(r);
insert into _r172 (caso, ok, detalle)
select '3a owner, contador, cajero (de A, con B), salonero, manager inactivo y sin sesión: la misma respuesta que la función original',
       count(*) = 20 * 6 and bool_and(env = nuc),
       string_agg(r || ' ' || fn || ': ' || env || ' ≠ ' || nuc, ' | ') filter (where env <> nuc)
  from _i172;
insert into _r172 (caso, ok, detalle)
select '3b el owner lee y opera en B (las lecturas dan ok)',
       bool_and(env = 'ok') and count(*) = 10, string_agg(fn || ' → ' || env, ' | ') filter (where env <> 'ok')
  from _i172 where r = 'OW' and lectura;
insert into _r172 (caso, ok, detalle)
select '3c el cajero de A sigue operando la caja con objetos de B como hoy (canje, tarjeta, cupón, aviso: no 42501 de local)',
       bool_and(env not like '%Sin permiso en ese local%') and count(*) = 4, string_agg(fn || ' → ' || env, ' | ')
  from _i172 where r = 'CA' and fn in ('club_canje', 'club_tarjeta_manual', 'club_cupon_usar', 'club_canje_aviso');

-- 4. objeto inexistente: el manager recibe el «no encontrado» de siempre (no un 42501 de local) ──────────────────────
insert into _r172 (caso, ok, detalle)
select '4a M_A con un miembro, movimiento, pendiente o alerta que no existe: la misma respuesta que el núcleo',
       bool_and(e = k), string_agg(c || ': ' || e || ' ≠ ' || k, ' | ') filter (where e <> k)
  from (select c,
               pg_temp.como(pg_temp.uid('M_A'), replace(c, '{F}', fn)) as e,
               pg_temp.como(pg_temp.uid('M_A'), replace(c, '{F}', fn || '__nucleo')) as k
          from (values
            ('club_miembro_codigo',      $q$select * from public.{F}('00000000-0000-4000-8000-000000172fff')$q$),
            ('club_canje_aviso',         $q$select * from public.{F}('00000000-0000-4000-8000-000000172fff')$q$),
            ('club_pendiente_resolver',  $q$select * from public.{F}('00000000-0000-4000-8000-000000172fff', false, 'nota')$q$),
            ('club_alerta_revisar',      $q$select * from public.{F}(-172999, 'nota de prueba')$q$),
            ('club_cupon_usar',          $q$select * from public.{F}('ABCDEFGHJK', 2, 'F172', '00000000-0000-4000-8000-000000172f15', null)$q$)
          ) x(fn, c)) y;

-- 5. retos: cuenta el local de la VISITA, no el parámetro ───────────────────────────────────────────────────────────
insert into _r172 (caso, ok, detalle)
select '5a club_reto_en_visita: M_A con la visita de B y p_location = A → 42501; M_B con la visita de B y p_location = A → la respuesta del núcleo («de otro local»)',
       pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_reto_en_visita('00000000-0000-4000-8000-000000172d11', 'p172-a')$q$)
         = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('M_B'), $q$select public.club_reto_en_visita('00000000-0000-4000-8000-000000172d11', 'p172-a')$q$)
         = pg_temp.como(pg_temp.uid('M_B'), $q$select public.club_reto_en_visita__nucleo('00000000-0000-4000-8000-000000172d11', 'p172-a')$q$),
       pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_reto_en_visita('00000000-0000-4000-8000-000000172d11', 'p172-a')$q$);

-- 6. «todos mis locales» = solo los suyos: sin local, la base usa el único encendido ─────────────────────────────────
update public.club_config set club_activo = false where location_id <> 'p172-a' and club_activo;
insert into _r172 (caso, ok, detalle)
select '6a sin local (único encendido = A): ranking del equipo y primeros 90 → M_A ok; M_B 42501; owner ok',
       pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_reporte_equipo('2001-03-01', null)$q$) = 'ok'
       and pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_primeros90_config_ver(null)$q$) = 'ok'
       and pg_temp.como(pg_temp.uid('M_B'), $q$select public.club_reporte_equipo('2001-03-01', null)$q$) = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('M_B'), $q$select public.club_primeros90_config_ver(null)$q$) = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('OW'), $q$select public.club_reporte_equipo('2001-03-01', null)$q$) = 'ok',
       null;
update public.club_config set club_activo = true where location_id = 'p172-b';

-- 7. la API no llega al núcleo: authenticated no lo puede ejecutar ─────────────────────────────────────────────────
create temp table _k172 (r text) on commit drop;
grant insert on _k172 to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000172a03', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform public.club_miembro_contacto_ver__nucleo('00000000-0000-4000-8000-000000172b01');
    insert into _k172 values ('ok');
  exception when others then insert into _k172 values (sqlstate);
  end;
  begin
    perform public.club_exigir_local_de('p172-b');
    insert into _k172 values ('ok');
  exception when others then insert into _k172 values (sqlstate);
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
insert into _r172 (caso, ok, detalle)
select '7a como authenticated (rol de la API), el núcleo y club_exigir_local_de dan 42501 (permission denied)',
       count(*) = 2 and bool_and(r = '42501'), string_agg(r, ',') from _k172;

-- 8. vuelta atrás (en esta misma transacción descartada) ───────────────────────────────────────────────────────────
-- @@172R@@   (aquí va el cuerpo de scripts/sql/172_rollback.sql sin begin/commit)
insert into _r172 (caso, ok, detalle)
select '8a rollback: las 20 vuelven con el cuerpo, la volatilidad y authenticated con EXECUTE; sin club_exigir_local_de; la 170 intacta',
       to_regprocedure('public.club_exigir_local_de(text)') is null
       and to_regprocedure('public.club_exigir_local(text)') is not null
       and (select count(*) from pg_proc where proname like 'club\_%\_\_nucleo' and pronamespace = 'public'::regnamespace) = (select n from _n170)
       and (select count(*) from _antes172 a join pg_proc p on p.proname = a.nom and p.pronamespace = 'public'::regnamespace
             where md5(p.prosrc) = a.md5 and p.provolatile = a.vol and pg_get_function_arguments(p.oid) = a.args
               and has_function_privilege('authenticated', p.oid, 'EXECUTE')
               and not has_function_privilege('anon', p.oid, 'EXECUTE')) = 20, null;
insert into _r172 (caso, ok, detalle)
select '8b rollback: vuelve el hallazgo (M_A otra vez lee el contacto y el ranking del equipo de B): la prueba distingue',
       pg_temp.como(pg_temp.uid('M_A'), $q$select * from public.club_miembro_contacto_ver('00000000-0000-4000-8000-000000172b01')$q$) = 'ok'
       and pg_temp.como(pg_temp.uid('M_A'), $q$select public.club_reporte_equipo('2001-03-01', 'p172-b')$q$) = 'ok', null;

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r172;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r172 where not ok or ok is null;
  if v is not null then raise exception '172-FALLAN: %', v; end if;
  if (select count(*) from _r172) < 16 then raise exception '172-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
