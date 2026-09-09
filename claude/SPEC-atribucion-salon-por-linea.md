# SPEC — Atribución de venta de salón POR LÍNEA (fin de "Salón sin mesero" como agujero)

> Paso 0 firmado con datos reales (Nube `FAC_Facturas`/`FAC_Pedidos`/`FAC_FacturasDet` + staging
> `pos_ndf_tickets`/`pos_ndf_ticket_lines`). Trabajo original: Ismael + Grok. Verificación y refinamiento:
> Claude (asesor), 2026-09-09, contra queries 80/81 y el detalle de FacturasDet. **No build.** Solo
> reasigna DISPLAY del breakdown; NO recalcula neta/total del día.

## El hallazgo
"Salón sin mesero" no es un agujero de dato: es un **mapper que atribuye por el PEDIDO (header) y no por
la LÍNEA**. La línea ya trae quién comandó: `pos_ndf_ticket_lines.usuario_registra` = `FAC_FacturasDet.UsuarioRegistra`,
y **ya está ingestada**. El ticket / Cajeros / el balde miran el pedido; cuando el pedido no joinea, el
salonero se pierde aunque la línea lo diga.

## Causa raíz UNIFICADA (aporte del asesor — Grok lo trató como hilo aparte)
El motivo de que el pedido "no joinee" es el mismo que produce las **mesas fantasma en "En vivo"**: el
back-link `FAC_Pedidos.NumeroFactura` viene **NULL** en una minoría de pedidos (647 `F` + 1.101 `X` + 30 `R`,
ver `DIAGNOSTICO-bridge-mesas-abiertas-estado.md`). Esa misma nulidad:
- en **abiertas** → el pedido cerrado se ve como abierto (bug del bridge, P1);
- en **cerradas** → la factura no joinea al pedido → `registrado_por='sin_pedido'`, `salonero_login=null`
  → cae en "Salón sin mesero";
- y **probablemente el delta ₡4.867 de #8** sea exactamente estas facturas.

**Consecuencia de diseño:** la salida robusta en los tres casos es **no depender del join por back-link**.
Para atribución, la línea (`FAC_FacturasDet.UsuarioRegistra`) es inmune al back-link roto — siempre está.

## Evidencia — corte 2026-09-01 07:00 → 2026-09-09 07:00 CR (local santa-teresa, estado C, canal salón)
Balde "Salón sin mesero" = **₡300.120 en 17 tickets** (verificado contra query 80):
`cajero 111 = ₡52.567 (5)` · `cajero 222 = ₡101.284 (4)` · `sin_pedido 222 = ₡146.269 (8)`.

Al abrir por línea (query 81 + FacturasDet), el balde es heterogéneo:

| Destino | Qué es | ₡ | % | Recuperable |
|---|---|---|---|---|
| **A — todo salonero, huérfano** | Todas las líneas de un mesero real; el pedido no joineó | 133.614 | 44% | Sí, ya (por línea) |
| **B — mixto** | Caja metió ítems a la mesa de un mesero | 91.647 | 31% | Sí, por línea (split ₡ pendiente de sumar montos) |
| **C — caja-salón pura** | Login 111/222 comandó TODAS las líneas | 62.204 | 21% | No es de mesero |
| **D — regalía** | Cortesía/dueños/neta 0 | 12.655 | 4% | Bucket propio |

- **A** se reparte: **028 FRANCISCO ₡78.835 (5 tickets)** · **032 GONZA ₡54.779 (2)**. (Ej. factura 110756:
  códigos 25/25/677/59/1072, las 5 líneas `UsuarioRegistra=028`.)
- **B**: 110809 (14 líneas 032 / 3 líneas 222) · 110768 (1 línea 026 / 6 líneas 222). El split en ₡ hay que
  sumarlo de los montos de línea (query 81 solo da el conteo de líneas).
- **C**: 111 → 110760/110761/110802/110800/110923 = ₡52.567 · 222 → 110918/110793 = ₡9.637.
- **D**: 110944 (cortesía, 028) = ₡12.655.

**Titular:** ~**75% del balde** (A+B) es atribuible a personas reales vía la línea. Solo ~21% (C) es caja
de verdad.

