# SQL — Ronda 7: descuento Local Club (15 %) vs tarjetas de descuento (10 %) vs menú en días flojos · 2026-11-03

> Continúa `claude/SQL-analisis-ronda6.md`. Q21 se corre en Supabase PROD (solo `SELECT`, `limit` explícito). D4–D5 se corren en DBeaver contra el PoS (`ndf`, solo lectura).

## Contexto (el dueño, 03/11)
- **Local Club:** 15 % de descuento desde ~2025. No aplica sobre el menú de mediodía.
- **Tarjetas de descuento de hoteles y tiendas:** 10 %. Es otra promoción y se cuenta aparte.
- **Hasta ahora:** el «cliente normal» de Q19/Q20 mezclaba mesas sin descuento con mesas de tarjeta 10 %, así que su margen por persona (₡12.732) está algo subestimado.

## Respuesta preliminar (con Q12, Q14, Q19 y Q20)
Comparación de la noche en sep–oct (temporada floja), con el mismo total de pax de noche (1.570 contra 1.486):

| | sep–oct 2025 (descuento + menú) | sep–oct 2026 (solo descuento) |
|---|---|---|
| Personas LC en carta | 156 | 116 |
| Personas LC con menú | 59 | — |
| Margen LC por mes | ~₡1,07 M | ~₡0,60 M |

- **Margen por persona:** LC en carta con descuento ₡10.365 · LC con menú ₡8.926 · normal ₡12.732.
- **Por persona, el descuento deja más:** ₡1.439 más que el menú.
- **Por volumen, el menú gana.** Cada LC nuevo que trae deja ₡8.926. Cada LC que pasa de carta a menú cuesta ₡1.439.
- **Punto de equilibrio:** el menú conviene si al menos ~14 % de sus LC son nuevos (1.439 ÷ (8.926 + 1.439)).
- **Escenarios, por mes:**

| Escenario | Resultado |
|---|---|
| Todo el aumento de LC es por el menú | +₡470 mil |
| Solo los LC de menú son nuevos | +₡263 mil |
| Ningún LC de menú es nuevo (imposible: los de carta subieron) | −₡42 mil |

- **Conclusión preliminar:** en días flojos, el menú para LC deja más plata que el descuento solo.
- **Falta confirmar:**
  - separar las tarjetas 10 % de los LC 15 %;
  - medir con el mismo período para los dos segmentos.

## Q21 — Descuento inferido por mesa (precio cobrado ÷ precio de lista), por segmento y días
> **Precio de lista** = precio unitario más frecuente del producto en el mes.
> **`ratio`** = neta ÷ valor de lista: ~1,00 sin descuento, ~0,90 tarjeta 10 %, ~0,85 Local Club 15 %. Se lee el histograma por segmento.
> **`excluidas`** = monto de las familias 6, 17 y 20 (control: ver si el descuento llega como línea aparte).
```sql
with t as (
  select id, turno, pax,
    date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes,
    case when extract(isodow from fecha_registra at time zone 'America/Costa_Rica') in (1,2,3)
         then 'lun-mie' else 'jue-dom' end as dias
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
f as (
  select l.ticket_id,
    sum(l.monto) as neta,
    sum(l.cantidad * pl.precio) as valor_lista,
    bool_or(l.familia = 29 and l.nombre not ilike '%extra%'
            and not (l.nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md
  from l
  join pl on pl.codigo_producto = l.codigo_producto and pl.mes = l.mes
  group by 1
),
m as (
  select ticket_id,
    coalesce(sum(cantidad) filter (where codigo_producto = '856'), 0) as lc,
    coalesce(sum(cantidad) filter (where codigo_producto = '857'), 0) as inv,
    coalesce(sum(monto) filter (where familia in (6,17,20)), 0) as excluidas
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by 1
)
select t.mes, t.turno, t.dias,
  case when coalesce(m.lc, 0) > 0 then 'local_club' else 'normal' end as segmento,
  coalesce(f.con_md, false) as con_md,
  least(greatest(round(f.neta / nullif(f.valor_lista, 0), 2), 0.50), 1.10) as ratio,
  count(*) as mesas,
  sum(t.pax) as pax,
  sum(m.lc) as personas_lc,
  sum(m.inv) as invitados,
  round(sum(f.neta)) as neta,
  round(sum(f.valor_lista)) as valor_lista,
  round(sum(m.excluidas)) as excluidas
from t
join f on f.ticket_id = t.id
left join m on m.ticket_id = t.id
group by 1, 2, 3, 4, 5, 6
order by 1, 2, 3, 4, 5, 6
limit 30000;
```

## D4 — PoS: tipos de descuento por mes (DBeaver, SQL Server)
> Verdad directa del PoS para validar Q21. No trae datos personales: solo marca si el nombre dice «LOCAL».
```sql
SELECT CONVERT(char(7), f.FechaRegistra, 120) AS mes,
       p.TipoDescuento,
       p.Descuento,
       CASE WHEN UPPER(ISNULL(p.NombreCliente, '')) LIKE '%LOCAL%' THEN 'LOCAL CLUB' ELSE '' END AS nombre_lc,
       COUNT(*) AS facturas,
       SUM(p.MontoDescuento) AS monto_descuento
FROM FAC_Pedidos p
JOIN FAC_Facturas f ON f.NumeroFactura = p.NumeroFactura
WHERE f.Estado = 'C' AND f.FechaRegistra >= '2024-08-01'
GROUP BY CONVERT(char(7), f.FechaRegistra, 120), p.TipoDescuento, p.Descuento,
         CASE WHEN UPPER(ISNULL(p.NombreCliente, '')) LIKE '%LOCAL%' THEN 'LOCAL CLUB' ELSE '' END
ORDER BY 1, 2, 3, 4;
```

