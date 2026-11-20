-- 194_pruebas · Mi Rendimiento: agregados del equipo sin filas de otros. Por rol, con JWT simulado (regla 4).
-- Corre en STAGING (o Postgres local con la base armada) DENTRO de una transacción que termina en ROLLBACK: no deja
-- nada. Se arma con scripts/sql/194_pruebas.py (--armar [--mutar X]); el runner llena los marcadores:
--   marcador 191  → 190, 191, 192 y 193 tal cual, cada una solo si falta (staging al 18-nov está en 188).
--   marcador 194  → cuerpo de supabase/migrations/194_… sin begin/commit (con --mutar, con el arreglo roto a propósito)
--   marcador 194R → cuerpo de scripts/sql/194_rollback.sql sin begin/commit (prueba que la vuelta atrás borra todo)
-- Todo es FICTICIO: local prueba194 / prueba194b, logins p194*, facturas de enero de 2020 (en un local que no existe en
-- el PoS), usuarios 00000000-…-8194-….
-- Cuentas a mano (las espera cada caso), lunes 06-01-2020, local prueba194:
--   a (YO, p194a): neta 10.000 (2 rolls ₡6.000 + 2 bebidas ₡4.000; una línea de familia 17 de ₡999 NO es venta), pax 2
--   b (p194b): neta 8.000 (1 roll ₡4.000 + 1,5 bebidas → 2 uds ₡4.000), pax 2. Una factura X de ₡50.000 NO cuenta.
--   c (p194c): neta 30.000 (3 rolls ₡21.000 + 3 tragos ₡9.000; el trago tiene multiplicador 2 en product_map), pax 3
--   d (p194d): neta 6.000 de salón (1 «otro» ₡6.000, pax 1) + 2.000 de DELIVERY (1 «otro 2», pax 0)
--   caja: una factura de cajero en salón, ₡4.000, pax 2.
-- Martes 07-01-2020: a ₡5.000 (1 roll, pax 1) y b ₡7.000 (1 «otro», pax 1): solo 2 personas → grupo chico.
-- Miércoles 08-01-2020: a ₡3.000 (pax 1), b ₡4.000 (pax 2), c ₡5.000 (pax 1): 3 personas → tampoco posición ni promedios.
-- Lunes 07-01-2019 (= 06-01-2020 − 364 días, mismo día de semana): b ₡9.000, pax 2 → «el local el año pasado».
begin;
-- @@191@@
-- @@194@@
create temp table _r194 (n serial, tag text not null default coalesce(nullif(current_setting('t194.tag', true), ''), 'sin mutar'), caso text, ok boolean, detalle text) on commit drop;
grant all on _r194 to anon, authenticated;
grant usage on sequence _r194_n_seq to anon, authenticated;

create temp table _c194 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8194-0000000000a1'::uuid as manager_a,
       '00000000-0000-4000-8194-0000000000a2'::uuid as manager_b,
       '00000000-0000-4000-8194-0000000000c1'::uuid as cajero,
       '00000000-0000-4000-8194-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8194-0000000000e1'::uuid as yo,
       '00000000-0000-4000-8194-0000000000e2'::uuid as barman_sin_login,
       '00000000-0000-4000-8194-0000000000e3'::uuid as salonero_inactivo,
       '00000000-0000-4000-8194-0000000000e5'::uuid as salonero_sin_ventas;
grant select on _c194 to anon, authenticated;

insert into public.locations (id, name) values ('prueba194', 'Local Ficticio 194'), ('prueba194b', 'Local Ficticio 194 B')
on conflict (id) do nothing;

