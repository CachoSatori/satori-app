-- 028: PoS F3 — Dividir cuenta (multi-check) + propina capturada en el cobro.
-- ADITIVA e idempotente. NO toca tipCalculations ni la matemática existente.
--
-- MODELO ELEGIDO (checks congelados): cada pos_check guarda el MONTO que debe
-- (ya con servicio 10% + IVA prorrateados por posSplit.ts) + un snapshot de sus
-- líneas para el ticket. Invariante garantizado en código: Σ checks = total de la
-- mesa (el último check absorbe el redondeo). Así no se toca pos_order_items y el
-- ítem compartido se prorratea sin romper ninguna FK.

-- ── 1. Checks de una orden (split). Sin filas = la orden se cobra entera (flujo F3 actual) ──
create table if not exists public.pos_checks (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.pos_orders(id) on delete cascade,
  idx            int not null,                                  -- 1..N para mostrar
  label          text not null default '',
  kind           text not null check (kind in ('even', 'item', 'seat')),
  amount_crc     numeric(12,2) not null check (amount_crc >= 0),
  items_snapshot jsonb not null default '[]'::jsonb,            -- líneas que componen el check
  paid           boolean not null default false,
  paid_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists pos_checks_order_idx on public.pos_checks(order_id);

-- ── 2. Cada pago puede apuntar a un check (null = pago de la orden entera, flujo actual) ──
alter table public.pos_payments add column if not exists check_id uuid references public.pos_checks(id) on delete set null;

-- ── 3. Propina CAPTURADA en el cobro (T2). NO se distribuye acá: queda registrada por
--       pago/cajero para alimentar el sistema de propinas (tipCalculations) en su propio
--       sprint. tip_crc = valor en colones; tip_currency = moneda en que se ingresó. ──
alter table public.pos_payments add column if not exists tip_crc      numeric(12,2) not null default 0 check (tip_crc >= 0);
alter table public.pos_payments add column if not exists tip_currency text          not null default 'CRC' check (tip_currency in ('CRC', 'USD'));

-- ── RLS de pos_checks (mismo patrón del PoS: quien comanda también divide/cobra) ──
alter table public.pos_checks enable row level security;
drop policy if exists "pos_checks_select" on public.pos_checks;
create policy "pos_checks_select" on public.pos_checks for select
  using (auth.role() = 'authenticated');
drop policy if exists "pos_checks_write" on public.pos_checks;
create policy "pos_checks_write" on public.pos_checks for all
  using (get_my_role() = any (array['owner'::user_role, 'manager'::user_role, 'cajero'::user_role, 'salonero'::user_role, 'barman'::user_role]));

-- ── Realtime: el split y el pago por check se reflejan en otros dispositivos ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pos_checks'
  ) then
    alter publication supabase_realtime add table public.pos_checks;
  end if;
end $$;
