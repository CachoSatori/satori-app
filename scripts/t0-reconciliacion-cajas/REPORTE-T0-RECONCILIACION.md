# REPORTE T0 — Reconciliación de cajas

> **Harness READ-ONLY sobre STAGING.** Cero INSERT/UPDATE/DELETE, cero migraciones, cero cambios de esquema.
> Insumo para el rediseño hacia el **pozo único de efectivo**: cuantifica el histórico y corre el modelo nuevo
> en paralelo al actual, sin tocar la app. Generado por `scripts/t0-reconciliacion-cajas` (ver README).

| Campo | Valor |
|---|---|
| Proyecto Supabase | `hwiatgicyyqyezqwldia` (STAGING) |
| Transporte de lectura | `mgmt` |
| `cash_movements` | 1423 |
| `cash_sessions` | 167 |
| `cash_cierres_dia` | 17 (15 completos · 2 parciales) |
| Último movimiento | `2026-07-22 05:32:30.1232+00` |
| Último cierre | `2026-07-22 05:26:23.549655+00` |

> ⚠️ **Datos no confiables:** en staging el/los día(s) **2026-07-21** incluyen turnos FICTICIOS de prueba.
> Cualquier número que caiga en esas fechas es de laboratorio, no de piso — no sirve para conclusiones de plata.

---

## 0 · Resumen ejecutivo

**Clasificación de los cierres completos**

| Clase | Cierres | Qué significa |
|---|---|---|
| ✅ CUADRÓ | 10 | la diferencia es menor a ₡ 500,00 en valor absoluto |
| 🟡 EXPLICADO-HUECO-2 | 0 | la diferencia ≈ −(egresos de Caja Proveedores en efectivo de ese día) |
| 🟠 CANDIDATO-HUECO-1 | 3 | la diferencia ≈ −(un pago de 'Propinas por turno' de ±3 días) |
| 🔴 NO-EXPLICADO | 2 | ninguna de las dos hipótesis la cubre |
| **Total** | **15** | _todos los cierres `tipo=completo` están clasificados_ |

**Pozo único vs modelo actual**

| Medida | CRC | USD |
|---|---|---|
| `saldoPozoEfectivo` (modelo nuevo, harness) | −₡ 3.394.461,21 | $ 2.261,00 |
| `saldoCajaFuerte` (modelo actual, `src/modules/cash/cashUtils.ts`) | ₡ 744.570,00 | $ 3.441,00 |
| **Diferencia (pozo − CF)** | **−₡ 4.139.031,21** | **−$ 1.180,00** |

**Hallazgos de un vistazo**

- **2 cierre(s) NO-EXPLICADO(S)** por las hipótesis de hueco: `2026-06-29` (₡ 5.734,53) · `2026-07-18` (₡ 58.737,07) → detalle en §1.2.
- Los 2 NO-EXPLICADOS **sí tienen un asiento `Ajuste de cierre` en Caja Fuerte por el monto exacto** (Opción B — la diferencia se selló contra el ledger). O sea: están *contabilizados*, no *explicados*: nadie sabe todavía qué movimiento real los causó.
- 🚩 **1 cierre(s) donde el rótulo y el signo del ajuste se contradicen**: `2026-06-29` (sellado "Faltante", contabilizado al revés). El rótulo del cierre dice una cosa y el asiento del ledger hace la contraria — el signo es el que mueve la plata.
- El pozo y la Caja Fuerte difieren en **−₡ 4.139.031,21**; el desglose de §2.2 suma exactamente esa cifra (✅ verificado).
- 🚩 **El pozo da NEGATIVO (−₡ 3.394.461,21)** — imposible en efectivo físico. No es un error del modelo: es la confirmación de que **el histórico no tiene ancla**. Ninguna caja tiene un asiento de apertura, así que cada una arranca contra cero, y las que gastaron más de lo que el ledger les registró como entrado quedan en rojo: `Caja Proveedores` (entra ₡ 11.357.000,00 · sale ₡ 14.591.704,33 → **−₡ 3.234.704,33**) · `Registradora` (entra ₡ 403.000,00 · sale ₡ 1.371.326,88 → **−₡ 968.326,88**). **El pozo necesita un asiento de apertura antes de poder usarse como saldo** (ver §2.4).
- **Cero cajas huérfanas**: no hay ninguna `cash_sessions` con `status='open'`.
- **402 movimiento(s) fuera de convención** (caja/método/tipo fuera del catálogo de `cashUtils`) — §3.b.
- Traspasos que el pozo vuelve **neutros**: 0 con dirección explícita + 154 sin dirección legible (₡ 1.024.578,00 movidos hoy sin poder decir de dónde a dónde) — §3.c.
- **61 movimiento(s) sin turno** (`session_id` NULL, ₡ 15.962.848,21): no entran a ninguna reconciliación por `session_date` — §3.e.
- **1 movimiento(s) con fecha imposible** (año fuera de 2025–2027) — §3.f.

