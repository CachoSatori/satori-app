-- ── 064 · pos_ndf_open: monto estimado + pax + ítems de la mesa abierta (Frente C v1) ───────
--
-- TRES columnas nuevas, NULLABLE y SIN default. Solo ADD COLUMN: no se toca ninguna columna
-- ni tipo existente. Todo lo que entra acá es PROVISIONAL: lo calcula el agente desde el
-- catálogo del PoS (FAC_PedidosDet ⋈ FAC_Productos) mientras la mesa sigue abierta, y NUNCA
-- entra en la neta, en «Hoy», en el cuadre, en pos_ndf_tickets ni en ningún sagrado.
--
-- Fail-closed en toda la cadena: si el agente no puede calcular, manda null y la pantalla dice
-- «sin total». Un null NO es un cero: el cero real (cortesía) viaja como 0.
--
-- ⚠️ NO APLICAR sin la firma del SQL de Ismael. Compatible hacia atrás: el agente y la Edge que
-- corren hoy siguen escribiendo sin estas columnas, y quedan en null.

alter table public.pos_ndf_open
  add column if not exists monto_estimado_crc numeric(14,2),
  add column if not exists pax_pedido         smallint,
  add column if not exists items_valor        smallint;

comment on column public.pos_ndf_open.monto_estimado_crc is
  'ESTIMADO por catalogo: suma de (Cantidad x FAC_Productos.PrecioVenta - descuento) de las lineas con valor servido (FAMILIAS_VALOR_SERVIDO), por el multiplicador del canal (1,23 salon/barra; 1,13 delivery/llevar). Provisional: NO es venta, nunca entra en neta ni en cuadre. null = no se pudo calcular; 0 = cero real (cortesia).';
comment on column public.pos_ndf_open.pax_pedido is
  'Pax por ARTICULO en el pedido abierto: unidades de 677 (1 persona) + 2 x unidades de 678 (2 personas), la misma regla que mapPax en el ticket. null = el pedido no trae esas lineas. NO sale de FAC_Pedidos.Personas.';
comment on column public.pos_ndf_open.items_valor is
  'Cantidad de lineas del pedido abierto con valor servido (misma whitelist que el monto). null = sin lineas usables.';