## D5 — PoS: dónde se guarda el descuento y su catálogo (DBeaver)
```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%Descuento%' OR TABLE_NAME LIKE '%Descuento%'
ORDER BY TABLE_NAME, COLUMN_NAME;
```
> Si aparece una tabla catálogo (por ejemplo `FAC_TiposDescuento`), correr `SELECT * FROM <esa tabla>` y exportarla.

## Qué sale de esto
- **Tres segmentos de noche:**
  - sin descuento;
  - tarjeta 10 %;
  - Local Club 15 % (carta y menú).

  Para cada uno: personas, venta y margen por persona, y % lunes a miércoles.
- **Costo mensual de cada descuento:** valor de lista − neta.
- **Desde cuándo el LC es 15 %:** el cambio se ve en el ratio de las mesas LC.
- **Decisión:** descuento contra menú para LC en días flojos, con los segmentos limpios.

## Resultados (03/11)
- **D4–D5 (PoS):**
  - El descuento **no** está en el encabezado. `FAC_Pedidos.Descuento`, `TipoDescuento` y `MontoDescuento` vienen vacíos. Va por línea, en `FAC_PedidosDet.Descuento` / `TipoDescuento` y `FAC_FacturasDet.Descuento`.
  - `NombreCliente = 'LOCAL CLUB'` se usa desde sep-2025: 41–72 facturas por mes, contra 54–127 mesas con el artículo 856.
- **Q21, el ratio separa limpio** (mesas de noche):

| Grupo | Moda del ratio | % de las mesas |
|---|---|---|
| LC marcado (856) | 0,85 | 62 % |
| Normal: sin descuento | 1,00 | 77 % |
| Normal: tarjeta 10 % | 0,90 | 6,7 % |
| Normal: 15 % sin marcar | 0,85 | 4,5 % |

  - **LC marcado:** el resto de sus mesas cae en 0,86–0,92 (descuento parcial).
  - **Mesas con 856:** pagan 85 % desde fines de 2024, con moda 0,85 todos los meses. Mayo-2025 tiene moda 0,80.
  - **Antes de mayo-2025:** las mesas con 10 % eran 10–14 % de la noche; después, 4–6 %. Hay que confirmar si el club era 10 % antes.
  - **LC sin marcar:** 3–5 % de los pax de noche reciben 15 % sin el artículo 856. El Local Club está subcontado ~20 %.
- **Clasificación:**

| Clase | Regla |
|---|---|
| LC | artículo 856, o ratio entre 0,80 y 0,87 |
| Tarjeta 10 % | ratio entre 0,88 y 0,93, sin 856 |
| Sin descuento | ratio ≥ 0,97 |

  - **Costo** = 0,24 × valor de lista en carta y 0,32 en mesas con menú (de Q20 + costlib).
- **Noche, por persona:**

| Período | Sin descuento venta / margen | Tarjeta 10 % venta / margen | LC carta venta / margen | LC menú venta / margen |
|---|---|---|---|---|
| sep–oct 2025 | 17.567 / 13.366 | 16.498 / 12.108 | 15.703 / 11.428 | 13.912 / 9.135 |
| mar–ago 2026 | 17.212 / 13.084 | 16.384 / 12.026 | 13.902 / 10.019 | — |
| sep–oct 2026 | 16.755 / 12.747 | 18.853 / 13.865 | 14.403 / 10.453 | — |

- **Peso en los pax de noche:**

| Período | LC | Tarjeta 10 % |
|---|---|---|
| sep–oct 2025 | 24,7 % | 3,8 % |
| mar–ago 2026 | 16,8 % | 6,1 % |
| sep–oct 2026 | 17,6 % | 10,5 % |

- **Costo de los descuentos, por mes:**

| Período | LC | Tarjeta 10 % |
|---|---|---|
| mar–ago 2026 | ₡514 mil | ₡144 mil |
| sep–oct 2026 | ₡268 mil | ₡150 mil |

- **Descuento vs menú, sep–oct 2025 contra sep–oct 2026:**
  - **Pax de noche por mes:** ~786 contra ~741. Los no-LC casi iguales: −19.
  - **Pax LC por mes:** 194 contra 131.
  - **Margen LC por mes:** ₡2,12 M contra ₡1,36 M (+₡753 mil).
  - **Lunes a miércoles:** margen LC por pax de carta ₡10.428 contra menú ₡7.154. Margen LC +₡237 mil/mes.
  - **Jueves a domingo:** +₡516 mil/mes.
  - **Escenarios:**