---

## 1 · Reconciliación por cierre

Un renglón por fila de `cash_cierres_dia` con `tipo='completo'`. La columna **Egresos prov. efectivo** es la suma de
`cash_movements` con `caja_origen='Caja Proveedores'` · `method='Efectivo'` · `movement_type like 'egreso%'` ·
`status <> 'rechazado'`, unidos al cierre por `cash_sessions.session_date`.

### 1.1 · Tabla completa

| # | Fecha | Diferencia sellada | ajuste_tipo | ajuste_motivo | Egresos prov. efectivo | dif + egresos | Clase |
|---|---|---|---|---|---|---|---|
| 1 | `2026-06-01` | −₡ 0,47 | — | — | ₡ 716.976,71 _(7 mov.)_ | ₡ 716.976,24 | ✅ CUADRÓ |
| 2 | `2026-06-02` | −₡ 0,47 | — | — | ₡ 87.640,00 _(4 mov.)_ | ₡ 87.639,53 | ✅ CUADRÓ |
| 3 | `2026-06-03` | −₡ 1,47 | — | — | ₡ 145.225,00 _(5 mov.)_ | ₡ 145.223,53 | ✅ CUADRÓ |
| 4 | `2026-06-04` | −₡ 0,47 | — | — | ₡ 37.260,00 _(2 mov.)_ | ₡ 37.259,53 | ✅ CUADRÓ |
| 5 | `2026-06-05` | −₡ 0,47 | — | — | ₡ 175.083,30 _(5 mov.)_ | ₡ 175.082,83 | ✅ CUADRÓ |
| 6 | `2026-06-06` | −₡ 1,47 | — | — | ₡ 62.500,00 _(2 mov.)_ | ₡ 62.498,53 | ✅ CUADRÓ |
| 7 | `2026-06-28` | −₡ 265,47 | Faltante | error | ₡ 11.250,00 _(1 mov.)_ | ₡ 10.984,53 | ✅ CUADRÓ |
| 8 | `2026-06-29` | ₡ 5.734,53 | Faltante | error | — | ₡ 5.734,53 | 🔴 NO-EXPLICADO |
| 9 | `2026-07-07` | −₡ 5.402,00 | Faltante | error por mal cobro | — | −₡ 5.402,00 | 🟠 CANDIDATO-HUECO-1 |
| 10 | `2026-07-09` | −₡ 2.512,00 | Faltante | DIFERENCIA POR DIAS ANTERIORES | ₡ 92.650,00 _(2 mov.)_ | ₡ 90.138,00 | 🟠 CANDIDATO-HUECO-1 |
| 11 | `2026-07-10` | ₡ 1,00 | — | — | — | ₡ 1,00 | ✅ CUADRÓ |
| 12 | `2026-07-18` | ₡ 58.737,07 | Otro | no encuentro el motivo de ese faltante pero en el resumen da con 15 de ajuste | — | ₡ 58.737,07 | 🔴 NO-EXPLICADO |
| 13 | `2026-07-19` | −₡ 0,19 | — | — | ₡ 2.720,00 _(1 mov.)_ | ₡ 2.719,81 | ✅ CUADRÓ |
| 14 | `2026-07-20` | −₡ 1.983,19 | Faltante | DIFERENCIA DE CAJA | ₡ 66.000,00 _(2 mov.)_ | ₡ 64.016,81 | 🟠 CANDIDATO-HUECO-1 |
| 15 | `2026-07-21` ⚠️ | ₡ 5,00 | — | — | — | ₡ 5,00 | ✅ CUADRÓ |

