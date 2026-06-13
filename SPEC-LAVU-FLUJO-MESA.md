# SPEC — Flujo de mesa de Lavu vs Satori (fuente de verdad de F3+)

> Sprint 2026-06-12 (rama `f3-cobro`). Investigación del ciclo completo de mesa en Lavu (pedido
> de la dueña) + estado de Satori + backlog priorizado. Esta SPEC manda en los sprints siguientes.

**Fuentes**: [Lavu — Menu Interface Settings](https://support.lavu.com/en/knowledge/advanced-location-settings-menu-interface-settings) ·
[Lavu — Basic Menu Building](https://support.lavu.com/en/knowledge/basic-menu-building-in-lavu) ·
[Lavu — KDS](https://support.lavu.com/en/knowledge/lavu-kds-settings-functions-and-features) ·
[Lavu Reviews — checkout/splits/dual currency](https://www.posoptions.com/pos-reviews/pos-lavu/) ·
[Toast — Order by Seat](https://support.toasttab.com/en/article/Order-by-Seat) ·
[Toast — Course Firing](https://support.toasttab.com/en/article/Course-Firing-Options).

---

## 0. DECISIÓN FIRME de Satori (NO copiar de Lavu)
**`pax` (covers) es OBLIGATORIO ≥1 al abrir la mesa.** Lavu lo trata como opcional / guest count
editable; Satori lo exige (decisión de la dueña, ya implementado con CHECK y numpad). Todo lo que
sigue respeta esa regla.

---

## 1. Función por función — Lavu tiene / nosotros tenemos / nos falta

| # | Función | Lavu | Satori (hoy) | Falta |
|---|---|---|---|---|
| F1 | **Abrir mesa** | desde plano o lista | ✅ plano del salón + decor no-clickable | — |
| F2 | **Pax / covers** | opcional, editable | ✅ **obligatorio ≥1**, numpad ⌫/C, editable con traza | — |
| F3 | **Asiento por ítem** | sí (seat) | ✅ select 1..pax al agregar y al editar | guest names (P2) |
| F4 | **Cursos** | required/optional/off, send-hold-stay | ✅ bebida/entrada/principal + marchar por curso/total | "hold" real (P2) |
| F5 | **Modificadores** | forced (bloquean) + optional | ✅ required bloquea, deltas finales, overrides por producto | — |
| F6 | **Menú visual grid** | grid color por categoría | ✅ grid por subcategoría, color por estación, tap 2-pasos | favoritos/top (P2) |
| F7 | **Marchar (fire)** | por curso, send | ✅ por curso y total → KDS realtime | — |
| F8 | **Deshacer marchar** | (void posterior) | ✅ ventana 20s revierte lo aún marchado | — |
| F9 | **Editar/anular NO enviado** | delete simple | ✅ editar (✎ reemplazo) + quitar (×) pendientes | — |
| F10 | **Anular ENVIADO (void)** | void con motivo + permiso | ❌ | **P1** void con motivo + `verify_manager` + ticket anulación |
| F11 | **Reordenar ronda / repetir** | "repeat round" | ❌ | **P1** repetir ítem / repetir ronda |
| F12 | **Cantidad (qty)** | numpad qty | ⚠ modelo soporta qty, UI agrega de a 1 | **P1** qty rápida / merge filas |
| F13 | **Transferir servidor** | sí | ✅ transferOrder + atribución de métricas + traza | — |
| F14 | **Combinar mesas** | merge con deshacer | ❌ | **P2** merge de órdenes con undo |
| F15 | **Dividir cuenta (split)** | por asiento / por ítems / equitativo (3 modos) | ✅ **3 modos + des-dividir** (mig 028, posSplit, invariante Σ=total) | — |
| F16 | **Cobro: cuenta→método→emisión→impresión** | sí | ✅ (mig 027, checkout reusa computeTotals, ticket SIM) | impresora/fiscal real (futuro) |
| F17 | **Doble moneda + TC ajustable por orden** | "dual currency" + Checkout→Exchange Rate | ✅ ₡ primario + $ secundario, TC override por orden con traza | — |
| F18 | **Vuelto (efectivo)** | numpad recibido → cambio | ✅ función pura testeada (₡ y $→₡) | — |
| F19 | **Propina en el cobro** | tip line | ⚠ **CAPTURA ✅** (10/15/manual → `pos_payments.tip_crc`); **distribución pendiente** | integrar con tipCalculations (sprint aparte, sagrado) |
| F20 | **Reabrir / re-cerrar cuenta** | con permiso | ❌ (cierre simple este sprint) | **P2** reopen con `verify_manager` + traza |
| F21 | **Factura electrónica fiscal** | integración país | ❌ (ticket SIM interno) | **futuro** Almendro/Alanube — `pos_payments` ya deja el hueco |

---

## 2. Modelo del cobro (este sprint, TAREA 1+2)

**Orden confirmado con la operación real (Nube de Fuego)**: la pre-cuenta (🧾) es el documento
PREVIO no fiscal; **al confirmar el método de pago** se emite/imprime. F3 lo replica:

```
Cuenta de mesa (🧾) → [Cobrar] → Checkout (reusa computeTotals: consumo·servicio·IVA·total)
   → método (efectivo / tarjeta / transferencia-SINPE)
   → [efectivo] recibido (numpad ⌫/C) → VUELTO (función pura)
   → [doble moneda] total en ₡ (primario) y $ (secundario) con TC ajustable por orden
   → Confirmar → registra pos_payment → cierra orden (canCloseShift) → imprime ticket (SIM)
```

- **pos_payments** (mig 027): `order_id, method, amount_crc, currency, exchange_rate_used,
  received_crc, received_usd, change_crc, created_by, created_at`. Pensado para que el proveedor
  fiscal (Almendro/Alanube) se enchufe después (campos `fiscal_*` se agregarán cuando se integre).
- **Cierre**: `pos_orders.status='closed'`, `closed_at`, `closed_by` (mig 027 agrega closed_by).
  Respeta `canCloseShift` solo a nivel turno (la mesa individual se cobra y cierra siempre; el
  bloqueo del "último turno con mesas abiertas" sigue siendo del cierre de turno, no del cobro).
- **Doble moneda**: TC base de `exchange_rates` (la última registrada, getCurrentRate). Override
  por orden en el checkout (como Lavu Checkout→Exchange Rate); el TC usado se guarda en el pago.
- **Ticket SIM**: render a texto (reusa el formato de `print-bridge/render.js`, portado puro a TS)
  → log/preview en pantalla. La impresora real queda para la prueba física (HUB LOCAL F5).

### Funciones puras nuevas (toda la plata, testeadas) — `posCobro.ts`
- `calcularVuelto(totalCrc, recibidoCrc)` → vuelto en ₡ (nunca negativo; falta = adeudado).
- `convertirCrcAUsd(crc, tc)` / `convertirUsdACrc(usd, tc)` → redondeo CR sensato (₡ entero, $ a 2).
- `vueltoPagoUsd(totalCrc, recibidoUsd, tc)` → escenario turista: recibe $, vuelto en ₡.
- `splitTotalCrc` — NO en este sprint (P1), pero la firma queda reservada.

---

## 3. Backlog priorizado (post-cobro)
- **Sprint 1 ✅**: F16 cobro base, F17 doble moneda, F18 vuelto.
- **Sprint 2 ✅**: F15 split (3 modos + des-dividir), F19 propina (CAPTURA; distribución pendiente).
- **P1 restante**: F19 integración propina↔tipCalculations (sagrado, sprint propio) · F10 void de
  enviados con permiso · F11/F12 repetir ronda y qty rápida.
- **P2**: F14 combinar mesas con undo · F20 reabrir/re-cerrar con permiso · F3 nombres de invitado ·
  F4 hold real · F6 favoritos/top.
- **Futuro**: F21 factura electrónica fiscal (Almendro/Alanube) sobre `pos_payments`.

### DECISIONES de este sprint (revisables)
- **D1**: el cobro cierra la mesa SIEMPRE (status closed); el gate `canCloseShift` sigue siendo del
  cierre de TURNO, no del cobro individual (cobrar una mesa es justamente cómo se vacía el salón).
- **D2**: un pago por orden en este sprint (pago único). Pagos parciales/split = P1 (la tabla ya
  admite varias filas por order_id, así que no hay deuda de schema).
- **D3**: TC override es por-orden y se guarda en el pago (`exchange_rate_used`); NO modifica
  `exchange_rates` (esa tabla es el TC del día, sagrado del resto del sistema).
- **D4**: ticket = SIM (texto en pantalla + log). Impresora real y factura fiscal = futuro, con el
  hueco ya hecho.