| Escenario | Resultado por mes |
|---|---|
| Todo el aumento LC se debe al menú | +₡753 mil |
| Solo los pax LC de menú son nuevos (43,5/mes × ₡9,1 mil) | +₡392 mil |
| Ningún pax LC de menú es nuevo (habrían venido a carta con 15 %) | −₡100 mil |

  - El tercero **no pasó**: los LC de carta subieron (150 contra 131 pax/mes).

## Ronda 8 — consultas para sacar todo (03/11)
> Q22–Q24 usan la misma base que Q21: precio de lista y clase de cada mesa.
> D6–D9 se corren en DBeaver (PoS). D7 va primero: si D6 o D8 fallan por el nombre de una columna, con D7 se corrige.

### Q22 — Quién da cada descuento: salonero o caja, por mes
```sql
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
select mes, turno, coalesce(salonero_login, '(caja)') as salonero, clase,
  count(*) as mesas, sum(pax) as pax,
  round(sum(neta)) as neta, round(sum(lista - neta)) as descuento
from tk
group by 1, 2, 3, 4
order by 1, 2, 3, 4
limit 20000;
```

### Q23 — Qué familias se descuentan y qué pide cada grupo
> En `__MESAS__`: `cantidad` = mesas, `neta` = pax y `lista` = personas LC.
```sql
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
select tk.mes, tk.turno, tk.clase, tk.con_md, '__MESAS__' as familia,
  count(*)::numeric as cantidad, coalesce(sum(tk.pax), 0)::numeric as neta, sum(tk.lc)::numeric as lista
from tk group by 1, 2, 3, 4
union all
select tk.mes, tk.turno, tk.clase, tk.con_md, coalesce(lp.familia::text, 'sin'),
  sum(lp.cantidad), round(sum(lp.monto)), round(sum(lp.lista))
from tk join lp on lp.ticket_id = tk.id
group by 1, 2, 3, 4, 5
order by 1, 2, 3, 4, 5
limit 30000;
```

### Q24 — Cuándo vienen: día de la semana y hora, por grupo
```sql
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
select
  case when mes < date '2025-05-01' then '0 ago-2024 a abr-2025'
       when mes < date '2026-01-01' then '1 may-dic 2025'
       else '2 2026' end as periodo,
  turno, clase, dow, hora,
  count(*) as mesas, sum(pax) as pax, sum(inv) as invitados,
  round(sum(neta)) as neta, round(sum(lista - neta)) as descuento
from tk
group by 1, 2, 3, 4, 5
order by 1, 2, 3, 4, 5
limit 20000;
```

### D6 — PoS: % de descuento por producto, por mes
```sql
SELECT CONVERT(char(7), f.FechaRegistra, 120) AS mes, d.Descuento,
       COUNT(*) AS lineas, COUNT(DISTINCT f.NumeroFactura) AS facturas
FROM FAC_FacturasDet d
JOIN FAC_Facturas f ON f.NumeroFactura = d.NumeroFactura
WHERE f.Estado = 'C' AND f.FechaRegistra >= '2024-08-01' AND ISNULL(d.Descuento, 0) <> 0
GROUP BY CONVERT(char(7), f.FechaRegistra, 120), d.Descuento
ORDER BY 1, 2;
```

### D7 — PoS: columnas de los detalles (para unir bien)
```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('FAC_FacturasDet', 'FAC_PedidosDet', 'FAC_Pedidos', 'FAC_Facturas')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

### D8 — PoS: tipo de descuento por producto, por mes
```sql
SELECT CONVERT(char(7), f.FechaRegistra, 120) AS mes, d.TipoDescuento, d.Descuento,
       COUNT(*) AS lineas, COUNT(DISTINCT f.NumeroFactura) AS facturas
FROM FAC_PedidosDet d
JOIN FAC_Pedidos p ON p.NumeroPedido = d.NumeroPedido
JOIN FAC_Facturas f ON f.NumeroFactura = p.NumeroFactura
WHERE f.Estado = 'C' AND f.FechaRegistra >= '2024-08-01' AND ISNULL(d.Descuento, 0) <> 0
GROUP BY CONVERT(char(7), f.FechaRegistra, 120), d.TipoDescuento, d.Descuento
ORDER BY 1, 2, 3;
```

### D9 — PoS: nombres que se ponen en las facturas (hoteles, empresas, LOCAL CLUB)
> Solo nombres con 3 o más facturas. **Borrar nombres de personas antes de mandar el CSV.**
```sql
SELECT UPPER(LTRIM(RTRIM(p.NombreCliente))) AS nombre,
       COUNT(DISTINCT f.NumeroFactura) AS facturas,
       MIN(CONVERT(char(7), f.FechaRegistra, 120)) AS desde,
       MAX(CONVERT(char(7), f.FechaRegistra, 120)) AS hasta
