-- ============================================================================
-- 072_crm_cierre_anon.sql — SEC-03 · Club Satori F0: cerrar la escritura anónima del CRM
-- ----------------------------------------------------------------------------
-- La 007 dejó `customers_anon_insert` (INSERT to anon WITH CHECK (true)) + grant
-- insert a anon: cualquiera sin cuenta creaba clientes con points/tier/totales
-- arbitrarios, y el UNIQUE(phone) revelaba si un teléfono ya estaba en la base.
--
-- Esta migración:
--   1. borra la policy `customers_anon_insert`;
--   2. revoca INSERT/UPDATE/DELETE de `anon` en las 4 tablas del CRM
--      (los grants por defecto de Supabase; RLS ya los bloqueaba, salvo el INSERT).
-- No toca las policies de staff de la 004 ni el SELECT de anon (RLS lo filtra
-- por get_my_role(), que con anon es NULL → sin filas).
--
-- /registro y CrmQR quedan apagados en el front hasta la F1 del Club Satori
-- (función SECURITY DEFINER con validación y límite de tasa).
-- Idempotente. Rollback de emergencia: scripts/sql/072_rollback.sql.
-- ============================================================================

begin;

drop policy if exists customers_anon_insert on public.customers;

revoke insert, update, delete on public.customers             from anon;
revoke insert, update, delete on public.customer_interactions from anon;
revoke insert, update, delete on public.loyalty_config        from anon;
revoke insert, update, delete on public.loyalty_rewards       from anon;

commit;
