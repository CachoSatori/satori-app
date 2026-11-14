-- 160_pruebas (origen 106) · Club → Tablero. Aplica la 160 dentro de una transacción, arma datos ficticios, prueba y
-- termina en ROLLBACK: no deja nada. Al final un ASSERT: si algún caso falla, aborta con «160-FALLAN: <casos>».
-- Se corre con scripts/sql/160_pruebas.py (--local: Postgres 16 local; --armar: imprime el SQL para staging).
--
-- MARCADOR que llena el runner: la línea «-- @@160@@ …» → el cuerpo de supabase/migrations/160_club_tablero_plata.sql
-- sin begin; / commit; (re-ejecutable). Con --mutar, ese cuerpo va con el arreglo deshecho a propósito y sus casos caen.
--
-- Todo es ficticio y propio de la prueba: dos locales nuevos (p160-a con datos, p160-b sin facturas del PoS), usuarios
-- de prueba (uno por rol, más un owner inactivo) y marzo de 2001 (no hay datos reales). JWT simulado con
-- set_config('request.jwt.claims', …, true), como las baterías 155 y 158.
--
-- Datos de marzo 2001 en p160-a (referencia de precios en febrero, en facturas sin marcador y fuera del Club):
--   T1 socio      · P1 ×2 a ₡8.500 (ref ₡10.000 → desc ₡3.000) · 856 · C1 cortesía ₡0 (lista ₡4.000) · P3 ₡2.000 sin ref · pax 2
--   T2 cupón      · P2 ×1 a ₡4.500 (ref ₡5.000 → desc ₡500) · pax 3
--   T3 socio+canje· P1 ×1 a ₡10.000 · línea familia 17 ₡500 (fuera de la neta) · regalía ₡10.000 · pax 1  (cuenta UNA vez)
--   T4 sin Club   · P1 ×1 ₡10.000 · pax 2 · 31-mar 23:00 hora CR (= 1-abr 05:00 UTC): es de MARZO
--   T5 socio, ANULADA (X): no cuenta · T6 socio del 1-abr 00:30 CR: es de abril
-- Libro (personas; ppc 6, crédito ₡18.000): R1 feb +12 · mar +6 (cupón) −9 (canje 1,5 cr.) +3 (ajuste) · R2 mar +6
-- (papel) −3 (vencimiento) · E1 (equipo) feb +6 · X1 (salió del equipo, corte 10-mar) feb +6 antes del corte, mar +3 después.
begin;
-- @@160@@   (aquí va el cuerpo de la 160 sin begin/commit)
create temp table _r160 (n serial, caso text, ok boolean, detalle text) on commit drop;

-- ── Usuarios de prueba ─────────────────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000160a01', 'p160-owner@ejemplo.test'),
  ('00000000-0000-4000-8000-000000160a02', 'p160-manager@ejemplo.test'),
  ('00000000-0000-4000-8000-000000160a03', 'p160-contador@ejemplo.test'),
  ('00000000-0000-4000-8000-000000160a04', 'p160-cajero@ejemplo.test'),
  ('00000000-0000-4000-8000-000000160a05', 'p160-salonero@ejemplo.test'),
  ('00000000-0000-4000-8000-000000160a06', 'p160-owner-inactivo@ejemplo.test'),
  ('00000000-0000-4000-8000-000000160a07', 'p160-manager-otro@ejemplo.test');