FROM FAC_Pedidos p
JOIN FAC_Facturas f ON f.NumeroFactura = p.NumeroFactura
WHERE f.Estado = 'C' AND f.FechaRegistra >= '2024-08-01' AND ISNULL(p.NombreCliente, '') <> ''
GROUP BY UPPER(LTRIM(RTRIM(p.NombreCliente)))
HAVING COUNT(DISTINCT f.NumeroFactura) >= 3
ORDER BY 2 DESC;
```

### D10 — PoS: reglas de descuento cargadas (clasificaciones y promociones)
```sql
SELECT * FROM FAC_Clasificaciones;
```
```sql
SELECT * FROM FAC_Promociones;
```

## Resultados ronda 8 (03/11)
- **D7 (columnas):**
  - **Clave de `FAC_PedidosDet` y `FAC_Pedidos`:** Periodo + Mes + Dia + NumeroPedido. El número de pedido se repite entre días.
  - **`FAC_FacturasDet.Descuento`:** es un **monto en ₡** por línea, sin IVA desde mar-2025.
  - **`FAC_PedidosDet.Descuento`:** es el **%**, con `TipoDescuento = 'P'`.
- **D6 (₡ de descuento por mes, total PoS):** ₡0,5–1,2 M. Q21 (salón con 10 %) explica el 75–90 %; el resto es delivery y mesas sin 10 %. La medición inferida queda validada.
- **D8:** la unión fue solo por NumeroPedido y multiplicó las filas. Los conteos no sirven; ver D8 v2.
  - Sí confirma qué porcentajes existen: 10, 15, 20, 30 y 50 son los frecuentes, más 100 (cortesía) y otros raros.
- **D9 (NombreCliente):**
  - **«LOCAL CLUB» como nombre:** 659 facturas. Hay casos sueltos desde mar/may-2025; el uso fuerte empieza en sep-2025 (D4).
  - **Artículo 856:** se carga en serio desde may-2025 (Q21), mismo mes en que bajan las mesas con 10 %.
  - El resto es casi todo nombre por defecto («CLIENTE n» / «(CLIENTE n)»), para llevar, personal y comida personal.
  - Unas pocas empresas: factura electrónica.
  - No hay nombres de hoteles para las tarjetas 10 %. **No se guardan nombres de personas.**
- **D10:**
  - **`FAC_Clasificaciones`:** sin descuentos por familia. Confirma los nombres de familia: 6 PERSONAL, 17 X CORTESIAS, 19 A PAX, 20 Ingredientes, 25 PROMOCIONES, 28 XX DUEÑOS, 29 GREENSEASON.
  - **`FAC_Promociones`:** promociones por producto y día, sin %. No son descuentos.
  - **Familia 28 (dueños):** no tiene venta en el salón con 10 %.
- **Q22 (quién da el descuento, noche 2026):**

| Quién | LC sin marcar / total LC |
|---|---|
| Caja | 136 de 343 (40 %) |
| Saloneros | 0–26 % (mediana ~14 %) |

  - Más de la mitad del LC sin marcar sale de la caja.
- **Q23 (qué se descuenta, noche 2026):**

| Grupo | Ratio pagado ÷ lista |
|---|---|
| LC: comida | 0,85–0,86 |
| LC: bebidas (algunas sin descuento) | 0,886 |
| LC: postres | 0,80 |
| Tarjeta: comida | 0,90 |
| Tarjeta: bebidas | 0,916 |

- **Q24 (cuándo):**
  - **Hora:** las mesas LC cierran más tarde, 26 % después de las 22 h contra 16–18 %.
  - **Día de la semana:** el peso del LC es parejo, 13–18 % de los pax por día en 2026. En may–dic 2025 fue más alto los viernes (26 %).
  - **Mediodía:** LC (15 %) = 5,5–9,2 % de los pax y tarjeta 10 % = 4 %.

## D8 v2 — PoS: % de descuento por mes, con la unión corregida
```sql
SELECT CONVERT(char(7), f.FechaRegistra, 120) AS mes,
       d.Descuento AS pct,
       CASE WHEN UPPER(ISNULL(p.NombreCliente, '')) LIKE '%LOCAL%' THEN 'LOCAL CLUB' ELSE '' END AS nombre_lc,
       COUNT(*) AS lineas,
       COUNT(DISTINCT f.NumeroFactura) AS facturas,
       ROUND(SUM(d.PrecioVenta * d.Cantidad * d.Descuento / 100.0), 0) AS monto_aprox
FROM FAC_PedidosDet d
JOIN FAC_Pedidos p ON p.Periodo = d.Periodo AND p.Mes = d.Mes AND p.Dia = d.Dia AND p.NumeroPedido = d.NumeroPedido
JOIN FAC_Facturas f ON f.NumeroFactura = p.NumeroFactura
WHERE f.Estado = 'C' AND f.FechaRegistra >= '2024-08-01' AND ISNULL(d.Descuento, 0) <> 0
GROUP BY CONVERT(char(7), f.FechaRegistra, 120), d.Descuento,
         CASE WHEN UPPER(ISNULL(p.NombreCliente, '')) LIKE '%LOCAL%' THEN 'LOCAL CLUB' ELSE '' END
