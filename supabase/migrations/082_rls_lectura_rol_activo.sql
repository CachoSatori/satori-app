-- ============================================================================
-- 082_rls_lectura_rol_activo.sql — SEC-01c: las lecturas «para todos» exigen rol ACTIVO
-- ----------------------------------------------------------------------------
-- Auditoría r5 (SEC-01c). Desde la 069, `get_my_role()` devuelve null si la cuenta está inactiva,
-- y todas las policies que lo usan ya cortan a las cuentas inactivas. Pero las policies de
-- LECTURA «para todos» de la 073 no miran al lector: una cuenta desactivada que conserva su
-- contraseña seguía leyendo propinas, sesiones, puntos, tipo de cambio y empleados.
--
-- Estado REAL de las dos bases (catálogo leído el 07/11, igual en prod y staging), que no es el
-- de la 001: `profiles` ya usa `get_my_role()` en todas sus policies («Owners y managers ven
-- todos los perfiles», «Solo owners crean/editan perfiles») más «Perfil propio visible»; las
-- policies `owner_*_profiles` de la 001 no existen. `exchange_rates` tiene DOS lecturas para
-- todos («Todos ven tipos de cambio» y `exchange_rates_read`).
--
-- Cambios (con `alter policy`: mismo nombre, mismos roles, mismo comando):
--   1. Lecturas para todos → además `get_my_role() is not null` (cuenta con rol y ACTIVA):
--      employees «Todos ven empleados activos», tip_entries, tip_sessions, role_tip_points y las
--      dos de exchange_rates.
--   2. profiles «Solo owners crean/editan perfiles»: WITH CHECK explícito igual al USING (hoy es
--      null y Postgres usa el USING; queda escrito para que nadie lo afloje sin verlo).
--   3. «Perfil propio visible» NO cambia: el propio perfil sigue legible con la cuenta inactiva
--      (la app lo necesita para mostrar el estado de la cuenta). Decisión de Ismael, 07/11.
--
-- Lo que ven los usuarios ACTIVOS no cambia. anon no cambia (no tiene SELECT en estas tablas
-- salvo profiles, donde ninguna policy le devuelve filas).
-- Re-ejecutable. Rollback: scripts/sql/082_rollback.sql (vuelve a las condiciones de antes).
-- ============================================================================

begin;

alter policy "Todos ven empleados activos" on public.employees
  using (is_active = true and public.get_my_role() is not null);

alter policy "Todos ven entradas de propinas" on public.tip_entries
  using (public.get_my_role() is not null);

alter policy "Todos ven sesiones de propinas" on public.tip_sessions
  using (public.get_my_role() is not null);

alter policy "Todos ven puntos por rol" on public.role_tip_points
  using (public.get_my_role() is not null);

alter policy "Todos ven tipos de cambio" on public.exchange_rates
  using (public.get_my_role() is not null);

alter policy exchange_rates_read on public.exchange_rates
  using (public.get_my_role() is not null);

alter policy "Solo owners crean/editan perfiles" on public.profiles
  using      (public.get_my_role() = 'owner'::public.user_role)
  with check (public.get_my_role() = 'owner'::public.user_role);

commit;
