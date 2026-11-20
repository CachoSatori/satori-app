-- anonimizar_staging_semilla_local.sql · SOLO la base Postgres 16 LOCAL de local_armar_base.sh (nunca staging ni prod).
-- La batería de anonimizar staging (anonimizar_staging_pruebas.sql) la mete al principio de su transacción con --local:
-- (1) agrega lo que el shim local no trae de Supabase (columnas de auth.users, sesiones, identidades, bitácora de Auth,
-- pg_net, pg_cron) y las tablas de deriva de prod que la base local no tiene (solo las columnas que usa la prueba);
-- (2) siembra datos 100 % INVENTADOS con forma de reales (nombres, correos, teléfonos, IBAN, cédulas, claves FE) para que
-- los casos locales (anonimizar_staging_casos_local.sql) vean que cada uno se reemplaza. Termina en el ROLLBACK de la
-- batería: no queda nada. Correos y teléfonos se arman por partes para que la guarda del repo no los confunda con reales.

-- ── (1) Supabase que falta en el shim ─────────────────────────────────────────────────────────────────────────────
alter table auth.users
  add column if not exists encrypted_password text, add column if not exists confirmation_token text,
  add column if not exists recovery_token text, add column if not exists email_change_token_new text,
  add column if not exists email_change_token_current text, add column if not exists phone_change_token text,
  add column if not exists reauthentication_token text, add column if not exists email_change text,
  add column if not exists phone_change text, add column if not exists banned_until timestamptz;
create table if not exists auth.identities (id uuid primary key default gen_random_uuid(), provider_id text not null,
  user_id uuid not null, identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(), unique (provider_id, provider));
create table if not exists auth.sessions (id uuid primary key, user_id uuid not null);
create table if not exists auth.refresh_tokens (id bigserial primary key, user_id varchar(255), session_id uuid, token text);
create table if not exists auth.mfa_amr_claims (id uuid primary key default gen_random_uuid(), session_id uuid not null);
create table if not exists auth.audit_log_entries (id uuid primary key default gen_random_uuid(), payload json);
create table if not exists auth.flow_state (id uuid primary key default gen_random_uuid(), user_id uuid, auth_code text);
create table if not exists net._http_response (id bigserial primary key, content text);
create table if not exists cron.job (jobid bigserial primary key, command text, active boolean default true);

-- deriva de prod que la base local no tiene (las columnas de texto están todas en clasificacion.sql)
alter table public.suppliers add column if not exists cuenta_iban text;
alter table public.cash_sessions add column if not exists cajero_name text;
alter table public.cash_movements add column if not exists employee_name text, add column if not exists supplier_name text,
  add column if not exists attachments jsonb default '[]'::jsonb, add column if not exists shift text,
  add column if not exists subcategory text;
create table if not exists public.time_punches (id uuid primary key default gen_random_uuid(), emp_code text, local text,
  punch_state text, terminal text, raw jsonb, punch_at timestamptz);
