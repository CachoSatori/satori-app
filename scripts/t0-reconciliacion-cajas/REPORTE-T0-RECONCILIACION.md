# REPORTE T0 — Reconciliación de cajas

> **Harness READ-ONLY sobre STAGING.** Cero INSERT/UPDATE/DELETE, cero migraciones, cero cambios de esquema.
> Insumo para el rediseño hacia el **pozo único de efectivo**: cuantifica el histórico y corre el modelo nuevo
> en paralelo al actual, sin tocar la app. Generado por `scripts/t0-reconciliacion-cajas` (ver README).

| Campo | Valor |
|---|---|
| Proyecto Supabase | `hwiatgicyyqyezqwldia` (STAGING) |
| Transporte de lectura | `mgmt` |
| `cash_movements` | 980 |
| `cash_sessions` | 170 |
| `cash_cierres_dia` | 16 (11 completos · 5 parciales) |
| Último movimiento | `2026-07-22 05:46:54.369+00` |
| Último cierre | `2026-07-21 00:25:44.677316+00` |

> ⚠️ **Datos no confiables:** en staging el/los día(s) **2026-07-21** incluyen turnos FICTICIOS de prueba.
> Cualquier número que caiga en esas fechas es de laboratorio, no de piso — no sirve para conclusiones de plata.

---

## 0 · Resumen ejecutivo

**Clasificación de los cierres completos**

| Clase | Cierres | Qué significa |
|---|---|---|
| ✅ CUADRÓ | 8 | la diferencia es menor a ₡ 500,00 en valor absoluto |
| 🟡 EXPLICADO-HUECO-2 | 0 | la diferencia ≈ −(egresos de Caja Proveedores en efectivo de ese día) |
| 🟠 CANDIDATO-HUECO-1 | 0 | la diferencia ≈ −(un pago de 'Propinas por turno' de ±3 días) |
| 🔴 NO-EXPLICADO | 3 | ninguna de las dos hipótesis la cubre |
| **Total** | **11** | _todos los cierres `tipo=completo` están clasificados_ |

**Pozo único vs modelo actual**

| Medida | CRC | USD |
|---|---|---|
| `saldoPozoEfectivo` (modelo nuevo, harness) | −₡ 755.313,73 | −$ 843,00 |
| `saldoCajaFuerte` (modelo actual, `src/modules/cash/cashUtils.ts`) | ₡ 1.182.000,00 | $ 357,00 |
| **Diferencia (pozo − CF)** | **−₡ 1.937.313,73** | **−$ 1.200,00** |

**Hallazgos de un vistazo**

- **3 cierre(s) NO-EXPLICADO(S)** por las hipótesis de hueco: `2026-07-02` (−₡ 6.744,79) · `2026-07-09` (−₡ 4.000,00) · `2026-07-11` (−₡ 1.210,00) → detalle en §1.2.
- Los 3 NO-EXPLICADOS **sí tienen un egreso `Ajuste de cierre` en Caja Fuerte por el monto exacto** (Opción B — la diferencia se selló contra el ledger). O sea: están *contabilizados*, no *explicados*: nadie sabe todavía qué movimiento real los causó.
- El pozo y la Caja Fuerte difieren en **−₡ 1.937.313,73**; el desglose de §2.2 suma exactamente esa cifra (✅ verificado).
- 🚩 **El pozo da NEGATIVO (−₡ 755.313,73)** — imposible en efectivo físico. No es un error del modelo: es la confirmación de que **el histórico no tiene ancla**. Ninguna caja tiene un asiento de apertura, así que cada una arranca contra cero, y las que gastaron más de lo que el ledger les registró como entrado quedan en rojo: `Caja Proveedores` (entra ₡ 9.547.000,00 · sale ₡ 11.133.536,73 → **−₡ 1.586.536,73**) · `Registradora` (entra ₡ 0,00 · sale ₡ 350.777,00 → **−₡ 350.777,00**). **El pozo necesita un asiento de apertura antes de poder usarse como saldo** (ver §2.4).
- Y acá está el nudo: `Caja Fuerte` sola cierra en **₡ 1.182.000,00**, que es *exactamente* lo que devuelve `saldoCajaFuerte`. El modelo actual **no está mal calculado — está mirando una sola caja de tres**. Toda la diferencia de −₡ 1.937.313,73 es el rojo de `Caja Proveedores` y `Registradora`, que hoy nadie ve.
- **Cero cajas huérfanas**: no hay ninguna `cash_sessions` con `status='open'`.
- **326 movimiento(s) fuera de convención** (caja/método/tipo fuera del catálogo de `cashUtils`) — §3.b.
- Traspasos que el pozo vuelve **neutros**: 0 con dirección explícita + 123 sin dirección legible (₡ 917.637,00 movidos hoy sin poder decir de dónde a dónde) — §3.c.
- **19 movimiento(s) sin turno** (`session_id` NULL, ₡ 12.700.190,36): no entran a ninguna reconciliación por `session_date` — §3.e.
- **2 movimiento(s) con fecha imposible** (año fuera de 2025–2027) — §3.f.

