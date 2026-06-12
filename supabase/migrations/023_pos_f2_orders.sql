-- 023: PoS F2 — pedidos del comandero + ítems con cursos (ROADMAP "PoS Satori + KDS").
-- ADITIVA e idempotente. Regla de oro de F2: pax OBLIGATORIO >= 1 (el 0 no existe).

create table if not exists public.pos_orders (
  id            uuid primary key default gen_random_uuid(),
  location_id   text not null references public.locations(id),
  table_id      uuid references public.salon_tables(id),
  table_name    text not null,                       -- snapshot (la mesa puede renombrarse)
  opened_by     uuid not null references public.profiles(id),
  salonero_name text not null default '',            -- atribución de métricas (transferible)
  pax           int not null check (pax >= 1),       -- OBLIGATORIO: nunca 0
  status        text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  -- Transferencias de mesa entre saloneros: [{from, to, at}] — la atribución por
  -- tramo se calcula con esta traza (regla transversal del plan PoS)
  transfers     jsonb not null default '[]',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists idx_pos_orders_status on public.pos_orders(location_id, status);

create table if not exists public.pos_order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.pos_orders(id) on delete cascade,
  product_name    text not null,                     -- snapshot del catálogo (sin FK: el producto puede renombrarse sin romper pedidos viejos)
  qty             int not null default 1 check (qty >= 1),
  base_price_crc  numeric(12,2) not null default 0,  -- snapshot; el precio de venta real llega en F3 (DECISIÓN-NOCTURNA #7)
  modifiers       jsonb not null default '[]',       -- [{id, name, price_delta_crc}] elegidos
  price_crc       numeric(12,2) not null default 0,  -- base + deltas (snapshot al enviar)
  seat            int not null default 1 check (seat >= 1),   -- asiento/cliente (base de splits F3)
  course          text not null default 'principal' check (course in ('bebida', 'entrada', 'principal')),
  kitchen_status  text not null default 'pendiente' check (kitchen_status in ('pendiente', 'marchado', 'listo', 'entregado')),
  marched_at      timestamptz,
  ready_at        timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_pos_items_order on public.pos_order_items(order_id);
create index if not exists idx_pos_items_kitchen on public.pos_order_items(kitchen_status);

-- RLS: lectura autenticada; escritura para los roles que operan el comandero
alter table public.pos_orders      enable row level security;
alter table public.pos_order_items enable row level security;
do $$
declare t text;
begin
  foreach t in array array['pos_orders', 'pos_order_items'] loop
    execute format('drop policy if exists "pos_%s_select" on public.%I', t, t);
    execute format('create policy "pos_%s_select" on public.%I for select using (auth.role() = ''authenticated'')', t, t);
    execute format('drop policy if exists "pos_%s_write" on public.%I', t, t);
    execute format(
      'create policy "pos_%s_write" on public.%I for all using (get_my_role() = any (array[''owner''::user_role, ''manager''::user_role, ''cajero''::user_role, ''salonero''::user_role, ''barman''::user_role]))', t, t);
  end loop;
end $$;

-- Realtime: el KDS y los comanderos se ven en vivo
do $$
declare t text;
begin
  foreach t in array array['pos_orders', 'pos_order_items'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
