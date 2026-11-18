-- ── Humo del PASE clave FE por consecutivo y tipo (solo lectura) ─────────────────────────────────────
--
-- Para docs/pases/PASE-clave-fe-tipo.md. Lo corre el CONTROL en el editor SQL: leer el ref en pantalla
-- (yiczgdti… = PROD) antes de correrlo. Repo público: devuelve conteos y huellas (md5 recortado), NUNCA montos,
-- nombres ni claves.
--
-- Qué cambia con el re-backfill: SOLO `clave_fe` de las facturas cuya clave no es la de su consecutivo
-- (pasa a null). Además `ingested_at` y los `id` de las líneas (la 082 reescribe la fila). Nada más:
-- `consecutivo_fe` NO cambia (es el bueno).
--
-- Regla: después = antes en `facturas`, `lineas`, `h_facturas_sin_clave`, `h_consecutivo` y `h_lineas`.
--        `colisiones` → 0 · `clave_null` sube EXACTAMENTE lo que valía `colisiones` antes.
-- Corte: CERRADO, dos días antes del pase a las 00:00 −06:00 (el agente en vivo relee 36 h).
-- Una clave de Hacienda CR lleva el consecutivo entero en las posiciones 22–41 (tipo de documento: 30–31).

begin read only;

-- ── 1. Resumen (ANTES y DESPUÉS del re-backfill, MISMO corte) ───────────────────────────────────────
with params as (
  select timestamptz '2026-11-17 00:00:00-06:00' as corte             -- ← EDITAR: CORTE_HUMO, igual antes y después
),
base as (
  select t.* from public.pos_ndf_tickets t, params where t.estado = 'C' and t.fecha_registra < params.corte
),
fact as (
  select b.local, b.numero_factura,
         md5((to_jsonb(b) - 'id' - 'ingested_at' - 'clave_fe')::text) h
    from base b
),
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
  (select count(*) from base)                                                                  as facturas,
  (select sum(n) from lin)                                                                     as lineas,
  (select left(md5(string_agg(local || numero_factura || h, '|' order by local, numero_factura)), 12) from fact)
                                                                                               as h_facturas_sin_clave,
  (select left(md5(string_agg(local || numero_factura || coalesce(consecutivo_fe, '-'), '|'
                              order by local, numero_factura)), 12) from base)                 as h_consecutivo,
  (select left(md5(string_agg(local || numero_factura || h, '|' order by local, numero_factura)), 12) from lin)
                                                                                               as h_lineas,
  (select count(*) from base where clave_fe is null)                                           as clave_null,
  (select count(*) from base where consecutivo_fe is not null and clave_fe is not null
                               and substr(clave_fe, 22, 20) <> consecutivo_fe)                 as colisiones,
  (select count(*) from base where clave_fe is not null and consecutivo_fe is not null
                               and substr(clave_fe, 30, 2) <> substr(consecutivo_fe, 9, 2))    as tipo_distinto;

-- ── 2. Colisiones por mes (para la bitácora y para ubicar una diferencia) ─────────────────────────────
with params as (select timestamptz '2026-11-17 00:00:00-06:00' as corte)   -- ← mismo corte
select to_char(t.fecha_registra at time zone 'America/Costa_Rica', 'YYYY-MM') as mes,
       substr(t.consecutivo_fe, 9, 2)                                        as tipo_consecutivo,
       substr(t.clave_fe, 30, 2)                                             as tipo_clave,
       count(*)                                                              as facturas
  from public.pos_ndf_tickets t, params
 where t.estado = 'C' and t.fecha_registra < params.corte
   and t.consecutivo_fe is not null and t.clave_fe is not null
   and substr(t.clave_fe, 22, 20) <> t.consecutivo_fe
 group by 1, 2, 3
 order by 1, 2, 3;

rollback;
