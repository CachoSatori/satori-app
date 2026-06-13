-- 027: PoS F3 — Cobro base + doble moneda (SPEC-LAVU-FLUJO-MESA §2).
-- ADITIVA e idempotente. Cero cambios a la matemática (computeTotals intacto).

-- ── 1. Cierre de la orden: quién la cerró (closed_at/status ya existían) ──
alter table public.pos_orders add column if not exists closed_by uuid references public.profiles(id);

-- ── 2. Pagos del PoS (un pago por orden en este sprint; la tabla admite varios
--       por order_id para los splits/pagos parciales del backlog P1) ──
create table if not exists public.pos_payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.pos_orders(id) on delete cascade,
  method              text not null check (method in ('efectivo', 'tarjeta', 'transferencia')),
  -- Importe cobrado SIEMPRE en colones (moneda primaria del negocio); el desglose
  -- por moneda recibida vive en received_crc/received_usd.
  amount_crc          numeric(12,2) not null check (amount_crc >= 0),
  currency            text not null default 'CRC' check (currency in ('CRC', 'USD')),  -- moneda en que entregó el cliente
  exchange_rate_used  numeric(12,4),       -- TC ₡/$ usado en ESTE pago (traza; puede diferir del TC del día)
  received_crc        numeric(12,2) not null default 0,   -- efectivo recibido en ₡
  received_usd        numeric(12,2) not null default 0,   -- efectivo recibido en $
  change_crc          numeric(12,2) not null default 0,   -- vuelto entregado en ₡
  note                text not null default '',
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now()
);
create index if not exists pos_payments_order_idx on public.pos_payments(order_id);

-- ── RLS: mismo patrón del PoS (quien comanda también cobra) ──
alter table public.pos_payments enable row level security;
drop policy if exists "pos_payments_select" on public.pos_payments;
create policy "pos_payments_select" on public.pos_payments for select
  using (auth.role() = 'authenticated');
drop policy if exists "pos_payments_write" on public.pos_payments;
create policy "pos_payments_write" on public.pos_payments for all
  using (get_my_role() = any (array['owner'::user_role, 'manager'::user_role, 'cajero'::user_role, 'salonero'::user_role, 'barman'::user_role]));

-- ── Realtime: el cobro cierra la mesa → el plano de otros dispositivos se actualiza ──
-- pos_orders ya está en la publicación (mig 023); agregamos pos_payments por si una
-- pantalla de caja quiere ver los cobros en vivo (barato, piloto).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pos_payments'
  ) then
    alter publication supabase_realtime add table public.pos_payments;
  end if;
end $$;
