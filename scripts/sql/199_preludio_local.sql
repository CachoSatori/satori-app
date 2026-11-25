-- 199_preludio_local · SOLO con `199_pruebas.py --local` (Postgres vacío armado con scripts/sql/193_base_local.sql).
-- Corre DENTRO de la transacción descartada de la batería, antes de todo. En staging NO va: ahí esto ya existe.
--   1. Privilegios por defecto como Supabase: toda tabla y función nueva de public nace con permisos para anon y
--      authenticated (por eso la 199 los revoca; sin esto, las pruebas de permisos no muerden).
--   2. `suppliers` (la 199 le pone una FK) y `storage.buckets` con las columnas que usa la 199.
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create table if not exists public.suppliers (id uuid primary key default gen_random_uuid(), name text not null);
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
