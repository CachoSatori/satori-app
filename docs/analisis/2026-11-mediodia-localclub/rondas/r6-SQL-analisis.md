# SQL — Ronda 6: margen real vs sin menú, delivery, perfil Local Club, campo «cliente» del PoS · 2026-11-03

> Continúa `claude/SQL-analisis-mediodia.md` (Q0–Q10) y `claude/SQL-analisis-mediodia-ronda5.md` (Q11–Q17).
> Q18–Q20 se corren en Supabase PROD (solo `SELECT`, `limit` explícito). D1–D3 se corren en **DBeaver contra la base del PoS** (SQL Server `ndf`, usuario de solo lectura).

## D1 — PoS: ¿dónde está el nombre del cliente o de la mesa? (DBeaver, SQL Server)
```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('FAC_Facturas', 'FAC_Pedidos')
  AND (COLUMN_NAME LIKE '%Client%' OR COLUMN_NAME LIKE '%Nombre%' OR COLUMN_NAME LIKE '%Mesa%'
       OR COLUMN_NAME LIKE '%Observ%' OR COLUMN_NAME LIKE '%Nota%' OR COLUMN_NAME LIKE '%Cedula%')
ORDER BY TABLE_NAME, COLUMN_NAME;
```

## D2 — PoS: tablas de clientes (DBeaver)
```sql
SELECT t.TABLE_NAME,
       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_NAME = t.TABLE_NAME) AS columnas
FROM INFORMATION_SCHEMA.TABLES t
WHERE t.TABLE_NAME LIKE '%Client%'
ORDER BY t.TABLE_NAME;
```

## D3 — PoS: muestra de pedidos y facturas de octubre (DBeaver)
> Sirve para ver qué campo trae el nombre que ponen los saloneros. Exportar a CSV. No contiene medios de pago.
```sql
SELECT TOP 40 p.*
FROM FAC_Pedidos p
WHERE p.NumeroFactura IS NOT NULL
ORDER BY p.NumeroFactura DESC;
```
```sql
SELECT TOP 40 f.NumeroFactura, f.FechaRegistra, f.Login, f.Estado, f.*
FROM FAC_Facturas f
WHERE f.Estado = 'C'
ORDER BY f.NumeroFactura DESC;
```

## Q18 — Mañana: mezcla de productos por período, salón/delivery y con/sin menú (para el margen real)
```sql
with t as (
  select id, pax,
    case when canal in ('delivery','llevar','otro') then 'delivery' else 'salon' end as grupo,
    case
      when fecha_registra < timestamptz '2025-01-01 00:00:00-06' then null
      when fecha_registra < timestamptz '2025-07-01 00:00:00-06' then '0 ene-jun 2025'
      when fecha_registra < timestamptz '2025-12-01 00:00:00-06' then 'A jul-nov 2025'
      when fecha_registra < timestamptz '2026-03-01 00:00:00-06' then 'B dic 2025-feb 2026'
      when fecha_registra < timestamptz '2026-08-01 00:00:00-06' then 'C mar-jul 2026'
      when fecha_registra < timestamptz '2026-11-01 00:00:00-06' then 'D ago-oct 2026'
    end as periodo
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and turno = 'mañana'
    and (canal in ('delivery','llevar','otro') or (canal = 'salon' and con_servicio))
),
lc as (
  select l.ticket_id, l.cantidad, l.monto, l.familia, l.nombre,
    case
      when l.familia = 29 and (l.codigo_producto in ('1048','1049','1050','1051','1052','1053','1054','1055','310')
           or l.nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%'])) then 'md_bebida'
      when l.familia = 29 and l.nombre ilike '%extra%' then 'md_extra'
      when l.familia = 29 then 'md_plato'
      else 'carta'
    end as clase
  from public.pos_ndf_ticket_lines l
  where l.ticket_id in (select id from t where periodo is not null)
    and (l.familia is null or l.familia not in (6,17,19,20) or l.codigo_producto = '1075')
),
md as (select ticket_id, bool_or(clase = 'md_plato') as con_md from lc group by ticket_id),
tt as (
  select t.id, t.pax, t.grupo, t.periodo, coalesce(md.con_md, false) as con_md
  from t left join md on md.ticket_id = t.id
  where t.periodo is not null
)
select periodo, grupo, con_md, '__TICKETS__' as nombre, null::int as familia,
       count(*)::numeric as cantidad, coalesce(sum(pax), 0)::numeric as neta
from tt group by 1, 2, 3
union all
select tt.periodo, tt.grupo, tt.con_md, lc.nombre, lc.familia,
       sum(lc.cantidad)::numeric, round(sum(lc.monto))::numeric
from tt join lc on lc.ticket_id = tt.id
group by 1, 2, 3, 4, 5
order by 1, 2, 3, 5, 4
limit 10000;
```
> En la fila `__TICKETS__`, `cantidad` = tickets y `neta` = pax cargado.