create table if not exists public.employee_bank_info (employee_id uuid primary key, nombre_homebanking text, banco text,
  cuenta_iban_alias text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.employee_wage_rates (id uuid primary key default gen_random_uuid(), employee_id uuid not null,
  tipo text not null, hourly_rate_crc numeric not null default 0, fixed_salary_crc numeric not null default 0,
  efectivo_desde date not null default current_date, nota text);
create table if not exists public.pos_orders (id uuid primary key default gen_random_uuid(), location_id text not null default 'santa-teresa',
  table_name text not null default 'M1', salonero_name text not null, status text not null default 'closed',
  transfers jsonb not null default '[]', notes text not null default '', channel text not null default 'salon',
  merge_trace jsonb not null default '[]');
create table if not exists public.cash_movements_pre_migracion_2026_07 (id uuid primary key default gen_random_uuid(),
  description text, employee_name text, supplier_name text);

-- ── (2) Datos inventados ──────────────────────────────────────────────────────────────────────────────────────────
insert into public.locations (id, name) values ('santa-teresa', 'Local Ficticio') on conflict (id) do nothing;
insert into public.club_entorno (nombre) values ('staging') on conflict do nothing;

-- Usuarios: 5 de prueba + Manager Prueba (no se tocan) y 2 «reales» inventados (se sanean). handle_new_user crea perfiles.
insert into auth.users (id, email, encrypted_password, raw_user_meta_data, phone, recovery_token, banned_until) values
  ('00000000-0000-4000-8a00-000000000001', 'prueba-owner@staging-satori.test', '', '{}', null, '', null),
  ('00000000-0000-4000-8a00-000000000002', 'prueba-manager@staging-satori.test', '', '{}', null, '', null),
  ('00000000-0000-4000-8a00-000000000003', 'prueba-cajero@staging-satori.test', '', '{}', null, '', null),
  ('00000000-0000-4000-8a00-000000000004', 'prueba-salonero@staging-satori.test', '', '{}', null, '', null),
  ('00000000-0000-4000-8a00-000000000005', 'prueba-contador@staging-satori.test', '', '{}', null, '', null),
  ('00000000-0000-4000-8000-0000000e0001', 'manager.prueba' || '@' || 'example.com', '', '{}', null, '', null),
  ('00000000-0000-4000-8a00-0000000000a1', 'lucia.inventada' || '@' || 'correo-inventado.cr', repeat('h', 60),
   '{"full_name": "Lucía Inventada Mora"}', '506' || '6000' || '1001', 'tok-recuperar', null),
  ('00000000-0000-4000-8a00-0000000000a2', 'andres.inventado' || '@' || 'proveedor-inventado.com', repeat('h', 60), '{}', null, '', null)
on conflict (id) do nothing;
update public.profiles set full_name = 'Prueba Owner', role = 'owner', is_active = true where id = '00000000-0000-4000-8a00-000000000001';
update public.profiles set full_name = 'Lucía Inventada Mora', email = 'lucia.inventada' || '@' || 'correo-inventado.cr'
 where id = '00000000-0000-4000-8a00-0000000000a1';
update public.profiles set full_name = 'Andrés Inventado Vargas' where id = '00000000-0000-4000-8a00-0000000000a2';
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at) values
  ('00000000-0000-4000-8a00-0000000000a1', '00000000-0000-4000-8a00-0000000000a1',
   jsonb_build_object('sub', '00000000-0000-4000-8a00-0000000000a1', 'email', 'lucia.inventada' || '@' || 'correo-inventado.cr'), 'email', now()),
  ('id-de-google-123', '00000000-0000-4000-8a00-0000000000a2',
   jsonb_build_object('sub', 'x', 'email', 'andres.inventado' || '@' || 'proveedor-inventado.com', 'name', 'Andrés Inventado Vargas'), 'google', now()),
  ('00000000-0000-4000-8a00-000000000001', '00000000-0000-4000-8a00-000000000001',
   '{"sub": "00000000-0000-4000-8a00-000000000001", "email": "prueba-owner@staging-satori.test"}', 'email', null);
insert into auth.sessions (id, user_id) values
  ('00000000-0000-4000-8a00-00000000c001', '00000000-0000-4000-8a00-0000000000a1'),
  ('00000000-0000-4000-8a00-00000000c002', '00000000-0000-4000-8a00-000000000001');
insert into auth.refresh_tokens (user_id, session_id, token) values
  ('00000000-0000-4000-8a00-0000000000a1', '00000000-0000-4000-8a00-00000000c001', 'rt-real'),
  ('00000000-0000-4000-8a00-000000000001', '00000000-0000-4000-8a00-00000000c002', 'rt-prueba');
