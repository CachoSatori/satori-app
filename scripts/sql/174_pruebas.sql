-- 174_pruebas (origen club 120) · plan B de la TARJETA FÍSICA en Escanear: facturas cobradas HOY + búsqueda por tiquete
-- (3 días CR) + una factura con tarjeta o cupón ya cargado no se usa otra vez. Cupón, canje y visita de socio: igual que
-- antes (2 h 15 min), y ninguna otra función cambia. Aplica la 174 dentro de una transacción, arma datos
-- ficticios, prueba y termina en ROLLBACK: no deja nada. Al final un ASSERT: si algún caso falla, aborta con
-- «174-FALLAN: <casos>». Se corre con scripts/sql/174_pruebas.py (--local: Postgres 16 local; --armar: imprime el SQL
-- para staging, con el OK del dueño).
--
-- MARCADORES que llena el runner: «-- @@174@@» → cuerpo de supabase/migrations/174_club_facturas_dia_busqueda.sql sin
-- begin/commit; «-- @@174R@@» → cuerpo de scripts/sql/174_rollback.sql sin begin/commit (sin el delete del ledger).
--
-- Todo ficticio: locales p174-a y p174-b (Club encendido, tarjeta física prendida en A), usuarios de prueba por rol,
-- tres referentes en A. Facturas y consecutivos inventados (sufijos 91xxx y 92xxx), montos redondos de prueba.
--   · Facturas FIJAS (año 2001): prueban la lista y la búsqueda con un «ahora» fijo (club_facturas_lista con p_ahora),
--     incluido el borde de medianoche CR. No se cruzan con las de «hoy».
--   · Facturas VIVAS (relativas a now()): prueban las funciones públicas y el control del servidor (club_pos_ref, que
--     usa now()).
begin;

-- huellas ANTES de la 174: TODAS las funciones del esquema public (solo puede cambiar club_tarjeta_manual__nucleo, y el
-- rollback las deja a todas como estaban)
create temp table _antes174 on commit drop as
select p.oid::regprocedure::text as fn, md5(p.prosrc) as md5, pg_get_function_result(p.oid) as res,
       pg_get_function_arguments(p.oid) as args, p.proacl::text as acl
  from pg_proc p where p.pronamespace = 'public'::regnamespace;

-- @@174@@   (aquí va el cuerpo de la 174 sin begin/commit)

create temp table _r174 (n serial, caso text, ok boolean, detalle text) on commit drop;

-- ── Usuarios, locales y datos ficticios ───────────────────────────────────────────────────────────────────────────
insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000174a01', '{"full_name":"Prueba P174"}'),
  ('00000000-0000-4000-8000-000000174a02', '{"full_name":"Prueba P174"}'),
  ('00000000-0000-4000-8000-000000174a03', '{"full_name":"Prueba P174"}'),
  ('00000000-0000-4000-8000-000000174a04', '{"full_name":"Prueba P174"}')
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000174a01', 'Prueba Owner', 'owner', true),
  ('00000000-0000-4000-8000-000000174a02', 'Prueba Manager A', 'manager', true),
  ('00000000-0000-4000-8000-000000174a03', 'Prueba Cajero A', 'cajero', true),
  ('00000000-0000-4000-8000-000000174a04', 'Prueba Salonero A', 'salonero', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
insert into public.locations (id, name) values ('p174-a', 'Local P174 A'), ('p174-b', 'Local P174 B') on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo, tarjeta_manual_activa, tarjeta_manual_tope_dia) values
  ('p174-a', 'Local P174 A', true, true, 30), ('p174-b', 'Local P174 B', true, true, 30);
insert into public.profile_locations (profile_id, location_id, principal) values
  ('00000000-0000-4000-8000-000000174a02', 'p174-a', true),
  ('00000000-0000-4000-8000-000000174a03', 'p174-a', true),
  ('00000000-0000-4000-8000-000000174a04', 'p174-a', true);
