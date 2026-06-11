-- staging-drift-sync.sql — Reconciliación de schema drift PROD → STAGING (2026-06-10)
-- Generado comparando information_schema/pg_catalog de prod (solo lectura) vs staging.
-- CORRER SOLO EN STAGING (hwiatgicyyqyezqwldia). Idempotente. NO contiene datos de prod.
-- Diferencias intencionales que NO sincroniza (ver nota en ESTADO.md):
--   · orden interno del enum user_role (valores idénticos, Postgres no permite reordenar)
--   · índices de performance extra en staging (idx_*_status/active/profile/employee) — inocuos
begin;

-- ── 1. Policies: drop de todas las de staging ──
drop policy if exists "cash_cierres_dia_all" on public.cash_cierres_dia;
drop policy if exists "caja_movimientos_insert_update" on public.cash_movements;
drop policy if exists "caja_movimientos_select" on public.cash_movements;
drop policy if exists "cash_movements_op_write" on public.cash_movements;
drop policy if exists "caja_insert_update" on public.cash_sessions;
drop policy if exists "caja_select" on public.cash_sessions;
drop policy if exists "cash_sessions_op_write" on public.cash_sessions;
drop policy if exists "crm_gestionan_interacciones" on public.customer_interactions;
drop policy if exists "crm_ver_interacciones" on public.customer_interactions;
drop policy if exists "crm_gestionan_clientes" on public.customers;
drop policy if exists "crm_ver_clientes" on public.customers;
drop policy if exists "customers_anon_insert" on public.customers;
drop policy if exists "documents_rw" on public.documents;
drop policy if exists "owner_manager_gestionan_empleados" on public.employees;
drop policy if exists "todos_ven_empleados_activos" on public.employees;
drop policy if exists "exchange_rates_read" on public.exchange_rates;
drop policy if exists "exchange_rates_write" on public.exchange_rates;
drop policy if exists "gerencia_registra_tipos_cambio" on public.exchange_rates;
drop policy if exists "todos_ven_tipos_cambio" on public.exchange_rates;
drop policy if exists "fin_acc_r" on public.finance_accounts;
drop policy if exists "fin_acc_w" on public.finance_accounts;
drop policy if exists "fin_act_r" on public.finance_actuals;
drop policy if exists "fin_act_w" on public.finance_actuals;
drop policy if exists "fin_bud_r" on public.finance_budget;
drop policy if exists "fin_bud_w" on public.finance_budget;
drop policy if exists "ip_read" on public.ingredient_prices;
drop policy if exists "ip_write" on public.ingredient_prices;
drop policy if exists "ingredients_all" on public.ingredients;
drop policy if exists "inv_write_ingredients" on public.ingredients;
drop policy if exists "inv_write_mov" on public.inventory_movements;
drop policy if exists "inventory_movements_all" on public.inventory_movements;
drop policy if exists "loyalty_cfg_editar" on public.loyalty_config;
drop policy if exists "loyalty_cfg_ver" on public.loyalty_config;
drop policy if exists "loyalty_rew_gestionar" on public.loyalty_rewards;
drop policy if exists "loyalty_rew_ver" on public.loyalty_rewards;
drop policy if exists "product_map_all" on public.product_map;
drop policy if exists "product_map_read" on public.product_map;
drop policy if exists "product_map_write" on public.product_map;
drop policy if exists "owner_select_all_profiles" on public.profiles;
drop policy if exists "owner_update_all_profiles" on public.profiles;
drop policy if exists "perfil_propio_select" on public.profiles;
drop policy if exists "perfil_propio_update" on public.profiles;
drop policy if exists "recipe_ingredients_all" on public.recipe_ingredients;
drop policy if exists "recipes_all" on public.recipes;
drop policy if exists "owner_edita_puntos_rol" on public.role_tip_points;
drop policy if exists "todos_ven_puntos_rol" on public.role_tip_points;
drop policy if exists "sops_all" on public.sops;
drop policy if exists "sops_read" on public.sops;
drop policy if exists "sops_write" on public.sops;
drop policy if exists "sim_read" on public.supplier_item_map;
drop policy if exists "sim_write" on public.supplier_item_map;
drop policy if exists "gerencia_ve_proveedores" on public.suppliers;
drop policy if exists "owner_manager_gestionan_proveedores" on public.suppliers;
drop policy if exists "suppliers_op_write" on public.suppliers;
drop policy if exists "empleado_ve_sus_entradas" on public.tip_entries;
drop policy if exists "gerencia_ve_entradas_propinas" on public.tip_entries;
drop policy if exists "owner_manager_gestionan_entradas" on public.tip_entries;
drop policy if exists "tip_entries_op_write" on public.tip_entries;
drop policy if exists "empleados_ven_sesion_abierta" on public.tip_sessions;
drop policy if exists "gerencia_ve_sesiones_propinas" on public.tip_sessions;
drop policy if exists "owner_manager_gestionan_sesiones_propinas" on public.tip_sessions;
drop policy if exists "tip_sessions_op_write" on public.tip_sessions;
drop policy if exists "ventas_comps_all" on public.ventas_comps;
drop policy if exists "ventas_comps_read" on public.ventas_comps;
drop policy if exists "ventas_comps_write" on public.ventas_comps;
drop policy if exists "ventas_dias_all" on public.ventas_dias;
drop policy if exists "ventas_dias_read" on public.ventas_dias;
drop policy if exists "ventas_dias_write" on public.ventas_dias;
drop policy if exists "ventas_hist_all" on public.ventas_hist;
drop policy if exists "ventas_hist_read" on public.ventas_hist;
drop policy if exists "ventas_hist_write" on public.ventas_hist;
drop policy if exists "ventas_metas_all" on public.ventas_metas;
drop policy if exists "ventas_metas_read" on public.ventas_metas;
drop policy if exists "ventas_metas_write" on public.ventas_metas;

