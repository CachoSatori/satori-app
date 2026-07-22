# REPORTE T1-B — Corrida anclada contra PRODUCCIÓN

> **READ-ONLY sobre PRODUCCIÓN.** Doble opt-in: el ref va clavado en el código **y** exige
> `T0_PROD_FIRMADO`. Antes de leer un solo dato, el canal rechazó a propósito una escritura de
> prueba. Valida el núcleo `saldoPozoEfectivo` (`src/modules/cash/pozo.ts`) contra el histórico
> real de prod y responde las dos preguntas obligatorias de la adenda.

| Campo | Valor |
|---|---|
| Proyecto Supabase | `yiczgdtirrkdvohdquzf` (PRODUCCIÓN) |
| `cash_movements` | 1423 |
| `cash_sessions` | 167 |
| `cash_cierres_dia` | 17 |
| Último movimiento | `2026-07-22 05:32:30.1232+00` |

> 🔒 **Evidencia de no-escritura.** `count(*)` de las 3 tablas ANTES y DESPUÉS de la corrida:
> `cash_movements` 1423 → 1423 · `cash_sessions` 167 → 167 · `cash_cierres_dia` 17 → 17 — **idénticos ✅**.
> El canal rechazó la escritura de prueba con: `{"message":"Failed to run sql query: ERROR: 25006: cannot execute CREATE TABLE in a read-only transaction\n"}`

---

---

## 1 · Corrida anclada, día por día

> **READ-ONLY sobre PRODUCCIÓN**, con el mismo doble opt-in que el T0-B: ref clavado en el código
> **y** `T0_PROD_FIRMADO`. Antes de leer un solo dato, el canal rechazó una escritura de prueba.

| Campo | Valor |
|---|---|
| Proyecto | `yiczgdtirrkdvohdquzf` (PRODUCCIÓN) |
| `cash_movements` | 1423 |
| `cash_cierres_dia` | 17 |
| Pares de cierres completos consecutivos | 14 |
| ✅ Reproducen | **4 de 14** |
| Conteos antes → después | 1423→1423 · 167→167 · 17→17 **idénticos ✅** |

