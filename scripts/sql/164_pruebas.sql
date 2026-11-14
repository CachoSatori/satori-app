-- 164_pruebas (origen 110) · Club → alertas con umbral del Inicio («Para revisar hoy»). Aplica la 164 dentro de una
-- transacción, arma datos ficticios, prueba, aplica el rollback y termina en ROLLBACK: no deja nada. Al final un ASSERT:
-- si algún caso falla, aborta con «164-FALLAN: <casos>». Se corre con scripts/sql/164_pruebas.py (--local: Postgres 16
-- local; --armar: SQL para staging, ref hwiatgic…, nunca prod).
-- Corre igual con y sin la 157 (equipo sin créditos): el equipo sigue registrando tarjetas y entra en (a) y (b).
--
-- MARCADORES que llena el runner: «-- @@164@@» → cuerpo de la 164 sin begin;/commit; (con --mutar, con el arreglo deshecho
-- a propósito) y «-- @@164R@@» → cuerpo de scripts/sql/164_rollback.sql.
--
-- Todo es ficticio y propio de la prueba: locales p164-a (Club encendido, PoS), p164-b (encendido, otro manager),
-- p164-c (APAGADO, con datos que pasarían el umbral), p164-d (encendido, vacío: cero datos). Un usuario por rol, más un
-- owner inactivo y un manager de p164-b. Las fechas son relativas a now() (la función mira «ayer y hoy» hora CR).
-- Umbrales de fábrica: (a) > 5 en 24 h · (b) > 2 en 3 días · (c) > 0 · (d) > 0.
--
-- (a) p164-a, registrado_por null (para no tocar (b)):
--   A1 referente   6 tarjetas en las últimas 3 h                     → AVISO (6)
--   A2 referente   5 tarjetas                                        → no (justo en el umbral)
--   A3 referente   6 tarjetas de la CARGA INICIAL (origen migracion) → no
--   A4 referente   5 tarjetas + 1 persona pendiente (sin movimiento) → AVISO (6)
--   A5 referente   3 tarjetas hace 1 h + 3 hace 26 h                 → no (en 24 h, máximo 3)
--   A6 EQUIPO      6 tarjetas                                        → AVISO (el equipo entra)
--   A9 referente   5 tarjetas + 1 pendiente APROBADA (ya es una de las 5) → no (no se cuenta dos veces)
--   A10 referente  6 tarjetas 30 min ANTES del inicio de ayer (hora CR) → no (fuera de la ventana; en UTC entraría)
--   A8 referente de p164-b con 6 tarjetas                            → no sale en p164-a
-- (b) p164-a:
--   S1 socio   3 visitas por el cajero en 40 h                       → AVISO (3)
--   S2 socio   3 visitas por 3 usuarios distintos                    → no
--   S3 socio   4 visitas del cajero: hace 1 h y hace 80/90/95 h      → no (en 3 días, máximo 1 dentro de la ventana)
--   E1 equipo  3 tarjetas cargadas por el cajero                     → AVISO (equipo)
--   R1 referente 3 tarjetas cargadas por el cajero                   → no (solo socios y equipo)
-- (c) p164-a: V1 visita sin factura hace 2 h → 1 · V4 sin factura hace 5 min (latencia del puente) y V3 hace 3 días → no
--     cuentan · las demás visitas con la factura C 00164001.
-- (d) p164-a: CS1 canje sin código abierto · CS2 resuelto · CS3 hace 40 días · CN canje con código → 1.
begin;
-- @@164@@   (aquí va el cuerpo de la 164 sin begin/commit)
create temp table _r164 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r164 to public;
grant all on sequence _r164_n_seq to public;

-- ── Usuarios ───────────────────────────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000164a01', 'p164-owner@ejemplo.test'),
  ('00000000-0000-4000-8000-000000164a02', 'p164-manager@ejemplo.test'),
  ('00000000-0000-4000-8000-000000164a03', 'p164-contador@ejemplo.test'),
  ('00000000-0000-4000-8000-000000164a04', 'p164-cajero@ejemplo.test'),
  ('00000000-0000-4000-8000-000000164a05', 'p164-salonero@ejemplo.test'),
  ('00000000-0000-4000-8000-000000164a06', 'p164-owner-inactivo@ejemplo.test'),
  ('00000000-0000-4000-8000-000000164a07', 'p164-manager-otro@ejemplo.test'),
  ('00000000-0000-4000-8000-000000164a08', 'p164-cajero-dos@ejemplo.test'),
  ('00000000-0000-4000-8000-000000164a09', 'p164-cajero-tres@ejemplo.test');