---

## 1 · Reconciliación por cierre

Un renglón por fila de `cash_cierres_dia` con `tipo='completo'`. La columna **Egresos prov. efectivo** es la suma de
`cash_movements` con `caja_origen='Caja Proveedores'` · `method='Efectivo'` · `movement_type like 'egreso%'` ·
`status <> 'rechazado'`, unidos al cierre por `cash_sessions.session_date`.

### 1.1 · Tabla completa

| # | Fecha | Diferencia sellada | ajuste_tipo | ajuste_motivo | Egresos prov. efectivo | dif + egresos | Clase |
|---|---|---|---|---|---|---|---|
| 1 | `2026-06-01` | −₡ 0,47 | — | — | — | −₡ 0,47 | ✅ CUADRÓ |
| 2 | `2026-06-02` | −₡ 0,47 | — | — | — | −₡ 0,47 | ✅ CUADRÓ |
| 3 | `2026-06-03` | −₡ 1,47 | — | — | — | −₡ 1,47 | ✅ CUADRÓ |
| 4 | `2026-06-04` | −₡ 0,47 | — | — | — | −₡ 0,47 | ✅ CUADRÓ |
| 5 | `2026-06-05` | −₡ 0,47 | — | — | — | −₡ 0,47 | ✅ CUADRÓ |
| 6 | `2026-06-06` | −₡ 1,47 | — | — | — | −₡ 1,47 | ✅ CUADRÓ |
| 7 | `2026-07-01` | ₡ 0,21 | Faltante | no encuentrro la platr | ₡ 2.400,00 _(1 mov.)_ | ₡ 2.400,21 | ✅ CUADRÓ |
| 8 | `2026-07-02` | −₡ 6.744,79 | Faltante | wee | — | −₡ 6.744,79 | 🔴 NO-EXPLICADO |
| 9 | `2026-07-09` | −₡ 4.000,00 | Faltante | eroor | — | −₡ 4.000,00 | 🔴 NO-EXPLICADO |
| 10 | `2026-07-11` | −₡ 1.210,00 | Faltante | error | — | −₡ 1.210,00 | 🔴 NO-EXPLICADO |
| 11 | `2026-07-16` | ₡ 300,00 | — | — | — | ₡ 300,00 | ✅ CUADRÓ |

_Ningún cierre tiene un pago de `Propinas por turno` con monto ≈ −diferencia dentro de ±3 días (tolerancia ₡ 500,00) → **cero CANDIDATO-HUECO-1** en este histórico._

### 1.2 · Cierres NO-EXPLICADOS — números exactos

Se listan **los 3**, sin omitir ninguno. Para cada uno: la diferencia sellada, los egresos
de proveedor en efectivo de ese día (el candidato del hueco 2), y si el cierre emitió un `Ajuste de cierre`
contra el ledger de Caja Fuerte (Opción B).

#### `2026-07-02` — diferencia −₡ 6.744,79

| Dato | Valor |
|---|---|
| `session_date` | `2026-07-02` |
| `diferencia_crc` (sellada) | **−₡ 6.744,79** |
| `ajuste_tipo` / `ajuste_motivo` | Faltante / wee |
| `manager` | Caja Satori |
| Cierre creado | `2026-07-03 19:04:19.856875+00` |
| Egresos Caja Proveedores efectivo del día | ₡ 0,00 (0 mov.) |
| Residuo si fuera hueco 2 (`dif + egresos`) | −₡ 6.744,79 |
| Mejor candidato de propina (±3d) | ninguno dentro de ₡ 500,00 |
| Egreso `Ajuste de cierre` emitido | **sí** — ₡ 6.744,79 en `Caja Fuerte` (`b14a5cbc`, 2026-07-03 19:06:34.309977+00) |

