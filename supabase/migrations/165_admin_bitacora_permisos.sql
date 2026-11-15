-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 165 (origen club 111) · B10 · Bitácora de permisos de los usuarios de la app          ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Qué hace (y nada más):
--   1. Tabla `bitacora_permisos`, SOLO INSERCIÓN: quién cambió (auth.uid(); NULL = sistema), cuándo, a qué usuario,
--      qué campo de permisos y de qué a qué. Nadie la edita ni la borra: sin UPDATE/DELETE/INSERT para anon,
--      authenticated ni service_role (tampoco el owner por la API) y un trigger que frena UPDATE/DELETE/TRUNCATE
--      incluso para el dueño de la tabla. La única que escribe es la función del trigger (SECURITY DEFINER).
--   2. Trigger AFTER UPDATE OF role, is_active sobre `profiles`, con WHEN: solo corre si cambió el rol o la
--      activación. Cambiar el nombre, el correo o `updated_at` NO lo dispara (el login no escribe en `profiles`).
--   3. Trigger AFTER INSERT/UPDATE/DELETE sobre `profile_locations` (local asignado, mig 091): es el otro campo de
--      permisos que existe. Hoy la app no lo escribe; queda cubierto para cuando se use. Si la fila se va por el
--      borrado en cascada de su perfil (p. ej. la compensación de `alta-empleado`), no se registra.
--   4. Lectura: solo owner activo (RLS con get_my_role()). Manager no la ve: Admin entero es solo owner.
--
-- Qué NO hace:
--   · No guarda datos personales: ni nombre, ni correo, ni contraseña; solo IDs, el campo y el valor de permiso.
--   · No inventa historia: la bitácora ARRANCA VACÍA. Lo anterior a esta migración no quedó registrado.
--   · No registra altas (INSERT de `profiles`, que hace `handle_new_user` como salonero inactivo) ni borrados del
--     perfil: el alta desde Admin (`alta-empleado`) sí queda, porque asigna rol y activa con un UPDATE del owner.
--   · No toca `profiles_guarda_roles`, `profiles_ultimo_owner`, `handle_new_user`, `get_my_role` ni policies de
--     `profiles`. No hay FK a `profiles`: la historia sobrevive al borrado y no traba el `deleteUser` en cascada.
--
-- Si la bitácora no puede insertar (DECISIÓN, ver el PR): la transacción del cambio de permiso FALLA (fail closed).
--   Un cambio de rol sin rastro es justo lo que B10 quiere evitar. El riesgo queda acotado porque:
--   · el trigger solo corre en cambios de rol/activación/local (nunca en login, nombre ni correo);
--   · la inserción no depende de datos (sin lecturas, sin FK, los CHECK se cumplen por construcción): solo puede
--     fallar si la tabla no existe o la base no puede escribir, y ahí el cambio tampoco debería pasar;
--   · lo que SÍ puede fallar por datos (leer el JWT) va en un bloque protegido: si falla, se registra como sistema.
--   Salida de urgencia (guía 6.6 «Urgencia: la bitácora no guarda» y ESTADO): 1) bloquear la cuenta en Supabase Auth
--   (ban o cambio de clave; no pasa por profiles); 2) si además hay que desactivarla, soporte, como dueño de la
--   tabla y en UNA transacción: disable trigger → update → enable trigger; 3) anotarlo a mano con origen 'manual'
--   cuando la bitácora vuelva a guardar (el dueño de la tabla puede insertar; nadie más).
--
-- Sesiones con `session_replication_role = replica` (solo superusuario, scripts de prueba) no disparan triggers:
-- esos cambios no quedan. Es un canal de administración, no de la app.
--
-- Re-ejecutable: `create … if not exists`, `create or replace`, `drop trigger if exists`, `drop policy if exists`.
-- Rollback: scripts/sql/165_rollback.sql. Pruebas: scripts/sql/165_pruebas.sql (+ 165_pruebas.py).

begin;

-- ── 1. Tabla ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.bitacora_permisos (
  id           bigint generated always as identity primary key,
  profile_id   uuid        not null,                 -- a quién se le cambió el permiso (sin FK: la historia queda)
  campo        text        not null check (campo in ('rol', 'activo', 'local')),
  antes        text,                                 -- NULL = no tenía (p. ej. local recién asignado)
  despues      text,                                 -- NULL = se le quitó
  cambiado_por uuid,                                 -- auth.uid(); NULL = sistema (sin sesión o service_role)
  -- 'manual' = anotado a mano por soporte (dueño de la tabla) tras la salida de urgencia de la guía 6.6
  origen       text        not null check (origen in ('sesion', 'service_role', 'sistema', 'manual')),
  cambiado_en  timestamptz not null default now()
);
comment on table public.bitacora_permisos is
  'B10 (mig 165): cambios de permisos de los usuarios (rol, activación, local). Solo inserción, desde los triggers. '
  'Arranca vacía: lo anterior a la 165 no quedó registrado.';

create index if not exists bitacora_permisos_perfil_idx on public.bitacora_permisos (profile_id, cambiado_en desc, id desc);

alter table public.bitacora_permisos enable row level security;