insert into auth.mfa_amr_claims (session_id) values ('00000000-0000-4000-8a00-00000000c001');
insert into auth.audit_log_entries (payload) values (json_build_object('actor_username', 'lucia.inventada' || '@' || 'correo-inventado.cr'));
insert into auth.flow_state (user_id, auth_code) values ('00000000-0000-4000-8a00-0000000000a1', 'codigo');
insert into net._http_response (content) values ('{"ok":true}');
insert into cron.job (command) values ('select 1');

-- Personal
insert into public.employees (id, full_name, role, profile_id, is_active, pos_name, pos_login) values
  ('00000000-0000-4000-8a00-0000000000e1', 'Lucía Inventada Mora', 'cajero', '00000000-0000-4000-8a00-0000000000a1', true, 'Lucía F', 'LF01'),
  ('00000000-0000-4000-8a00-0000000000e2', 'Andrés Inventado Vargas', 'salonero', null, true, 'ANDRES I', 'AQ02'),
  ('00000000-0000-4000-8a00-0000000000e3', 'Prueba Cajero', 'cajero', null, true, null, null);
insert into public.employee_bajas (employee_id, full_name, pos_login) values ('00000000-0000-4000-8a00-0000000000e9', 'Marta Inventada Rojas', 'MS09');
insert into public.employee_bank_info (employee_id, nombre_homebanking, banco, cuenta_iban_alias)
values ('00000000-0000-4000-8a00-0000000000e1', 'LUCIA INVENTADA', 'Banco Ficticio', 'CR05' || '0102' || '0000' || '9012' || '3456' || '78');
insert into public.employee_wage_rates (employee_id, tipo, hourly_rate_crc, fixed_salary_crc, nota) values
  ('00000000-0000-4000-8a00-0000000000e1', 'hora', 3125, 0, 'aumento por antigüedad de Lucía'),
  ('00000000-0000-4000-8a00-0000000000e2', 'mes', 0, 650000, null);
insert into public.time_punches (emp_code, local, punch_state, terminal, raw, punch_at) values
  ('101', 'santa-teresa', '0', 'T1', jsonb_build_object('emp_code', '101', 'first_name', 'Lucía', 'last_name', 'Inventada',
   'department', 'Salón', 'punch_time', '2026-11-01 08:00:00', 'terminal_sn', 'T1', 'punch_state', '0'), '2026-11-01 14:00:00+00');

-- Proveedores, compras y Bandeja
insert into public.suppliers (id, name, aliases, email, whatsapp, contact, cuenta_iban, category) values
  ('00000000-0000-4000-8a00-0000000000f1', 'Distribuidora Inventada del Valle', array['Inventada del Valle', 'DISTRIBUIDORA INVENTADA DEL VALLE'],
   'ventas' || '@' || 'proveedor-inventado.cr', '+506 ' || '6111' || '2002', 'Don Inventado', 'CR21' || '0152' || '0200' || '1026' || '2840' || '66', 'mercaderia');
insert into public.ingredients (name, supplier, notes) values ('Arroz de la semilla anon', 'inventada del valle', 'Lo trae Don Inventado los martes');
insert into public.documents (id, image_path, clave_fe, tipo, raw_json, estado) values
  ('00000000-0000-4000-8a00-0000000000d1', '2026-11-02/abc123-1.jpg',
   '506' || '021126' || '003101999991' || '00100001010000000777' || '1' || '87654321', 'factura',
   jsonb_build_object('tipo', 'factura', 'proveedor', 'Distribuidora Inventada del Valle S.A.', 'proveedor_cedula', '3-101-999991',
     'banco', 'BCR', 'referencia', 'TRX-998877', 'concepto', 'Pago a Don Inventado', 'total', 15000, 'moneda', 'CRC',
     'clave_fe', '506' || '021126' || '003101999991' || '00100001010000000777' || '1' || '87654321',
     'items', jsonb_build_array(jsonb_build_object('descripcion', 'Arroz 1 kg', 'cantidad', 2, 'codigo', 'AR01'))), 'procesado');

