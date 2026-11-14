-- 161_pruebas (origen 107) · Club → Cohortes y Ranking de socios. Aplica la 161 dentro de una transacción, arma datos
-- ficticios, prueba y termina en ROLLBACK: no deja nada. Al final un ASSERT: si algún caso falla, aborta con
-- «161-FALLAN: <casos>». Se corre con scripts/sql/161_pruebas.py (--local: Postgres 16 local; --armar: SQL para staging).
--
-- MARCADORES que llena el runner: «-- @@161@@» → el cuerpo de la 161 sin begin;/commit; (con --mutar, con el arreglo
-- deshecho a propósito) y «-- @@161R@@» → el cuerpo de scripts/sql/161_rollback.sql.
--
-- Todo es ficticio y propio de la prueba: tres locales (p161-a con PoS, p161-b sin facturas, p161-c vacío), un usuario
-- por rol (más un owner inactivo y un manager de otro local) y 2001 (no hay datos reales). JWT simulado con
-- set_config('request.jwt.claims', …, true), como las baterías 155, 158 y 160.
--
-- Socios (alta = club_miembro_roles.desde):
--   S1 (a) alta 10-ene 12:00 CR · visitas días 0, 15, 41 (20-feb), 54 (5-mar, F1), 55 (6-mar, F1 otra vez), 75 (26-mar, F2)
--   S2 (a) alta 31-ene 23:30 CR (= 1-feb 05:30 UTC: es de ENERO) · visita día 0 · una visita del 5-ene (antes del alta) no cuenta
--   S3 (a) alta 5-feb, DE BAJA · visitas días 5, 10 y 31 (8-mar, F9 ANULADA)
--   P  (a) alta 6-feb, PENDIENTE: no es socio todavía (visita 12-mar con F3: ni en el ranking ni en los totales) · R (a) referente, sin rol socio
--   Q  (b) alta 15-ene · visita 26-mar en p161-a con F2 (Club compartido: comparte la mesa con S1)
--   N  (a) alta hace 5 días: su cohorte no puede medirse («aún no»)
-- Facturas de p161-a (marzo): F1 5-mar pax 3 · P1 ×1 ₡8.500 dos veces (ref ₡10.000 → desc ₡3.000) · 856 · 857 ×2 · K1 fam. 17 ₡500
--   F2 26-mar pax 4 · P2 ₡4.500 (ref ₡5.000 → ₡500) · P1 ₡8.500 (ref ₡10.000 de G1; sin excluir el Club sería ₡8.500) · 857 · P3 ₡2.000 sin ref
--      · P4 ₡8.000: ref ₡10.000 (G1 y G2, 1 y 10-mar), pero ese día la LISTA bajó a ₡8.000 (G3 y G4, 100 % de las ventas fuera del Club)
--        → cambio de lista, descuento 0 (sin la regla serían ₡2.000). Neta de F2 = ₡23.000
--   F3 12-mar, de la visita del PENDIENTE: P1 ×1 ₡8.500 dos veces SIN marcador (Club: no es referencia; no entra al ranking)
--   F4 26-mar, otra visita del PENDIENTE: P1 ×1 ₡8.500 dos veces SIN marcador. Es del Club: NO cuenta para el cambio de
--      lista (si contara, ese día el 100 % del P1 fuera de marcadores sería ₡8.500 y el P1 de F2 dejaría de ser descuento)
--   F9 8-mar ANULADA · G1 10-mar P1 ₡10.000 (sin Club) · G2 1-mar P2 ₡5.000 (sin Club)
--   Febrero (referencia de F1): P1 ×3 a ₡10.000 y ×1 a ₡9.000 · P2 ₡5.000 · P1 a ₡7.000 ×4 CON 856 (no es referencia)
begin;
-- @@161@@   (aquí va el cuerpo de la 161 sin begin/commit)
create temp table _r161 (n serial, caso text, ok boolean, detalle text) on commit drop;

-- ── Usuarios de prueba ─────────────────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000161a01', 'p161-owner@ejemplo.test'),
  ('00000000-0000-4000-8000-000000161a02', 'p161-manager@ejemplo.test'),
  ('00000000-0000-4000-8000-000000161a03', 'p161-contador@ejemplo.test'),
  ('00000000-0000-4000-8000-000000161a04', 'p161-cajero@ejemplo.test'),
  ('00000000-0000-4000-8000-000000161a05', 'p161-salonero@ejemplo.test'),
  ('00000000-0000-4000-8000-000000161a06', 'p161-owner-inactivo@ejemplo.test'),
  ('00000000-0000-4000-8000-000000161a07', 'p161-manager-otro@ejemplo.test');