## Q19 — Perfil Local Club vs cliente normal (mesas de salón)
```sql
with t as (
  select id, turno, pax,
    extract(isodow from fecha_registra at time zone 'America/Costa_Rica')::int as dow,
    extract(hour from fecha_registra at time zone 'America/Costa_Rica') + extract(minute from fecha_registra at time zone 'America/Costa_Rica') / 60.0 as hora,
    case
      when fecha_registra < timestamptz '2025-01-01 00:00:00-06' then null
      when fecha_registra < timestamptz '2025-09-01 00:00:00-06' then '0 ene-ago 2025'
      when fecha_registra < timestamptz '2025-12-01 00:00:00-06' then 'A sep-nov 2025 (menu noche)'
      when fecha_registra < timestamptz '2026-03-01 00:00:00-06' then 'B dic 2025-feb 2026'
      when fecha_registra < timestamptz '2026-09-01 00:00:00-06' then 'C mar-ago 2026'
      when fecha_registra < timestamptz '2026-11-01 00:00:00-06' then 'D sep-oct 2026'
    end as periodo
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and con_servicio and turno in ('mañana','noche')
),
f as (
  select ticket_id,
    sum(monto) filter (where familia is null or familia not in (6,17,20)) as neta,
    coalesce(sum(cantidad) filter (where codigo_producto = '856'), 0) as lc,
    coalesce(sum(cantidad) filter (where codigo_producto = '857'), 0) as inv,
    bool_or(familia = 29 and nombre not ilike '%extra%'
            and not (nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md,
    sum(case when familia = 29 and nombre ilike '%bento%' then cantidad / 4.0
             when familia in (3,13,16) then cantidad
             when familia = 29 and nombre not ilike '%extra%'
                  and not (nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%'])) then cantidad
             else 0 end) as platos,
    coalesce(sum(cantidad) filter (where familia = 2), 0) as entradas,
    coalesce(sum(cantidad) filter (where familia = 4), 0) as postres,
    coalesce(sum(cantidad) filter (where familia = 5
             or (familia = 29 and nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))), 0) as bebidas
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t where periodo is not null)
  group by ticket_id
),
x as (
  select t.*, coalesce(f.neta, 0) as neta, coalesce(f.lc, 0) as lc, coalesce(f.inv, 0) as inv,
         coalesce(f.con_md, false) as con_md, coalesce(f.platos, 0) as platos,
         coalesce(f.entradas, 0) as entradas, coalesce(f.postres, 0) as postres, coalesce(f.bebidas, 0) as bebidas,
         case when coalesce(f.lc, 0) > 0 then 'local_club' else 'normal' end as segmento
  from t left join f on f.ticket_id = t.id
  where t.periodo is not null
)
select periodo, turno, segmento, con_md,
  count(*)                                                        as mesas,
  sum(pax)                                                        as pax,
  sum(lc)                                                         as personas_lc,
  sum(inv)                                                        as invitados,
  round(avg(pax) filter (where pax > 0), 2)                       as pax_por_mesa,
  round(sum(neta) / count(*))                                     as ticket_medio,
  round(sum(neta) filter (where pax > 0) / nullif(sum(pax) filter (where pax > 0), 0)) as prom_pax,
  round(sum(platos)   filter (where pax > 0) / nullif(sum(pax) filter (where pax > 0), 0), 2) as platos_pax,
  round(sum(entradas) filter (where pax > 0) / nullif(sum(pax) filter (where pax > 0), 0), 2) as entradas_pax,
  round(sum(postres)  filter (where pax > 0) / nullif(sum(pax) filter (where pax > 0), 0), 2) as postres_pax,
  round(sum(bebidas)  filter (where pax > 0) / nullif(sum(pax) filter (where pax > 0), 0), 2) as bebidas_pax,
  round(avg(hora), 2)                                             as hora_media,
  round(100.0 * count(*) filter (where dow in (1,2,3)) / count(*), 1) as pct_lun_mie,
  round(100.0 * count(*) filter (where dow in (5,6)) / count(*), 1)   as pct_vie_sab
from x
group by 1, 2, 3, 4
order by 2, 1, 3, 4
limit 500;
```

