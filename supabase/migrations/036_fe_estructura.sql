-- 036: Facturación Electrónica — ESTRUCTURA (no integración real con Hacienda).
-- ADITIVA. Prepara el terreno fiscal CR 4.4 sin emitir de verdad: un documento por
-- pago, emitido por un proveedor SIMULADO (feProvider en TS). NADA llama a Hacienda.
-- Cero cambios a computeTotals ni al cobro: los totales fiscales se DERIVAN de
-- computeTotals al momento del cobro y se guardan como snapshot del documento.

-- ── 1. Códigos fiscales del menú (pendientes de la contadora) ──
-- CIIU = actividad económica; CABYS = código de bien/servicio (catálogo Hacienda CR).
-- Nullable: el menú existe hoy SIN estos códigos → "pendiente de código fiscal".
alter table public.product_map add column if not exists ciiu  text;
alter table public.product_map add column if not exists cabys text;

-- ── 2. Documentos electrónicos (tiquete / factura) ──
create table if not exists public.fe_documentos (
  id            uuid primary key default gen_random_uuid(),
  -- Vínculo al cobro que lo originó
  order_id      uuid not null references public.pos_orders(id) on delete cascade,
  payment_id    uuid references public.pos_payments(id) on delete set null,
  check_id      uuid references public.pos_checks(id) on delete set null,
  -- Tipo y estado del documento
  tipo          text not null default 'tiquete' check (tipo in ('tiquete', 'factura')),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'emitido', 'error')),
  -- Receptor (OPCIONAL — el tiquete electrónico no requiere receptor; la factura sí)
  receptor_nombre text,
  receptor_id     text,        -- cédula física/jurídica
  receptor_email  text,
  -- Campos fiscales CR 4.4 (los llena el proveedor al emitir; SIM los simula)
  consecutivo   text,          -- consecutivo de 20 dígitos del emisor
  clave         text,          -- clave numérica de 50 dígitos
  -- Snapshot de totales (derivados de computeTotals — NUNCA se recalculan acá)
  total_neto      numeric(12,2) not null default 0,
  total_iva       numeric(12,2) not null default 0,
  total_servicio  numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  -- Traza del proveedor
  provider      text not null default 'sim',     -- 'sim' hoy; 'hacienda'/'tribu'… futuro
  provider_ref  text,                            -- 'emitido-sim' o id del proveedor real
  error_msg     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Un documento por pago (idempotente: re-emitir el mismo pago no duplica)
create unique index if not exists fe_documentos_payment_uidx on public.fe_documentos(payment_id) where payment_id is not null;
create index if not exists fe_documentos_order_idx on public.fe_documentos(order_id);
create index if not exists fe_documentos_estado_idx on public.fe_documentos(estado);

-- ── RLS: mismo patrón del PoS (quien cobra puede emitir; todos los auth leen) ──
alter table public.fe_documentos enable row level security;
drop policy if exists "fe_documentos_select" on public.fe_documentos;
create policy "fe_documentos_select" on public.fe_documentos for select
  using (auth.role() = 'authenticated');
drop policy if exists "fe_documentos_write" on public.fe_documentos;
create policy "fe_documentos_write" on public.fe_documentos for all
  using (get_my_role() = any (array['owner'::user_role, 'manager'::user_role, 'cajero'::user_role, 'salonero'::user_role, 'barman'::user_role]));

drop trigger if exists fe_documentos_updated_at on public.fe_documentos;
create trigger fe_documentos_updated_at before update on public.fe_documentos
  for each row execute function public.handle_updated_at();