insert into public.profiles (id, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000161a01', 'Prueba Owner', 'owner', true),
  ('00000000-0000-4000-8000-000000161a02', 'Prueba Manager', 'manager', true),
  ('00000000-0000-4000-8000-000000161a03', 'Prueba Contador', 'contador', true),
  ('00000000-0000-4000-8000-000000161a04', 'Prueba Cajero', 'cajero', true),
  ('00000000-0000-4000-8000-000000161a05', 'Prueba Salonero', 'salonero', true),
  ('00000000-0000-4000-8000-000000161a06', 'Prueba Owner Inactivo', 'owner', false),
  ('00000000-0000-4000-8000-000000161a07', 'Prueba Manager Otro', 'manager', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

-- ── Locales ────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.locations (id, name) values ('p161-a', 'Local P161 A'), ('p161-b', 'Local P161 B'), ('p161-c', 'Local P161 C')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre) values ('p161-a', 'Local P161 A'), ('p161-b', 'Local P161 B'), ('p161-c', 'Local P161 C');
-- el manager trabaja en p161-a; el otro manager solo en p161-b; cajero y salonero en p161-a (solo el ROL los deja afuera)
insert into public.profile_locations (profile_id, location_id, principal) values
  ('00000000-0000-4000-8000-000000161a02', 'p161-a', true),
  ('00000000-0000-4000-8000-000000161a04', 'p161-a', true),
  ('00000000-0000-4000-8000-000000161a05', 'p161-a', true),
  ('00000000-0000-4000-8000-000000161a07', 'p161-b', true);

-- ── Miembros (el alta de un miembro tipo socio crea su rol 'socio'; acá se le pone la fecha y el estado) ─────────────
insert into public.club_miembros (id, location_id, tipo, nombre) values
  ('00000000-0000-4000-8000-000000161b01', 'p161-a', 'socio',     'Prueba Socio Uno'),
  ('00000000-0000-4000-8000-000000161b02', 'p161-a', 'socio',     'Prueba Socio Dos'),
  ('00000000-0000-4000-8000-000000161b03', 'p161-a', 'socio',     'Prueba Socio Tres'),
  ('00000000-0000-4000-8000-000000161b04', 'p161-a', 'socio',     'Prueba Socio Pendiente'),
  ('00000000-0000-4000-8000-000000161b05', 'p161-a', 'referente', 'Prueba Referente'),
  ('00000000-0000-4000-8000-000000161b06', 'p161-b', 'socio',     'Prueba Socio Otro Local'),
  ('00000000-0000-4000-8000-000000161b07', 'p161-a', 'socio',     'Prueba Socio Nuevo');
insert into public.club_miembro_roles (miembro_id, rol, estado, desde)
select x.id::uuid, 'socio', 'activo', now() from (values ('00000000-0000-4000-8000-000000161b01'), ('00000000-0000-4000-8000-000000161b02'),
  ('00000000-0000-4000-8000-000000161b03'), ('00000000-0000-4000-8000-000000161b04'), ('00000000-0000-4000-8000-000000161b06'),
  ('00000000-0000-4000-8000-000000161b07')) x(id)
on conflict (miembro_id, rol) do nothing;
update public.club_miembro_roles r set desde = x.desde, estado = x.estado, baja_por = x.baja_por
  from (values ('00000000-0000-4000-8000-000000161b01'::uuid, timestamptz '2001-01-10 12:00-06', 'activo', null),
               ('00000000-0000-4000-8000-000000161b02'::uuid, timestamptz '2001-01-31 23:30-06', 'activo', null),
               ('00000000-0000-4000-8000-000000161b03'::uuid, timestamptz '2001-02-05 12:00-06', 'baja', 'socio'),
               ('00000000-0000-4000-8000-000000161b04'::uuid, timestamptz '2001-02-06 12:00-06', 'pendiente', null),
               ('00000000-0000-4000-8000-000000161b06'::uuid, timestamptz '2001-01-15 12:00-06', 'activo', null),
               ('00000000-0000-4000-8000-000000161b07'::uuid, now() - interval '5 days', 'activo', null)) x(id, desde, estado, baja_por)
 where r.miembro_id = x.id and r.rol = 'socio';
-- contactos (no tienen que salir en ninguna respuesta)
insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email)
values ('00000000-0000-4000-8000-000000161b01', 'p161-a', '+50600000161', 'p161-socio@ejemplo.test')
on conflict (miembro_id) do update set telefono = excluded.telefono, email = excluded.email;

-- ── Visitas (fecha = día CR de registrada_en) ──────────────────────────────────────────────────────────────────────
insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, client_op_id, pos_ref, estado_beneficio, aplicar)
select x.loc, x.m::uuid, (x.en at time zone 'America/Costa_Rica')::date, x.en, gen_random_uuid(),
       case when x.f is not null then jsonb_build_object('modo', 'factura', 'numero_factura', x.f) end, 'aplica', '{}'::jsonb
  from (values
    ('p161-a', '00000000-0000-4000-8000-000000161b01', timestamptz '2001-01-10 13:00-06', null),
    ('p161-a', '00000000-0000-4000-8000-000000161b01', timestamptz '2001-01-25 20:00-06', null),
    ('p161-a', '00000000-0000-4000-8000-000000161b01', timestamptz '2001-02-20 20:00-06', null),
    ('p161-a', '00000000-0000-4000-8000-000000161b01', timestamptz '2001-03-05 20:00-06', '00161001'),
    ('p161-a', '00000000-0000-4000-8000-000000161b01', timestamptz '2001-03-06 12:00-06', '00161001'),
    ('p161-a', '00000000-0000-4000-8000-000000161b01', timestamptz '2001-03-26 20:00-06', '00161002'),
    ('p161-a', '00000000-0000-4000-8000-000000161b02', timestamptz '2001-01-05 20:00-06', null),   -- antes del alta
    ('p161-a', '00000000-0000-4000-8000-000000161b02', timestamptz '2001-01-31 23:40-06', null),
    ('p161-a', '00000000-0000-4000-8000-000000161b03', timestamptz '2001-02-10 20:00-06', null),
    ('p161-a', '00000000-0000-4000-8000-000000161b03', timestamptz '2001-02-15 20:00-06', null),
    ('p161-a', '00000000-0000-4000-8000-000000161b03', timestamptz '2001-03-08 20:00-06', '00161009'),
    ('p161-a', '00000000-0000-4000-8000-000000161b04', timestamptz '2001-02-07 20:00-06', null),   -- pendiente
    ('p161-a', '00000000-0000-4000-8000-000000161b04', timestamptz '2001-03-12 20:00-06', '00161003'), -- pendiente, con F3
    ('p161-a', '00000000-0000-4000-8000-000000161b04', timestamptz '2001-03-26 12:00-06', '00161004'), -- pendiente, con F4
    ('p161-a', '00000000-0000-4000-8000-000000161b06', timestamptz '2001-03-26 20:05-06', '00161002')
  ) x(loc, m, en, f);

