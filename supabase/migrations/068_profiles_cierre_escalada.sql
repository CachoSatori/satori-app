-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 068 · SEC-01 · Cierre de la escalada de roles en `profiles`                          ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Problema (confirmado en prod el 03/11, sin explotación):
--   · `handle_new_user()` tomaba `role` de `raw_user_meta_data`: cualquiera con la anon key podía
--     registrarse por la API pidiendo `role: owner` (contenido en el Paso A con `disable_signup`).
--   · `get_my_role()` no mira `is_active`, así que el rol pedido daba permisos aunque la cuenta
--     naciera pendiente. (Que mire `is_active` es SEC-01b, otro PR: hay guardas plpgsql
--     `not in (...)` que con NULL dejan pasar. Acá NO se cambia su cuerpo.)
--
-- Qué hace:
--   1. `handle_new_user()` ignora el rol de la metadata: siempre `salonero` + `is_active=false`.
--   2. `profiles_guarda_roles()` + trigger BEFORE: cambiar `role`/`is_active`, insertar un perfil
--      elevado o activo, o borrar un perfil exige un owner ACTIVO (sin `get_my_role()`).
--      Bypass solo para sesiones sin JWT (postgres, Management API, GoTrue) o `service_role`.
--   3. Constraint trigger diferido: nunca quedan 0 owners activos (aplica a todos, también bypass).
--   4. Se borra `perfil_propio_update` si existiera (no existe en prod; sí en 001 del repo).
--   5. `get_my_role()`: mismo cuerpo y retorno que prod; solo se agrega `search_path`.
--
-- Re-ejecutable: `create or replace`, `drop trigger if exists`, `drop policy if exists`.
-- Rollback: `scripts/sql/068_rollback.sql`.

-- ── 1. Alta de usuarios: el rol nunca viene de la metadata ──────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.profiles (id, full_name, email, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'salonero',   -- el rol lo asigna un owner desde Admin; la metadata se ignora (SEC-01)
    false         -- nace pendiente; el owner la activa
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- ── 2. Guarda de rol / activación / borrado ─────────────────────────────────────────────────
-- SIN security definer: corre como quien hace la operación. El owner activo se lee de su propia
-- fila (visible por la policy «Perfil propio visible»).
create or replace function public.profiles_guarda_roles()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_verificar boolean;
begin
  -- Bypass por inclusión: solo administración (sin JWT) o service_role.
  if v is null or v->>'role' = 'service_role' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_verificar := case tg_op
    when 'INSERT' then new.role is distinct from 'salonero'::user_role or new.is_active is distinct from false
    when 'UPDATE' then new.role is distinct from old.role or new.is_active is distinct from old.is_active
    else true  -- DELETE
  end;

  if v_verificar and not exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'owner' and p.is_active
  ) then
    raise exception 'SEC-01: solo un owner activo puede cambiar roles, activar o borrar perfiles'
      using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function public.profiles_guarda_roles() from public, anon, authenticated;

drop trigger if exists trg_profiles_guarda_roles on public.profiles;
create trigger trg_profiles_guarda_roles
  before insert or update or delete on public.profiles
  for each row execute function public.profiles_guarda_roles();

-- ── 3. Nunca 0 owners activos ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER a propósito: tiene que contar TODOS los owners aunque quien opera ya no vea
-- todos los perfiles (p. ej. un owner que se bajó a salonero en la misma transacción).
create or replace function public.profiles_ultimo_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if old.role = 'owner' and old.is_active
     and (tg_op = 'DELETE' or not (new.role = 'owner' and new.is_active)) then
    if not exists (select 1 from public.profiles where role = 'owner' and is_active) then
      raise exception 'SEC-01: no puede quedar ningún owner activo'
        using errcode = '23514';
    end if;
  end if;
  return null;
end;
$function$;

revoke all on function public.profiles_ultimo_owner() from public, anon, authenticated;

drop trigger if exists trg_profiles_ultimo_owner on public.profiles;
create constraint trigger trg_profiles_ultimo_owner
  after update or delete on public.profiles
  deferrable initially deferred
  for each row
  when (old.role = 'owner' and old.is_active)
  execute function public.profiles_ultimo_owner();

-- ── 4. Policy de auto-edición del repo (001:107) ────────────────────────────────────────────
drop policy if exists "perfil_propio_update" on public.profiles;

-- ── 5. get_my_role(): mismo cuerpo que prod, solo search_path ───────────────────────────────
create or replace function public.get_my_role()
returns user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  SELECT role FROM profiles WHERE id = auth.uid();
$function$;
