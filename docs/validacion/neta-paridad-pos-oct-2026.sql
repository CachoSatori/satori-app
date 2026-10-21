-- ════════════════════════════════════════════════════════════════════════════════════════
-- Validación fix/neta-paridad-pos · neta diaria 1–19 oct 2026 · SOLO SELECT (staging)
-- ANTES  = lo que mostraba la app: Σ valor_servido_crc por JORNADA DE LOTE (cajero_login + fecha_cierra,
--          día = fecha CR del primer fecha_registra del lote).
-- DESPUÉS = la regla nueva (src/modules/ventas/netaVenta.ts + ventasDiasDesdePos.ts):
--          Σ pos_ndf_ticket_lines.monto de familias ∉ {6,17,20} (NULL cuenta), por día CR de
--          fecha_registra; ticket sin líneas → su valor_servido_crc. Solo estado 'C'.
-- La app redondea por balde (salonero/caja); acá se redondea por día → diferencias de ±1–3 ₡.
-- ════════════════════════════════════════════════════════════════════════════════════════
with objetivo(dia, neta_pos) as (values
  (date '2026-10-01',432300),(date '2026-10-02',559337),(date '2026-10-03',769925),(date '2026-10-04',333160),
  (date '2026-10-05',272801),(date '2026-10-06',561713),(date '2026-10-07',307302),(date '2026-10-08',364239),
  (date '2026-10-09',517143),(date '2026-10-10',216864),(date '2026-10-11',583504),(date '2026-10-12',623087),
  (date '2026-10-13',649707),(date '2026-10-14',565982),(date '2026-10-15',323146),(date '2026-10-16',398245),
  (date '2026-10-17',675025),(date '2026-10-18',386646),(date '2026-10-19',664965)
), t0 as (
  select t.id, t.fecha_registra, t.valor_servido_crc,
         case when t.fecha_cierra is not null
              then coalesce(nullif(trim(t.cajero_login),''),'(sin cajero)') || '|' || t.fecha_cierra::text
              else coalesce(nullif(trim(t.cajero_login),''),'(sin cajero)') || '|abierto|'
                   || (t.fecha_registra at time zone 'America/Costa_Rica')::date::text
         end as lote,
         (select count(*) from public.pos_ndf_ticket_lines l where l.ticket_id = t.id) as n_lineas,
         (select coalesce(sum(l.monto),0) from public.pos_ndf_ticket_lines l
           where l.ticket_id = t.id and (l.familia is null or l.familia not in (6,17,20))) as lineas_venta
  from public.pos_ndf_tickets t
  where t.local = 'santa-teresa' and t.estado = 'C'
    and t.fecha_registra >= timestamptz '2026-09-30 00:00:00-06'
    and t.fecha_registra <  timestamptz '2026-10-22 00:00:00-06'
), t1 as (
  select t0.*,
         (min(fecha_registra) over (partition by lote) at time zone 'America/Costa_Rica')::date as dia_lote,
         (fecha_registra at time zone 'America/Costa_Rica')::date                               as dia_factura,
         case when n_lineas = 0 then coalesce(valor_servido_crc,0) else lineas_venta end        as neta_nueva
  from t0
), antes as (
  select dia_lote as dia, sum(valor_servido_crc) as neta from t1 group by 1
), despues as (
  select dia_factura as dia, sum(neta_nueva) as neta, count(*) filter (where n_lineas = 0) as sin_lineas
  from t1 group by 1
)
select o.dia,
       round(a.neta)                     as antes_app,
       round(d.neta)                     as despues_app,
       round(d.neta) - round(a.neta)     as delta_fix,
       o.neta_pos                        as objetivo_pos,
       round(d.neta) - o.neta_pos        as diff_vs_pos,
       (abs(round(d.neta) - o.neta_pos) <= 2) as ok_2colones,
       d.sin_lineas
from objetivo o
left join antes   a on a.dia = o.dia
left join despues d on d.dia = o.dia
union all
select null, round(sum(a.neta)), round(sum(d.neta)), round(sum(d.neta)) - round(sum(a.neta)),
       sum(o.neta_pos), round(sum(d.neta)) - sum(o.neta_pos), null, sum(d.sin_lineas)
from objetivo o
left join antes   a on a.dia = o.dia
left join despues d on d.dia = o.dia
order by 1 nulls last;

-- Control: valor_servido_crc NO cambia (el fix no escribe nada; esto debe dar 0 filas, igual que antes).
select t.numero_factura, t.valor_servido_crc,
       sum(l.monto) filter (where l.familia in (2,3,4,5,13,16,29)) as vs_lineas
from public.pos_ndf_tickets t join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
where t.local = 'santa-teresa' and t.estado = 'C'
  and t.fecha_registra >= timestamptz '2026-10-01 00:00:00-06'
  and t.fecha_registra <  timestamptz '2026-10-20 00:00:00-06'
group by t.id, t.numero_factura, t.valor_servido_crc
having abs(coalesce(t.valor_servido_crc,0) - coalesce(sum(l.monto) filter (where l.familia in (2,3,4,5,13,16,29)),0)) > 0.05;
