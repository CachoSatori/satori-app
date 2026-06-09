-- 0095 · BASELINE de DRIFT (SOLO ESTRUCTURA) — seguro para correr en cualquier base.
-- Crea las tablas que en prod se crearon fuera de migraciones. SOLO `create table if
-- not exists` → si por error corre contra prod, NO toca tablas existentes ni políticas.
-- ⚠ NO incluye RLS/policies a propósito (no debe poder debilitar la seguridad de prod).
--   · Las RLS permisivas de STAGING están en `staging-rls.sql` (fuera de migrations/),
--     se aplican a mano SOLO en staging (ver STAGING.md). Reconciliar a RLS-por-rol exacta
--     = deuda técnica (pg_dump).

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

create table if not exists public.product_map (
  nombre text primary key,
  tipo text,
  clasificacion text,
  subclasificacion text,
  multiplicador integer,
  updated_at timestamptz,
  costo_unitario numeric
);

create table if not exists public.ventas_dias (
  id uuid default gen_random_uuid() primary key,
  session_date date,
  file_name text,
  data jsonb,
  uploaded_by uuid,
  uploaded_at timestamptz
);

create table if not exists public.ventas_hist (
  session_date date primary key,
  data jsonb,
  source text
);

create table if not exists public.ventas_metas (
  key text primary key,
  value jsonb,
  updated_at timestamptz
);

create table if not exists public.ventas_comps (
  id uuid default gen_random_uuid() primary key,
  data jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

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

create table if not exists public.recipes (
  id uuid default gen_random_uuid() primary key,
  product_name text,
  yield_qty numeric,
  yield_unit text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.recipe_ingredients (
  id uuid default gen_random_uuid() primary key,
  recipe_id uuid,
  ingredient_id uuid,
  quantity numeric,
  unit text,
  waste_factor numeric
);


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
