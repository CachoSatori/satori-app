-- staging_manager_prueba.sql · SOLO STAGING (ref hwiatgicyyqyezqwldia). NUNCA en prod ni en una base local de pruebas.
-- Crea (o deja al día) un usuario de prueba con rol MANAGER, ACTIVO y asignado al local `santa-teresa`, con datos 100 %
-- ficticios: «Manager Prueba» · manager.prueba@example.com · UUID fijo 00000000-0000-4000-8000-0000000e0001.
-- Lo piden las baterías que buscan un manager activo de la base (159, 163; 157 y 171 lo prefieren activo).
--
-- IDEMPOTENTE: se puede correr las veces que haga falta (también después de re-clonar staging desde prod, que borra el
-- usuario). Si el usuario ya existe NO le cambia la contraseña.
--
-- CONTRASEÑA: al crearlo se le pone una contraseña ALEATORIA que nadie conoce (se genera y se hashea adentro de la base;
-- no sale en ninguna salida). El repo no tiene un lugar para credenciales de staging: para entrar con este usuario a la
-- app de staging, el dueño le pone una contraseña nueva desde el panel de Supabase de staging (Authentication → Users →
-- el usuario → «Reset password» / «Send password recovery») y la guarda fuera del repo. Ver STAGING.md, «Manager de prueba».
--
-- Corre como administración (sin JWT): profiles_guarda_roles lo deja pasar y la bitácora de permisos (165) registra el
-- cambio de rol y de activo. Ritual (regla 7): leer el ref en pantalla antes de correrlo.
begin;

do $$
begin
  -- guardia: solo una base marcada como staging (scripts/sql/club_marcar_staging.sql); prod deja club_entorno vacía
  if not exists (select 1 from public.club_entorno where nombre = 'staging') then
    raise exception 'staging_manager_prueba: esta base NO está marcada como staging (club_entorno). No se toca nada.';
  end if;
  if not exists (select 1 from public.locations where id = 'santa-teresa') then
    raise exception 'staging_manager_prueba: no existe el local santa-teresa';
  end if;
end $$;

-- 1. Auth: usuario con correo confirmado (staging usa autoconfirm) + su identidad «email»
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000e0001', 'authenticated', 'authenticated',
        'manager.prueba@example.com',
        extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),   -- nadie la conoce
        now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Manager Prueba"}', now(), now(), '', '', '', '')
on conflict (id) do update
  set email = excluded.email, raw_user_meta_data = excluded.raw_user_meta_data,
      email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()), banned_until = null, updated_at = now();

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000e0001',
        '{"sub":"00000000-0000-4000-8000-0000000e0001","email":"manager.prueba@example.com","email_verified":true}',
        'email', null, now(), now())
on conflict (provider_id, provider) do update set identity_data = excluded.identity_data, updated_at = now();

-- 2. Perfil (handle_new_user lo crea como salonero inactivo): manager, activo, nombre ficticio
insert into public.profiles (id, full_name, email, role, is_active)
values ('00000000-0000-4000-8000-0000000e0001', 'Manager Prueba', 'manager.prueba@example.com', 'salonero', false)
on conflict (id) do nothing;
update public.profiles
   set full_name = 'Manager Prueba', email = 'manager.prueba@example.com', role = 'manager', is_active = true
 where id = '00000000-0000-4000-8000-0000000e0001'
   and (full_name, email, role::text, is_active) is distinct from ('Manager Prueba', 'manager.prueba@example.com', 'manager', true);

-- 3. Local: Santa Teresa como principal
insert into public.profile_locations (profile_id, location_id, principal)
values ('00000000-0000-4000-8000-0000000e0001', 'santa-teresa', true)
on conflict (profile_id, location_id) do update set principal = true;

-- 4. Verificación: si algo no quedó, aborta (y no queda nada)
do $$
begin
  if not exists (select 1 from public.profiles p
                  join public.profile_locations pl on pl.profile_id = p.id and pl.location_id = 'santa-teresa' and pl.principal
                 where p.id = '00000000-0000-4000-8000-0000000e0001' and p.role::text = 'manager' and p.is_active
                   and p.full_name = 'Manager Prueba')
     or not exists (select 1 from auth.identities where user_id = '00000000-0000-4000-8000-0000000e0001' and provider = 'email')
     or not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000e0001' and email_confirmed_at is not null
                      and encrypted_password like '$2%') then
    raise exception 'staging_manager_prueba: el manager de prueba no quedó completo';
  end if;
end $$;

select p.id, p.full_name, p.email, p.role::text as rol, p.is_active as activo,
       (select string_agg(location_id, ',') from public.profile_locations where profile_id = p.id) as locales
  from public.profiles p where p.id = '00000000-0000-4000-8000-0000000e0001';
commit;
