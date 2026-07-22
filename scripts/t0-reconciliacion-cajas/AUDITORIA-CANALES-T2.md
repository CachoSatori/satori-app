# T2 · Auditoría de canales — quién crea movimientos de efectivo

> **Por qué existe.** El diagnóstico del T1-B mostró que el "debería" viejo se entera de la plata
> por **tres** canales (ledger de Caja Fuerte · campos sellados `propinas_m/n` · ninguno), y que una
> misma fila puede restar dos veces o ninguna. El modelo nuevo tiene **un solo canal**: todo
> movimiento de efectivo físico pega al pozo exactamente una vez, vía ledger.
>
> Para que eso sea cierto hay que saber **todos** los lugares del código que crean movimientos de
> efectivo. Ésta es la lista completa, verificada sobre `src/` (búsqueda de inserciones a
> `cash_movements` y de sus llamadores).

Todas las inserciones pasan por **tres funciones** de `src/shared/api/cash.ts`
(`createCashMovement`, `createDayMovement` y los `recordCierre*`). No hay ningún `insert` suelto.

## Canales

| # | Path (UI) | Función | `movement_type` | `caja_origen` | `method` | ¿Toca el pozo? | Estado post-corte |
|---|---|---|---|---|---|---|---|
| 1 | **CashCierre** — ventas del día | `recordCierreSales` | `ingreso` | `Caja Fuerte` | Efectivo | **Sí, +** | ✅ **EL canal de las ventas.** Post-corte entra **BRUTO** (antes: neto de propinas) |
| 2 | **CashCierre** — retiro de dueños | `recordCierreRetiro` | `traspaso` | `Caja Fuerte` | Transferencia | **Sí, −** (`Caja Fuerte → Banco`) | Igual que hoy. Excluido de la base del propio cierre (anti-doble-conteo) |
| 3 | **CashCierre** — ajuste (Opción B) | `recordCierreAjuste` | `ingreso`/`egreso_operativo` | `Caja Fuerte` | Efectivo | Sí | Igual que hoy. Excluido de la base del propio cierre |
| 4 | **Despliegue** — apertura del pozo | `recordAperturaPozo` **(nuevo)** | `ingreso` | `Caja Fuerte` | Efectivo | **Sí, +** | Se corre **una vez**, con la cifra que firma el dueño |
| 5 | **CashCierre** — pagar propina | `createDayMovement` + `propinaEgresoFields` | `egreso_personal` | `Registradora` | Efectivo | **Sí, −** | Igual. **Ahora resta UNA vez** (antes restaba también por `propinas_n` ⇒ doble) |
| 6 | **CashTurno** — pago a proveedor | `createCashMovement` | `egreso_mercaderia` | según método | según método | Sí si es efectivo de caja física | Igual |
| 7 | **CashTurno** — ingreso adicional | `createCashMovement` | `ingreso` | `Registradora` | Efectivo | **Sí, +** | Igual — ⚠️ ver *Riesgo residual* |
| 8 | **AgregarAsistente** — factura/movimiento | `createCashMovement` | `egreso_*` / `ingreso` | según método | según método | Sí si es efectivo de caja física | Igual |
| 9 | **InboxModule** (Bandeja) | `createCashMovement` | `egreso_mercaderia` | `Caja Proveedores` | Efectivo | **Sí, −** | Igual. **Ahora se ve** (antes `Caja Proveedores` era invisible) |
| 10 | **InvMovimientos** (inventario) | `createCashMovement` | `egreso_mercaderia` | `Caja Proveedores` | Efectivo | **Sí, −** | Igual. **Ahora se ve** |
| 11 | **CashMovimientos** — movimiento a nivel día | `createDayMovement` | el que elija el usuario | el que elija | el que elija | Según lo elegido | Igual |
| 12 | **VentasHoy** — botón "→ Caja" | `createCashMovement` | `ingreso` | `Registradora` | Efectivo | **Sí, +** | 🚫 **BLOQUEADO post-corte** — ver abajo |
| 13 | **outbox** (replay offline) | reenvía los payloads de arriba | — | — | — | — | No es un canal nuevo: repite los mismos, con `client_op_id` idempotente |
| 14 | **documents.ts** | delega en `createDayMovement` | — | — | — | — | No es un canal nuevo |

## El único choque real: VentasHoy "→ Caja" (#12)

Ese botón crea **un ingreso con el total de ventas del día** en `Registradora`. El Cierre crea **otro
ingreso por la misma venta** en `Caja Fuerte` (#1).

- **Con el modelo viejo no chocaban**: `saldoCajaFuerte` solo mira `caja_origen = 'Caja Fuerte'`, así
  que el ingreso a `Registradora` era invisible para el "debería". Convivían por accidente.
- **Con el pozo sí chocan**: las tres cajas físicas suman al mismo saldo, así que la venta entraría
  **dos veces**.

**Decisión: bloquear el atajo post-corte** (`esPostCorte(activeDate)` en `VentasHoy.tsx`), con mensaje
explícito. Post-corte la venta entra por **un solo canal**: las ventas brutas del Cierre del Día.
Pre-corte el botón sigue funcionando igual que siempre.

## Riesgo residual declarado

**#7 y #8 — "Ingreso adicional"** (`ingreso` · `Registradora` · Efectivo) es el único otro camino que
*agrega* efectivo a una caja física. No duplica nada por sí mismo: representa plata que realmente
entró y que el cierre no conoce. Pero si alguien lo usara para cargar **ventas del día**, sí quedaría
duplicado contra #1.

No se bloquea porque es un movimiento legítimo con otros usos, y bloquearlo rompería casos reales.
Queda **declarado** acá: si aparece un sobrante recurrente del tamaño de la venta del día, éste es el
primer lugar donde mirar.
