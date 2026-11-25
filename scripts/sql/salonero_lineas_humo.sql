-- ── Humo del PASE salonero por líneas (solo lectura) ─────────────────────────────────────────────────
--
-- Para docs/pases/PASE-salonero-lineas.md (A0, A6 y parte B). Lo corre el CONTROL (Claude o la encargada)
-- en el editor SQL: leer el ref en pantalla (yiczgdti… = PROD · hwiatgic… = staging) antes de correrlo.
-- Repo público: devuelve conteos y huellas (md5 recortado), NUNCA montos ni nombres. El bloque 4 muestra
-- logins (números del PoS): se compara en el chat y NO se copia a la bitácora del repo.
--
-- Qué cambia con el re-backfill: SOLO `salonero_login` y, con él, `registrado_por` (una factura que gana
-- salonero pasa de `cajero` / `sistema` / `sin_pedido` a `salonero`: sin eso la app no se la acredita, ver
-- `claveSalonero` en ventasEnVivoDatos.ts). Además `ingested_at` y los `id` de las líneas (la 082 reescribe
-- la fila y reemplaza las líneas). Nada más.
--
-- Regla v1 (18-nov, hecho): después = antes en `facturas`, `lineas`, `h_facturas_sin_salonero` y `h_lineas`.
--        `salonero_null` BAJA, y baja EXACTAMENTE el N que imprime B1 (días < corte, sin duplicar meses).
-- Regla v2 (solo salón, 25-nov): huellas, `facturas` y `lineas` iguales; `salonero_null_salon` IGUAL;
--        `salonero_null` y `salonero_null_no_salon` SUBEN exactamente M (lo que midió V4 con el código de hoy);
--        en el bloque 4 ningún login SUBE (solo bajan: devuelven facturas de barra/delivery/llevar a «Cajeros»).
-- Corte: CERRADO, dos días antes del pase a las 00:00 −06:00 (el agente en vivo relee 36 h: lo anterior no lo toca).
--        Ningún login baja en el bloque 4 (un salonero que ya estaba no se pierde: solo se suman facturas).

begin read only;

-- ── 1. Latido del agente ─────────────────────────────────────────────────────────────────────────────
-- Esperado: `hace` < 2 min de 10:00 a 02:00 CR (< 6 min de madrugada) y `sin_error = true`.
select local,
       last_factura,
       date_trunc('second', now() - last_poll_at) as hace,
       last_error is null                         as sin_error
  from public.pos_ndf_cursor
 where local = 'santa-teresa';

-- ── 2. Facturas que entraron desde el cambio de carpeta (A5) ───────────────────────────────────────────
-- Esperado: facturas > 0 en servicio; `salonero_null` igual o menor que con el agente viejo (bloque 2b).
with params as (
  select timestamptz '2026-11-18 10:00:00-06:00' as hora_cambio      -- ← EDITAR: HORA_CAMBIO que imprimió A5
)
select t.estado,
       count(*)                                                         as facturas,
       count(*) filter (where t.salonero_login is null)                 as salonero_null,
       count(*) filter (where t.registrado_por = 'salonero')            as registrado_salonero,
       count(*) filter (where t.registrado_por = 'cajero')              as registrado_cajero,
       count(*) filter (where t.registrado_por = 'sin_pedido')          as registrado_sin_pedido
  from public.pos_ndf_tickets t, params
 where t.local = 'santa-teresa'
   and t.ingested_at >= params.hora_cambio
 group by t.estado
 order by t.estado;

-- ── 2b. Referencia: las 24 h ANTES del cambio (agente viejo) ───────────────────────────────────────────
with params as (
  select timestamptz '2026-11-18 10:00:00-06:00' as hora_cambio      -- ← EDITAR: el mismo valor
)
select count(*)                                          as facturas_24h_antes,
       count(*) filter (where t.salonero_login is null)  as salonero_null
  from public.pos_ndf_tickets t, params
 where t.local = 'santa-teresa'
   and t.ingested_at >= params.hora_cambio - interval '24 hours'
   and t.ingested_at <  params.hora_cambio;