insert into auth.users (id, raw_user_meta_data) values
  ((select manager_a from _c194),           '{"full_name":"Manager Ficticio 194"}'),
  ((select manager_b from _c194),           '{"full_name":"Manager Ficticio 194 B"}'),
  ((select cajero from _c194),              '{"full_name":"Cajero Ficticio 194"}'),
  ((select contador from _c194),            '{"full_name":"Contador Ficticio 194"}'),
  ((select yo from _c194),                  '{"full_name":"Salonero 194 A"}'),
  ((select barman_sin_login from _c194),    '{"full_name":"Barman Ficticio 194"}'),
  ((select salonero_inactivo from _c194),   '{"full_name":"Salonero 194 Inactivo"}'),
  ((select salonero_sin_ventas from _c194), '{"full_name":"Salonero 194 E"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c194), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager',  is_active = true  where id in ((select manager_a from _c194), (select manager_b from _c194));
update public.profiles set role = 'cajero',   is_active = true  where id = (select cajero from _c194);
update public.profiles set role = 'contador', is_active = true  where id = (select contador from _c194);
update public.profiles set role = 'salonero', is_active = true  where id in ((select yo from _c194), (select salonero_sin_ventas from _c194));
update public.profiles set role = 'barman',   is_active = true  where id = (select barman_sin_login from _c194);
update public.profiles set role = 'salonero', is_active = false where id = (select salonero_inactivo from _c194);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values
  ((select manager_a from _c194), 'prueba194', true), ((select manager_b from _c194), 'prueba194b', true),
  ((select yo from _c194), 'prueba194', true), ((select salonero_sin_ventas from _c194), 'prueba194', true),
  ((select cajero from _c194), 'prueba194', true);   -- el cajero en el local: el 42501 tiene que salir por el ROL

insert into public.employees (full_name, role, profile_id, is_active, pos_login, created_at) values
  ('Salonero 194 A',        'salonero', (select yo from _c194),                  true,  'p194a', now()),
  ('Salonero 194 B',        'salonero', null,                                    true,  'p194b', now()),
  ('Salonero 194 C',        'salonero', null,                                    true,  'p194c', now()),
  ('Salonero 194 D',        'salonero', null,                                    true,  'p194d', now()),
  ('Salonero 194 E',        'salonero', (select salonero_sin_ventas from _c194), true,  'p194e', now()),
  ('Salonero 194 Inactivo', 'salonero', (select salonero_inactivo from _c194),   true,  'p194i', now()),
  ('Barman Ficticio 194',   'barman',   (select barman_sin_login from _c194),    true,  null,    now());

insert into public.product_map (nombre, tipo, multiplicador) values ('TRAGO FICTICIO 194', 'bebida', 2)
on conflict (nombre) do update set tipo = excluded.tipo, multiplicador = excluded.multiplicador;

insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, estado, canal, salonero_login, cajero_login,
                                    registrado_por, con_servicio, pax_alerta, total_crc, pax, pax_articulo) values
  ('00000000-0000-4000-8194-00000000a001', 'prueba194', 'F194-1', '2020-01-06 19:00-06', 'C', 'salon',    'p194a',  '222', 'salonero', true, 'ok', 0, 0, 2),
  ('00000000-0000-4000-8194-00000000a002', 'prueba194', 'F194-2', '2020-01-06 19:05-06', 'C', 'salon',    'p194b',  '222', 'salonero', true, 'ok', 0, 2, 0),
  ('00000000-0000-4000-8194-00000000a003', 'prueba194', 'F194-3', '2020-01-06 19:10-06', 'X', 'salon',    'p194b',  '222', 'salonero', true, 'ok', 0, 9, 0),
  ('00000000-0000-4000-8194-00000000a004', 'prueba194', 'F194-4', '2020-01-06 19:15-06', 'C', 'salon',    ' p194c ', '222', 'salonero', true, 'ok', 0, 3, 0),
  ('00000000-0000-4000-8194-00000000a005', 'prueba194', 'F194-5', '2020-01-06 19:20-06', 'C', 'salon',    'p194d',  '222', 'salonero', true, 'ok', 0, 1, 0),
  ('00000000-0000-4000-8194-00000000a006', 'prueba194', 'F194-6', '2020-01-06 19:25-06', 'C', 'delivery', 'p194d',  '222', 'salonero', true, 'ok', 0, 0, 0),
  ('00000000-0000-4000-8194-00000000a007', 'prueba194', 'F194-7', '2020-01-06 19:30-06', 'C', 'salon',    null,     '222', 'cajero',   true, 'ok', 0, 2, 0),
  ('00000000-0000-4000-8194-00000000b001', 'prueba194', 'F194-8', '2020-01-07 19:00-06', 'C', 'salon',    'p194a',  '222', 'salonero', true, 'ok', 0, 1, 0),
  ('00000000-0000-4000-8194-00000000b002', 'prueba194', 'F194-9', '2020-01-07 19:05-06', 'C', 'salon',    'p194b',  '222', 'salonero', true, 'ok', 0, 1, 0),
  ('00000000-0000-4000-8194-00000000c001', 'prueba194', 'F194-10', '2020-01-08 19:00-06', 'C', 'salon',   'p194a',  '222', 'salonero', true, 'ok', 0, 1, 0),
  ('00000000-0000-4000-8194-00000000c002', 'prueba194', 'F194-11', '2020-01-08 19:05-06', 'C', 'salon',   'p194b',  '222', 'salonero', true, 'ok', 0, 2, 0),
  ('00000000-0000-4000-8194-00000000c003', 'prueba194', 'F194-12', '2020-01-08 19:10-06', 'C', 'salon',   ' p194c ', '222', 'salonero', true, 'ok', 0, 1, 0),
  ('00000000-0000-4000-8194-00000000d001', 'prueba194', 'F194-13', '2019-01-07 19:00-06', 'C', 'salon',   'p194b',  '222', 'salonero', true, 'ok', 0, 2, 0);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia) values
  ('00000000-0000-4000-8194-00000000a001', '1', 'Roll Ficticio 194',  2,   6000, 3),
  ('00000000-0000-4000-8194-00000000a001', '2', 'BEBIDA FICTICIA 194', 2,  4000, 5),
  ('00000000-0000-4000-8194-00000000a001', '3', 'CORTESIA FICTICIA',   1,   999, 17),
  ('00000000-0000-4000-8194-00000000a001', '4', 'PAX',                 2,     0, 3),
  ('00000000-0000-4000-8194-00000000a002', '1', 'ROLL FICTICIO 194',   1,  4000, 3),
  ('00000000-0000-4000-8194-00000000a002', '2', 'BEBIDA FICTICIA 194', 1.5, 4000, 5),
  ('00000000-0000-4000-8194-00000000a003', '1', 'ROLL FICTICIO 194',   9, 50000, 3),
  ('00000000-0000-4000-8194-00000000a004', '1', 'ROLL FICTICIO 194',   3, 21000, 3),
  ('00000000-0000-4000-8194-00000000a004', '5', 'TRAGO FICTICIO 194',  3,  9000, 5),
  ('00000000-0000-4000-8194-00000000a005', '6', 'OTRO FICTICIO 194',   1,  6000, 3),
  ('00000000-0000-4000-8194-00000000a006', '7', 'OTRO 2 FICTICIO 194', 1,  2000, 16),
  ('00000000-0000-4000-8194-00000000a007', '6', 'OTRO FICTICIO 194',   1,  4000, 3),
  ('00000000-0000-4000-8194-00000000b001', '1', 'ROLL FICTICIO 194',   1,  5000, 3),
  ('00000000-0000-4000-8194-00000000b002', '6', 'OTRO FICTICIO 194',   1,  7000, 3),
  ('00000000-0000-4000-8194-00000000c001', '1', 'ROLL FICTICIO 194',   1,  3000, 3),
  ('00000000-0000-4000-8194-00000000c002', '6', 'OTRO FICTICIO 194',   1,  4000, 3),
  ('00000000-0000-4000-8194-00000000c003', '1', 'ROLL FICTICIO 194',   1,  5000, 3),
  ('00000000-0000-4000-8194-00000000d001', '6', 'OTRO FICTICIO 194',   1,  9000, 3);

