-- 081_rollback · deshace supabase/migrations/081_rls_lectura_rol_activo.sql
-- Vuelve EXACTAMENTE a las condiciones leídas del catálogo el 07/11 (prod = staging).
-- «Solo owners crean/editan perfiles» se recrea (ALTER POLICY no puede sacar un WITH CHECK).
-- NO toca el ledger: si se corre, borrar la fila 081 de supabase_migrations.schema_migrations en la
-- misma transacción y sacar el .sql de main en la misma ventana (si no, Branching la reaplica).
begin;

alter policy "Todos ven empleados activos" on public.employees using (is_active = true);
alter policy "Todos ven entradas de propinas" on public.tip_entries using (true);
alter policy "Todos ven sesiones de propinas" on public.tip_sessions using (true);
alter policy "Todos ven puntos por rol" on public.role_tip_points using (true);
alter policy "Todos ven tipos de cambio" on public.exchange_rates using (true);
alter policy exchange_rates_read on public.exchange_rates using (true);

drop policy if exists "Solo owners crean/editan perfiles" on public.profiles;
create policy "Solo owners crean/editan perfiles" on public.profiles
  for all to public using (public.get_my_role() = 'owner'::public.user_role);

commit;