-- ── 2. Tipos: prod usa text+CHECK donde staging tiene enums; currency_type→currency ──
alter table public.cash_movements alter column status drop default;
alter table public.cash_movements alter column status type text using status::text;
alter table public.cash_movements alter column status set default 'pendiente'::text;
alter table public.cash_movements alter column movement_type type text using movement_type::text;
alter table public.cash_sessions alter column status drop default;
alter table public.cash_sessions alter column status type text using status::text;
alter table public.cash_sessions alter column status set default 'open'::text;
alter table public.tip_sessions alter column status drop default;
alter table public.tip_sessions alter column status type text using status::text;
alter table public.tip_sessions alter column status set default 'open'::text;
do $$ begin
  if exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='currency_type') then
    alter type public.currency_type rename to currency;
  end if;
end $$;
drop type if exists public.session_status;
drop type if exists public.movement_status;
drop type if exists public.movement_type;

-- ── 3. Columnas que faltan en staging (causa de los 400) ──
alter table public.cash_movements add column if not exists amount_usd numeric default 0;
alter table public.cash_movements add column if not exists caja_origen text default 'Caja Fuerte'::text;
alter table public.cash_movements add column if not exists employee_name text default ''::text;
alter table public.cash_movements add column if not exists method text default 'Efectivo'::text;
alter table public.cash_movements add column if not exists shift text default ''::text;
alter table public.cash_movements add column if not exists subcategory text default ''::text;
alter table public.cash_movements add column if not exists supplier_name text default ''::text;
alter table public.cash_sessions add column if not exists cajero_name text default ''::text;
alter table public.cash_sessions add column if not exists final_cash_crc numeric;
alter table public.cash_sessions add column if not exists final_cash_usd numeric;
alter table public.cash_sessions add column if not exists initial_cash_crc numeric default 0;
alter table public.cash_sessions add column if not exists initial_cash_usd numeric default 0;
alter table public.cash_sessions add column if not exists shift_type varchar default 'Noche'::character varying;
alter table public.employees add column if not exists pos_name text;
alter table public.suppliers add column if not exists ciclo_pago text default 'Semanal'::text;
alter table public.suppliers add column if not exists cuenta_iban text default ''::text;
alter table public.suppliers add column if not exists metodo_pago text default 'Efectivo'::text;
alter table public.suppliers add column if not exists moneda text default 'CRC'::text;
-- staging tenía suppliers.payment_iban (001); prod la reemplazó por cuenta_iban
update public.suppliers set cuenta_iban = coalesce(payment_iban,'') where coalesce(cuenta_iban,'')='' and payment_iban is not null;
alter table public.suppliers drop column if exists payment_iban;

