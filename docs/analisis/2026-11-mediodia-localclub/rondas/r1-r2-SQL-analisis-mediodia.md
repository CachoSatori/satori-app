# SQL — Análisis estrategia de mediodía (menú Green Season / mediodía) · 2026-11-03

> Correr en el **SQL Editor de Supabase PROD**. Son solo `SELECT`: no tocan nada.
> Usan las mismas reglas que la app (SPEC-prompax-explicado v2.2):
> - Solo `estado='C'`, local `santa-teresa`, canal `salon`.
> - El día se toma en hora CR.
> - Turno = `pos_ndf_tickets.turno`.
> - Neta = Σ líneas menos las familias {6, 17, 20}.
> - Comida = familias {2, 3, 4, 13, 16, 29}. Bebida = familia 5.
>
> Exportá cada resultado a CSV y pasámelo.
> **Sin límite de fecha (v1.1):** las consultas toman TODO el historial que tiene el PoS. El `primer_mes` de la Q0 dice cuándo se vendió cada producto por primera vez. Si aparece una fila con `turno` vacío, es historia anterior a los cajeros 111/222 y hay que verla aparte.

## Pregunta
Entre ene–abr y sep–oct 2026, el prom/pax de la mañana subió de ₡10.984 a ₡13.264. ¿Qué lo explica?

**Hipótesis a probar:**
- **H1 Mezcla:** desde diciembre se dejó de ofrecer el menú mediodía, así que bajó el peso de esos platos por pax.
- **H2 Bebidas:** subió el gasto o las unidades de bebida por pax.
- **H3 Precios:** subieron los precios, tanto del menú mediodía como de la carta.
- **H4 Artefacto de pax:** cambió cómo se carga el pax (más mesas sin pax o con alertas). Eso infla el prom/pax sin que nadie gaste más.
- **H5 Clientela o temporada:** se compara el mismo tramo de temporada entre años.

**Alerta temprana:** ene-2026 dio ₡10.753, después del cambio de diciembre. El salto aparece recién en mayo (₡13.030). El calendario no calza a primera vista con la hipótesis H1, y los datos tienen que explicar por qué.

---

## Ronda 1 (no depende de clasificar productos)

### Q0 — Catálogo: qué productos son del menú mediodía
```sql
with t as (
  select id, turno,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon'
),
x as (
  select l.codigo_producto                                         as codigo,
         max(l.nombre)                                             as nombre,
         count(distinct l.nombre)                                  as nombres_distintos,
         max(l.familia)                                            as familia,
         sum(l.cantidad) filter (where t.turno = 'mañana')         as uds_manana,
         sum(l.cantidad) filter (where t.turno is distinct from 'mañana') as uds_resto,
         round(sum(l.monto) filter (where t.turno = 'mañana'))     as monto_manana,
         min(l.precio) filter (where l.precio > 0)                 as precio_min,
         max(l.precio)                                             as precio_max,
         min(t.mes)                                                as primer_mes,
         max(t.mes)                                                as ultimo_mes
  from t
  join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
  where l.familia is distinct from 19
  group by l.codigo_producto
)
select *,
       round(100.0 * uds_manana / nullif(uds_manana + coalesce(uds_resto, 0), 0)) as pct_uds_en_manana
from x
where uds_manana >= 20
   or nombre ilike any (array['%green%','%mediod%','%casado%','%bento%','%box%','%poke%',
                              '%teriyaki%','%duo%','%fish%','%caesar%','%cesar%','%ceviche%',
                              '%extra%','%batido%'])
order by uds_manana desc nulls last;
```

### Q0b — Cómo se carga un Bento Box (5 tickets de muestra)
```sql
select t.numero_factura,
       (t.fecha_registra at time zone 'America/Costa_Rica') as hora_cr,
       l.codigo_producto, l.nombre, l.familia, l.cantidad, l.precio, l.monto
from public.pos_ndf_tickets t
join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
where t.id in (
  select l2.ticket_id
  from public.pos_ndf_ticket_lines l2
  join public.pos_ndf_tickets t2 on t2.id = l2.ticket_id
  where l2.nombre ilike '%bento%'
    and t2.estado = 'C'
    and t2.fecha_registra >= timestamptz '2026-08-01 00:00:00-06'
  limit 5)
order by t.numero_factura, l.nombre;
```