-- Propinas: una sesión CERRADA el lunes (yo ₡1.000 + US$1 × 120 = ₡1.120; c ₡1.680 → equipo ₡2.800) y una ABIERTA
-- que no cuenta. Con la 192 el salonero lee de `tip_entries` SOLO su fila: el ICP del equipo sale igual (definer).
insert into public.tip_sessions (id, session_date, opened_by, status, exchange_rate, shift_type, location_id) values
  ('00000000-0000-4000-8194-0000000005a1', '2020-01-06', (select owner_id from _c194), 'closed', 120, 'PM', 'prueba194'),
  ('00000000-0000-4000-8194-0000000005a2', '2020-01-06', (select owner_id from _c194), 'open',   120, 'AM', 'prueba194');
insert into public.tip_entries (session_id, employee_id, hours_worked, tip_amount_crc, tip_amount_usd)
select '00000000-0000-4000-8194-0000000005a1'::uuid, e.id, 8, 1000, 1 from public.employees e where e.pos_login = 'p194a'
union all
select '00000000-0000-4000-8194-0000000005a1'::uuid, e.id, 8, 1680, 0 from public.employees e where e.pos_login = 'p194c'
union all
select '00000000-0000-4000-8194-0000000005a2'::uuid, e.id, 8, 90000, 0 from public.employees e where e.pos_login = 'p194b';

