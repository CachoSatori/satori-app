-- 193_pruebas · Propinas: cada uno ve solo lo suyo. Por rol, con JWT simulado (regla 4). Corre en STAGING (o Postgres
-- local con la base armada) DENTRO de una transacción que termina en ROLLBACK: no deja nada. Se arma con
-- scripts/sql/193_pruebas.py (--armar [--mutar X]); el runner llena los marcadores:
--   marcador 193  → cuerpo de supabase/migrations/193_… sin begin/commit (con --mutar, con el arreglo roto a propósito)
--   marcador 193G → la guarda de la 193 (su bloque do, como sentencia dentro de una función)
--   marcador 193R → cuerpo de scripts/sql/193_rollback.sql sin begin/commit (prueba que la vuelta atrás reabre la 085)
-- Todo es FICTICIO: usuarios 00000000-…-8193-…, un turno del 2030-01-10 con 5 filas que se distinguen por las horas
-- (1 = salonero A, 2 = salonero A con su fila vieja inactiva, 3 = salonero B, 4 = barman, 5 = salonero inactivo).
-- Necesita un owner ACTIVO en la base (el de staging).
begin;

-- ANTES (sin la 193): el salonero A ve las 5 filas del turno (la fuga). Se mide antes de aplicar.
create temp table _r193 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r193 to anon, authenticated;
grant usage on sequence _r193_n_seq to anon, authenticated;

create temp table _c193 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8193-0000000000a1'::uuid as manager,
       '00000000-0000-4000-8193-0000000000c1'::uuid as cajero,
       '00000000-0000-4000-8193-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8193-0000000000e1'::uuid as salonero_a,
       '00000000-0000-4000-8193-0000000000e2'::uuid as salonero_b,
       '00000000-0000-4000-8193-0000000000e3'::uuid as barman,
       '00000000-0000-4000-8193-0000000000e4'::uuid as cocina_sin_empleado,
       '00000000-0000-4000-8193-0000000000e5'::uuid as salonero_inactivo,
       '00000000-0000-4000-8193-0000000000f1'::uuid as proveedor,
       '00000000-0000-4000-8193-000000005e55'::uuid as sesion;
