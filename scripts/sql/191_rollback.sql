-- Vuelta atrás de la 191, como MIGRACIÓN NUEVA HACIA ADELANTE (regla 10 de ESTADO: la fila 191 del ledger y el archivo
-- supabase/migrations/191_pos_ventas_solo_lo_suyo.sql se QUEDAN; nunca se borran ni se revierten).
-- Listo para usar, SIN NUMERAR: si hace falta, se copia a supabase/migrations/NNN_pos_ventas_vuelve_067.sql con el
-- siguiente número libre del bloque de pase (registro + ESTADO en el mismo PR) y entra por merge → Branching, con firma.
-- Vuelve las tres funciones al código EXACTO de la 067 (lo verifica por md5 al final) y borra las dos funciones nuevas.
-- OJO: REABRE la fuga (cualquier rol de Mi Rendimiento ve las facturas de todos). Solo si la 191 rompe algo peor.
-- La app de #292 funciona igual con la 067: la RPC de nombres que falta se ignora; las comparaciones quedan ocultas
-- hasta revertir también el código (revert del merge; el .sql de la 191 se queda).
begin;

-- ── Código de supabase/migrations/067_pos_ventas_lectura_equipo.sql, tal cual (sin su encabezado de comentarios) ──
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

-- ── Lo nuevo de la 191 ──
drop function if exists public.pos_nombres_por_login();
drop function if exists public.pos_mis_logins();

-- Verificación: las tres quedaron byte a byte como la 067 (mismo md5 que la guarda de la 191) y las nuevas no están.
do $$
declare r record;
begin
  for r in select * from (values
    ('public.pos_ventas_tickets_rango(text,timestamptz,timestamptz,integer,integer)', 'ce7245d0f7d960d89e3ebc58ebec3813'),
    ('public.pos_ventas_lineas(uuid[],integer,integer)',                               'ba41d0d5d0336ec079877a730ee804dd'),
    ('public.pos_ventas_latido(text)',                                                 '22ff3225d2cee25ec2228b9598570dce')
  ) as x(fn, esperado) loop
    if md5(pg_get_functiondef(to_regprocedure(r.fn))) <> r.esperado then
      raise exception 'vuelta atrás de la 191: % no quedó como la 067', r.fn;
    end if;
  end loop;
  if to_regprocedure('public.pos_nombres_por_login()') is not null or to_regprocedure('public.pos_mis_logins()') is not null then
    raise exception 'vuelta atrás de la 191: quedaron funciones de la 191';
  end if;
end $$;

commit;