-- ── 3. Humo: resumen (ANTES y DESPUÉS del re-backfill, MISMO corte) ─────────────────────────────────────
with params as (
  select timestamptz '2026-11-16 00:00:00-06:00' as corte             -- ← EDITAR: CORTE_HUMO (pase − 2 días), igual antes y después
),
base as (
  select t.* from public.pos_ndf_tickets t, params where t.estado = 'C' and t.fecha_registra < params.corte
),
-- Huella por factura: TODAS las columnas salvo las de cambio esperado (salonero_login y registrado_por).
fact as (
  select b.local, b.numero_factura,
         md5((to_jsonb(b) - 'id' - 'ingested_at' - 'salonero_login' - 'registrado_por')::text) h
    from base b
),
-- Huella de líneas por factura: la MISMA definición que el humo del PASE D9 (comparable con su «después»).
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
                                                                                               as h_facturas_sin_salonero,
  (select left(md5(string_agg(local || numero_factura || h, '|' order by local, numero_factura)), 12) from lin)
                                                                                               as h_lineas,
  (select count(*) from base where salonero_login is null)                                     as salonero_null,
  (select count(*) from base where salonero_login is null and canal = 'salon')                 as salonero_null_salon,
  (select count(*) from base where salonero_login is null and canal <> 'salon')                as salonero_null_no_salon,
  (select count(*) from base, params where canal = 'salon' and fecha_registra >= params.corte - interval '90 days')
                                                                                               as salon_90d,
  (select count(*) from base, params where canal = 'salon' and salonero_login is null
                                     and fecha_registra >= params.corte - interval '90 days') as salon_90d_null,
  (select count(*) from base where salonero_login is not null and registrado_por <> 'salonero') as incoherentes,
  (select string_agg(registrado_por || '=' || c, ' · ' order by registrado_por)
     from (select registrado_por, count(*) c from base group by 1) z)                          as registrado_por;

-- ── 4. Por login (SOLO para el chat; no va a la bitácora) ──────────────────────────────────────────────
-- Esperado: ningún login BAJA entre antes y después; los que suben suman lo mismo que bajó `salonero_null`.
with params as (select timestamptz '2026-11-16 00:00:00-06:00' as corte)   -- ← mismo corte
select coalesce(t.salonero_login, '(null)') as login, count(*) as facturas
  from public.pos_ndf_tickets t, params
 where t.estado = 'C' and t.fecha_registra < params.corte
 group by 1
 order by 1;

-- ── 5. Por mes (para ubicar una diferencia si una huella del bloque 3 no coincide) ─────────────────────
with params as (select timestamptz '2026-11-16 00:00:00-06:00' as corte),  -- ← mismo corte
base as (
  select t.* from public.pos_ndf_tickets t, params where t.estado = 'C' and t.fecha_registra < params.corte
),
fact as (
  select b.local, b.numero_factura, to_char(b.fecha_registra at time zone 'America/Costa_Rica', 'YYYY-MM') mes,
         md5((to_jsonb(b) - 'id' - 'ingested_at' - 'salonero_login' - 'registrado_por')::text) h,
         b.salonero_login is null sin_salonero,
         b.salonero_login is null and b.canal <> 'salon' sin_salonero_no_salon
    from base b
),
lin as (
  select b.local, b.numero_factura, to_char(b.fecha_registra at time zone 'America/Costa_Rica', 'YYYY-MM') mes,
         md5(coalesce(string_agg(concat_ws('~', l.codigo_producto, l.cantidad, l.monto, l.familia, l.precio,
                                           l.es_pax, l.es_extra, l.es_cortesia),
                                 '|' order by l.codigo_producto, l.monto, l.cantidad, l.familia), '')) h
    from base b left join public.pos_ndf_ticket_lines l on l.ticket_id = b.id
   group by 1, 2, 3
)
select f.local, f.mes, count(*) facturas, count(*) filter (where f.sin_salonero) salonero_null,
       count(*) filter (where f.sin_salonero_no_salon) salonero_null_no_salon,
       left(md5(string_agg(f.numero_factura || f.h, '|' order by f.numero_factura)), 12) h_facturas_sin_salonero,
       (select left(md5(string_agg(x.numero_factura || x.h, '|' order by x.numero_factura)), 12)
          from lin x where x.local = f.local and x.mes = f.mes)                               as h_lineas
  from fact f
 group by f.local, f.mes
 order by f.local, f.mes;

rollback;
