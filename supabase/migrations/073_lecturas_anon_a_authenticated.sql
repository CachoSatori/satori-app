-- ============================================================================
-- 073_lecturas_anon_a_authenticated.sql — SEC-04: lecturas sin sesión
-- ----------------------------------------------------------------------------
-- Cinco policies SELECT estaban `to public` sin exigir sesión, así que `anon`
-- (con la anon key del bundle) leía propinas por empleado, sesiones y pozos de
-- propinas, puntos por rol, tipo de cambio y los empleados activos
-- (nombre, rol, pos_name, pos_login).
--
-- Cada policy se recrea IGUAL (misma condición, PERMISSIVE, SELECT) pero
-- `to authenticated`; los usuarios logueados ven exactamente lo mismo que antes.
-- Además se revoca SELECT de `anon` en las 5 tablas.
-- Ninguna pantalla sin sesión (/login, /registro) ni cron lee estas tablas con
-- la anon key (los crons y Edge Functions usan service_role).
-- Idempotente. Rollback de emergencia: scripts/sql/073_rollback.sql.
-- ============================================================================

begin;

drop policy if exists "Todos ven entradas de propinas" on public.tip_entries;
create policy "Todos ven entradas de propinas" on public.tip_entries
  for select to authenticated using (true);

drop policy if exists "Todos ven sesiones de propinas" on public.tip_sessions;
create policy "Todos ven sesiones de propinas" on public.tip_sessions
  for select to authenticated using (true);

drop policy if exists "Todos ven puntos por rol" on public.role_tip_points;
create policy "Todos ven puntos por rol" on public.role_tip_points
  for select to authenticated using (true);

drop policy if exists "Todos ven tipos de cambio" on public.exchange_rates;
create policy "Todos ven tipos de cambio" on public.exchange_rates
  for select to authenticated using (true);

drop policy if exists "Todos ven empleados activos" on public.employees;
create policy "Todos ven empleados activos" on public.employees
  for select to authenticated using (is_active = true);

revoke select on public.tip_entries     from anon;
revoke select on public.tip_sessions    from anon;
revoke select on public.role_tip_points from anon;
revoke select on public.exchange_rates  from anon;
revoke select on public.employees       from anon;

commit;
