-- ============================================================
-- Auto-registro de usuarios (empleados) + aprobación del owner
-- ============================================================
-- El empleado se registra solo (nombre + correo + contraseña).
-- La cuenta nace PENDIENTE (is_active=false, sin acceso) hasta que
-- el owner le asigna rol y la activa. Guardamos el correo en el
-- perfil para enviar reportes de pago a futuro.

-- 1. Guardar el correo en el perfil
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill: copiar el correo de los usuarios existentes
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id AND p.email IS NULL;

-- 2. Trigger: las cuentas NUEVAS nacen pendientes (is_active=false) y
--    guardan el correo. Los usuarios existentes no se tocan.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
