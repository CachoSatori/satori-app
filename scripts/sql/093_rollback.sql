-- Rollback de la 093: las 5 lecturas vuelven a `using (true)` (como las dejó la 011) y se borra su fila del ledger.
-- Si se corre en prod, en el mismo momento se revierte el merge en main (si el .sql queda, Branching la vuelve a aplicar).
begin;
alter policy ventas_dias_read  on public.ventas_dias  using (true);
alter policy ventas_hist_read  on public.ventas_hist  using (true);
alter policy ventas_metas_read on public.ventas_metas using (true);
alter policy ventas_comps_read on public.ventas_comps using (true);
alter policy product_map_read  on public.product_map  using (true);
delete from supabase_migrations.schema_migrations where version = '093';
commit;