-- ── Facturas del PoS (p161-a) ──────────────────────────────────────────────────────────────────────────────────────
create temp table _t161 (id uuid, nf text, f timestamptz, estado text, pax int) on commit drop;
insert into _t161 values
  ('00000000-0000-4000-8000-000000161d01', '00161001', '2001-03-05 20:30-06', 'C', 3),
  ('00000000-0000-4000-8000-000000161d02', '00161002', '2001-03-26 20:30-06', 'C', 4),
  ('00000000-0000-4000-8000-000000161d09', '00161009', '2001-03-08 20:30-06', 'X', 2),
  ('00000000-0000-4000-8000-000000161d03', '00161003', '2001-03-12 20:30-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161d04', '00161004', '2001-03-26 12:30-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161d11', '00161011', '2001-03-10 20:30-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161d12', '00161012', '2001-03-01 20:30-06', 'C', 2),
  -- 26-mar: la lista de P4 baja de ₡10.000 a ₡8.000 (todas las ventas del día fuera del Club, a ₡8.000)
  ('00000000-0000-4000-8000-000000161d13', '00161013', '2001-03-26 13:00-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161d14', '00161014', '2001-03-26 19:00-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161e01', '00161101', '2001-02-20 20:00-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161e02', '00161102', '2001-02-21 20:00-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161e03', '00161103', '2001-02-22 20:00-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161e04', '00161104', '2001-02-23 20:00-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161e05', '00161105', '2001-02-24 20:00-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161e06', '00161106', '2001-02-25 20:00-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161e07', '00161107', '2001-02-26 20:00-06', 'C', 2),
  ('00000000-0000-4000-8000-000000161e08', '00161108', '2001-02-27 20:00-06', 'C', 2);
insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, fecha_cierra, estado, canal, registrado_por,
                                    con_servicio, pax, pax_alerta, total_crc)
select id, 'p161-a', nf, f, f, estado, 'salon', 'salonero', true, pax, 'ok', 0 from _t161;

insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto, familia, es_cortesia) values
  ('00000000-0000-4000-8000-000000161d01', 'P1',  'Plato uno',   1, 10000, 8500, 2, false),
  ('00000000-0000-4000-8000-000000161d01', 'P1',  'Plato uno',   1, 10000, 8500, 2, false),
  ('00000000-0000-4000-8000-000000161d01', '856', 'Local Club',  1,     0,    0, 2, false),
  ('00000000-0000-4000-8000-000000161d01', '857', 'Invitado',    2,     0,    0, 2, false),
  ('00000000-0000-4000-8000-000000161d01', 'K1',  'Cortesia gerencia', 1, 500, 500, 17, true),
  ('00000000-0000-4000-8000-000000161d02', 'P2',  'Plato dos',   1,  5000, 4500, 2, false),
  ('00000000-0000-4000-8000-000000161d02', 'P1',  'Plato uno',   1, 10000, 8500, 2, false),
  ('00000000-0000-4000-8000-000000161d02', '857', 'Invitado',    1,     0,    0, 2, false),
  ('00000000-0000-4000-8000-000000161d02', 'P3',  'Plato nuevo', 1,  2000, 2000, 2, false),
  ('00000000-0000-4000-8000-000000161d02', 'P4',  'Plato cuatro', 1, 8000, 8000, 2, false),
  ('00000000-0000-4000-8000-000000161d13', 'P4',  'Plato cuatro', 1, 8000, 8000, 2, false),
  ('00000000-0000-4000-8000-000000161d14', 'P4',  'Plato cuatro', 1, 8000, 8000, 2, false),
  ('00000000-0000-4000-8000-000000161d09', 'P1',  'Plato uno',   1, 10000, 5000, 2, false),
  ('00000000-0000-4000-8000-000000161d03', 'P1',  'Plato uno',   1, 10000, 8500, 2, false),
  ('00000000-0000-4000-8000-000000161d03', 'P1',  'Plato uno',   1, 10000, 8500, 2, false),
  ('00000000-0000-4000-8000-000000161d04', 'P1',  'Plato uno',   1, 10000, 8500, 2, false),
  ('00000000-0000-4000-8000-000000161d04', 'P1',  'Plato uno',   1, 10000, 8500, 2, false),
  ('00000000-0000-4000-8000-000000161d11', 'P1',  'Plato uno',   1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000161d12', 'P2',  'Plato dos',   1,  5000, 5000, 2, false),
  ('00000000-0000-4000-8000-000000161d11', 'P4',  'Plato cuatro', 1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000161d12', 'P4',  'Plato cuatro', 1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000161e01', 'P1',  'Plato uno',   1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000161e01', 'P2',  'Plato dos',   1,  5000, 5000, 2, false),
  ('00000000-0000-4000-8000-000000161e02', 'P1',  'Plato uno',   1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000161e03', 'P1',  'Plato uno',   1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000161e04', 'P1',  'Plato uno',   1,  9000, 9000, 2, false),
  ('00000000-0000-4000-8000-000000161e05', 'P1',  'Plato uno',   1, 10000, 7000, 2, false),
  ('00000000-0000-4000-8000-000000161e05', '856', 'Local Club',  1,     0,    0, 2, false),
  ('00000000-0000-4000-8000-000000161e06', 'P1',  'Plato uno',   1, 10000, 7000, 2, false),
  ('00000000-0000-4000-8000-000000161e06', '856', 'Local Club',  1,     0,    0, 2, false),
  ('00000000-0000-4000-8000-000000161e07', 'P1',  'Plato uno',   1, 10000, 7000, 2, false),
  ('00000000-0000-4000-8000-000000161e07', '856', 'Local Club',  1,     0,    0, 2, false),
  ('00000000-0000-4000-8000-000000161e08', 'P1',  'Plato uno',   1, 10000, 7000, 2, false),
  ('00000000-0000-4000-8000-000000161e08', '856', 'Local Club',  1,     0,    0, 2, false);

-- ── Llamar como un usuario (JWT simulado). Devuelve el JSON o «ERR:<sqlstate>» ───────────────────────────────────────
create or replace function pg_temp.co161(p_uid uuid, p_loc text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin r := public.club_cohortes_socios(p_loc); exception when others then r := to_jsonb('ERR:' || sqlstate); end;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create or replace function pg_temp.rk161(p_uid uuid, p_desde date, p_hasta date, p_loc text, p_exp boolean default false)
returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin r := public.club_ranking_socios(p_desde, p_hasta, p_loc, p_exp); exception when others then r := to_jsonb('ERR:' || sqlstate); end;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create or replace function pg_temp.rk161_ap(p_uid uuid, p_desde date, p_hasta date, p_loc text, p_exp boolean, p_ap uuid)
returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin r := public.club_ranking_socios(p_desde, p_hasta, p_loc, p_exp, p_ap); exception when others then r := to_jsonb('ERR:' || sqlstate); end;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create or replace function pg_temp.co161_ap(p_uid uuid, p_loc text, p_ap uuid) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin r := public.club_cohortes_socios(p_loc, p_ap); exception when others then r := to_jsonb('ERR:' || sqlstate); end;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
-- la fila de un socio en el ranking (por nombre)
create or replace function pg_temp.fila(r jsonb, p_nombre text) returns jsonb language sql as $f$
  select s from jsonb_array_elements(r->'socios') s where s->>'nombre' = p_nombre
$f$;
-- la fila de una cohorte (por mes)
create or replace function pg_temp.coh(r jsonb, p_mes text) returns jsonb language sql as $f$
  select s from jsonb_array_elements(r->'cohortes') s where s->>'mes' = p_mes
$f$;

create temp table _o161 on commit drop as
select pg_temp.co161('00000000-0000-4000-8000-000000161a01', 'p161-a') as co_owner,
       pg_temp.co161('00000000-0000-4000-8000-000000161a02', 'p161-a') as co_manager,
       pg_temp.co161('00000000-0000-4000-8000-000000161a03', 'p161-a') as co_contador,
       pg_temp.co161('00000000-0000-4000-8000-000000161a04', 'p161-a') as co_cajero,
       pg_temp.co161('00000000-0000-4000-8000-000000161a05', 'p161-a') as co_salonero,
       pg_temp.co161('00000000-0000-4000-8000-000000161a06', 'p161-a') as co_inactivo,
       pg_temp.co161(null,                                   'p161-a') as co_sin_sesion,
       pg_temp.co161('00000000-0000-4000-8000-000000161a07', 'p161-a') as co_manager_otro,
       pg_temp.co161('00000000-0000-4000-8000-000000161a01', null)     as co_todos,
       pg_temp.co161('00000000-0000-4000-8000-000000161a01', 'p161-c') as co_vacio,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a01', date '2001-03-01', date '2001-03-31', 'p161-a') as rk_owner,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a02', date '2001-03-01', date '2001-03-31', 'p161-a') as rk_manager,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a03', date '2001-03-01', date '2001-03-31', 'p161-a') as rk_contador,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a04', date '2001-03-01', date '2001-03-31', 'p161-a') as rk_cajero,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a05', date '2001-03-01', date '2001-03-31', 'p161-a') as rk_salonero,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a06', date '2001-03-01', date '2001-03-31', 'p161-a') as rk_inactivo,
       pg_temp.rk161(null,                                   date '2001-03-01', date '2001-03-31', 'p161-a') as rk_sin_sesion,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a07', date '2001-03-01', date '2001-03-31', 'p161-a') as rk_manager_otro,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a07', date '2001-03-01', date '2001-03-31', null)     as rk_manager_otro_todos,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a01', date '2001-03-01', date '2001-03-31', null)     as rk_todos,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a01', date '2001-03-01', date '2001-03-31', 'p161-c') as rk_vacio,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a01', date '2001-03-31', date '2001-03-01', 'p161-a') as rk_al_reves,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a01', date '2000-01-01', date '2001-03-31', 'p161-a') as rk_largo,
       pg_temp.rk161('00000000-0000-4000-8000-000000161a02', date '2001-03-01', date '2001-03-31', 'p161-a', true) as rk_exporte;