## Q20 — Mezcla de productos Local Club vs normal (costo por persona y descuento implícito por producto)
```sql
with t as (
  select id, turno, pax,
    case
      when fecha_registra < timestamptz '2025-01-01 00:00:00-06' then null
      when fecha_registra < timestamptz '2025-09-01 00:00:00-06' then '0 ene-ago 2025'
      when fecha_registra < timestamptz '2025-12-01 00:00:00-06' then 'A sep-nov 2025 (menu noche)'
      when fecha_registra < timestamptz '2026-03-01 00:00:00-06' then 'B dic 2025-feb 2026'
      when fecha_registra < timestamptz '2026-09-01 00:00:00-06' then 'C mar-ago 2026'
      when fecha_registra < timestamptz '2026-11-01 00:00:00-06' then 'D sep-oct 2026'
    end as periodo
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and con_servicio and turno = 'noche'
),
f as (
  select ticket_id,
    bool_or(codigo_producto = '856') as es_lc,
    bool_or(familia = 29 and nombre not ilike '%extra%'
            and not (nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t where periodo is not null)
  group by ticket_id
),
tt as (
  select t.id, t.pax, t.periodo, coalesce(f.es_lc, false) as es_lc, coalesce(f.con_md, false) as con_md
  from t left join f on f.ticket_id = t.id
  where t.periodo is not null
)
select periodo, es_lc, con_md, '__MESAS__' as nombre, null::int as familia,
       count(*)::numeric as cantidad, coalesce(sum(pax), 0)::numeric as neta
from tt group by 1, 2, 3
union all
select tt.periodo, tt.es_lc, tt.con_md, l.nombre, l.familia,
       sum(l.cantidad)::numeric, round(sum(l.monto))::numeric
from tt join public.pos_ndf_ticket_lines l on l.ticket_id = tt.id
where l.familia is null or l.familia not in (6,17,19,20)
group by 1, 2, 3, 4, 5
order by 1, 2, 3, 5, 4
limit 20000;
```
> En `__MESAS__`, `cantidad` = mesas y `neta` = pax cargado. El descuento implícito sale de comparar la neta por unidad del mismo producto en mesas LC contra mesas normales.

## Resultados (03/11)
- **D1 – D3:** `FAC_Pedidos` trae datos que hoy no se ingestan.
  - **Columnas útiles:** `NombreCliente` (texto libre: «LOCAL CLUB», «DUEÑOS:…», «COMIDA PERSONAL», «ERRORES», empresas), `Descuento`, `TipoDescuento`, `MontoDescuento`, `Personas` (algunos saloneros lo cargan), `NumeroMesa`, `IDCliente` y `CodigoCliente`.
  - **No se ingestan:** teléfono y dirección (son datos personales).
  - **Tablas de clientes:** CT_Clientes, CXC_Clientes y FAC_Clientes.
  - **Frecuencia de visita por persona:** no se puede medir. En la mesa solo se escribe «LOCAL CLUB».
- **Q18, margen de la mañana por mes:**
  - **Por persona en salón:** carta ₡10.500–11.800 y menú ₡5.900–6.500.
  - **Por pedido de delivery:** carta ₡11.400–17.700 y menú ₡5.200–6.300.
  - **Margen de las mesas con menú en salón, por mes:**

    | Período | Margen | Pax |
    |---|---|---|
    | A (jul–nov 2025) | ₡843 mil | 127 |
    | B (dic 2025 – feb 2026) | ₡1,92 M | 296 |
    | C (mar–jul 2026) | ₡691 mil | 117 |
    | D (ago–oct 2026) | ₡565 mil | 91 |

  - **Platos de menú por mes:** 131 / 332 / 137 / 121 (A/B/C/D). Boxes: 62 / 104 / 58 / 49.
- **Q19 y Q20, Local Club de noche:**
  - Paga **13,4 %** menos (descuento implícito, ponderado por producto) y consume lo mismo: 2,96 productos por persona contra 3,02.
  - **Margen por persona:** LC con carta ₡10.365 · normal ₡12.732 · LC con menú (sep–nov 2025) ₡8.926.
  - **Mesas LC con menú:** 57 % de lunes a miércoles, contra 41 % en carta.
  - **Costo del descuento:** ~₡480 mil por mes de venta.
- **Reporte resumido:** Doc «Mediodía, menú y Local Club — reporte resumido».