insert into public.club_miembros (id, location_id, tipo, nombre) values
  ('00000000-0000-4000-8000-000000174b01', 'p174-a', 'referente', 'Prueba Referente Uno P174'),
  ('00000000-0000-4000-8000-000000174b02', 'p174-a', 'referente', 'Prueba Referente Dos P174'),
  ('00000000-0000-4000-8000-000000174b03', 'p174-a', 'referente', 'Prueba Referente Tres P174');

create function pg_temp.tk(p_local text, p_num text, p_fecha timestamptz, p_estado text, p_cons text) returns void language sql as $f$
  insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta,
                                      total_crc, mesa_factura, consecutivo_fe)
  values (p_local, p_num, p_fecha, p_estado, 'salon', 'cajero', false, 'ok', 10000, '7', p_cons)
$f$;
-- FIJAS: «ahora» = 2001-03-15 21:33 CR
select pg_temp.tk('p174-a', '9174001', '2001-03-15 18:33-06', 'C', '00100001040000091001');   -- hace 3 h
select pg_temp.tk('p174-a', '9174002', '2001-03-15 19:03-06', 'C', '00100001040000091002');   -- hace 2 h 30
select pg_temp.tk('p174-a', '9174003', '2001-03-14 23:50-06', 'C', '00100001040000091003');   -- ayer, antes de medianoche
select pg_temp.tk('p174-a', '9174004', '2001-03-12 00:30-06', 'C', '00100001040000091004');   -- hoy − 3 días
select pg_temp.tk('p174-a', '9174005', '2001-03-11 23:59-06', 'C', '00100001040000091005');   -- hoy − 4 días
select pg_temp.tk('p174-a', '9174006', '2001-03-15 20:00-06', 'X', '00100001040000091006');   -- anulada
select pg_temp.tk('p174-a', '9174007', '2001-03-15 21:50-06', 'C', '00100001040000091007');   -- «futura» (> 5 min)
select pg_temp.tk('p174-a', '9174008', '2001-03-15 00:00:30-06', 'C', '00100001040000091008'); -- recién pasada la medianoche
select pg_temp.tk('p174-a', '9174009', '2001-03-15 10:00-06', 'R', '00100001040000091009');   -- cobrada, sin cierre (R)
select pg_temp.tk('p174-b', '9174101', '2001-03-15 20:30-06', 'C', '00100001040000091001');   -- OTRO local, mismo sufijo
-- VIVAS (relativas a now())
select pg_temp.tk('p174-a', '9174201', greatest(now() - interval '1 minute', public.club_facturas_desde(now(), 0)), 'C', '00100001040000092001');
select pg_temp.tk('p174-a', '9174202', public.club_facturas_desde(now(), 0) - interval '1 hour', 'C', '00100001040000092002');  -- ayer 23:00
select pg_temp.tk('p174-a', '9174203', public.club_facturas_desde(now(), 4) + interval '1 hour', 'C', '00100001040000092003');  -- hoy − 4
select pg_temp.tk('p174-a', '9174204', public.club_facturas_desde(now(), 3) + interval '1 minute', 'C', '00100001040000092004'); -- hoy − 3
select pg_temp.tk('p174-a', '9174205', now() - interval '2 minutes', 'X', '00100001040000092005');                             -- anulada
select pg_temp.tk('p174-b', '9174206', now() - interval '1 minute', 'C', '00100001040000092006');                             -- otro local
select pg_temp.tk('p174-a', '9174207', now() - interval '3 minutes', 'C', '00100001040000092007');                             -- con pendiente
select pg_temp.tk('p174-a', '9174208', public.club_facturas_desde(now(), 1) + interval '2 hours', 'C', '00100001040000092008'); -- ayer, para el rollback
select pg_temp.tk('p174-a', '9174209', now() - interval '3 hours', 'C', '00100001040000092009');                             -- hace 3 h
-- 3 h o más antes de las 00:00 CR de hoy: siempre «de ayer» y siempre más de 2 h 15 min atrás (no depende de la hora)
select pg_temp.tk('p174-a', '9174211', public.club_facturas_desde(now(), 0) - interval '3 hours', 'C', '00100001040000092011');
select pg_temp.tk('p174-a', '9174212', public.club_facturas_desde(now(), 0) - interval '4 hours', 'C', '00100001040000092012');
select pg_temp.tk('p174-a', '9174213', public.club_facturas_desde(now(), 0) - interval '5 hours', 'C', '00100001040000092013');
select pg_temp.tk('p174-a', '9174214', now() - interval '1 minute', 'C', '00100001040000092014');                             -- control
-- socio, saldo para un canje y un cupón vigente (ficticios)
insert into public.club_miembros (id, location_id, tipo, nombre) values
  ('00000000-0000-4000-8000-000000174b04', 'p174-a', 'socio', 'Prueba Socio P174');
insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, origen, client_op_id)
values ('p174-a', '00000000-0000-4000-8000-000000174b01', 'tarjeta', 12, 6, 1000, 'app', gen_random_uuid());
insert into public.club_cupones (location_id, referente_id, codigo, vence_en) values
  ('p174-a', '00000000-0000-4000-8000-000000174b02', 'PRBACDEFGH', now() + interval '1 day');
-- un pedido abierto con el puente al día (para la tarjeta con el PEDIDO: CLUB-AUD-02)
insert into public.pos_ndf_cursor (local, last_poll_at, last_error) values ('p174-a', now(), null)
  on conflict (local) do update set last_poll_at = excluded.last_poll_at, last_error = null;
insert into public.pos_ndf_open (local, clave, id_pedido, updated_at, pedido_abierto_en, pax, mesa)
values ('p174-a', 'pedido:20010315:91', '91', now(), now() - interval '20 minutes', 6, '7');

-- Llama como el usuario dado y devuelve 'ok' o 'SQLSTATE mensaje'. Sin usuario = sin sesión. `deshacer`: lo que escribe
-- se deshace (subtransacción con un error propio); si no, queda (para armar el caso siguiente).
create function pg_temp.como(p_uid text, p_sql text, p_deshacer boolean default true) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  begin
    execute p_sql;
    if p_deshacer then raise exception using errcode = 'P0174', message = 'deshacer'; end if;
    v := 'ok';
  exception when others then
    v := case when sqlstate = 'P0174' then 'ok' else sqlstate || ' ' || sqlerrm end;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;
create function pg_temp.uid(p text) returns text language sql immutable as $f$
  select '00000000-0000-4000-8000-000000174a0' || case p when 'OW' then '1' when 'M_A' then '2' when 'CA' then '3' when 'SA' then '4' end
$f$;
create function pg_temp.ref(p int) returns text language sql immutable as $f$ select '00000000-0000-4000-8000-000000174b0' || p $f$;
-- Tarjeta física por factura (plan B) como el cajero de A
create function pg_temp.tarjeta(p_ref int, p_factura text, p_deshacer boolean default true) returns text language sql as $f$
  select pg_temp.como(pg_temp.uid('CA'),
    format('select * from public.club_tarjeta_manual(%L::uuid, 2, null, gen_random_uuid(), %L::jsonb)',
           pg_temp.ref(p_ref), jsonb_build_object('modo', 'factura', 'numero_factura', p_factura)), p_deshacer)
$f$;
-- Números de factura que devuelve la lista interna (orden incluido)
create function pg_temp.lista(p_local text, p_buscar text, p_ahora timestamptz) returns text language sql as $f$
  select coalesce(string_agg(numero_factura, ',' order by n), '') from (
    select l.numero_factura, row_number() over () as n from public.club_facturas_lista(p_local, p_buscar, p_ahora) l) x
$f$;

