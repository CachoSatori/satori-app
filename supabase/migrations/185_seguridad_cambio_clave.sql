-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 185 (origen caja 099) · Seguridad · Obligar a cambiar la contraseña al entrar           ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Decisión del dueño (17-nov 14:44 CR): poder OBLIGAR a un usuario a cambiar su contraseña la próxima vez que entra
-- (cuentas cuyo hash de contraseña estuvo copiado en staging). Pedírselo no alcanza.
--
-- Qué hace (y nada más):
--   1. Tabla `seguridad_cambio_clave`: una fila por usuario marcado, con la HUELLA (md5) del hash de contraseña que tenía
--      cuando se lo marcó. No guarda contraseñas ni hashes: solo el md5 del hash, que no sirve para entrar.
--      RLS: cada usuario lee SOLO su fila y sin la huella (permiso por columna); nadie escribe directo (ni el owner por la
--      API, ni service_role). Escriben solo las funciones de abajo.
--   2. `seguridad_marcar_cambio_clave(p_user)`: solo owner activo (get_my_role(), que ya exige is_active). Guarda la huella
--      del hash actual. Si ya estaba marcado, renueva la marca con la huella de hoy.
--   3. `seguridad_debo_cambiar_clave()`: para el usuario de la sesión. true si tiene fila y su hash actual sigue igual a la
--      huella. Si ya la cambió por cualquier vía (Mi cuenta, recuperación, el dashboard), borra la fila y devuelve false.
--   4. `seguridad_desmarcar_cambio_clave(p_user)` (owner): saca una marca puesta por error.
--   5. `seguridad_cambio_clave_pendientes()` (owner): lista quién sigue pendiente; antes limpia a los que ya cambiaron.
--
-- Qué NO hace:
--   · No toca `profiles` (ni columnas ni triggers): la bitácora de permisos (165) no se dispara (regla 12 de ESTADO).
--   · No toca `auth.*` salvo LEER `auth.users.encrypted_password` del usuario marcado o del de la sesión.
--   · No bloquea nada del lado del servidor: el corte lo hace la app (solo deja entrar a /mi-cuenta). Quien tenga la
--     contraseña vieja puede seguir usando la API hasta que la cambien: la protección real es el cambio en sí.
--
-- Re-ejecutable (`if not exists`, `create or replace`, `drop policy if exists`).
-- Rollback: scripts/sql/185_rollback.sql. Pruebas: scripts/sql/185_pruebas.sql (+ 185_pruebas.py).

begin;

-- ── 1. Tabla ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.seguridad_cambio_clave (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  marcado_en  timestamptz not null default now(),
  marcado_por uuid,                          -- auth.uid() del owner (sin FK: la marca sobrevive si se borra quien marcó)
  huella_hash text        not null check (huella_hash ~ '^[0-9a-f]{32}$')   -- md5 del hash de contraseña al marcar
);
comment on table public.seguridad_cambio_clave is
  'Mig 185: usuarios obligados a cambiar la contraseña al entrar. Huella = md5 del hash de contraseña al marcar; '
  'si el hash cambió, la marca se borra sola. Escriben solo las funciones seguridad_*.';

alter table public.seguridad_cambio_clave enable row level security;

revoke all on table public.seguridad_cambio_clave from public, anon, authenticated, service_role;
-- El usuario ve su marca (sin la huella). La app no la lee directo: usa seguridad_debo_cambiar_clave().
grant select (user_id, marcado_en) on table public.seguridad_cambio_clave to authenticated;

drop policy if exists seguridad_cambio_clave_lee_propia on public.seguridad_cambio_clave;
create policy seguridad_cambio_clave_lee_propia on public.seguridad_cambio_clave
  for select to authenticated using (user_id = auth.uid());

-- ── 2. Marcar (owner activo) ────────────────────────────────────────────────────────────────
create or replace function public.seguridad_marcar_cambio_clave(p_user uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
begin
  if public.get_my_role() is distinct from 'owner' then
    raise exception 'Solo el dueño puede pedir un cambio de contraseña' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'Falta el usuario' using errcode = '22004';
  end if;
  select u.encrypted_password into v_hash from auth.users u where u.id = p_user;
  if not found then
    raise exception 'Ese usuario no existe' using errcode = 'P0002';
  end if;
  if coalesce(v_hash, '') = '' then
    raise exception 'Esa cuenta no tiene contraseña: no hay nada que cambiar' using errcode = '22023';
  end if;
  insert into public.seguridad_cambio_clave (user_id, marcado_en, marcado_por, huella_hash)
  values (p_user, now(), auth.uid(), md5(v_hash))
  on conflict (user_id) do update
    set marcado_en = excluded.marcado_en, marcado_por = excluded.marcado_por, huella_hash = excluded.huella_hash;
  return now();
end;
$$;

-- ── 3. ¿Debo cambiarla? (el usuario de la sesión) ───────────────────────────────────────────
create or replace function public.seguridad_debo_cambiar_clave()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_huella text;
  v_hash   text;
begin
  if v_uid is null then
    return false;
  end if;
  select c.huella_hash into v_huella from public.seguridad_cambio_clave c where c.user_id = v_uid;
  if not found then
    return false;
  end if;
  select u.encrypted_password into v_hash from auth.users u where u.id = v_uid;
  if v_hash is not null and md5(v_hash) = v_huella then
    return true;
  end if;
  -- ya la cambió (por cualquier vía): se libera
  delete from public.seguridad_cambio_clave c where c.user_id = v_uid;
  return false;
end;
$$;

-- ── 4. Desmarcar (owner activo) ─────────────────────────────────────────────────────────────
create or replace function public.seguridad_desmarcar_cambio_clave(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is distinct from 'owner' then
    raise exception 'Solo el dueño puede sacar un pedido de cambio de contraseña' using errcode = '42501';
  end if;
  delete from public.seguridad_cambio_clave c where c.user_id = p_user;
  return found;
end;
$$;

-- ── 5. Pendientes (owner activo) ────────────────────────────────────────────────────────────
create or replace function public.seguridad_cambio_clave_pendientes()
returns table (user_id uuid, marcado_en timestamptz, marcado_por uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.get_my_role() is distinct from 'owner' then
    raise exception 'Solo el dueño ve los pedidos de cambio de contraseña' using errcode = '42501';
  end if;
  -- los que ya cambiaron la contraseña dejan de estar pendientes
  delete from public.seguridad_cambio_clave c
   where not exists (select 1 from auth.users u
                      where u.id = c.user_id and u.encrypted_password is not null
                        and md5(u.encrypted_password) = c.huella_hash);
  return query
    select c.user_id, c.marcado_en, c.marcado_por
      from public.seguridad_cambio_clave c
     order by c.marcado_en desc, c.user_id;
end;
$$;

-- ── 6. Permisos de las funciones: solo authenticated (el rol se valida adentro) ──────────────
revoke all on function public.seguridad_marcar_cambio_clave(uuid)    from public, anon;
revoke all on function public.seguridad_debo_cambiar_clave()         from public, anon;
revoke all on function public.seguridad_desmarcar_cambio_clave(uuid) from public, anon;
revoke all on function public.seguridad_cambio_clave_pendientes()    from public, anon;
grant execute on function public.seguridad_marcar_cambio_clave(uuid)    to authenticated;
grant execute on function public.seguridad_debo_cambiar_clave()         to authenticated;
grant execute on function public.seguridad_desmarcar_cambio_clave(uuid) to authenticated;
grant execute on function public.seguridad_cambio_clave_pendientes()    to authenticated;

commit;
