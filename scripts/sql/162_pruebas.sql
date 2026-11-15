-- 162_pruebas (origen 108) · Club → Embudo del anfitrión. Aplica la 162 dentro de una transacción, arma datos ficticios,
-- prueba y termina en ROLLBACK: no deja nada. Al final un ASSERT: si algún caso falla, aborta con «162-FALLAN: <casos>».
-- Se corre con scripts/sql/162_pruebas.py (--local: Postgres 16 local; --armar: SQL para staging).
-- Corre igual con y sin la 157 (D7) y la 158 (clic de reseña): los casos 8a/8b miran qué hay en la base y exigen lo que
-- corresponde a cada caso. Para cubrir los dos caminos, correr la batería en una base sin 157/158 y en otra con las dos.
--
-- MARCADORES que llena el runner: «-- @@162@@» → el cuerpo de la 162 sin begin;/commit; (con --mutar, con el arreglo
-- deshecho a propósito) y «-- @@162R@@» → el cuerpo de scripts/sql/162_rollback.sql.
--
-- Todo es ficticio y propio de la prueba: tres locales (p162-a con PoS, p162-b sin facturas, p162-c vacío), un usuario
-- por rol (más un owner inactivo y un manager de otro local), año 2001. JWT simulado con set_config('request.jwt.claims').
--
-- Anfitriones de p162-a y sus cupones GENERADOS en marzo 2001 (hora CR):
--   R1 referente · C1 usado 4 pers. F1 (neta 10.000, regalía 1.000 → cobrada 9.000; clic de reseña)
--                · C2 usado 2 pers. F2 (8.000; la MISMA mesa que D1 del equipo; clic de reseña)
--                · C3 usado 3 pers. F9 ANULADA, elegida a mano (no tiene factura) · C4 vigente vencido · C5 anulado
--                · C6 generado 31-mar 23:30 CR (= 1-abr UTC: es de MARZO), usado en abril, F3 (neta 6.000, regalía 7.000 → 0)
--                · CF generado 28-feb 23:00 CR (= 1-mar UTC: es de FEBRERO), usado con F5 y con clic: no entra
--   E1 equipo    · D1 usado 3 pers. F2 · D3 usado 1 pers. TAMBIÉN en F2 (dos cupones del mismo anfitrión, una factura)
--                · D2 vigente (vence en 2099)
--   K1 concierge · Q1 usado 2 pers. sin cruce automático; la factura F4 (5.000) elegida a mano (club_cruces_manuales)
--                · Q2 usado 1 pers.; la factura elegida a mano F6 sigue PROVISIONAL (R, sin cierre de caja): no cuenta
--   R5 referente · M1 usado 2 pers. por PEDIDO: mesa dividida en FP (principal, 6.000) + FD (dividida, 4.000) = 1 mesa
--   R2 referente y E2 equipo activos SIN cupones · R3 referente de baja sin cupones · S socio (no es anfitrión)
--   R4 referente de p162-b · un cupón usado en marzo (sin PoS en p162-b)
begin;
-- @@162@@   (aquí va el cuerpo de la 162 sin begin/commit)
create temp table _r162 (n serial, caso text, ok boolean, detalle text) on commit drop;

-- ── Usuarios de prueba ─────────────────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000162a01', 'p162-owner@ejemplo.test'),
  ('00000000-0000-4000-8000-000000162a02', 'p162-manager@ejemplo.test'),
  ('00000000-0000-4000-8000-000000162a03', 'p162-contador@ejemplo.test'),
  ('00000000-0000-4000-8000-000000162a04', 'p162-cajero@ejemplo.test'),
  ('00000000-0000-4000-8000-000000162a05', 'p162-salonero@ejemplo.test'),
  ('00000000-0000-4000-8000-000000162a06', 'p162-owner-inactivo@ejemplo.test'),
  ('00000000-0000-4000-8000-000000162a07', 'p162-manager-otro@ejemplo.test');