| Ancla (d−1) | Día d | Gap | Esperado | Contado | Dif. recon. | Dif. sellada | Residuo | Diagnóstico |  |
|---|---|---|---|---|---|---|---|---|---|
| `2026-06-01` | `2026-06-02` | 1d | ₡ 1.210.403,00 | ₡ 1.298.043,00 | ₡ 87.640,00 | −₡ 0,47 | **₡ 87.640,47** | `invisible-al-modelo` | 🔴 |
| `2026-06-02` | `2026-06-03` | 1d | ₡ 1.183.400,00 | ₡ 1.328.624,00 | ₡ 145.224,00 | −₡ 1,47 | **₡ 145.225,47** | `invisible-al-modelo` | 🔴 |
| `2026-06-03` | `2026-06-04` | 1d | ₡ 1.299.730,00 | ₡ 1.333.991,00 | ₡ 34.261,00 | −₡ 0,47 | **₡ 34.261,47** | `invisible-al-modelo` | 🔴 |
| `2026-06-04` | `2026-06-05` | 1d | ₡ 1.202.949,70 | ₡ 1.378.033,00 | ₡ 175.083,30 | −₡ 0,47 | **₡ 175.083,77** | `invisible-al-modelo` | 🔴 |
| `2026-06-05` | `2026-06-06` | 1d | ₡ 1.403.964,00 | ₡ 1.466.463,00 | ₡ 62.499,00 | −₡ 1,47 | **₡ 62.500,47** | `invisible-al-modelo` | 🔴 |
| `2026-06-06` | `2026-06-28` | 22d | ₡ 1.361.635,00 | ₡ 1.456.300,00 | ₡ 94.665,00 | −₡ 265,47 | **₡ 94.930,47** | `invisible-al-modelo` | 🔴 |
| `2026-06-28` | `2026-06-29` | 1d | ₡ 1.599.000,00 | ₡ 1.605.000,00 | ₡ 6.000,00 | ₡ 5.734,53 | **₡ 265,47** | `reproduce` | ✅ |
| `2026-06-29` | `2026-07-07` | 8d | ₡ 376.723,00 | ₡ 725.000,00 | ₡ 348.277,00 | −₡ 5.402,00 | **₡ 353.679,00** | `hueco-en-la-cadena` | 🔴 |
| `2026-07-07` | `2026-07-09` | 2d | ₡ 386.012,00 | ₡ 386.500,00 | ₡ 488,00 | −₡ 2.512,00 | **₡ 3.000,00** | `hueco-en-la-cadena` | 🔴 |
| `2026-07-09` | `2026-07-10` | 1d | ₡ 375.199,00 | ₡ 375.200,00 | ₡ 1,00 | ₡ 1,00 | **₡ 0,00** | `reproduce` | ✅ |
| `2026-07-10` | `2026-07-18` | 8d | ₡ 812.749,93 | ₡ 946.475,00 | ₡ 133.725,07 | ₡ 58.737,07 | **₡ 74.988,00** | `hueco-en-la-cadena` | 🔴 |
| `2026-07-18` | `2026-07-19` | 1d | ₡ 899.438,19 | ₡ 902.158,00 | ₡ 2.719,81 | −₡ 0,19 | **₡ 2.720,00** | `sin-diagnostico` | 🔴 |
| `2026-07-19` | `2026-07-20` | 1d | ₡ 817.913,00 | ₡ 815.450,00 | −₡ 2.463,00 | −₡ 1.983,19 | **−₡ 479,81** | `reproduce` | ✅ |
| `2026-07-20` | `2026-07-21` | 1d | ₡ 744.570,00 | ₡ 744.575,00 | ₡ 5,00 | ₡ 5,00 | **₡ 0,00** | `reproduce` | ✅ |

---

## 2 · Pregunta 1 — el SOBRANTE del `2026-07-18` (₡ 58.737,07)

### 2.1 · El replay reproduce el número sellado

Se recalculó `deberia` con la MISMA fórmula de `CashCierre.tsx`, usando `saldoCajaFuerte` (la función
real) sobre el ledger **tal como estaba al sellar** (`created_at ≤` el del cierre). Con el ledger de HOY
da otro número — la misma fragilidad de orden que apareció en staging.

| Componente | Fórmula | Monto |
|---|---|---|
| `ef_real_m` | ventas efectivo mediodía (BRUTAS) | ₡ 6.858,00 |
| `propinas_m` | propinas selladas de la fase 1 | −₡ 0,00 |
| **`netoM`** | `ef_real_m − propinas_m` | **₡ 6.858,00** |
| `ef_real_n` | ventas efectivo noche (BRUTAS) | ₡ 53,00 |
| `propinas_n` | propinas selladas de la fase 2 | −₡ 70.106,07 |
| `otros_n` | retiro de dueños | −₡ 0,00 |
| **`netoN`** | `ef_real_n − propinas_n − otros_n` | **−₡ 70.053,07** |
| `saldoBase` | `saldoCajaFuerte` al sellar (1376 de 1423 filas existían) | ₡ 950.933,00 |
| **`deberia`** | `saldoBase + netoM + netoN` | **₡ 887.737,93** |
| `contado` | `sep_diaria + sep_registradora + remanente` | ₡ 946.475,00 |
| **Diferencia recalculada** | `contado − deberia` | **₡ 58.737,07** |
| Diferencia sellada | lo que guardó el cierre | ₡ 58.737,07 |
| **¿Reproduce?** |  | **✅ sí, al céntimo** |

### 2.2 · El `Ventas cierre` negativo no es un error: es `netoN`

`recordCierreSales` postea el **neto** de cada fase. Con ventas de noche de ₡ 53,00 y
₡ 70.106,07 de propinas pagadas ese día, el neto da negativo — y es exactamente lo que hay
en el ledger:

| Pierna | Esperado (`neto`) | En el ledger | ¿Coincide? |
|---|---|---|---|
| Mediodía | ₡ 6.858,00 | ₡ 6.858,00 | ✅ |
| Noche | −₡ 70.053,07 | −₡ 70.053,07 | ✅ |

### 2.3 · De dónde sale el sobrante, colón por colón

**Dónde estaban esas propinas** — y qué ve de ellas el modelo actual:

| id | caja_origen | método | monto | Aporte a `saldoCajaFuerte` | descripción |
|---|---|---|---|---|---|
| `4eb6a0f4` | **`Registradora`** | Efectivo | ₡ 57.420,00 | ₡ 0,00 | Propinas turno 2026-07-18 Noche |
| `b7285789` | **`Registradora`** | Efectivo | ₡ 12.686,07 | ₡ 0,00 | Propinas turno 2026-07-18 Mediodía |

Suman ₡ 70.106,07 y su aporte al ledger de Caja Fuerte es **₡ 0,00**:
salieron de otra caja, así que `saldoCajaFuerte` **no las ve**. Pero `deberia` **sí las resta**, vía
`propinas_n`. La cuenta cierra así:

```
sobrante sellado          ₡ 58.737,07
− propinas restadas       ₡ 70.106,07
= residuo por debajo      −₡ 11.369,00
```

**El sobrante de ₡ 58.737,07 es la resta de las propinas (₡ 70.106,07) menos un faltante
real de ₡ 11.369,00 que queda escondido debajo.**

> **Por qué las propinas inflan el sobrante.** La venta de noche se registró como ₡ 53,00
> mientras ese mismo día se pagaron ₡ 70.106,07 de propinas desde la `Registradora`. Una venta
> nocturna de ese tamaño no es plausible: lo compatible con los números es que la cifra cargada **ya
> venía neta** de las propinas pagadas con la plata de la caja. Si fue así, el cierre las restó **una
> segunda vez**, que es justo el doble conteo que el rediseño tiene que cerrar. Ojo con el alcance: lo
> que los datos prueban es la aritmética; qué se tecleó como "venta bruta" no queda registrado en ningún
> lado, así que esa parte es la lectura más compatible, no un hecho verificable.

> 🔴 **Residuo NO-EXPLICADO: ₡ 11.369,00.** Aun neutralizando las propinas queda ese
> faltante. Ese día salió de las cajas físicas, además de las propinas, ₡ 0,00 en
> 0 movimiento(s) de efectivo: **no hay ningún movimiento que pueda cubrirlo**. Queda declarado, no forzado.

### 2.4 · El par anclado deja ₡ 74.988,00 — se abre el período

El par `2026-07-10` → `2026-07-18` arrastra un hueco de **8 días** y deja un residuo
de ₡ 74.988,00. Éste es el período completo, movimiento por movimiento, con lo que cada fila
aporta al pozo (`excluido` = ya contabilizado por un campo sellado del cierre):