-- Caja y propinas
insert into public.cash_sessions (id, session_date, opened_by, cajero_name, notes) values
  ('00000000-0000-4000-8a00-0000000000b1', '2026-11-01', '00000000-0000-4000-8a00-000000000001', 'Lucía Inventada Mora',
   'Faltó cambio, avisar a Andrés');
insert into public.cash_movements (id, session_id, created_by, movement_type, amount_crc, description, supplier_name, employee_name,
                                   attachments, created_at) values
  ('00000000-0000-4000-8a00-0000000000c1', '00000000-0000-4000-8a00-0000000000b1', '00000000-0000-4000-8a00-000000000001',
   'egreso_mercaderia', 15000, 'Pago a Distribuidora Inventada del Valle · fact 2026-11-02', 'Inventada del Valle', '',
   '["2026-11-02/abc123-1.jpg"]', '2026-11-02 15:00:00+00'),
  ('00000000-0000-4000-8a00-0000000000c2', null, '00000000-0000-4000-8a00-000000000001', 'ingreso', 250000,
   'Ventas efectivo Noche 2026-11-01', '', '', '[]', '2026-11-02 05:00:00+00'),
  ('00000000-0000-4000-8a00-0000000000c3', null, '00000000-0000-4000-8a00-000000000001', 'ingreso', 500,
   'Ajuste de cierre 2026-11-01 · Faltante · contó mal Lucía', '', '', '[]', '2026-11-02 05:01:00+00'),
  ('00000000-0000-4000-8a00-0000000000c4', '00000000-0000-4000-8a00-0000000000b1', '00000000-0000-4000-8a00-000000000001',
   'egreso_personal', 42000, 'Propinas turno 2026-11-01 Noche', '', 'andrés inventado vargas  ', '[]', '2026-11-02 04:00:00+00');
insert into public.cash_movements_pre_migracion_2026_07 (description, employee_name, supplier_name)
values ('Adelanto a Marta', 'Marta Inventada Rojas', 'Inventada del Valle');
insert into public.cash_cierres_dia (session_date, manager, tipo, vm_crc, vn_crc, notas, ajuste_motivo, location_id)
values ('2026-11-01', 'Lucía Inventada Mora', 'final', 120000, 250000, 'Resumen: todo bien, Marta llegó tarde', 'error de Lucía', 'santa-teresa');
insert into public.tip_sessions (id, session_date, opened_by, notes) values
  ('00000000-0000-4000-8a00-0000000000b2', '2026-11-01', '00000000-0000-4000-8a00-000000000001', 'Andrés cubrió a Marta');
insert into public.tip_entries (session_id, employee_id, hours_worked, tip_amount_crc, tip_amount_usd, payout_crc) values
  ('00000000-0000-4000-8a00-0000000000b2', '00000000-0000-4000-8a00-0000000000e1', 6, 0, 0, 21000),
  ('00000000-0000-4000-8a00-0000000000b2', '00000000-0000-4000-8a00-0000000000e2', 6, 0, 0, 21000);
insert into public.movement_edits (movement_id, before, after, changed) values
  ('00000000-0000-4000-8a00-0000000000c1',
   jsonb_build_object('description', 'Pago a Don Inventado', 'supplier_name', 'Inventada del Valle', 'amount_crc', 14000, 'telefono_extra', '8888'),
   jsonb_build_object('description', 'Pago a Distribuidora Inventada del Valle · fact 2026-11-02', 'supplier_name', 'Inventada del Valle', 'amount_crc', 15000),
   jsonb_build_object('description', jsonb_build_object('old', 'Pago a Don Inventado', 'new', 'Pago a Distribuidora Inventada del Valle · fact 2026-11-02'),
                      'amount_crc', jsonb_build_object('old', 14000, 'new', 15000)));