**Candidatos de hueco 1 encontrados** (pago de `Propinas por turno` cuyo monto ≈ −diferencia):

| Cierre | Diferencia | Movimiento propina | Fecha | Monto | Método | Δ días | Residuo | Fuerza |
|---|---|---|---|---|---|---|---|---|
| `2026-07-07` | −₡ 5.402,00 | `b686095e` | `2026-07-06` | ₡ 5.150,00 | Efectivo | -1 | −₡ 252,00 | ⚠️ débil (2 coincidencia(s) entre 43 candidatos) |
| `2026-07-09` | −₡ 2.512,00 | `390340a4` | `2026-07-06` | ₡ 3.000,00 | Efectivo | -3 | ₡ 488,00 | ⚠️ débil (2 coincidencia(s) entre 46 candidatos) |
| `2026-07-20` | −₡ 1.983,19 | `b77f9a5d` | `2026-07-20` | ₡ 1.600,00 | Transferencia | 0 | −₡ 383,19 | ⚠️ débil (1 coincidencia(s) entre 23 candidatos) |

> ⚠️ **Leer con pinzas.** Un "candidato" es una coincidencia de monto, no una causa probada. Cuando hay
> muchos pagos de propina en la ventana de ±3 días, que alguno caiga dentro de
> ₡ 500,00 deja de ser improbable: es lo que mide la columna **Fuerza**. Los marcados como
> **débil** hay que confirmarlos contra el comprobante físico antes de darlos por explicados.

### 1.2 · Cierres NO-EXPLICADOS — números exactos

Se listan **los 2**, sin omitir ninguno. Para cada uno: la diferencia sellada, los egresos
de proveedor en efectivo de ese día (el candidato del hueco 2), y si el cierre emitió un `Ajuste de cierre`
contra el ledger de Caja Fuerte (Opción B).

#### `2026-06-29` — diferencia ₡ 5.734,53

| Dato | Valor |
|---|---|
| `session_date` | `2026-06-29` |
| `diferencia_crc` (sellada) | **₡ 5.734,53** |
| `ajuste_tipo` / `ajuste_motivo` | Faltante / error |
| `manager` | Cacho |
| Cierre creado | `2026-07-06 19:17:00.032029+00` |
| Egresos Caja Proveedores efectivo del día | ₡ 0,00 (0 mov.) |
| Residuo si fuera hueco 2 (`dif + egresos`) | ₡ 5.734,53 |
| Mejor candidato de propina (±3d) | ninguno dentro de ₡ 500,00 |
| Asiento `Ajuste de cierre` emitido | **sí** — ₡ 5.734,53 en `Caja Fuerte` (`fd3835f8`, 2026-07-06 19:19:23.464403+00) |

> El movimiento dice: _"Ajuste de cierre 2026-06-29 · Sobrante · error"_. Su monto **coincide exactamente** con la magnitud
> de la diferencia. La plata quedó **cuadrada en el ledger**, pero la causa física sigue sin identificar:
> ni egresos de proveedor en efectivo ni un pago de propinas de esos días la explican.

> ⚠️ **El cierre y el ledger se contradicen.** El cierre quedó sellado como `ajuste_tipo = "Faltante"`,
> pero el asiento se contabilizó como **ingreso (Sobrante)**, es decir SUMANDO ₡ 5.734,53
> a la Caja Fuerte. Uno de los dos rótulos está mal, y el signo decide de qué lado cae la plata.

#### `2026-07-18` — diferencia ₡ 58.737,07

