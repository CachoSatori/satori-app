# DIAGNÓSTICO — mesas abiertas fantasma en "En vivo" (bug del bridge, P1)

2026-09-09. Asesor: Claude. Verificado contra el PoS (DBeaver, base `ndf`) y el repo
(`origin/staging`). No es pase C. No es plata. Es la definición de "mesa abierta" del bridge.

## Síntoma

Staging (`satori-staging.pages.dev`, pase C) mostró 3 "mesas abiertas" con el local cerrado
(mesas 20/17/19, salonero 028/FRANCISCO, "abierta hace 12 h"). Ismael confirmó: PoS cerrado,
cierre del día anterior cuadrado al 100%, cero mesas abiertas reales.

## Causa raíz (CONFIRMADA)

El bridge define mesa abierta como `FAC_Pedidos.NumeroFactura IS NULL`
(`pos-bridge/consultaAgente.ts`, `sqlAbiertas`). Está mal para este PoS. Este PoS no reescribe
`NumeroFactura` en el pedido cuando factura: la factura queda en `FAC_Facturas` (por eso el día
cuadra), pero el back-link al pedido no se escribe. Resultado: `NumeroFactura IS NULL` agarra
pedidos facturados y anulados por igual.

La señal real de abierto/cerrado es `FAC_Pedidos.Estado`.

## Evidencia (DBeaver, 2026-09-09)

- Los 3 pedidos: 22 → Estado `X` (anulada), 23 → Estado `F` (facturada, UltimaAccion 21:40),
  24 → Estado `X` + `PedidoTrasladado=21` (movida y anulada). Ninguno abierto. Sin factura por el
  enlace inverso (`FAC_Facturas.NumeroPedido`), que en este esquema viene vacío en mesa.
- `SELECT ... WHERE NumeroFactura IS NULL` → 1.780 pedidos, desde ene-2026 y atrás.
- Distribución de `Estado` en TODO `FAC_Pedidos`: solo tres valores — `F`=23.070 (facturada),
  `X`=1.101 (anulada), `R`=30 (rara). No existe un código de "abierto" en la base con el local
  cerrado.

Nota: el conteo de pedidos back-link-NULL (1.780 por conteo directo / 1.778 por desglose de
Estado) es un número VIVO que drifta entre queries corridas con minutos de diferencia; ninguno es
canónico y el fix no depende de él.

## Lo que FALTA para el fix exacto

No hay ningún pedido abierto ahora (todos resolvieron a F/X/R), así que la base no revela el
código del Estado ACTIVO. Hay que capturarlo en servicio, con al menos una mesa realmente abierta:

```sql
SELECT NumeroPedido, NumeroMesa, Estado, NumeroFactura, UltimaAccion, FechaRegistra
FROM dbo.FAC_Pedidos
WHERE NumeroFactura IS NULL
  AND FechaRegistra >= CAST(GETDATE() AS date)
ORDER BY FechaRegistra DESC;
```

→ El `Estado` de las mesas que el personal confirma abiertas = el código activo.

⚠️ NO usar el blacklist `Estado NOT IN ('F','X','R')` a ciegas: si una mesa abierta ya figura `F`
durante el servicio, ese filtro escondería mesas abiertas reales (peor que el bug actual). Por eso
se captura el código activo y se hace whitelist.

## El fix (bridge, P1) — pendiente del código activo

`sqlAbiertas` filtra por `Estado = '<activo>'` en vez de (o además de) `NumeroFactura IS NULL`.
Cambio de una línea + test. Bonus: apenas se corrija, los fantasma se limpian solos (al cerrarse el
pedido pasa a F/X → sale del snapshot → la Edge lo borra en el próximo poll).

Borrador de prompt para CC (completar `<ACTIVO>`):

```
TAREA — fix del bridge: sqlAbiertas debe filtrar por Estado, no por NumeroFactura IS NULL.
Confirmado: en este PoS FAC_Pedidos.Estado es F(facturada)/X(anulada)/R(rara); "abierta" = Estado='<ACTIVO>'
(capturado en servicio el <FECHA>). NumeroFactura NULL agarra pedidos cerrados (el PoS no escribe el back-link).
- Cambiar sqlAbiertas (pos-bridge/consultaAgente.ts): WHERE p.<numerofactura> IS NULL AND p.Estado = '<ACTIVO>'
  (mantené el acote por fecha). Resolver el nombre real de la columna Estado por esquema.ts si aplica.
- Test: un pedido F y uno X NO entran; uno '<ACTIVO>' sí.
- Guardrails: solo el snapshot de abiertas (En vivo). NO tocar sqlCerradas/ventas/plata. Rama nueva, nada a main.
```

## Alcance / blast radius

Solo "En vivo" (mesas abiertas, de `FAC_Pedidos`). La venta/plata sale de `FAC_Facturas` por
`sqlCerradas` (filtra su propio Estado C/X/R) y cuadró perfecto. No es bug de plata.

## Interino

Borrar las 3 fantasma para destrabar staging (parche; reaparecen hasta el fix):

```sql
delete from pos_ndf_open where local='santa-teresa' and clave in ('pedido:22','pedido:23','pedido:24');
```

## Relación con pase C

- Pase C (fusión Hoy+En vivo) solo muestra lo que el bridge le da; no es el bug. Pero no va a
  `main` hasta cerrar este P1.
- Hardening de display de pase C (P2) — defensa en profundidad, en paralelo:
  - Guard de mesas viejas: una mesa "abierta hace >Nh" o de jornada pasada sale MARCADA
    ("revisar"), no como actividad viva normal. (Esto es lo que habría delatado este bug en
    pantalla.)
  - Frescura mirando `last_error` de `pos_ndf_cursor`, no solo `last_poll_at`. (Hygiene; no habría
    cachado ESTE bug porque el agente no erroraba, pero cubre el caso PoS-apagado.)

## Prioridades

1. P1 — fix del bridge (definición de abierto). Pendiente: 1 captura en servicio.
2. P2 — hardening de display de pase C (guard de mesas viejas + frescura con `last_error`). En
   paralelo.
3. Pase C a `main`: bloqueado hasta P1.
4. Encolados aparte: delta ₡4.867 (Salón sin mesero), limpieza de `product_map.tipo` /
   mapCategoria.
