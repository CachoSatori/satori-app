-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 081 — pos_ndf: campos de la factura para el cruce del Club (ítem 11). ADITIVA.          ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
-- Firma de Ismael para STAGING (07-nov). Prod va aparte y con firma: aplicar en prod ANTES de
-- subir el Edge nuevo (el Edge escribe estas columnas; sin ellas, el upsert del lote falla y no
-- entra ninguna venta).
--
-- Hallazgos de Ismael en el PoS (solo lectura, 06-nov):
--   · FAC_Facturas.NumeroMesa: la mesa de la FACTURA. Las cuentas divididas no tienen pedido,
--     pero sí mesa en la factura.
--   · FAC_Facturas.ConsecutivoElectronico (20 dígitos, el número que ve el cliente en el
--     tiquete) y ClaveElectronica (50 dígitos).
--   · FAC_Facturas.FechaRegistra es la hora real de cobro: YA se guarda en
--     pos_ndf_tickets.fecha_registra desde la 062 (no se duplica). FechaCierra es la del cierre
--     de caja (fecha_cierra).
--   · La unión pedido → factura es FAC_Pedidos.NumeroFactura. FAC_Facturas.NumeroPedido y
--     FAC_Pedidos.IDPedido vienen vacíos: no se usan.
--   · FAC_Pedidos.FechaRegistra es la apertura del pedido. Con el número de pedido es la clave
--     completa (el número se reinicia cada día).
--
-- SOLO columnas nuevas que aceptan vacío, sin default y sin CHECK: un valor raro lo descarta el
-- Edge (va null), nunca tumba el lote. No toca ninguna columna existente, ni la neta, ni el
-- cuadre, ni los sagrados. Nada de nombres ni teléfonos. Idempotente.
-- Rollback: scripts/sql/081_rollback.sql.

alter table public.pos_ndf_tickets
  add column if not exists mesa_factura      text,
  add column if not exists consecutivo_fe    text,
  add column if not exists clave_fe          text,
  add column if not exists pedido_abierto_en timestamptz;

alter table public.pos_ndf_open
  add column if not exists pedido_abierto_en timestamptz;

comment on column public.pos_ndf_tickets.mesa_factura is
  'FAC_Facturas.NumeroMesa (mig 081). La mesa de la factura: las cuentas divididas no tienen pedido pero si mesa. null = agente viejo o sin dato.';
comment on column public.pos_ndf_tickets.consecutivo_fe is
  'FAC_Facturas.ConsecutivoElectronico (mig 081): 20 digitos, el numero que ve el cliente en el tiquete. Otra forma -> null.';
comment on column public.pos_ndf_tickets.clave_fe is
  'FAC_Facturas.ClaveElectronica (mig 081): 50 digitos. Otra forma -> null.';
comment on column public.pos_ndf_tickets.pedido_abierto_en is
  'FAC_Pedidos.FechaRegistra del pedido de la factura (mig 081): la apertura. Con numero_pedido es la clave completa del pedido. null = sin pedido.';
comment on column public.pos_ndf_open.pedido_abierto_en is
  'FAC_Pedidos.FechaRegistra (mig 081): la apertura del pedido abierto.';

-- Búsqueda por los últimos dígitos del consecutivo (Excepciones del Club) y cruce por mesa.
create index if not exists pos_ndf_tickets_consecutivo_fe_idx on public.pos_ndf_tickets (local, consecutivo_fe)
  where consecutivo_fe is not null;
create index if not exists pos_ndf_tickets_pedido_idx on public.pos_ndf_tickets (local, numero_pedido, fecha_registra)
  where numero_pedido is not null;
