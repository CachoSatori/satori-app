-- 193_pruebas · pos_mesas_internas, pos_ventas_internas y pos_ventas_tiempos. Transacción que termina en ROLLBACK: no
-- deja nada. Usa un LOCAL FICTICIO ('prueba-193') con facturas inventadas, así no depende de los datos de la base.
-- Corre en STAGING (antes de aplicar, R15) o en un Postgres vacío con scripts/sql/193_base_local.sql. Se arma y se
-- corre con scripts/sql/193_pruebas.py (--armar | --psql "<conexión>" [--mutar todas]). Nunca contra PROD.
-- MARCADOR: «-- @@193@@» → cuerpo de supabase/migrations/193_pos_ventas_tiempos.sql (con --mutar, roto a propósito).
begin;
-- @@193@@   (aquí va el cuerpo de la 193)
create temp table _r193 (n serial, caso text, ok boolean, detalle text) on commit drop;

create temp table _c193 on commit drop as
select '00000000-0000-4000-8193-0000000000b1'::uuid as owner_id,
       '00000000-0000-4000-8193-0000000000a1'::uuid as manager,     -- manager de prueba-193
       '00000000-0000-4000-8193-0000000000a2'::uuid as manager_otro, -- manager de otro local
       '00000000-0000-4000-8193-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8193-0000000000e1'::uuid as salonero,
       'prueba-193'::text as loc;
grant select on _c193 to anon, authenticated;

insert into public.locations (id, name, is_active) values ('prueba-193', 'Local de prueba 193', false)
on conflict (id) do nothing;
insert into auth.users (id, raw_user_meta_data)
select x, '{"full_name":"Ficticio 193"}'::jsonb
  from _c193 c, unnest(array[c.owner_id, c.manager, c.manager_otro, c.contador, c.salonero]) x;
update public.profiles p set role = r.rol::public.user_role, is_active = true
  from _c193 c, (values (1, 'owner'), (2, 'manager'), (3, 'manager'), (4, 'contador'), (5, 'salonero')) r(i, rol)
 where p.id = (array[c.owner_id, c.manager, c.manager_otro, c.contador, c.salonero])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, loc from _c193;
insert into public.profile_locations (profile_id, location_id) select manager_otro, 'santa-teresa' from _c193;
insert into public.pos_mesas_internas (local, mesa, creado_por) values ('prueba-193', '51', null), ('prueba-193', '52', null);