insert into public.profiles (id, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000164a01', 'Prueba Owner', 'owner', true),
  ('00000000-0000-4000-8000-000000164a02', 'Prueba Manager', 'manager', true),
  ('00000000-0000-4000-8000-000000164a03', 'Prueba Contador', 'contador', true),
  ('00000000-0000-4000-8000-000000164a04', 'Prueba Cajero', 'cajero', true),
  ('00000000-0000-4000-8000-000000164a05', 'Prueba Salonero', 'salonero', true),
  ('00000000-0000-4000-8000-000000164a06', 'Prueba Owner Inactivo', 'owner', false),
  ('00000000-0000-4000-8000-000000164a07', 'Prueba Manager Otro', 'manager', true),
  ('00000000-0000-4000-8000-000000164a08', 'Prueba Cajero Dos', 'cajero', true),
  ('00000000-0000-4000-8000-000000164a09', 'Prueba Cajero Tres', 'cajero', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active, full_name = excluded.full_name;

-- ── Locales ────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.locations (id, name) values ('p164-a', 'Local P164 A'), ('p164-b', 'Local P164 B'), ('p164-c', 'Local P164 C'),
                                               ('p164-d', 'Local P164 D')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('p164-a', 'Local P164 A', true), ('p164-b', 'Local P164 B', true), ('p164-c', 'Local P164 C', false), ('p164-d', 'Local P164 D', true);
insert into public.profile_locations (profile_id, location_id, principal) values
  ('00000000-0000-4000-8000-000000164a02', 'p164-a', true),
  ('00000000-0000-4000-8000-000000164a04', 'p164-a', true),
  ('00000000-0000-4000-8000-000000164a04', 'p164-c', false),
  ('00000000-0000-4000-8000-000000164a05', 'p164-a', true),
  ('00000000-0000-4000-8000-000000164a07', 'p164-b', true);

-- ── Miembros (el trigger crea su rol) ──────────────────────────────────────────────────────────────────────────────
insert into public.club_miembros (id, location_id, tipo, nombre, estado) values
  ('00000000-0000-4000-8000-000000164b01', 'p164-a', 'referente', 'Prueba Anfitrion Uno', 'activo'),
  ('00000000-0000-4000-8000-000000164b02', 'p164-a', 'referente', 'Prueba Anfitrion Dos', 'activo'),
  ('00000000-0000-4000-8000-000000164b03', 'p164-a', 'referente', 'Prueba Anfitrion Tres', 'activo'),
  ('00000000-0000-4000-8000-000000164b04', 'p164-a', 'referente', 'Prueba Anfitrion Cuatro', 'activo'),
  ('00000000-0000-4000-8000-000000164b05', 'p164-a', 'referente', 'Prueba Anfitrion Cinco', 'activo'),
  ('00000000-0000-4000-8000-000000164b06', 'p164-a', 'equipo',    'Prueba Equipo Seis', 'activo'),
  ('00000000-0000-4000-8000-000000164b08', 'p164-b', 'referente', 'Prueba Anfitrion Otro Local', 'activo'),
  ('00000000-0000-4000-8000-000000164b09', 'p164-a', 'referente', 'Prueba Anfitrion Nueve', 'activo'),
  ('00000000-0000-4000-8000-000000164b10', 'p164-a', 'referente', 'Prueba Anfitrion Diez', 'activo'),
  ('00000000-0000-4000-8000-000000164b11', 'p164-a', 'equipo',    'Prueba Equipo Once', 'activo'),
  ('00000000-0000-4000-8000-000000164b12', 'p164-a', 'referente', 'Prueba Anfitrion Doce', 'activo'),
  ('00000000-0000-4000-8000-000000164b13', 'p164-c', 'referente', 'Prueba Anfitrion Apagado', 'activo'),
  ('00000000-0000-4000-8000-000000164c01', 'p164-a', 'socio', 'Prueba Socio Uno', 'activo'),
  ('00000000-0000-4000-8000-000000164c02', 'p164-a', 'socio', 'Prueba Socio Dos', 'activo'),
  ('00000000-0000-4000-8000-000000164c03', 'p164-a', 'socio', 'Prueba Socio Tres', 'activo'),
  ('00000000-0000-4000-8000-000000164c04', 'p164-a', 'socio', 'Prueba Socio Cuatro', 'activo');

-- inicio de AYER hora CR (la ventana de revisión)
create temp table _k164 on commit drop as
select (((now() at time zone 'America/Costa_Rica')::date - 1)::timestamp at time zone 'America/Costa_Rica') as ini;

-- ── (a) tarjetas ───────────────────────────────────────────────────────────────────────────────────────────────────
-- (miembro, local, cuántas, desplazamiento base, origen, registrado_por)
insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                     fecha_visita, registrado_en, origen, registrado_por, nota)
select gen_random_uuid(), x.loc, x.mid::uuid, 'tarjeta', 2, 6, 18000, x.f, x.f, x.origen, x.reg::uuid, 'prueba 164'
  from (
    select 'p164-a' as loc, '00000000-0000-4000-8000-000000164b01' as mid, now() - make_interval(mins => 20 * g) as f, 'app' as origen, null as reg from generate_series(1, 6) g
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b02', now() - make_interval(mins => 20 * g), 'app', null from generate_series(1, 5) g
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b03', now() - make_interval(mins => 20 * g), 'migracion', null from generate_series(1, 6) g
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b04', now() - make_interval(mins => 20 * g), 'app', null from generate_series(1, 5) g
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b05', now() - interval '1 hour' - make_interval(mins => g), 'app', null from generate_series(1, 3) g
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b05', now() - interval '26 hours' - make_interval(mins => g), 'app', null from generate_series(1, 3) g
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b06', now() - make_interval(mins => 20 * g), 'app', null from generate_series(1, 6) g
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b09', now() - make_interval(mins => 20 * g), 'app', null from generate_series(1, 4) g
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b10', (select ini from _k164) - interval '30 minutes' - make_interval(mins => g), 'app', null from generate_series(1, 6) g
    union all select 'p164-b', '00000000-0000-4000-8000-000000164b08', now() - make_interval(mins => 20 * g), 'app', null from generate_series(1, 6) g
    union all select 'p164-c', '00000000-0000-4000-8000-000000164b13', now() - make_interval(mins => 20 * g), 'app', null from generate_series(1, 6) g
    -- (b) equipo y referente cargados por el cajero
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b11', now() - make_interval(hours => g), 'app', '00000000-0000-4000-8000-000000164a04' from generate_series(1, 3) g
    union all select 'p164-a', '00000000-0000-4000-8000-000000164b12', now() - make_interval(hours => g), 'app', '00000000-0000-4000-8000-000000164a04' from generate_series(1, 3) g
  ) x;
-- A9: la 5.ª tarjeta viene de una persona pendiente APROBADA (movimiento_id puesto)
insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                     fecha_visita, registrado_en, origen, nota)
values ('00000000-0000-4000-8000-000000164e09', 'p164-a', '00000000-0000-4000-8000-000000164b09', 'tarjeta', 2, 6, 18000,
        now() - interval '2 hours', now() - interval '2 hours', 'app', 'prueba 164 aprobada');