-- 0. catálogo y permisos ───────────────────────────────────────────────────────────────────────────────────────────
insert into _r174 (caso, ok, detalle)
select '0a de las funciones que ya existían, SOLO cambia club_tarjeta_manual__nucleo (cuerpo); su firma, resultado y permisos, iguales. club_pos_ref, club_visita_control, recientes, canje, cupón y visita de socio: byte a byte',
       coalesce(string_agg(a.fn, ',' order by a.fn), '') = 'club_tarjeta_manual__nucleo(uuid,integer,text,uuid,jsonb)'
       and (select bool_and(pg_get_function_result(p.oid) = a.res and pg_get_function_arguments(p.oid) = a.args
                            and p.proacl::text is not distinct from a.acl)
              from _antes174 a join pg_proc p on p.oid = a.fn::regprocedure),
       string_agg(a.fn, ',' order by a.fn)
  from _antes174 a join pg_proc p on p.oid = a.fn::regprocedure
 where md5(p.prosrc) <> a.md5;
insert into _r174 (caso, ok, detalle)
select '0b permisos: club_facturas_buscar con EXECUTE para authenticated (no anon ni PUBLIC); su núcleo y las internas sin EXECUTE para la API',
       has_function_privilege('authenticated', 'public.club_facturas_buscar(text,text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_facturas_buscar(text,text)', 'EXECUTE')
       and not exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = 'public.club_facturas_buscar(text,text)'::regprocedure and x.grantee = 0)
       and (select bool_and(not has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')
                            and not has_function_privilege('anon', f::regprocedure, 'EXECUTE'))
              from unnest(array['public.club_facturas_buscar__nucleo(text,text)', 'public.club_facturas_lista(text,text,timestamptz)',
                                'public.club_factura_usada(text,text)', 'public.club_visita_con_tarjeta(text,text)',
                                'public.club_facturas_desde(timestamptz,integer)', 'public.club_facturas_dias_busqueda()',
                                'public.club_pos_ref_tarjeta(jsonb,text)',
                                'public.club_tarjeta_manual__nucleo(uuid,integer,text,uuid,jsonb)']) f)
       and (select prosecdef from pg_proc where oid = 'public.club_facturas_buscar(text,text)'::regprocedure), null;
insert into _r174 (caso, ok, detalle)
select '0c solo el núcleo de la tarjeta usa club_pos_ref_tarjeta; canje, canje sin celular, cupón y visita de socio siguen con club_pos_ref',
       (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.prosrc like '%club_pos_ref_tarjeta(%' and p.proname <> 'club_pos_ref_tarjeta')
         = 'club_tarjeta_manual__nucleo',
       (select string_agg(p.proname, ',' order by p.proname) from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.prosrc like '%club_pos_ref_tarjeta(%' and p.proname <> 'club_pos_ref_tarjeta');

-- 1. lista y búsqueda con «ahora» fijo (2001-03-15 21:33 CR) ──────────────────────────────────────────────────────
insert into _r174 (caso, ok, detalle)
select '1a lista de HOY: hace 3 h y hace 2 h 30 sí; la R sí; la de 00:00:30 sí; más recientes primero; ni ayer, ni anulada, ni futura, ni otro local',
       pg_temp.lista('p174-a', null, '2001-03-15 21:33-06') = '9174002,9174001,9174009,9174008',
       pg_temp.lista('p174-a', null, '2001-03-15 21:33-06');
insert into _r174 (caso, ok, detalle)
select '1b la factura de ayer NO está en la lista pero SÍ por búsqueda (últimos 5 dígitos)',
       position('9174003' in pg_temp.lista('p174-a', null, '2001-03-15 21:33-06')) = 0
       and pg_temp.lista('p174-a', '91003', '2001-03-15 21:33-06') = '9174003',
       pg_temp.lista('p174-a', '91003', '2001-03-15 21:33-06');
insert into _r174 (caso, ok, detalle)
select '1c búsqueda: hoy − 3 días sí; hoy − 4 días (23:59 CR) no',
       pg_temp.lista('p174-a', '91004', '2001-03-15 21:33-06') = '9174004'
       and pg_temp.lista('p174-a', '91005', '2001-03-15 21:33-06') = '',
       pg_temp.lista('p174-a', '91004', '2001-03-15 21:33-06') || ' / ' || pg_temp.lista('p174-a', '91005', '2001-03-15 21:33-06');