> El movimiento dice: _"Ajuste de cierre 2026-07-02 · Faltante · wee"_. Su monto **coincide exactamente** con la magnitud
> de la diferencia. La plata quedó **cuadrada en el ledger**, pero la causa física sigue sin identificar:
> ni egresos de proveedor en efectivo ni un pago de propinas de esos días la explican.

<details><summary>Movimientos de ese día SIN turno (no entran al join)</summary>

| id | tipo | caja | método | subcategory | monto | status |
|---|---|---|---|---|---|---|
| `695828db` | egreso_personal | Registradora | Efectivo | Propinas por turno | ₡ 79.999,00 | aprobado |

</details>

#### `2026-07-09` — diferencia −₡ 4.000,00

| Dato | Valor |
|---|---|
| `session_date` | `2026-07-09` |
| `diferencia_crc` (sellada) | **−₡ 4.000,00** |
| `ajuste_tipo` / `ajuste_motivo` | Faltante / eroor |
| `manager` | Caja Satori |
| Cierre creado | `2026-07-10 04:30:00.866478+00` |
| Egresos Caja Proveedores efectivo del día | ₡ 0,00 (0 mov.) |
| Residuo si fuera hueco 2 (`dif + egresos`) | −₡ 4.000,00 |
| Mejor candidato de propina (±3d) | ninguno dentro de ₡ 500,00 |
| Egreso `Ajuste de cierre` emitido | **sí** — ₡ 4.000,00 en `Caja Fuerte` (`7c328d60`, 2026-07-10 04:33:04.957612+00) |

> El movimiento dice: _"Ajuste de cierre 2026-07-09 · Faltante · eroor"_. Su monto **coincide exactamente** con la magnitud
> de la diferencia. La plata quedó **cuadrada en el ledger**, pero la causa física sigue sin identificar:
> ni egresos de proveedor en efectivo ni un pago de propinas de esos días la explican.

<details><summary>Movimientos de ese día SIN turno (no entran al join)</summary>

| id | tipo | caja | método | subcategory | monto | status |
|---|---|---|---|---|---|---|
| `7c328d60` | egreso_operativo | Caja Fuerte | Efectivo | Ajuste de cierre | ₡ 4.000,00 | aprobado |
| `f741363b` | ingreso | Caja Fuerte | Efectivo | Ventas cierre | ₡ 73.000,00 | aprobado |

</details>

#### `2026-07-11` — diferencia −₡ 1.210,00

| Dato | Valor |
|---|---|
| `session_date` | `2026-07-11` |
| `diferencia_crc` (sellada) | **−₡ 1.210,00** |
| `ajuste_tipo` / `ajuste_motivo` | Faltante / error |
| `manager` | Caja Satori |
| Cierre creado | `2026-07-17 20:36:47.567462+00` |
| Egresos Caja Proveedores efectivo del día | ₡ 0,00 (0 mov.) |
| Residuo si fuera hueco 2 (`dif + egresos`) | −₡ 1.210,00 |
| Mejor candidato de propina (±3d) | ninguno dentro de ₡ 500,00 |
| Egreso `Ajuste de cierre` emitido | **sí** — ₡ 1.210,00 en `Caja Fuerte` (`127d674d`, 2026-07-17 20:37:36.761246+00) |

> El movimiento dice: _"Ajuste de cierre 2026-07-11 · Faltante · error"_. Su monto **coincide exactamente** con la magnitud
> de la diferencia. La plata quedó **cuadrada en el ledger**, pero la causa física sigue sin identificar:
> ni egresos de proveedor en efectivo ni un pago de propinas de esos días la explican.

---

## 2 · Saldo del pozo vs saldo de Caja Fuerte

### 2.1 · Los dos números

`saldoPozoEfectivo` vive **solo en el harness** (`scripts/t0-reconciliacion-cajas/pozo.ts`); `saldoCajaFuerte` se
**importa tal cual** de `src/modules/cash/cashUtils.ts` sin modificarlo. Reglas del pozo:

- Cajas físicas: `Caja Fuerte` · `Caja Proveedores` · `Registradora`. **`Banco` queda fuera.**
- Ingresos/egresos: cuentan si son de caja física, en `Efectivo` (o sin método), y `status` ≠ `pendiente`/`rechazado`.
- Traspasos **entre cajas físicas: neutros** (mover plata de bolsillo no cambia cuánto efectivo hay).
- Traspasos **contra Banco: sí mueven** — `Caja Fuerte → Banco` resta, `Banco → Caja Fuerte` suma. La dirección sale de
  `subcategory`, **no** del `method` (los depósitos históricos están cargados como `Transferencia`).

| Medida | CRC | USD |
|---|---|---|
| `saldoPozoEfectivo(movs)` | **−₡ 755.313,73** | **−$ 843,00** |
| `saldoCajaFuerte(movs)` — función real de `src/` | **₡ 1.182.000,00** | **$ 357,00** |
| Diferencia (pozo − CF) | **−₡ 1.937.313,73** | **−$ 1.200,00** |

> **Verificación del espejo:** para desglosar la diferencia hace falta el aporte *por fila* a `saldoCajaFuerte`, que
> la función real no expone. El harness replica esa lógica en `contribucionCajaFuerte()` y comprueba que la suma del
> espejo sea idéntica a la función importada: **✅ idénticas** (espejo ₡ 1.182.000,00 vs real ₡ 1.182.000,00). Si divergieran, el harness aborta.

### 2.2 · Desglose de la diferencia por (`caja_origen` × `movement_type`)

Cada renglón es `Σ(aporte al pozo) − Σ(aporte a Caja Fuerte)` de las filas de ese grupo. **La suma de la columna
Δ es exactamente la diferencia de §2.1** — no es una aproximación.

| caja_origen | movement_type | Filas | Aporte al pozo | Aporte a CF | Δ (pozo − CF) |
|---|---|---|---|---|---|
| `Caja Proveedores` | `ingreso` | 15 | ₡ 9.547.000,00 | ₡ 0,00 | **₡ 9.547.000,00** |
| `Caja Proveedores` | `egreso_personal` | 238 | −₡ 6.334.260,00 | ₡ 0,00 | **−₡ 6.334.260,00** |
| `Caja Proveedores` | `egreso_operativo` | 188 | −₡ 3.254.650,00 | ₡ 0,00 | **−₡ 3.254.650,00** |
| `Caja Proveedores` | `egreso_mercaderia` | 157 | −₡ 1.544.626,73 | ₡ 0,00 | **−₡ 1.544.626,73** |
| `Registradora` | `egreso_personal` | 7 | −₡ 350.777,00 | ₡ 0,00 | **−₡ 350.777,00** |
| `Banco` | `egreso_mercaderia` | 6 | ₡ 0,00 | ₡ 0,00 | **₡ 0,00** |
| `Banco` | `egreso_personal` | 1 | ₡ 0,00 | ₡ 0,00 | **₡ 0,00** |
| `Caja Fuerte` | `ingreso` | 232 | ₡ 12.150.840,79 | ₡ 12.150.840,79 | **₡ 0,00** |
| `Caja Fuerte` | `egreso_operativo` | 4 | −₡ 11.954,79 | −₡ 11.954,79 | **₡ 0,00** |
| `Caja Fuerte` | `egreso_socios` | 7 | ₡ 0,00 | ₡ 0,00 | **₡ 0,00** |
| `Caja Fuerte` | `traspaso` | 2 | −₡ 10.956.886,00 | −₡ 10.956.886,00 | **₡ 0,00** |
| `Registradora` | `traspaso` | 123 | ₡ 0,00 | ₡ 0,00 | **₡ 0,00** |

| Comprobación | CRC | USD |
|---|---|---|
| Suma de la columna Δ | **−₡ 1.937.313,73** | **−$ 1.200,00** |
| Diferencia pozo − CF (§2.1) | **−₡ 1.937.313,73** | **−$ 1.200,00** |
| ¿Cuadra? | ✅ sí, al céntimo | ✅ sí, al centavo |

La misma descomposición en dólares, solo los grupos que aportan algo (el resto es cero):

