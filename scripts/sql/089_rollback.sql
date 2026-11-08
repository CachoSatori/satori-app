-- Rollback de la 089: le devuelve a anon EXACTAMENTE lo que la 089 le saca (lo que tenía el 08-nov: prod, más las
-- tres tablas que solo existen en staging). Solo si Ismael lo pide; no abre nada por sí mismo (RLS sigue igual).
begin;
do $$
begin
  if to_regclass('public.accounting_entries') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.accounting_entries to anon'; end if;
  if to_regclass('public.cash_movements') is not null then execute 'grant truncate, references, trigger, delete, update on table public.cash_movements to anon'; end if;
  if to_regclass('public.cash_sessions') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.cash_sessions to anon'; end if;
  if to_regclass('public.credit_applications') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.credit_applications to anon'; end if;
  if to_regclass('public.movement_deletions') is not null then execute 'grant truncate, references, trigger, delete, update on table public.movement_deletions to anon'; end if;
  if to_regclass('public.movement_edits') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.movement_edits to anon'; end if;
  if to_regclass('public.pos_ndf_cursor') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.pos_ndf_cursor to anon'; end if;
  if to_regclass('public.pos_ndf_open') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.pos_ndf_open to anon'; end if;
  if to_regclass('public.pos_ndf_ticket_lines') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.pos_ndf_ticket_lines to anon'; end if;
  if to_regclass('public.pos_ndf_tickets') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.pos_ndf_tickets to anon'; end if;
  if to_regclass('public.product_map') is not null then execute 'grant truncate, references, trigger, select, insert, update, delete on table public.product_map to anon'; end if;
  if to_regclass('public.sops') is not null then execute 'grant truncate, references, trigger, select, insert, update, delete on table public.sops to anon'; end if;
  if to_regclass('public.supplier_credits') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.supplier_credits to anon'; end if;
  if to_regclass('public.suppliers') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.suppliers to anon'; end if;
  if to_regclass('public.tip_entries') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.tip_entries to anon'; end if;
  if to_regclass('public.tip_sessions') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.tip_sessions to anon'; end if;
  if to_regclass('public.ventas_comps') is not null then execute 'grant truncate, references, trigger, select, insert, update, delete on table public.ventas_comps to anon'; end if;
  if to_regclass('public.ventas_dias') is not null then execute 'grant truncate, references, trigger, select, insert, update, delete on table public.ventas_dias to anon'; end if;
  if to_regclass('public.ventas_hist') is not null then execute 'grant truncate, references, trigger, select, insert, update, delete on table public.ventas_hist to anon'; end if;
  if to_regclass('public.ventas_metas') is not null then execute 'grant truncate, references, trigger, select, insert, update, delete on table public.ventas_metas to anon'; end if;
  if to_regclass('public.punch_exceptions') is not null then execute 'grant truncate, references, trigger, delete, insert on table public.punch_exceptions to anon'; end if;
  if to_regclass('public.time_punches') is not null then execute 'grant truncate, references, trigger, delete, insert, update on table public.time_punches to anon'; end if;
  if to_regclass('public.salary_periods') is not null then execute 'grant truncate, references, trigger on table public.salary_periods to anon'; end if;
end $$;
delete from supabase_migrations.schema_migrations where version = '089';
commit;
