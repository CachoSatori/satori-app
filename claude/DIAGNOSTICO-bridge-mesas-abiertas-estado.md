# DIAGNÓSTICO — mesas abiertas fantasma en "En vivo" (bug del bridge, P1)

> 2026-09-09. Asesor: Claude. Verificado contra el PoS (DBeaver, base `ndf`) y el repo (origin/staging).
> Refinado con la revisión de CC (5 puntos, ver abajo). **No es pase C. No es plata. Es la definición de
> "mesa abierta" del bridge.**

## Síntoma
Staging (`satori-staging.pages.dev`, pase C) mostró **3 "mesas abiertas" con el local cerrado**
(mesas 20/17/19, salonero 028/FRANCISCO, "abierta hace 12 h"). Ismael confirmó: PoS cerrado, cierre
del día anterior cuadrado al 100%, cero mesas abiertas reales.

## Causa raíz (CONFIRMADA en código)
El bridge define mesa abierta como `FAC_Pedidos.NumeroFactura IS NULL` (`pos-bridge/consultaAgente.ts:126`,
`sqlAbiertas`), **sin ninguna condición de estado**. Las CERRADAS sí usan whitelist (`Estado='C'` en
`FAC_Facturas`). La señal real de abierto/cerrado es **`FAC_Pedidos.Estado`**.

### Encuadre correcto (corrige la v1 de este doc)
La v1 decía "este PoS no escribe el back-link". **Falso como generalización.** El back-link se escribe
el **93%** de las veces:

| Medida | Filas |
|---|---|
| FAC_Pedidos total (F+X+R) | 24.201 |
| NumeroFactura IS NULL | 1.780 |
| Con back-link escrito | 22.421 (93%) |

El fantasma es la **minoría** que nunca recibe el back-link: de los 1.780 con NumeroFactura NULL →
**1.101 `X` (anuladas, correctamente sin factura), 647 `F` (facturadas pero sin back-link — la anomalía),
30 `R`**. El bridge los toma a todos por "abiertos" cuando caen en la ventana de fecha. La conclusión no
cambia (whitelist por Estado), pero el encuadre importa para el resto.

## Evidencia (DBeaver, 2026-09-09)
- Los 3 pedidos: **22 → `X`**, **23 → `F`** (UltimaAccion 21:40), **24 → `X`** + `PedidoTrasladado=21`.
  Ninguno abierto. Sin factura por el enlace inverso (`FAC_Facturas.NumeroPedido`, vacío en mesa).
- `WHERE NumeroFactura IS NULL` → 1.780 pedidos, desde ene-2026 y atrás.
- `Estado` en TODO `FAC_Pedidos`: solo **`F`=23.070, `X`=1.101, `R`=30**. No hay código de "abierto"
  con el local cerrado (todos resolvieron a terminal).
- Nota: el conteo back-link-NULL (1.780 por conteo directo / 1.778 por desglose de Estado) es un número
  VIVO que drifta entre queries corridas con minutos de diferencia; ninguno es canónico y el fix no depende de él.

## El fix (bridge, P1) — NO es de una línea (corrige la v1)
`sqlAbiertas` debe filtrar por `Estado = '<activo>'` (whitelist), no por `NumeroFactura IS NULL`. Pero:

- **La tabla `pedidos` NO tiene `estado` en el catálogo de `esquema.ts`** (solo `facturas` lo tiene). Hay
  que **agregar la definición** de la columna al `CATALOGO.pedidos`.
- Declararla **opcional**, y que **`puedeLeerAbiertas` devuelva `false` cuando no esté** — igual que ya
  hace con `numeropedido`. ⚠️ Caer de vuelta a solo `NumeroFactura IS NULL` restauraría el bug en
  silencio: **fail-closed** (no mandar snapshot), nunca fail-open.
- Test: un pedido `F` y uno `X` NO entran; uno `'<activo>'` sí.
- Bonus: apenas se corrija, los fantasma se limpian solos (al cerrarse → F/X → sale del snapshot → la
  Edge lo borra en el próximo poll).

## Lo que FALTA: el código del Estado ACTIVO (protocolo de captura refinado)
No hay pedidos abiertos ahora, así que la base no revela el código activo. **Una sola foto en servicio
puede engañar** (no distingue el código activo de uno que ya mutó). Protocolo correcto:
1. En servicio, con mesas que el personal confirma abiertas, registrar **NumeroPedido + Estado**:
   ```sql
   SELECT NumeroPedido, NumeroMesa, Estado, NumeroFactura, UltimaAccion, FechaRegistra
   FROM dbo.FAC_Pedidos
   WHERE NumeroFactura IS NULL AND FechaRegistra >= CAST(GETDATE() AS date)
   ORDER BY FechaRegistra DESC;
   ```
2. Tras el cierre, releer **esos mismos NumeroPedido**. El código que aparece **solo mientras estaba
   abierta** (y mutó a F/X al cerrar) es el `'<activo>'`.

⚠️ NO usar blacklist `Estado NOT IN ('F','X','R')` a ciegas (escondería mesas abiertas reales si durante
el servicio ya figuran `F`).

## Alcance / blast radius
Solo "En vivo" (mesas abiertas, de `FAC_Pedidos`). La venta/plata sale de `FAC_Facturas` por `sqlCerradas`
(whitelist `Estado='C'`) y **cuadró perfecto**. **No es bug de plata.**

## Impacto en pase C (hallazgo de CC — sube P2)
`excluirCerradas` (la exclusión del pase C) **NO es red independiente**: su set de llaves sale de
`getPedidosCerradosJornada`, que lee `numero_pedido` de `pos_ndf_tickets`, y ese `numero_pedido` viene del
**mismo back-link** (join por `NumeroFactura`). Cuando el back-link es NULL, el ticket cerrado queda sin
`numero_pedido`, el set nunca lo contiene, y la exclusión **falla exactamente sobre el conjunto fantasma**.
→ El **guard de mesas viejas (P2) es la ÚNICA defensa de display** que puede atajar esto.

## El delta ₡4.867 puede ser el MISMO bug (hallazgo de CC — cruzar antes de tratarlo aparte)
El salonero/mesa/pax/canal de los tickets cerrados salen de esa misma subconsulta por back-link. Una
factura cuyo pedido tiene `NumeroFactura` NULL **pierde su `usuario_registra` → cae en "Salón sin mesero"**.
El delta de #8 puede ser justo esas facturas. **Cruzar:** ¿el ₡4.867 corresponde a facturas cuyos pedidos
tienen `NumeroFactura` NULL? Si sí, delta y fantasma comparten raíz. (Ver `SPEC-atribucion-salon-por-linea.md`.)

## Interino
Borrar las 3 fantasma para destrabar staging (parche; reaparecen hasta el fix):
```sql
delete from pos_ndf_open where local='santa-teresa' and clave in ('pedido:22','pedido:23','pedido:24');
```

## Prioridades
1. **P1 — fix del bridge** (whitelist por Estado en `sqlAbiertas` + Estado al `CATALOGO.pedidos` opcional +
   fail-closed). Pendiente: captura del código activo en servicio (protocolo de 2 pasos).
2. **P2 — hardening de display de pase C** (guard de mesas viejas = única defensa que ataja esto +
   frescura con `last_error`). YA en staging (`ffe88e8`); pendiente validación física.
3. Pase C a `main`: bloqueado hasta P1.
4. **Delta ₡4.867**: cruzar contra el conjunto back-link-NULL antes de tratarlo aparte (puede colapsar).
5. Limpieza de `product_map.tipo` / mapCategoria: encolado.