insert into public.club_personas_pendientes (location_id, miembro_id, personas, personas_por_credito, valor_credito_crc,
                                             fecha_visita, client_op_id, ganado_mes_crc, estado, movimiento_id)
values ('p164-a', '00000000-0000-4000-8000-000000164b09', 2, 6, 18000, now() - interval '2 hours', gen_random_uuid(), 0,
        'aprobada', '00000000-0000-4000-8000-000000164e09'),
-- A4: una persona pendiente (todavía no es movimiento)
       ('p164-a', '00000000-0000-4000-8000-000000164b04', 2, 6, 18000, now() - interval '10 minutes', gen_random_uuid(), 0,
        'pendiente', null);

-- ── (b)/(c) visitas de socio ───────────────────────────────────────────────────────────────────────────────────────
insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, fecha_cierra, estado, canal, registrado_por,
                                    con_servicio, pax, pax_alerta, total_crc)
values ('00000000-0000-4000-8000-000000164d01', 'p164-a', '00164001', now() - interval '3 hours', now() - interval '3 hours',
        'C', 'salon', 'salonero', true, 2, 'ok', 0);
insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, registrado_por, client_op_id, pos_ref,
                                       estado_beneficio, aplicar)
select 'p164-a', x.mid::uuid, (x.f at time zone 'America/Costa_Rica')::date, x.f, x.reg::uuid, gen_random_uuid(),
       case when x.con_factura then '{"modo":"factura","numero_factura":"00164001"}'::jsonb end, 'aplica', '{}'::jsonb
  from (values
    ('00000000-0000-4000-8000-000000164c01', now() - interval '1 hour',   '00000000-0000-4000-8000-000000164a04', true),
    ('00000000-0000-4000-8000-000000164c01', now() - interval '20 hours', '00000000-0000-4000-8000-000000164a04', true),
    ('00000000-0000-4000-8000-000000164c01', now() - interval '40 hours', '00000000-0000-4000-8000-000000164a04', true),
    ('00000000-0000-4000-8000-000000164c02', now() - interval '1 hour',   '00000000-0000-4000-8000-000000164a04', true),
    ('00000000-0000-4000-8000-000000164c02', now() - interval '2 hours',  '00000000-0000-4000-8000-000000164a08', true),
    ('00000000-0000-4000-8000-000000164c02', now() - interval '3 hours',  '00000000-0000-4000-8000-000000164a09', true),
    ('00000000-0000-4000-8000-000000164c03', now() - interval '1 hour',   '00000000-0000-4000-8000-000000164a04', true),
    ('00000000-0000-4000-8000-000000164c03', now() - interval '80 hours', '00000000-0000-4000-8000-000000164a04', true),
    ('00000000-0000-4000-8000-000000164c03', now() - interval '90 hours', '00000000-0000-4000-8000-000000164a04', true),
    ('00000000-0000-4000-8000-000000164c03', now() - interval '95 hours', '00000000-0000-4000-8000-000000164a04', true),
    -- (c) V1 sin factura (cuenta) · V4 sin factura dentro de la latencia · V3 sin factura hace 3 días
    ('00000000-0000-4000-8000-000000164c04', now() - interval '2 hours',   '00000000-0000-4000-8000-000000164a08', false),
    ('00000000-0000-4000-8000-000000164c04', now() - interval '5 minutes', '00000000-0000-4000-8000-000000164a09', false),
    ('00000000-0000-4000-8000-000000164c04', now() - interval '72 hours',  '00000000-0000-4000-8000-000000164a08', false)
  ) x(mid, f, reg, con_factura);