-- 0. catálogo
insert into _r161 (caso, ok, detalle)
select '0 catálogo: definer · search_path fijo · anon sin EXECUTE · authenticated con EXECUTE (la interna, sin)',
       bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp'] and not has_function_privilege('anon', p.oid, 'EXECUTE'))
       and has_function_privilege('authenticated', 'public.club_cohortes_socios(text, uuid)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.club_ranking_socios(date, date, text, boolean, uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_locales_de_reporte(text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_auditar_lectura(text, text, uuid, jsonb)', 'EXECUTE'),
       string_agg(p.proname || ':' || coalesce(p.proacl::text, 'sin acl'), ' | ')
  from pg_proc p where p.oid in ('public.club_cohortes_socios(text, uuid)'::regprocedure,
                                 'public.club_ranking_socios(date, date, text, boolean, uuid)'::regprocedure,
                                 'public.club_locales_de_reporte(text)'::regprocedure,
                                 'public.club_auditar_lectura(text, text, uuid, jsonb)'::regprocedure);

-- 1. permisos de Cohortes: owner, manager de su local y contador
insert into _r161 (caso, ok, detalle) select '1a cohortes: owner entra', jsonb_typeof(co_owner) = 'object', left(co_owner::text, 80) from _o161;
insert into _r161 (caso, ok, detalle) select '1b cohortes: manager de su local entra', jsonb_typeof(co_manager) = 'object', left(co_manager::text, 80) from _o161;
insert into _r161 (caso, ok, detalle) select '1c cohortes: contador entra (solo conteos)', jsonb_typeof(co_contador) = 'object', left(co_contador::text, 80) from _o161;
insert into _r161 (caso, ok, detalle) select '1d cohortes: cajero → 42501', co_cajero = to_jsonb('ERR:42501'::text), co_cajero::text from _o161;
insert into _r161 (caso, ok, detalle) select '1e cohortes: salonero → 42501', co_salonero = to_jsonb('ERR:42501'::text), co_salonero::text from _o161;
insert into _r161 (caso, ok, detalle) select '1f cohortes: owner inactivo → 42501', co_inactivo = to_jsonb('ERR:42501'::text), co_inactivo::text from _o161;
insert into _r161 (caso, ok, detalle) select '1g cohortes: sin sesión → 42501', co_sin_sesion = to_jsonb('ERR:42501'::text), co_sin_sesion::text from _o161;
insert into _r161 (caso, ok, detalle) select '1h cohortes: manager de OTRO local → 42501', co_manager_otro = to_jsonb('ERR:42501'::text), co_manager_otro::text from _o161;

-- 2. permisos del Ranking: solo owner y manager de su local
insert into _r161 (caso, ok, detalle) select '2a ranking: owner entra', jsonb_typeof(rk_owner) = 'object', left(rk_owner::text, 80) from _o161;
insert into _r161 (caso, ok, detalle) select '2b ranking: manager de su local entra', jsonb_typeof(rk_manager) = 'object', left(rk_manager::text, 80) from _o161;
insert into _r161 (caso, ok, detalle) select '2c ranking: contador → 42501', rk_contador = to_jsonb('ERR:42501'::text), rk_contador::text from _o161;
insert into _r161 (caso, ok, detalle) select '2d ranking: cajero → 42501', rk_cajero = to_jsonb('ERR:42501'::text), rk_cajero::text from _o161;
insert into _r161 (caso, ok, detalle) select '2e ranking: salonero → 42501', rk_salonero = to_jsonb('ERR:42501'::text), rk_salonero::text from _o161;
insert into _r161 (caso, ok, detalle) select '2f ranking: owner inactivo → 42501', rk_inactivo = to_jsonb('ERR:42501'::text), rk_inactivo::text from _o161;
insert into _r161 (caso, ok, detalle) select '2g ranking: sin sesión → 42501', rk_sin_sesion = to_jsonb('ERR:42501'::text), rk_sin_sesion::text from _o161;
insert into _r161 (caso, ok, detalle) select '2h ranking: manager de OTRO local → 42501', rk_manager_otro = to_jsonb('ERR:42501'::text), rk_manager_otro::text from _o161;
insert into _r161 (caso, ok, detalle)
select '2i ranking «todos» del manager de otro local: solo su local (p161-b), sin los socios de p161-a',
       rk_manager_otro_todos->'locales' = '["p161-b"]'::jsonb
       and pg_temp.fila(rk_manager_otro_todos, 'Prueba Socio Uno') is null
       and pg_temp.fila(rk_manager_otro_todos, 'Prueba Socio Otro Local') is not null,
       left(rk_manager_otro_todos::text, 160) from _o161;
-- 2j. anon: sin EXECUTE de verdad (con el rol anon), en las dos
do $$
declare v_ok int := 0; v_msg text := '';
begin
  set local role anon;
  begin perform public.club_cohortes_socios('p161-a');
  exception when insufficient_privilege then
    if sqlerrm like 'permission denied for function%' then v_ok := v_ok + 1; end if; v_msg := v_msg || sqlerrm || ' | ';
  end;
  begin perform public.club_ranking_socios(date '2001-03-01', date '2001-03-31', 'p161-a', false);
  exception when insufficient_privilege then
    if sqlerrm like 'permission denied for function%' then v_ok := v_ok + 1; end if; v_msg := v_msg || sqlerrm;
  end;
  reset role;
  insert into _r161 (caso, ok, detalle) values ('2j anon → permission denied en las dos', v_ok = 2, v_msg);
