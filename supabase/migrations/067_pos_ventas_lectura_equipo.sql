-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 067 · Lectura de ventas del PoS para el EQUIPO (Mi Rendimiento) — sin medios de pago ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Firma de Ismael, 2026-10-30 (opción B). Las tablas `pos_ndf_*` NO se abren: sus policies de la
-- 062 (owner/manager/contador) quedan como están. Lo que se agrega son TRES funciones de lectura
-- `security definer` que:
--   · chequean el rol ADENTRO (`get_my_role()`): gerencia + contador + los roles de Mi Rendimiento;
--   · devuelven SOLO las columnas que usa el cálculo de ventas de la app (`getDiasMapDesdePos` →
--     `armarDia`, y las lentes de saloneros), medidas con datos reales y justificadas una por una;
--   · NUNCA devuelven medios de pago (efectivo/tarjeta/electrónico/depósito/cheque), vuelto,
--     dólares, cxc, `numero_pedido`, `total_fuente` ni `ingested_at`;
--   · NO devuelven `clase_ingreso`: el cálculo no lo usa. Las facturas de dueños y las cortesías
--     suman igual que hoy (la neta sale de las líneas), pero desde acá no se puede saber cuáles son.
--
-- La app usa estas funciones para TODOS los roles (un solo camino): owner/manager ven exactamente
-- lo mismo que leyendo las tablas.
--
-- Paginación: `limit`/`offset` van ADENTRO, sobre un orden total (con `id`), porque PostgREST corta
-- en `max_rows` sin avisar y `.range()` sobre el resultado de una función no garantiza el orden.
--
-- Sin acceso (rol fuera de la lista o anónimo) las funciones devuelven 0 filas, como el RLS. Para
-- distinguir «sin acceso» de «PoS vacío», `pos_ventas_latido` devuelve UNA fila a quien tiene
-- acceso (con la hora del último poll, que puede ser null) y CERO a quien no.
--
-- Re-ejecutable: `create or replace` + `revoke`/`grant`.