insert into public.profiles (id, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000162a01', 'Prueba Owner', 'owner', true),
  ('00000000-0000-4000-8000-000000162a02', 'Prueba Manager', 'manager', true),
  ('00000000-0000-4000-8000-000000162a03', 'Prueba Contador', 'contador', true),
  ('00000000-0000-4000-8000-000000162a04', 'Prueba Cajero', 'cajero', true),
  ('00000000-0000-4000-8000-000000162a05', 'Prueba Salonero', 'salonero', true),
  ('00000000-0000-4000-8000-000000162a06', 'Prueba Owner Inactivo', 'owner', false),
  ('00000000-0000-4000-8000-000000162a07', 'Prueba Manager Otro', 'manager', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

-- ── Locales ────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.locations (id, name) values ('p162-a', 'Local P162 A'), ('p162-b', 'Local P162 B'), ('p162-c', 'Local P162 C')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre) values ('p162-a', 'Local P162 A'), ('p162-b', 'Local P162 B'), ('p162-c', 'Local P162 C');
insert into public.profile_locations (profile_id, location_id, principal) values
  ('00000000-0000-4000-8000-000000162a02', 'p162-a', true),
  ('00000000-0000-4000-8000-000000162a04', 'p162-a', true),
  ('00000000-0000-4000-8000-000000162a05', 'p162-a', true),
  ('00000000-0000-4000-8000-000000162a07', 'p162-b', true);

-- ── Miembros (el trigger crea su rol) ──────────────────────────────────────────────────────────────────────────────
insert into public.club_miembros (id, location_id, tipo, nombre, estado) values
  ('00000000-0000-4000-8000-000000162b01', 'p162-a', 'referente',    'Prueba Referente Uno', 'activo'),
  ('00000000-0000-4000-8000-000000162b02', 'p162-a', 'equipo',       'Prueba Equipo Uno', 'activo'),
  ('00000000-0000-4000-8000-000000162b03', 'p162-a', 'concierge_pm', 'Prueba Concierge', 'activo'),
  ('00000000-0000-4000-8000-000000162b04', 'p162-a', 'referente',    'Prueba Referente Dos', 'activo'),
  ('00000000-0000-4000-8000-000000162b05', 'p162-a', 'equipo',       'Prueba Equipo Dos', 'activo'),
  ('00000000-0000-4000-8000-000000162b06', 'p162-a', 'referente',    'Prueba Referente Baja', 'baja'),
  ('00000000-0000-4000-8000-000000162b07', 'p162-a', 'socio',        'Prueba Socio', 'activo'),
  ('00000000-0000-4000-8000-000000162b08', 'p162-b', 'referente',    'Prueba Referente Otro Local', 'activo'),
  ('00000000-0000-4000-8000-000000162b09', 'p162-a', 'referente',    'Prueba Referente Mesa', 'activo');
-- contactos (no tienen que salir en ninguna respuesta)
insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email)
values ('00000000-0000-4000-8000-000000162b01', 'p162-a', '+50600000162', 'p162-ref@ejemplo.test')
on conflict (miembro_id) do update set telefono = excluded.telefono, email = excluded.email;

-- ── Facturas del PoS (p162-a) ──────────────────────────────────────────────────────────────────────────────────────
create temp table _t162 (id uuid, nf text, f timestamptz, estado text, regalia numeric) on commit drop;
insert into _t162 values
  ('00000000-0000-4000-8000-000000162d01', '00162001', '2001-03-05 20:30-06', 'C', 1000),
  ('00000000-0000-4000-8000-000000162d02', '00162002', '2001-03-10 20:30-06', 'C', 0),
  ('00000000-0000-4000-8000-000000162d03', '00162003', '2001-04-01 20:30-06', 'C', 7000),
  ('00000000-0000-4000-8000-000000162d04', '00162004', '2001-03-15 20:30-06', 'C', null),
  ('00000000-0000-4000-8000-000000162d05', '00162005', '2001-03-01 20:30-06', 'C', 0),
  ('00000000-0000-4000-8000-000000162d09', '00162009', '2001-03-08 20:30-06', 'X', 0),
  ('00000000-0000-4000-8000-000000162d06', '00162006', '2001-03-18 20:30-06', 'R', 0);
insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, fecha_cierra, estado, canal, registrado_por,
                                    con_servicio, pax, pax_alerta, total_crc, regalia_crc)
select id, 'p162-a', nf, f, f, estado, 'salon', 'salonero', true, 2, 'ok', 0, regalia from _t162;
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto, familia, es_cortesia) values
  ('00000000-0000-4000-8000-000000162d01', 'P1', 'Plato uno',  1, 10000, 10000,  2, false),
  ('00000000-0000-4000-8000-000000162d01', 'K1', 'Cortesia',   1,   500,   500, 17, true),
  ('00000000-0000-4000-8000-000000162d02', 'P2', 'Plato dos',  1,  8000,  8000,  2, false),
  ('00000000-0000-4000-8000-000000162d03', 'P3', 'Plato tres', 1,  6000,  6000,  2, false),
  ('00000000-0000-4000-8000-000000162d04', 'P4', 'Plato cuatro', 1, 5000, 5000,  2, false),
  ('00000000-0000-4000-8000-000000162d05', 'P1', 'Plato uno',  1, 10000, 10000,  2, false),
  ('00000000-0000-4000-8000-000000162d09', 'P1', 'Plato uno',  1, 10000, 10000,  2, false),
  ('00000000-0000-4000-8000-000000162d06', 'P2', 'Plato dos',  1,  3000,  3000,  2, false);

-- Mesa dividida (pedido 162, mesa 7 del salón): FP con el pedido y FD sin pedido, misma mesa, 10 minutos después
insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, fecha_cierra, estado, canal, registrado_por,
                                    con_servicio, pax, pax_alerta, total_crc, regalia_crc, numero_pedido, pedido_abierto_en,
                                    mesa, mesa_factura, area, area_factura)
values
  ('00000000-0000-4000-8000-000000162d07', 'p162-a', '00162007', '2001-03-20 20:30-06', '2001-03-20 20:30-06', 'C', 'salon', 'salonero',
   true, 2, 'ok', 0, 0, '162', '2001-03-20 19:00-06', '7', '7', 'SALON', 'SALON'),
  ('00000000-0000-4000-8000-000000162d08', 'p162-a', '00162008', '2001-03-20 20:40-06', '2001-03-20 20:40-06', 'C', 'salon', 'sin_pedido',
   true, 2, 'ok', 0, 0, null, null, null, '7', 'SALON', 'SALON');
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto, familia, es_cortesia) values
  ('00000000-0000-4000-8000-000000162d07', 'P3', 'Plato tres', 1,  6000,  6000,  2, false),
  ('00000000-0000-4000-8000-000000162d08', 'P4', 'Plato cuatro', 1, 4000, 4000,  2, false);