### Q1 — Mes × turno: de qué está hecho el prom/pax
```sql
with t as (
  select id, turno, pax, pax_alerta,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon'
),
p as (
  select mes, turno,
         count(*)                                     as tickets,
         sum(pax)                                     as pax,
         count(*) filter (where pax = 0)              as tickets_sin_pax,
         count(*) filter (where pax_alerta <> 'ok')   as tickets_con_alerta
  from t group by 1, 2
),
l as (
  select t.mes, t.turno,
         sum(l.monto)    filter (where l.familia is null or l.familia not in (6,17,20)) as neta,
         sum(l.monto)    filter (where l.familia in (2,3,4,13,16,29))                    as comida,
         sum(l.monto)    filter (where l.familia = 5)                                    as bebida,
         sum(l.cantidad) filter (where l.familia in (2,3,4,13,16,29))                    as uds_comida,
         sum(l.cantidad) filter (where l.familia = 5)                                    as uds_bebida,
         sum(l.monto)    filter (where t.pax = 0 and (l.familia is null or l.familia not in (6,17,20))) as neta_sin_pax
  from t join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
  group by 1, 2
)
select p.mes, p.turno, p.tickets, p.pax, p.tickets_sin_pax, p.tickets_con_alerta,
       round(p.pax::numeric / nullif(p.tickets, 0), 2)                         as pax_por_mesa,
       round(l.neta)                                                           as neta,
       round(l.neta / nullif(p.pax, 0))                                        as prom_pax,
       round(l.comida / nullif(p.pax, 0))                                      as comida_pax,
       round(l.bebida / nullif(p.pax, 0))                                      as bebida_pax,
       round((l.neta - coalesce(l.comida,0) - coalesce(l.bebida,0)) / nullif(p.pax, 0)) as otros_pax,
       round(l.uds_comida / nullif(p.pax, 0), 2)                               as uds_comida_pax,
       round(l.uds_bebida / nullif(p.pax, 0), 2)                               as uds_bebida_pax,
       round(l.comida / nullif(l.uds_comida, 0))                               as precio_medio_comida,
       round(l.bebida / nullif(l.uds_bebida, 0))                               as precio_medio_bebida,
       round(100.0 * coalesce(l.neta_sin_pax,0) / nullif(l.neta, 0), 1)       as pct_neta_sin_pax
from p join l using (mes, turno)
order by p.turno, p.mes;
```
**Chequeo de que la consulta está bien:** mañana ene-2026 tiene que dar prom_pax ≈ **₡10.753**. Noche ene-2026, ≈ **₡17.391**.

---

## Hallazgos de la Ronda 1 (03/11)
- **Familia 29 = menú mediodía.** Los componentes del Bento salen en jul-2025 (cada box = 4 líneas de ₡1.747,79 neto, o sea ₡7.900/1,13). Casado, Sakura Poke, Bowl Teriyaki Lunch, Sushi Duo, Fish & Chips, Ceviche Tico-Nikkei y las bebidas «green» (1048, 1049, 1051, 1052, 1053) salen en sep-2025. La Bento Lemonade (310) iba a ₡0 entre jul y sep de 2025.
- **Bebidas «green» del menú:** son familia 29, no 5. Sin separarlas, la Q1 las cuenta como comida.
- **`pax_alerta`:** nunca es «ok» (no hay pax nativo), así que `tickets_con_alerta` = todos. No sirve como señal.
- **Prom/pax limpio** = neta de tickets con pax ÷ pax. Antes de sep-2025 el 20–44 % de las mesas de la mañana no tenía pax: el prom/pax crudo de esa época está inflado.

| Mañana (limpio) | ₡/pax |
|---|---|
| 2024 | 13.344 |
| ene–jun 2025 | 14.146 |
| jul–nov 2025 (lanzamiento) | 11.994 |
| dic 2025 – feb 2026 | 10.438 |
| mar–abr 2026 | 10.884 |
| may–oct 2026 | 11.556 |

La noche (limpio) se mantiene plana, entre 15,4k y 16,6k. No hay suba general de precios ni de gasto que explique lo de la mañana.

## Ronda 2