insert into public.profiles (id, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000160a01', 'Prueba Owner', 'owner', true),
  ('00000000-0000-4000-8000-000000160a02', 'Prueba Manager', 'manager', true),
  ('00000000-0000-4000-8000-000000160a03', 'Prueba Contador', 'contador', true),
  ('00000000-0000-4000-8000-000000160a04', 'Prueba Cajero', 'cajero', true),
  ('00000000-0000-4000-8000-000000160a05', 'Prueba Salonero', 'salonero', true),
  ('00000000-0000-4000-8000-000000160a06', 'Prueba Owner Inactivo', 'owner', false),
  ('00000000-0000-4000-8000-000000160a07', 'Prueba Manager Otro', 'manager', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

-- ── Locales ────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.locations (id, name) values ('p160-a', 'Local P160 A'), ('p160-b', 'Local P160 B') on conflict (id) do nothing;
insert into public.club_config (location_id, nombre) values ('p160-a', 'Local P160 A'), ('p160-b', 'Local P160 B');
-- el manager de prueba trabaja en p160-a; el otro manager, solo en p160-b
-- cajero y salonero también trabajan en p160-a: así solo el ROL los deja afuera
insert into public.profile_locations (profile_id, location_id, principal) values
  ('00000000-0000-4000-8000-000000160a02', 'p160-a', true),
  ('00000000-0000-4000-8000-000000160a04', 'p160-a', true),
  ('00000000-0000-4000-8000-000000160a05', 'p160-a', true),
  ('00000000-0000-4000-8000-000000160a07', 'p160-b', true);
insert into public.club_cortesias (location_id, codigo_producto, nombre) values ('p160-a', 'C1', 'Cortesia de prueba');

-- ── Miembros ───────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.club_miembros (id, location_id, tipo, nombre) values
  ('00000000-0000-4000-8000-000000160b01', 'p160-a', 'referente', 'Prueba Referente Uno'),
  ('00000000-0000-4000-8000-000000160b02', 'p160-a', 'referente', 'Prueba Referente Dos'),
  ('00000000-0000-4000-8000-000000160b03', 'p160-a', 'equipo',    'Prueba Equipo'),
  ('00000000-0000-4000-8000-000000160b04', 'p160-a', 'referente', 'Prueba Ex Equipo'),
  ('00000000-0000-4000-8000-000000160b05', 'p160-a', 'socio',     'Prueba Socio');
insert into public.club_auditoria (en, accion, tabla, objeto_id, despues)
values (timestamptz '2001-03-10 12:00-06', 'equipo_corte', 'club_miembros', '00000000-0000-4000-8000-000000160b04',
        '{"motivo":"sale_del_equipo"}');
insert into public.club_cupones (id, location_id, referente_id, estado, vence_en, usado_en, factura_pos, personas)
values ('00000000-0000-4000-8000-000000160c01', 'p160-a', '00000000-0000-4000-8000-000000160b01', 'usado',
        timestamptz '2001-03-20 12:00-06', timestamptz '2001-03-12 20:00-06', '00160002', 6);

insert into public.club_movimientos (location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc,
                                     factura_pos, cupon_id, fecha_visita, registrado_en, origen, nota) values
  ('p160-a', '00000000-0000-4000-8000-000000160b01', 'tarjeta',      12, null, 6, 18000, null, null,
   '2001-02-10 20:00-06', '2001-02-10 20:00-06', 'app', 'prueba 160'),
  ('p160-a', '00000000-0000-4000-8000-000000160b01', 'tarjeta',       6, null, 6, 18000, '00160002', '00000000-0000-4000-8000-000000160c01',
   '2001-03-12 20:00-06', '2001-03-12 20:00-06', 'app', 'prueba 160'),
  ('p160-a', '00000000-0000-4000-8000-000000160b01', 'canje',        -9, 1.5, 6, 18000, '00160003', null,
   '2001-03-14 20:00-06', '2001-03-14 20:00-06', 'app', 'prueba 160'),
  ('p160-a', '00000000-0000-4000-8000-000000160b01', 'ajuste',        3, null, 6, 18000, null, null,
   '2001-03-15 10:00-06', '2001-03-15 10:00-06', 'app', 'prueba 160'),
  ('p160-a', '00000000-0000-4000-8000-000000160b02', 'tarjeta',       6, null, 6, 18000, null, null,
   '2001-03-02 10:00-06', '2001-03-02 10:00-06', 'papel', 'prueba 160'),
  ('p160-a', '00000000-0000-4000-8000-000000160b02', 'vencimiento',  -3, null, 6, 18000, null, null,
   '2001-03-28 10:00-06', '2001-03-28 10:00-06', 'app', 'prueba 160'),
  ('p160-a', '00000000-0000-4000-8000-000000160b03', 'tarjeta',       6, null, 6, 18000, null, null,
   '2001-02-11 20:00-06', '2001-02-11 20:00-06', 'app', 'prueba 160'),
  ('p160-a', '00000000-0000-4000-8000-000000160b04', 'tarjeta',       6, null, 6, 18000, null, null,
   '2001-02-12 20:00-06', '2001-02-12 20:00-06', 'app', 'prueba 160'),
  ('p160-a', '00000000-0000-4000-8000-000000160b04', 'tarjeta',       3, null, 6, 18000, null, null,
   '2001-03-20 20:00-06', '2001-03-20 20:00-06', 'app', 'prueba 160');

insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, client_op_id, pos_ref, estado_beneficio, aplicar)
select 'p160-a', '00000000-0000-4000-8000-000000160b05', (x.en at time zone 'America/Costa_Rica')::date, x.en, gen_random_uuid(),
       jsonb_build_object('modo', 'factura', 'numero_factura', x.f), 'aplica', '{}'::jsonb
  from (values (timestamptz '2001-03-05 20:00-06', '00160001'), (timestamptz '2001-03-14 20:00-06', '00160003'),
               (timestamptz '2001-03-20 20:00-06', '00160005'), (timestamptz '2001-03-31 23:50-06', '00160006')) x(en, f);

-- ── Facturas del PoS ───────────────────────────────────────────────────────────────────────────────────────────────
create temp table _t160 (id uuid, nf text, f timestamptz, estado text, pax int, regalia numeric) on commit drop;
insert into _t160 values
  ('00000000-0000-4000-8000-000000160d01', '00160001', '2001-03-05 20:30-06', 'C', 2, 0),
  ('00000000-0000-4000-8000-000000160d02', '00160002', '2001-03-12 20:30-06', 'C', 3, 0),
  ('00000000-0000-4000-8000-000000160d03', '00160003', '2001-03-14 20:30-06', 'C', 1, 10000),
  ('00000000-0000-4000-8000-000000160d04', '00160004', '2001-04-01 05:00+00', 'C', 2, 0),
  ('00000000-0000-4000-8000-000000160d05', '00160005', '2001-03-20 20:30-06', 'X', 2, 0),
  ('00000000-0000-4000-8000-000000160d06', '00160006', '2001-04-01 00:30-06', 'C', 2, 0),
  -- febrero: referencia (sin marcador, sin Club). P1 ×3 a 10.000 y ×1 a 9.000 (moda 10.000) · P2 5.000 · C1 4.000
  ('00000000-0000-4000-8000-000000160e01', '00160101', '2001-02-20 20:00-06', 'C', 2, 0),
  ('00000000-0000-4000-8000-000000160e02', '00160102', '2001-02-21 20:00-06', 'C', 2, 0),
  ('00000000-0000-4000-8000-000000160e03', '00160103', '2001-02-22 20:00-06', 'C', 2, 0),
  ('00000000-0000-4000-8000-000000160e04', '00160104', '2001-02-23 20:00-06', 'C', 2, 0),
  -- febrero con marcador 856 a precio rebajado (×4: sería la moda): NO es referencia
  ('00000000-0000-4000-8000-000000160e05', '00160105', '2001-02-24 20:00-06', 'C', 2, 0),
  ('00000000-0000-4000-8000-000000160e06', '00160106', '2001-02-25 20:00-06', 'C', 2, 0),
  ('00000000-0000-4000-8000-000000160e07', '00160107', '2001-02-26 20:00-06', 'C', 2, 0),
  ('00000000-0000-4000-8000-000000160e08', '00160108', '2001-02-27 20:00-06', 'C', 2, 0);
insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, fecha_cierra, estado, canal, registrado_por,
                                    con_servicio, pax, pax_alerta, regalia_crc, total_crc)