insert into _r174 (caso, ok, detalle)
select '1d búsqueda: otro local con el mismo sufijo no aparece; la anulada no aparece; los 4 dígitos alcanzan',
       pg_temp.lista('p174-a', '91001', '2001-03-15 21:33-06') = '9174001'
       and pg_temp.lista('p174-b', '91001', '2001-03-15 21:33-06') = '9174101'
       and pg_temp.lista('p174-a', '91006', '2001-03-15 21:33-06') = ''
       and pg_temp.lista('p174-a', '1002', '2001-03-15 21:33-06') = '9174002',
       null;
insert into _r174 (caso, ok, detalle)
select '1e búsqueda: menos de 4 dígitos o sin dígitos → error claro; vacía = la lista de hoy',
       pg_temp.como(null, $q$select * from public.club_facturas_lista('p174-a', '467', '2001-03-15 21:33-06')$q$)
         = 'P0001 Escribí al menos 4 dígitos del número de tiquete (los últimos)'
       and pg_temp.como(null, $q$select * from public.club_facturas_lista('p174-a', 'abcd', '2001-03-15 21:33-06')$q$)
         = 'P0001 Escribí al menos 4 dígitos del número de tiquete (los últimos)'
       and pg_temp.lista('p174-a', '  ', '2001-03-15 21:33-06') = pg_temp.lista('p174-a', null, '2001-03-15 21:33-06'),
       null;
insert into _r174 (caso, ok, detalle)
select '1f borde de medianoche CR: a las 00:05 del 16 la lista está vacía (lo del 15 ya es «ayer») y la de las 21:50 del 15 sale por búsqueda; a las 23:59 del 15 sí está en la lista',
       pg_temp.lista('p174-a', null, '2001-03-16 00:05-06') = ''
       and pg_temp.lista('p174-a', '91007', '2001-03-16 00:05-06') = '9174007'
       and position('9174007' in pg_temp.lista('p174-a', null, '2001-03-15 23:59-06')) = 1,
       pg_temp.lista('p174-a', null, '2001-03-15 23:59-06');
insert into _r174 (caso, ok, detalle)
select '1g corte en hora CR (UTC−6), no UTC: 05:59:59 UTC del 16 = 23:59:59 CR del 15 → el día empieza el 15 a las 06:00 UTC; hace 3 días = 12 a las 06:00 UTC',
       public.club_facturas_desde('2001-03-16 05:59:59+00', 0) = '2001-03-15 06:00+00'
       and public.club_facturas_desde('2001-03-16 06:00:00+00', 0) = '2001-03-16 06:00+00'
       and public.club_facturas_desde('2001-03-15 21:33-06', 3) = '2001-03-12 06:00+00'
       and public.club_facturas_dias_busqueda() = 3,
       public.club_facturas_desde('2001-03-16 05:59:59+00', 0)::text;

-- 2. funciones públicas (now()) ────────────────────────────────────────────────────────────────────────────────────
insert into _r174 (caso, ok, detalle)
select '2a cajero de A: club_facturas_recientes (cupón, canje, socio) sigue con las últimas 2 h (hace 1 min sí, hace 3 h no); club_facturas_buscar(null) trae la de hace 1 min y NO la de ayer',
       pg_temp.como(pg_temp.uid('CA'), $q$do $d$ begin
         if not exists (select 1 from public.club_facturas_recientes('p174-a') where numero_factura = '9174201')
            or exists (select 1 from public.club_facturas_recientes('p174-a') where numero_factura = '9174209')
            or not exists (select 1 from public.club_facturas_buscar(null, 'p174-a') where numero_factura = '9174201')
            or exists (select 1 from public.club_facturas_buscar(null, 'p174-a') where numero_factura = '9174202') then
           raise exception 'NO'; end if; end $d$$q$) = 'ok', null;
