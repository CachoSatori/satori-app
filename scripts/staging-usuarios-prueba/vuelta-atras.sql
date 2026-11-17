-- Vuelta atrás del plan de usuarios de prueba. SOLO STAGING (confirmar el ref hwiatgicyyqyezqwldia).
-- NO EJECUTAR sin el OK del dueño. Correr solo la parte que haga falta.

-- (A) Levantar el ban de las cuentas neutralizadas (vuelven a poder entrar SOLO si alguien les pone una contraseña
--     nueva: la vieja no se guardó a propósito). Para una sola cuenta, agregar `and id = '<UUID>'`.
-- update auth.users set banned_until = null, updated_at = now()
--  where email not like '%@staging-satori.test' and banned_until > now() + interval '50 years';
-- Después, contraseña nueva por la API de admin (PUT /auth/v1/admin/users/<UUID>) o «Send password recovery»
-- desde el panel de staging. Nunca volver a copiar el hash de prod.

-- (B) Sacar los usuarios de prueba. Primero los empleados de prueba, después los usuarios por la API de admin
--     (DELETE /auth/v1/admin/users/<UUID>; cascade a profiles). Si un usuario de prueba ya dejó filas en cajas,
--     movimientos, órdenes, etc. (FK sin cascade), el borrado falla: en ese caso BANEARLO en vez de borrarlo.
-- delete from public.employees e using public.profiles p, auth.users u
--  where e.profile_id = p.id and u.id = p.id and u.email like '%@staging-satori.test';
-- update auth.users set banned_until = now() + interval '100 years'
--  where email like '%@staging-satori.test';      -- alternativa sin borrar

-- (C) Comprobación (solo conteos)
select count(*) filter (where email like '%@staging-satori.test')                          as de_prueba,
       count(*) filter (where email not like '%@staging-satori.test' and banned_until > now()) as no_prueba_baneados
from auth.users;