| caja_origen | movement_type | Aporte al pozo | Aporte a CF | Δ (pozo − CF) |
|---|---|---|---|---|
| `Caja Proveedores` | `egreso_personal` | −$ 900,00 | $ 0,00 | **−$ 900,00** |
| `Caja Proveedores` | `egreso_operativo` | −$ 300,00 | $ 0,00 | **−$ 300,00** |
| `Caja Fuerte` | `ingreso` | $ 32.030,00 | $ 32.030,00 | **$ 0,00** |
| `Caja Fuerte` | `egreso_operativo` | −$ 20,00 | −$ 20,00 | **$ 0,00** |
| `Caja Fuerte` | `egreso_socios` | −$ 29.515,00 | −$ 29.515,00 | **$ 0,00** |
| `Caja Fuerte` | `traspaso` | −$ 2.138,00 | −$ 2.138,00 | **$ 0,00** |

### 2.3 · De dónde sale cada colón del pozo

| Clase de fila (modelo pozo) | Filas | Aporte CRC |
|---|---|---|
| `egreso` | 360 | −₡ 11.496.268,52 |
| `fuera` | 248 | ₡ 0,00 |
| `ingreso` | 247 | ₡ 21.697.840,79 |
| `traspaso-indeterminado` | 123 | ₡ 0,00 |
| `traspaso-sale-a-banco` | 1 | −₡ 11.206.886,00 |
| `traspaso-entra-de-banco` | 1 | ₡ 250.000,00 |

### 2.4 · Aporte neto de cada caja al pozo

Lo que cada caja física puso y sacó del pozo, según lo que hay cargado como movimiento. Una caja en rojo no
significa que se robaron la plata: significa que **su saldo de apertura nunca se cargó al ledger**, así que sus
egresos se descuentan contra cero.

| caja_origen | Entra | Sale | Neto |
|---|---|---|---|
| `Caja Proveedores` | ₡ 9.547.000,00 | −₡ 11.133.536,73 | **−₡ 1.586.536,73** |
| `Registradora` | ₡ 0,00 | −₡ 350.777,00 | **−₡ 350.777,00** |
| `Caja Fuerte` | ₡ 12.449.795,79 | −₡ 11.267.795,79 | **₡ 1.182.000,00** |

---

## 3 · Inventarios

### 3.a · Cajas huérfanas (`cash_sessions` con `status='open'`)

_Ninguna._ Las 170 sesiones están cerradas. **No hay cajas huérfanas que migrar.**

### 3.b · Distribución `caja_origen` × `method` × `movement_type`

Se agrega `status` porque cambia si la fila cuenta o no. La columna **Fuera de convención** marca los valores que
no están en los catálogos de `cashUtils` (`CAJAS_ORIGEN`, `METODOS_PAGO`, `MOVEMENT_TYPES`).

