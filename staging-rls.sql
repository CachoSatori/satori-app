-- staging-rls.sql · RLS PERMISIVA para STAGING — NO es una migración (no va en migrations/).
-- Correr SOLO contra STAGING (hwiatgicyyqyezqwldia). Da acceso full a `authenticated` en las
-- tablas del baseline de drift, para poder probar. NUNCA correr en producción.

alter table public.sops enable row level security;
drop policy if exists sops_all on public.sops;
create policy sops_all on public.sops for all to authenticated using (true) with check (true);
alter table public.cash_cierres_dia enable row level security;
drop policy if exists cash_cierres_dia_all on public.cash_cierres_dia;
create policy cash_cierres_dia_all on public.cash_cierres_dia for all to authenticated using (true) with check (true);
alter table public.product_map enable row level security;
drop policy if exists product_map_all on public.product_map;
create policy product_map_all on public.product_map for all to authenticated using (true) with check (true);
alter table public.ventas_dias enable row level security;
drop policy if exists ventas_dias_all on public.ventas_dias;
create policy ventas_dias_all on public.ventas_dias for all to authenticated using (true) with check (true);
alter table public.ventas_hist enable row level security;
drop policy if exists ventas_hist_all on public.ventas_hist;
create policy ventas_hist_all on public.ventas_hist for all to authenticated using (true) with check (true);
alter table public.ventas_metas enable row level security;
drop policy if exists ventas_metas_all on public.ventas_metas;
create policy ventas_metas_all on public.ventas_metas for all to authenticated using (true) with check (true);
alter table public.ventas_comps enable row level security;
drop policy if exists ventas_comps_all on public.ventas_comps;
create policy ventas_comps_all on public.ventas_comps for all to authenticated using (true) with check (true);
alter table public.ingredients enable row level security;
drop policy if exists ingredients_all on public.ingredients;
create policy ingredients_all on public.ingredients for all to authenticated using (true) with check (true);
alter table public.recipes enable row level security;
drop policy if exists recipes_all on public.recipes;
create policy recipes_all on public.recipes for all to authenticated using (true) with check (true);
alter table public.recipe_ingredients enable row level security;
drop policy if exists recipe_ingredients_all on public.recipe_ingredients;
create policy recipe_ingredients_all on public.recipe_ingredients for all to authenticated using (true) with check (true);
alter table public.inventory_movements enable row level security;
drop policy if exists inventory_movements_all on public.inventory_movements;
create policy inventory_movements_all on public.inventory_movements for all to authenticated using (true) with check (true);