### Q2 — Peso del menú mediodía por mes y turno, y mesas con MD contra mesas sin MD
```sql
with t as (
  select id, turno, pax,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon'
    and fecha_registra >= timestamptz '2025-01-01 00:00:00-06'
),
l as (
  select l.ticket_id,
    sum(l.monto) filter (where l.familia is null or l.familia not in (6,17,20)) as neta,
    sum(l.monto) filter (where l.familia = 29 and l.codigo_producto not in ('1048','1049','1051','1052','1053','310')) as md_comida,
    sum(l.monto) filter (where l.familia = 29 and l.codigo_producto in ('1048','1049','1051','1052','1053','310')) as md_bebida,
    sum(l.monto) filter (where l.familia = 5) as bebida_carta,
    sum(l.cantidad) filter (where l.familia = 29 and l.nombre ilike '%bento%') / 4.0 as boxes,
    sum(l.cantidad) filter (where l.familia = 29 and l.nombre not ilike '%bento%'
                              and l.codigo_producto not in ('1048','1049','1051','1052','1053','310')) as platos_md,
    sum(l.cantidad) filter (where l.familia in (2,3,4,13,16)) as uds_carta,
    sum(l.cantidad) filter (where l.familia = 5
                               or l.codigo_producto in ('1048','1049','1051','1052','1053','310')) as uds_bebida
  from public.pos_ndf_ticket_lines l
  where l.ticket_id in (select id from t)
  group by l.ticket_id
),
j as (
  select t.mes, t.turno, t.pax,
         coalesce(l.neta,0) as neta, coalesce(l.md_comida,0) as md_comida,
         coalesce(l.md_bebida,0) as md_bebida, coalesce(l.bebida_carta,0) as bebida_carta,
         coalesce(l.boxes,0) as boxes, coalesce(l.platos_md,0) as platos_md,
         coalesce(l.uds_carta,0) as uds_carta, coalesce(l.uds_bebida,0) as uds_bebida,
         coalesce(l.md_comida,0) > 0 as con_md
  from t left join l on l.ticket_id = t.id
)
select mes, turno, count(*) as tickets, sum(pax) as pax,
  round(sum(neta) filter (where pax > 0) / nullif(sum(pax),0))                                as prom_pax_limpio,
  round(100.0 * count(*) filter (where con_md) / count(*), 1)                                  as pct_mesas_con_md,
  round(100.0 * sum(pax) filter (where con_md) / nullif(sum(pax),0), 1)                        as pct_pax_en_mesas_md,
  round(100.0 * sum(md_comida + md_bebida) / nullif(sum(neta),0), 1)                           as pct_neta_md,
  round(sum(boxes)) as boxes, sum(platos_md) as platos_md_sin_box,
  round(100.0 * (sum(boxes) + sum(platos_md)) / nullif(sum(pax),0), 1)                         as platos_md_x100pax,
  round(100.0 * sum(uds_carta) / nullif(sum(pax),0), 1)                                        as platos_carta_x100pax,
  round(sum(bebida_carta + md_bebida) filter (where pax > 0) / nullif(sum(pax),0))             as bebida_pax_limpio,
  round(sum(uds_bebida) filter (where pax > 0) / nullif(sum(pax),0), 2)                        as uds_bebida_pax,
  round(sum(neta) filter (where pax > 0 and con_md)     / nullif(sum(pax) filter (where con_md),0))     as prom_pax_mesas_md,
  round(sum(neta) filter (where pax > 0 and not con_md) / nullif(sum(pax) filter (where not con_md),0)) as prom_pax_mesas_sin_md,
  round(sum(bebida_carta + md_bebida) filter (where pax > 0 and con_md) / nullif(sum(pax) filter (where con_md),0))         as bebida_pax_mesas_md,
  round(sum(bebida_carta + md_bebida) filter (where pax > 0 and not con_md) / nullif(sum(pax) filter (where not con_md),0)) as bebida_pax_mesas_sin_md
from j
group by mes, turno
order by turno, mes;
```

