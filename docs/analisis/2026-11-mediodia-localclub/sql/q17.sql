with t as (
  select id, turno, mesa
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon'
    and fecha_registra >= timestamptz '2026-09-01 00:00:00-06'
),
f as (
  select ticket_id, bool_or(codigo_producto in ('856','857')) as con_lc
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by ticket_id
)
select t.turno, t.mesa, count(*) as facturas,
       count(*) filter (where f.con_lc) as facturas_con_lc
from t left join f on f.ticket_id = t.id
group by 1, 2
order by 3 desc
limit 300;