| caja_origen | method | movement_type | status | Filas | Σ CRC | Σ USD | Fuera de convención |
|---|---|---|---|---|---|---|---|
| `Banco` | `Transferencia` | `egreso_mercaderia` | aprobado | 2 | ₡ 60.038,45 | $ 0,00 | — |
| `Banco` | `Transferencia` | `egreso_mercaderia` | pendiente | 3 | ₡ 104.971,30 | $ 0,00 | — |
| `Banco` | `Transferencia` | `egreso_mercaderia` | rechazado | 1 | ₡ 45.000,00 | $ 0,00 | — |
| `Banco` | `Transferencia` | `egreso_personal` | aprobado | 1 | ₡ 8.888,00 | $ 0,00 | — |
| `Caja Fuerte` | `Efectivo` | `egreso_operativo` | aprobado | 4 | ₡ 11.954,79 | $ 20,00 | — |
| `Caja Fuerte` | `Efectivo` | `egreso_socios` | aprobado | 7 | ₡ 0,00 | $ 29.515,00 | — |
| `Caja Fuerte` | `Efectivo` | `ingreso` | aprobado | 232 | ₡ 12.150.840,79 | $ 32.030,00 | — |
| `Caja Fuerte` | `Transferencia` | `traspaso` | aprobado | 2 | ₡ 11.456.886,00 | $ 2.138,00 | — |
| `Caja Proveedores` | `Efectivo` | `egreso_mercaderia` | aprobado | 153 | ₡ 1.544.626,73 | $ 0,00 | — |
| `Caja Proveedores` | `Efectivo` | `egreso_operativo` | aprobado | 121 | ₡ 3.254.650,00 | $ 300,00 | — |
| `Caja Proveedores` | `Efectivo` | `egreso_personal` | aprobado | 68 | ₡ 6.334.260,00 | $ 900,00 | — |
| `Caja Proveedores` | `Efectivo` | `ingreso` | aprobado | 15 | ₡ 9.547.000,00 | $ 0,00 | — |
| `Caja Proveedores` | `Lafise` | `egreso_operativo` | aprobado | 34 | ₡ 129.000,00 | $ 0,00 | ⚠️ method fuera de catálogo |
| `Caja Proveedores` | `Lafise` | `egreso_personal` | aprobado | 2 | ₡ 13.000,00 | $ 0,00 | ⚠️ method fuera de catálogo |
| `Caja Proveedores` | `SINPE` | `egreso_operativo` | aprobado | 29 | ₡ 129.000,00 | $ 0,00 | — |
| `Caja Proveedores` | `SINPE` | `egreso_personal` | aprobado | 1 | ₡ 9.000,00 | $ 0,00 | — |
| `Caja Proveedores` | `tarjeta` | `egreso_personal` | aprobado | 167 | ₡ 9.469.990,00 | $ 0,00 | ⚠️ method fuera de catálogo |
| `Caja Proveedores` | `Transferencia` | `egreso_mercaderia` | aprobado | 4 | ₡ 244.562,90 | $ 0,00 | — |
| `Caja Proveedores` | `Transferencia` | `egreso_operativo` | aprobado | 4 | ₡ 15.000,00 | $ 0,00 | — |
| `Registradora` | `Efectivo` | `egreso_personal` | aprobado | 7 | ₡ 350.777,00 | $ 0,00 | — |
| `Registradora` | `Efectivo` | `traspaso` | aprobado | 123 | ₡ 917.637,00 | $ 110,00 | ⚠️ traspaso sin dirección legible |

**Filas fuera de convención: 326** de 980.

### 3.c · Traspasos

Bajo el pozo, un traspaso **entre cajas físicas deja de mover plata**. Este es el censo de los que cambian de
semántica, y el de los que ni siquiera dicen a dónde iban.

**c.1 · Entre cajas físicas (dirección explícita) → pasan a NEUTROS**

_Ninguno con dirección explícita entre dos cajas físicas._

**c.2 · Sin dirección legible → el harness los ASUME internos (neutros) y los reporta acá**

Son traspasos cuyo `subcategory` no tiene la forma `A → B` (`null`, `Ajuste`, texto libre). Hoy `saldoCajaFuerte`
los ignora por completo cuando `caja_origen` ≠ `Caja Fuerte`. **Antes de mover el modelo hay que decidir qué son.**

| subcategory | caja_origen | method | Filas | Σ CRC |
|---|---|---|---|---|
| `(null)` | `Registradora` | Efectivo | 103 | ₡ 637.115,00 |
| `Ajuste` | `Registradora` | Efectivo | 20 | ₡ 280.522,00 |

**c.3 · Contra Banco → los únicos traspasos que SÍ mueven el pozo**

| dirección | caja_origen | method | Filas | Σ CRC | Efecto en el pozo |
|---|---|---|---|---|---|
| `Caja Fuerte → Banco` | `Caja Fuerte` | Transferencia | 1 | ₡ 11.206.886,00 | resta |
| `Banco → Caja Fuerte` | `Caja Fuerte` | Transferencia | 1 | ₡ 250.000,00 | suma |

### 3.d · Movimientos con `subcategory = 'Ajuste de cierre'`

| Fecha (created_at) | Signo | Monto | movement_type | caja_origen | method | status | description |
|---|---|---|---|---|---|---|---|
| `2026-07-03 18:57:35.613055+00` | − | ₡ 0,00 | `egreso_operativo` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-07-01 · Faltante · no encuentrro la platr |
| `2026-07-03 19:06:34.309977+00` | − | ₡ 6.744,79 | `egreso_operativo` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-07-02 · Faltante · wee |
| `2026-07-10 04:33:04.957612+00` | − | ₡ 4.000,00 | `egreso_operativo` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-07-09 · Faltante · eroor |
| `2026-07-17 20:37:36.761246+00` | − | ₡ 1.210,00 | `egreso_operativo` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-07-11 · Faltante · error |