-- ── 4. Defaults y nullability alineados a prod ──
alter table public.cash_cierres_dia alter column ajuste_motivo set default ''::text;
alter table public.cash_cierres_dia alter column ajuste_tipo set default ''::text;
alter table public.cash_cierres_dia alter column created_at set default now();
alter table public.cash_cierres_dia alter column diferencia_crc set default 0;
alter table public.cash_cierres_dia alter column ef_real_m_crc set default 0;
alter table public.cash_cierres_dia alter column ef_real_n_crc set default 0;
alter table public.cash_cierres_dia alter column manager set default ''::text;
alter table public.cash_cierres_dia alter column manager set not null;
alter table public.cash_cierres_dia alter column notas set default ''::text;
alter table public.cash_cierres_dia alter column otros_m_crc set default 0;
alter table public.cash_cierres_dia alter column otros_n_crc set default 0;
alter table public.cash_cierres_dia alter column propinas_m_crc set default 0;
alter table public.cash_cierres_dia alter column propinas_n_crc set default 0;
alter table public.cash_cierres_dia alter column remanente_crc set default 0;
alter table public.cash_cierres_dia alter column remanente_usd set default 0;
alter table public.cash_cierres_dia alter column sep_diaria_crc set default 0;
alter table public.cash_cierres_dia alter column sep_diaria_usd set default 0;
alter table public.cash_cierres_dia alter column sep_registradora_crc set default 0;
alter table public.cash_cierres_dia alter column sep_registradora_usd set default 0;
alter table public.cash_cierres_dia alter column session_date set not null;
alter table public.cash_cierres_dia alter column tipo set default 'parcial_mediodia'::text;
alter table public.cash_cierres_dia alter column tipo set not null;
alter table public.cash_cierres_dia alter column tipo_cambio set default 640;
alter table public.cash_cierres_dia alter column updated_at set default now();
alter table public.cash_cierres_dia alter column vm_crc set default 0;
alter table public.cash_cierres_dia alter column vm_usd set default 0;
alter table public.cash_cierres_dia alter column vn_crc set default 0;
alter table public.cash_cierres_dia alter column vn_usd set default 0;
alter table public.exchange_rates alter column source drop not null;
alter table public.ingredients alter column category set default ''::text;
alter table public.ingredients alter column cost_per_unit set default 0;
alter table public.ingredients alter column created_at set default now();
alter table public.ingredients alter column current_stock set default 0;
alter table public.ingredients alter column min_stock set default 0;
alter table public.ingredients alter column name set not null;
alter table public.ingredients alter column notes set default ''::text;
alter table public.ingredients alter column supplier set default ''::text;
alter table public.ingredients alter column unit set default 'unidad'::text;
alter table public.ingredients alter column unit set not null;
alter table public.ingredients alter column updated_at set default now();
alter table public.inventory_movements alter column created_at set default now();
alter table public.inventory_movements alter column created_by set default ''::text;
alter table public.inventory_movements alter column ingredient_id set not null;
alter table public.inventory_movements alter column movement_type set not null;
alter table public.inventory_movements alter column notes set default ''::text;
alter table public.inventory_movements alter column qty_delta set not null;
alter table public.inventory_movements alter column reference_id set default ''::text;
alter table public.inventory_movements alter column unit set not null;
alter table public.product_map alter column clasificacion set default ''::text;
alter table public.product_map alter column costo_unitario set default 0;
alter table public.product_map alter column multiplicador set default 1;
alter table public.product_map alter column subclasificacion set default ''::text;
alter table public.product_map alter column tipo set default 'desconocido'::text;
alter table public.product_map alter column tipo set not null;
alter table public.product_map alter column updated_at set default now();
alter table public.recipe_ingredients alter column ingredient_id set not null;
alter table public.recipe_ingredients alter column quantity set not null;
alter table public.recipe_ingredients alter column recipe_id set not null;
alter table public.recipe_ingredients alter column unit set not null;
alter table public.recipe_ingredients alter column waste_factor set default 0.00;
alter table public.recipes alter column created_at set default now();
alter table public.recipes alter column notes set default ''::text;
alter table public.recipes alter column product_name set not null;
alter table public.recipes alter column updated_at set default now();
alter table public.recipes alter column yield_qty set default 1;
alter table public.recipes alter column yield_unit set default 'porcion'::text;
alter table public.role_tip_points alter column points type numeric using points::numeric;
alter table public.role_tip_points alter column points drop default;
alter table public.sops alter column category set default 'General'::text;
alter table public.sops alter column category set not null;
alter table public.sops alter column content set default ''::text;
alter table public.sops alter column content set not null;
alter table public.sops alter column created_at set default now();
alter table public.sops alter column display_order set default 0;
alter table public.sops alter column is_active set default true;
alter table public.sops alter column title set not null;
alter table public.sops alter column updated_at set default now();
alter table public.tip_entries alter column hours_worked drop default;
alter table public.tip_sessions alter column exchange_rate set default 520.00;
alter table public.ventas_comps alter column created_at set default now();
alter table public.ventas_comps alter column data set not null;
alter table public.ventas_comps alter column updated_at set default now();
alter table public.ventas_dias alter column data set not null;
alter table public.ventas_dias alter column session_date set not null;
alter table public.ventas_dias alter column uploaded_at set default now();
alter table public.ventas_hist alter column data set not null;
alter table public.ventas_hist alter column source set default 'hist'::text;
alter table public.ventas_metas alter column updated_at set default now();
alter table public.ventas_metas alter column value set not null;