| Dato | Valor |
|---|---|
| `session_date` | `2026-07-18` |
| `diferencia_crc` (sellada) | **₡ 58.737,07** |
| `ajuste_tipo` / `ajuste_motivo` | Otro / no encuentro el motivo de ese faltante pero en el resumen da con 15 de ajuste |
| `manager` | Caja Satori |
| Cierre creado | `2026-07-19 03:23:00.45692+00` |
| Egresos Caja Proveedores efectivo del día | ₡ 0,00 (0 mov.) |
| Residuo si fuera hueco 2 (`dif + egresos`) | ₡ 58.737,07 |
| Mejor candidato de propina (±3d) | ninguno dentro de ₡ 500,00 |
| Asiento `Ajuste de cierre` emitido | **sí** — ₡ 58.737,07 en `Caja Fuerte` (`65e77c8c`, 2026-07-19 05:15:10.501446+00) |

> El movimiento dice: _"Ajuste de cierre 2026-07-18 · Sobrante · no encuentro el motivo de ese faltante pero en el resumen da con 15 de ajuste"_. Su monto **coincide exactamente** con la magnitud
> de la diferencia. La plata quedó **cuadrada en el ledger**, pero la causa física sigue sin identificar:
> ni egresos de proveedor en efectivo ni un pago de propinas de esos días la explican.

<details><summary>Movimientos de ese día SIN turno (no entran al join)</summary>

| id | tipo | caja | método | subcategory | monto | status |
|---|---|---|---|---|---|---|
| `291660ec` | ingreso | Caja Fuerte | Efectivo | Ventas cierre | ₡ 6.858,00 | aprobado |
| `4eb6a0f4` | egreso_personal | Registradora | Efectivo | Propinas por turno | ₡ 57.420,00 | aprobado |
| `65e77c8c` | ingreso | Caja Fuerte | Efectivo | Ajuste de cierre | ₡ 58.737,07 | aprobado |
| `700f2b58` | traspaso | Caja Fuerte | Transferencia | Banco → Caja Fuerte | ₡ 563.734,00 | aprobado |
| `7f630fc5` | traspaso | Caja Fuerte | Transferencia | Caja Fuerte → Banco | ₡ 0,00 | aprobado |
| `8e5a35a2` | traspaso | Caja Fuerte | Transferencia | Banco → Caja Fuerte | ₡ 12.000,00 | aprobado |
| `a5eb3057` | ingreso | Caja Fuerte | Efectivo | Ventas cierre | −₡ 70.053,07 | aprobado |
| `b7285789` | egreso_personal | Registradora | Efectivo | Propinas por turno | ₡ 12.686,07 | aprobado |

</details>

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
| `saldoPozoEfectivo(movs)` | **−₡ 3.394.461,21** | **$ 2.261,00** |
| `saldoCajaFuerte(movs)` — función real de `src/` | **₡ 744.570,00** | **$ 3.441,00** |
| Diferencia (pozo − CF) | **−₡ 4.139.031,21** | **−$ 1.180,00** |

> **Verificación del espejo:** para desglosar la diferencia hace falta el aporte *por fila* a `saldoCajaFuerte`, que
> la función real no expone. El harness replica esa lógica en `contribucionCajaFuerte()` y comprueba que la suma del
> espejo sea idéntica a la función importada: **✅ idénticas** (espejo ₡ 744.570,00 vs real ₡ 744.570,00). Si divergieran, el harness aborta.

### 2.2 · Desglose de la diferencia por (`caja_origen` × `movement_type`)

Cada renglón es `Σ(aporte al pozo) − Σ(aporte a Caja Fuerte)` de las filas de ese grupo. **La suma de la columna
Δ es exactamente la diferencia de §2.1** — no es una aproximación.