insert into _r174 (caso, ok, detalle)
select '2b cajero de A: buscar por tiquete trae la de ayer y la de hoy − 3; no la de hoy − 4, ni la anulada, ni la de otro local',
       pg_temp.como(pg_temp.uid('CA'), $q$do $d$ begin
         if (select count(*) from public.club_facturas_buscar('92002', 'p174-a')) <> 1
            or (select count(*) from public.club_facturas_buscar('92004', 'p174-a')) <> 1
            or (select count(*) from public.club_facturas_buscar('92003', 'p174-a')) <> 0
            or (select count(*) from public.club_facturas_buscar('92005', 'p174-a')) <> 0
            or (select count(*) from public.club_facturas_buscar('92006', 'p174-a')) <> 0 then
           raise exception 'NO'; end if; end $d$$q$) = 'ok', null;
insert into _r174 (caso, ok, detalle)
select '2c manager de A pidiendo B → 42501 «Sin permiso en ese local»; en A, ok',
       pg_temp.como(pg_temp.uid('M_A'), $q$select * from public.club_facturas_buscar('92006', 'p174-b')$q$) = '42501 Sin permiso en ese local'
       and pg_temp.como(pg_temp.uid('M_A'), $q$select * from public.club_facturas_buscar('92002', 'p174-a')$q$) = 'ok',
       pg_temp.como(pg_temp.uid('M_A'), $q$select * from public.club_facturas_buscar('92006', 'p174-b')$q$);
insert into _r174 (caso, ok, detalle)
select '2d salonero y sin sesión → 42501 «Sin permiso» (como la lista de siempre)',
       pg_temp.como(pg_temp.uid('SA'), $q$select * from public.club_facturas_buscar(null, 'p174-a')$q$) = '42501 Sin permiso'
       and pg_temp.como(null, $q$select * from public.club_facturas_buscar(null, 'p174-a')$q$) = '42501 Sin permiso',
       pg_temp.como(pg_temp.uid('SA'), $q$select * from public.club_facturas_buscar(null, 'p174-a')$q$);