### Q3 — Mesas con pax y sin venta (dueños, cortesías, personal), que bajan el prom/pax
```sql
with t as (
  select id, turno, pax,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and pax > 0
    and fecha_registra >= timestamptz '2024-01-01 00:00:00-06'
),
l as (
  select ticket_id,
         sum(monto) filter (where familia is null or familia not in (6,17,20)) as neta,
         bool_or(familia = 28) as tiene_duenos,
         bool_or(familia = 17) as tiene_cortesia,
         bool_or(familia = 6)  as tiene_personal
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by ticket_id
)
select t.mes, t.turno, sum(t.pax) as pax_total,
  count(*)   filter (where coalesce(l.neta,0) <= 0) as mesas_neta_cero,
  sum(t.pax) filter (where coalesce(l.neta,0) <= 0) as pax_neta_cero,
  sum(t.pax) filter (where l.tiene_duenos)          as pax_mesas_duenos,
  sum(t.pax) filter (where l.tiene_cortesia)        as pax_mesas_cortesia,
  sum(t.pax) filter (where l.tiene_personal)        as pax_mesas_personal
from t left join l on l.ticket_id = t.id
group by 1, 2
order by 2, 1;
```

### Q4 — Ranking de platos de la mañana por período (Bento = 1 box)
```sql
with t as (
  select id, pax,
    case
      when fecha_registra < timestamptz '2025-09-01 00:00:00-06' then null
      when fecha_registra < timestamptz '2025-12-01 00:00:00-06' then 'A sep-nov 2025'
      when fecha_registra < timestamptz '2026-03-01 00:00:00-06' then 'B dic 2025-feb 2026'
      when fecha_registra < timestamptz '2026-11-01 00:00:00-06' then 'C mar-oct 2026'
    end as periodo
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and turno = 'mañana'
),
tp as (select periodo, count(*) as tickets, sum(pax) as pax from t where periodo is not null group by 1),
x as (
  select t.periodo,
         case when l.familia = 29 and l.nombre ilike '%bento%' then 'BENTO BOX' else l.nombre end as producto,
         (l.familia = 29) as es_md,
         sum(case when l.familia = 29 and l.nombre ilike '%bento%' then l.cantidad / 4.0 else l.cantidad end) as platos,
         count(distinct t.id) as mesas,
         sum(l.monto) as neta
  from t join public.pos_ndf_ticket_lines l on l.ticket_id = t.id
  where t.periodo is not null
    and l.familia in (2,3,4,13,16,29)
    and l.codigo_producto not in ('1048','1049','1051','1052','1053','310')
  group by 1, 2, 3
),
r as (
  select x.*, tp.pax, tp.tickets,
         rank() over (partition by x.periodo order by x.platos desc) as puesto,
         sum(x.neta) over (partition by x.periodo) as neta_comida_periodo
  from x join tp using (periodo)
)
select periodo, puesto, producto, es_md, round(platos) as platos,
       round(100.0 * platos / pax, 1)          as platos_x100pax,
       round(100.0 * mesas / tickets, 1)       as pct_mesas,
       round(neta)                             as neta,
       round(neta / nullif(platos,0))          as neta_por_plato,
       round(100.0 * neta / neta_comida_periodo, 1) as pct_neta_comida
from r
where puesto <= 30
order by periodo, puesto;
```

## Ronda 3 (03/11): reconstruir pax, costo y perfil de cliente