Total: **4** movimiento(s), Σ ₡ 11.954,79.

### 3.e · Extra — movimientos sin turno (`session_id` NULL)

No los pide el T0, pero mandan: **ninguna reconciliación por `session_date` los ve**, porque el join sale de
`cash_sessions`. Cualquier modelo nuevo tiene que decidir a qué día pertenecen.

| movement_type | caja_origen | method | subcategory | status | Filas | Σ CRC |
|---|---|---|---|---|---|---|
| `ingreso` | `Caja Fuerte` | Efectivo | Ventas cierre | aprobado | 7 | ₡ 943.955,00 |
| `egreso_operativo` | `Caja Fuerte` | Efectivo | Ajuste de cierre | aprobado | 4 | ₡ 11.954,79 |
| `egreso_personal` | `Registradora` | Efectivo | Propinas por turno | aprobado | 4 | ₡ 202.922,00 |
| `traspaso` | `Caja Fuerte` | Transferencia | Caja Fuerte → Banco | aprobado | 1 | ₡ 11.206.886,00 |
| `egreso_mercaderia` | `Banco` | Transferencia | Pescados Tambor | pendiente | 1 | ₡ 54.978,00 |
| `traspaso` | `Caja Fuerte` | Transferencia | Banco → Caja Fuerte | aprobado | 1 | ₡ 250.000,00 |
| `egreso_mercaderia` | `Banco` | Transferencia | SUPER SANTA TERESA | pendiente | 1 | ₡ 29.494,57 |

Total: **19** movimiento(s), Σ ₡ 12.700.190,36.

### 3.f · Extra — fechas imposibles y días no confiables

Movimientos cuyo `created_at` no se puede leer o cae fuera del rango operativo del negocio (2025–2027) —
casi seguro un dedazo de año:

| id | created_at | Fecha CR | caja_origen | Monto |
|---|---|---|---|---|
| `c91f7def` | `2016-06-17 12:00:00+00` | `2016-06-17` | Banco | ₡ 54.978,00 |
| `e1b43ca3` | `2020-06-17 12:00:00+00` | `2020-06-17` | Banco | ₡ 29.494,57 |

Total: **2**.

Huella de los días marcados como **no confiables** (turnos ficticios de prueba en staging):

| Fecha | Movimientos | Σ CRC |
|---|---|---|
| `2026-07-21` ⚠️ | 2 | ₡ 12.000,00 |

---

## Apéndice · Definiciones y supuestos

- **Tolerancia**: ₡ 500,00 para las tres comparaciones. `CUADRÓ` usa `< tolerancia` (estricto);
  `HUECO-2` y `HUECO-1` usan `≤ tolerancia`.
- **Orden de clasificación**: `CUADRÓ` → `EXPLICADO-HUECO-2` → `CANDIDATO-HUECO-1` → `NO-EXPLICADO`. El primero que
  aplica gana, así que un cierre que cuadra no se "explica" por unos egresos que casualmente sumen poco.
- **HUECO-2** exige egresos > 0: si el día no tuvo egresos de proveedor en efectivo, no puede ser la causa.
- **HUECO-1** busca un solo pago de `Propinas por turno` (no combinaciones) dentro de ±3 días.
  La fecha del pago es su `session_date`; si no tiene turno, el día de Costa Rica de su `created_at`.
- **Traspasos sin dirección legible** se asumen internos (neutros para el pozo). Es un supuesto, y por eso está
  inventariado en §3.c.2 con su monto: si se decidiera otra cosa, ahí está la plata en juego.
- **Fechas**: todo lo que convierte `created_at` a día usa `America/Costa_Rica`, igual que `dateCR` de la app.
- **`saldoCajaFuerte` no excluye `rechazado`** (solo `pendiente`); el pozo sí excluye ambos. Parte de la diferencia
  de §2.1 sale de ahí.

### Qué NO hace este reporte

- No escribe una sola fila: el transporte `mgmt` manda las consultas con `read_only: true`, que Postgres impone a
  nivel de transacción (un `CREATE` en ese canal falla con `25006`).
- No toca `src/`. El único símbolo importado desde la app es `saldoCajaFuerte`, en modo lectura.
- No propone la migración. Mide el terreno para que la decisión del pozo se tome con números, no con memoria.
