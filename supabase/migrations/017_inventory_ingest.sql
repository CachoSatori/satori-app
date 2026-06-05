-- 017 — Auto-inventario desde la Bandeja IA (Fase 2D-C)
-- Mapeo aprendido proveedor↔ingrediente, historial de precios, y trazas
-- factura→inventario→gasto en inventory_movements.

-- Mapeo aprendido: la 1ª vez se mapea un ítem de factura a un ingrediente;
-- de ahí en más se auto-empareja por el código del proveedor (o la descripción).
create table if not exists public.supplier_item_map (
  id                  uuid primary key default gen_random_uuid(),
  supplier_id         uuid references public.suppliers(id) on delete cascade,
  codigo              text,
  descripcion_factura text,
  ingredient_id       uuid references public.ingredients(id) on delete set null,
  es_inventario       boolean not null default true,
  unidad_factura      text,
  factor_conversion   numeric not null default 1,
  updated_at          timestamptz not null default now()
);
create unique index if not exists sim_supplier_codigo
  on public.supplier_item_map (supplier_id, codigo)
  where codigo is not null and codigo <> '';
create unique index if not exists sim_supplier_desc
  on public.supplier_item_map (supplier_id, lower(descripcion_factura))
  where codigo is null or codigo = '';

-- Historial de precios por proveedor (detectar subas)
create table if not exists public.ingredient_prices (
  id               uuid primary key default gen_random_uuid(),
  ingredient_id    uuid references public.ingredients(id) on delete cascade,
  supplier_id      uuid references public.suppliers(id) on delete set null,
  fecha            date,
  precio_unitario  numeric,
  unidad           text,
  document_id      uuid references public.documents(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists ip_ingredient_idx on public.ingredient_prices (ingredient_id, fecha desc);

-- Trazas en inventory_movements: entrada → factura → gasto
alter table public.inventory_movements add column if not exists document_id     uuid references public.documents(id)      on delete set null;
alter table public.inventory_movements add column if not exists cash_movement_id uuid references public.cash_movements(id) on delete set null;
create index if not exists invmov_document_idx on public.inventory_movements (document_id);

-- RLS
alter table public.supplier_item_map enable row level security;
alter table public.ingredient_prices  enable row level security;
drop policy if exists sim_read  on public.supplier_item_map;
drop policy if exists sim_write on public.supplier_item_map;
create policy sim_read  on public.supplier_item_map for select using (public.get_my_role() in ('owner','manager','contador','cajero'));
create policy sim_write on public.supplier_item_map for all
  using (public.get_my_role() in ('owner','manager','cajero')) with check (public.get_my_role() in ('owner','manager','cajero'));
drop policy if exists ip_read  on public.ingredient_prices;
drop policy if exists ip_write on public.ingredient_prices;
create policy ip_read  on public.ingredient_prices for select using (public.get_my_role() in ('owner','manager','contador','cajero'));
create policy ip_write on public.ingredient_prices for all
  using (public.get_my_role() in ('owner','manager','cajero')) with check (public.get_my_role() in ('owner','manager','cajero'));

-- Inventario: permitir que el CAJERO (compu principal) cargue desde facturas
drop policy if exists inv_write_ingredients on public.ingredients;
create policy inv_write_ingredients on public.ingredients for all
  using (public.get_my_role() in ('owner','manager','cajero')) with check (public.get_my_role() in ('owner','manager','cajero'));
drop policy if exists inv_write_mov on public.inventory_movements;
create policy inv_write_mov on public.inventory_movements for all
  using (public.get_my_role() in ('owner','manager','cajero')) with check (public.get_my_role() in ('owner','manager','cajero'));
