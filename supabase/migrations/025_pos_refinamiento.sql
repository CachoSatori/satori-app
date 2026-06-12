-- 025: Refinamiento PoS (feedback de la dueña, primera prueba física — ROADMAP §Refinamiento).
-- ADITIVA e idempotente.

-- ── 1. Ficha de producto (Gestor unificado) — columnas nuevas en product_map ──
-- product_map es compartido con Ventas: solo ADICIONES nullable/con default (no rompe nada).
alter table public.product_map add column if not exists is_active boolean not null default true;
alter table public.product_map add column if not exists station text not null default 'cocina'
  check (station in ('cocina', 'barra', 'ninguna'));      -- ruteo del KDS: nada cruzado
alter table public.product_map add column if not exists aplica_servicio boolean not null default true;  -- merchandising = false
alter table public.product_map add column if not exists prep_time_min int;                              -- estándar gastronómico
alter table public.product_map add column if not exists allergens text not null default '';             -- estándar gastronómico

-- ── 2. Modificadores DESDE el producto: variantes habilitadas + override de delta ──
-- El grupo define las variantes y su delta default; el producto elige cuáles aplican
-- y puede pisar el delta SOLO para ese producto (ej. Zacapa más caro en un cóctel).
create table if not exists public.product_modifier_options (
  product_name             text not null references public.product_map(nombre) on delete cascade,
  modifier_id              uuid not null references public.modifiers(id) on delete cascade,
  enabled                  boolean not null default true,
  price_delta_override_crc numeric(12,2),                -- null = usa el delta default del grupo
  primary key (product_name, modifier_id)
);

-- ── 3. KDS: snapshots para ruteo/orden + settings nuevos ──
alter table public.pos_order_items add column if not exists station text not null default 'cocina';
alter table public.pos_order_items add column if not exists subcategory text not null default '';
alter table public.pos_kds_settings add column if not exists subcategory_order jsonb not null default '[]'::jsonb;
alter table public.pos_kds_settings add column if not exists postres_priority boolean not null default true;
alter table public.pos_kds_settings add column if not exists postres_threshold int not null default 240;  -- timer corto (s)

-- ── 4. Salón realista: elementos decorativos + tamaño ──
alter table public.salon_tables add column if not exists kind text not null default 'table'
  check (kind in ('table', 'decor'));                    -- decor = barra/macetero/estación/pared (no abre pedidos)
alter table public.salon_tables add column if not exists width int;   -- null = tamaño default por forma
alter table public.salon_tables add column if not exists height int;

-- ── RLS de la tabla nueva (mismo patrón del PoS) ──
alter table public.product_modifier_options enable row level security;
drop policy if exists "pos_pmo_select" on public.product_modifier_options;
create policy "pos_pmo_select" on public.product_modifier_options for select using (auth.role() = 'authenticated');
drop policy if exists "pos_pmo_write" on public.product_modifier_options;
create policy "pos_pmo_write" on public.product_modifier_options for all
  using (get_my_role() = any (array['owner'::user_role, 'manager'::user_role]));

-- ── Seeds de orden escalonado de la dueña (solo si está vacío) ──
update public.pos_kds_settings
set subcategory_order = '["Crudos","Pesca local","Nigiris","Sashimis","Rolls","Principales","Postres"]'::jsonb
where location_id = 'santa-teresa' and subcategory_order = '[]'::jsonb;
