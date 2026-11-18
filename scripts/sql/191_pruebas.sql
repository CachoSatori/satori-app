-- 191_pruebas · Ventas del PoS: cada uno ve solo lo suyo + pos_nombres_por_login. Por rol, con JWT simulado
-- (regla 4). Corre en STAGING (o Postgres local con la base armada) DENTRO de una transacción que termina en ROLLBACK:
-- no deja nada. Se arma con scripts/sql/191_pruebas.py (--armar [--mutar X]); el runner llena los marcadores:
--   marcador 191  → cuerpo de supabase/migrations/191_… sin begin/commit (con --mutar, con el arreglo roto a propósito)
--   marcador 191R → cuerpo de scripts/sql/191_rollback.sql sin begin/commit (prueba que la vuelta atrás reabre la 067)
-- Todo es FICTICIO: locales prueba191a / prueba191b, logins p191*, facturas del año 2030, usuarios 00000000-…-8191-….
-- Necesita un owner ACTIVO en la base (el de staging; en local lo crea --semilla-local).
begin;
-- @@191@@
create temp table _r191 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r191 to anon, authenticated;
grant usage on sequence _r191_n_seq to anon, authenticated;

create temp table _c191 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8191-0000000000a1'::uuid as manager_a,
       '00000000-0000-4000-8191-0000000000c1'::uuid as cajero,
       '00000000-0000-4000-8191-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8191-0000000000e1'::uuid as salonero,
       '00000000-0000-4000-8191-0000000000e2'::uuid as barman_sin_login,
       '00000000-0000-4000-8191-0000000000e3'::uuid as salonero_inactivo,
       '00000000-0000-4000-8191-0000000000e4'::uuid as cocina;
grant select on _c191 to anon, authenticated;

insert into public.locations (id, name) values ('prueba191a', 'Local Ficticio A'), ('prueba191b', 'Local Ficticio B')
on conflict (id) do nothing;

insert into auth.users (id, raw_user_meta_data) values
  ((select manager_a from _c191),         '{"full_name":"Manager Ficticio A"}'),
  ((select cajero from _c191),            '{"full_name":"Cajero Ficticio"}'),
  ((select contador from _c191),          '{"full_name":"Contador Ficticio"}'),
  ((select salonero from _c191),          '{"full_name":"Salonero Ficticio Uno"}'),
  ((select barman_sin_login from _c191),  '{"full_name":"Barman Ficticio"}'),
  ((select salonero_inactivo from _c191), '{"full_name":"Salonero Ficticio Dos"}'),
  ((select cocina from _c191),            '{"full_name":"Cocina Ficticia"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c191), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager',  is_active = true  where id = (select manager_a from _c191);
update public.profiles set role = 'cajero',   is_active = true  where id = (select cajero from _c191);
update public.profiles set role = 'contador', is_active = true  where id = (select contador from _c191);
update public.profiles set role = 'salonero', is_active = true  where id = (select salonero from _c191);
update public.profiles set role = 'barman',   is_active = true  where id = (select barman_sin_login from _c191);
update public.profiles set role = 'salonero', is_active = false where id = (select salonero_inactivo from _c191);
update public.profiles set role = 'cocina',   is_active = true  where id = (select cocina from _c191);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values ((select manager_a from _c191), 'prueba191a', true);

-- Empleados ficticios: el salonero tiene DOS filas (una vieja inactiva con otro login, con espacios a propósito);
-- el barman no tiene login. El caso «login reciclado» (dos filas con el mismo pos_login: gana la activa) NO SE PRUEBA
-- acá: staging tiene `employees_pos_login_key` (unique) y prod no (deriva de esquema, 18-nov). NO PROBADO en staging.
insert into public.employees (full_name, role, profile_id, is_active, pos_login, created_at) values
  ('Salonero Ficticio Uno',      'salonero', (select salonero from _c191),          true,  'p191s1',    now()),
  ('Salonero Ficticio Uno Viejo','salonero', (select salonero from _c191),          false, ' p191x1 ',  now() - interval '400 days'),
  ('Salonero Ficticio Dos',      'salonero', (select salonero_inactivo from _c191), true,  'p191s2',    now()),
  ('Barman Ficticio',            'barman',   (select barman_sin_login from _c191),  true,  null,        now()),
  ('Reciclado Nuevo Ficticio',   'salonero', null,                                  true,  'p191r',     now());

-- Facturas ficticias (2030). A: T1 (p191s1, C), T2 (p191s2, C), T3 (p191s1, R), T6 (' p191x1', C). B: T4 (p191s1, C),
-- T5 (p191s2, C). Una línea por factura. Cursor para los dos locales.
insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, estado, canal, salonero_login,
                                    registrado_por, con_servicio, pax_alerta, total_crc, pax) values
  ('00000000-0000-4000-8191-00000000a001', 'prueba191a', 'F191-1', '2030-01-10 19:00-06', 'C', 'salon', 'p191s1',  'salonero', true, 'ok', 1000, 2),
  ('00000000-0000-4000-8191-00000000a002', 'prueba191a', 'F191-2', '2030-01-10 19:10-06', 'C', 'salon', 'p191s2',  'salonero', true, 'ok', 2000, 2),
  ('00000000-0000-4000-8191-00000000a003', 'prueba191a', 'F191-3', '2030-01-10 19:20-06', 'R', 'salon', 'p191s1',  'salonero', true, 'ok', 3000, 2),
  ('00000000-0000-4000-8191-00000000a006', 'prueba191a', 'F191-6', '2030-01-10 19:30-06', 'C', 'salon', ' p191x1', 'salonero', true, 'ok', 6000, 2),
  ('00000000-0000-4000-8191-00000000b004', 'prueba191b', 'F191-4', '2030-01-10 19:00-06', 'C', 'salon', 'p191s1',  'salonero', true, 'ok', 4000, 2),
  ('00000000-0000-4000-8191-00000000b005', 'prueba191b', 'F191-5', '2030-01-10 19:10-06', 'C', 'salon', 'p191s2',  'salonero', true, 'ok', 5000, 2);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '100', 'PRODUCTO FICTICIO', 1, 1000, 3 from public.pos_ndf_tickets t where t.local in ('prueba191a', 'prueba191b');
