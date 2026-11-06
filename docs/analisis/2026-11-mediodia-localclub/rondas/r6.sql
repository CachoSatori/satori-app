-- Q14
with t as (
  select id, turno, pax,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and turno in ('mañana','noche')
    and fecha_registra >= timestamptz '2024-08-01 00:00:00-06'
),
f as (
  select ticket_id,
    sum(monto) filter (where familia is null or familia not in (6,17,20)) as neta,
    bool_or(familia = 29 and nombre not ilike '%extra%'
            and not (nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md,
    coalesce(sum(cantidad) filter (where codigo_producto = '856'), 0) as uds_local,
    coalesce(sum(cantidad) filter (where codigo_producto = '857'), 0) as uds_invitado
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by ticket_id
)
select t.mes, t.turno, coalesce(f.con_md, false) as con_md,
  count(*) filter (where f.uds_local > 0)                          as mesas_lc,
  sum(f.uds_local)                                                 as personas_lc,
  sum(f.uds_invitado) filter (where f.uds_local > 0)               as invitados_en_mesas_lc,
  sum(t.pax) filter (where f.uds_local > 0)                        as pax_mesas_lc,
  round(sum(f.neta) filter (where f.uds_local > 0))                as neta_mesas_lc,
  round(sum(f.neta) filter (where f.uds_local > 0 and t.pax > 0)
        / nullif(sum(t.pax) filter (where f.uds_local > 0 and t.pax > 0), 0)) as prom_pax_mesas_lc,
  count(*)                                                         as mesas_total,
  sum(t.pax)                                                       as pax_total,
  round(sum(f.neta) filter (where t.pax > 0) / nullif(sum(t.pax) filter (where t.pax > 0), 0)) as prom_pax_total
from t left join f on f.ticket_id = t.id
group by 1, 2, 3
order by 2, 1, 3
limit 500;

-- Q15
with t as (
  select id, turno, canal, con_servicio,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C'
    and fecha_registra >= timestamptz '2024-01-01 00:00:00-06'
    and (canal in ('delivery','llevar','otro') or con_servicio = false)
),
f as (
  select ticket_id,
    sum(monto) filter (where familia is null or familia not in (6,17,20)) as neta,
    coalesce(sum(cantidad) filter (where codigo_producto = '1075'), 0) as uds_boxing,
    coalesce(sum(monto) filter (where codigo_producto = '1075'), 0) as neta_boxing,
    bool_or(familia = 29 and nombre not ilike '%extra%'
            and not (nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by ticket_id
)
select t.mes, t.turno, t.canal, t.con_servicio,
  count(*)                                                   as pedidos,
  count(*) filter (where f.uds_boxing > 0)                   as pedidos_con_boxing,
  sum(f.uds_boxing)                                          as uds_boxing,
  round(sum(f.neta_boxing))                                  as neta_boxing,
  round(sum(f.neta))                                         as neta,
  round(sum(f.neta) / nullif(count(*), 0))                   as ticket_medio,
  round(100.0 * count(*) filter (where f.con_md) / count(*), 1) as pct_con_md
from t left join f on f.ticket_id = t.id
group by 1, 2, 3, 4
order by 1, 2, 3, 4
limit 1000;
