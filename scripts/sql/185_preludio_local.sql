-- 185_preludio_local · SOLO con `185_pruebas.py --local` (Postgres local armado con local_armar_base.sh, después de
-- scripts/sql/165_preludio_local.sql). Corre DENTRO de la transacción descartada de la batería, antes de la 185.
--   1. El shim local de auth.users no trae `encrypted_password`: se agrega con el tipo de GoTrue (varchar(255)).
--   2. La base local no tiene usuarios: crea un owner, un manager y un salonero ACTIVOS ficticios (en staging la batería
--      usa los que ya existen y no les cambia nada).
alter table auth.users add column if not exists encrypted_password character varying(255);

insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values
  ('00000000-0000-4000-8185-0000000000a1', 'o-185@ejemplo.test', '$2a$10$ficticio185owner', '{"full_name":"Owner Ficticio"}'),
  ('00000000-0000-4000-8185-0000000000a2', 'm-185@ejemplo.test', '$2a$10$ficticio185manager', '{"full_name":"Manager Ficticio"}'),
  ('00000000-0000-4000-8185-0000000000a3', 's-185@ejemplo.test', '$2a$10$ficticio185salonero', '{"full_name":"Salonero Ficticio"}');
update public.profiles set role = 'owner',    is_active = true where id = '00000000-0000-4000-8185-0000000000a1';
update public.profiles set role = 'manager',  is_active = true where id = '00000000-0000-4000-8185-0000000000a2';
update public.profiles set role = 'salonero', is_active = true where id = '00000000-0000-4000-8185-0000000000a3';