revoke all on table public.bitacora_permisos from public, anon, authenticated, service_role;
grant select on table public.bitacora_permisos to authenticated, service_role;
do $$
declare s text := pg_get_serial_sequence('public.bitacora_permisos', 'id');
begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s);
end $$;

drop policy if exists bitacora_permisos_lee_owner on public.bitacora_permisos;
create policy bitacora_permisos_lee_owner on public.bitacora_permisos
  for select to authenticated
  using (public.get_my_role() = 'owner'::public.user_role);

-- ── 2. Inmutable (también para el dueño de la tabla) ────────────────────────────────────────
create or replace function public.bitacora_permisos_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception 'B10: la bitácora de permisos no se edita ni se borra'
    using errcode = '42501';
end;
$function$;
revoke all on function public.bitacora_permisos_inmutable() from public, anon, authenticated;

drop trigger if exists trg_bitacora_permisos_inmutable on public.bitacora_permisos;
create trigger trg_bitacora_permisos_inmutable
  before update or delete on public.bitacora_permisos
  for each row execute function public.bitacora_permisos_inmutable();

drop trigger if exists trg_bitacora_permisos_sin_truncate on public.bitacora_permisos;
create trigger trg_bitacora_permisos_sin_truncate
  before truncate on public.bitacora_permisos
  for each statement execute function public.bitacora_permisos_inmutable();

-- ── 3. Quién: auth.uid() y el canal. Nunca falla (si el JWT no se puede leer, «sistema») ────
create or replace function public.bitacora_permisos_actor(out actor uuid, out origen text)
language plpgsql
stable
set search_path = public, pg_temp
as $function$
declare v jsonb;
begin
  begin
    v := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    if v is null then
      actor := null; origen := 'sistema';
    elsif v->>'role' = 'service_role' then
      actor := null; origen := 'service_role';
    else
      actor := auth.uid();
      origen := case when actor is null then 'sistema' else 'sesion' end;
    end if;
  exception when others then
    actor := null; origen := 'sistema';
  end;
end;
$function$;
revoke all on function public.bitacora_permisos_actor() from public, anon, authenticated;

-- ── 4. profiles: rol y activación ───────────────────────────────────────────────────────────
-- SECURITY DEFINER: inserta en una tabla donde nadie más puede insertar. Liviana: dos comparaciones y hasta
-- dos inserciones, sin lecturas.
create or replace function public.bitacora_permisos_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare a record;
begin
  select * into a from public.bitacora_permisos_actor();
  if old.role is distinct from new.role then
    insert into public.bitacora_permisos (profile_id, campo, antes, despues, cambiado_por, origen)
    values (new.id, 'rol', old.role::text, new.role::text, a.actor, a.origen);
  end if;
  if old.is_active is distinct from new.is_active then
    insert into public.bitacora_permisos (profile_id, campo, antes, despues, cambiado_por, origen)
    values (new.id, 'activo', old.is_active::text, new.is_active::text, a.actor, a.origen);
  end if;
  return null;
end;
$function$;
revoke all on function public.bitacora_permisos_profiles() from public, anon, authenticated;

drop trigger if exists trg_profiles_bitacora_permisos on public.profiles;
create trigger trg_profiles_bitacora_permisos
  after update of role, is_active on public.profiles
  for each row
  when (old.role is distinct from new.role or old.is_active is distinct from new.is_active)
  execute function public.bitacora_permisos_profiles();

-- ── 5. profile_locations: local asignado (mig 091) ──────────────────────────────────────────
create or replace function public.bitacora_permisos_locales()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  a record;
  v_antes text;
  v_despues text;
begin
  if tg_op = 'DELETE' then
    -- Borrado en cascada del perfil: no es un cambio de permiso, es la baja de la cuenta.
    if not exists (select 1 from public.profiles p where p.id = old.profile_id) then
      return null;
    end if;
  end if;

  select * into a from public.bitacora_permisos_actor();

  if tg_op in ('UPDATE', 'DELETE') then
    v_antes := old.location_id || case when old.principal then ' (principal)' else '' end;
  end if;
  if tg_op in ('UPDATE', 'INSERT') then
    v_despues := new.location_id || case when new.principal then ' (principal)' else '' end;
  end if;

  if tg_op = 'UPDATE' and old.profile_id is distinct from new.profile_id then
    -- Mover la fila a otro perfil: se le quita a uno y se le da a otro.
    insert into public.bitacora_permisos (profile_id, campo, antes, despues, cambiado_por, origen)
    values (old.profile_id, 'local', v_antes, null, a.actor, a.origen),
           (new.profile_id, 'local', null, v_despues, a.actor, a.origen);
  elsif v_antes is distinct from v_despues then
    insert into public.bitacora_permisos (profile_id, campo, antes, despues, cambiado_por, origen)
    values (coalesce(new.profile_id, old.profile_id), 'local', v_antes, v_despues, a.actor, a.origen);
  end if;
  return null;
end;
$function$;
revoke all on function public.bitacora_permisos_locales() from public, anon, authenticated;

drop trigger if exists trg_profile_locations_bitacora_permisos on public.profile_locations;
create trigger trg_profile_locations_bitacora_permisos
  after insert or update or delete on public.profile_locations
  for each row execute function public.bitacora_permisos_locales();

commit;