| Fecha | id | tipo | caja_origen | método | subcategoría | monto | Aporte al pozo | clase | descripción |
|---|---|---|---|---|---|---|---|---|---|
| `2026-07-11` | `0c2a58a5` | `egreso_personal` | `Registradora` | Efectivo | Propinas por turno | ₡ 17.514,00 | −₡ 17.514,00 | `egreso` | Propinas turno 2026-07-14 Mediodía |
| `2026-07-11` | `c9545d5a` | `egreso_personal` | `Registradora` | Efectivo | Propinas por turno | ₡ 51.475,00 | −₡ 51.475,00 | `egreso` | Propinas turno 2026-07-14 Noche |
| `2026-07-11` | `0dc4579f` | `egreso_mercaderia` | `Banco` | Transferencia | Proveedor mercadería | ₡ 59.165,39 | — | `fuera` | Compra de alimentos · fact 2026-07-11 |
| `2026-07-11` | `0c5d8403` | `egreso_mercaderia` | `Banco` | Transferencia | Proveedor mercadería | ₡ 179.537,40 | — | `fuera` | Compra de alimentos y bebidas · fact 2026-07-11 |
| `2026-07-11` | `1ab54519` | `egreso_mercaderia` | `Banco` | Transferencia | Proveedor mercadería | ₡ 9.632,41 | — | `fuera` | Compra de frutas y vegetales · fact 2026-07-11 |
| `2026-07-11` | `1212d6ee` | `egreso_mercaderia` | `Caja Proveedores` | Efectivo | Proveedor mercadería | ₡ 2.500,00 | −₡ 2.500,00 | `egreso` | Delivery por Lafise · fact 2026-07-11 |
| `2026-07-11` | `be6e7f3c` | `egreso_mercaderia` | `Banco` | Transferencia | Proveedor mercadería | ₡ 75.063,00 | — | `fuera` | Satori · fact 2026-04-11 |
| `2026-07-11` | `cf1ef684` | `egreso_personal` | `Registradora` | Efectivo | Propinas por turno | ₡ 3.500,00 | −₡ 3.500,00 | `egreso` | Propinas turno 2026-07-15 Mediodía |
| `2026-07-18` | `4eb6a0f4` | `egreso_personal` | `Registradora` | Efectivo | Propinas por turno | ₡ 57.420,00 | — | `excluido` | Propinas turno 2026-07-18 Noche |
| `2026-07-18` | `700f2b58` | `traspaso` | `Caja Fuerte` | Transferencia | Banco → Caja Fuerte | ₡ 563.734,00 | ₡ 563.734,00 | `traspaso-entra-de-banco` | Ingreso de Banco → Caja Fuerte |
| `2026-07-18` | `7f630fc5` | `traspaso` | `Caja Fuerte` | Transferencia | Caja Fuerte → Banco | ₡ 0,00 | — | `traspaso-sale-a-banco` | Retiro Caja Fuerte → Banco |
| `2026-07-18` | `8e5a35a2` | `traspaso` | `Caja Fuerte` | Transferencia | Banco → Caja Fuerte | ₡ 12.000,00 | ₡ 12.000,00 | `traspaso-entra-de-banco` | Ingreso de Banco → Caja Fuerte |
| `2026-07-18` | `b7285789` | `egreso_personal` | `Registradora` | Efectivo | Propinas por turno | ₡ 12.686,07 | — | `excluido` | Propinas turno 2026-07-18 Mediodía |
| `2026-07-18` | `ac818c71` | `egreso_mercaderia` | `Banco` | Transferencia | Proveedor mercadería | ₡ 26.717,26 | — | `fuera` | N 13929 · fact 2025-01-18 |
| `2026-07-18` | `c805c88a` | `egreso_mercaderia` | `Banco` | Transferencia | Proveedor mercadería | ₡ 89.234,00 | — | `fuera` | 8260 · fact 2026-07-18 |
| `2026-07-18` | `e5ee5ec8` | `egreso_mercaderia` | `Banco` | Transferencia | Proveedor mercadería | ₡ 10.000,00 | — | `fuera` | N6676 · fact 2026-07-18 |
| `2026-07-18` | `cedfada9` | `egreso_mercaderia` | `Banco` | Transferencia | Proveedor mercadería | ₡ 76.903,81 | — | `fuera` | 3773 · fact 2026-07-17 |
| `2026-07-18` | `291660ec` | `ingreso` | `Caja Fuerte` | Efectivo | Ventas cierre | ₡ 6.858,00 | — | `excluido` | Ventas efectivo Mediodía 2026-07-18 |
| `2026-07-18` | `a5eb3057` | `ingreso` | `Caja Fuerte` | Efectivo | Ventas cierre | −₡ 70.053,07 | — | `excluido` | Ventas efectivo Noche 2026-07-18 |
| `2026-07-18` | `65e77c8c` | `ingreso` | `Caja Fuerte` | Efectivo | Ajuste de cierre | ₡ 58.737,07 | — | `excluido` | Ajuste de cierre 2026-07-18 · Sobrante · no encuentro el motivo de ese faltante pero en el resumen da con 15 de ajuste |