-- Competencias: 4 participantes (ROLL × 2 pts) y otra con 3. Puntos: a = (2 + 1) × 2 = 6 · b = 2 · c = 6 · d = 0.
insert into public.ventas_comps (data) values
  ('{"id":"c194-4","nombre":"Comp ficticia","tipo":"especial","inicio":"2020-01-06","fin":"2020-01-07","premio":"",
     "prods":[{"name":"ROLL FICTICIO 194","pts":2}],
     "parts":["Salonero 194 A","Salonero 194 B","Salonero 194 C","Salonero 194 D"]}'),
  ('{"id":"c194-3","nombre":"Comp chica","tipo":"especial","inicio":"2020-01-06","fin":"2020-01-07","premio":"",
     "prods":[{"name":"ROLL FICTICIO 194","pts":2}],
     "parts":["Salonero 194 A","Salonero 194 B","Nombre Que No Existe 194"]}');

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
create function pg_temp.q_eq(p_local text, p_desde text, p_hasta text) returns text language sql immutable as $f$
  select format($q$select public.pos_mi_rendimiento_equipo(%L, %L, %L)$q$, p_local, p_desde, p_hasta) $f$;
create function pg_temp.q_comp(p_id text) returns text language sql immutable as $f$
  select format($q$select public.pos_mi_competencia('prueba194', %L)$q$, p_id) $f$;
create function pg_temp.chk(p_caso text, p_got jsonb, p_esperado jsonb) returns void language sql as $f$
  insert into _r194 (tag, caso, ok, detalle) values (coalesce(nullif(current_setting('t194.tag', true), ''), 'sin mutar'), p_caso, coalesce(p_got, 'null'::jsonb) is not distinct from coalesce(p_esperado, 'null'::jsonb),
    'got ' || coalesce(p_got::text, 'null') || ' · esperado ' || coalesce(p_esperado::text, 'null')) $f$;
-- Todas las claves (a cualquier profundidad) de un jsonb, ordenadas: la lista blanca de lo que sale.
create function pg_temp.claves(j jsonb) returns text language sql immutable as $f$
  with recursive r(v, k) as (
    select j, null::text
    union all
    select x.v, x.k from r cross join lateral (
      select e.value as v, e.key as k from jsonb_each(case when jsonb_typeof(r.v) = 'object' then r.v else '{}'::jsonb end) e
      union all
      select a.value, '[]' from jsonb_array_elements(case when jsonb_typeof(r.v) = 'array' then r.v else '[]'::jsonb end) a
    ) x
  )
  select string_agg(distinct k collate "C", ',' order by k collate "C") from r where k is not null $f$;

