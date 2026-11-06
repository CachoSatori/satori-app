-- ===== Q5 =====
with t as (
  select id, turno, pax,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon'
),
lc as (
  select l.ticket_id, l.cantidad, l.monto, l.familia,
    case
      when l.familia = 29 and (l.codigo_producto in ('1048','1049','1051','1052','1053','310')
           or l.nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%'])) then 'md_bebida'
      when l.familia = 29 and l.nombre ilike '%extra%' then 'md_extra'
      when l.familia = 29 and l.nombre ilike '%bento%' then 'md_bento'
      when l.familia = 29 then 'md_plato'
      when l.familia = 5 then 'bebida'
      when l.familia in (3,13,16) then 'plato'
      when l.familia = 2 then 'entrada'
      else 'otro'
    end as clase
  from public.pos_ndf_ticket_lines l
  where l.ticket_id in (select id from t)
),
f as (
  select ticket_id,
    sum(monto) filter (where familia is null or familia not in (6,17,20)) as neta,
    round(sum(case when clase = 'md_bento' then cantidad / 4.0
                   when clase in ('plato','md_plato') then cantidad else 0 end)) as platos,
    sum(cantidad) filter (where clase in ('bebida','md_bebida')) as bebidas,
    sum(cantidad) filter (where clase = 'entrada') as entradas,
    bool_or(clase in ('md_bento','md_plato')) as con_md
  from lc group by ticket_id
)
select t.mes, t.turno, coalesce(f.con_md, false) as con_md,
       least(t.pax, 8) as pax,
       least(coalesce(f.platos, 0), 8) as platos,
       least(coalesce(f.bebidas, 0), 8) as bebidas,
       count(*) as tickets,
       sum(coalesce(f.entradas, 0)) as entradas,
       round(sum(coalesce(f.neta, 0))) as neta
from t left join f on f.ticket_id = t.id
group by 1, 2, 3, 4, 5, 6
order by 1, 2, 3, 4, 5, 6;

-- ===== Q6 =====
with t as (
  select id, pax,
    case
      when fecha_registra < timestamptz '2025-01-01 00:00:00-06' then null
      when fecha_registra < timestamptz '2025-07-01 00:00:00-06' then '0 ene-jun 2025'
      when fecha_registra < timestamptz '2025-12-01 00:00:00-06' then 'A jul-nov 2025'
      when fecha_registra < timestamptz '2026-03-01 00:00:00-06' then 'B dic 2025-feb 2026'
      when fecha_registra < timestamptz '2026-08-01 00:00:00-06' then 'C mar-jul 2026'
      when fecha_registra < timestamptz '2026-11-01 00:00:00-06' then 'D ago-oct 2026'
    end as periodo
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and turno = 'mañana' and pax > 0
),
lc as (
  select l.ticket_id, l.cantidad, l.monto, l.familia, l.nombre,
    case
      when l.familia = 29 and (l.codigo_producto in ('1048','1049','1051','1052','1053','310')
           or l.nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%'])) then 'md_bebida'
      when l.familia = 29 and l.nombre ilike '%extra%' then 'md_extra'
      when l.familia = 29 then 'md_plato'
      else 'carta'
    end as clase
  from public.pos_ndf_ticket_lines l
  where l.ticket_id in (select id from t where periodo is not null)
    and (l.familia is null or l.familia not in (6,17,19,20))
),
md as (select ticket_id, bool_or(clase = 'md_plato') as con_md from lc group by ticket_id),
tt as (
  select t.id, t.pax, t.periodo, coalesce(md.con_md, false) as con_md
  from t left join md on md.ticket_id = t.id
  where t.periodo is not null
)
select periodo, con_md, '__PAX__' as nombre, null::int as familia,
       sum(pax)::numeric as cantidad, count(*)::numeric as neta
from tt group by 1, 2
union all
select tt.periodo, tt.con_md, lc.nombre, lc.familia,
       sum(lc.cantidad)::numeric, round(sum(lc.monto))::numeric
from tt join lc on lc.ticket_id = tt.id
group by 1, 2, 3, 4
order by 1, 2, 4, 3;

-- ===== Q7 =====
with t as (
  select id, turno, descuento_crc, dolares_efectivo, dolares_tarjeta, efectivo_crc, tarjeta_crc, electronico_crc,
         extract(hour from fecha_registra at time zone 'America/Costa_Rica') as hora,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon'
    and fecha_registra >= timestamptz '2024-07-01 00:00:00-06'
),
md as (
  select l.ticket_id,
         bool_or(l.familia = 29 and l.nombre not ilike '%extra%'
                 and l.codigo_producto not in ('1048','1049','1051','1052','1053','310')
                 and not (l.nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md
  from public.pos_ndf_ticket_lines l
  where l.ticket_id in (select id from t)
  group by l.ticket_id
)
select t.mes, t.turno, coalesce(md.con_md, false) as con_md, count(*) as tickets,
  round(100.0 * count(*) filter (where coalesce(t.descuento_crc,0) > 0) / count(*), 1)          as pct_con_descuento,
  round(100.0 * count(*) filter (where coalesce(t.dolares_efectivo,0) + coalesce(t.dolares_tarjeta,0) > 0) / count(*), 1) as pct_pago_usd,
  round(100.0 * count(*) filter (where coalesce(t.electronico_crc,0) > 0) / count(*), 1)        as pct_pago_electronico,
  round(100.0 * count(*) filter (where coalesce(t.efectivo_crc,0) > 0) / count(*), 1)           as pct_pago_efectivo,
  round(100.0 * count(*) filter (where coalesce(t.tarjeta_crc,0) > 0) / count(*), 1)            as pct_pago_tarjeta,
  round(avg(t.hora), 1) as hora_media
from t left join md on md.ticket_id = t.id
group by 1, 2, 3
order by 2, 1, 3;