-- ── Cupones ────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.pf(p text) returns jsonb language sql as $f$
  select case when p is null then null else jsonb_build_object('modo', 'factura', 'numero_factura', p) end
$f$;
insert into public.club_cupones (id, location_id, referente_id, estado, creado_en, vence_en, usado_en, factura_pos, personas, pos_ref)
select x.id::uuid, x.loc, x.ref::uuid, x.estado, x.creado, x.vence, x.usado, x.fac, x.pers, pg_temp.pf(x.fac)
  from (values
    ('00000000-0000-4000-8000-000000162c01', 'p162-a', '00000000-0000-4000-8000-000000162b01', 'usado',   timestamptz '2001-03-04 12:00-06', timestamptz '2001-03-11 12:00-06', timestamptz '2001-03-05 20:00-06', '00162001', 4),
    ('00000000-0000-4000-8000-000000162c02', 'p162-a', '00000000-0000-4000-8000-000000162b01', 'usado',   timestamptz '2001-03-09 12:00-06', timestamptz '2001-03-16 12:00-06', timestamptz '2001-03-10 20:00-06', '00162002', 2),
    ('00000000-0000-4000-8000-000000162c03', 'p162-a', '00000000-0000-4000-8000-000000162b01', 'usado',   timestamptz '2001-03-07 12:00-06', timestamptz '2001-03-14 12:00-06', timestamptz '2001-03-08 20:00-06', '00162009', 3),
    ('00000000-0000-4000-8000-000000162c04', 'p162-a', '00000000-0000-4000-8000-000000162b01', 'vigente', timestamptz '2001-03-12 12:00-06', timestamptz '2001-03-19 12:00-06', null, null, null),
    ('00000000-0000-4000-8000-000000162c05', 'p162-a', '00000000-0000-4000-8000-000000162b01', 'anulado', timestamptz '2001-03-13 12:00-06', timestamptz '2001-03-20 12:00-06', null, null, null),
    ('00000000-0000-4000-8000-000000162c06', 'p162-a', '00000000-0000-4000-8000-000000162b01', 'usado',   timestamptz '2001-03-31 23:30-06', timestamptz '2001-04-07 12:00-06', timestamptz '2001-04-01 20:00-06', '00162003', 2),
    ('00000000-0000-4000-8000-000000162c0e', 'p162-a', '00000000-0000-4000-8000-000000162b01', 'usado',   timestamptz '2001-02-28 23:00-06', timestamptz '2001-03-07 12:00-06', timestamptz '2001-03-01 20:00-06', '00162005', 5),
    ('00000000-0000-4000-8000-000000162e01', 'p162-a', '00000000-0000-4000-8000-000000162b02', 'usado',   timestamptz '2001-03-09 13:00-06', timestamptz '2001-03-16 12:00-06', timestamptz '2001-03-10 20:05-06', '00162002', 3),
    ('00000000-0000-4000-8000-000000162e03', 'p162-a', '00000000-0000-4000-8000-000000162b02', 'usado',   timestamptz '2001-03-09 14:00-06', timestamptz '2001-03-16 12:00-06', timestamptz '2001-03-10 20:10-06', '00162002', 1),
    ('00000000-0000-4000-8000-000000162e02', 'p162-a', '00000000-0000-4000-8000-000000162b02', 'vigente', timestamptz '2001-03-20 12:00-06', timestamptz '2099-01-01 12:00-06', null, null, null),
    ('00000000-0000-4000-8000-000000162f01', 'p162-b', '00000000-0000-4000-8000-000000162b08', 'usado',   timestamptz '2001-03-20 12:00-06', timestamptz '2001-03-27 12:00-06', timestamptz '2001-03-21 20:00-06', '00162001', 2)
  ) x(id, loc, ref, estado, creado, vence, usado, fac, pers);
-- Q1 del concierge: usado sin cruce automático (factura tipeada que no existe); la factura se eligió a mano
insert into public.club_cupones (id, location_id, referente_id, estado, creado_en, vence_en, usado_en, factura_pos, personas)
values ('00000000-0000-4000-8000-000000162a91', 'p162-a', '00000000-0000-4000-8000-000000162b03', 'usado',
        '2001-03-14 12:00-06', '2001-03-21 12:00-06', '2001-03-15 20:00-06', '99999', 2);
insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                     factura_pos, cupon_id, fecha_visita, origen)
values ('00000000-0000-4000-8000-000000162a92', 'p162-a', '00000000-0000-4000-8000-000000162b03', 'tarjeta', 2, 6, 18000,
        '99999', '00000000-0000-4000-8000-000000162a91', '2001-03-15 20:00-06', 'app');
insert into public.club_cruces_manuales (movimiento_id, location_id, numero_factura)
values ('00000000-0000-4000-8000-000000162a92', 'p162-a', '00162004');
-- C3 de R1: su factura elegida a mano es F9, que después se ANULÓ: no cuenta (ni con factura, ni venta)
insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                     factura_pos, cupon_id, fecha_visita, origen)
values ('00000000-0000-4000-8000-000000162a93', 'p162-a', '00000000-0000-4000-8000-000000162b01', 'tarjeta', 3, 6, 18000,
        '00162009', '00000000-0000-4000-8000-000000162c03', '2001-03-08 20:00-06', 'app');