| Comprobación | Monto |
|---|---|
| Residuo del par anclado | **₡ 74.988,00** |
| Efectivo que SALIÓ de cajas físicas en el período (4 movimientos) | **₡ 74.989,00** |
| **Residuo − ese efectivo** | **−₡ 1,00** |
| ¿Cierra? | **✅ sí** — queda −₡ 1,00, dentro de ₡ 500,00 |

> ✅ **La aritmética cierra.** El residuo de ₡ 74.988,00 es —al céntimo salvo ₡ 1,00— el efectivo que salió de las cajas físicas durante los 8 días sin cerrar: ₡ 74.989,00 en 4 movimientos. Esa plata se fue, pero **el conteo del día del cierre no la refleja**: como no hubo cierre en los días del medio, ningún campo sellado la registró y el ancla ya no alcanza.

---

## 3 · Pregunta 2 — por qué el "hueco 2" no se comporta igual todos los días

La hipótesis a contrastar era: *depende de si la plata del fondo estaba dentro del pool*. Los datos la
**refinan**: lo que decide no es dónde estaba la plata, sino **por qué canal `deberia` ya la había
descontado**. Hay tres, y una misma fila puede pegarle a dos:

1. **El ledger de Caja Fuerte** — solo si `caja_origen = Caja Fuerte`. `saldoCajaFuerte` ignora
   `Caja Proveedores` y `Registradora` por completo.
2. **Los campos sellados `propinas_m/n`** — restan la propina *aunque haya salido de otra caja*.
3. **Ninguno** — la plata sale de una caja física y `deberia` ni se entera.

Si todo ese efectivo salió del pool contado, el cierre tendría que haber mostrado exactamente:

```
difEsperada = −(efectivo que salió) + (lo que bajó por el ledger) + (lo que bajó por propinas selladas)
```

| Día | Efectivo que salió | Vía ledger CF | Vía propinas selladas | Doble conteo | Invisible | Dif. sellada | Vista por día: esperada / brecha | Vista ANCLADA: contado − esperado / residuo | ¿El pozo reconstruye el conteo? |
|---|---|---|---|---|---|---|---|---|---|
| `2026-07-09` | ₡ 92.650,00 | ₡ 0,00 | ₡ 89.650,00 | — | ₡ 3.000,00 | −₡ 2.512,00 | −₡ 3.000,00 / **₡ 488,00** | ₡ 488,00 / **₡ 3.000,00** | ✅ sí |
| `2026-07-20` | ₡ 123.480,00 | ₡ 57.480,00 | ₡ 66.480,00 | ⚠️ ₡ 57.480,00 | ₡ 57.000,00 | −₡ 1.983,19 | ₡ 480,00 / **−₡ 2.463,19** | −₡ 2.463,00 / **−₡ 479,81** | 🔴 no |
| `2026-07-21` | ₡ 79.370,00 | ₡ 45.520,00 | ₡ 33.850,00 | — | ₡ 0,00 | ₡ 5,00 | ₡ 0,00 / **₡ 5,00** | ₡ 5,00 / **₡ 0,00** | ✅ sí |

**2 de 3 días quedan explicados mecánicamente** dentro de ₡ 500,00.

### 3.1 · El flujo del fondo: cómo se recarga `Caja Proveedores`

La hipótesis apunta al fondo, así que hay que mirarle las dos puntas: **de dónde sale** el efectivo
con el que se paga (el `sep_diaria` que el cierre anterior apartó del conteo) y **cómo se recarga**
(¿queda asentado como ingreso a `Caja Proveedores`?).

