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

### Encuadre correcto
El back-link `FAC_Pedidos.NumeroFactura` se escribe en la gran mayoría de los pedidos: de ~24.200,
solo 1.780 lo tienen en NULL (≈7%). No es que el PoS "no reescriba el back-link" — es que una
MINORÍA no lo recibe, y esa minoría es el fantasma: 647 `F` (facturadas, back-link ausente = la
anomalía) + 1.101 `X` (anuladas, correctamente sin factura) + 30 `R`. La conclusión no cambia
(whitelist por `Estado`), pero el encuadre sí. (Nota: 1.780 por conteo directo / 1.778 por desglose
de Estado = número vivo que drifta entre queries; ninguno es canónico y el fix no depende de él.)

## Evidencia (DBeaver, 2026-09-09)
- Los 3 pedidos: **22 → `X`**, **23 → `F`** (UltimaAccion 21:40), **24 → `X`** + `PedidoTrasladado=21`.
  Ninguno abierto. Sin factura por el enlace inverso (`FAC_Facturas.NumeroPedido`, vacío en mesa).
- `WHERE NumeroFactura IS NULL` → 1.780 pedidos, desde ene-2026 y atrás.
- Estado en FAC_Pedidos: F=23.070 (facturada), X=1.101 (anulada), R=30 (en curso). CONFIRMADO en
  servicio (2026-09-09): R = ABIERTO. Se capturó la mesa 5 abierta en vivo en Estado R, con dos
  pedidos previos de la misma mesa en X (anulados). F/X son terminales. Los "30 R" no son rareza:
  Estado es el estado ACTUAL (se sobrescribe), así que solo quedan en R los pedidos abiertos o
  atascados en el momento de la query.
- Nota: el conteo back-link-NULL (1.780 por conteo directo / 1.778 por desglose de Estado) es un número
  VIVO que drifta entre queries corridas con minutos de diferencia; ninguno es canónico y el fix no depende de él.

## El fix (bridge, P1) — NO es de una línea (corrige la v1)
`sqlAbiertas` debe filtrar por **`Estado = 'R'`** (whitelist), no por `NumeroFactura IS NULL`. El código
activo ya NO es una incógnita: se capturó en servicio y es `R`. Pero:

- **La tabla `pedidos` NO tiene `estado` en el catálogo de `esquema.ts`** (solo `facturas` lo tiene). Hay
  que **agregar la definición** de la columna al `CATALOGO.pedidos`.
- Declararla **opcional**, y que **`puedeLeerAbiertas` devuelva `false` cuando no esté** — igual que ya
  hace con `numeropedido`. ⚠️ Caer de vuelta a solo `NumeroFactura IS NULL` restauraría el bug en
  silencio: **fail-closed** (no mandar snapshot), nunca fail-open.
- Test: un pedido `F` y uno `X` NO entran; uno `R` sí.
- Bonus: apenas se corrija, los fantasma se limpian solos (al cerrarse → F/X → sale del snapshot → la
  Edge lo borra en el próximo poll).

**Estado: IMPLEMENTADO** en `aef2660` (rama `claude/bridge-abiertas-estado-r`). Los tres cambios
están: `estado` opcional en `CATALOGO.pedidos`, `puedeLeerAbiertas` fail-closed sin la columna, y
`sqlAbiertas` con `AND p.[Estado] = 'R'`. **Pendiente: desplegar el agente** en la PC del PoS
(`deploy/pos-bridge-staging`) — hasta que corra el binario nuevo, los fantasma siguen entrando.

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