create function pg_temp.casos() returns void language plpgsql as $cas$
declare c record; e jsonb; s jsonb; g jsonb;
begin
  select * into c from _c194;
  -- 01 · persona del PoS (espejo de personasNdf.ts)
  perform pg_temp.chk('01 clave: alias 266 → 038',          to_jsonb(public.pos_persona_clave('266', null)), '"038"');
  perform pg_temp.chk('01 clave: alias 235 → 01',           to_jsonb(public.pos_persona_clave(' 235 ', '2026-01-01')), '"01"');
  perform pg_temp.chk('01 clave: 0909 dentro de vigencia',  to_jsonb(public.pos_persona_clave('0909', '2025-06-01')), '"0909"');
  perform pg_temp.chk('01 clave: 0909 fuera de vigencia',   to_jsonb(public.pos_persona_clave('0909', '2026-06-01')), '"login 0909"');
  perform pg_temp.chk('01 clave: desconocido = su código',  to_jsonb(public.pos_persona_clave(' 444 ', null)), '"444"');
  perform pg_temp.chk('01 clave: vacío = null',             to_jsonb(public.pos_persona_clave('  ', null)), 'null');

  -- 02 · yo (salonero) el lunes: 4 personas → todo, en agregados
  e := pg_temp.como(c.yo, pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-06'));
  perform pg_temp.chk('02 yo: personas',                 e->'personas', '4');
  perform pg_temp.chk('02 yo: ranking 2.º de 4',          e->'ranking', '{"de": 4, "posicion": 2}');
  perform pg_temp.chk('02 yo: general',                   e->'general',
    '{"beb_pax": 0.88, "prom_pax": 5800, "comida_pax": 0.80, "prom_ticket": 3700}');
  perform pg_temp.chk('02 yo: año pasado = la misma ventana −364 días (mismo día de semana)', e->'anio_pasado',
    '{"desde": "2019-01-07", "hasta": "2019-01-07", "general": {"beb_pax": 0.00, "prom_pax": 4500, "comida_pax": 0.50, "prom_ticket": 9000}}');
  perform pg_temp.chk('02 yo: mediana del equipo',        e->'equipo'->'mediana',
    '{"pax_dia": 2.0, "beb_pax": 1.00, "prom_pax": 5500, "comida_pax": 1.00, "prom_ticket": 3000}');
  perform pg_temp.chk('02 yo: promedio del equipo',       e->'equipo'->'promedio',
    '{"pax_dia": 2.0, "beb_pax": 1.00, "prom_pax": 6300, "comida_pax": 1.13, "prom_ticket": 3100}');
  perform pg_temp.chk('02 yo: mi posición por indicador', e->'equipo'->'mi_posicion',
    '{"ventas": 2, "beb_pax": 2, "pax_dia": 2, "prom_pax": 3, "comida_pax": 2, "prom_ticket": 4}');
  perform pg_temp.chk('02 yo: ICP del equipo (solo cerradas)', e->'icp_equipo', '5.0');
  if to_regprocedure('public.propinas_mis_empleados()') is not null then
    perform pg_temp.chk('02 yo: con la 192, tip_entries directo = solo mi fila', pg_temp.como(c.yo,
      $q$select count(*) from public.tip_entries where session_id = '00000000-0000-4000-8194-0000000005a1'$q$), '1');
  end if;
  perform pg_temp.chk('02 yo: Prom/PAX del lunes',        (select x->'prom_pax' from jsonb_array_elements(e->'por_dow') x where x->>'dow' = '1'), '5800');
  perform pg_temp.chk('02 yo: motivo null',               e->'motivo', 'null');
  -- 03 · lo que sale es SOLO la lista blanca; ni logins, ni nombres, ni montos de otros
  perform pg_temp.chk('03 lista blanca de claves', to_jsonb(pg_temp.claves(e)),
    '"[],anio_pasado,beb_pax,comida_pax,de,desde,dow,equipo,general,hasta,icp_equipo,k_min,mediana,mi_posicion,motivo,pax_dia,personas,por_dow,posicion,prom_pax,prom_ticket,promedio,ranking,ventas,yo"');
  insert into _r194 (caso, ok, detalle)
  select '03 sin logins, nombres ni montos ajenos', not (e::text ~ '(p194|Salonero|30000|8000|6000|2000)'), e::text;

  -- 04 · grupo chico (martes: 2 personas): proporciones del local SÍ; posición, promedios e ICP del equipo NO
  s := pg_temp.como(c.yo, pg_temp.q_eq('prueba194', '2020-01-07', '2020-01-07'));
  perform pg_temp.chk('04 chico: motivo',     s->'motivo', '"grupo_chico"');
  perform pg_temp.chk('04 chico: sin posición', s->'ranking', 'null');
  perform pg_temp.chk('04 chico: proporciones del local siempre', s->'general',
    '{"beb_pax": 0.00, "prom_pax": 6000, "comida_pax": 1.00, "prom_ticket": 6000}');
  perform pg_temp.chk('04 chico: sin equipo',  s->'equipo', 'null');
  perform pg_temp.chk('04 chico: ICP del equipo siempre', s->'icp_equipo', '0.0');
  perform pg_temp.chk('04 chico: cuántas personas, no', s->'personas', 'null');
  perform pg_temp.chk('04 chico: martes con Prom/PAX del local', (select x->'prom_pax' from jsonb_array_elements(s->'por_dow') x where x->>'dow' = '2'), '6000');
  perform pg_temp.chk('04 chico: año pasado sin datos', s->'anio_pasado', '{"desde": "2019-01-08", "hasta": "2019-01-08", "general": null}');
  -- 04b · 3 personas (miércoles): todavía NO salen posición ni promedios (ni en la API)
  s := pg_temp.como(c.yo, pg_temp.q_eq('prueba194', '2020-01-08', '2020-01-08'));
  perform pg_temp.chk('04b tres: personas (no sale con 3)', s->'personas', 'null');
  perform pg_temp.chk('04b tres: sin posición', s->'ranking', 'null');
  perform pg_temp.chk('04b tres: sin promedios ni mediana', s->'equipo', 'null');
  insert into _r194 (caso, ok, detalle)
  select '04b tres: ni la palabra en la respuesta', not (s::text ~ '(posicion|mediana|promedio|mi_posicion)'), s::text;
  perform pg_temp.chk('04b tres: proporciones del local', s->'general',
    '{"beb_pax": 0.00, "prom_pax": 3000, "comida_pax": 0.75, "prom_ticket": 4000}');

  -- 05 · sin ventas en el período → nada del equipo
  g := pg_temp.como(c.salonero_sin_ventas, pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-07'));
  perform pg_temp.chk('05 sin ventas: solo yo=false', to_jsonb(pg_temp.claves(g)), '"desde,hasta,k_min,motivo,personas,yo"');
  perform pg_temp.chk('05 sin ventas: motivo', g->'motivo', '"sin_ventas"');

  -- 06 · permisos
  perform pg_temp.chk('06 owner: agregados (sin yo)',  pg_temp.como(c.owner_id, pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-06'))->'personas', '4');
  perform pg_temp.chk('06 contador: agregados',        pg_temp.como(c.contador, pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-06'))->'personas', '4');
  perform pg_temp.chk('06 manager de su local',        pg_temp.como(c.manager_a, pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-06'))->'personas', '4');
  perform pg_temp.chk('06 manager de otro local: 42501', pg_temp.como(c.manager_b, pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-06')), '"ERR 42501"');
  perform pg_temp.chk('06 salonero de otro local: 42501', pg_temp.como(c.yo, pg_temp.q_eq('prueba194b', '2020-01-06', '2020-01-06')), '"ERR 42501"');
  perform pg_temp.chk('06 cajero: 42501',              pg_temp.como(c.cajero, pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-06')), '"ERR 42501"');
  perform pg_temp.chk('06 barman sin login: 42501',    pg_temp.como(c.barman_sin_login, pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-06')), '"ERR 42501"');
  perform pg_temp.chk('06 salonero inactivo: 42501',   pg_temp.como(c.salonero_inactivo, pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-06')), '"ERR 42501"');
  perform pg_temp.chk('06 anon: sin permiso',          pg_temp.como_anon(pg_temp.q_eq('prueba194', '2020-01-06', '2020-01-06')), '"ERR 42501"');
  perform pg_temp.chk('06 rango > 401 días: 22023',    pg_temp.como(c.yo, pg_temp.q_eq('prueba194', '2019-01-01', '2020-03-01')), '"ERR 22023"');
  perform pg_temp.chk('06 interna base: sin EXECUTE',  pg_temp.como(c.yo, $q$select count(*) from public.pos_rend_base('prueba194', '2020-01-06', '2020-01-06')$q$), '"ERR 42501"');
  perform pg_temp.chk('06 interna productos: sin EXECUTE', pg_temp.como(c.yo, $q$select count(*) from public.pos_rend_productos('prueba194', '2020-01-06', '2020-01-06')$q$), '"ERR 42501"');
  perform pg_temp.chk('06 interna clave: sin EXECUTE', pg_temp.como(c.yo, $q$select public.pos_persona_clave('1', null)$q$), '"ERR 42501"');
  perform pg_temp.chk('06 interna yo: sin EXECUTE',    pg_temp.como(c.yo, $q$select public.pos_rend_yo('prueba194')$q$), '"ERR 42501"');

  -- 07 · competencias
  perform pg_temp.chk('07 comp 4: yo 1.º de 4 (empate), líder con nombre (decisión A) y mediana', pg_temp.como(c.yo, pg_temp.q_comp('c194-4')),
    '{"de": 4, "motivo": null, "posicion": 1, "mis_puntos": 6, "lider_nombre": "Salonero 194 A", "lider_puntos": 6, "sin_resolver": 0, "mediana_puntos": 4, "participa": true}');
  perform pg_temp.chk('07 comp 3: grupo chico, líder sí, sin mediana', pg_temp.como(c.yo, pg_temp.q_comp('c194-3')),
    '{"de": 3, "motivo": "grupo_chico", "posicion": 1, "mis_puntos": 6, "lider_nombre": "Salonero 194 A", "lider_puntos": 6, "sin_resolver": 1, "mediana_puntos": null, "participa": true}');
  perform pg_temp.chk('07 comp: no participa', pg_temp.como(c.salonero_sin_ventas, pg_temp.q_comp('c194-4')),
    '{"motivo": "no_participa", "participa": false}');
  perform pg_temp.chk('07 comp: cajero 42501',  pg_temp.como(c.cajero, pg_temp.q_comp('c194-4')), '"ERR 42501"');
  perform pg_temp.chk('07 comp: anon sin permiso', pg_temp.como_anon(pg_temp.q_comp('c194-4')), '"ERR 42501"');

  -- 08 · search_path fijo y security definer en las seis
  insert into _r194 (caso, ok, detalle)
  select '08 search_path fijo en las 6', count(*) = 6, string_agg(p.proname, ',')
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('pos_persona_clave', 'pos_rend_base', 'pos_rend_productos', 'pos_rend_yo', 'pos_mi_rendimiento_equipo', 'pos_mi_competencia')
    and p.proconfig @> array['search_path=public, pg_temp'];
end $cas$;
select pg_temp.casos();

-- 10 · La guarda R13: con las funciones ya creadas, una segunda pasada aborta sin tocar nada.
create function pg_temp.guarda_aborta() returns text language plpgsql as $f$
begin
  -- @@194G@@
  return 'no abortó';
exception when others then
  return sqlstate || ' ' || left(sqlerrm, 30);
end $f$;
insert into _r194 (caso, ok, detalle)
select '10 guarda: segunda pasada aborta', g like 'P0001 194: public.pos_persona_clave%', g from pg_temp.guarda_aborta() g;
-- @@MUTACIONES@@

-- 09 · Vuelta atrás: borra las seis. (En staging el conector cancela los `drop`: se arma con --sin-drops y el caso
-- queda NO PROBADO ahí; corre con --local.)
select set_config('t194.tag', '', true);
-- @@194R@@

select json_object_agg(tag, r order by tag) from (
  select tag, json_build_object('total', count(*), 'ok', count(*) filter (where ok),
           'fallan', coalesce(json_agg(case when tag = 'sin mutar' then json_build_object('caso', caso, 'detalle', detalle) else to_json(caso) end order by n) filter (where not ok), '[]'::json),
           'paridad', (select detalle::json from _r194 x where x.tag = t.tag and x.caso = 'paridad: salida' limit 1)) as r
  from _r194 t group by tag) x;
rollback;
