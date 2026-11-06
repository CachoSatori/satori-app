with t as (
  select id, turno, pax, mesa, salonero_login, fecha_registra,
         (fecha_registra at time zone 'America/Costa_Rica')::date as dia,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and turno in ('mañana','noche')
    and fecha_registra >= timestamptz '2025-01-01 00:00:00-06'
),
f as (
  select ticket_id,
    sum(monto) filter (where familia is null or familia not in (6,17,20)) as neta,
    coalesce(sum(cantidad) filter (where codigo_producto = '856'), 0) as lc,
    coalesce(sum(cantidad) filter (where codigo_producto = '857'), 0) as inv
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by ticket_id
),
x as (
  select t.*, coalesce(f.lc, 0) as lc, coalesce(f.inv, 0) as inv, coalesce(f.neta, 0) as neta,
    case
      when coalesce(t.mesa, '') = '' then 1
      when t.fecha_registra - lag(t.fecha_registra) over w <= interval '15 minutes' then 0
      else 1
    end as nuevo
  from t left join f on f.ticket_id = t.id
  window w as (partition by t.dia, t.turno, coalesce(t.mesa, ''), coalesce(t.salonero_login, '') order by t.fecha_registra)
),
g as (
  select x.*, sum(nuevo) over (partition by dia, turno, coalesce(mesa, ''), coalesce(salonero_login, '')
                               order by fecha_registra rows unbounded preceding) as grp
  from x
),
gg as (
  select mes, turno, dia, mesa, salonero_login, grp,
         count(*) as n, sum(lc) as lc, sum(inv) as inv, sum(pax) as pax,
         count(*) filter (where lc = 0 and inv = 0) as tk_sin_marca,
         sum(pax) filter (where lc = 0 and inv = 0) as pax_sin_marca,
         sum(neta) filter (where lc = 0 and inv = 0) as neta_sin_marca
  from g group by 1, 2, 3, 4, 5, 6
)
select mes, turno,
  count(*) filter (where n > 1)                                      as grupos_divididos,
  count(*) filter (where n > 1 and lc + inv > 0)                     as grupos_divididos_con_lc,
  coalesce(sum(tk_sin_marca) filter (where n > 1 and lc + inv > 0), 0)  as facturas_sin_marca_en_grupo_lc,
  coalesce(sum(pax_sin_marca) filter (where n > 1 and lc + inv > 0), 0) as pax_sin_marca_en_grupo_lc,
  round(coalesce(sum(neta_sin_marca) filter (where n > 1 and lc + inv > 0), 0)) as neta_sin_marca_en_grupo_lc,
  sum(lc)  as lc_marcados,
  sum(inv) as invitados_marcados
from gg
group by 1, 2
order by 2, 1
limit 500;