-- ── 5. Constraints (checks/FKs/uniques de prod) ──
alter table public.cash_movements drop constraint if exists cash_movements_supplier_id_fkey;
alter table public.cash_movements drop constraint if exists cash_movements_movement_type_check;
alter table public.cash_movements add constraint cash_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['ingreso'::text, 'egreso_mercaderia'::text, 'egreso_personal'::text, 'egreso_operativo'::text, 'egreso_socios'::text, 'traspaso'::text])));
alter table public.cash_movements drop constraint if exists cash_movements_status_check;
alter table public.cash_movements add constraint cash_movements_status_check CHECK ((status = ANY (ARRAY['pendiente'::text, 'aprobado'::text, 'rechazado'::text])));
alter table public.cash_movements drop constraint if exists fk_cash_movements_supplier;
alter table public.cash_movements add constraint fk_cash_movements_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
alter table public.cash_sessions drop constraint if exists cash_sessions_status_check;
alter table public.cash_sessions add constraint cash_sessions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public.exchange_rates drop constraint if exists exchange_rates_rate_date_key;
alter table public.exchange_rates add constraint exchange_rates_rate_date_key UNIQUE (rate_date);
alter table public.exchange_rates drop constraint if exists exchange_rates_rate_date_unique;
alter table public.exchange_rates add constraint exchange_rates_rate_date_unique UNIQUE (rate_date);
alter table public.ingredients drop constraint if exists ingredients_name_key;
alter table public.ingredients add constraint ingredients_name_key UNIQUE (name);
alter table public.inventory_movements drop constraint if exists inventory_movements_cash_movement_id_fkey;
alter table public.inventory_movements add constraint inventory_movements_cash_movement_id_fkey FOREIGN KEY (cash_movement_id) REFERENCES cash_movements(id) ON DELETE SET NULL;
alter table public.inventory_movements drop constraint if exists inventory_movements_document_id_fkey;
alter table public.inventory_movements add constraint inventory_movements_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
alter table public.inventory_movements drop constraint if exists inventory_movements_ingredient_id_fkey;
alter table public.inventory_movements add constraint inventory_movements_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE;
alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['purchase'::text, 'waste'::text, 'count_adjustment'::text, 'sale_deduction'::text, 'transfer'::text])));
alter table public.product_map drop constraint if exists product_map_costo_unitario_check;
alter table public.product_map add constraint product_map_costo_unitario_check CHECK ((costo_unitario >= (0)::numeric));
alter table public.recipe_ingredients drop constraint if exists recipe_ingredients_ingredient_id_fkey;
alter table public.recipe_ingredients add constraint recipe_ingredients_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE RESTRICT;
alter table public.recipe_ingredients drop constraint if exists recipe_ingredients_recipe_id_fkey;
alter table public.recipe_ingredients add constraint recipe_ingredients_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE;
alter table public.recipe_ingredients drop constraint if exists recipe_ingredients_recipe_id_ingredient_id_key;
alter table public.recipe_ingredients add constraint recipe_ingredients_recipe_id_ingredient_id_key UNIQUE (recipe_id, ingredient_id);
alter table public.recipes drop constraint if exists recipes_product_name_key;
alter table public.recipes add constraint recipes_product_name_key UNIQUE (product_name);
alter table public.role_tip_points drop constraint if exists role_tip_points_points_check;
alter table public.role_tip_points add constraint role_tip_points_points_check CHECK ((points > (0)::numeric));
alter table public.sops drop constraint if exists sops_created_by_fkey;
alter table public.sops add constraint sops_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table public.tip_entries drop constraint if exists tip_entries_hours_worked_check;
alter table public.tip_entries add constraint tip_entries_hours_worked_check CHECK ((hours_worked > (0)::numeric));
alter table public.tip_sessions drop constraint if exists tip_sessions_status_check;
alter table public.tip_sessions add constraint tip_sessions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public.ventas_dias drop constraint if exists ventas_dias_session_date_key;
alter table public.ventas_dias add constraint ventas_dias_session_date_key UNIQUE (session_date);
alter table public.ventas_dias drop constraint if exists ventas_dias_uploaded_by_fkey;
alter table public.ventas_dias add constraint ventas_dias_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES profiles(id);

