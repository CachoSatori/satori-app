# SPEC — Comandero Profesional (UX del display del salonero)

> Sprint 2026-06-12 (rama `comandero-pro`). Investigación de PoS comerciales (foco Lavu, pedido
> de la dueña) + auditoría sistemática de callejones sin salida de nuestro comandero + backlog.

---

## 1. Patrones de la industria (investigación con fuentes)

### 1.1 Layout de la pantalla de pedidos
- **Toast**: pantalla dividida en dos — detalle del pedido a la IZQUIERDA (mesa, mesero, pax,
  ítems con estado), menú a la DERECHA en jerarquía menú → grupo → ítem, con **búsqueda
  prominente arriba**. Acciones raras en menú overflow (⋮); las frecuentes siempre visibles.
  [Toast — Ordering Screens](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens)
- **Lavu**: el menú del mesero es un **grid de íconos/botones por categoría** configurable:
  ítems por fila, máximo de categorías visibles sin scroll, **esquema de color por categoría e
  ítem**, títulos mostrables/ocultables. Jerarquía Menu Groups → Categories → Items.
  [Lavu — Menu Interface Settings](https://support.lavu.com/en/knowledge/advanced-location-settings-menu-interface-settings) ·
  [Lavu — Basic Menu Building](https://support.lavu.com/en/knowledge/basic-menu-building-in-lavu)
- **Square for Restaurants**: grid de tiles **arrastrable y de tamaño configurable** (el operador
  acomoda lo más vendido a mano); páginas múltiples.
  [Square — community: rearrange tiles](https://community.squareup.com/t5/Square-for-Restaurants/How-do-I-rearrange-the-tiles-on-my-Restaurants-POS-layout/m-p/772547)

### 1.2 Modificadores
- **Lavu**: dos clases — **forced** (obligatorios: bloquean hasta elegir; "info que cocina
  NECESITA") y **optional** (pedidos del cliente, con o sin upcharge). Al tocar un ítem se
  presentan PRIMERO los forzados.
- **Toast**: modificadores al fondo de la pantalla del ítem; los obligatorios bloquean el envío.

### 1.3 Asientos, pax y cursos
- **Toast**: order-by-seat = ítem → botón "Seat" → número; el ticket de cocina imprime asientos.
  Guest count visible en el detalle del pedido. Cursos configurables Required/Optional/Off, con
  **Send / Hold / Stay** (el mesero controla el disparo, no solo reglas server-side).
  [Toast — Order by Seat](https://support.toasttab.com/en/article/Order-by-Seat) ·
  [Toast — Course Firing](https://support.toasttab.com/en/article/Course-Firing-Options)

### 1.4 Corrección de errores (el patrón MÁS importante)
- **TouchBistro** (norma de la industria): **ANTES de enviar a cocina → Delete simple** (sin
  fricción, sin traza); **DESPUÉS de enviar → Void con motivo** (avisa a cocina con ticket de
  anulación); si ya llegó a la mesa → comp/descuento 100%. Swipe sobre el ítem → Void.
  [TouchBistro — Discounts & Voids](https://www.touchbistro.com/help/articles/using-discounts-and-voids-to-correct-errors/) ·
  [TouchBistro — Voiding an Item](https://cdn.touchbistro.com/help/articles/voiding-an-item-2/)
- **Toast**: Hold real (lo retenido NO se dispara al enviar lo demás).

### 1.5 Táctil y velocidad
- **Targets ≥ 48×48 CSS px** con ≥10px de separación (estándar de accesibilidad/Material;
  iOS HIG pide ≥44pt). En rush, targets chicos = rage taps y errores.
  [Smashing — Accessible tap targets](https://www.smashingmagazine.com/2023/04/accessible-tap-target-sizes-rage-taps-clicks/) ·
  [LogRocket — touch target sizes](https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/)
- Teclados numéricos de PoS: SIEMPRE con **⌫ (borrar dígito)** y **C (limpiar)** + valor grande
  visible; las acciones frecuentes a ≤2 taps; feedback visual de cada tap.
  [dev.pro — POS UX tactics](https://dev.pro/insights/designing-a-pos-system-ten-user-experience-tactics-that-improve-usability/)

---

## 2. Mapeo contra nuestro comandero (qué tenemos / qué falta)

| Patrón | Nuestro estado (pre-sprint) |
|---|---|
| Grid de menú por categorías con colores | ❌ Solo búsqueda por texto (≥2 letras) |
| Búsqueda arriba | ✅ |
| Numpad pax con ⌫ y C | ✅ existía (C + ⌫ + dígitos) pero targets chicos y sin tope |
| Pax editable post-apertura | ✅ (✎ en header) pero SIN traza |
| Modificadores forced/optional | ✅ (required bloquea; deltas finales; overrides por producto) |
| Asiento por ítem | ✅ (select limitado a pax) — solo al agregar, no editable después |
| Cursos + marchar por curso | ✅ (bebida/entrada/principal + marchar parcial/total) |
| Delete simple ANTES de marchar | ✅ (×) — target chico |
| Editar ítem no marchado (mods/curso/asiento) | ⚠ solo curso (cicla); mods y asiento NO |
| Void/deshacer DESPUÉS de marchar | ❌ no hay deshacer ni anular |
| Cantidad (qty) | ❌ no hay UI (cada tap = fila qty 1) |
| Total de la mesa siempre visible | ❌ solo dentro del modal 🧾 Cuenta |
| Cancelar mesa abierta por error | ❌ no existe |
| Targets ≥48px / feedback de tap | ⚠ inconsistente (botones de ~30-44px) |
| Estado del ítem visible | ✅ (por marchar / en cocina / listo) |

## 3. Auditoría de callejones sin salida (FASE 2) — con severidad

| # | Pantalla / paso | Callejón | Severidad |
|---|---|---|---|
| C1 | Plano → mesa abierta por error | **No se puede cancelar una mesa abierta** (ni vacía). Queda viva hasta… nunca; bloquea el cierre del último turno. | 🔴 ALTA |
| C2 | Pedido → "Marchar" tocado por error | **No hay deshacer**: el ítem queda 🔥 en cocina; no se puede ni quitar ni revertir. La única "solución" era gritar a cocina. | 🔴 ALTA |
| C3 | Pedido → ítem agregado con modificadores/asiento equivocados | Solo el curso se puede ciclar. **Mods y asiento no se editan**: hay que borrar y re-armar de memoria (si te das cuenta; si no, va mal a cocina). | 🟠 MEDIA |
| C4 | Pax | Numpad ya tenía C/⌫ ✓ pero sin tope (se podía abrir una mesa con pax 999999) y la edición posterior no deja traza. | 🟠 MEDIA |
| C5 | Pedido → total invisible | El salonero no ve cuánto lleva la mesa sin abrir 🧾 — en rush nadie lo abre → sorpresas en la cuenta. | 🟠 MEDIA |
| C6 | ItemPicker → tocar fuera del modal | Cierra y **pierde la selección de modificadores sin avisar**. | 🟡 BAJA |
| C7 | Targets táctiles | × de borrar (~24px), chips de curso (~26px), numpad (~44px) — bajo el estándar 48px. | 🟡 BAJA |
| C8 | Búsqueda | Sin grid: para ítems frecuentes son 2 letras + scroll + tap (≥4 interacciones); en rush es el cuello de botella. | 🟠 MEDIA (=P0-b) |
| ✅ | Volver atrás | "← Salón" y "← Inicio" siempre visibles; modales con Cancelar/overlay — OK. | — |
| ✅ | Quitar ítem NO marchado | Existe (delete pendiente-only, patrón TouchBistro). | — |

## 4. Backlog priorizado

- **P0-a** Numpad pax pro: dígitos ≥56px, ⌫/C, tope 99, valor grande, confirmación clara;
  pax editable post-apertura **con traza** en `pos_orders.notes` (sin DDL).
- **P0-b** Menú grid: pestañas de categoría (subclasificación; fallback tipo), tiles grandes
  (nombre + precio final, color por estación cocina/barra), búsqueda arriba, solo activos con
  precio; **tap directo agrega** si no hay modificadores OBLIGATORIOS (2 taps: categoría → ítem).
- **P1** C1 cancelar mesa vacía (status `cancelled`, confirmación) · C2 deshacer marchar con
  ventana de gracia 20s (revierte a pendiente + traza; KDS lo saca solo por realtime) · C3
  editar ítem no marchado (re-abre el picker prefilled; reemplaza el ítem) · C6 aviso al
  descartar selección.
- **P1-b** Targets ≥48px en numpad/grid/×/marchar, feedback `:active`, **total de la mesa
  siempre visible** en el header del pedido (computeTotals en vivo).
- **P2** Cantidad rápida (×2, ×3 al re-tocar un tile → suma fila), "repetir ítem", favoritos
  (más vendidos primero en cada categoría), void post-cocina con motivo (necesita F3/impresión).

### DECISIONES tomadas en autonomía (revisables)
- **D1**: tap en tile agrega DIRECTO solo si el producto no tiene grupos con `required`;
  si los tiene, abre el picker. Los modificadores opcionales se agregan editando el ítem (✎).
- **D2**: cancelar mesa = SOLO sin ítems (si hay pendientes, se borran primero — explícito);
  con ítems marchados NO se cancela (eso es void de F3, requiere gerencia).
- **D3**: la traza de pax/deshacer-marchar va en `pos_orders.notes` (texto append) — cero DDL,
  visible y suficiente para el piloto; F3 puede formalizarla.
- **D4**: categoría del grid = `subclasificacion` (la misma que ordena el KDS); si está vacía,
  cae a `tipo`. Color del tile por `station` (🔪 cocina = teal · 🍸 barra = dorado).
