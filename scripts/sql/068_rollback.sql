-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 068_rollback · Deshace supabase/migrations/068_profiles_cierre_escalada.sql          ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Definiciones textuales tomadas con pg_get_functiondef en el Paso 0 (04-nov-2026), idénticas en
-- prod (yiczgdtirrkdvohdquzf) y staging (hwiatgicyyqyezqwldia).
--
-- NO recrea `perfil_propio_update`: no existía en prod.
-- NO toca el ledger: si se corre, borrar a mano la fila 068 de supabase_migrations.schema_migrations
-- del entorno correspondiente (o dejarla y documentarlo).
-- Rollback del Paso A (fuera de SQL): Management API PATCH config/auth {"disable_signup": false} y
-- `banned_until = null` en las 2 cuentas baneadas (una manager f54e3eff…, una cuenta externa e317ac97…).

begin;

drop trigger if exists trg_profiles_guarda_roles on public.profiles;
drop trigger if exists trg_profiles_ultimo_owner on public.profiles;
drop function if exists public.profiles_guarda_roles();
drop function if exists public.profiles_ultimo_owner();

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT role FROM profiles WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'salonero'),
    false   -- nace pendiente; el owner la activa y asigna rol
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

commit;