-- ── 6. Índices ──
CREATE INDEX IF NOT EXISTS idx_employees_pos_name ON public.employees USING btree (pos_name);
CREATE INDEX IF NOT EXISTS idx_ventas_dias_date ON public.ventas_dias USING btree (session_date);

-- ── 7. Funciones ──
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT role FROM profiles WHERE id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_ingredient_stock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.ingredients
  SET current_stock = current_stock + NEW.qty_delta, updated_at = now()
  WHERE id = NEW.ingredient_id;
  RETURN NEW;
END;
$function$;

-- ── 8. Triggers ──
drop trigger if exists cash_movements_updated_at on public.cash_movements;
drop trigger if exists cash_sessions_updated_at on public.cash_sessions;
drop trigger if exists employees_updated_at on public.employees;
drop trigger if exists profiles_updated_at on public.profiles;
drop trigger if exists suppliers_updated_at on public.suppliers;
drop trigger if exists tip_entries_updated_at on public.tip_entries;
drop trigger if exists tip_sessions_updated_at on public.tip_sessions;
drop trigger if exists trg_cash_movements_updated_at on public.cash_movements;
CREATE TRIGGER trg_cash_movements_updated_at BEFORE UPDATE ON public.cash_movements FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
drop trigger if exists trg_cash_sessions_updated_at on public.cash_sessions;
CREATE TRIGGER trg_cash_sessions_updated_at BEFORE UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
drop trigger if exists trg_employees_updated_at on public.employees;
CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
drop trigger if exists trg_update_stock on public.inventory_movements;
CREATE TRIGGER trg_update_stock AFTER INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION update_ingredient_stock();
drop trigger if exists trg_profiles_updated_at on public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
drop trigger if exists trg_suppliers_updated_at on public.suppliers;
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
drop trigger if exists trg_tip_entries_updated_at on public.tip_entries;
CREATE TRIGGER trg_tip_entries_updated_at BEFORE UPDATE ON public.tip_entries FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
drop trigger if exists trg_tip_sessions_updated_at on public.tip_sessions;
CREATE TRIGGER trg_tip_sessions_updated_at BEFORE UPDATE ON public.tip_sessions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── 9. Policies: recreación espejo EXACTO de prod ──
create policy "cierre_read" on public.cash_cierres_dia for select using ((auth.role() = 'authenticated'::text));
create policy "cierre_write" on public.cash_cierres_dia for all using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role, 'contador'::user_role]))))));
create policy "Managers y owners ven movimientos" on public.cash_movements for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "cash_movements_op_write" on public.cash_movements for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "Managers y owners ven sesiones de caja" on public.cash_sessions for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "cash_sessions_op_write" on public.cash_sessions for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "crm_gestionan_interacciones" on public.customer_interactions for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "crm_ver_interacciones" on public.customer_interactions for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role, 'cajero'::user_role])));
create policy "crm_gestionan_clientes" on public.customers for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "crm_ver_clientes" on public.customers for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role, 'cajero'::user_role])));
create policy "customers_anon_insert" on public.customers for insert to anon with check (true);
create policy "documents_rw" on public.documents for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role, 'cajero'::user_role])));
create policy "Owners y managers gestionan empleados" on public.employees for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role])));
create policy "Todos ven empleados activos" on public.employees for select using ((is_active = true));
create policy "Managers y owners cargan tipo de cambio" on public.exchange_rates for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role])));
create policy "Todos ven tipos de cambio" on public.exchange_rates for select using (true);
create policy "exchange_rates_read" on public.exchange_rates for select to authenticated using (true);
create policy "exchange_rates_write" on public.exchange_rates for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role])));
create policy "fin_acc_r" on public.finance_accounts for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role])));
create policy "fin_acc_w" on public.finance_accounts for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role])));
create policy "fin_act_r" on public.finance_actuals for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role])));
create policy "fin_act_w" on public.finance_actuals for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role])));
create policy "fin_bud_r" on public.finance_budget for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role])));
create policy "fin_bud_w" on public.finance_budget for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role])));
create policy "ip_read" on public.ingredient_prices for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role, 'cajero'::user_role])));
create policy "ip_write" on public.ingredient_prices for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "inv_read_ingredients" on public.ingredients for select using ((auth.role() = 'authenticated'::text));
create policy "inv_write_ingredients" on public.ingredients for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "inv_read_mov" on public.inventory_movements for select using ((auth.role() = 'authenticated'::text));
create policy "inv_write_mov" on public.inventory_movements for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "loyalty_cfg_editar" on public.loyalty_config for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role])));
create policy "loyalty_cfg_ver" on public.loyalty_config for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role, 'cajero'::user_role])));
create policy "loyalty_rew_gestionar" on public.loyalty_rewards for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role])));
create policy "loyalty_rew_ver" on public.loyalty_rewards for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role, 'cajero'::user_role])));
create policy "product_map_read" on public.product_map for select to authenticated using (true);
create policy "product_map_write" on public.product_map for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role])));
create policy "Owners y managers ven todos los perfiles" on public.profiles for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role])));
create policy "Perfil propio visible" on public.profiles for select using ((id = auth.uid()));
create policy "Solo owners crean/editan perfiles" on public.profiles for all using ((get_my_role() = 'owner'::user_role));
create policy "inv_read_ri" on public.recipe_ingredients for select using ((auth.role() = 'authenticated'::text));
create policy "inv_write_ri" on public.recipe_ingredients for all using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::user_role, 'manager'::user_role]))))));
create policy "inv_read_recipes" on public.recipes for select using ((auth.role() = 'authenticated'::text));
create policy "inv_write_recipes" on public.recipes for all using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::user_role, 'manager'::user_role]))))));
create policy "Solo owners editan puntos" on public.role_tip_points for all using ((get_my_role() = 'owner'::user_role));
create policy "Todos ven puntos por rol" on public.role_tip_points for select using (true);
create policy "sops_read" on public.sops for select to authenticated using (true);
create policy "sops_write" on public.sops for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role])));
create policy "sim_read" on public.supplier_item_map for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role, 'cajero'::user_role])));
create policy "sim_write" on public.supplier_item_map for all using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "Managers y owners ven proveedores" on public.suppliers for select using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "suppliers_op_write" on public.suppliers for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "Todos ven entradas de propinas" on public.tip_entries for select using (true);
create policy "tip_entries_op_write" on public.tip_entries for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "Todos ven sesiones de propinas" on public.tip_sessions for select using (true);
create policy "tip_sessions_op_write" on public.tip_sessions for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'cajero'::user_role])));
create policy "ventas_comps_read" on public.ventas_comps for select to authenticated using (true);
create policy "ventas_comps_write" on public.ventas_comps for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role])));
create policy "ventas_dias_read" on public.ventas_dias for select to authenticated using (true);
create policy "ventas_dias_write" on public.ventas_dias for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role])));
create policy "ventas_hist_read" on public.ventas_hist for select to authenticated using (true);
create policy "ventas_hist_write" on public.ventas_hist for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role])));
create policy "ventas_metas_read" on public.ventas_metas for select to authenticated using (true);
create policy "ventas_metas_write" on public.ventas_metas for all to authenticated using ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role]))) with check ((get_my_role() = ANY (ARRAY['owner'::user_role, 'manager'::user_role, 'contador'::user_role])));

commit;
