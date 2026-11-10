-- club_verificar_backfill.sql — después del backfill del ítem 11 (desde el 1-sep), en STAGING.
-- Solo lectura: todo en una transacción que termina en ROLLBACK. Corre como postgres (Management API).
-- Vuelve a correr el caso de la mesa 19 del 31-oct con los datos REALES (sin simular la mesa ni la apertura).
begin;
select json_build_object(
  -- cobertura en salón desde el 1-sep (el dueño contó 1.363 facturas; 5 sin mesa ni pedido)
  -- cerradas desde el 1-sep, de TODAS las áreas (decisión del dueño 07-nov: el área '3' cuenta para el Club;
  -- la mesa es (área, mesa)). Esperado: 1.414 = M 1.363 + área 3 49 + B 2.
  'cerradas_desde_sep', (select json_build_object('total', count(*),
                         'por_area', (select json_object_agg(coalesce(a, '(sin área)'), n order by a)
                                        from (select area a, count(*) n from pos_ndf_tickets
                                               where local = 'santa-teresa' and estado = 'C' and fecha_registra >= '2026-09-01 00:00-06'
                                               group by area) x),
                         'con_mesa_factura', count(mesa_factura), 'con_area_factura', count(area_factura),
                         'con_consecutivo', count(consecutivo_fe), 'con_clave_fe', count(clave_fe),
                         'con_pedido', count(numero_pedido), 'con_apertura', count(pedido_abierto_en),
                         'sin_mesa_ni_pedido', count(*) filter (where numero_pedido is null and mesa_factura is null))
                        from pos_ndf_tickets where local = 'santa-teresa' and estado = 'C'
                          and fecha_registra >= '2026-09-01 00:00-06'),
  -- mesas por área (área 3: mesas 1–8)
  'mesas_por_area', (select json_object_agg(area, mesas) from (
                       select area, string_agg(distinct mesa_factura, ',' order by mesa_factura) mesas from pos_ndf_tickets
                        where local = 'santa-teresa' and estado = 'C' and fecha_registra >= '2026-09-01 00:00-06' and area in ('3', 'B')
                        group by area) x),
  -- los ejemplos del dueño
  'ejemplos', (select json_agg(json_build_object('factura', numero_factura, 'mesa_factura', mesa_factura, 'pedido', numero_pedido,
                         'consecutivo_ult5', right(consecutivo_fe, 5), 'clave_fe_largo', length(clave_fe), 'apertura', pedido_abierto_en at time zone 'America/Costa_Rica') order by numero_factura)
                 from pos_ndf_tickets where local = 'santa-teresa' and numero_factura in ('112430', '112310', '112311', '112313', '112293')),
  -- pedido 14 del 05-nov: el escaneo con la apertura real
  'pedido_14', (select coalesce(string_agg(t.numero_factura, '+' order by o.n), '(ninguna)')
                  from unnest(public.club_cruce_facturas('santa-teresa', jsonb_build_object('modo','pedido','pedido','14','mesa','20',
                         'abierto_en', (select pedido_abierto_en from pos_ndf_tickets where local = 'santa-teresa' and numero_factura = '112430'),
                         'hora', '2026-11-05T19:00:00-06:00'), null)) with ordinality o(id, n)
                  join pos_ndf_tickets t on t.id = o.id),
  -- mesa 19 del 31-oct: pedido 33 con su apertura y su mesa REALES (esperado: 112313+112310+112311)
  'mesa_19', (select json_agg(json_build_object('factura', t.numero_factura, 'rol', d.rol) order by t.fecha_registra)
                from public.club_cruce_detalle('santa-teresa', jsonb_build_object('modo','pedido','pedido','33',
                       'mesa', (select coalesce(mesa_factura, mesa) from pos_ndf_tickets where local = 'santa-teresa' and numero_factura = '112313'),
                       'abierto_en', (select pedido_abierto_en from pos_ndf_tickets where local = 'santa-teresa' and numero_factura = '112313'),
                       'hora', (select pedido_abierto_en + interval '5 minutes' from pos_ndf_tickets where local = 'santa-teresa' and numero_factura = '112313')), null) d
                join pos_ndf_tickets t on t.id = d.ticket_id)
);
rollback;
