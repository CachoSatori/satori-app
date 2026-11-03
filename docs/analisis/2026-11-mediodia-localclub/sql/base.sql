with t as (
  select id, turno, pax, salonero_login, registrado_por,
    date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes,
    extract(isodow from fecha_registra at time zone 'America/Costa_Rica')::int as dow,
    extract(hour from fecha_registra at time zone 'America/Costa_Rica')::int as hora
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and con_servicio
    and turno in ('mañana','noche')
    and fecha_registra >= timestamptz '2024-08-01 00:00:00-06'
),
l as (
  select l.ticket_id, l.codigo_producto, l.familia, l.nombre, l.cantidad, l.monto, t.mes
  from public.pos_ndf_ticket_lines l
  join t on t.id = l.ticket_id
  where l.cantidad > 0 and (l.familia is null or l.familia not in (6,17,19,20))
),
pl as (
  select codigo_producto, mes,
         mode() within group (order by round(monto / cantidad)) as precio
  from l where monto > 0
  group by 1, 2
),
lp as (
  select l.*, l.cantidad * pl.precio as lista
  from l join pl on pl.codigo_producto = l.codigo_producto and pl.mes = l.mes
),
f as (
  select ticket_id, sum(monto) as neta, sum(lista) as lista,
    bool_or(familia = 29 and nombre not ilike '%extra%'
            and not (nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md
  from lp group by 1
),
m as (
  select ticket_id,
    coalesce(sum(cantidad) filter (where codigo_producto = '856'), 0) as lc,
    coalesce(sum(cantidad) filter (where codigo_producto = '857'), 0) as inv
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by 1
),
tk as (
  select t.*, f.neta, f.lista, f.con_md, coalesce(m.lc, 0) as lc, coalesce(m.inv, 0) as inv,
    round(f.neta / nullif(f.lista, 0), 2) as ratio,
    case
      when coalesce(m.lc, 0) > 0 then 'LC marcado'
      when round(f.neta / nullif(f.lista, 0), 2) >= 0.97 then 'sin descuento'
      when round(f.neta / nullif(f.lista, 0), 2) between 0.88 and 0.93 then 'tarjeta 10%'
      when round(f.neta / nullif(f.lista, 0), 2) between 0.80 and 0.87 then 'LC sin marcar 15%'
      else 'otro'
    end as clase
  from t join f on f.ticket_id = t.id left join m on m.ticket_id = t.id
)
