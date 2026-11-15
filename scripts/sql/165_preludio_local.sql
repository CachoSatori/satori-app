-- 165_preludio_local · SOLO con `165_pruebas.py --local` (Postgres local armado con local_armar_base.sh).
-- Corre DENTRO de la transacción descartada de la batería, antes de la 165: no deja nada.
-- Pone la base local como prod en lo que la batería toca (CAMBIOS del verificador, #184, hallazgo 2):
--   1. Policies de `profiles` como prod (comentario de la 085): la 001 del repo trae owner_*_profiles y perfil_propio_*,
--      que en prod no existen (y las owner_* recursan: 42P17). Prod tiene «Perfil propio visible», «Owners y managers
--      ven todos los perfiles» y «Solo owners crean/editan perfiles».
--   2. Permisos de Supabase: authenticated y service_role con todo en las tablas de public (la RLS decide), y los
--      privilegios por defecto de Supabase para tablas NUEVAS (anon, authenticated y service_role con ALL): así la
--      batería prueba que la 165 los revoca de verdad. service_role con BYPASSRLS, como en Supabase.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
alter role service_role bypassrls;

drop policy if exists owner_select_all_profiles on public.profiles;
drop policy if exists owner_update_all_profiles on public.profiles;
drop policy if exists perfil_propio_select on public.profiles;
drop policy if exists perfil_propio_update on public.profiles;
drop policy if exists "Perfil propio visible" on public.profiles;
drop policy if exists "Owners y managers ven todos los perfiles" on public.profiles;
drop policy if exists "Solo owners crean/editan perfiles" on public.profiles;
create policy "Perfil propio visible" on public.profiles for select using (id = auth.uid());
create policy "Owners y managers ven todos los perfiles" on public.profiles for select
  using (public.get_my_role() = any (array['owner', 'manager']::public.user_role[]));
create policy "Solo owners crean/editan perfiles" on public.profiles
  using (public.get_my_role() = 'owner'::public.user_role) with check (public.get_my_role() = 'owner'::public.user_role);

grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
