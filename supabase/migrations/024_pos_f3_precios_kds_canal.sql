-- 024: PoS TRAMO 3 — precio de venta (modelo fiscal CR), config del KDS, canal y
-- traza de transferencia de mesas. ADITIVA e idempotente. Resuelve DECISIÓN-NOCTURNA #7/#8.
-- Guardrails: solo CREA/ALTER ADD sobre tablas NUEVAS del PoS (mig 022/023, staging) —
-- product_map NO se altera (los precios cuelgan de una tabla puente, igual que el catálogo).

-- ── Precio de venta por producto y local ─────────────────────
-- El precio es FINAL (IVA incluido — lo que ve el cliente en la carta). El desglose
-- neto/IVA se DERIVA en código (nunca se persiste): única verdad = computeTotals().
-- Una fila = un precio cargado; la ausencia de fila (o price null) = "sin precio".
create table if not exists public.pos_prices (
  product_name    text not null references public.product_map(nombre) on delete cascade,
  location_id     text not null references public.locations(id),
  price_final_crc numeric(12,2),                       -- IVA incluido; null = sin precio
  tax_type        text not null default 'iva13'
                    check (tax_type in ('iva13','iva4','iva2','iva1','exento')),
  is_demo         boolean not null default false,      -- precio de ejemplo cargado de noche (la dueña carga los reales)
  updated_at      timestamptz not null default now(),
  primary key (product_name, location_id)
);

-- ── Config del KDS por local ─────────────────────────────────
-- Orden de categorías configurable + umbrales de timer (seg) verde→rojo por curso.
create table if not exists public.pos_kds_settings (
  location_id       text primary key references public.locations(id),
  category_order    jsonb not null default '[]'::jsonb,   -- ["Sushi","Cocina caliente",...] (product_map.tipo)
  course_thresholds jsonb not null default '{"bebida":300,"entrada":600,"principal":900}'::jsonb,
  updated_at        timestamptz not null default now()
);

insert into public.pos_kds_settings (location_id)
  select id from public.locations
on conflict (location_id) do nothing;

-- ── Canal del pedido (para el servicio 10% por canal y vistas KDS) ──
-- salón/barra → llevan servicio 10%; delivery → NO. KDS separa salón vs delivery.
alter table public.pos_orders add column if not exists channel text not null default 'salon'
  check (channel in ('salon','barra','delivery'));

-- ── Transferencia de mesas: dueño actual de la mesa (atribución de métricas) ──
-- opened_by = quien abrió (histórico inmutable). current_salonero_id/name = dueño VIGENTE
-- tras transferencias; la traza por tramo vive en transfers jsonb (mig 023).
alter table public.pos_orders add column if not exists current_salonero_id uuid references public.profiles(id);
update public.pos_orders set current_salonero_id = opened_by where current_salonero_id is null;

-- ── Tipo de impuesto snapshot en el ítem (hereda del producto al enviar) ──
alter table public.pos_order_items add column if not exists tax_type text not null default 'iva13'
  check (tax_type in ('iva13','iva4','iva2','iva1','exento'));

-- ── RLS (mismo patrón que 022: lectura autenticada, gestión owner/manager) ──
alter table public.pos_prices       enable row level security;
alter table public.pos_kds_settings enable row level security;
do $$
declare t text;
begin
  foreach t in array array['pos_prices','pos_kds_settings'] loop
    execute format('drop policy if exists "pos_%s_select" on public.%I', t, t);
    execute format('create policy "pos_%s_select" on public.%I for select using (auth.role() = ''authenticated'')', t, t);
    execute format('drop policy if exists "pos_%s_write" on public.%I', t, t);
    execute format(
      'create policy "pos_%s_write" on public.%I for all using (get_my_role() = any (array[''owner''::user_role, ''manager''::user_role]))', t, t);
  end loop;
end $$;

-- Realtime: el indicador "sin precio" y la config del KDS se ven en vivo
do $$
declare t text;
begin
  foreach t in array array['pos_prices','pos_kds_settings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── Seeds demo (la dueña carga los precios reales; estos quedan marcados is_demo) ──
-- Guardado por existencia en product_map: nombres ausentes se saltan sin romper la migración.
insert into public.pos_prices (product_name, location_id, price_final_crc, tax_type, is_demo)
  select pm.nombre, 'santa-teresa', v.price, 'iva13', true
  from (values
    ('MOJITO', 4500::numeric),
    ('MOJITO ZACAPA 23', 7500::numeric)
  ) as v(nombre, price)
  join public.product_map pm on pm.nombre = v.nombre
on conflict (product_name, location_id) do nothing;