insert into public.club_cruces_manuales (movimiento_id, location_id, numero_factura)
values ('00000000-0000-4000-8000-000000162a93', 'p162-a', '00162009');
-- Q2 del concierge: la factura elegida a mano (F6) sigue en R
insert into public.club_cupones (id, location_id, referente_id, estado, creado_en, vence_en, usado_en, factura_pos, personas)
values ('00000000-0000-4000-8000-000000162a94', 'p162-a', '00000000-0000-4000-8000-000000162b03', 'usado',
        '2001-03-17 12:00-06', '2001-03-24 12:00-06', '2001-03-18 20:00-06', '99998', 1);
insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                     factura_pos, cupon_id, fecha_visita, origen)
values ('00000000-0000-4000-8000-000000162a95', 'p162-a', '00000000-0000-4000-8000-000000162b03', 'tarjeta', 1, 6, 18000,
        '99998', '00000000-0000-4000-8000-000000162a94', '2001-03-18 20:00-06', 'app');
insert into public.club_cruces_manuales (movimiento_id, location_id, numero_factura)
values ('00000000-0000-4000-8000-000000162a95', 'p162-a', '00162006');
-- M1 de R5: por pedido (cruce automático: principal FP + dividida FD de la misma mesa)
insert into public.club_cupones (id, location_id, referente_id, estado, creado_en, vence_en, usado_en, personas, pos_ref)
values ('00000000-0000-4000-8000-000000162a96', 'p162-a', '00000000-0000-4000-8000-000000162b09', 'usado',
        '2001-03-19 12:00-06', '2001-03-26 12:00-06', '2001-03-20 20:00-06', 2,
        jsonb_build_object('modo', 'pedido', 'pedido', '162', 'hora', '2001-03-20 20:00-06', 'abierto_en', '2001-03-20 19:00-06',
                           'mesa', '7', 'area', 'SALON'));
-- contacto del turista de C1 (no tiene que salir)
insert into public.club_cupones_contactos (cupon_id, nombre, whatsapp, optin)
values ('00000000-0000-4000-8000-000000162c01', 'Turista Prueba', '+50600001620', true);
-- 158: clic de reseña en C1, C2 y en el cupón de febrero (si la columna existe)
do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.club_cupones'::regclass and attname = 'resena_clic_en' and not attisdropped) then
    execute $q$update public.club_cupones set resena_clic_en = usado_en + interval '1 hour'
                where id in ('00000000-0000-4000-8000-000000162c01', '00000000-0000-4000-8000-000000162c02',
                             '00000000-0000-4000-8000-000000162c0e')$q$;
  end if;
end $$;

-- ── Llamar como un usuario (JWT simulado). Devuelve el JSON o «ERR:<sqlstate>» ───────────────────────────────────────
-- Regla 4: la llamada va con el rol authenticated (no como superusuario) y el JWT simulado.
create or replace function pg_temp.em(p_uid uuid, p_mes date, p_loc text, p_exp boolean default false, p_ap uuid default null)
returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin r := public.club_embudo_anfitrion(p_mes, p_loc, p_exp, p_ap); exception when others then r := to_jsonb('ERR:' || sqlstate); end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create or replace function pg_temp.fila(r jsonb, p_nombre text) returns jsonb language sql as $f$
  select s from jsonb_array_elements(r->'anfitriones') s where s->>'nombre' = p_nombre
$f$;

create temp table _o162 on commit drop as
select pg_temp.em('00000000-0000-4000-8000-000000162a01', date '2001-03-15', 'p162-a') as e_owner,
       pg_temp.em('00000000-0000-4000-8000-000000162a02', date '2001-03-01', 'p162-a') as e_manager,
       pg_temp.em('00000000-0000-4000-8000-000000162a03', date '2001-03-01', 'p162-a') as e_contador,
       pg_temp.em('00000000-0000-4000-8000-000000162a04', date '2001-03-01', 'p162-a') as e_cajero,
       pg_temp.em('00000000-0000-4000-8000-000000162a05', date '2001-03-01', 'p162-a') as e_salonero,
       pg_temp.em('00000000-0000-4000-8000-000000162a06', date '2001-03-01', 'p162-a') as e_inactivo,
       pg_temp.em(null,                                   date '2001-03-01', 'p162-a') as e_sin_sesion,
       pg_temp.em('00000000-0000-4000-8000-000000162a07', date '2001-03-01', 'p162-a') as e_manager_otro,
       pg_temp.em('00000000-0000-4000-8000-000000162a07', date '2001-03-01', null)     as e_manager_otro_todos,
       pg_temp.em('00000000-0000-4000-8000-000000162a01', date '2001-03-01', null)     as e_todos,
       pg_temp.em('00000000-0000-4000-8000-000000162a01', date '2001-03-01', 'p162-c') as e_vacio,
       pg_temp.em('00000000-0000-4000-8000-000000162a01', null,              'p162-a') as e_sin_mes,
       pg_temp.em('00000000-0000-4000-8000-000000162a02', date '2001-03-01', 'p162-a', true) as e_exporte;