| Día | Cierre anterior | `sep_diaria` apartado | Ingresos al fondo ESE día | Ingresos en el período | Egresos del fondo ese día | Última recarga asentada |
|---|---|---|---|---|---|---|
| `2026-07-09` | `2026-07-07` | ₡ 10.000,00 | **₡ 0,00 · ninguno** | **₡ 0,00 · ninguno** | ₡ 92.650,00 (2) | `2026-05-27` (₡ 10.000,00) — hace **43 días** |
| `2026-07-20` | `2026-07-19` | ₡ 100.000,00 | **₡ 0,00 · ninguno** | **₡ 0,00 · ninguno** | ₡ 66.000,00 (2) | `2026-05-27` (₡ 10.000,00) — hace **54 días** |
| `2026-07-21` | `2026-07-20` | ₡ 100.000,00 | **₡ 0,00 · ninguno** | **₡ 0,00 · ninguno** | — | `2026-05-27` (₡ 10.000,00) — hace **55 días** |

> 🚩 **El fondo se recarga sin dejar rastro en el ledger.** En los tres días el cierre anterior apartó
> ₡ 10.000,00–₡ 100.000,00 como
> "Caja Diaria mañana" —o sea que el fondo **sí está dentro del conteo físico**— pero **no hay un solo
> ingreso a `Caja Proveedores` registrado** en ninguno de esos días ni en sus períodos. La última recarga
> asentada es de hace 43 días o más.
>
> Es decir: el fondo se rellena cada noche apartando efectivo del conteo (`sep_diaria`), no mediante un
> movimiento. Para `saldoCajaFuerte` esa recarga **no existe**, y los pagos que salen de él tampoco.

### 3.2 · `2026-07-09` — explicado

| id | caja_origen | subcategoría | monto | Vía ledger CF | ¿Doble conteo? | descripción |
|---|---|---|---|---|---|---|
| `c8039183` | **`Caja Proveedores`** | Propinas por turno | ₡ 89.650,00 | −₡ 0,00 | no | Propinas turno 2026-07-09 Noche |
| `780e4647` | **`Caja Proveedores`** | Operativo | ₡ 3.000,00 | −₡ 0,00 | no | DELIVERY X LAFISE · fact 2026-07-09 |

> ✅ Salieron ₡ 92.650,00 de efectivo y `deberia` ya había descontado ₡ 89.650,00.
> **El pozo reconstruye el conteo físico**: contado − esperado = ₡ 488,00, dentro de
> ₡ 500,00. El cierre selló −₡ 2.512,00, así que los dos modelos difieren en
> ₡ 3.000,00 — **y esa diferencia no es error del pozo: es lo que el modelo actual no puede ver.**

### 3.3 · `2026-07-20` — 🔴 NO-EXPLICADO

| id | caja_origen | subcategoría | monto | Vía ledger CF | ¿Doble conteo? | descripción |
|---|---|---|---|---|---|---|
| `46dafc79` | **`Caja Proveedores`** | Operativo | ₡ 60.000,00 | −₡ 0,00 | no | 1776 · fact 2026-07-20 |
| `da0cc07e` | **`Caja Fuerte`** | Propinas por turno | ₡ 57.480,00 | ₡ 57.480,00 | ⚠️ sí | Propinas turno 2026-07-20 Noche |
| `f064604b` | **`Caja Proveedores`** | Operativo | ₡ 6.000,00 | −₡ 0,00 | no | 1778 · fact 2026-07-20 |

> 🔴 **NO-EXPLICADO.** Vista anclada: contado − esperado = −₡ 2.463,00, residuo −₡ 479,81. Vista por día: esperado ₡ 480,00, sellado −₡ 1.983,19, brecha −₡ 2.463,19. Este día además arrastra ₡ 57.480,00 restados DOS veces: una propina cargada en `Caja Fuerte` baja el ledger Y encima está en `propinas_m/n`.
> No se fuerza una conclusión: el número queda a la vista para contrastarlo con el comprobante físico.

### 3.4 · `2026-07-21` — explicado

