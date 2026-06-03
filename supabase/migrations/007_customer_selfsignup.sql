-- ============================================================================
-- 007_customer_selfsignup.sql — Auto-registro público de clientes (QR → formulario)
-- ----------------------------------------------------------------------------
-- Permite a usuarios ANÓNIMOS (no logueados) INSERTAR en customers desde el
-- formulario público de registro. NO pueden leer ni editar otros clientes
-- (eso sigue restringido a gerencia+cajero por las policies de 004_customers).
-- Idempotente.
-- ============================================================================

drop policy if exists customers_anon_insert on public.customers;
create policy customers_anon_insert
  on public.customers
  for insert
  to anon
  with check (true);

-- Asegurar el grant de INSERT al rol anónimo (RLS sigue gobernando qué se puede)
grant insert on public.customers to anon;