| caja_origen | movement_type | Filas | Aporte al pozo | Aporte a CF | Δ (pozo − CF) |
|---|---|---|---|---|---|
| `Caja Proveedores` | `ingreso` | 19 | ₡ 11.357.000,00 | ₡ 0,00 | **₡ 11.357.000,00** |
| `Caja Proveedores` | `egreso_personal` | 318 | −₡ 8.478.535,00 | ₡ 0,00 | **−₡ 8.478.535,00** |
| `Caja Proveedores` | `egreso_operativo` | 225 | −₡ 3.969.650,00 | ₡ 0,00 | **−₡ 3.969.650,00** |
| `Caja Proveedores` | `egreso_mercaderia` | 261 | −₡ 2.143.519,33 | ₡ 0,00 | **−₡ 2.143.519,33** |
| `Registradora` | `egreso_personal` | 74 | −₡ 1.371.326,88 | ₡ 0,00 | **−₡ 1.371.326,88** |
| `Registradora` | `ingreso` | 2 | ₡ 403.000,00 | ₡ 0,00 | **₡ 403.000,00** |
| `Caja Fuerte` | `traspaso` | 10 | −₡ 11.949.066,00 | −₡ 12.004.066,00 | **₡ 55.000,00** |
| `Caja Fuerte` | `egreso_personal` | 3 | −₡ 82.680,00 | −₡ 91.680,00 | **₡ 9.000,00** |
| `Banco` | `egreso_mercaderia` | 40 | ₡ 0,00 | ₡ 0,00 | **₡ 0,00** |
| `Banco` | `egreso_operativo` | 2 | ₡ 0,00 | ₡ 0,00 | **₡ 0,00** |
| `Caja Fuerte` | `ingreso` | 302 | ₡ 12.895.733,19 | ₡ 12.895.733,19 | **₡ 0,00** |
| `Caja Fuerte` | `egreso_operativo` | 4 | −₡ 9.897,19 | −₡ 9.897,19 | **₡ 0,00** |
| `Caja Fuerte` | `egreso_socios` | 9 | ₡ 0,00 | ₡ 0,00 | **₡ 0,00** |
| `Caja Fuerte` | `egreso_mercaderia` | 1 | −₡ 45.520,00 | −₡ 45.520,00 | **₡ 0,00** |
| `Registradora` | `traspaso` | 153 | ₡ 0,00 | ₡ 0,00 | **₡ 0,00** |

| Comprobación | CRC | USD |
|---|---|---|
| Suma de la columna Δ | **−₡ 4.139.031,21** | **−$ 1.180,00** |
| Diferencia pozo − CF (§2.1) | **−₡ 4.139.031,21** | **−$ 1.180,00** |
| ¿Cuadra? | ✅ sí, al céntimo | ✅ sí, al centavo |

La misma descomposición en dólares, solo los grupos que aportan algo (el resto es cero):

| caja_origen | movement_type | Aporte al pozo | Aporte a CF | Δ (pozo − CF) |
|---|---|---|---|---|
| `Caja Proveedores` | `ingreso` | $ 20,00 | $ 0,00 | **$ 20,00** |
| `Caja Proveedores` | `egreso_personal` | −$ 900,00 | $ 0,00 | **−$ 900,00** |
| `Caja Proveedores` | `egreso_operativo` | −$ 300,00 | $ 0,00 | **−$ 300,00** |
| `Caja Fuerte` | `traspaso` | $ 399,00 | $ 399,00 | **$ 0,00** |
| `Caja Fuerte` | `ingreso` | $ 36.584,00 | $ 36.584,00 | **$ 0,00** |
| `Caja Fuerte` | `egreso_operativo` | −$ 27,00 | −$ 27,00 | **$ 0,00** |
| `Caja Fuerte` | `egreso_socios` | −$ 33.515,00 | −$ 33.515,00 | **$ 0,00** |

### 2.3 · De dónde sale cada colón del pozo

| Clase de fila (modelo pozo) | Filas | Aporte CRC |
|---|---|---|
| `egreso` | 511 | −₡ 16.101.128,40 |
| `fuera` | 426 | ₡ 0,00 |
| `ingreso` | 323 | ₡ 24.655.733,19 |
| `traspaso-indeterminado` | 154 | ₡ 0,00 |
| `traspaso-entra-de-banco` | 5 | ₡ 1.575.734,00 |
| `traspaso-sale-a-banco` | 4 | −₡ 13.524.800,00 |

