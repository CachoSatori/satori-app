-- 072_rollback.sql — SOLO EMERGENCIA. Vuelve a ABRIR el agujero SEC-03 (escritura anónima en customers).
-- Recrea la policy y los grants tal como estaban antes de la 072 (mig 007 + grants por defecto de Supabase).
begin;
drop policy if exists customers_anon_insert on public.customers;
create policy customers_anon_insert on public.customers for insert to anon with check (true);
grant insert, update, delete on public.customers             to anon;
grant insert, update, delete on public.customer_interactions to anon;
grant insert, update, delete on public.loyalty_config        to anon;
grant insert, update, delete on public.loyalty_rewards       to anon;
commit;