create function pg_temp.como(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  execute 'select to_jsonb((' || p_sql || '))' into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise;
end $f$;
-- Una escritura como el usuario: devuelve cuántas filas tocó, o el SQLSTATE si falló.
create function pg_temp.dml_como(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare k int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql;
  get diagnostics k = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return k::text;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return sqlstate;
end $f$;
create function pg_temp.err_como(p_uid uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform pg_temp.como(p_uid, p_sql);
  return null;
exception when others then
  return sqlstate;
end $f$;

-- Facturas FICTICIAS del lunes 5-oct-2026 (hora CR = -06:00).
create function pg_temp.tk(p_num text, p_reg text, p_canal text, p_mesa text, p_mesa_f text, p_ped text, p_abre text,
  p_pax int, p_valor numeric default null, p_estado text default 'C', p_local text default 'prueba-193')
returns uuid language sql as $f$
  insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, mesa, mesa_factura,
    numero_pedido, pedido_abierto_en, registrado_por, con_servicio, pax_articulo, pax, pax_alerta, valor_servido_crc,
    efectivo_crc)
  values (p_local, p_num, p_reg::timestamptz, p_estado, p_canal, p_mesa, p_mesa_f, p_ped, p_abre::timestamptz,
    'salonero', true, p_pax, p_pax, 'ok', p_valor, 999999)
  returning id $f$;
create function pg_temp.ln(p_t uuid, p_monto numeric, p_fam int default 2) returns void language sql as $f$
  insert into public.pos_ndf_ticket_lines (ticket_id, monto, familia) values (p_t, p_monto, p_fam) $f$;

create temp table _t193 on commit drop as select
  pg_temp.tk('T01', '2026-10-05 20:02-06', 'salon', '12', '12', 'P1', '2026-10-05 19:00-06', 2) as t01,
  pg_temp.tk('T02', '2026-10-05 13:30-06', 'salon', '7',  '7',  'P2', '2026-10-05 12:00-06', 3) as t02,
  pg_temp.tk('T03', '2026-10-05 13:45-06', 'salon', '7',  '7',  'P2', '2026-10-05 12:00-06', 2) as t03,
  pg_temp.tk('T04', '2026-10-05 20:00-06', 'salon', '051', null, 'P3', '2026-10-05 19:00-06', 2) as t04,
  pg_temp.tk('T05', '2026-10-05 20:30-06', 'salon', null, '52',  null, null, 0) as t05,
  pg_temp.tk('T06', '2026-10-05 21:10-06', 'delivery', null, null, null, null, 0, 7000.50) as t06,
  pg_temp.tk('T07', '2026-10-05 14:05-06', 'salon', '3',  '3',  null, null, 2) as t07,
  pg_temp.tk('T08', '2026-10-05 18:02-06', 'salon', '4',  '4',  'P4', '2026-10-05 18:00-06', 2) as t08,
  pg_temp.tk('T09', '2026-10-05 15:30-06', 'salon', '5',  '5',  'P5', '2026-10-05 10:00-06', 4) as t09,
  pg_temp.tk('T10', '2026-10-06 00:40-06', 'salon', '9',  '9',  'P6', '2026-10-05 23:30-06', 8) as t10,
  pg_temp.tk('T11', '2026-10-05 20:00-06', 'salon', '10', '10', 'P7', '2026-10-05 19:00-06', 0) as t11,
  pg_temp.tk('T12', '2026-10-05 20:00-06', 'salon', '11', '11', 'P9', '2026-10-05 19:00-06', 2, null, 'X') as t12,
  pg_temp.tk('T13', '2026-10-05 20:00-06', 'salon', '11', '11', 'P9', '2026-10-05 19:00-06', 2, null, 'C', 'santa-teresa') as t13,
  pg_temp.tk('T14', '2026-10-05 21:00-06', 'salon', '14', '14', 'P8', '2026-10-05 20:00-06', 1) as t14;
select pg_temp.ln(t01, 10000), pg_temp.ln(t01, 500, 20), pg_temp.ln(t02, 15000.25), pg_temp.ln(t03, 9000.10),
       pg_temp.ln(t04, 30000), pg_temp.ln(t05, 5000), pg_temp.ln(t07, 4000), pg_temp.ln(t08, 3000), pg_temp.ln(t09, 8000),
       pg_temp.ln(t10, 40000), pg_temp.ln(t11, 2000), pg_temp.ln(t12, 99999), pg_temp.ln(t13, 99999), pg_temp.ln(t14, 6000)
  from _t193;

create temp table _o193 on commit drop as
select pg_temp.como(c.owner_id, format('public.pos_ventas_tiempos(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-05')) as d5,
       pg_temp.como(c.owner_id, format('public.pos_ventas_tiempos(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-06')) as d56,
       pg_temp.como(c.owner_id, format('public.pos_ventas_internas(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-05')) as i5
  from _c193 c;
grant select on _o193 to anon, authenticated;

-- 01. horas: todos los canales, sin internas, sin la X ni el otro local; neta en céntimos con la regla de la 190.
insert into _r193 (caso, ok, detalle)
select '01 horas del 5-oct: Σ céntimos = todas las facturas C del local y del día, internas incluidas (familia 20 fuera, delivery sin líneas por valor servido)',
       (select sum((x->>2)::numeric) from jsonb_array_elements(d5->'horas') x)
         = (1000000 + 1500025 + 900010 + 3000000 + 500000 + 700050 + 400000 + 300000 + 800000 + 200000 + 600000),
       (d5->'horas')::text from _o193;
insert into _r193 (caso, ok, detalle)
select '02 horas por hora CR: a las 13 hay 2 facturas (T02, T03) y 2.400.035 céntimos; a las 21 delivery + T14',
       exists (select 1 from jsonb_array_elements(d5->'horas') x where x->>1 = '13' and (x->>3)::int = 2 and (x->>2)::numeric = 2400035)
       and exists (select 1 from jsonb_array_elements(d5->'horas') x where x->>1 = '21' and (x->>3)::int = 2 and (x->>2)::numeric = 1300050)
       and not exists (select 1 from jsonb_array_elements(d5->'horas') x where x->>0 <> '2026-10-05'),
       (d5->'horas')::text from _o193;
-- 03. internas: por mesa del pedido con ceros (051) y por mesa de la factura (52); céntimos.
insert into _r193 (caso, ok, detalle)
select '03 internas: T04 (mesa 051) y T05 (mesa de factura 52), con su neta en céntimos',
       jsonb_array_length(i5) = 2
       and (select array_agg(x->>0 order by x->>0) from jsonb_array_elements(i5) x) = (select array_agg(v::text order by v::text) from _t193, unnest(array[t04, t05]) v)
       and (select sum((x->>4)::numeric) from jsonb_array_elements(i5) x) = 3500000,
       i5::text from _o193, _t193;
-- 04. sentados del 5-oct: '2' = T01 (62 min) y T14 (60) · '6' = T02+T03 juntas (pax 5, 105 min).
insert into _r193 (caso, ok, detalle)
select '04 sentados: «2» n=2 mediana 61 promedio 61; «6» n=1 de 105 min (la mesa partida en dos facturas es UN pedido)',
       (d5->'sentados') = '[["2", 2, 61.0, 61.0], ["6", 1, 105.0, 105.0]]'::jsonb,
       (d5->'sentados')::text from _o193;
insert into _r193 (caso, ok, detalle)
select '05 descartes del 5-oct: 1 sin pedido (T07; el delivery no cuenta), 1 interna, 1 sin pax, 1 de 2 min, 1 de 330 min',
       (d5->'descartes') = '{"sin_pedido": 1, "internas": 1, "sin_pax": 1, "menos_de_5": 1, "mas_de_240": 1}'::jsonb,
       (d5->'descartes')::text from _o193;
insert into _r193 (caso, ok, detalle)
select '06 el pedido que cruza la medianoche cuenta el día de su cobro: «7+» aparece con el 6-oct (70 min)',
       not exists (select 1 from jsonb_array_elements(d5->'sentados') x where x->>0 = '7+')
       and exists (select 1 from jsonb_array_elements(d56->'sentados') x where x->>0 = '7+' and (x->>1)::int = 1 and (x->>2)::numeric = 70.0),
       (d56->'sentados')::text from _o193;
-- 07. permisos de las funciones.
insert into _r193 (caso, ok, detalle)
select '07 permisos: salonero 42501 · anon sin permiso · manager de otro local 42501 · manager del local y contador leen',
       pg_temp.err_como(c.salonero, format('public.pos_ventas_tiempos(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-05')) = '42501'
       and pg_temp.err_como(null, format('public.pos_ventas_tiempos(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-05')) = '42501'
       and pg_temp.err_como(c.manager_otro, format('public.pos_ventas_tiempos(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-05')) = '42501'
       and pg_temp.err_como(c.manager_otro, format('public.pos_ventas_internas(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-05')) = '42501'
       and pg_temp.err_como(c.manager, format('public.pos_ventas_tiempos(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-05')) is null
       and pg_temp.err_como(c.contador, format('public.pos_ventas_internas(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-05')) is null
       and pg_temp.err_como(c.owner_id, format('public.pos_ventas_tiempos(%L, date %L, date %L)', c.loc, '2024-01-01', '2026-10-05')) = '22023',
       null from _c193 c;
insert into _r193 (caso, ok, detalle)
select '08 el helper no se llama desde la API (y el de la mesa ya no existe: va en línea)',
       to_regprocedure('public.pos_es_mesa_interna(text, text, text)') is null
       and pg_temp.err_como(c.owner_id, format('public.pos_ventas_tiempos_porton(%L, date %L, date %L)', c.loc, '2026-10-05', '2026-10-05')) = '42501',
       null from _c193 c;
-- 09. la tabla: leer gerencia; agregar y quitar solo el owner; formato de mesa.
insert into _r193 (caso, ok, detalle)
select '09 pos_mesas_internas: manager y contador leen; manager no agrega ni quita; owner sí; «051» no entra; anon no lee',
       (pg_temp.como(c.manager, format('(select count(*) from public.pos_mesas_internas where local = %L)', c.loc)))::int = 2
       and (pg_temp.como(c.contador, format('(select count(*) from public.pos_mesas_internas where local = %L)', c.loc)))::int = 2
       and pg_temp.dml_como(c.manager, format('insert into public.pos_mesas_internas (local, mesa) values (%L, %L)', c.loc, '60')) = '42501'
       and pg_temp.dml_como(c.manager, format('delete from public.pos_mesas_internas where local = %L', c.loc)) = '0'
       and pg_temp.dml_como(c.contador, format('delete from public.pos_mesas_internas where local = %L', c.loc)) = '0'
       and pg_temp.dml_como(c.owner_id, format('insert into public.pos_mesas_internas (local, mesa) values (%L, %L)', c.loc, '60')) = '1'
       and pg_temp.dml_como(c.owner_id, format('insert into public.pos_mesas_internas (local, mesa) values (%L, %L)', c.loc, '051')) = '23514'
       and pg_temp.err_como(null, '(select count(*) from public.pos_mesas_internas)') = '42501'
       and pg_temp.dml_como(c.owner_id, format('delete from public.pos_mesas_internas where local = %L and mesa = %L', c.loc, '60')) = '1'
       and (select count(*) from public.pos_mesas_internas where local = c.loc) = 2,
       null from _c193 c;
insert into _r193 (caso, ok, detalle)
select '10 valor inicial: 51, 52 y 53 en santa-teresa',
       (select array_agg(mesa order by mesa) from public.pos_mesas_internas where local = 'santa-teresa') = array['51', '52', '53'],
       null;

select n, caso, case when ok then 'OK' else 'FALLA' end as resultado, left(coalesce(detalle, ''), 300) as detalle from _r193 order by n;
select count(*) filter (where ok) as ok, count(*) filter (where not ok or ok is null) as fallas from _r193;
rollback;