select id, 'p160-a', nf, f, f, estado, 'salon', 'salonero', true, pax, 'ok', regalia, 0 from _t160;

insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto, familia, es_cortesia) values
  ('00000000-0000-4000-8000-000000160d01', 'P1',  'Plato uno',     2, 10000, 17000, 2, false),
  ('00000000-0000-4000-8000-000000160d01', '856', 'Local Club',    1,     0,     0, 2, false),
  ('00000000-0000-4000-8000-000000160d01', 'C1',  'Cortesia',      1,     0,     0, 2, false),
  ('00000000-0000-4000-8000-000000160d01', 'P3',  'Plato nuevo',   1,  2000,  2000, 2, false),
  ('00000000-0000-4000-8000-000000160d02', 'P2',  'Plato dos',     1,  5000,  4500, 2, false),
  ('00000000-0000-4000-8000-000000160d03', 'P1',  'Plato uno',     1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000160d03', 'K1',  'Cortesia gerencia', 1, 500, 500, 17, true),
  ('00000000-0000-4000-8000-000000160d04', 'P1',  'Plato uno',     1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000160d05', 'P1',  'Plato uno',     1, 10000,  5000, 2, false),
  ('00000000-0000-4000-8000-000000160d06', 'P1',  'Plato uno',     1, 10000,  5000, 2, false),
  ('00000000-0000-4000-8000-000000160e01', 'P1',  'Plato uno',     1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000160e01', 'P2',  'Plato dos',     1,  5000,  5000, 2, false),
  ('00000000-0000-4000-8000-000000160e02', 'P1',  'Plato uno',     1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000160e02', 'C1',  'Cortesia',      1,  4000,  4000, 2, false),
  ('00000000-0000-4000-8000-000000160e03', 'P1',  'Plato uno',     1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000160e04', 'P1',  'Plato uno',     1,  9000,  9000, 2, false),
  ('00000000-0000-4000-8000-000000160e05', 'P1',  'Plato uno',     1, 10000,  7000, 2, false),
  ('00000000-0000-4000-8000-000000160e05', '856', 'Local Club',    1,     0,     0, 2, false),
  ('00000000-0000-4000-8000-000000160e06', 'P1',  'Plato uno',     1, 10000,  7000, 2, false),
  ('00000000-0000-4000-8000-000000160e06', '856', 'Local Club',    1,     0,     0, 2, false),
  ('00000000-0000-4000-8000-000000160e07', 'P1',  'Plato uno',     1, 10000,  7000, 2, false),
  ('00000000-0000-4000-8000-000000160e07', '856', 'Local Club',    1,     0,     0, 2, false),
  ('00000000-0000-4000-8000-000000160e08', 'P1',  'Plato uno',     1, 10000,  7000, 2, false),
  ('00000000-0000-4000-8000-000000160e08', '856', 'Local Club',    1,     0,     0, 2, false);

-- ── Llamar como un usuario (JWT simulado). Devuelve el JSON o «ERR:<sqlstate>» ───────────────────────────────────────
create or replace function pg_temp.t160(p_uid uuid, p_mes date, p_loc text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin
    r := public.club_tablero_mes(p_mes, p_loc);
  exception when others then
    r := to_jsonb('ERR:' || sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

create temp table _o160 on commit drop as
select pg_temp.t160('00000000-0000-4000-8000-000000160a01', date '2001-03-17', 'p160-a') as owner_a,
       pg_temp.t160('00000000-0000-4000-8000-000000160a02', date '2001-03-01', 'p160-a') as manager_a,
       pg_temp.t160('00000000-0000-4000-8000-000000160a03', date '2001-03-01', 'p160-a') as contador_a,
       pg_temp.t160('00000000-0000-4000-8000-000000160a04', date '2001-03-01', 'p160-a') as cajero_a,
       pg_temp.t160('00000000-0000-4000-8000-000000160a05', date '2001-03-01', 'p160-a') as salonero_a,
       pg_temp.t160('00000000-0000-4000-8000-000000160a06', date '2001-03-01', 'p160-a') as inactivo_a,
       pg_temp.t160('00000000-0000-4000-8000-000000160a07', date '2001-03-01', 'p160-a') as manager_otro_a,
       pg_temp.t160(null,                                   date '2001-03-01', 'p160-a') as sin_sesion_a,
       pg_temp.t160('00000000-0000-4000-8000-000000160a03', date '2001-03-01', 'p160-b') as contador_b,
       pg_temp.t160('00000000-0000-4000-8000-000000160a01', date '2001-04-01', 'p160-a') as owner_abril;

-- 0. catálogo
insert into _r160 (caso, ok, detalle)
select '0 catálogo: definer · search_path fijo · anon sin EXECUTE · authenticated con EXECUTE',
       p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
       and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       coalesce(p.proacl::text, 'sin acl')
  from pg_proc p where p.oid = 'public.club_tablero_mes(date, text)'::regprocedure;

-- 1. permisos
insert into _r160 (caso, ok, detalle) select '1a owner entra', jsonb_typeof(owner_a) = 'object', left(owner_a::text, 80) from _o160;
insert into _r160 (caso, ok, detalle) select '1b manager de su local entra', jsonb_typeof(manager_a) = 'object', left(manager_a::text, 80) from _o160;
insert into _r160 (caso, ok, detalle) select '1c contador entra', jsonb_typeof(contador_a) = 'object', left(contador_a::text, 80) from _o160;
insert into _r160 (caso, ok, detalle) select '1d cajero → 42501', cajero_a = to_jsonb('ERR:42501'::text), cajero_a::text from _o160;
insert into _r160 (caso, ok, detalle) select '1e salonero → 42501', salonero_a = to_jsonb('ERR:42501'::text), salonero_a::text from _o160;
insert into _r160 (caso, ok, detalle) select '1f owner inactivo → 42501', inactivo_a = to_jsonb('ERR:42501'::text), inactivo_a::text from _o160;
insert into _r160 (caso, ok, detalle) select '1g sin sesión → 42501', sin_sesion_a = to_jsonb('ERR:42501'::text), sin_sesion_a::text from _o160;
insert into _r160 (caso, ok, detalle) select '1h manager de OTRO local → 42501', manager_otro_a = to_jsonb('ERR:42501'::text), manager_otro_a::text from _o160;
-- 1i. anon: sin EXECUTE de verdad (con el rol anon)
do $$
begin
  set local role anon;
  begin
    perform public.club_tablero_mes(date '2001-03-01', 'p160-a');
    reset role;
    insert into _r160 (caso, ok, detalle) values ('1i anon → permission denied', false, 'anon ejecutó la función');
  exception when insufficient_privilege then
    reset role;
    -- «Sin permiso» (también 42501) sería la función corriendo: tiene que ser el EXECUTE el que frena
    insert into _r160 (caso, ok, detalle) values ('1i anon → permission denied', sqlerrm like 'permission denied for function%', sqlerrm);
  end;
end $$;
reset role;

-- 2. privacidad: el contador no recibe nombres, facturas ni contactos
insert into _r160 (caso, ok, detalle)
select '2 sin datos personales (nombres, números de factura, correos)',
       contador_a::text !~ '(Prueba|Referente|Socio|0016010|0016000|@)', null from _o160;

-- 3. plata (marzo, p160-a)
insert into _r160 (caso, ok, detalle)
select '3a facturas del Club = 3 (T3 con socio y canje cuenta una vez; la anulada no cuenta)',
       (owner_a->'plata'->>'facturas_club')::int = 3, owner_a->'plata'->>'facturas_club' from _o160;
insert into _r160 (caso, ok, detalle)
select '3b venta respaldada = ₡33.500 (neta: sin familia 17)', (owner_a->'plata'->>'venta_respaldada_crc')::numeric = 33500,
       owner_a->'plata'->>'venta_respaldada_crc' from _o160;
insert into _r160 (caso, ok, detalle)
select '3c hora CR: facturas del mes = 4 (T4 31-mar 23:00 CR adentro; T6 1-abr 00:30 CR afuera); venta ₡43.500',
       (owner_a->'plata'->>'facturas_mes')::int = 4 and (owner_a->'plata'->>'venta_mes_crc')::numeric = 43500,
       (owner_a->'plata'->>'facturas_mes') || ' · ' || (owner_a->'plata'->>'venta_mes_crc') from _o160;
insert into _r160 (caso, ok, detalle)
select '3d descuento estimado = ₡3.500 en 2 líneas y 2 facturas; 1 línea sin referencia',
       (owner_a->'plata'->>'descuento_estimado_crc')::numeric = 3500 and (owner_a->'plata'->>'descuento_lineas')::int = 2
       and (owner_a->'plata'->>'descuento_facturas')::int = 2 and (owner_a->'plata'->>'lineas_sin_referencia')::int = 1,
       (owner_a->'plata')::text from _o160;
insert into _r160 (caso, ok, detalle)
select '3e cortesías: lista ₡4.000, a costo 35 % = ₡1.400',
       (owner_a->'plata'->>'cortesias_lista_crc')::numeric = 4000 and (owner_a->'plata'->>'cortesias_costo_crc')::numeric = 1400,
       (owner_a->'plata'->>'cortesias_lista_crc') || ' · ' || (owner_a->'plata'->>'cortesias_costo_crc') from _o160;
insert into _r160 (caso, ok, detalle)
select '3f canjes: 1, 1,5 créditos, ₡27.000 (valor del movimiento)',
       (owner_a->'plata'->>'canjes')::int = 1 and (owner_a->'plata'->>'creditos_canjeados')::numeric = 1.5
       and (owner_a->'plata'->>'canjes_crc')::numeric = 27000, (owner_a->'plata'->>'canjes_crc') from _o160;
insert into _r160 (caso, ok, detalle)
select '3g costo total ₡31.900 y tasa efectiva 95,2 %',
       (owner_a->'plata'->>'costo_total_crc')::numeric = 31900 and (owner_a->'plata'->>'tasa_efectiva_pct')::numeric = 95.2,
       (owner_a->'plata'->>'costo_total_crc') || ' · ' || (owner_a->'plata'->>'tasa_efectiva_pct') from _o160;
insert into _r160 (caso, ok, detalle)
select '3h regalía del PoS en facturas del Club: 1 factura, ₡10.000, toda en canjes (aparte, no suma al costo)',
       (owner_a->'regalia'->>'facturas')::int = 1 and (owner_a->'regalia'->>'crc')::numeric = 10000
       and (owner_a->'regalia'->>'en_canjes_crc')::numeric = 10000, (owner_a->'regalia')::text from _o160;
insert into _r160 (caso, ok, detalle)
select '3i con socio: 2 facturas, ₡29.000, 3 personas, tiquete ₡14.500 · sin socio: 2, ₡14.500, 5 personas, ₡7.250',
       (owner_a->'comparacion'->'con_socio'->>'facturas')::int = 2 and (owner_a->'comparacion'->'con_socio'->>'venta_crc')::numeric = 29000
       and (owner_a->'comparacion'->'con_socio'->>'personas')::int = 3 and (owner_a->'comparacion'->'con_socio'->>'tiquete_crc')::numeric = 14500
       and (owner_a->'comparacion'->'sin_socio'->>'facturas')::int = 2 and (owner_a->'comparacion'->'sin_socio'->>'venta_crc')::numeric = 14500
       and (owner_a->'comparacion'->'sin_socio'->>'personas')::int = 5 and (owner_a->'comparacion'->'sin_socio'->>'tiquete_crc')::numeric = 7250,
       (owner_a->'comparacion')::text from _o160;
insert into _r160 (caso, ok, detalle)
select '3j el contador ve los mismos totales que el owner',
       case when jsonb_typeof(contador_a) = 'object' and jsonb_typeof(owner_a) = 'object'
            then (contador_a - 'generado_en') = (owner_a - 'generado_en') else false end, null from _o160;

-- 4. pasivo
insert into _r160 (caso, ok, detalle)
select '4a pasivo en personas: 12 → +9 emitidos +6 carga −9 canje −3 vencidos +3 ajustes → 18',
       (owner_a->'pasivo'->'saldo_inicial'->>'personas')::int = 12 and (owner_a->'pasivo'->'emitidos'->>'personas')::int = 9
       and (owner_a->'pasivo'->'carga_inicial'->>'personas')::int = 6 and (owner_a->'pasivo'->'canjeados'->>'personas')::int = -9
       and (owner_a->'pasivo'->'vencidos'->>'personas')::int = -3 and (owner_a->'pasivo'->'ajustes'->>'personas')::int = 3
       and (owner_a->'pasivo'->'saldo_final'->>'personas')::int = 18, (owner_a->'pasivo')::text from _o160;
insert into _r160 (caso, ok, detalle)
select '4b el pasivo cuadra: inicial + movimientos = final (personas y colones)',
       (p->'saldo_inicial'->>'personas')::int + (p->'emitidos'->>'personas')::int + (p->'carga_inicial'->>'personas')::int
       + (p->'canjeados'->>'personas')::int + (p->'vencidos'->>'personas')::int + (p->'ajustes'->>'personas')::int
       = (p->'saldo_final'->>'personas')::int
       and (p->'saldo_inicial'->>'crc')::numeric + (p->'emitidos'->>'crc')::numeric + (p->'carga_inicial'->>'crc')::numeric
       + (p->'canjeados'->>'crc')::numeric + (p->'vencidos'->>'crc')::numeric + (p->'ajustes'->>'crc')::numeric
       = (p->'saldo_final'->>'crc')::numeric,
       p::text
  from (select owner_a->'pasivo' as p from _o160) x;
insert into _r160 (caso, ok, detalle)
select '4c saldo final 3 créditos = ₡54.000; canjeable 3 (por cuenta); canjeados −1,5 cr. = −₡27.000',
       (owner_a->'pasivo'->'saldo_final'->>'creditos')::numeric = 3 and (owner_a->'pasivo'->'saldo_final'->>'crc')::numeric = 54000
       and (owner_a->'pasivo'->>'canjeable_creditos')::numeric = 3
       and (owner_a->'pasivo'->'canjeados'->>'creditos')::numeric = -1.5 and (owner_a->'pasivo'->'canjeados'->>'crc')::numeric = -27000,
       (owner_a->'pasivo')::text from _o160;
insert into _r160 (caso, ok, detalle)
select '4d congelado fuera del pasivo: equipo 6 + lo de antes del corte 6 = 12 personas, 2 cuentas',
       (owner_a->'pasivo'->'congelado'->>'personas')::int = 12 and (owner_a->'pasivo'->'congelado'->>'cuentas')::int = 2,
       (owner_a->'pasivo'->'congelado')::text from _o160;

-- 5. local sin facturas del PoS (como Nosara) y meses sin datos: aviso, no error
insert into _r160 (caso, ok, detalle)
select '5a local sin PoS: objeto con pos_sin_datos, ceros y tasa null',
       jsonb_typeof(contador_b) = 'object' and (contador_b->>'pos_sin_datos')::boolean
       and (contador_b->'plata'->>'venta_respaldada_crc')::numeric = 0 and contador_b->'plata'->'tasa_efectiva_pct' = 'null'::jsonb
       and (contador_b->'pasivo'->'saldo_final'->>'personas')::int = 0, left(contador_b::text, 120) from _o160;
insert into _r160 (caso, ok, detalle)
select '5b abril: T6 (1-abr 00:30 CR, socio) es de abril; saldo inicial de abril = final de marzo',
       (owner_abril->'plata'->>'facturas_club')::int = 1 and not (owner_abril->>'pos_sin_datos')::boolean
       and (owner_abril->'pasivo'->'saldo_inicial'->>'personas')::int = (owner_a->'pasivo'->'saldo_final'->>'personas')::int,
       (owner_abril->'plata')::text from _o160;

-- 6. % de cortesías: lo edita el owner (con historial); el manager no
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000160a02', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.club_config set cortesia_costo_pct = 90 where location_id = 'p160-a';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000160a01', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.club_config set cortesia_costo_pct = 50 where location_id = 'p160-a';
reset role;
select set_config('request.jwt.claims', '', true);
insert into _r160 (caso, ok, detalle)
select '6a el owner cambia el % (50) y queda en el historial; el del manager no entra',
       (select cortesia_costo_pct from public.club_config where location_id = 'p160-a') = 50
       and exists (select 1 from public.club_config_historial h where h.location_id = 'p160-a' and h.campo = 'cortesia_costo_pct'
                    and h.valor_anterior = '35.00' and h.valor_nuevo = '50.00' and h.cambiado_por = '00000000-0000-4000-8000-000000160a01')
       and not exists (select 1 from public.club_config_historial h where h.location_id = 'p160-a' and h.campo = 'cortesia_costo_pct'
                        and h.valor_nuevo = '90.00'),
       (select cortesia_costo_pct::text from public.club_config where location_id = 'p160-a');
insert into _r160 (caso, ok, detalle)
select '6b con 50 % la cortesía cuesta ₡2.000',
       (pg_temp.t160('00000000-0000-4000-8000-000000160a01', date '2001-03-01', 'p160-a')->'plata'->>'cortesias_costo_crc')::numeric = 2000, null;
do $$
begin
  update public.club_config set cortesia_costo_pct = 101 where location_id = 'p160-a';
  insert into _r160 (caso, ok, detalle) values ('6c el % no pasa de 100', false, 'aceptó 101');
exception when check_violation then
  insert into _r160 (caso, ok, detalle) values ('6c el % no pasa de 100', true, 'check_violation');
end $$;

-- 7. rastro: cada lectura deja su fila en club_auditoria, sin datos
insert into _r160 (caso, ok, detalle)
select '7 rastro en club_auditoria (ver_tablero) con mes y local',
       exists (select 1 from public.club_auditoria a where a.accion = 'ver_tablero' and a.actor = '00000000-0000-4000-8000-000000160a03'
                and a.despues = '{"mes":"2001-03","local":"p160-a"}'::jsonb), null;

-- 8. vuelta atrás (dentro de esta misma transacción descartada): saca función y columna, y el resto del Club sigue
-- @@160R@@   (aquí va el cuerpo de scripts/sql/160_rollback.sql sin begin/commit)
insert into _r160 (caso, ok, detalle)
select '8 rollback: sin función ni columna; club_reporte_mes y club_config siguen',
       to_regprocedure('public.club_tablero_mes(date, text)') is null
       and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_config'
                        and column_name = 'cortesia_costo_pct')
       and to_regprocedure('public.club_reporte_mes(date, text, boolean)') is not null
       and (select count(*) from public.club_config where location_id in ('p160-a', 'p160-b')) = 2, null;

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r160;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r160 where not ok;
  if v is not null then raise exception '160-FALLAN: %', v; end if;
  if (select count(*) from _r160) < 32 then raise exception '160-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