insert into public.pos_ndf_cursor (local, last_poll_at) values ('prueba191a', now()), ('prueba191b', now())
on conflict (local) do nothing;

-- Como un usuario autenticado (JWT simulado) o como anon. Devuelve jsonb o el error.
create function pg_temp.como(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select to_jsonb((' || p_sql || '))' into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return to_jsonb('ERR ' || sqlstate);
end $f$;
create function pg_temp.como_anon(p_sql text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  execute 'select to_jsonb((' || p_sql || '))' into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return to_jsonb('ERR ' || sqlstate);
end $f$;
-- Lo que cada consulta devuelve (como texto, para comparar).
create function pg_temp.q_tk(p_local text) returns text language sql immutable as $f$
  select format($q$select coalesce(string_agg(numero_factura, ',' order by numero_factura), '') from public.pos_ventas_tickets_rango(%L, '2030-01-01', '2030-02-01')$q$, p_local) $f$;
create function pg_temp.q_ln() returns text language sql immutable as $f$
  select $q$select coalesce(string_agg(right(ticket_id::text, 4), ',' order by ticket_id::text), '') from public.pos_ventas_lineas(array['00000000-0000-4000-8191-00000000a001','00000000-0000-4000-8191-00000000a002','00000000-0000-4000-8191-00000000a003','00000000-0000-4000-8191-00000000a006','00000000-0000-4000-8191-00000000b004','00000000-0000-4000-8191-00000000b005']::uuid[])$q$ $f$;
create function pg_temp.q_lat(p_local text) returns text language sql immutable as $f$
  select format($q$select count(*) from public.pos_ventas_latido(%L)$q$, p_local) $f$;
create function pg_temp.q_nom() returns text language sql immutable as $f$
  select $q$select coalesce(string_agg(pos_login || '=' || nombre, ',' order by pos_login), '') from public.pos_nombres_por_login() where pos_login like 'p191%'$q$ $f$;
create function pg_temp.chk(p_caso text, p_got jsonb, p_esperado jsonb) returns void language sql as $f$
  insert into _r191 (caso, ok, detalle) values (p_caso, p_got = p_esperado, 'got ' || coalesce(p_got::text, 'null') || ' · esperado ' || p_esperado::text) $f$;

do $$
declare c record;
begin
  select * into c from _c191;
  -- 01–04 · tickets por rol (local A y B)
  perform pg_temp.chk('01 owner ve todo A',              pg_temp.como(c.owner_id, pg_temp.q_tk('prueba191a')), '"F191-1,F191-2,F191-6"');
  perform pg_temp.chk('01 owner ve todo B',              pg_temp.como(c.owner_id, pg_temp.q_tk('prueba191b')), '"F191-4,F191-5"');
  perform pg_temp.chk('02 contador ve todo A',           pg_temp.como(c.contador, pg_temp.q_tk('prueba191a')), '"F191-1,F191-2,F191-6"');
  perform pg_temp.chk('02 contador ve todo B',           pg_temp.como(c.contador, pg_temp.q_tk('prueba191b')), '"F191-4,F191-5"');
  perform pg_temp.chk('03 manager ve su local A',        pg_temp.como(c.manager_a, pg_temp.q_tk('prueba191a')), '"F191-1,F191-2,F191-6"');
  perform pg_temp.chk('03 manager NO ve el local B',     pg_temp.como(c.manager_a, pg_temp.q_tk('prueba191b')), '""');
  perform pg_temp.chk('04 salonero ve solo lo suyo A',   pg_temp.como(c.salonero, pg_temp.q_tk('prueba191a')), '"F191-1,F191-6"');
  perform pg_temp.chk('04 salonero ve solo lo suyo B',   pg_temp.como(c.salonero, pg_temp.q_tk('prueba191b')), '"F191-4"');
  -- 05 · sin acceso
  perform pg_temp.chk('05 barman sin login: nada',       pg_temp.como(c.barman_sin_login, pg_temp.q_tk('prueba191a')), '""');
  perform pg_temp.chk('05 cocina sin empleado: nada',    pg_temp.como(c.cocina, pg_temp.q_tk('prueba191a')), '""');
  perform pg_temp.chk('05 cajero: nada',                 pg_temp.como(c.cajero, pg_temp.q_tk('prueba191a')), '""');
  perform pg_temp.chk('05 salonero inactivo: nada',      pg_temp.como(c.salonero_inactivo, pg_temp.q_tk('prueba191a')), '""');
  perform pg_temp.chk('05 anon: sin permiso',            pg_temp.como_anon(pg_temp.q_tk('prueba191a')), '"ERR 42501"');
  -- 06 · líneas (sin filtro de estado: la R propia sale)
  perform pg_temp.chk('06 owner: todas las líneas',      pg_temp.como(c.owner_id, pg_temp.q_ln()), '"a001,a002,a003,a006,b004,b005"');
  perform pg_temp.chk('06 contador: todas las líneas',   pg_temp.como(c.contador, pg_temp.q_ln()), '"a001,a002,a003,a006,b004,b005"');
  perform pg_temp.chk('06 manager: solo de su local',    pg_temp.como(c.manager_a, pg_temp.q_ln()), '"a001,a002,a003,a006"');
  perform pg_temp.chk('06 salonero: solo de las suyas',  pg_temp.como(c.salonero, pg_temp.q_ln()), '"a001,a003,a006,b004"');
  perform pg_temp.chk('06 barman sin login: nada',       pg_temp.como(c.barman_sin_login, pg_temp.q_ln()), '""');
  perform pg_temp.chk('06 cajero: nada',                 pg_temp.como(c.cajero, pg_temp.q_ln()), '""');
  perform pg_temp.chk('06 anon: sin permiso',            pg_temp.como_anon(pg_temp.q_ln()), '"ERR 42501"');
  -- 07 · latido
  perform pg_temp.chk('07 owner latido A',               pg_temp.como(c.owner_id, pg_temp.q_lat('prueba191a')), '1');
  perform pg_temp.chk('07 manager latido A',             pg_temp.como(c.manager_a, pg_temp.q_lat('prueba191a')), '1');
  perform pg_temp.chk('07 manager latido B = 0',         pg_temp.como(c.manager_a, pg_temp.q_lat('prueba191b')), '0');
  perform pg_temp.chk('07 salonero latido A',            pg_temp.como(c.salonero, pg_temp.q_lat('prueba191a')), '1');
  perform pg_temp.chk('07 cajero latido = 0',            pg_temp.como(c.cajero, pg_temp.q_lat('prueba191a')), '0');
  perform pg_temp.chk('07 inactivo latido = 0',          pg_temp.como(c.salonero_inactivo, pg_temp.q_lat('prueba191a')), '0');
  -- 08 · nombres por login (solo gerencia; incluye inactivos)
  perform pg_temp.chk('08 owner nombres',    pg_temp.como(c.owner_id, pg_temp.q_nom()),
                      '"p191r=Reciclado Nuevo Ficticio,p191s1=Salonero Ficticio Uno,p191s2=Salonero Ficticio Dos,p191x1=Salonero Ficticio Uno Viejo"');
  perform pg_temp.chk('08 contador nombres (con inactivos)', pg_temp.como(c.contador, pg_temp.q_nom()),
                      '"p191r=Reciclado Nuevo Ficticio,p191s1=Salonero Ficticio Uno,p191s2=Salonero Ficticio Dos,p191x1=Salonero Ficticio Uno Viejo"');
  perform pg_temp.chk('08 manager nombres',  pg_temp.como(c.manager_a, pg_temp.q_nom()),
                      '"p191r=Reciclado Nuevo Ficticio,p191s1=Salonero Ficticio Uno,p191s2=Salonero Ficticio Dos,p191x1=Salonero Ficticio Uno Viejo"');
  perform pg_temp.chk('08 salonero: nada',   pg_temp.como(c.salonero, pg_temp.q_nom()), '""');
  perform pg_temp.chk('08 cajero: nada',     pg_temp.como(c.cajero, pg_temp.q_nom()), '""');
  perform pg_temp.chk('08 anon: sin permiso', pg_temp.como_anon(pg_temp.q_nom()), '"ERR 42501"');
  -- 09 · la función devuelve SOLO dos columnas (nada más de employees)
  insert into _r191 (caso, ok, detalle)
  select '09 nombres: solo 2 columnas', count(*) = 2, string_agg(a.attname, ',')
  from pg_proc p, unnest(p.proargnames) with ordinality a(attname, i)
  where p.oid = 'public.pos_nombres_por_login()'::regprocedure and p.proargmodes[a.i] = 't';
  -- 10 · helpers internos y ACL
  perform pg_temp.chk('10 pos_mis_logins no es de la API', pg_temp.como(c.salonero, 'select public.pos_mis_logins()'), '"ERR 42501"');
  insert into _r191 (caso, ok, detalle)
  select '10 search_path fijo en las 5', count(*) = 5, string_agg(p.proname, ',')
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and p.proname in ('pos_ventas_tickets_rango', 'pos_ventas_lineas', 'pos_ventas_latido', 'pos_mis_logins', 'pos_nombres_por_login')
    and p.proconfig @> array['search_path=public, pg_temp'];
  -- 12 · la 190 (`pos_ventas_resumen`, en prod desde el 18-nov) sigue validando su rol adentro y no la toca la 191.
  -- Corre solo si la 190 está en la base (staging, al 18-nov, no la tiene: se aplica antes en la misma transacción).
  if to_regprocedure('public.pos_ventas_resumen(text,date,date)') is not null then
    perform pg_temp.chk('12 resumen 190: owner lee A', pg_temp.como(c.owner_id, $q$select jsonb_array_length(public.pos_ventas_resumen('prueba191a', '2030-01-10', '2030-01-10')->'facturas')$q$), '3');
    perform pg_temp.chk('12 resumen 190: contador lee A', pg_temp.como(c.contador, $q$select jsonb_array_length(public.pos_ventas_resumen('prueba191a', '2030-01-10', '2030-01-10')->'facturas')$q$), '3');
    perform pg_temp.chk('12 resumen 190: manager lee A', pg_temp.como(c.manager_a, $q$select jsonb_array_length(public.pos_ventas_resumen('prueba191a', '2030-01-10', '2030-01-10')->'facturas')$q$), '3');
    perform pg_temp.chk('12 resumen 190: salonero 42501', pg_temp.como(c.salonero, $q$select public.pos_ventas_resumen('prueba191a', '2030-01-10', '2030-01-10')$q$), '"ERR 42501"');
    perform pg_temp.chk('12 resumen 190: cajero 42501', pg_temp.como(c.cajero, $q$select public.pos_ventas_resumen('prueba191a', '2030-01-10', '2030-01-10')$q$), '"ERR 42501"');
    perform pg_temp.chk('12 resumen 190: anon sin permiso', pg_temp.como_anon($q$select public.pos_ventas_resumen('prueba191a', '2030-01-10', '2030-01-10')$q$), '"ERR 42501"');
  end if;
end $$;

-- 11 · Vuelta atrás: el rollback devuelve la 067 tal cual (la fuga vuelve) y borra lo nuevo.
-- @@191R@@
do $$
declare c record;
begin
  select * into c from _c191;
  perform pg_temp.chk('11 rollback: salonero vuelve a ver todo A (067)', pg_temp.como(c.salonero, pg_temp.q_tk('prueba191a')), '"F191-1,F191-2,F191-6"');
  insert into _r191 (caso, ok, detalle)
  select '11 rollback: funciones nuevas borradas', count(*) = 0, string_agg(proname, ',')
  from pg_proc where pronamespace = 'public'::regnamespace and proname in ('pos_mis_logins', 'pos_nombres_por_login');
end $$;

select json_build_object('total', count(*), 'ok', count(*) filter (where ok),
                         'fallan', coalesce(json_agg(json_build_object('caso', caso, 'detalle', detalle) order by n) filter (where not ok), '[]'::json))
from _r191;
rollback;