### Q5 — Reconstrucción del pax (v2: calcula en SQL, 1 fila por mes y turno)
> v1 se cortó en 100 filas: el SQL Editor de Supabase agrega `limit 100` si la consulta no trae uno. **Toda consulta lleva `limit` explícito.**
> Modelo: pax promedio según platos (Bento = 1) y bebidas de la mesa, por turno y tipo de mesa, aprendido de mesas con pax desde sep-2025; se aplica a las mesas sin pax. `sesgo_modelo_pct` y `error_medio_mesa` miden el modelo contra mesas que SÍ tienen pax (en 2024–ago 2025 es prueba fuera de muestra).
```sql
with t as (
  select id, turno, pax, fecha_registra,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and turno in ('mañana','noche')
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
    bool_or(clase in ('md_bento','md_plato')) as con_md
  from lc group by ticket_id
),
x as (
  select t.mes, t.turno, t.pax, t.fecha_registra,
         coalesce(f.con_md, false) as con_md,
         least(coalesce(f.platos, 0), 6) as p,
         least(coalesce(f.bebidas, 0), 6) as b,
         coalesce(f.neta, 0) as neta
  from t left join f on f.ticket_id = t.id
),
cal as (
  select turno, con_md, p, b, avg(pax)::numeric as pm, count(*) as n
  from x where pax > 0 and fecha_registra >= timestamptz '2025-09-01 00:00:00-06'
  group by 1, 2, 3, 4
),
cal2 as (
  select turno, con_md, p, avg(pax)::numeric as pm
  from x where pax > 0 and fecha_registra >= timestamptz '2025-09-01 00:00:00-06'
  group by 1, 2, 3
),
e as (
  select x.*, coalesce(case when cal.n >= 5 then cal.pm end, cal2.pm, 1) as pe
  from x
  left join cal  on cal.turno = x.turno and cal.con_md = x.con_md and cal.p = x.p and cal.b = x.b
  left join cal2 on cal2.turno = x.turno and cal2.con_md = x.con_md and cal2.p = x.p
)
select mes, turno,
  count(*)                                                    as tickets,
  count(*) filter (where pax = 0)                             as tickets_sin_pax,
  sum(pax)                                                    as pax_cargado,
  round(coalesce(sum(pe) filter (where pax = 0), 0))          as pax_estimado_faltante,
  round(sum(pax) + coalesce(sum(pe) filter (where pax = 0), 0)) as pax_reconstruido,
  round(sum(neta))                                            as neta,
  round(sum(neta) / nullif(sum(pax) + coalesce(sum(pe) filter (where pax = 0), 0), 0)) as prom_pax_reconstruido,
  round(100.0 * (sum(pe) filter (where pax > 0) / nullif(sum(pax) filter (where pax > 0), 0) - 1), 1) as sesgo_modelo_pct,
  round(avg(abs(pe - pax)) filter (where pax > 0), 2)         as error_medio_mesa,
  count(*) filter (where con_md)                              as tickets_md,
  round(coalesce(sum(case when pax > 0 then pax else pe end) filter (where con_md), 0)) as pax_reconstruido_md,
  round(coalesce(sum(neta) filter (where con_md), 0))         as neta_md
from e
group by 1, 2
order by 2, 1
limit 500;
```

### Q6 — Mezcla de productos por período y tipo de mesa, solo mesas con pax (para costear por pax)
```sql
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
order by 1, 2, 4, 3
limit 5000;
```

### Q7 — Perfil de cliente por mes: descuento, pago en USD, pago electrónico, hora
> Resultado 03/11: `descuento_crc`, `dolares_*` y `electronico_crc` vienen en 0 en todo el historial (la ingesta no los llena o el PoS no los usa así). Solo sirven efectivo/tarjeta y hora.
```sql
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
```

### Q0c — Catálogo completo del menú (familia 29)
> Q0 se cortó en 100 filas: faltan los productos de menos venta.
```sql
select l.codigo_producto, max(l.nombre) as nombre,
       sum(l.cantidad) as uds, round(sum(l.monto)) as neta,
       sum(l.cantidad) filter (where t.turno = 'mañana') as uds_manana,
       min((t.fecha_registra at time zone 'America/Costa_Rica')::date) as primera_venta,
       max((t.fecha_registra at time zone 'America/Costa_Rica')::date) as ultima_venta
from public.pos_ndf_ticket_lines l
join public.pos_ndf_tickets t on t.id = l.ticket_id
where t.local = 'santa-teresa' and t.estado = 'C' and l.familia = 29
group by l.codigo_producto
order by uds desc
limit 500;
```

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

## Hallazgos de la Ronda 4 (03/11)
- **Q8:** no hay cuentas divididas (pedidos = tickets; 0 pedidos divididos en la mañana). Las mesas sin pax son pedidos propios y chicos (₡4k–20k). El pax reconstruido no cuenta dos veces a nadie, así que vale.
- **Q9 (cumplimiento del 20-feb):** las mesas con menú pasaron de 65–80 % (ene–feb) a 40–50 % (mar) y a 20–30 % (jun–jul); desde agosto, 35–50 %. Agosto lo empujan la caja (67,5 %) y los saloneros 032 (46 %) y 026 (41 %). La caja (sin salonero) es el grupo con más menú todo el año, a ~₡8k por persona.
- **Q10:** las mesas con menú piden entrada el 8–19 % de las veces, contra 35–50 % las de carta. Postre: 1–3 % contra 4–5 %. Ningún día de la semana se despega.
- **Margen y pax nuevos:** están en el Doc «Estrategia de mediodía», sección Margen. El método está en `SPEC-reporte-mediodia.md` v2.