create temp table _k174 (r text) on commit drop;
grant insert on _k174 to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('CA'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $d$ begin
  begin perform * from public.club_facturas_buscar__nucleo(null, 'p174-a'); insert into _k174 values ('ok');
  exception when others then insert into _k174 values (sqlstate); end;
end $d$;
reset role;
select set_config('request.jwt.claims', '', true);
insert into _r174 (caso, ok, detalle)
select '2e como authenticated (rol de la API), el núcleo da 42501 (permission denied)', r = '42501', r from _k174;

-- 3. el servidor: club_pos_ref y club_visita_control, por club_tarjeta_manual ──────────────────────────────────────
insert into _r174 (caso, ok, detalle)
select '3a tarjeta física con una factura de AYER (3 h antes de las 00:00 CR; antes: «más de 2 horas») → se registra', r = 'ok', r
  from (select pg_temp.tarjeta(1, '9174211', false) as r) x;
insert into _r174 (caso, ok, detalle)
select '3b tarjeta con la factura de hoy − 4 días → «más de 3 días: pedile al owner un ajuste»',
       r = 'P0001 Esa factura tiene más de 3 días: pedile al owner un ajuste', r
  from (select pg_temp.tarjeta(2, '9174203') as r) x;
insert into _r174 (caso, ok, detalle)
select '3c la misma factura (ya con tarjeta) para OTRO referente → «ya tiene una tarjeta o un cupón cargado»',
       r = 'P0001 Esa factura ya tiene una tarjeta o un cupón cargado: no se puede usar otra vez. Si falta algo, pedile al owner un ajuste', r
  from (select pg_temp.tarjeta(2, '9174211') as r) x;
insert into _r174 (caso, ok, detalle)
select '3d la misma factura para el MISMO referente → el error de siempre (una por mesa)',
       r like 'P0001 Este referente ya tiene una tarjeta en esta visita%', r
  from (select pg_temp.tarjeta(1, '9174211') as r) x;
insert into _r174 (caso, ok, detalle)
select '3e factura de OTRO local (aunque sea de hace 1 min) → «no está en el PoS de este local»',
       r = 'P0001 Esa factura no está en el PoS de este local (o está anulada): tocá «Actualizar» o buscala por número de tiquete. Si no aparece, pedile al owner un ajuste', r
  from (select pg_temp.tarjeta(3, '9174206') as r) x;
insert into _r174 (caso, ok, detalle)
select '3f factura anulada → «no está en el PoS de este local (o está anulada)»',
       r like 'P0001 Esa factura no está en el PoS de este local (o está anulada)%', r
  from (select pg_temp.tarjeta(3, '9174205') as r) x;
insert into _r174 (caso, ok, detalle)
select '3g hoy − 3 días (00:01 CR) → se registra (el tope incluye ese día)', r = 'ok', r
  from (select pg_temp.tarjeta(3, '9174204') as r) x;
-- personas pendientes de aprobación (anfitrión nuevo sobre el tope) en la factura 9174207: también es «cargada»
insert into public.club_personas_pendientes (location_id, miembro_id, personas, personas_por_credito, valor_credito_crc, client_op_id,
                                             ganado_mes_crc, visita_clave, factura_pos)
values ('p174-a', pg_temp.ref(3)::uuid, 2, 2, 1000, gen_random_uuid(), 0,
        public.club_visita_canonica('p174-a', '{"modo":"factura","numero_factura":"9174207"}'::jsonb, null), null);
insert into _r174 (caso, ok, detalle)
select '3h factura con personas PENDIENTES de aprobación → tampoco se usa otra vez',
       r like 'P0001 Esa factura ya tiene una tarjeta o un cupón cargado%', r
  from (select pg_temp.tarjeta(1, '9174207') as r) x;
insert into _r174 (caso, ok, detalle)
select '3i tarjeta con el PEDIDO abierto: sigue CLUB-AUD-02 (un segundo referente en la misma mesa entra, Σ ≤ pax)',
       pg_temp.como(pg_temp.uid('CA'), format('select * from public.club_tarjeta_manual(%L::uuid, 2, null, gen_random_uuid(), %L::jsonb)',
                    pg_temp.ref(1), '{"modo":"pedido","pedido":"91","clave":"pedido:20010315:91"}'), false) = 'ok'
       and pg_temp.como(pg_temp.uid('CA'), format('select * from public.club_tarjeta_manual(%L::uuid, 2, null, gen_random_uuid(), %L::jsonb)',
                    pg_temp.ref(2), '{"modo":"pedido","pedido":"91","clave":"pedido:20010315:91"}')) = 'ok',
       pg_temp.como(pg_temp.uid('CA'), format('select * from public.club_tarjeta_manual(%L::uuid, 2, null, gen_random_uuid(), %L::jsonb)',
                    pg_temp.ref(2), '{"modo":"pedido","pedido":"91","clave":"pedido:20010315:91"}'));
insert into _r174 (caso, ok, detalle)
select '3j la lista marca: la factura con tarjeta (ayer) y la con pendientes salen usada = true; la de hace 1 min, false',
       pg_temp.como(pg_temp.uid('CA'), $q$do $d$ begin
         if not (select usada from public.club_facturas_buscar('92011', 'p174-a'))
            or not (select usada from public.club_facturas_buscar(null, 'p174-a') where numero_factura = '9174207')
            or (select usada from public.club_facturas_buscar(null, 'p174-a') where numero_factura = '9174201') then
           raise exception 'NO'; end if; end $d$$q$) = 'ok', null;

-- 5. cupón, canje y visita de socio: IGUAL QUE ANTES (verificador del #206) ────────────────────────────────────────
insert into _r174 (caso, ok, detalle)
select '5a visita de socio con una factura de ayer → rechazada como antes («más de 2 horas»)',
       r = 'P0001 Esa factura tiene más de 2 horas: la resuelve el manager en Excepciones', r
  from (select pg_temp.como(pg_temp.uid('CA'), format('select * from public.club_socio_visita(%L::uuid, %L::jsonb, gen_random_uuid(), %L)',
          pg_temp.ref(4), '{"modo":"factura","numero_factura":"9174212"}', 'p174-a')) as r) x;
insert into _r174 (caso, ok, detalle)
select '5b canje (sin celular) con una factura de ayer → rechazado como antes («más de 2 horas»)',
       r = 'P0001 Esa factura tiene más de 2 horas: la resuelve el manager en Excepciones', r
  from (select pg_temp.como(pg_temp.uid('OW'), format('select * from public.club_canje_aprobado(%L::uuid, 1, null, gen_random_uuid(), %L::jsonb, %L)',
          pg_temp.ref(1), '{"modo":"factura","numero_factura":"9174212"}', 'nota de prueba P174')) as r) x;
insert into _r174 (caso, ok, detalle)
select '5c cupón con una factura de ayer → rechazado como antes; con la de hace 1 min pasa ese control',
       r1 = 'P0001 Esa factura tiene más de 2 horas: la resuelve el manager en Excepciones' and r2 not like '%más de 2 horas%',
       r1 || ' / ' || r2
  from (select pg_temp.como(pg_temp.uid('CA'), format('select * from public.club_cupon_usar(%L, 2, null, gen_random_uuid(), %L::jsonb)',
                 'PRBACDEFGH', '{"modo":"factura","numero_factura":"9174213"}')) as r1,
               pg_temp.como(pg_temp.uid('CA'), format('select * from public.club_cupon_usar(%L, 2, null, gen_random_uuid(), %L::jsonb)',
                 'PRBACDEFGH', '{"modo":"factura","numero_factura":"9174214"}')) as r2) x;
insert into _r174 (caso, ok, detalle)
select '5d cupón con la factura del plan B que ya tiene tarjeta (de otro referente): igual que antes, CLUB-AUD-02 (no lo frena la 174)',
       pg_temp.como(null, format($q$select public.club_visita_control('p174-a', %L, '{"modo":"factura","numero_factura":"9174211"}'::jsonb, null, %L::uuid, 1)$q$,
                                 public.club_visita_canonica('p174-a', '{"modo":"factura","numero_factura":"9174211"}'::jsonb, null),
                                 pg_temp.ref(2))) = 'ok', null;

-- 4. vuelta atrás (en esta misma transacción descartada) ───────────────────────────────────────────────────────────
-- @@174R@@   (aquí va el cuerpo de scripts/sql/174_rollback.sql sin begin/commit)
insert into _r174 (caso, ok, detalle)
select '4a rollback: sin club_facturas_buscar ni internas; TODAS las funciones de public como antes de la 174 (cuerpo, firma y permisos)',
       to_regprocedure('public.club_facturas_buscar(text,text)') is null
       and to_regprocedure('public.club_pos_ref_tarjeta(jsonb,text)') is null
       and to_regprocedure('public.club_facturas_lista(text,text,timestamptz)') is null
       and to_regprocedure('public.club_visita_con_tarjeta(text,text)') is null
       and to_regprocedure('public.club_facturas_desde(timestamptz,integer)') is null
       and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _antes174)
       and not exists (select 1 from _antes174 a left join pg_proc p on p.oid = to_regprocedure('public.' || a.fn)
                        where p.oid is null or md5(p.prosrc) <> a.md5 or p.proacl::text is distinct from a.acl),
       (select string_agg(a.fn, ',') from _antes174 a left join pg_proc p on p.oid = to_regprocedure('public.' || a.fn)
         where p.oid is null or md5(p.prosrc) <> a.md5 or p.proacl::text is distinct from a.acl);
insert into _r174 (caso, ok, detalle)
select '4b rollback: vuelve la regla de 2 h (la factura de ayer otra vez se rechaza): la prueba distingue',
       r = 'P0001 Esa factura tiene más de 2 horas: la resuelve el manager en Excepciones', r
  from (select pg_temp.tarjeta(2, '9174208') as r) x;

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r174;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r174 where not ok or ok is null;
  if v is not null then raise exception '174-FALLAN: %', v; end if;
  if (select count(*) from _r174) < 31 then raise exception '174-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
