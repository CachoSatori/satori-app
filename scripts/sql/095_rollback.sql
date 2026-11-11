-- Rollback de la 095: el contador deja de leer cash_movements, cash_sessions y suppliers (como antes). Borra la fila del
-- ledger. Si se corre en prod, en el mismo momento se revierte el merge en main.
begin;
drop policy if exists cash_movements_contador_select on public.cash_movements;
drop policy if exists cash_sessions_contador_select on public.cash_sessions;
drop policy if exists suppliers_contador_select on public.suppliers;
delete from supabase_migrations.schema_migrations where version = '095';
commit;