### 2.4 · Aporte neto de cada caja al pozo

Lo que cada caja física puso y sacó del pozo, según lo que hay cargado como movimiento. Una caja en rojo no
significa que se robaron la plata: significa que **su saldo de apertura nunca se cargó al ledger**, así que sus
egresos se descuentan contra cero.

| caja_origen | Entra | Sale | Neto |
|---|---|---|---|
| `Caja Proveedores` | ₡ 11.357.000,00 | −₡ 14.591.704,33 | **−₡ 3.234.704,33** |
| `Registradora` | ₡ 403.000,00 | −₡ 1.371.326,88 | **−₡ 968.326,88** |
| `Caja Fuerte` | ₡ 14.923.153,85 | −₡ 14.114.583,85 | **₡ 808.570,00** |

---

## 3 · Inventarios

### 3.a · Cajas huérfanas (`cash_sessions` con `status='open'`)

_Ninguna._ Las 167 sesiones están cerradas. **No hay cajas huérfanas que migrar.**

### 3.b · Distribución `caja_origen` × `method` × `movement_type`

Se agrega `status` porque cambia si la fila cuenta o no. La columna **Fuera de convención** marca los valores que
no están en los catálogos de `cashUtils` (`CAJAS_ORIGEN`, `METODOS_PAGO`, `MOVEMENT_TYPES`).

