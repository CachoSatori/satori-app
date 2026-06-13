-- 031: Nota por ítem del pedido (popup de detalles asiento/curso/nota para TODOS los
-- productos, patrón Lavu "Active Seat/Course"). ADITIVA e idempotente.
alter table public.pos_order_items add column if not exists note text not null default '';