-- ── (d) canjes ─────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc,
                                     factura_pos, fecha_visita, registrado_en, origen, registrado_por, nota)
values
  ('00000000-0000-4000-8000-000000164f01', 'p164-a', '00000000-0000-4000-8000-000000164b01', 'canje', -6, 1, 6, 18000, '00164001',
   now() - interval '2 days', now() - interval '2 days', 'app', '00000000-0000-4000-8000-000000164a02', 'Canje aprobado sin código: prueba uno'),
  ('00000000-0000-4000-8000-000000164f02', 'p164-a', '00000000-0000-4000-8000-000000164b02', 'canje', -6, 1, 6, 18000, '00164001',
   now() - interval '3 days', now() - interval '3 days', 'app', '00000000-0000-4000-8000-000000164a02', 'Canje aprobado sin código: prueba dos'),
  ('00000000-0000-4000-8000-000000164f03', 'p164-a', '00000000-0000-4000-8000-000000164b04', 'canje', -6, 1, 6, 18000, '00164001',
   now() - interval '40 days', now() - interval '40 days', 'app', '00000000-0000-4000-8000-000000164a02', 'Canje aprobado sin código: prueba tres'),
  ('00000000-0000-4000-8000-000000164f04', 'p164-a', '00000000-0000-4000-8000-000000164b06', 'canje', -6, 1, 6, 18000, '00164001',
   now() - interval '1 day', now() - interval '1 day', 'app', '00000000-0000-4000-8000-000000164a02', null);
