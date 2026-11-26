-- 200_preludio_local · SOLO con `200_pruebas.py --local` (Postgres 16 vacío armado con scripts/sql/local_armar_base.sh).
-- Corre DENTRO de la transacción descartada de la batería, antes de todo. En staging NO va: ahí esto ya existe.
-- Suma lo que en Supabase existe desde antes del baseline (creado a mano) y el árbol de migraciones no crea:
--   1. `auth.users.encrypted_password` (lo usan delete_movement_cascade y la 200 para la clave del manager).
--   2. Columnas de texto de `cash_movements` que la 200 escribe y compara (las del alta de createCashMovement).
--   3. Privilegios por defecto como Supabase (toda función nueva de public nace ejecutable por anon y authenticated):
--      sin esto, la prueba de que la 200 se los saca a anon no muerde.
alter table auth.users add column if not exists encrypted_password text;
alter table public.cash_movements
  add column if not exists supplier_name text default '',
  add column if not exists employee_name text default '',
  add column if not exists shift text default '',
  add column if not exists subcategory text default '',
  add column if not exists attachments jsonb default '[]'::jsonb;
grant usage on schema public, auth, extensions to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
-- 4. En staging/prod `status` y `movement_type` son text (no los enum del 001). Como acá las políticas no dejan cambiar
--    el tipo, se agrega el cast de asignación text → enum (lo que en staging no hace falta porque ya son text).
create cast (text as public.movement_status) with inout as assignment;
create cast (text as public.movement_type) with inout as assignment;