| id | caja_origen | subcategoría | monto | Vía ledger CF | ¿Doble conteo? | descripción |
|---|---|---|---|---|---|---|
| `3557084b` | **`Caja Fuerte`** | Proveedor mercadería | ₡ 45.520,00 | ₡ 45.520,00 | no | 4188 · fact 2026-07-21 |
| `636c8aef` | **`Registradora`** | Propinas por turno | ₡ 27.850,00 | −₡ 0,00 | no | Propinas turno 2026-07-21 Noche |
| `a9455e94` | **`Registradora`** | Propinas por turno | ₡ 6.000,00 | −₡ 0,00 | no | Propinas turno 2026-07-21 Mediodía |

> ✅ Salieron ₡ 79.370,00 de efectivo y `deberia` ya había descontado ₡ 79.370,00.
> **El pozo reconstruye el conteo físico**: contado − esperado = ₡ 5,00, dentro de
> ₡ 500,00. El cierre selló ₡ 5,00, así que los dos modelos difieren en
> ₡ 0,00 — **y esa diferencia no es error del pozo: es lo que el modelo actual no puede ver.**

### 3.5 · Veredicto sobre la hipótesis

**La hipótesis, como estaba formulada, queda REFUTADA — y los datos la reemplazan por algo más útil.**

No es que el fondo esté "dentro o fuera del pool". §3.1 lo muestra sin ambigüedad: el fondo **siempre**
está dentro del pool contado (se aparta cada noche como `sep_diaria`) y **nunca** está dentro del ledger
(cero ingresos a `Caja Proveedores` en 43–55 días). Esas dos cosas son fijas los tres días, así que no
pueden explicar por qué unos días cuadran y otros no.

Lo que sí cambia de un día a otro es **por cuántos de los tres canales se enteró `deberia`**:

- `2026-07-09` — salieron ₡ 92.650,00 en efectivo; `deberia` los descontó por: ledger CF ₡ 0,00 · propinas selladas ₡ 89.650,00; quedaron **₡ 3.000,00 invisibles**. El pozo reconstruye el conteo con ₡ 488,00 ✅ y difiere del cierre en ₡ 3.000,00. El faltante apareció casi entero.
- `2026-07-21` — salieron ₡ 79.370,00 en efectivo; `deberia` los descontó por: ledger CF ₡ 45.520,00 · propinas selladas ₡ 33.850,00; quedaron **₡ 0,00 invisibles**. El pozo reconstruye el conteo con ₡ 5,00 ✅ y difiere del cierre en ₡ 0,00. **Caso Ronny:** recategorizar el pago a `Caja Fuerte` no "arregló" la plata — la hizo visible para el único canal que el cierre mira, y por eso el día cuadra.
- `2026-07-20` — salieron ₡ 123.480,00 en efectivo; `deberia` los descontó por: ledger CF ₡ 57.480,00 · propinas selladas ₡ 66.480,00 (⚠️ ₡ 57.480,00 contados por AMBOS canales); quedaron **₡ 57.000,00 invisibles**. El pozo reconstruye el conteo con −₡ 2.463,00 🔴 y difiere del cierre en −₡ 479,81. Los dos efectos se cruzan: plata invisible por un lado y restada dos veces por el otro.

**El matiz que importa:** el pozo reconstruye el conteo físico en 2 de los 3 días con par anclado; el que no —`2026-07-20` (−₡ 2.463,00)— queda declarado y no se maquilla. En los que sí, el cierre se desvía justo por lo que no puede ver. La no-uniformidad no está en la plata
ni en el fondo: está en **cuál de los tres canales llegó a enterarse**, que depende de en qué caja se
tecleó el movimiento y de si además era una propina.

**Para el rediseño:** mientras el "debería" se calcule sobre UNA caja y las propinas se resten por un
canal aparte, el mismo hecho físico —sacar efectivo de la casa— da resultados distintos según dónde se
cargó, y a veces resta dos veces. El pozo elimina la pregunta: las tres cajas físicas suman al mismo
saldo y cada salida resta exactamente una vez.
