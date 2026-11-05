-- 073_rollback.sql — SOLO EMERGENCIA. Vuelve a ABRIR la lectura anónima (SEC-04).
begin;
drop policy if exists "Todos ven entradas de propinas" on public.tip_entries;
create policy "Todos ven entradas de propinas" on public.tip_entries for select using (true);
drop policy if exists "Todos ven sesiones de propinas" on public.tip_sessions;
create policy "Todos ven sesiones de propinas" on public.tip_sessions for select using (true);
drop policy if exists "Todos ven puntos por rol" on public.role_tip_points;
create policy "Todos ven puntos por rol" on public.role_tip_points for select using (true);
drop policy if exists "Todos ven tipos de cambio" on public.exchange_rates;
create policy "Todos ven tipos de cambio" on public.exchange_rates for select using (true);
drop policy if exists "Todos ven empleados activos" on public.employees;
create policy "Todos ven empleados activos" on public.employees for select using ((is_active = true));
grant select on public.tip_entries, public.tip_sessions, public.role_tip_points, public.exchange_rates, public.employees to anon;
commit;
