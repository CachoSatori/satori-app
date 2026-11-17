-- ── Humo del PASE D9 · descuento por línea del PoS (solo lectura) ─────────────────────────────────
--
-- Se corre ANTES y DESPUÉS del re-backfill, en el mismo entorno y con el MISMO corte.
-- Repo público: devuelve conteos y huellas (md5 recortado), NUNCA montos ni nombres.
--
-- Por qué hay huellas POR FACTURA y de LÍNEAS: `pos_ndf_ingestar` (082) reescribe la fila entera de la
-- factura y REEMPLAZA sus líneas. Una huella de sumas por mes no ve un cambio que se compensa dentro del
-- mes, ni una línea que cambia de familia. Estas sí.
--
-- Regla: después = antes en TODAS las huellas `h_*` y en `facturas` / `lineas`. Cambios ESPERADOS (no van
-- en ninguna huella; se miran por conteo):
--   · `descuento_crc`: de 0 a ~15–30 % de las facturas con descuento > 0.
--   · `clase_ingreso`: parte de `cobrada` → `descuento`; parte de `cortesia`/`duenos` → `mixta`.
--   · Ítem 11 (`area_factura`, `mesa_factura`, `consecutivo_fe`, `clave_fe`, `pedido_abierto_en`): hoy en null en
--     las facturas anteriores al 2026-11-09; el backfill las RELLENA. Los valores que ya existían (desde el
--     2026-11-09) tienen que quedar iguales: `h_item11_existentes`.
--   · `pos_ndf_ticket_lines.usuario_registra`: las líneas viejas en null se rellenan (`lineas_sin_mesero` baja).
--   · `ingested_at` y los `id` de las líneas (se borran y se vuelven a insertar).
--
-- Antes de correrlo: leer el ref en pantalla (yiczgdti… = PROD · hwiatgic… = staging) y poner el corte.
-- El corte es un día YA CERRADO, así las facturas que siguen entrando del agente no mueven las huellas.

begin read only;

-- ── 1. Resumen ────────────────────────────────────────────────────────────────────────────────
with params as (
  select timestamptz '2026-11-17 00:00:00-06:00' as corte,        -- ← EDITAR: mismo valor antes y después
         timestamptz '2026-11-09 00:00:00-06:00' as desde_item11  -- primer día con ítem 11 (prod)
),
base as (
  select t.* from public.pos_ndf_tickets t, params where t.estado = 'C' and t.fecha_registra < params.corte
),
-- Una huella por factura: TODAS las columnas salvo las de cambio esperado.
fact as (
  select b.local, b.numero_factura,
         to_char(b.fecha_registra at time zone 'America/Costa_Rica', 'YYYY-MM') mes,
         md5((to_jsonb(b) - 'id' - 'ingested_at' - 'descuento_crc' - 'clase_ingreso'
                          - 'area_factura' - 'mesa_factura' - 'consecutivo_fe' - 'clave_fe' - 'pedido_abierto_en')::text) h
    from base b
),
-- Una huella de líneas por factura: lo que define la venta de cada línea (sin id ni mesero).
lin as (
  select b.local, b.numero_factura,
         md5(coalesce(string_agg(concat_ws('~', l.codigo_producto, l.cantidad, l.monto, l.familia, l.precio,
                                           l.es_pax, l.es_extra, l.es_cortesia),
                                 '|' order by l.codigo_producto, l.monto, l.cantidad, l.familia), '')) h,
         count(l.id) n
    from base b left join public.pos_ndf_ticket_lines l on l.ticket_id = b.id
   group by 1, 2
)
select
  (select count(*) from base)                                                           as facturas,
  (select sum(n) from lin)                                                              as lineas,
  (select left(md5(string_agg(local || numero_factura || h, '|' order by local, numero_factura)), 12) from fact)
                                                                                        as h_facturas,
  (select left(md5(string_agg(local || numero_factura || h, '|' order by local, numero_factura)), 12) from lin)
                                                                                        as h_lineas,
  (select left(md5(coalesce(string_agg(concat_ws('~', b.local, b.numero_factura, b.area_factura, b.mesa_factura,
                                                 b.consecutivo_fe, b.clave_fe, b.pedido_abierto_en),
                                       '|' order by b.local, b.numero_factura), '')), 12)
     from base b, params where b.fecha_registra >= params.desde_item11)                 as h_item11_existentes,
  (select count(*) from base where coalesce(descuento_crc, 0) > 0)                      as con_descuento,
  (select count(*) from base where coalesce(descuento_crc, 0) < 0)                      as descuento_negativo,
  (select round(100.0 * count(*) filter (where coalesce(descuento_crc, 0) > 0) / nullif(count(*), 0), 1) from base)
                                                                                        as pct_con_descuento,
  (select count(*) from base where mesa_factura is null)                                as item11_en_null,
  (select count(*) from public.pos_ndf_ticket_lines l join base b on b.id = l.ticket_id where l.usuario_registra is null)
                                                                                        as lineas_sin_mesero,
  (select string_agg(coalesce(clase_ingreso, 'null') || '=' || c, ' · ' order by coalesce(clase_ingreso, 'null'))
     from (select clase_ingreso, count(*) c from base group by 1) z)                    as clases;

-- ── 2. Por mes (para ubicar una diferencia si alguna huella del resumen no coincide) ─────────
with params as (select timestamptz '2026-11-17 00:00:00-06:00' as corte),   -- ← mismo corte
base as (
  select t.* from public.pos_ndf_tickets t, params where t.estado = 'C' and t.fecha_registra < params.corte
),
fact as (
  select b.local, b.numero_factura, to_char(b.fecha_registra at time zone 'America/Costa_Rica', 'YYYY-MM') mes,
         md5((to_jsonb(b) - 'id' - 'ingested_at' - 'descuento_crc' - 'clase_ingreso'
                          - 'area_factura' - 'mesa_factura' - 'consecutivo_fe' - 'clave_fe' - 'pedido_abierto_en')::text) h,
         coalesce(b.descuento_crc, 0) > 0 con_desc
    from base b
),
lin as (
  select b.local, b.numero_factura, to_char(b.fecha_registra at time zone 'America/Costa_Rica', 'YYYY-MM') mes,
         md5(coalesce(string_agg(concat_ws('~', l.codigo_producto, l.cantidad, l.monto, l.familia, l.precio,
                                           l.es_pax, l.es_extra, l.es_cortesia),
                                 '|' order by l.codigo_producto, l.monto, l.cantidad, l.familia), '')) h,
         count(l.id) n
    from base b left join public.pos_ndf_ticket_lines l on l.ticket_id = b.id
   group by 1, 2, 3
)
select f.local, f.mes, count(*) facturas, count(*) filter (where f.con_desc) con_descuento,
       left(md5(string_agg(f.numero_factura || f.h, '|' order by f.numero_factura)), 12) h_facturas,
       (select left(md5(string_agg(x.numero_factura || x.h, '|' order by x.numero_factura)), 12)
          from lin x where x.local = f.local and x.mes = f.mes)                          as h_lineas,
       (select sum(x.n) from lin x where x.local = f.local and x.mes = f.mes)            as lineas
  from fact f
 group by f.local, f.mes
 order by f.local, f.mes;

rollback;
