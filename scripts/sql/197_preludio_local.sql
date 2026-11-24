-- 197_preludio_local · SOLO con `197_pruebas.py --local` (Postgres local armado con local_armar_base.sh, después de
-- scripts/sql/165_preludio_local.sql). Corre DENTRO de la transacción descartada de la batería, antes de la 197.
-- La base local no tiene usuarios: crea un owner, un manager, un contador y un salonero ACTIVOS ficticios (en staging
-- la batería usa los que ya existen y no les cambia nada).
alter table auth.users add column if not exists encrypted_password character varying(255);

insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values
  ('00000000-0000-4000-8197-0000000000a1', 'o-197@ejemplo.test', '$2a$10$ficticio197owner',    '{"full_name":"Owner Ficticio"}'),
  ('00000000-0000-4000-8197-0000000000a2', 'm-197@ejemplo.test', '$2a$10$ficticio197manager',  '{"full_name":"Manager Ficticio"}'),
  ('00000000-0000-4000-8197-0000000000a3', 'c-197@ejemplo.test', '$2a$10$ficticio197contador', '{"full_name":"Contador Ficticio"}'),
  ('00000000-0000-4000-8197-0000000000a4', 's-197@ejemplo.test', '$2a$10$ficticio197salonero', '{"full_name":"Salonero Ficticio"}');
update public.profiles set role = 'owner',    is_active = true where id = '00000000-0000-4000-8197-0000000000a1';
update public.profiles set role = 'manager',  is_active = true where id = '00000000-0000-4000-8197-0000000000a2';
update public.profiles set role = 'contador', is_active = true where id = '00000000-0000-4000-8197-0000000000a3';
update public.profiles set role = 'salonero', is_active = true where id = '00000000-0000-4000-8197-0000000000a4';