-- 0. catálogo
insert into _r162 (caso, ok, detalle)
select '0 catálogo: definer · search_path fijo · anon sin EXECUTE · authenticated con EXECUTE',
       p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
       and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       coalesce(p.proacl::text, 'sin acl')
  from pg_proc p where p.oid = 'public.club_embudo_anfitrion(date, text, boolean, uuid)'::regprocedure;

-- 1. permisos: solo owner y manager de su local
insert into _r162 (caso, ok, detalle) select '1a owner entra', jsonb_typeof(e_owner) = 'object', left(e_owner::text, 80) from _o162;
insert into _r162 (caso, ok, detalle) select '1b manager de su local entra', jsonb_typeof(e_manager) = 'object', left(e_manager::text, 80) from _o162;
insert into _r162 (caso, ok, detalle) select '1c contador → 42501 (hay nombres)', e_contador = to_jsonb('ERR:42501'::text), e_contador::text from _o162;
insert into _r162 (caso, ok, detalle) select '1d cajero → 42501', e_cajero = to_jsonb('ERR:42501'::text), e_cajero::text from _o162;
insert into _r162 (caso, ok, detalle) select '1e salonero → 42501', e_salonero = to_jsonb('ERR:42501'::text), e_salonero::text from _o162;
insert into _r162 (caso, ok, detalle) select '1f owner inactivo → 42501', e_inactivo = to_jsonb('ERR:42501'::text), e_inactivo::text from _o162;
insert into _r162 (caso, ok, detalle) select '1g sin sesión → 42501', e_sin_sesion = to_jsonb('ERR:42501'::text), e_sin_sesion::text from _o162;
insert into _r162 (caso, ok, detalle) select '1h manager de OTRO local → 42501', e_manager_otro = to_jsonb('ERR:42501'::text), e_manager_otro::text from _o162;
insert into _r162 (caso, ok, detalle)
select '1i «todos» del manager de otro local: solo p162-b, sin los anfitriones de p162-a',
       e_manager_otro_todos->'locales' = '["p162-b"]'::jsonb
       and pg_temp.fila(e_manager_otro_todos, 'Prueba Referente Uno') is null
       and pg_temp.fila(e_manager_otro_todos, 'Prueba Referente Otro Local') is not null,
       left(e_manager_otro_todos::text, 160) from _o162;
do $$
declare v_ok boolean := false; v_msg text := '';
begin
  set local role anon;
  begin perform public.club_embudo_anfitrion(date '2001-03-01', 'p162-a', false);
  exception when insufficient_privilege then v_ok := sqlerrm like 'permission denied for function%'; v_msg := sqlerrm;
  end;
  reset role;
  insert into _r162 (caso, ok, detalle) values ('1j anon → permission denied', v_ok, v_msg);
end $$;
reset role;
insert into _r162 (caso, ok, detalle) select '1k sin mes → P0001', e_sin_mes = to_jsonb('ERR:P0001'::text), e_sin_mes::text from _o162;

-- 2. embudo por anfitrión (p162-a, marzo 2001; el día 15 cuenta como el mes)
insert into _r162 (caso, ok, detalle)
select '2a R1: 6 generados (C6 de las 23:30 CR es de marzo; el de febrero no), 4 usados, 1 vencido, 1 anulado, 0 vigentes',
       (s->>'generados')::int = 6 and (s->>'usados')::int = 4 and (s->>'vencidos')::int = 1 and (s->>'anulados')::int = 1
       and (s->>'vigentes')::int = 0 and e_owner->>'mes' = '2001-03', s::text
  from (select e_owner, pg_temp.fila(e_owner, 'Prueba Referente Uno') as s from _o162) x;
insert into _r162 (caso, ok, detalle)
select '2b R1: 3 con factura (la anulada no), 11 personas, 3 facturas, 3 mesas',
       (s->>'con_factura')::int = 3 and (s->>'personas')::int = 11 and (s->>'facturas')::int = 3 and (s->>'mesas')::int = 3, s::text
  from (select pg_temp.fila(e_owner, 'Prueba Referente Uno') as s from _o162) x;
insert into _r162 (caso, ok, detalle)
select '2c R1: venta COBRADA ₡17.000 (F1 10.000 − 1.000; F2 8.000; F3 6.000 − 7.000 → 0), neta ₡24.000 (sin fam. 17), tiquete ₡5.667',
       (s->>'venta_respaldada_crc')::numeric = 17000 and (s->>'venta_neta_crc')::numeric = 24000
       and (s->>'tiquete_promedio_crc')::numeric = 5667, s::text
  from (select pg_temp.fila(e_owner, 'Prueba Referente Uno') as s from _o162) x;
insert into _r162 (caso, ok, detalle)
select '2d R1: % uso 66,7 · % con factura 75,0 · 2,8 personas por cupón · tipo referente, grupo anfitrion',
       (s->>'pct_uso')::numeric = 66.7 and (s->>'pct_con_factura')::numeric = 75.0 and (s->>'personas_por_cupon')::numeric = 2.8
       and s->>'tipo' = 'referente' and s->>'grupo' = 'anfitrion', s::text
  from (select pg_temp.fila(e_owner, 'Prueba Referente Uno') as s from _o162) x;