grant select on _c193 to anon, authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ((select manager from _c193),             '{"full_name":"Manager Ficticio"}'),
  ((select cajero from _c193),              '{"full_name":"Cajero Ficticio"}'),
  ((select contador from _c193),            '{"full_name":"Contador Ficticio"}'),
  ((select salonero_a from _c193),          '{"full_name":"Salonero Ficticio A"}'),
  ((select salonero_b from _c193),          '{"full_name":"Salonero Ficticio B"}'),
  ((select barman from _c193),              '{"full_name":"Barman Ficticio"}'),
  ((select cocina_sin_empleado from _c193), '{"full_name":"Cocina Ficticia"}'),
  ((select salonero_inactivo from _c193),   '{"full_name":"Salonero Ficticio Inactivo"}'),
  ((select proveedor from _c193),           '{"full_name":"Proveedor Ficticio"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c193), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager',   is_active = true  where id = (select manager from _c193);
update public.profiles set role = 'cajero',    is_active = true  where id = (select cajero from _c193);
update public.profiles set role = 'contador',  is_active = true  where id = (select contador from _c193);
update public.profiles set role = 'salonero',  is_active = true  where id = (select salonero_a from _c193);
update public.profiles set role = 'salonero',  is_active = true  where id = (select salonero_b from _c193);
update public.profiles set role = 'barman',    is_active = true  where id = (select barman from _c193);
update public.profiles set role = 'cocina',    is_active = true  where id = (select cocina_sin_empleado from _c193);
update public.profiles set role = 'salonero',  is_active = false where id = (select salonero_inactivo from _c193);
update public.profiles set role = 'proveedor', is_active = true  where id = (select proveedor from _c193);
select set_config('request.jwt.claims', '', true);

-- Empleados ficticios: el salonero A tiene DOS filas (una vieja inactiva); la cocina no tiene empleado.
insert into public.employees (full_name, role, profile_id, is_active) values
  ('Salonero Ficticio A',        'salonero', (select salonero_a from _c193),        true),
  ('Salonero Ficticio A Viejo',  'salonero', (select salonero_a from _c193),        false),
  ('Salonero Ficticio B',        'salonero', (select salonero_b from _c193),        true),
  ('Barman Ficticio',            'barman',   (select barman from _c193),            true),
  ('Salonero Ficticio Inactivo', 'salonero', (select salonero_inactivo from _c193), true);
create temp table _e193 on commit drop as
select e.id, e.full_name from public.employees e
where e.profile_id in (select salonero_a from _c193 union all select salonero_b from _c193
                       union all select barman from _c193 union all select salonero_inactivo from _c193);

insert into public.tip_sessions (id, session_date, shift_type, opened_by, closed_by, status, location_id)
values ((select sesion from _c193), '2030-01-10', 'PM', (select owner_id from _c193), (select owner_id from _c193), 'closed', 'santa-teresa');
insert into public.tip_entries (session_id, employee_id, hours_worked, tip_amount_crc, points, payout_crc)
select (select sesion from _c193), e.id, x.h, 1000 * x.h, 1, 10000 * x.h
from _e193 e
join (values ('Salonero Ficticio A', 1), ('Salonero Ficticio A Viejo', 2), ('Salonero Ficticio B', 3),
             ('Barman Ficticio', 4), ('Salonero Ficticio Inactivo', 5)) as x(nombre, h) on x.nombre = e.full_name;

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
-- Como un usuario, una ESCRITURA: devuelve las filas tocadas o el error.
create function pg_temp.como_escribe(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
declare n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql;
  get diagnostics n = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return to_jsonb(n);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return to_jsonb('ERR ' || sqlstate);
end $f$;
-- Qué filas del turno ficticio ve (por las horas), y lo mismo por el embed de getAttendanceHistory.
create function pg_temp.q_filas() returns text language sql immutable as $f$
  select $q$select coalesce(string_agg(hours_worked::int::text, ',' order by hours_worked), '') from public.tip_entries where session_id = '00000000-0000-4000-8193-000000005e55'$q$ $f$;
create function pg_temp.q_embed() returns text language sql immutable as $f$
  select $q$select coalesce(string_agg(te.hours_worked::int::text, ',' order by te.hours_worked), '') from public.tip_sessions ts join public.tip_entries te on te.session_id = ts.id where ts.id = '00000000-0000-4000-8193-000000005e55' and ts.status = 'closed'$q$ $f$;
create function pg_temp.chk(p_caso text, p_got jsonb, p_esperado jsonb) returns void language sql as $f$
  insert into _r193 (caso, ok, detalle) values (p_caso, p_got = p_esperado, 'got ' || coalesce(p_got::text, 'null') || ' · esperado ' || p_esperado::text) $f$;

-- 00 · ANTES de la 193: la fuga existe (si no, la batería no prueba nada).
do $$
declare c record;
begin
  select * into c from _c193;
  perform pg_temp.chk('00 antes: salonero A ve las 5 (fuga)', pg_temp.como(c.salonero_a, pg_temp.q_filas()), '"1,2,3,4,5"');
end $$;

-- @@193@@

do $$
declare c record;
begin
  select * into c from _c193;
  -- 01 · gestión ve todo, como hoy
  perform pg_temp.chk('01 owner ve todo',     pg_temp.como(c.owner_id, pg_temp.q_filas()), '"1,2,3,4,5"');
  perform pg_temp.chk('01 manager ve todo',   pg_temp.como(c.manager,  pg_temp.q_filas()), '"1,2,3,4,5"');
  perform pg_temp.chk('01 cajero ve todo',    pg_temp.como(c.cajero,   pg_temp.q_filas()), '"1,2,3,4,5"');
  perform pg_temp.chk('01 contador ve todo',  pg_temp.como(c.contador, pg_temp.q_filas()), '"1,2,3,4,5"');
  -- 02 · el personal ve solo lo suyo (incluye su fila de empleado vieja inactiva)
  perform pg_temp.chk('02 salonero A: solo lo suyo',  pg_temp.como(c.salonero_a, pg_temp.q_filas()), '"1,2"');
  perform pg_temp.chk('02 salonero B: solo lo suyo',  pg_temp.como(c.salonero_b, pg_temp.q_filas()), '"3"');
  perform pg_temp.chk('02 barman: solo lo suyo',      pg_temp.como(c.barman,     pg_temp.q_filas()), '"4"');
  -- 03 · el embed de getAttendanceHistory (tip_sessions → tip_entries) da lo mismo
  perform pg_temp.chk('03 embed salonero A: solo lo suyo', pg_temp.como(c.salonero_a, pg_temp.q_embed()), '"1,2"');
  perform pg_temp.chk('03 embed owner: todo',              pg_temp.como(c.owner_id,   pg_temp.q_embed()), '"1,2,3,4,5"');
  -- 04 · sin acceso
  perform pg_temp.chk('04 cocina sin empleado: nada', pg_temp.como(c.cocina_sin_empleado, pg_temp.q_filas()), '""');
  perform pg_temp.chk('04 proveedor: nada',           pg_temp.como(c.proveedor,           pg_temp.q_filas()), '""');
  perform pg_temp.chk('04 salonero inactivo: nada',   pg_temp.como(c.salonero_inactivo,   pg_temp.q_filas()), '""');
  perform pg_temp.chk('04 anon: sin permiso',         pg_temp.como_anon(pg_temp.q_filas()), '"ERR 42501"');
  -- 05 · escrituras sin cambio: el personal no escribe ni lo suyo; el cajero sí
  perform pg_temp.chk('05 salonero A no actualiza lo suyo', pg_temp.como_escribe(c.salonero_a,
    $q$update public.tip_entries set points = 9 where session_id = '00000000-0000-4000-8193-000000005e55'$q$), '0');
  perform pg_temp.chk('05 salonero A no borra',             pg_temp.como_escribe(c.salonero_a,
    $q$delete from public.tip_entries where session_id = '00000000-0000-4000-8193-000000005e55'$q$), '0');
  perform pg_temp.chk('05 contador no actualiza',           pg_temp.como_escribe(c.contador,
    $q$update public.tip_entries set points = 9 where session_id = '00000000-0000-4000-8193-000000005e55'$q$), '0');
  perform pg_temp.chk('05 cajero actualiza (reparto)',      pg_temp.como_escribe(c.cajero,
    $q$update public.tip_entries set points = 1 where session_id = '00000000-0000-4000-8193-000000005e55'$q$), '5');
  -- 06 · el helper: solo mis ids; vacío si inactivo; anon no lo ejecuta
  perform pg_temp.chk('06 helper salonero A: 2 ids',  pg_temp.como(c.salonero_a, 'select cardinality(public.propinas_mis_empleados())'), '2');
  perform pg_temp.chk('06 helper inactivo: vacío',    pg_temp.como(c.salonero_inactivo, 'select cardinality(public.propinas_mis_empleados())'), '0');
  perform pg_temp.chk('06 helper anon: sin permiso',  pg_temp.como_anon('select public.propinas_mis_empleados()'), '"ERR 42501"');
end $$;

insert into _r193 (caso, ok, detalle)
select '07 helper: security definer + search_path fijo', p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'],
       coalesce(p.proconfig::text, 'null')
from pg_proc p where p.oid = 'public.propinas_mis_empleados()'::regprocedure;
insert into _r193 (caso, ok, detalle)
select '07 helper: anon sin EXECUTE, authenticated con',
       not has_function_privilege('anon', 'public.propinas_mis_empleados()', 'execute')
       and has_function_privilege('authenticated', 'public.propinas_mis_empleados()', 'execute'), '';
insert into _r193 (caso, ok, detalle)
select '07 tip_entries: 3 policies (2 lectura + op_write intacta)', count(*) = 3, string_agg(policyname, ',' order by policyname)
from pg_policies where schemaname = 'public' and tablename = 'tip_entries';
insert into _r193 (caso, ok, detalle)
select '07 op_write sin cambio (md5)', md5(coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|' || permissive || '|' || roles::text) = 'da4dc6bf46cdceb8966878214e7405cd', ''
from pg_policies where schemaname = 'public' and tablename = 'tip_entries' and policyname = 'tip_entries_op_write';

-- 08 · La guarda de la 193 (R13): con la policy ya cambiada, una segunda pasada aborta sin tocar nada.
create function pg_temp.guarda_aborta() returns text language plpgsql as $f$
begin
  -- @@193G@@
  return 'no abortó';
exception when others then
  return sqlstate || ' ' || left(sqlerrm, 40);
end $f$;
insert into _r193 (caso, ok, detalle)
select '08 guarda: segunda pasada aborta', g like 'P0001 193:%', g from pg_temp.guarda_aborta() g;

-- 09 · Vuelta atrás: el rollback devuelve la 085 tal cual (la fuga vuelve) y borra el helper.
-- @@193R@@
do $$
declare c record;
begin
  select * into c from _c193;
  perform pg_temp.chk('09 rollback: salonero A vuelve a ver todo (085)', pg_temp.como(c.salonero_a, pg_temp.q_filas()), '"1,2,3,4,5"');
  insert into _r193 (caso, ok, detalle)
  select '09 rollback: helper borrado', to_regprocedure('public.propinas_mis_empleados()') is null, '';
end $$;

select json_build_object('total', count(*), 'ok', count(*) filter (where ok),
                         'fallan', coalesce(json_agg(json_build_object('caso', caso, 'detalle', detalle) order by n) filter (where not ok), '[]'::json))
from _r193;
rollback;
