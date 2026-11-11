-- Rollback de la 094: le devuelve a anon MAINTAIN en las tablas de la lista que existan (como antes de la 094) y borra
-- la fila del ledger. Si se corre en prod, en el mismo momento se revierte el merge en main.
begin;
do $$
declare v_t text;
begin
  foreach v_t in array array[
    'accounting_entries','cash_movements','cash_sessions','credit_applications','movement_deletions','movement_edits',
    'pos_ndf_cursor','pos_ndf_open','pos_ndf_ticket_lines','pos_ndf_tickets','product_map','punch_exceptions','sops',
    'supplier_credits','suppliers','time_punches','tip_entries','tip_sessions','ventas_comps','ventas_dias','ventas_hist',
    'ventas_metas','salary_periods'] loop
    continue when to_regclass('public.' || v_t) is null;
    execute format('grant maintain on table public.%I to anon', v_t);
  end loop;
end $$;
delete from supabase_migrations.schema_migrations where version = '094';
commit;