insert into _r162 (caso, ok, detalle)
select '2e E1 (equipo): grupo equipo, 3 generados, 2 usados (D1 y D3 en la MISMA F2), 1 vigente, 4 personas, 1 factura, 1 mesa, ₡8.000 (una vez), tiquete ₡8.000',
       s->>'grupo' = 'equipo' and s->>'tipo' = 'equipo' and (s->>'generados')::int = 3 and (s->>'usados')::int = 2
       and (s->>'con_factura')::int = 2 and (s->>'facturas')::int = 1 and (s->>'mesas')::int = 1
       and (s->>'vigentes')::int = 1 and (s->>'personas')::int = 4 and (s->>'venta_respaldada_crc')::numeric = 8000
       and (s->>'tiquete_promedio_crc')::numeric = 8000 and (s->>'pct_uso')::numeric = 66.7, coalesce(s::text, 'no está')
  from (select pg_temp.fila(e_owner, 'Prueba Equipo Uno') as s from _o162) x;
insert into _r162 (caso, ok, detalle)
select '2f K1 (concierge): la factura elegida a mano cuenta (F4, ₡5.000, regalía null = 0); la elegida a mano en R (F6) no: 2 usados, 1 con factura, 50 %',
       (s->>'usados')::int = 2 and (s->>'con_factura')::int = 1 and (s->>'facturas')::int = 1
       and (s->>'venta_respaldada_crc')::numeric = 5000 and (s->>'personas')::int = 3
       and (s->>'pct_con_factura')::numeric = 50.0 and s->>'tipo' = 'concierge_pm', coalesce(s::text, 'no está')
  from (select pg_temp.fila(e_owner, 'Prueba Concierge') as s from _o162) x;
insert into _r162 (caso, ok, detalle)
select '2g sin cupones en el mes no salen con nombre (R2, E2, baja, socio); el equipo va primero',
       jsonb_array_length(e_owner->'anfitriones') = 4 and e_owner->'anfitriones'->0->>'nombre' = 'Prueba Equipo Uno'
       and pg_temp.fila(e_owner, 'Prueba Referente Dos') is null and pg_temp.fila(e_owner, 'Prueba Socio') is null,
       (e_owner->'anfitriones')::text from _o162;

insert into _r162 (caso, ok, detalle)
select '2h R5: mesa dividida (FP principal + FD dividida): 2 facturas, 1 mesa, ₡10.000, tiquete ₡10.000 (no ₡5.000)',
       (s->>'facturas')::int = 2 and (s->>'mesas')::int = 1 and (s->>'con_factura')::int = 1
       and (s->>'venta_respaldada_crc')::numeric = 10000 and (s->>'tiquete_promedio_crc')::numeric = 10000, coalesce(s::text, 'no está')
  from (select pg_temp.fila(e_owner, 'Prueba Referente Mesa') as s from _o162) x;

-- 3. totales y grupos: cada factura UNA vez
insert into _r162 (caso, ok, detalle)
select '3a totales: 12 generados, 9 usados, 7 con factura, 20 personas, 6 facturas (F2 compartida una vez; F6 en R no), 5 mesas (FP+FD una), ₡32.000 cobrada, ₡39.000 neta',
       (t->>'generados')::int = 12 and (t->>'usados')::int = 9 and (t->>'con_factura')::int = 7 and (t->>'personas')::int = 20
       and (t->>'facturas')::int = 6 and (t->>'mesas')::int = 5 and (t->>'venta_respaldada_crc')::numeric = 32000
       and (t->>'venta_neta_crc')::numeric = 39000 and (t->>'vigentes')::int = 1 and (t->>'vencidos')::int = 1
       and (t->>'anulados')::int = 1 and (t->>'anfitriones')::int = 4, t::text
  from (select e_owner->'totales' as t from _o162) x;
insert into _r162 (caso, ok, detalle)
select '3b sin cupones: 2 (R2 y E2; ni la baja, ni el socio, ni el de otro local), uno por grupo',
       (e_owner->'totales'->>'sin_cupones')::int = 2 and (e_owner->'grupos'->'equipo'->>'sin_cupones')::int = 1
       and (e_owner->'grupos'->'anfitrion'->>'sin_cupones')::int = 1, (e_owner->'grupos')::text from _o162;
insert into _r162 (caso, ok, detalle)
select '3c grupo equipo: 1 anfitrión, 3 generados, 1 factura, 1 mesa, ₡8.000 · grupo anfitrion: 3, 9 generados, 6 facturas, 5 mesas, ₡32.000',
       (g->'equipo'->>'anfitriones')::int = 1 and (g->'equipo'->>'generados')::int = 3 and (g->'equipo'->>'facturas')::int = 1
       and (g->'equipo'->>'mesas')::int = 1 and (g->'equipo'->>'venta_respaldada_crc')::numeric = 8000
       and (g->'anfitrion'->>'anfitriones')::int = 3 and (g->'anfitrion'->>'generados')::int = 9
       and (g->'anfitrion'->>'facturas')::int = 6 and (g->'anfitrion'->>'mesas')::int = 5
       and (g->'anfitrion'->>'venta_respaldada_crc')::numeric = 32000, g::text
  from (select e_owner->'grupos' as g from _o162) x;
