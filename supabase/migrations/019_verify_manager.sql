-- 019: verificación de gerencia server-side (Fase 2 cirugía de auth, HANG-RCA.md)
-- Reemplaza el cliente Supabase temporal del ManagerOverride (signInWithPassword
-- en el navegador, que podía colgarse y creaba una sesión paralela) por un RPC
-- SECURITY DEFINER: valida email+contraseña contra auth.users con pgcrypto y
-- exige rol owner/manager ACTIVO. No expone hashes ni toca la sesión del cajero.
-- Idempotente.

create or replace function public.verify_manager(p_email text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  -- Throttle mínimo anti fuerza-bruta (el endpoint de login de GoTrue tiene
  -- rate-limit propio; este RPC también debe costar algo).
  perform pg_sleep(0.3);
  select exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where lower(u.email) = lower(trim(p_email))
      and u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
      and p.role in ('owner', 'manager')
      and p.is_active
  ) into ok;
  return coalesce(ok, false);
end;
$$;

-- Solo usuarios logueados pueden invocarla (nunca anon).
revoke all on function public.verify_manager(text, text) from public, anon;
grant execute on function public.verify_manager(text, text) to authenticated;
