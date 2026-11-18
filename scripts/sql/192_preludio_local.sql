-- 192_preludio_local · SOLO con `192_pruebas.py --local` (Postgres local armado con local_armar_base.sh). Corre DENTRO
-- de la transacción descartada de la batería, antes de todo. Deja la base local como prod y staging (18-nov):
--   1. tip_entries con SOLO las dos policies vivas en prod («Todos ven entradas de propinas» y tip_entries_op_write):
--      las tres de la 001 se sacaron a mano en prod antes del baseline y la base local las arrastra.
--   2. Privilegios como Supabase: authenticated con las tablas; las funciones nuevas con EXECUTE para anon y
--      authenticated por defecto (por eso la 192 le saca EXECUTE a anon); anon SIN privilegios en tip_entries (como prod).
--   3. Un owner ACTIVO ficticio (en staging la batería usa el que ya existe y no le cambia nada).
drop policy if exists gerencia_ve_entradas_propinas    on public.tip_entries;
drop policy if exists empleado_ve_sus_entradas         on public.tip_entries;
drop policy if exists owner_manager_gestionan_entradas on public.tip_entries;

grant usage on schema public, auth to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema auth to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-4000-8192-0000000000b0', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8192-0000000000b0';