end $$;
reset role;
insert into _r161 (caso, ok, detalle)
select '2k período al revés y de más de 400 días → P0001',
       rk_al_reves = to_jsonb('ERR:P0001'::text) and rk_largo = to_jsonb('ERR:P0001'::text),
       rk_al_reves::text || ' · ' || rk_largo::text from _o161;

-- 3. cohortes (p161-a)
insert into _r161 (caso, ok, detalle)
select '3a enero 2001: 2 socios (S2 de las 23:30 CR es de enero), con 2.ª 1, con 4.ª 1, 7 visitas, 3,5 por socio',
       (c->>'socios')::int = 2 and (c->>'con_2')::int = 1 and (c->>'con_4')::int = 1 and (c->>'visitas')::int = 7
       and (c->>'visitas_por_socio')::numeric = 3.5, c::text
  from (select pg_temp.coh(co_owner, '2001-01') as c from _o161) x;
insert into _r161 (caso, ok, detalle)
select '3b enero 2001: activos 30/60/90 = 1/1/1 (el día del alta no cuenta; la visita de antes del alta, tampoco)',
       (c->>'activos_30')::int = 1 and (c->>'activos_60')::int = 1 and (c->>'activos_90')::int = 1, c::text
  from (select pg_temp.coh(co_owner, '2001-01') as c from _o161) x;
insert into _r161 (caso, ok, detalle)
select '3c febrero 2001: 1 socio de baja (cuenta), sin el pendiente; con 2.ª 1, con 4.ª 0, activos 1/1/0, 3 visitas',
       (c->>'socios')::int = 1 and (c->>'bajas')::int = 1 and (c->>'con_2')::int = 1 and (c->>'con_4')::int = 0
       and (c->>'activos_30')::int = 1 and (c->>'activos_60')::int = 1 and (c->>'activos_90')::int = 0
       and (c->>'visitas')::int = 3, c::text
  from (select pg_temp.coh(co_owner, '2001-02') as c from _o161) x;
insert into _r161 (caso, ok, detalle)
select '3d cohorte de hace 5 días: activos 30/60/90 = null («aún no»), no 0',
       c is not null and c->'activos_30' = 'null'::jsonb and c->'activos_60' = 'null'::jsonb and c->'activos_90' = 'null'::jsonb
       and (c->>'socios')::int = 1, coalesce(c::text, 'sin cohorte')
  from (select s as c from _o161, jsonb_array_elements(co_owner->'cohortes') s where s->>'mes' > '2001-12') x;
insert into _r161 (caso, ok, detalle)
select '3e totales p161-a: 4 socios (sin pendiente, sin referente, sin el de otro local), 10 visitas',
       (co_owner->'totales'->>'socios')::int = 4 and (co_owner->'totales'->>'visitas')::int = 10
       and jsonb_array_length(co_owner->'cohortes') = 3, (co_owner->'totales')::text from _o161;
insert into _r161 (caso, ok, detalle)
select '3f «todos los locales» del owner: enero suma el socio de p161-b (3 socios)',
       (pg_temp.coh(co_todos, '2001-01')->>'socios')::int = 3 and co_todos->'locales' @> '["p161-a","p161-b","p161-c"]'::jsonb,
       (pg_temp.coh(co_todos, '2001-01'))::text from _o161;
insert into _r161 (caso, ok, detalle)
select '3g el contador ve lo mismo que el owner y nada personal (nombres, teléfonos, correos, ids)',
       jsonb_typeof(co_contador) = 'object' and jsonb_typeof(co_owner) = 'object'
       and (case when jsonb_typeof(co_contador) = 'object' then (co_contador - 'generado_en') = (co_owner - 'generado_en') else false end)
       and co_contador::text !~ '(Prueba|Socio|@|50600000161|00000000-0000-4000-8000-000000161b)', null from _o161;
insert into _r161 (caso, ok, detalle)
select '3h local sin socios: objeto con cohortes [] y totales en cero (visitas por socio null)',
       co_vacio->'cohortes' = '[]'::jsonb and (co_vacio->'totales'->>'socios')::int = 0
       and co_vacio->'totales'->'visitas_por_socio' = 'null'::jsonb, co_vacio::text from _o161;

-- 4. ranking (p161-a, marzo 2001)
insert into _r161 (caso, ok, detalle)
select '4a S1: 3 visitas, 2 mesas, 2 facturas (F1 una vez aunque dos visitas), venta ₡40.000, tiquete ₡20.000',
       (s->>'visitas')::int = 3 and (s->>'mesas')::int = 2 and (s->>'facturas')::int = 2
       and (s->>'venta_respaldada_crc')::numeric = 40000 and (s->>'tiquete_promedio_crc')::numeric = 20000, s::text
  from (select pg_temp.fila(rk_owner, 'Prueba Socio Uno') as s from _o161) x;
insert into _r161 (caso, ok, detalle)
select '4b S1: invitados 3 (857), personas 7, descuento estimado ₡5.000, última visita 26-mar',
       (s->>'invitados')::numeric = 3 and (s->>'personas')::int = 7 and (s->>'descuento_estimado_crc')::numeric = 5000
       and s->>'ultima_visita' = '2001-03-26', s::text
  from (select pg_temp.fila(rk_owner, 'Prueba Socio Uno') as s from _o161) x;
