-- 009b · BASELINE de DRIFT para STAGING (aproximado, NO byte-exacto)
-- Crea las tablas que existen en PROD pero NO en ninguna migración (se crearon
-- fuera de migraciones en prod). Esto permite que `supabase db push` continúe
-- (010+ las referencian) y deja staging funcional para pruebas.
-- ⚠ APROXIMADO: tipos + PK + RLS permisiva (authenticated). FKs/índices/constraints/
-- defaults exactos = deuda técnica "reconciliar drift" (requiere pg_dump en una
-- máquina con la herramienta). Solo se aplica a STAGING.

create table if not exists public.sops (
  id uuid default gen_random_uuid() primary key,
  title text,
  category text,
  content text,
  display_order integer,
  is_active boolean,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
);
alter table public.sops enable row level security;
drop policy if exists sops_all on public.sops;
create policy sops_all on public.sops for all to authenticated using (true) with check (true);

create table if not exists public.cash_cierres_dia (
  id uuid default gen_random_uuid() primary key,
  session_date date,
  manager text,
  tipo text,
  vm_crc numeric,
  vm_usd numeric,
  propinas_m_crc numeric,
  otros_m_crc numeric,
  ef_real_m_crc numeric,
  vn_crc numeric,
  vn_usd numeric,
  propinas_n_crc numeric,
  otros_n_crc numeric,
  ef_real_n_crc numeric,
  sep_diaria_crc numeric,
  sep_diaria_usd numeric,
  sep_registradora_crc numeric,
  sep_registradora_usd numeric,
  remanente_crc numeric,
  remanente_usd numeric,
  diferencia_crc numeric,
  ajuste_tipo text,
  ajuste_motivo text,
  notas text,
  tipo_cambio numeric,
  created_at timestamptz,
  updated_at timestamptz
);
alter table public.cash_cierres_dia enable row level security;
drop policy if exists cash_cierres_dia_all on public.cash_cierres_dia;
create policy cash_cierres_dia_all on public.cash_cierres_dia for all to authenticated using (true) with check (true);

create table if not exists public.product_map (
  nombre text primary key,
  tipo text,
  clasificacion text,
  subclasificacion text,
  multiplicador integer,
  updated_at timestamptz,
  costo_unitario numeric
);
alter table public.product_map enable row level security;
drop policy if exists product_map_all on public.product_map;
create policy product_map_all on public.product_map for all to authenticated using (true) with check (true);

create table if not exists public.ventas_dias (
  id uuid default gen_random_uuid() primary key,
  session_date date,
  file_name text,
  data jsonb,
  uploaded_by uuid,
  uploaded_at timestamptz
);
alter table public.ventas_dias enable row level security;
drop policy if exists ventas_dias_all on public.ventas_dias;
create policy ventas_dias_all on public.ventas_dias for all to authenticated using (true) with check (true);

create table if not exists public.ventas_hist (
  session_date date primary key,
  data jsonb,
  source text
);
alter table public.ventas_hist enable row level security;
drop policy if exists ventas_hist_all on public.ventas_hist;
create policy ventas_hist_all on public.ventas_hist for all to authenticated using (true) with check (true);

create table if not exists public.ventas_metas (
  key text primary key,
  value jsonb,
  updated_at timestamptz
);
alter table public.ventas_metas enable row level security;
drop policy if exists ventas_metas_all on public.ventas_metas;
create policy ventas_metas_all on public.ventas_metas for all to authenticated using (true) with check (true);

create table if not exists public.ventas_comps (
  id uuid default gen_random_uuid() primary key,
  data jsonb,
  created_at timestamptz,
  updated_at timestamptz
);
alter table public.ventas_comps enable row level security;
drop policy if exists ventas_comps_all on public.ventas_comps;
create policy ventas_comps_all on public.ventas_comps for all to authenticated using (true) with check (true);

create table if not exists public.ingredients (
  id uuid default gen_random_uuid() primary key,
  name text,
  unit text,
  current_stock numeric,
  min_stock numeric,
  cost_per_unit numeric,
  supplier text,
  category text,
  notes text,
  updated_at timestamptz,
  created_at timestamptz
);
alter table public.ingredients enable row level security;
drop policy if exists ingredients_all on public.ingredients;
create policy ingredients_all on public.ingredients for all to authenticated using (true) with check (true);

create table if not exists public.recipes (
  id uuid default gen_random_uuid() primary key,
  product_name text,
  yield_qty numeric,
  yield_unit text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
);
alter table public.recipes enable row level security;
drop policy if exists recipes_all on public.recipes;
create policy recipes_all on public.recipes for all to authenticated using (true) with check (true);

create table if not exists public.recipe_ingredients (
  id uuid default gen_random_uuid() primary key,
  recipe_id uuid,
  ingredient_id uuid,
  quantity numeric,
  unit text,
  waste_factor numeric
);
alter table public.recipe_ingredients enable row level security;
drop policy if exists recipe_ingredients_all on public.recipe_ingredients;
create policy recipe_ingredients_all on public.recipe_ingredients for all to authenticated using (true) with check (true);


create table if not exists public.inventory_movements (
  id uuid default gen_random_uuid() primary key,
  ingredient_id uuid,
  movement_type text,
  qty_delta numeric,
  unit text,
  unit_cost numeric,
  reference_id text,
  notes text,
  created_by text,
  created_at timestamptz,
  document_id uuid,
  cash_movement_id uuid
);
alter table public.inventory_movements enable row level security;
drop policy if exists inventory_movements_all on public.inventory_movements;
create policy inventory_movements_all on public.inventory_movements for all to authenticated using (true) with check (true);