| caja_origen | method | movement_type | status | Filas | Σ CRC | Σ USD | Fuera de convención |
|---|---|---|---|---|---|---|---|
| `Banco` | `Transferencia` | `egreso_mercaderia` | aprobado | 33 | ₡ 1.499.892,90 | $ 0,00 | — |
| `Banco` | `Transferencia` | `egreso_mercaderia` | pendiente | 4 | ₡ 250.573,26 | $ 0,00 | — |
| `Banco` | `Transferencia` | `egreso_mercaderia` | rechazado | 2 | ₡ 20.000,00 | $ 0,00 | — |
| `Banco` | `Transferencia` | `egreso_operativo` | aprobado | 2 | ₡ 11.250,00 | $ 291,54 | — |
| `Banco` | `TRANSFERENCIA` | `egreso_mercaderia` | pendiente | 1 | ₡ 74.126,92 | $ 0,00 | ⚠️ method fuera de catálogo |
| `Caja Fuerte` | `Efectivo` | `egreso_mercaderia` | aprobado | 1 | ₡ 45.520,00 | $ 0,00 | — |
| `Caja Fuerte` | `Efectivo` | `egreso_operativo` | aprobado | 4 | ₡ 9.897,19 | $ 27,00 | — |
| `Caja Fuerte` | `Efectivo` | `egreso_personal` | aprobado | 2 | ₡ 82.680,00 | $ 0,00 | — |
| `Caja Fuerte` | `Efectivo` | `egreso_socios` | aprobado | 9 | ₡ 0,00 | $ 33.515,00 | — |
| `Caja Fuerte` | `Efectivo` | `ingreso` | aprobado | 302 | ₡ 12.895.733,19 | $ 36.584,00 | — |
| `Caja Fuerte` | `Efectivo` | `traspaso` | aprobado | 1 | ₡ 55.000,00 | $ 0,00 | ⚠️ traspaso sin dirección legible |
| `Caja Fuerte` | `Transferencia` | `egreso_personal` | aprobado | 1 | ₡ 9.000,00 | $ 0,00 | — |
| `Caja Fuerte` | `Transferencia` | `traspaso` | aprobado | 9 | ₡ 15.100.534,00 | $ 4.539,00 | — |
| `Caja Proveedores` | `Efectivo` | `egreso_mercaderia` | aprobado | 196 | ₡ 2.143.519,33 | $ 0,00 | — |
| `Caja Proveedores` | `Efectivo` | `egreso_operativo` | aprobado | 148 | ₡ 3.969.650,00 | $ 300,00 | — |
| `Caja Proveedores` | `Efectivo` | `egreso_personal` | aprobado | 106 | ₡ 8.478.535,00 | $ 900,00 | — |
| `Caja Proveedores` | `Efectivo` | `ingreso` | aprobado | 19 | ₡ 11.357.000,00 | $ 20,00 | — |
| `Caja Proveedores` | `Lafise` | `egreso_operativo` | aprobado | 35 | ₡ 132.000,00 | $ 0,00 | ⚠️ method fuera de catálogo |
| `Caja Proveedores` | `Lafise` | `egreso_personal` | aprobado | 2 | ₡ 13.000,00 | $ 0,00 | ⚠️ method fuera de catálogo |
| `Caja Proveedores` | `SINPE` | `egreso_operativo` | aprobado | 35 | ₡ 151.000,00 | $ 0,00 | — |
| `Caja Proveedores` | `SINPE` | `egreso_personal` | aprobado | 2 | ₡ 19.000,00 | $ 0,00 | — |
| `Caja Proveedores` | `tarjeta` | `egreso_personal` | aprobado | 208 | ₡ 10.481.715,00 | $ 0,00 | ⚠️ method fuera de catálogo |
| `Caja Proveedores` | `Tarjeta` | `egreso_mercaderia` | aprobado | 1 | ₡ 19.355,00 | $ 0,00 | ⚠️ method fuera de catálogo |
| `Caja Proveedores` | `Tarjeta de crédito` | `egreso_mercaderia` | aprobado | 1 | ₡ 29,50 | $ 0,00 | ⚠️ method fuera de catálogo |
| `Caja Proveedores` | `Transferencia` | `egreso_mercaderia` | aprobado | 63 | ₡ 4.984.072,22 | $ 0,00 | — |
| `Caja Proveedores` | `Transferencia` | `egreso_operativo` | aprobado | 7 | ₡ 133.866,00 | $ 0,00 | — |
| `Registradora` | `Efectivo` | `egreso_personal` | aprobado | 45 | ₡ 1.371.326,88 | $ 0,00 | — |
| `Registradora` | `Efectivo` | `ingreso` | aprobado | 2 | ₡ 403.000,00 | $ 0,00 | — |
| `Registradora` | `Efectivo` | `traspaso` | aprobado | 153 | ₡ 969.578,00 | $ 110,00 | ⚠️ traspaso sin dirección legible |
| `Registradora` | `Transferencia` | `egreso_personal` | aprobado | 29 | ₡ 1.174.518,00 | $ 0,00 | — |

**Filas fuera de convención: 402** de 1423.

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
| `(null)` | `Registradora` | Efectivo | 133 | ₡ 689.056,00 |
| `Ajuste` | `Registradora` | Efectivo | 20 | ₡ 280.522,00 |
| `Diferencia apertura` | `Caja Fuerte` | Efectivo | 1 | ₡ 55.000,00 |

**c.3 · Contra Banco → los únicos traspasos que SÍ mueven el pozo**

| dirección | caja_origen | method | Filas | Σ CRC | Efecto en el pozo |
|---|---|---|---|---|---|
| `Banco → Caja Fuerte` | `Caja Fuerte` | Transferencia | 5 | ₡ 1.575.734,00 | suma |
| `Caja Fuerte → Banco` | `Caja Fuerte` | Transferencia | 4 | ₡ 13.524.800,00 | resta |

### 3.d · Movimientos con `subcategory = 'Ajuste de cierre'`