insert into _r161 (caso, ok, detalle)
select '4c socio de otro local que vino a p161-a (Club compartido): su mesa F2, ₡23.000, descuento ₡2.000',
       (s->>'visitas')::int = 1 and (s->>'venta_respaldada_crc')::numeric = 23000 and (s->>'tiquete_promedio_crc')::numeric = 23000
       and (s->>'descuento_estimado_crc')::numeric = 2000 and (s->>'invitados')::numeric = 1, coalesce(s::text, 'no está')
  from (select pg_temp.fila(rk_owner, 'Prueba Socio Otro Local') as s from _o161) x;
insert into _r161 (caso, ok, detalle)
select '4d S3 (de baja): visita con factura ANULADA → 1 visita, 0 mesas, ₡0, tiquete null',
       (s->>'visitas')::int = 1 and (s->>'mesas')::int = 0 and (s->>'venta_respaldada_crc')::numeric = 0
       and s->'tiquete_promedio_crc' = 'null'::jsonb and s->>'estado' = 'baja', s::text
  from (select pg_temp.fila(rk_owner, 'Prueba Socio Tres') as s from _o161) x;
insert into _r161 (caso, ok, detalle)
select '4e sin visitas en el período: S2 en cero con su última visita (31-ene); N con última null; pendiente y referente afuera',
       (pg_temp.fila(rk_owner, 'Prueba Socio Dos')->>'visitas')::int = 0
       and pg_temp.fila(rk_owner, 'Prueba Socio Dos')->>'ultima_visita' = '2001-01-31'
       and pg_temp.fila(rk_owner, 'Prueba Socio Nuevo')->'ultima_visita' = 'null'::jsonb
       and pg_temp.fila(rk_owner, 'Prueba Socio Pendiente') is null and pg_temp.fila(rk_owner, 'Prueba Referente') is null
       and jsonb_array_length(rk_owner->'socios') = 5, (rk_owner->'socios')::text from _o161;
insert into _r161 (caso, ok, detalle)
select '4f totales: F2 compartida cuenta UNA vez y F3 del pendiente no entra: 2 facturas, ₡40.000, invitados 3, descuento ₡5.000, 1 línea sin ref, 5 visitas',
       (t->>'facturas')::int = 2 and (t->>'venta_respaldada_crc')::numeric = 40000 and (t->>'invitados')::numeric = 3
       and (t->>'descuento_estimado_crc')::numeric = 5000 and (t->>'lineas_sin_referencia')::int = 1 and (t->>'visitas')::int = 5
       and (t->>'socios')::int = 5 and (t->>'socios_con_visita')::int = 3, t::text
  from (select rk_owner->'totales' as t from _o161) x;
insert into _r161 (caso, ok, detalle)
select '4g orden por venta: S1, el de otro local, S3',
       rk_owner->'socios'->0->>'nombre' = 'Prueba Socio Uno' and rk_owner->'socios'->1->>'nombre' = 'Prueba Socio Otro Local'
       and rk_owner->'socios'->2->>'nombre' = 'Prueba Socio Tres', null from _o161;
insert into _r161 (caso, ok, detalle)
select '4h sin teléfonos, correos, códigos ni tokens en el ranking',
       rk_owner::text !~ '(@|50600000161|token|codigo)'
       and not exists (select 1 from public.club_miembros m where m.id::text like '00000000-0000-4000-8000-000000161b%'
                        and (strpos(rk_owner::text, m.codigo) > 0 or strpos(rk_owner::text, m.token_portal) > 0)), null from _o161;
insert into _r161 (caso, ok, detalle)
select '4i el manager ve lo mismo que el owner',
       case when jsonb_typeof(rk_manager) = 'object' and jsonb_typeof(rk_owner) = 'object'
            then (rk_manager - 'generado_en') = (rk_owner - 'generado_en') else false end, null from _o161;

insert into _r161 (caso, ok, detalle)
select '4j cambio de lista: P4 baja de ₡10.000 a ₡8.000 el 26-mar y el socio paga ₡8.000 → descuento 0 (no ₡2.000)',
       (pg_temp.fila(rk_owner, 'Prueba Socio Otro Local')->>'descuento_estimado_crc')::numeric = 2000
       and (rk_owner->'totales'->>'descuento_estimado_crc')::numeric = 5000, (rk_owner->'totales')::text from _o161;

-- 5. cero datos y locales sin PoS
insert into _r161 (caso, ok, detalle)
select '5a local vacío: socios [], totales en cero, aviso de local sin PoS',
       rk_vacio->'socios' = '[]'::jsonb and (rk_vacio->'totales'->>'facturas')::int = 0
       and (rk_vacio->'totales'->>'venta_respaldada_crc')::numeric = 0 and rk_vacio->'locales_sin_pos' = '["Local P161 C"]'::jsonb,
       rk_vacio::text from _o161;
insert into _r161 (caso, ok, detalle)
select '5b p161-a tiene PoS (sin aviso); «todos» avisa p161-b y p161-c y no p161-a',
       rk_owner->'locales_sin_pos' = '[]'::jsonb
       and rk_todos->'locales_sin_pos' @> '["Local P161 B","Local P161 C"]'::jsonb
       and not rk_todos->'locales_sin_pos' @> '["Local P161 A"]'::jsonb, (rk_todos->'locales_sin_pos')::text from _o161;

-- 6. rastro en club_auditoria (sin datos)
insert into _r161 (caso, ok, detalle)
select '6a abrir el ranking deja «ver_ranking_socios» con período, local y filas',
       exists (select 1 from public.club_auditoria a where a.accion = 'ver_ranking_socios' and a.actor = '00000000-0000-4000-8000-000000161a01'
                and a.despues = '{"desde":"2001-03-01","hasta":"2001-03-31","local":"p161-a","filas":5}'::jsonb), null;
