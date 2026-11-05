# SQL — Análisis de mediodía, Ronda 5: Local Club, caja y delivery · 2026-11-03

> Continúa `claude/SQL-analisis-mediodia.md` (Q0–Q10). Mismas reglas: solo SELECT en Supabase PROD, `limit` explícito siempre.

## Q11 — Artículos de la familia 19 (PAX y marcadores)
```sql
select l.codigo_producto, max(l.nombre) as nombre,
       sum(l.cantidad) as uds,
       sum(l.cantidad) filter (where t.turno = 'mañana') as uds_manana,
       min((t.fecha_registra at time zone 'America/Costa_Rica')::date) as primera,
       max((t.fecha_registra at time zone 'America/Costa_Rica')::date) as ultima
from public.pos_ndf_ticket_lines l
join public.pos_ndf_tickets t on t.id = l.ticket_id
where t.local = 'santa-teresa' and t.estado = 'C' and l.familia = 19
group by l.codigo_producto
order by uds desc
limit 200;
```
**Resultado:**

| Código | Artículo | Unidades | Desde |
|---|---|---|---|
| 677 | PAX | 60.067 | — |
| 856 | LOCAL CLUB | 2.663 | ago-2024 |
| 1075 | BOXING | 1.834 | dic-2025 (594 de mañana) |
| 857 | INVITADO | 1.618 | ago-2024 |
| 936 | PRUEBA | 3 | — |

- **LOCAL CLUB e INVITADO:** cada unidad es una persona recurrente.
- **BOXING** (confirmado por Ismael, 03/11): cargo por caja de delivery para cubrir los empaques biodegradables. Es venta real (netaVenta lo cuenta). Antes servía para contar los pedidos de delivery.

## Q12 — Local Club e Invitado por mes, turno y tipo de mesa
```sql
with t as (
  select id, turno, pax,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and canal = 'salon' and turno in ('mañana','noche')
    and fecha_registra >= timestamptz '2025-01-01 00:00:00-06'
),
f as (
  select ticket_id,
    bool_or(familia = 29 and nombre not ilike '%extra%'
            and not (nombre ilike any (array['%green%','%soda%','%lemonade%','%smoothie%']))) as con_md,
    coalesce(sum(cantidad) filter (where familia = 19 and nombre ilike any (array['%local%','%club%'])), 0) as uds_local,
    coalesce(sum(cantidad) filter (where familia = 19 and nombre ilike '%invitado%'), 0) as uds_invitado
  from public.pos_ndf_ticket_lines
  where ticket_id in (select id from t)
  group by ticket_id
)
select t.mes, t.turno, coalesce(f.con_md, false) as con_md,
  count(*) as tickets, sum(t.pax) as pax,
  count(*) filter (where f.uds_local > 0) as mesas_con_local, sum(f.uds_local) as personas_local,
  count(*) filter (where f.uds_invitado > 0) as mesas_con_invitado, sum(f.uds_invitado) as personas_invitado
from t left join f on f.ticket_id = t.id
group by 1, 2, 3
order by 2, 1, 3
limit 500;
```
**Resultado:**
- **Mañana:** Local Club casi no se carga (1–10 personas por mes, en carta y en menú). Ahí no sirve para medir locales.
- **Noche:** Local Club en ~10 % de los pax (60–186 por mes).
- **Noche con menú** (sep–nov 2025, cuando también se vendía de noche): 23 de 55, 36 de 96 y 12 de 53 pax eran Local Club, o sea **23–42 %**. Contra ~10 % en las mesas de carta, el menú atrae locales.

## Q13 — Mañana por canal, caja/salonero y 10 %
```sql
with t as (
  select id, canal, registrado_por, con_servicio, pax, salonero_login,
         date_trunc('month', fecha_registra at time zone 'America/Costa_Rica')::date as mes
  from public.pos_ndf_tickets
  where local = 'santa-teresa' and estado = 'C' and turno = 'mañana'
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
select t.mes, t.canal,
  case when t.salonero_login is null then 'caja / sin salonero' else 'con salonero' end as quien,
  t.con_servicio, count(*) as tickets,
  round(100.0 * count(*) filter (where f.con_md) / count(*), 1) as pct_con_md,
  sum(t.pax) as pax, round(sum(f.neta)) as neta
from t left join f on f.ticket_id = t.id
group by 1, 2, 3, 4
order by 1, 2, 3, 4
limit 1000;
```
**Resultado:**
- **«Caja» en salón:** son mesas **con 10 %** (servidas) que cargó el cajero. No son mostrador.
  - Con menú: 50–80 % de las mesas.
  - Salón sin 10 %: casi nada.
- **Delivery de la mañana:** 30–63 pedidos por mes, ₡0,4–0,8 M de neta. Con menú:

| Período | % de pedidos con menú |
|---|---|
| sep-2025 a feb-2026 | 36–57 % |
| desde el 20-feb (mar–oct 2026) | 35–58 % |

  No bajó con el «solo a pedido». Como el menú no se ofrece por WhatsApp, es la demanda de quienes ya lo conocen: estable.
- **Para llevar:** aparece en nov-2025 – abr-2026 (hasta 49 por mes), con 33–67 % de menú.
- **Salón con salonero, % con menú:**

| Período | % con menú |
|---|---|
| sep-2025 a feb-2026 (ofrecido) | 56–71 % |
| mar–oct 2026 (a pedido) | 23–52 % |

  Lo que cayó con el «solo a pedido» es la demanda que venía de ofrecerlo.

## Implicancias
- **Dos demandas distintas:**
  - **Recurrentes** (delivery, locales): estable. No necesita que se ofrezca, y es la que conviene cuidar con precio y combo.
  - **La de sala** cuando se ofrece: grande, pero en alta sobre todo reemplaza platos de carta.
- **Dato que falta:** que el salonero cargue LOCAL CLUB (856) al mediodía aunque no haya descuento. Con eso, la próxima medición separa locales y turistas sin estimar.

## Hallazgo noche y Local Club (de Q12)
| Noche | LC en carta | LC con menú | LC total | Pax de noche | % LC |
|---|---|---|---|---|---|
| jul–ago 2025 | 165 | — | 165 | 2.445 | 6,7 % |
| sep–nov 2025 (menú también de noche) | 282 | 71 | 353 | 2.741 | 12,9 % |
| sep–oct 2026 | 116 | — | 116 | 1.486 | 7,8 % |

- **sep–oct:** 215 LC en 2025 contra 116 en 2026, con el mismo total de pax de noche.
- **No hubo canibalización:** los LC que pedían carta no bajaron.
- **Pendiente:** cuánto gasta por persona una mesa Local Club (Q14).

## Q14 — Mesas Local Club: gasto por persona, por turno y tipo de mesa (desde ago-2024)
```sql
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
```

## Q15 — Delivery y para llevar por mes: pedidos, BOXING y ticket medio (desde 2024)
> BOXING (1075) es el cargo por caja de delivery: cubre los empaques biodegradables. Se usó para contar pedidos.
> Ahora se cuentan directo con las facturas cerradas de canal delivery/llevar (Pedidos.Tipo). `con_servicio = false` sirve como control cruzado.
```sql
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
```

## Q14 — Resultado (noche)
| Noche | Pax en mesas LC (carta / menú) | Venta neta mesas LC | ₡/pax carta / menú |
|---|---|---|---|
| sep–oct 2025 (menú también de noche) | 235 / 78 | ₡4,88 M | 16.215 / 13.736 |
| sep–oct 2026 | 215 / — | ₡3,27 M | 15.215 / — |

Unos +₡800 mil por mes de venta en mesas Local Club. Las mesas LC de carta gastan ~10 % menos que el promedio de la noche (descuento).

## Q16 — Cuentas divididas: mesas Local Club cuyo artículo LC/INVITADO no se repitió en las otras facturas
> Grupo = misma fecha, turno, mesa y salonero, con facturas a ≤ 15 min entre sí. La mesa vacía no se agrupa.
> (`numero_pedido` no sirve: la Q8 mostró 0 pedidos con más de una factura.)
```sql
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
```

## Q17 — Cómo se nombran las mesas (sep–oct 2026)
```sql
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
```

## Resultados Q15–Q17 (03/11)
- **Q15 Delivery + para llevar (mar–oct):**

| Año | Pedidos mañana | Neta mañana | Pedidos noche | Neta noche |
|---|---|---|---|---|
| 2024 | 341 | ₡5,22 M | 1.389 | ₡26,6 M |
| 2025 | 363 | ₡5,54 M | 991 | ₡20,0 M |
| 2026 | 439 | ₡5,56 M | 930 | ₡17,9 M |

  - **Mañana 2026:** +21 % de pedidos con la misma plata (el menú baja el ticket).
  - **Noche:** −33 % desde 2024.
  - **Desde dic-2025, BOXING** está en el 84 % de los pedidos: falta en el 16 %.
  - **El canal cambió de nombre:** jun–ago 2024 viene como «otro» y no como «delivery». Para contar pedidos se suman delivery, llevar y otro.
  - **Salón sin 10 %:** son facturas de ₡0 o muy chicas (personal o cortesías). No es delivery.
- **Q16 Cuentas divididas con LC sin marcar:** 0 a 7 facturas y 0 a 13 pax por mes. Es una corrección menor.
- **Q17 Mesas:** el campo `mesa` es solo un número (1–20, 51–53) o vacío. Hay 82 facturas de noche y 24 de mañana sin mesa en sep–oct 2026. El nombre que los saloneros le ponen a la mesa **no llega a la ingesta**. Si se quiere, hay que ver en qué campo del PoS se guarda (¿Pedidos.Nombre?) y sumarlo al bridge.
