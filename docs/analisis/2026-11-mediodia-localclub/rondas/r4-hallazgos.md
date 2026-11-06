
## Hallazgos de la Ronda 3 (03/11)
- **Q0c:** el Veggie Bento SÍ se vende (69 uds; explica el hueco de la sección 3). Pilsen Green (1050), Club Soda (1055) y Fresca Green (1054) son bebidas del menú.
- **Q7:** `descuento_crc`, `dolares_*` y `electronico_crc` vienen en 0 siempre. Mesas con menú: 18 % paga en efectivo contra 14 % (sep-25 a oct-26), y llegan ~15 min antes. Es una señal débil a favor de «locales».
- **Q5 (pax reconstruido):** el modelo erra ~0,5 pax por mesa. El sesgo fuera de muestra (2024 a ago-2025) es de −2 % a −3 % en la mañana. Prom/pax de la mañana reconstruido:
  - 2024: 12.753
  - ene–jun 2025: 11.956
  - jul–nov 2025: 10.700
  - dic–feb: 10.476
  - mar–oct 2026: 11.232
- **Sospecha:** las mesas sin pax de antes de sep-2025 son tickets chicos (~₡10k). Si son cuentas divididas del mismo pedido, el pax estimado se cuenta dos veces. La Q8 lo resuelve.
- **Q6 + costos:** el margen por persona, con costo del CoGS 2026 o del costo unitario del PoS (y % por familia si no hay dato), sale así:

| Tipo de mesa | Margen por persona |
|---|---|
| Carta | ₡9.900–11.000 (costo 24–26 %) |
| Con menú | ₡5.500–6.100 (costo 33–35 %) |

  El menú conviene si ≥ ~43 % de sus pax son clientes nuevos.

## Ronda 4 (03/11)

### Q8 — ¿Las mesas sin pax son cuentas divididas? Prom/pax por pedido
```sql
with t as (
  select id, turno, pax, numero_pedido,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes,
         (fecha_registra at time zone 'America/Costa_Rica')::date as dia
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and turno in ('mañana','noche')
),
n as (
  select ticket_id, sum(monto) filter (where familia is null or familia not in (6,17,20)) as neta
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by ticket_id
),
x as (
  select t.*, coalesce(n.neta, 0) as neta,
         coalesce(t.numero_pedido, 'sin-' || t.id::text) || '|' || t.dia::text as ped
  from t left join n on n.ticket_id = t.id
),
p as (
  select mes, turno, ped, count(*) as nt, sum(pax) as pax, sum(neta) as neta,
         count(*) filter (where pax = 0) as nsp
  from x group by 1, 2, 3
)
select mes, turno,
  sum(nt)                                        as tickets,
  count(*)                                       as pedidos,
  count(*) filter (where nt > 1)                 as pedidos_divididos,
  sum(nsp)                                       as tickets_sin_pax,
  coalesce(sum(nsp) filter (where pax > 0), 0)   as tickets_sin_pax_en_pedido_con_pax,
  count(*) filter (where pax = 0)                as pedidos_sin_pax,
  sum(pax)                                       as pax,
  round(sum(neta) filter (where pax > 0) / nullif(sum(pax), 0))             as prom_pax_por_pedido,
  round(100.0 * sum(neta) filter (where pax = 0) / nullif(sum(neta), 0), 1) as pct_neta_pedidos_sin_pax,
  round(avg(neta) filter (where pax = 0))        as neta_media_pedido_sin_pax
from p
group by 1, 2
order by 2, 1
limit 500;
```

### Q9 — Por salonero y mes (mañana): ¿se cumplió «solo a pedido» desde el 20-feb? ¿Quién explica agosto?
```sql
with t as (
  select id, pax, coalesce(salonero_login, 'caja') as salonero,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and turno = 'mañana'
    and fecha_registra >= timestamptz '2025-07-01 00:00:00-06'
),
f as (
  select ticket_id,
    sum(monto) filter (where familia is null or familia not in (6,17,20)) as neta,
    bool_or(familia = 29 and nombre not ilike '%extra%'
            and not (nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by ticket_id
)
select t.mes, t.salonero,
  count(*)                                                        as tickets,
  round(100.0 * count(*) filter (where f.con_md) / count(*), 1)   as pct_mesas_md,
  sum(t.pax)                                                      as pax,
  round(sum(f.neta) filter (where t.pax > 0) / nullif(sum(t.pax), 0)) as prom_pax
from t left join f on f.ticket_id = t.id
group by 1, 2
order by 1, 3 desc
limit 1000;
```

### Q10 — Mañana por día de semana, período y tipo de mesa: tamaño de mesa, bebida, entrada, postre
```sql
with t as (
  select id, pax,
    extract(isodow from fecha_registra at time zone 'America/Costa_Rica')::int as dow,
    case
      when fecha_registra < timestamptz '2025-01-01 00:00:00-06' then null
      when fecha_registra < timestamptz '2025-07-01 00:00:00-06' then '0 ene-jun 2025'
      when fecha_registra < timestamptz '2025-12-01 00:00:00-06' then 'A jul-nov 2025'
      when fecha_registra < timestamptz '2026-03-01 00:00:00-06' then 'B dic 2025-feb 2026'
      when fecha_registra < timestamptz '2026-08-01 00:00:00-06' then 'C mar-jul 2026'
      when fecha_registra < timestamptz '2026-11-01 00:00:00-06' then 'D ago-oct 2026'
    end as periodo
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and turno = 'mañana'
),
f as (
  select ticket_id,
    sum(monto) filter (where familia is null or familia not in (6,17,20)) as neta,
    bool_or(familia = 29 and nombre not ilike '%extra%'
            and not (nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md,
    bool_or(familia = 5 or (familia = 29 and nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_bebida,
    bool_or(familia = 2) as con_entrada,
    bool_or(familia = 4) as con_postre,
    coalesce(sum(cantidad) filter (where familia = 5 or (familia = 29 and nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))), 0) as bebidas
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t where periodo is not null)
  group by ticket_id
)
select t.periodo, t.dow, coalesce(f.con_md, false) as con_md,
  count(*)                                                           as tickets,
  sum(t.pax)                                                         as pax,
  round(avg(t.pax) filter (where t.pax > 0), 2)                      as pax_por_mesa,
  round(sum(f.neta) filter (where t.pax > 0) / nullif(sum(t.pax) filter (where t.pax > 0), 0)) as prom_pax,
  round(100.0 * count(*) filter (where f.con_bebida)  / count(*), 1) as pct_con_bebida,
  round(100.0 * count(*) filter (where f.con_entrada) / count(*), 1) as pct_con_entrada,
  round(100.0 * count(*) filter (where f.con_postre)  / count(*), 1) as pct_con_postre,
  round(avg(f.bebidas), 2)                                           as bebidas_por_mesa
from t left join f on f.ticket_id = t.id
where t.periodo is not null
group by 1, 2, 3
order by 1, 2, 3
limit 500;
```