ORDER BY 1, 2, 3;
```

## Resultados D8 v2 y ronda 9 (03/11)
- **El dueño confirma:** el Local Club era **10 %** antes. Se evalúa volver al 10 % y sumar otra oferta.
- **D8 v2: facturas por mes según el % de descuento.** El nombre «LOCAL CLUB» se usa desde jun-2025.

| Período | 10 % | 15 % sin nombre | 15 % con nombre LC | 20 % | 30 % |
|---|---|---|---|---|---|
| ene–abr 2025 | 79–126 | 61–91 | — | — | 15–34 |
| may-2025 | 37 | 41 | — | **49** | — |
| jun-2025 – oct-2026 | 14–64 | 31–135 | 21–69 | — | 4–29 |

- **Contradicción a confirmar:** en Q21, las mesas con el artículo 856 ya pagan 15 % en nov-2024 – abr-2025 (moda 0,85). El 856 existe desde ago-2024. O el club pasó a 15 % antes de 2025, o hay otro descuento de 15 %.
  - **Q25** (desde ene-2024) muestra cuándo aparece el 15 % y si baja el 10 %.
- **Otros descuentos que no tienen nombre:**
  - 30 %: 15–30 facturas por mes.
  - 20 %: may-2025.
  - 100 %: cortesías.
  - Preguntar al dueño qué son.
- **Q20 + costlib, productos de noche del LC (mesas LC con carta, mar–ago 2026):**
  - **Índice** = pedidos por 100 pax LC ÷ pedidos por 100 pax normales.

| Producto | Por 100 pax LC | Índice | Margen por unidad (LC) | Costo |
|---|---|---|---|---|
| Subarashi | 14,0 | 1,34 | ₡5.663 | 15 % |
| Rainbow Roll | 11,1 | 1,70 | ₡5.102 | 22 % |
| Ginger Mint Lemonade | 9,9 | 1,48 | ₡2.184 | 13 % |
| Super Maguro | 8,4 | 1,70 | ₡5.443 | 14 % |
| Pollo Teriyaki | 8,2 | 1,43 | ₡6.759 | 18 % |
| California Roll | 8,1 | 1,39 | ₡3.904 | 24 % |
| Satori Roll | 7,9 | 1,21 | ₡4.952 | 26 % |
| Pilsen | 7,8 | 2,22 | ₡1.344 | 37 % |
| El Gusano | 6,9 | 1,65 | ₡3.835 | 22 % |
| Kari Kari / Snapper | 5,4 / 4,9 | 1,7 / 1,5 | ₡4.900 / ₡4.350 | 23 / 31 % |
| Margarita | 4,3 | 1,77 | ₡3.405 | 23 % |
| Gin tonic | 5,2 | alto | ₡2.624 | 49 % |

  - **Por familia, cada 100 pax (LC contra normal):**

| Familia | LC | Normal |
|---|---|---|
| Rolls | 100 | 96 |
| Entradas | 48 | 53 |
| Postres | 4,8 | 6,1 |
| Pokes | 18 | 22 |
| Bebidas | 120 | 121 |

  - **Lo que más se nota:** el LC pide rolls premium de costo bajo (Subarashi, Super Maguro y Rainbow cuestan 14–22 %). Pide menos postres y entradas.
- **Volver a 10 %:**
  - **Ahorro, si no se pierde nadie:** ~1/3 del costo del descuento LC. Son ~₡170 mil/mes en alta y media (mar–ago 2026) y ~₡90 mil en baja.
  - **Pax LC que se pueden perder antes de que dé pérdida:** el margen por pax LC al 10 % es ~₡10,8 mil.
    - Alta y media: ~16 pax/mes de ~226 (~7 %).
    - Baja: ~8 de ~130 (~6 %).

### Q25 — Clases de descuento por mes desde ene-2024 (cuándo empieza el 15 %)
```sql
with t as (
  select id, turno, pax, salonero_login, registrado_por,
    date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes,
    extract(isodow from fecha_registra at time zone 'America/Costa_Rica')::int as dow,
    extract(hour from fecha_registra at time zone 'America/Costa_Rica')::int as hora
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and con_servicio
    and turno in ('mañana','noche')
    and fecha_registra >= timestamptz '2024-01-01 00:00:00-06'
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
select mes, turno, clase,
  count(*) as mesas, sum(pax) as pax,
  round(sum(neta)) as neta, round(sum(lista - neta)) as descuento
from tk
group by 1, 2, 3
order by 1, 2, 3
limit 5000;
```

## Resultados Q25 (03/11): ¿el 15 % trajo más gente?
Noche, promedio por mes de los pax:

| Período | Club al | 10 % | 15 % | 10 % + 15 % | Sin descuento | Total |
|---|---|---|---|---|---|---|
| ene–abr 2024 | 10 % | 285 | 46 | **331** | 1.599 | 1.962 |
| ene–abr 2025 | 15 % | 210 | 120 | **330** | 1.673 | 2.029 |
| ene–abr 2026 | 15 % | 114 | 278 | 392 | 1.432 | 1.839 |
| may–oct 2024 | 10 % | 191 | 63 | 254 | 1.110 | 1.387 |
| may–oct 2025 | 15 % | 64 | 211 | 275 | 703 | 994 |
| may–oct 2026 | 15 % | 75 | 177 | 252 | 779 | 1.043 |

- **Comparación limpia, ene–abr 2024 contra 2025:** misma temporada y casi los mismos pax sin descuento.
  - Los pax con descuento quedaron iguales (331 → 330).
  - ~75 pax por mes pasaron del 10 % al 15 %, o sea las mismas personas pagando 5 % menos.
  - Subir a 15 % **no trajo gente**.
- **Desde el pase a 15 %:** el % de pax con descuento sube, pero porque cae el resto (turistas), no porque crezca el descuento.
  - **Baja:** 254 → 275 → 252 pax con descuento.
  - **Alta:** 331 → 330 → 392.
  - **ene–abr 2026:** +62 pax con descuento. Puede ser la marcación, el boca a boca o el club que crece. No alcanza para atribuirlo al 15 %.
- **Fechas:** el 15 % se carga con el artículo 856 desde nov–dic 2024.
  - **Antes:** ya había 24–79 mesas por mes con 15 % sin el 856. ¿Otro beneficio? Preguntar.
- **Conclusión:** volver al 10 % ahorra unos ₡170 mil por mes en alta y ₡90 mil en baja (₡1,6–1,7 M al año). El riesgo de perder socios es bajo, porque el 15 % no los trajo.
  - **Para cubrir el riesgo:** regalo barato por persona y medir 2–3 meses.
  - **Deja de convenir** si se pierde más del 7 % de las visitas del club.

## Corrección de historia (el dueño, 03/11)
- **Local Club:** empezó el **23-abr-2025**.
  - **Antes:** existía la **VIP card**, que tuvo 10 % un tiempo y 15 % otro tiempo.
- **Tarjetas de hoteles y tiendas (10 %):** fue la primera promoción.
  - **Comisión:** al comercio se le dan **₡2.000 en consumo en el restaurante** (no en efectivo) por cada tarjeta que llega (confirmado el 03/11).
    - **Costo real:** el costo de comida de ese consumo, unos ₡500 por tarjeta.
  - **Costo real de la tarjeta:**
    - Descuento: ~₡150 mil/mes.
    - Crédito: ~46 mesas/mes × ₡500 ≈ ₡23 mil.
    - Total: **~₡175 mil/mes**.
  - **Margen por pax:** ~₡11,8 mil, contra ~₡10,0 mil del LC. Conviene.
  - **Mayo-2025, 20 %:** confirmado como promo de lanzamiento del Local Club.
- **Reinterpretación de Q25:**
  - **ene–abr 2024 contra ene–abr 2025** compara la **VIP card**, no el Local Club. La VIP pasó a 15 % con el artículo 856 hacia ago–nov 2024. Ese cambio de 10 a 15 % no sumó gente (331 → 330 pax con descuento).
  - **Local Club al 15 % (desde abr-2025):** nunca se probó al 10 %.
    - **may–oct 2024 → may–oct 2025:** los pax con descuento se sostuvieron (254 → 275) mientras los sin descuento cayeron 37 %. El LC retuvo o sumó locales en un año malo de turismo.
  - **Volver al 10 %:**
    - **Precedente:** el de la VIP sugiere poca sensibilidad al precio. Pero el club es otro programa: hay que probarlo y medirlo.
    - **Punto de pérdida:** perder más del 7 % de las visitas del club.

## Otros descuentos (el dueño, 03/11)
- **30 %:** personal que viene a consumir fuera de servicio.
- **Créditos de comercios:** facturas con nombre «CREDITOS» / «CREDITOS NUEVO». Se cierran como regalía o «a crédito» (ver la corrección en los resultados de D11). D9 encontró 194 facturas «CREDITOS NUEVO» desde ene-2025.
- **Q21–Q25:** clasificaban ambos casos como «otro» (el 100 % queda con neta 0). Esto no cambia los resultados de LC y tarjetas.

## D11 — PoS: créditos a comercios, personal 30 % y otros 100 % por mes (con costo real)
```sql
WITH fp AS (
  SELECT f.NumeroFactura,
         CONVERT(char(7), f.FechaRegistra, 120) AS mes,
         UPPER(ISNULL(f.NombreCliente, '')) AS nombre,
         MAX(ISNULL(d.Descuento, 0)) AS pct_max
  FROM FAC_Facturas f
  JOIN FAC_Pedidos p ON p.NumeroFactura = f.NumeroFactura
  JOIN FAC_PedidosDet d ON d.Periodo = p.Periodo AND d.Mes = p.Mes AND d.Dia = p.Dia AND d.NumeroPedido = p.NumeroPedido
  WHERE f.Estado = 'C' AND f.FechaRegistra >= '2024-08-01'
  GROUP BY f.NumeroFactura, CONVERT(char(7), f.FechaRegistra, 120), UPPER(ISNULL(f.NombreCliente, ''))
),
fd AS (
  SELECT NumeroFactura,
         SUM(Cantidad * PrecioVenta) AS bruto,
         SUM(ISNULL(Descuento, 0)) AS descuento,
         SUM(MontoTotal) AS total,
         SUM(CostoTotal) AS costo
  FROM FAC_FacturasDet
  WHERE NumeroFactura IN (SELECT NumeroFactura FROM fp)
  GROUP BY NumeroFactura
)
SELECT fp.mes,
       CASE WHEN fp.nombre LIKE '%CREDITO%' THEN 'credito comercios'
            WHEN fp.pct_max = 30 THEN 'personal 30%'
            WHEN fp.pct_max = 100 THEN 'otro 100%'
            ELSE 'otro' END AS tipo,
       COUNT(*) AS facturas,
       ROUND(SUM(fd.bruto), 0) AS bruto,
       ROUND(SUM(fd.descuento), 0) AS descuento,
       ROUND(SUM(fd.total), 0) AS total_cobrado,
       ROUND(SUM(fd.costo), 0) AS costo
FROM fp JOIN fd ON fd.NumeroFactura = fp.NumeroFactura
WHERE fp.nombre LIKE '%CREDITO%' OR fp.pct_max IN (30, 100)
GROUP BY fp.mes,
         CASE WHEN fp.nombre LIKE '%CREDITO%' THEN 'credito comercios'
              WHEN fp.pct_max = 30 THEN 'personal 30%'
              WHEN fp.pct_max = 100 THEN 'otro 100%'
              ELSE 'otro' END
ORDER BY 1, 2;
```
> Salen por mes:
> - el costo real de los créditos a comercios, contra las facturas con 10 % de D8 v2 (cuántas tarjetas llegan por cada crédito usado);
> - el costo del descuento al personal;
> - las cortesías al 100 %.
>
> `CostoTotal` es el costo que tiene el PoS. Si está vacío, se usa el modelo de costos.

## Resultados D11 (03/11), promedio por mes en 2026
| Tipo | Facturas | Venta registrada | Descuento | Costo PoS |
|---|---|---|---|---|
| Créditos a comercios | 11 | ₡326 mil | ₡2 mil | **₡80 mil** |
| Personal 30 % | 17 | ₡128 mil cobrados | ₡54 mil | ₡45 mil |
| Otras cortesías (líneas al 100 %) | 3 | ₡110 mil cobrados | ₡34 mil | ₡34 mil |

- **Créditos (corrección del dueño, 03/11):**
  - **Qué son:** las facturas «CREDITO(S)» son **todas las mesas** de alguien que vino a consumir sus créditos por haber mandado gente. No pagan.
  - **Cómo se cierran:** como **regalía** o con la opción **«a crédito»** del PoS, según el período.
  - **Monto:** ~₡326 mil/mes de consumo a precio de lista, con costo real de **~₡80 mil/mes**.
  - **El cálculo «~160 tarjetas»:** no vale. El consumo canjeado no tiene por qué coincidir con lo acumulado en el mes.
  - **Si cuentan como venta, depende del cierre:**
    - **Regalía** (total cobrado 0): la app la clasifica `sin_cobro` → `regalia_crc`, si la 063 está en prod.
    - **«A crédito»:** puede entrar en `total_crc` como medio de pago y figurar como venta.
    - **Sumas por línea:** como en Q21–Q25, siempre las incluyen. Son ~11 mesas/mes, impacto chico.
  - **D12 / Q26:** ver cómo se cerró cada período y cómo lo ve la app.
- **Costo real del programa de tarjetas:**
  - Descuento 10 %: ~₡150 mil.
  - Costo de los créditos: ~₡80 mil.
  - Total: **~₡230 mil/mes**.
  - **Margen por pax con tarjeta:** ~₡11,3 mil, contra ~₡10,0 mil del LC. Sigue conviniendo.
- **Personal 30 %:**
  - **Costo:** ~₡54 mil/mes de descuento. Se cobra arriba del costo, así que no da pérdida.
  - **Tendencia:** subió en jul–oct 2026 (19–29 facturas por mes, contra 5–9 un año antes).
- **Calidad de datos (para la SPEC integrada):**
  - **Problema:** los canjes de crédito tienen que salir de la venta y entrar como regalía (costo del programa de tarjetas) en los dos modos de cierre.
  - **Cómo se identifican:** por `NombreCliente LIKE '%CREDITO%'` o por el medio «cuenta por cobrar».

## D12 — PoS: cómo se cerraron las facturas de créditos, por mes
```sql
SELECT CONVERT(char(7), f.FechaRegistra, 120) AS mes,
       CASE WHEN ISNULL(f.CuentaCobrar, 0) > 0 THEN 'a credito'
            WHEN ISNULL(f.MotivoRegalia, '') <> '' THEN 'regalia'
            WHEN ISNULL(f.Efectivo, 0) + ISNULL(f.Tarjeta, 0) + ISNULL(f.Deposito, 0)
                 + ISNULL(f.MontoElectronico, 0) + ISNULL(f.Cheque, 0) = 0 THEN 'sin pago'
            ELSE 'pagada (revisar)' END AS cierre,
       COUNT(*) AS facturas,
       ROUND(SUM(ISNULL(f.CuentaCobrar, 0)), 0) AS cuenta_cobrar,
       ROUND(SUM(ISNULL(f.Efectivo, 0) + ISNULL(f.Tarjeta, 0) + ISNULL(f.Deposito, 0)
                 + ISNULL(f.MontoElectronico, 0) + ISNULL(f.Cheque, 0)), 0) AS pagado
FROM FAC_Facturas f
WHERE f.Estado = 'C' AND f.FechaRegistra >= '2024-08-01'
  AND UPPER(ISNULL(f.NombreCliente, '')) LIKE '%CREDITO%'
GROUP BY CONVERT(char(7), f.FechaRegistra, 120),
         CASE WHEN ISNULL(f.CuentaCobrar, 0) > 0 THEN 'a credito'
              WHEN ISNULL(f.MotivoRegalia, '') <> '' THEN 'regalia'
              WHEN ISNULL(f.Efectivo, 0) + ISNULL(f.Tarjeta, 0) + ISNULL(f.Deposito, 0)
                   + ISNULL(f.MontoElectronico, 0) + ISNULL(f.Cheque, 0) = 0 THEN 'sin pago'
              ELSE 'pagada (revisar)' END
ORDER BY 1, 2;
```

## Q26 — Supabase: cómo clasifica la app los cierres sin cobro y las regalías, por mes
> Requiere la migración 063 (`clase_ingreso`, `valor_servido_crc`, `regalia_crc`). Si da error de columna, la 063 no está en PROD y basta con avisar.
```sql
select date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes,
       clase_ingreso,
       count(*) as tickets,
       round(sum(total_crc)) as total_cobrado,
       round(sum(valor_servido_crc)) as valor_servido,
       round(sum(regalia_crc)) as regalia
from public.pos_ndf_tickets
where local = 'santa-teresa' and estado = 'C'
  and fecha_registra >= timestamptz '2025-01-01 00:00:00-06'
group by 1, 2
order by 1, 2
limit 1000;
```

## Resultados Q26 (03/11)
- **`sin_cobro` casi no aparece:** 0–4 tickets/mes. Las ~11 facturas «CREDITO» de cada mes **no** caen ahí.
  - **Dónde caen:** casi seguro en **`cobrada`** (total_crc > 0). El «a crédito» entra como medio de pago.
  - **Efecto:** inflan la venta en ~₡250–430 mil/mes, alrededor del 1 % de la venta neta.
  - **Confirmar con D12:** columna `cuenta_cobrar` > 0.
- **Hallazgo aparte:**
  - **`cortesia`:** 9–51 tickets/mes con `valor_servido` de ₡0,4–3,1 M y `regalia_crc` = 0. Según la SPEC de regalías (firmada el 04/09), `regalia_crc` debería sumar las líneas de la familia 17.
  - **Posibles causas:** que las líneas 17 vengan a ₡0, o un desvío del mapper. Revisar en la próxima pasada de calidad de datos, sin urgencia.
  - **`null`:** ~50–70 tickets/mes en ene–ago 2025, con todo en 0 (anuladas o vacías).

## Resultados D12 (03/11)
- **Cómo se cierran:** casi todas las facturas «CREDITO» van **«a crédito»** (`CuentaCobrar`). Hay 0–4 por mes «sin pago»; esas son las `sin_cobro` de la app.
- **Lo que paga el crédito, 2026:** `cuenta_cobrar` ₡128–404 mil/mes, promedio **~₡263 mil**. Bruto, con IVA y servicio.
  - Entra a la venta como cobrado sin que entre plata.
- **Lo que pagan aparte:** en esas mismas facturas se pagan ~₡124 mil/mes en efectivo o tarjeta, lo que consumen por encima del crédito.
  - El programa también genera venta real.
- **Ajuste al costo del programa:** a los créditos les corresponde ~68 % del costo de esas mesas, o sea **~₡55 mil/mes**.
  - **Total del programa:** descuento ~₡150 mil + créditos ~₡55 mil = **~₡205 mil/mes**.
  - **Margen por pax con tarjeta:** ~₡11,5 mil.
- **SPEC integrada, §6:** se agregan el #6 (ingestar `CuentaCobrar` y pasar los canjes a regalía) y el #7 (revisar `regalia_crc` en las cortesías).

## Aclaración (el dueño, 03/11)
- **App y PoS dan la misma venta.** La app no se equivoca: refleja el PoS.
- **Cómo lo trata el PoS:** las mesas «a crédito» cuentan como venta pagada con cuenta por cobrar. Contablemente es correcto, aunque esa cuenta no se cobra nunca.
- **Para gestión:** son costo del programa de tarjetas.
- **Ajuste a mostrar:** ~₡263 mil/mes brutos de «venta» que no es plata.
- **Opciones:**
  1. **Cerrar los canjes como regalía en el PoS**, con un motivo fijo: deja de contar como venta.
  2. **Seguir «a crédito»** y que la app los muestre aparte (SPEC #6).
- **A revisar con el contador:** si hay saldo de cuentas por cobrar acumulado en el PoS y cómo se tratan el IVA y el servicio de esas facturas.

## D13 (03/11): IVA y servicio de las facturas «CREDITO», promedio 2026
- **Facturas completas:** total ~₡352 mil/mes, IVA ~₡46 mil, servicio ~₡34 mil.
- **Parte del crédito:** es ~75 % del total (₡263 mil de ₡352 mil). Le corresponden IVA **~₡34 mil/mes** y servicio **~₡26 mil/mes**.
- **IVA en ene–feb 2025:** viene en 0.
- **Salida real máxima del canje:**
  - Comida: ~₡55 mil.
  - IVA: ~₡34 mil.
  - Servicio: ~₡26 mil.
  - Total: **~₡115 mil/mes** (~₡1,4 M/año). Solo se paga lo de IVA y servicio si se declaran y se reparten.
- **Pendiente:**
  - **Propinas:** ¿el reparto usa el servicio facturado (incluye estas mesas) o el cobrado? Lo confirma el dueño o se revisa el cálculo de propinas, sin tocarlo.
  - **IVA de canjes y regalías:** lo define el contador.
