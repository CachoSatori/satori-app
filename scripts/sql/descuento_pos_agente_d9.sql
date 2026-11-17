-- ── Agente D9 · latido y descuento en las facturas nuevas (solo lectura) ──────────────────────────────
--
-- Para los bloques A0 y A6 de docs/puente/PASE-D9-AGENTE-bloques.md. Lo corre el control (Claude o la
-- encargada) en PROD, en el editor SQL: leer el ref en pantalla (yiczgdti… = PROD) antes de correrlo.
-- Repo público: devuelve conteos, NUNCA montos ni nombres. `last_error` se muestra solo como sí/no (puede
-- traer el nombre del equipo del PoS).

begin read only;

-- ── 1. Latido del agente ─────────────────────────────────────────────────────────────────────────────
-- Esperado: `hace` < 2 min de 10:00 a 02:00 CR (< 6 min de madrugada) y `sin_error = true`.
-- Dos lecturas con 2 minutos de diferencia: `hace` vuelve a bajar.
select local,
       last_factura,
       date_trunc('second', now() - last_poll_at) as hace,
       last_error is null                         as sin_error
  from public.pos_ndf_cursor
 where local = 'santa-teresa';

-- ── 2. Facturas que entraron desde el cambio de carpeta (A5), por estado ───────────────────────────────
-- Esperado: `descuento_negativo` = 0 siempre; en cuanto haya unas 10 facturas cerradas, `con_descuento` > 0
-- (en la semana del dry-run fue ~15–30 %). Con el agente viejo `con_descuento` era 0 en el 100 %.
with params as (
  select timestamptz '2026-11-17 12:00:00-06:00' as hora_cambio      -- ← EDITAR: HORA_CAMBIO que imprimió A5
)
select t.estado,
       count(*)                                                                as facturas,
       count(*) filter (where coalesce(t.descuento_crc, 0) > 0)                as con_descuento,
       count(*) filter (where t.descuento_crc < 0)                             as descuento_negativo,
       count(*) filter (where t.clase_ingreso in ('descuento', 'mixta'))       as clase_descuento_o_mixta,
       round(100.0 * count(*) filter (where coalesce(t.descuento_crc, 0) > 0) / nullif(count(*), 0), 1)
                                                                               as pct_con_descuento
  from public.pos_ndf_tickets t, params
 where t.local = 'santa-teresa'
   and t.ingested_at >= params.hora_cambio
 group by t.estado
 order by t.estado;

-- ── 3. Referencia: las 24 h ANTES del cambio (agente viejo) ────────────────────────────────────────────
-- Esperado: `con_descuento` = 0 (así entraba desde 2024). Sirve para ver que el cambio es el que lo trae.
with params as (
  select timestamptz '2026-11-17 12:00:00-06:00' as hora_cambio      -- ← EDITAR: el mismo valor
)
select count(*)                                                 as facturas_24h_antes,
       count(*) filter (where coalesce(t.descuento_crc, 0) > 0) as con_descuento
  from public.pos_ndf_tickets t, params
 where t.local = 'santa-teresa'
   and t.ingested_at >= params.hora_cambio - interval '24 hours'
   and t.ingested_at <  params.hora_cambio;

rollback;