insert into _r162 (caso, ok, detalle)
select '3d el manager ve lo mismo que el owner',
       case when jsonb_typeof(e_manager) = 'object' and jsonb_typeof(e_owner) = 'object'
            then (e_manager - 'generado_en') = (e_owner - 'generado_en') else false end, null from _o162;

-- 4. privacidad
insert into _r162 (caso, ok, detalle)
select '4 sin teléfonos, correos, códigos, tokens ni contacto del turista',
       e_owner::text !~ '(@|50600000162|50600001620|Turista|token|codigo)'
       and not exists (select 1 from public.club_miembros m where m.id::text like '00000000-0000-4000-8000-000000162b%'
                        and (strpos(e_owner::text, m.codigo) > 0 or strpos(e_owner::text, m.token_portal) > 0))
       and not exists (select 1 from public.club_cupones c where c.location_id like 'p162-%' and strpos(e_owner::text, c.codigo) > 0),
       null from _o162;

-- 5. cero datos y locales sin PoS
insert into _r162 (caso, ok, detalle)
select '5a local vacío: anfitriones [], totales en cero, % null, aviso de local sin PoS',
       e_vacio->'anfitriones' = '[]'::jsonb and (e_vacio->'totales'->>'generados')::int = 0
       and (e_vacio->'totales'->>'venta_respaldada_crc')::numeric = 0 and (e_vacio->'totales'->>'sin_cupones')::int = 0
       and (e_vacio->'grupos'->'equipo'->>'anfitriones')::int = 0
       and e_vacio->'locales_sin_pos' = '["Local P162 C"]'::jsonb, e_vacio::text from _o162;
insert into _r162 (caso, ok, detalle)
select '5b p162-a tiene PoS (sin aviso); «todos» avisa p162-b y p162-c y suma el cupón de p162-b (13 generados)',
       e_owner->'locales_sin_pos' = '[]'::jsonb
       and e_todos->'locales_sin_pos' @> '["Local P162 B","Local P162 C"]'::jsonb
       and not e_todos->'locales_sin_pos' @> '["Local P162 A"]'::jsonb
       and (e_todos->'totales'->>'generados')::int = 13
       and (pg_temp.fila(e_todos, 'Prueba Referente Otro Local')->>'venta_respaldada_crc')::numeric = 0,
       (e_todos->'totales')::text from _o162;
insert into _r162 (caso, ok, detalle)
select '5c mes pasado: mes_en_curso false', e_owner->'mes_en_curso' = 'false'::jsonb, null from _o162;

-- 6. rastro en club_auditoria (sin datos)
insert into _r162 (caso, ok, detalle)
select '6a abrir el embudo deja «ver_embudo_anfitrion» con mes, local y filas',
       exists (select 1 from public.club_auditoria a where a.accion = 'ver_embudo_anfitrion' and a.actor = '00000000-0000-4000-8000-000000162a01'
                and a.despues = '{"mes":"2001-03","local":"p162-a","filas":4}'::jsonb), null;
insert into _r162 (caso, ok, detalle)
select '6b exportar deja «exporte_embudo_anfitrion_csv» (y no otro «ver») del manager',
       exists (select 1 from public.club_auditoria a where a.accion = 'exporte_embudo_anfitrion_csv' and a.actor = '00000000-0000-4000-8000-000000162a02')
       and (select count(*) from public.club_auditoria a where a.accion = 'ver_embudo_anfitrion' and a.actor = '00000000-0000-4000-8000-000000162a02') = 1,
       null;
insert into _r162 (caso, ok, detalle)
select '6c el contador rechazado no deja rastro',
       not exists (select 1 from public.club_auditoria a where a.accion like '%embudo%' and a.actor = '00000000-0000-4000-8000-000000162a03'),
       null;

-- 6d–6f. una fila por APERTURA de la pantalla (12 h); el exporte, siempre; la interna no se llama desde afuera
create temp table _a162 on commit drop as
select pg_temp.em('00000000-0000-4000-8000-000000162a01', date '2001-03-01', 'p162-a', false, '00000000-0000-4000-8000-0000001620a1') as x1,
       pg_temp.em('00000000-0000-4000-8000-000000162a01', date '2001-04-01', 'p162-a', false, '00000000-0000-4000-8000-0000001620a1') as x2,
       pg_temp.em('00000000-0000-4000-8000-000000162a01', date '2001-05-01', null,     false, '00000000-0000-4000-8000-0000001620a1') as x3,
       pg_temp.em('00000000-0000-4000-8000-000000162a01', date '2001-03-01', 'p162-a', false, '00000000-0000-4000-8000-0000001620a2') as x4,
       pg_temp.em('00000000-0000-4000-8000-000000162a02', date '2001-03-01', 'p162-a', false, '00000000-0000-4000-8000-0000001620a1') as x5,
       pg_temp.em('00000000-0000-4000-8000-000000162a01', date '2001-03-01', 'p162-a', true,  '00000000-0000-4000-8000-0000001620a1') as x6,
       pg_temp.em('00000000-0000-4000-8000-000000162a01', date '2001-03-01', 'p162-a', true,  '00000000-0000-4000-8000-0000001620a1') as x7;
