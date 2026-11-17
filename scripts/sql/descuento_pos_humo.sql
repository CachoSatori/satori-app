-- ── Humo del PASE D9 · descuento por línea del PoS (solo lectura) ─────────────────────────────────
--
-- Se corre ANTES y DESPUÉS del re-backfill, en el mismo entorno y con el MISMO corte.
-- Repo público: devuelve conteos y huellas (md5 recortado), NUNCA montos ni nombres.
--
-- Regla: después = antes en `huella_plata`, `huella_identidad`, `facturas`, `lineas`;
-- solo cambian `con_descuento` (de 0 a ~15–30 % de las facturas) y el reparto de `clase_ingreso`
-- (parte de `cobrada` pasa a `descuento` y parte de `cortesia`/`duenos` a `mixta`).
--
-- Antes de correrlo: leer el ref en pantalla (yiczgdti… = PROD · hwiatgic… = staging) y poner el corte.
-- El corte es un día YA CERRADO (p. ej. el día del pase a las 00:00 CR), así las facturas que siguen
-- entrando del agente no mueven la huella.

begin read only;

with params as (
  select timestamptz '2026-11-17 00:00:00-06:00' as corte          -- ← EDITAR: mismo valor antes y después
),
base as (
  select t.*
    from public.pos_ndf_tickets t, params
   where t.estado = 'C' and t.fecha_registra < params.corte
),
por_mes as (
  select local, to_char(fecha_registra at time zone 'America/Costa_Rica', 'YYYY-MM') mes, count(*) n,
         sum(total_crc) t, sum(valor_servido_crc) v, sum(iva_crc) i, sum(servicio_crc) s, sum(regalia_crc) r,
         sum(pax) p
    from base group by 1, 2
),
identidad as (
  select local, to_char(fecha_registra at time zone 'America/Costa_Rica', 'YYYY-MM') mes,
         count(*) filter (where registrado_por = 'salonero') sal,
         count(*) filter (where registrado_por = 'cajero')   caj,
         count(*) filter (where registrado_por = 'sistema')  sis,
         count(*) filter (where canal = 'salon')             salon,
         count(*) filter (where canal = 'delivery')          deliv,
         count(*) filter (where mesa_factura is not null)    con_mesa,
         count(*) filter (where consecutivo_fe is not null)  con_fe
    from base group by 1, 2
)
select
  (select count(*) from base)                                                         as facturas,
  (select count(*) from public.pos_ndf_ticket_lines l join base b on b.id = l.ticket_id) as lineas,
  (select left(md5(string_agg(local||mes||n||t||v||i||s||r||p, '|' order by local, mes)), 12) from por_mes)
                                                                                      as huella_plata,
  (select left(md5(string_agg(local||mes||sal||caj||sis||salon||deliv||con_mesa||con_fe, '|' order by local, mes)), 12)
     from identidad)                                                                  as huella_identidad,
  (select count(*) from base where coalesce(descuento_crc, 0) > 0)                    as con_descuento,
  (select count(*) from base where coalesce(descuento_crc, 0) < 0)                    as descuento_negativo,
  (select round(100.0 * count(*) filter (where coalesce(descuento_crc, 0) > 0) / nullif(count(*), 0), 1) from base)
                                                                                      as pct_con_descuento,
  (select string_agg(coalesce(clase_ingreso, 'null') || '=' || c, ' · ' order by coalesce(clase_ingreso, 'null'))
     from (select clase_ingreso, count(*) c from base group by 1) z)                  as clases;

-- Por año: dónde aparece el descuento (esperado: desde 2024; el campo existe en el PoS desde entonces).
select to_char(fecha_registra at time zone 'America/Costa_Rica', 'YYYY') anio, count(*) facturas,
       count(*) filter (where coalesce(descuento_crc, 0) > 0) con_descuento
  from public.pos_ndf_tickets
 where estado = 'C' and fecha_registra < timestamptz '2026-11-17 00:00:00-06:00'   -- ← mismo corte
 group by 1 order by 1;

rollback;