-- Ventas (PoS) con clave FE del emisor
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta,
                                    total_crc, consecutivo_fe, clave_fe) values
  ('santa-teresa', '9001', '2026-11-01 20:00:00+00', 'C', 'salon', 'cajero', true, 'ok', 18500,
   '00100001040000000123', '506' || '011126' || '003101999992' || '00100001040000000123' || '1' || '12345678'),
  ('santa-teresa', '9002', '2026-11-01 21:00:00+00', 'C', 'salon', 'cajero', true, 'ok', 9200,
   '00100001040000000124', '506' || '011126' || '003101999992' || '00100001040000000124' || '1' || '22345678');
insert into public.pos_orders (salonero_name, notes, transfers) values
  ('LUCÍA INVENTADA MORA', 'Mesa de Carolina, alérgica', jsonb_build_array(jsonb_build_object('from', 'Lucía', 'to', 'Andrés', 'pax', 2)));
insert into public.ventas_dias (session_date, file_name, data) values ('2026-11-01', 'ventas.xls', '{"saloneros": {"Lucía": {"total": 1}}}');

-- Clientes y Club (los triggers del Club escriben club_auditoria con antes/después)
insert into public.customers (phone, name, email, birth_date, notes, wallet_pass_id) values
  ('+506 ' || '6000' || '3003', 'Pedro Inventado Arias', 'pedro.j' || '@' || 'correo-inventado.cr', '1990-03-15', 'Cliente de Lucía', 'pase-123'),
  ('+506 ' || '6000' || '3004', 'Ana Inventada Solano', null, null, null, null);
insert into public.club_negocios (id, location_id, nombre, tipo) values
  ('00000000-0000-4000-8a00-0000000000f2', 'santa-teresa', 'Hotel Las Olas Ficticio', 'hotel');
insert into public.club_miembros (id, location_id, tipo, nombre, codigo, token_portal, token_pase, codigo_socio, legacy_id) values
  ('00000000-0000-4000-8a00-0000000000a7', 'santa-teresa', 'equipo', 'Lucía Inventada Mora', 'ABCDEFGH',
   repeat('a1', 32), repeat('b2', 32), 'ABCDEFGHJ', 'legacy-77'),
  ('00000000-0000-4000-8a00-0000000000a8', 'santa-teresa', 'socio', 'Carolina Inventada Ulate', 'HJKLMNPQ',
   repeat('c3', 32), null, null, '50660' || '001001');
insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email, cumple_dia, cumple_mes, cumple_permiso_en) values
  ('00000000-0000-4000-8a00-0000000000a7', 'santa-teresa', '+506' || '6000' || '1001', 'lucia.inventada' || '@' || 'correo-inventado.cr',
   15, 3, now()),
  ('00000000-0000-4000-8a00-0000000000a8', 'santa-teresa', '+1' || '555' || '0100' || '000', null, null, null, null);
insert into public.club_pases (miembro_id, plataforma, object_id) values ('00000000-0000-4000-8a00-0000000000a8', 'google', 'pase-real-1');
insert into public.club_reportes_cerrados (location_id, mes, version, datos, sha256, sha256_prev) values
  ('santa-teresa', '2026-09-01', 1, '{"socios": [{"nombre": "Carolina Inventada Ulate", "creditos": 3}], "total": 3}',
   encode(extensions.digest('{"socios": [{"nombre": "Carolina Inventada Ulate", "creditos": 3}], "total": 3}'::jsonb::text, 'sha256'), 'hex'), null);
insert into public.club_reportes_cerrados (location_id, mes, version, datos, sha256, sha256_prev)
select 'santa-teresa', '2026-10-01', 1, '{"total": 5}',
       encode(extensions.digest(r.sha256 || '{"total": 5}'::jsonb::text, 'sha256'), 'hex'), r.sha256
  from public.club_reportes_cerrados r where r.mes = '2026-09-01';

-- Storage (lo borra storage.sh, no el SQL: acá solo se cuentan)
insert into storage.objects (bucket_id, name) values ('documents', '2026-11-02/abc123-1.jpg'), ('documents', 'sops/manual.pdf');