insert into _r162 (caso, ok, detalle)
select '6d tres filtros con la MISMA apertura → una fila (la del primero); otra apertura → otra; otro usuario con el mismo id → la suya',
       (select count(*) from public.club_auditoria a where a.accion = 'ver_embudo_anfitrion'
         and a.objeto_id = '00000000-0000-4000-8000-0000001620a1' and a.actor = '00000000-0000-4000-8000-000000162a01') = 1
       and exists (select 1 from public.club_auditoria a where a.accion = 'ver_embudo_anfitrion'
         and a.objeto_id = '00000000-0000-4000-8000-0000001620a1' and a.actor = '00000000-0000-4000-8000-000000162a01'
         and a.despues->>'mes' = '2001-03')
       and (select count(*) from public.club_auditoria a where a.accion = 'ver_embudo_anfitrion'
         and a.objeto_id = '00000000-0000-4000-8000-0000001620a2') = 1
       and (select count(*) from public.club_auditoria a where a.accion = 'ver_embudo_anfitrion'
         and a.objeto_id = '00000000-0000-4000-8000-0000001620a1' and a.actor = '00000000-0000-4000-8000-000000162a02') = 1
       and jsonb_typeof(x2) = 'object' and jsonb_typeof(x3) = 'object',
       (select string_agg(a.actor::text || ':' || coalesce(a.objeto_id::text, '-'), ' ') from public.club_auditoria a
         where a.accion = 'ver_embudo_anfitrion' and a.objeto_id is not null) from _a162;
insert into _r162 (caso, ok, detalle)
select '6e el exporte deja fila SIEMPRE (dos exportes con la misma apertura → dos filas)',
       (select count(*) from public.club_auditoria a where a.accion = 'exporte_embudo_anfitrion_csv'
         and a.objeto_id = '00000000-0000-4000-8000-0000001620a1' and a.actor = '00000000-0000-4000-8000-000000162a01') = 2, null;
insert into _r162 (caso, ok, detalle)
select '6f club_embudo_auditar_lectura es interna (ni authenticated ni anon la ejecutan)',
       not has_function_privilege('authenticated', 'public.club_embudo_auditar_lectura(text, text, uuid, jsonb)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_embudo_auditar_lectura(text, text, uuid, jsonb)', 'EXECUTE')
       and p.prosecdef and p.proconfig = array['search_path=public, pg_temp'], coalesce(p.proacl::text, 'sin acl')
  from pg_proc p where p.oid = 'public.club_embudo_auditar_lectura(text, text, uuid, jsonb)'::regprocedure;

-- 8. con y sin la 158 (clic de reseña) y la 157 (D7): cada base exige lo suyo
insert into _r162 (caso, ok, detalle)
select '8a clic de reseña: con la 158, R1 2 clics (el de febrero no), 50 %, total 2; sin la 158, disponible false y null',
       case when exists (select 1 from pg_attribute where attrelid = 'public.club_cupones'::regclass and attname = 'resena_clic_en' and not attisdropped)
            then e_owner->'resena_disponible' = 'true'::jsonb
                 and (pg_temp.fila(e_owner, 'Prueba Referente Uno')->>'clics_resena')::int = 2
                 and (pg_temp.fila(e_owner, 'Prueba Referente Uno')->>'pct_resena')::numeric = 50.0
                 and (pg_temp.fila(e_owner, 'Prueba Equipo Uno')->>'clics_resena')::int = 0
                 and (e_owner->'totales'->>'clics_resena')::int = 2
            else e_owner->'resena_disponible' = 'false'::jsonb
                 and pg_temp.fila(e_owner, 'Prueba Referente Uno')->'clics_resena' = 'null'::jsonb
                 and pg_temp.fila(e_owner, 'Prueba Referente Uno')->'pct_resena' = 'null'::jsonb
                 and e_owner->'totales'->'clics_resena' = 'null'::jsonb end,
       'resena_disponible=' || coalesce(e_owner->>'resena_disponible', '?') from _o162;
insert into _r162 (caso, ok, detalle)
select '8b d7 dice si la 157 está; el grupo del equipo sale igual con y sin ella',
       e_owner->'d7' = to_jsonb(to_regprocedure('public.club_saldo_canjeable(uuid)') is not null)
       and pg_temp.fila(e_owner, 'Prueba Equipo Uno')->>'grupo' = 'equipo',
       'd7=' || coalesce(e_owner->>'d7', '?') from _o162;

-- 7. vuelta atrás (dentro de esta misma transacción descartada)
-- @@162R@@   (aquí va el cuerpo de scripts/sql/162_rollback.sql sin begin/commit)
insert into _r162 (caso, ok, detalle)
select '7 rollback: sin las funciones de la 162; club_reporte_mes y club_config siguen',
       to_regprocedure('public.club_embudo_anfitrion(date, text, boolean, uuid)') is null
       and to_regprocedure('public.club_embudo_auditar_lectura(text, text, uuid, jsonb)') is null
       and to_regprocedure('public.club_reporte_mes(date, text, boolean)') is not null
       and (select count(*) from public.club_config where location_id like 'p162-%') = 3, null;

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r162;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r162 where not ok;
  if v is not null then raise exception '162-FALLAN: %', v; end if;
  if (select count(*) from _r162) < 37 then raise exception '162-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
