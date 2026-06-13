-- 029: PoS F3 — Paridad final (combinar mesas + anular ítem enviado).
-- ADITIVA e idempotente. NO toca caja ni tipCalculations ni computeTotals.

-- ── 1. COMBINAR MESAS (merge, con deshacer) ──
-- La mesa B se combina EN la mesa A: sus ítems pasan a A marcados con su origen
-- (para poder devolverlos al des-combinar). B queda en estado 'merged'.
alter table public.pos_orders add column if not exists merged_into uuid references public.pos_orders(id);
alter table public.pos_orders add column if not exists merge_trace jsonb not null default '[]'::jsonb;
alter table public.pos_order_items add column if not exists merged_from_order uuid;  -- null = nativo de la orden

-- status 'merged' (la mesa absorbida ya no se muestra en el plano)
alter table public.pos_orders drop constraint if exists pos_orders_status_check;
alter table public.pos_orders add constraint pos_orders_status_check
  check (status = any (array['open', 'closed', 'cancelled', 'merged']));

-- check kind 'merge' (cada mesa combinada es su propio check, como Lavu)
alter table public.pos_checks drop constraint if exists pos_checks_kind_check;
alter table public.pos_checks add constraint pos_checks_kind_check
  check (kind = any (array['even', 'item', 'seat', 'merge']));

-- ── 2. ANULAR ÍTEM YA ENVIADO (void con permiso + motivo + auditoría) ──
-- kitchen_status 'anulado' → sale del KDS y NO cuenta en la cuenta.
alter table public.pos_order_items drop constraint if exists pos_order_items_kitchen_status_check;
alter table public.pos_order_items add constraint pos_order_items_kitchen_status_check
  check (kitchen_status = any (array['pendiente', 'marchado', 'listo', 'entregado', 'anulado']));

alter table public.pos_order_items add column if not exists void_reason text;
alter table public.pos_order_items add column if not exists voided_by   uuid references public.profiles(id);
alter table public.pos_order_items add column if not exists voided_at   timestamptz;
