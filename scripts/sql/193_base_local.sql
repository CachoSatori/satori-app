-- 193_base_local · SOLO para correr scripts/sql/193_pruebas.sql en un Postgres VACÍO (local, efímero), sin staging.
-- Arma lo mínimo que la 193 y su batería usan, con las mismas firmas que en Supabase: roles anon / authenticated /
-- service_role, auth.uid() por `request.jwt.claims`, auth.users → profiles, get_my_role() con is_active, locations,
-- profile_locations, mis_locales() / puede_ver_local() (091) y las columnas de pos_ndf_tickets / pos_ndf_ticket_lines
-- (062, 063, 081). NUNCA contra staging ni prod: ahí todo esto ya existe.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, name text);
grant usage on schema auth, public to anon, authenticated, service_role;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create type public.user_role as enum ('owner', 'manager', 'contador', 'cajero', 'salonero', 'barman', 'barback', 'runner', 'cocina', 'proveedor');
create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
create table public.profiles (id uuid primary key, role public.user_role not null default 'salonero', is_active boolean not null default false);
create function auth.nuevo_perfil() returns trigger language plpgsql security definer as $$
begin insert into public.profiles (id) values (new.id); return new; end $$;
create trigger nuevo_perfil after insert on auth.users for each row execute function auth.nuevo_perfil();
create or replace function public.get_my_role() returns public.user_role language sql stable security definer
set search_path = public, pg_temp as $$ select role from public.profiles where id = auth.uid() and is_active $$;
grant execute on function public.get_my_role() to anon, authenticated;
create table public.locations (id text primary key, name text not null, is_active boolean not null default true);
insert into public.locations values ('santa-teresa', 'Local A', true);
create table public.profile_locations (profile_id uuid not null references public.profiles(id) on delete cascade,
  location_id text not null references public.locations(id), primary key (profile_id, location_id));
create or replace function public.mis_locales() returns text[] language sql stable security definer
set search_path = public, pg_temp as $$
  select case
    when get_my_role() is null then array[]::text[]
    when get_my_role() in ('owner', 'contador')
      then coalesce((select array_agg(l.id order by l.id) from public.locations l), array[]::text[])
    when exists (select 1 from public.profile_locations pl where pl.profile_id = auth.uid())
      then (select array_agg(pl.location_id order by pl.location_id) from public.profile_locations pl where pl.profile_id = auth.uid())
    else array['santa-teresa']
  end $$;
create or replace function public.puede_ver_local(p_local text) returns boolean language sql stable security definer
set search_path = public, pg_temp as $$ select p_local = any (public.mis_locales()) $$;
create table public.pos_ndf_tickets (
  id uuid primary key default gen_random_uuid(), local text not null default 'santa-teresa', numero_factura text not null,
  fecha_registra timestamptz not null, fecha_cierra timestamptz, estado text not null check (estado in ('C','X','R')),
  tipo text, area text, canal text not null check (canal in ('salon','barra','delivery','llevar','otro')), mesa text,
  salonero_login text, registrado_por text not null check (registrado_por in ('salonero','cajero','sistema','sin_pedido')),
  turno text, cajero_login text, numero_pedido text, efectivo_crc numeric, con_servicio boolean not null, servicio_crc numeric,
  pax_nativo int not null default 0, pax_articulo int not null default 0, pax int not null default 0,
  pax_alerta text not null check (pax_alerta in ('ok','falta_nativo','falta_articulo','difiere','sin_pax')),
  total_crc numeric, total_fuente text not null default 'provisorio', valor_servido_crc numeric, iva_crc numeric,
  regalia_crc numeric, clase_ingreso text, mesa_factura text, consecutivo_fe text, clave_fe text,
  pedido_abierto_en timestamptz, area_factura text, unique (local, numero_factura));
create table public.pos_ndf_ticket_lines (id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.pos_ndf_tickets(id) on delete cascade, codigo_producto text, nombre text,
  cantidad numeric, precio numeric, monto numeric, familia int);
alter table public.pos_ndf_tickets enable row level security;
alter table public.pos_ndf_ticket_lines enable row level security;