-- ── 1. Tickets cerrados de un rango ────────────────────────────────────────────────────────
create or replace function public.pos_ventas_tickets_rango(
  p_local  text,
  p_desde  timestamptz,
  p_hasta  timestamptz,
  p_limit  integer default 1000,
  p_offset integer default 0
)
returns table (
  id                uuid,        -- ata cada línea a su factura (`pos_ventas_lineas`)
  numero_factura    text,        -- solo rotula los avisos de catálogo de `netaDelTicket`
  estado            text,        -- siempre 'C' (filtrado acá); el tipo de la app lo lleva
  fecha_registra    timestamptz, -- el DÍA de la factura (`diaDeFactura`) y la ventana del rango
  fecha_cierra      timestamptz, -- la JORNADA por lote de cierre (`agruparEnLotes`, lentes)
  cajero_login      text,        -- la caja que cerró: balde de turno de las ventas sin mesero
  canal             text,        -- salón / delivery / llevar / barra: salón vs delivery del día
  mesa              text,        -- la lente de mesa propia cuenta MESAS distintas, no facturas
  salonero_login    text,        -- a qué salonero va la venta
  registrado_por    text,        -- salonero vs cajero: decide si la factura tiene mesero
  servicio_crc      numeric,     -- el 10 % del día (Contabilidad, Paridad)
  total_crc         numeric,     -- la venta bruta del día (un total, no el desglose de pagos)
  valor_servido_crc numeric,     -- la neta de respaldo de una factura sin líneas guardadas
  iva_crc           numeric,     -- el IVA del día
  regalia_crc       numeric,     -- la regalía del día
  pax               integer,     -- los comensales de la factura
  pax_articulo      integer      -- el pax por artículo (calidad del pax)
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.numero_factura, t.estado, t.fecha_registra, t.fecha_cierra, t.cajero_login,
         t.canal, t.mesa, t.salonero_login, t.registrado_por, t.servicio_crc, t.total_crc,
         t.valor_servido_crc, t.iva_crc, t.regalia_crc, t.pax, t.pax_articulo
  from public.pos_ndf_tickets t
  where public.get_my_role() = any (array[
          'owner', 'manager', 'contador',
          'salonero', 'barman', 'barback', 'runner', 'cocina'
        ]::public.user_role[])
    and t.local = p_local
    and t.estado = 'C'
    and t.fecha_registra >= p_desde
    and t.fecha_registra <  p_hasta
  order by t.fecha_registra, t.id
  limit  least(greatest(coalesce(p_limit, 1000), 0), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ── 2. Líneas de un conjunto de facturas ───────────────────────────────────────────────────
-- Sin filtro de estado a propósito: «En vivo» también pide las líneas de las facturas en curso
-- (R) para medir lo provisional, y los ids ya vienen de una lectura autorizada.
create or replace function public.pos_ventas_lineas(
  p_ticket_ids uuid[],
  p_limit      integer default 1000,
  p_offset     integer default 0
)
returns table (
  ticket_id        uuid,     -- a qué factura pertenece
  codigo_producto  text,     -- artículos de pax (677/678) y avisos de catálogo
  nombre           text,     -- el producto: mix, Productos, Menu Engineering
  cantidad         numeric,  -- unidades del producto y del pax por artículo
  monto            numeric,  -- la plata de la línea: la NETA es Σ monto de las de venta
  familia          integer,  -- qué líneas son venta (todo menos 6/17/20) y comida vs bebida
  usuario_registra text      -- quién comandó la línea (facturas partidas, lentes)
)
language sql
stable
security definer
set search_path = public
as $$
  select l.ticket_id, l.codigo_producto, l.nombre, l.cantidad, l.monto, l.familia, l.usuario_registra
  from public.pos_ndf_ticket_lines l
  where public.get_my_role() = any (array[
          'owner', 'manager', 'contador',
          'salonero', 'barman', 'barback', 'runner', 'cocina'
        ]::public.user_role[])
    and l.ticket_id = any (p_ticket_ids)
  order by l.ticket_id, l.id
  limit  least(greatest(coalesce(p_limit, 1000), 0), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ── 3. Latido para el equipo: SOLO la hora del último poll ────────────────────────────────
-- Una fila a quien tiene acceso (aunque el local no tenga cursor: `last_poll_at` null), cero a
-- quien no. No devuelve `last_error` ni la última factura.
create or replace function public.pos_ventas_latido(p_local text)
returns table (last_poll_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select (select c.last_poll_at from public.pos_ndf_cursor c where c.local = p_local)
  where public.get_my_role() = any (array[
          'owner', 'manager', 'contador',
          'salonero', 'barman', 'barback', 'runner', 'cocina'
        ]::public.user_role[])
$$;

-- ── 4. Permisos: solo usuarios logueados ───────────────────────────────────────────────────
revoke all on function public.pos_ventas_tickets_rango(text, timestamptz, timestamptz, integer, integer) from public, anon;
revoke all on function public.pos_ventas_lineas(uuid[], integer, integer)                             from public, anon;
revoke all on function public.pos_ventas_latido(text)                                                  from public, anon;
grant execute on function public.pos_ventas_tickets_rango(text, timestamptz, timestamptz, integer, integer) to authenticated;
grant execute on function public.pos_ventas_lineas(uuid[], integer, integer)                             to authenticated;
grant execute on function public.pos_ventas_latido(text)                                                  to authenticated;

comment on function public.pos_ventas_tickets_rango(text, timestamptz, timestamptz, integer, integer) is
  'Mig 067. Tickets C de un rango para el cálculo de ventas, SIN medios de pago ni clase_ingreso. Rol chequeado adentro.';
comment on function public.pos_ventas_lineas(uuid[], integer, integer) is
  'Mig 067. Líneas de un conjunto de tickets para el cálculo de ventas. Rol chequeado adentro.';
comment on function public.pos_ventas_latido(text) is
  'Mig 067. 1 fila (hora del último poll) a quien puede leer ventas del PoS; 0 filas a quien no.';