insert into public.club_excepciones_resueltas (location_id, tipo, ref, nota, resuelto_por)
values ('p164-a', 'CANJE_SIN_CODIGO', '00000000-0000-4000-8000-000000164f02', 'prueba: revisado', '00000000-0000-4000-8000-000000164a01');

-- ── Lecturas por rol (JWT simulado; como authenticated, con sus grants) ─────────────────────────────────────────────
create temp table _o164 (quien text, loc text, tipo text, ref text, cantidad int, umbral int, detalle jsonb, err text) on commit drop;
grant all on _o164 to public;
create or replace function pg_temp.leer164(p_quien text, p_uid uuid, p_loc text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into _o164 (quien, loc, tipo, ref, cantidad, umbral, detalle)
    select p_quien, p_loc, a.tipo, a.ref, a.cantidad, a.umbral, a.detalle from public.club_alertas_inicio(p_loc) a;
    insert into _o164 (quien, loc, tipo) values (p_quien, p_loc, '_ok');
  exception when others then
    insert into _o164 (quien, loc, tipo, err) values (p_quien, p_loc, '_error', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $f$;
select pg_temp.leer164('owner',    '00000000-0000-4000-8000-000000164a01', 'p164-a');
select pg_temp.leer164('manager',  '00000000-0000-4000-8000-000000164a02', 'p164-a');
select pg_temp.leer164('contador', '00000000-0000-4000-8000-000000164a03', 'p164-a');
select pg_temp.leer164('cajero',   '00000000-0000-4000-8000-000000164a04', 'p164-a');
select pg_temp.leer164('salonero', '00000000-0000-4000-8000-000000164a05', 'p164-a');
select pg_temp.leer164('inactivo', '00000000-0000-4000-8000-000000164a06', 'p164-a');
select pg_temp.leer164('mgr-otro', '00000000-0000-4000-8000-000000164a07', 'p164-a');
select pg_temp.leer164('owner',    '00000000-0000-4000-8000-000000164a01', 'p164-c');
-- con el Club apagado las lecturas de adentro (excepciones, reporte de visitas) no corren: el rol lo frena la 164 sola
select pg_temp.leer164('contador', '00000000-0000-4000-8000-000000164a03', 'p164-c');
select pg_temp.leer164('cajero',   '00000000-0000-4000-8000-000000164a04', 'p164-c');
select pg_temp.leer164('owner',    '00000000-0000-4000-8000-000000164a01', 'p164-d');
select pg_temp.leer164('mgr-otro', '00000000-0000-4000-8000-000000164a07', 'p164-b');

create temp view _a164 as select * from _o164 where quien = 'owner' and loc = 'p164-a';
create or replace function pg_temp.hay(p_tipo text, p_ref text) returns boolean language sql as $f$
  select exists (select 1 from _o164 where quien = 'owner' and loc = 'p164-a' and tipo = p_tipo and ref = p_ref) $f$;

-- 0. catálogo
insert into _r164 (caso, ok, detalle)
select '0 catálogo: definer · stable · search_path · anon sin EXECUTE · authenticated con EXECUTE · 5 umbrales',
       p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public, pg_temp']
       and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'club_config'
              and column_name like 'alerta\_%') = 5,
       coalesce(p.proacl::text, 'sin acl')
  from pg_proc p where p.oid = 'public.club_alertas_inicio(text)'::regprocedure;
insert into _r164 (caso, ok, detalle)
select '0b valores de fábrica: 5 · 2 · 3 · 0 · 0',
       (c.alerta_anfitrion_24h_max, c.alerta_mismo_usuario_max, c.alerta_mismo_usuario_dias, c.alerta_visitas_sin_factura_max,
        c.alerta_canjes_sin_codigo_max) = (5, 2, 3, 0, 0), null
  from public.club_config c where c.location_id = 'p164-a';

-- 1. permisos
insert into _r164 (caso, ok, detalle) select '1a owner lee', exists (select 1 from _o164 where quien = 'owner' and loc = 'p164-a' and tipo = '_ok'),
  (select string_agg(err, ',') from _o164 where quien = 'owner' and loc = 'p164-a' and tipo = '_error');
insert into _r164 (caso, ok, detalle) select '1b manager de su local lee lo mismo que el owner',
  exists (select 1 from _o164 where quien = 'manager' and tipo = '_ok')
  and (select array_agg(ref order by ref) from _o164 where quien = 'manager' and tipo not like '\_%')
      is not distinct from (select array_agg(ref order by ref) from _a164 where tipo not like '\_%'), null;
insert into _r164 (caso, ok, detalle) select '1c contador → 42501 (también con el Club apagado)',
  (select count(*) from _o164 where quien = 'contador' and err = '42501') = 2 and not exists (select 1 from _o164 where quien = 'contador' and tipo = '_ok'), null;
insert into _r164 (caso, ok, detalle) select '1d cajero → 42501 (también con el Club apagado)',
  (select count(*) from _o164 where quien = 'cajero' and err = '42501') = 2 and not exists (select 1 from _o164 where quien = 'cajero' and tipo = '_ok'), null;
insert into _r164 (caso, ok, detalle) select '1e salonero → 42501', exists (select 1 from _o164 where quien = 'salonero' and err = '42501'), null;
insert into _r164 (caso, ok, detalle) select '1f owner inactivo → 42501', exists (select 1 from _o164 where quien = 'inactivo' and err = '42501'), null;
insert into _r164 (caso, ok, detalle) select '1g manager de otro local → 42501 en p164-a',
  exists (select 1 from _o164 where quien = 'mgr-otro' and loc = 'p164-a' and err = '42501'), null;
insert into _r164 (caso, ok, detalle) select '1h manager de p164-b ve su local (y nada de p164-a)',
  exists (select 1 from _o164 where quien = 'mgr-otro' and loc = 'p164-b' and tipo = '_ok')
  and exists (select 1 from _o164 where quien = 'mgr-otro' and loc = 'p164-b' and ref = 'anfitrion-24h:00000000-0000-4000-8000-000000164b08')
  and not exists (select 1 from _o164 where quien = 'mgr-otro' and loc = 'p164-b' and detalle->>'miembro_id' like '%164b0_' and ref not like '%164b08'), null;
do $$ begin
  set local role anon;
  perform public.club_alertas_inicio('p164-a');
  reset role;
  insert into _r164 (caso, ok, detalle) values ('1i anon → sin permiso (42501)', false, 'no dio error');
exception when others then
  reset role;
  insert into _r164 (caso, ok, detalle) values ('1i anon → sin permiso (42501)', sqlstate = '42501', sqlstate);
end $$;
insert into _r164 (caso, ok, detalle) select '1j Club apagado (p164-c): cero filas, sin error',
  exists (select 1 from _o164 where quien = 'owner' and loc = 'p164-c' and tipo = '_ok')
  and not exists (select 1 from _o164 where loc = 'p164-c' and tipo not like '\_%' and tipo <> '_error'), null;
insert into _r164 (caso, ok, detalle) select '1k cero datos (p164-d): cero filas, sin error',
  exists (select 1 from _o164 where quien = 'owner' and loc = 'p164-d' and tipo = '_ok')
  and not exists (select 1 from _o164 where loc = 'p164-d' and tipo not like '\_%'),
  (select string_agg(tipo || ':' || coalesce(ref, ''), ' · ') from _o164 where loc = 'p164-d');

-- 2. (a) acumulaciones del mismo anfitrión en 24 h
insert into _r164 (caso, ok, detalle) select '2a A1: 6 en 24 h → aviso con cantidad 6 y umbral 5',
  exists (select 1 from _a164 where ref = 'anfitrion-24h:00000000-0000-4000-8000-000000164b01' and cantidad = 6 and umbral = 5
            and detalle->>'miembro' is not null), (select cantidad::text from _a164 where ref like '%164b01');
insert into _r164 (caso, ok, detalle) select '2b A2: 5 (en el umbral) → sin aviso', not pg_temp.hay('ANFITRION_24H', 'anfitrion-24h:00000000-0000-4000-8000-000000164b02'), null;
insert into _r164 (caso, ok, detalle) select '2c A3: carga inicial (migracion) → sin aviso', not pg_temp.hay('ANFITRION_24H', 'anfitrion-24h:00000000-0000-4000-8000-000000164b03'), null;
insert into _r164 (caso, ok, detalle) select '2d A4: 5 tarjetas + 1 pendiente → aviso (6)',
  exists (select 1 from _a164 where ref = 'anfitrion-24h:00000000-0000-4000-8000-000000164b04' and cantidad = 6), null;
insert into _r164 (caso, ok, detalle) select '2e A5: 3 + 3 separadas por 25 h → sin aviso (ventana de 24 h)',
  not pg_temp.hay('ANFITRION_24H', 'anfitrion-24h:00000000-0000-4000-8000-000000164b05'), null;
insert into _r164 (caso, ok, detalle) select '2f A6 del EQUIPO: 6 → aviso (tipo_miembro equipo)',
  exists (select 1 from _a164 where ref = 'anfitrion-24h:00000000-0000-4000-8000-000000164b06' and detalle->>'tipo_miembro' = 'equipo'), null;
insert into _r164 (caso, ok, detalle) select '2g A9: pendiente aprobada no se cuenta dos veces → sin aviso (5)',
  not pg_temp.hay('ANFITRION_24H', 'anfitrion-24h:00000000-0000-4000-8000-000000164b09'), null;
insert into _r164 (caso, ok, detalle) select '2h A10: antes del inicio de ayer (hora CR) → sin aviso',
  not pg_temp.hay('ANFITRION_24H', 'anfitrion-24h:00000000-0000-4000-8000-000000164b10'), null;
insert into _r164 (caso, ok, detalle) select '2i A8 de otro local no sale en p164-a',
  not pg_temp.hay('ANFITRION_24H', 'anfitrion-24h:00000000-0000-4000-8000-000000164b08'), null;
insert into _r164 (caso, ok, detalle) select '2j exactamente 3 avisos de (a) en p164-a (A1, A4, A6)',
  (select count(*) from _a164 where tipo = 'ANFITRION_24H') = 3, (select string_agg(ref, ' · ') from _a164 where tipo = 'ANFITRION_24H');

-- 3. (b) el mismo usuario
insert into _r164 (caso, ok, detalle) select '3a S1: 3 visitas por el cajero → aviso (socio, usuario con nombre)',
  exists (select 1 from _a164 where ref = 'mismo-usuario:socio:00000000-0000-4000-8000-000000164c01:00000000-0000-4000-8000-000000164a04'
            and cantidad = 3 and umbral = 2 and detalle->>'usuario' = 'Prueba Cajero' and (detalle->>'dias')::int = 3), null;
insert into _r164 (caso, ok, detalle) select '3b S2: 3 usuarios distintos → sin aviso',
  not exists (select 1 from _a164 where ref like 'mismo-usuario:socio:00000000-0000-4000-8000-000000164c02:%'), null;
insert into _r164 (caso, ok, detalle) select '3c S3: separadas más de 3 días → sin aviso',
  not exists (select 1 from _a164 where ref like 'mismo-usuario:socio:00000000-0000-4000-8000-000000164c03:%'), null;
insert into _r164 (caso, ok, detalle) select '3d E1 del equipo: 3 tarjetas por el cajero → aviso (equipo)',
  exists (select 1 from _a164 where ref = 'mismo-usuario:equipo:00000000-0000-4000-8000-000000164b11:00000000-0000-4000-8000-000000164a04'), null;
insert into _r164 (caso, ok, detalle) select '3e R1 referente: 3 tarjetas por el cajero → sin aviso (solo socios y equipo)',
  not exists (select 1 from _a164 where ref like 'mismo-usuario:%:00000000-0000-4000-8000-000000164b12:%'), null;
insert into _r164 (caso, ok, detalle) select '3f exactamente 2 avisos de (b)',
  (select count(*) from _a164 where tipo = 'MISMO_USUARIO') = 2, (select string_agg(ref, ' · ') from _a164 where tipo = 'MISMO_USUARIO');

-- 4. (c) y (d)
insert into _r164 (caso, ok, detalle) select '4a visitas sin factura (ayer y hoy, pasada la latencia) = 1',
  exists (select 1 from _a164 where tipo = 'VISITAS_SIN_FACTURA' and cantidad = 1 and umbral = 0),
  (select cantidad::text from _a164 where tipo = 'VISITAS_SIN_FACTURA');
insert into _r164 (caso, ok, detalle) select '4b canjes sin código sin resolver (30 días) = 1',
  exists (select 1 from _a164 where tipo = 'CANJE_SIN_CODIGO' and cantidad = 1 and umbral = 0),
  (select cantidad::text from _a164 where tipo = 'CANJE_SIN_CODIGO');

-- 5. umbrales: solo el owner los cambia y queda en el historial; la función usa el del local
do $$
declare v_n int; v_h int;
begin
  select count(*) into v_h from public.club_config_historial where location_id = 'p164-a';
  -- manager: la política deja 0 filas
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000164a02', 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.club_config set alerta_canjes_sin_codigo_max = 1 where location_id = 'p164-a';
  get diagnostics v_n = row_count;
  reset role;
  insert into _r164 (caso, ok, detalle) values ('5a manager no cambia umbrales (0 filas)', v_n = 0, v_n::text);
  -- owner: cambia, queda en el historial con quién
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000164a01', 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.club_config set alerta_canjes_sin_codigo_max = 1, alerta_anfitrion_24h_max = 6 where location_id = 'p164-a';
  get diagnostics v_n = row_count;
  reset role;
  insert into _r164 (caso, ok, detalle)
  select '5b owner cambia umbrales; quedan en club_config_historial con quién y de qué a qué',
         v_n = 1 and (select count(*) from public.club_config_historial h where h.location_id = 'p164-a' and h.campo = 'alerta_canjes_sin_codigo_max'
                        and h.valor_anterior = '0' and h.valor_nuevo = '1' and h.cambiado_por = '00000000-0000-4000-8000-000000164a01') = 1
         and (select count(*) from public.club_config_historial where location_id = 'p164-a') = v_h + 2, v_n::text;
  -- con el umbral nuevo: (d) 1 no pasa «más de 1», y (a) con 6 no pasa «más de 6»
  begin
    set local role authenticated;
    insert into _o164 (quien, loc, tipo, ref, cantidad, umbral, detalle)
    select 'owner-umbral', 'p164-a', a.tipo, a.ref, a.cantidad, a.umbral, a.detalle from public.club_alertas_inicio('p164-a') a;
    reset role;
  exception when others then
    reset role;
    insert into _o164 (quien, loc, tipo, err) values ('owner-umbral', 'p164-a', '_error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  -- fuera de rango: el check lo frena
  begin
    update public.club_config set alerta_anfitrion_24h_max = 0 where location_id = 'p164-a';
    insert into _r164 (caso, ok, detalle) values ('5d umbral fuera de rango → check', false, 'aceptó 0');
  exception when check_violation then
    insert into _r164 (caso, ok, detalle) values ('5d umbral fuera de rango → check', true, null);
  end;
end $$;
insert into _r164 (caso, ok, detalle) select '5c con umbrales nuevos (d > 1, a > 6): sin canjes ni anfitriones; (b) y (c) siguen',
  not exists (select 1 from _o164 where quien = 'owner-umbral' and tipo = '_error') and not exists (select 1 from _o164 where quien = 'owner-umbral' and tipo in ('CANJE_SIN_CODIGO', 'ANFITRION_24H'))
  and exists (select 1 from _o164 where quien = 'owner-umbral' and tipo = 'MISMO_USUARIO')
  and exists (select 1 from _o164 where quien = 'owner-umbral' and tipo = 'VISITAS_SIN_FACTURA'),
  (select string_agg(tipo, ',') from _o164 where quien = 'owner-umbral');

-- 6. no escribe nada (STABLE): ni movimientos ni auditoría por leer
insert into _r164 (caso, ok, detalle) select '6 leer no escribe movimientos', (select count(*) from public.club_movimientos where nota like 'prueba 164%') = 63, null;

-- 7. rollback: saca la función y los umbrales
-- @@164R@@   (aquí va el cuerpo de scripts/sql/164_rollback.sql sin begin/commit)
insert into _r164 (caso, ok, detalle) select '7 rollback: sin función ni umbrales',
  to_regprocedure('public.club_alertas_inicio(text)') is null
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_config'
                   and column_name like 'alerta\_%'), null;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r164;

do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r164 where ok is not true;
  if v is not null then raise exception '164-FALLAN: %', v; end if;
  if (select count(*) from _r164) < 37 then raise exception '164-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;
rollback;
