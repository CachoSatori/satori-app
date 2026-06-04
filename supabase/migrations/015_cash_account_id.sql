-- 015 — Cuenta contable explícita por movimiento de caja
-- Permite asignar a un movimiento su cuenta del P&L (finance_accounts) de forma
-- explícita. getLiveActuals la usa si está seteada; si no, cae al mapeo por
-- subcategoría. Cierra el hueco de gastos que no calzan por palabra clave
-- (alquiler, patentes, lavandería, suscripciones, etc.).
alter table cash_movements add column if not exists account_id text references finance_accounts(id);