## Regla a firmar (diseño, no build)
Unidad de atribución = **la línea** (`usuario_registra`), no el ticket:
1. Login de salonero (no 111/222/388/002/01/02) → plata de ese salonero.
2. Login 111/222/388 + canal salón + cobrada → **Cajero-salón** (tarjeta propia, fuera de delivery/llevar
   y fuera del ranking de meseros).
3. Cortesía / dueños / neta 0 → **regalía** (se ve; no infla venta de caja ni de mesero).
- **Ticket mixto (B): cada línea a su dueño.** NO `MIN(UsuarioRegistra)` del pedido (lo que hace hoy el
  extractor cuando hay varios pedidos).

## Rigor de reconciliación (aporte del asesor)
- La neta por salonero debe sumar **solo líneas de `FAMILIAS_VALOR_SERVIDO`** (la whitelist del día) y
  **atarse al header** del ticket (`valor_servido_crc`); exponer `descuadreCrc` como en la Parte B. Si se
  suman líneas crudas, el breakdown driftea de la neta del día.
- Pax (677/678), cortesías y demás no-valor-servido NO entran en la neta del salonero (sí como contexto).

## La decisión CENTRAL: doble conteo (Grok lo flaggeó; el asesor lo eleva a bloqueante)
`saloneros-por-línea` (lente en `saloneroLentes.ts`) **ya** ve `usuario_registra` por línea. Si además el
balde reasigna a 028/032, se **cuenta dos veces**. Antes de codear hay que fijar **fuente única de verdad**:
¿la lente por línea ES el breakdown de salón, y el balde "Salón sin mesero" desaparece/queda solo con C+D?
Definir cómo queda la pantalla para no sumar lente + balde.

## Decisiones a firmar (Ismael)
1. **Fuente única:** ¿la atribución de salón vive en la lente por línea y el balde queda solo Cajero-salón
   (C) + Regalía (D)? (recomendación del asesor: sí.)
2. **Regla del mixto:** ítems que un cajero (111/222) timbra en la mesa de un mesero → ¿a caja (quien
   timbró, como propone Grok) o al mesero dueño de la mesa? (recomendación: a quien timbró — el dato lo
   dice; lo demás es adivinar.)
3. **Cajero-salón (C):** confirmar que es una tarjeta propia visible, no "delivery" ni ranking de meseros.

## Alcance / fuera de alcance / guardrails
- **Es:** reasignar el DISPLAY del breakdown de salón usando la línea. Toca `armarDia`/`claveNoMesero`/lente
  por línea/Cajeros (display).
- **No es:** el delta ₡4.867 (otro hilo, aunque probablemente misma raíz); E2 Mix, ICP, En vivo; adivinar
  mesero por número de mesa (no hace falta, la línea lo dice); tocar `esCajero`, IVA, `total_crc`, neta/total
  del día, sagrados, caja, propinas.
- **Mesa en el detalle del balde:** para mostrar la mesa cuando no hay pedido hace falta ingest de
  `FAC_Facturas.NumeroMesa` (esquema/bridge + firma). NO bloquea la atribución por línea (quién comandó ya está).

## Blast radius a medir antes de codear
`armarDia`, `claveNoMesero`, la lente por línea (`saloneroLentes.ts`), Cajeros. Cross-check: neta y total
del día IDÉNTICOS antes/después (mismo candado byte-a-byte).

## Relación con otros hilos
- **Ghost-mesas (P1 bridge)** y **este** comparten raíz (back-link NULL). El fix del bridge no arregla esto
  (la atribución por línea sí); son complementarios.
- **`SPEC-saloneros-por-linea.md`**: esta atribución ES la extensión natural de ese spec — unificar, no duplicar.
- **Delta ₡4.867**: confirmar si son estas mismas facturas back-link-NULL (una query lo cierra).

## Estado
Paso 0 firmado con datos. **Pendiente:** (1) las 3 decisiones de Ismael; (2) sumar el split ₡ de B; (3) SPEC
firme → recién ahí prompt de CC. No se codea nada antes del SPEC firmado.