insert into _r161 (caso, ok, detalle)
select '6b exportar deja «exporte_ranking_socios_csv» (y no «ver_ranking_socios») del manager',
       exists (select 1 from public.club_auditoria a where a.accion = 'exporte_ranking_socios_csv' and a.actor = '00000000-0000-4000-8000-000000161a02')
       and (select count(*) from public.club_auditoria a where a.accion = 'ver_ranking_socios' and a.actor = '00000000-0000-4000-8000-000000161a02') = 1,
       null;
insert into _r161 (caso, ok, detalle)
select '6c cohortes deja «ver_cohortes» del contador; el ranking rechazado no deja rastro',
       exists (select 1 from public.club_auditoria a where a.accion = 'ver_cohortes' and a.actor = '00000000-0000-4000-8000-000000161a03'
                and a.despues = '{"local":"p161-a"}'::jsonb)
       and not exists (select 1 from public.club_auditoria a where a.accion like '%ranking%' and a.actor = '00000000-0000-4000-8000-000000161a03'),
       null;

-- 6d. una fila por APERTURA: el owner abre el ranking (id A) y cambia tres veces los filtros → 1 fila; abre de nuevo
-- (id B) → otra; exporta dos veces con el id B → 2 filas de exporte. Cohortes igual (id C, dos locales → 1 fila).
create temp table _a161 on commit drop as
select pg_temp.rk161_ap('00000000-0000-4000-8000-000000161a01', date '2001-03-01', date '2001-03-31', 'p161-a', false, '00000000-0000-4000-8000-0000001610a1') as x1,
       pg_temp.rk161_ap('00000000-0000-4000-8000-000000161a01', date '2001-02-01', date '2001-03-31', 'p161-a', false, '00000000-0000-4000-8000-0000001610a1') as x2,
       pg_temp.rk161_ap('00000000-0000-4000-8000-000000161a01', date '2001-02-01', date '2001-03-31', null,     false, '00000000-0000-4000-8000-0000001610a1') as x3,
       pg_temp.rk161_ap('00000000-0000-4000-8000-000000161a01', date '2001-03-01', date '2001-03-31', 'p161-a', false, '00000000-0000-4000-8000-0000001610b1') as x4,
       pg_temp.rk161_ap('00000000-0000-4000-8000-000000161a01', date '2001-03-01', date '2001-03-31', 'p161-a', true,  '00000000-0000-4000-8000-0000001610b1') as x5,
       pg_temp.rk161_ap('00000000-0000-4000-8000-000000161a01', date '2001-03-01', date '2001-03-31', 'p161-a', true,  '00000000-0000-4000-8000-0000001610b1') as x6,
       pg_temp.co161_ap('00000000-0000-4000-8000-000000161a01', 'p161-a', '00000000-0000-4000-8000-0000001610c1') as y1,
       pg_temp.co161_ap('00000000-0000-4000-8000-000000161a01', null,     '00000000-0000-4000-8000-0000001610c1') as y2;
insert into _r161 (caso, ok, detalle)
select '6d una fila por apertura: id A con 3 filtros → 1 · id B → 1 · 2 exportes → 2 · cohortes id C con 2 locales → 1 (y las respuestas llegan)',
       (select count(*) from public.club_auditoria a where a.accion = 'ver_ranking_socios' and a.objeto_id = '00000000-0000-4000-8000-0000001610a1') = 1
       and (select count(*) from public.club_auditoria a where a.accion = 'ver_ranking_socios' and a.objeto_id = '00000000-0000-4000-8000-0000001610b1') = 1
       and (select count(*) from public.club_auditoria a where a.accion = 'exporte_ranking_socios_csv' and a.objeto_id = '00000000-0000-4000-8000-0000001610b1') = 2
       and (select count(*) from public.club_auditoria a where a.accion = 'ver_cohortes' and a.objeto_id = '00000000-0000-4000-8000-0000001610c1') = 1
       and (select bool_and(jsonb_typeof(v) = 'object') from _a161, unnest(array[x1, x2, x3, x4, x5, x6, y1, y2]) v),
       (select string_agg(a.accion || ':' || coalesce(a.objeto_id::text, '-'), ' ') from public.club_auditoria a
         where a.objeto_id::text like '00000000-0000-4000-8000-0000001610%');

-- 7. vuelta atrás (dentro de esta misma transacción descartada): saca las tres funciones; el resto del Club sigue
-- @@161R@@   (aquí va el cuerpo de scripts/sql/161_rollback.sql sin begin/commit)
insert into _r161 (caso, ok, detalle)
select '7 rollback: sin las funciones de la 161; club_reporte_mes y club_config siguen',
       to_regprocedure('public.club_cohortes_socios(text, uuid)') is null
       and to_regprocedure('public.club_ranking_socios(date, date, text, boolean, uuid)') is null
       and to_regprocedure('public.club_locales_de_reporte(text)') is null
       and to_regprocedure('public.club_auditar_lectura(text, text, uuid, jsonb)') is null
       and to_regprocedure('public.club_reporte_mes(date, text, boolean)') is not null
       and (select count(*) from public.club_config where location_id like 'p161-%') = 3, null;

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r161;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r161 where not ok;
  if v is not null then raise exception '161-FALLAN: %', v; end if;
  if (select count(*) from _r161) < 45 then raise exception '161-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