| Fecha (created_at) | Signo | Monto | movement_type | caja_origen | method | status | description |
|---|---|---|---|---|---|---|---|
| `2026-07-06 19:15:59.470998+00` | − | ₡ 0,00 | `egreso_operativo` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-06-28 · Faltante · error |
| `2026-07-06 19:19:23.464403+00` | + | ₡ 5.734,53 | `ingreso` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-06-29 · Sobrante · error |
| `2026-07-09 02:48:31.952809+00` | − | ₡ 5.402,00 | `egreso_operativo` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-07-07 · Faltante · error por mal cobro |
| `2026-07-10 19:46:21.550054+00` | − | ₡ 2.512,00 | `egreso_operativo` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-07-09 · Faltante · DIFERENCIA POR DIAS ANTERIORES |
| `2026-07-10 19:46:21.550054+00` | + | ₡ 0,00 | `ingreso` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-07-09 · Sobrante · DIFERENCIA POR DIAS ANTERIORES |
| `2026-07-19 05:15:10.501446+00` | + | ₡ 58.737,07 | `ingreso` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-07-18 · Sobrante · no encuentro el motivo de ese faltante pero en el resumen da con 15 de ajuste |
| `2026-07-21 05:18:50.788671+00` | − | ₡ 1.983,19 | `egreso_operativo` | `Caja Fuerte` | Efectivo | aprobado | Ajuste de cierre 2026-07-20 · Faltante · DIFERENCIA DE CAJA |

Total: **7** movimiento(s), Σ ₡ 74.368,79.

### 3.e · Extra — movimientos sin turno (`session_id` NULL)

No los pide el T0, pero mandan: **ninguna reconciliación por `session_date` los ve**, porque el join sale de
`cash_sessions`. Cualquier modelo nuevo tiene que decidir a qué día pertenecen.

| movement_type | caja_origen | method | subcategory | status | Filas | Σ CRC |
|---|---|---|---|---|---|---|
| `ingreso` | `Caja Fuerte` | Efectivo | Ventas cierre | aprobado | 29 | ₡ 174.861,12 |
| `egreso_personal` | `Registradora` | Efectivo | Propinas por turno | aprobado | 10 | ₡ 413.469,88 |
| `traspaso` | `Caja Fuerte` | Transferencia | Banco → Caja Fuerte | aprobado | 5 | ₡ 1.575.734,00 |
| `egreso_operativo` | `Caja Fuerte` | Efectivo | Ajuste de cierre | aprobado | 4 | ₡ 9.897,19 |
| `traspaso` | `Caja Fuerte` | Transferencia | Caja Fuerte → Banco | aprobado | 4 | ₡ 13.524.800,00 |
| `ingreso` | `Caja Fuerte` | Efectivo | Ajuste de cierre | aprobado | 3 | ₡ 64.471,60 |
| `egreso_mercaderia` | `Caja Proveedores` | Tarjeta de crédito | FDG COBANO | aprobado | 1 | ₡ 29,50 |
| `egreso_mercaderia` | `Caja Proveedores` | Tarjeta | SUPER SANTA TERESA | aprobado | 1 | ₡ 19.355,00 |
| `egreso_personal` | `Caja Fuerte` | Efectivo | (null) | aprobado | 1 | ₡ 25.200,00 |
| `egreso_mercaderia` | `Caja Proveedores` | Efectivo | (null) | aprobado | 1 | ₡ 23.423,00 |
| `egreso_mercaderia` | `Banco` | TRANSFERENCIA | Distribuidora Isleña de Alimentos, S.A. | pendiente | 1 | ₡ 74.126,92 |
| `egreso_personal` | `Caja Fuerte` | Efectivo | Propinas por turno | aprobado | 1 | ₡ 57.480,00 |

Total: **61** movimiento(s), Σ ₡ 15.962.848,21.

### 3.f · Extra — fechas imposibles y días no confiables

Movimientos cuyo `created_at` no se puede leer o cae fuera del rango operativo del negocio (2025–2027) —
casi seguro un dedazo de año:

| id | created_at | Fecha CR | caja_origen | Monto |
|---|---|---|---|---|
| `9b79e731` | `2020-07-09 12:00:00+00` | `2020-07-09` | Banco | ₡ 74.126,92 |

Total: **1**.

Huella de los días marcados como **no confiables** (turnos ficticios de prueba en staging):

| Fecha | Movimientos | Σ CRC |
|---|---|---|
| `2026-07-21` ⚠️ | 9 | ₡ 309.970,48 |

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
