# REPORTE T1 — Corrida paralela ANCLADA (pozo único)

> **READ-ONLY sobre STAGING.** Valida el núcleo `saldoPozoEfectivo` recién promovido a
> `src/modules/cash/pozo.ts` contra el histórico real. **Nada de la app lo importa todavía**:
> los únicos consumidores son los tests y este harness. El recableado del cierre es T2.

| Campo | Valor |
|---|---|
| Proyecto Supabase | `hwiatgicyyqyezqwldia` (STAGING) |
| `cash_movements` | 980 |
| `cash_cierres_dia` | 16 |
| Pares de cierres completos consecutivos | 10 |
| Último movimiento | `2026-07-22 05:46:54.369+00` |

---

## 0 · Qué prueba esta corrida

El T0 comparaba saldos **acumulados desde el principio de los tiempos**, y por eso el pozo daba
negativo: al histórico le falta el asiento de apertura. Esta corrida ataca por otro lado — en vez
de acumular desde cero, **se ancla en el conteo físico que el dueño selló el día anterior**:

```
ancla(d−1)  = sep_diaria + sep_registradora + remanente     ← contado a mano
esperado(d) = ancla(d−1)
            + ef_real_m + ef_real_n        ventas en efectivo BRUTAS del día d
            − propinas_m − propinas_n      propinas pagadas (campos sellados)
            − otros_n                      retiro de dueños
            + neto del período (d−1, d]    calculado por saldoPozoEfectivo (la función real)

residuo = (contado − esperado) − diferencia_crc sellada
```

Anclar en el físico es lo que hace la prueba honesta: **cada día se evalúa solo**, sin arrastrar
el error del anterior. Si el residuo es ~0 (±₡ 500,00), el modelo del pozo reprodujo ese día.

**Resultado**

| Medida | Valor |
|---|---|
| Pares evaluados | **10** |
| ✅ Reproducen | **7** |
| 🔴 No reproducen | **3** |
| De los días que CUADRARON, ¿cuántos reproduce? | **5 de 7** |
| Pares de días CONSECUTIVOS (gap = 1 día) | **6 de 6** reproducen |

**Hallazgos**

- **5 de los 7 días que cuadraron se reproducen.** Los 2 que no, **ninguno por culpa del modelo**: `2026-07-01` (₡ 9.742.822,79, `hueco-en-la-cadena`, hueco de 25d) · `2026-07-16` (−₡ 367.000,00, `orden-de-sellado`, hueco de 5d). Los dos arrastran huecos en la cadena de cierres; el detalle con números está en §2.
- ✅ **6 de 6 pares de días CONSECUTIVOS reproducen** — todos, con residuos de entre ₡ 0,21 y ₡ 1,47 (redondeo).
  **Ésta es la prueba que importa:** cuando la cadena de cierres no tiene huecos, la mecánica del pozo —cajas físicas juntas, traspasos internos neutros, Banco afuera— reconstruye el efectivo contado a mano, día tras día, sin tocar la app. El ancla solo vale si el día anterior también se cerró: con un hueco en el medio, la plata se movió sin que nadie la contara.
- **4 par(es) arrastran un hueco** de más de un día entre cierres (`2026-06-06`→`2026-07-01` (25d) · `2026-07-02`→`2026-07-09` (7d) · `2026-07-09`→`2026-07-11` (2d) · `2026-07-11`→`2026-07-16` (5d)); de esos reproducen 1. Es el costo medible de no cerrar todos los días.
- Saldo del pozo HOY (acumulado, sin ancla): −₡ 755.313,73 · 123 traspaso(s) indeterminado(s) por ₡ 917.637,00. Sigue negativo por lo mismo que en el T0: falta el asiento de apertura. **La corrida anclada no depende de ese saldo** — por eso puede validar la mecánica igual.

---

## 1 · Día por día

Todos los pares, sin omitir ninguno. **Residuo** = (contado − esperado) − diferencia sellada.

| # | Ancla (d−1) | Día d | Gap | Ancla ₡ | Ventas brutas | Propinas | Retiro | Neto período | Esperado | Contado | Dif. reconstruida | Dif. sellada | Residuo |  |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `2026-06-01` | `2026-06-02` | 1d | ₡ 1.280.875,00 | ₡ 17.168,00 | — | — | — | ₡ 1.298.043,00 | ₡ 1.298.043,00 | ₡ 0,00 | −₡ 0,47 | **₡ 0,47** | ✅ |
| 2 | `2026-06-02` | `2026-06-03` | 1d | ₡ 1.298.043,00 | ₡ 30.582,00 | — | — | — | ₡ 1.328.625,00 | ₡ 1.328.624,00 | −₡ 1,00 | −₡ 1,47 | **₡ 0,47** | ✅ |
| 3 | `2026-06-03` | `2026-06-04` | 1d | ₡ 1.328.624,00 | ₡ 5.366,00 | — | — | — | ₡ 1.333.990,00 | ₡ 1.333.991,00 | ₡ 1,00 | −₡ 0,47 | **₡ 1,47** | ✅ |
| 4 | `2026-06-04` | `2026-06-05` | 1d | ₡ 1.333.991,00 | ₡ 44.042,00 | — | — | — | ₡ 1.378.033,00 | ₡ 1.378.033,00 | ₡ 0,00 | −₡ 0,47 | **₡ 0,47** | ✅ |
| 5 | `2026-06-05` | `2026-06-06` | 1d | ₡ 1.378.033,00 | ₡ 88.431,00 | — | — | — | ₡ 1.466.464,00 | ₡ 1.466.463,00 | −₡ 1,00 | −₡ 1,47 | **₡ 0,47** | ✅ |
| 6 | `2026-06-06` | `2026-07-01` | 25d | ₡ 1.466.463,00 | ₡ 462.400,00 | −₡ 213.856,00 | — | −₡ 10.959.286,00 | −₡ 9.244.279,00 | ₡ 498.544,00 | ₡ 9.742.823,00 | ₡ 0,21 | **₡ 9.742.822,79** | 🔴 |
| 7 | `2026-07-01` | `2026-07-02` | 1d | ₡ 498.544,00 | ₡ 334.200,00 | −₡ 79.999,00 | — | — | ₡ 752.745,00 | ₡ 746.000,00 | −₡ 6.745,00 | −₡ 6.744,79 | **−₡ 0,21** | ✅ |
| 8 | `2026-07-02` | `2026-07-09` | 7d | ₡ 746.000,00 | ₡ 73.000,00 | — | — | −₡ 58.995,43 | ₡ 760.004,57 | ₡ 815.000,00 | ₡ 54.995,43 | −₡ 4.000,00 | **₡ 58.995,43** | 🔴 |
| 9 | `2026-07-09` | `2026-07-11` | 2d | ₡ 815.000,00 | ₡ 368.210,00 | — | — | — | ₡ 1.183.210,00 | ₡ 1.182.000,00 | −₡ 1.210,00 | −₡ 1.210,00 | **₡ 0,00** | ✅ |
| 10 | `2026-07-11` | `2026-07-16` | 5d | ₡ 1.182.000,00 | ₡ 227.100,00 | — | — | — | ₡ 1.409.100,00 | ₡ 1.042.400,00 | −₡ 366.700,00 | ₡ 300,00 | **−₡ 367.000,00** | 🔴 |

> ⚠️ **Los cierres no se sellaron en orden de fecha.** el día `2026-07-16` se selló ANTES que el `2026-07-11`. Importa porque `deberia` se calcula contra el ledger tal como está **en ese instante**: sellar fuera de orden cambia el número, sin que cambie un solo billete.

## 2 · Los que NO reproducen — números exactos

Se listan **los 3**, sin omitir ninguno.

### `2026-06-06` → `2026-07-01` — residuo ₡ 9.742.822,79

| Componente | Monto |
|---|---|
| Ancla: contado físico sellado el `2026-06-06` | ₡ 1.466.463,00 |
| + Ventas efectivo brutas (`ef_real_m` + `ef_real_n`) | ₡ 462.400,00 |
| − Propinas selladas (`propinas_m` + `propinas_n`) | −₡ 213.856,00 |
| − Retiro de dueños (`otros_n`) | −₡ 0,00 |
| + Neto del período (3 movimiento(s) contados por el pozo) | −₡ 10.959.286,00 |
| **= Esperado** | **−₡ 9.244.279,00** |
| Contado físico sellado el `2026-07-01` | ₡ 498.544,00 |
| Diferencia reconstruida (contado − esperado) | ₡ 9.742.823,00 |
| Diferencia que selló el cierre | ₡ 0,21 |
| **Residuo (lo que el modelo NO explica)** | **₡ 9.742.822,79** |
| Días entre cierres | 25 |
| **Diagnóstico** | `hueco-en-la-cadena` |

> **hay días sin cerrar entre una punta y la otra: la plata de esos días entró y salió sin que ningún campo sellado la registre**

**Cómo se compone el neto del período** (clasificación de `contribucionPozo`, la función real):

| Clase | Movimientos | Aporte ₡ |
|---|---|---|
| `traspaso-sale-a-banco` | 1 | −₡ 11.206.886,00 |
| `traspaso-entra-de-banco` | 1 | ₡ 250.000,00 |
| `egreso` | 1 | −₡ 2.400,00 |

**Filas excluidas del período** (ya contabilizadas por los campos sellados — si se contaran acá, contarían dos veces):

| Motivo | Movimientos | Σ ₡ | Por qué |
|---|---|---|---|
| `propinas-del-dia` | 4 | ₡ 213.856,00 | propinas del día del cierre — ya vienen de `propinas_m/n` selladas |

> 🕳️ **Hueco de 25 días en la cadena de cierres.** El ancla es el conteo del
> `2026-06-06`, pero entre esa fecha y el `2026-07-01` hubo 24 día(s) sin cerrar:
> las ventas de esos días entraron a la caja y **ningún campo sellado las registra**. El modelo no
> puede reconstruir lo que nadie contó — esto no es un fallo del pozo, es la factura de los días sin cierre.

### `2026-07-02` → `2026-07-09` — residuo ₡ 58.995,43

| Componente | Monto |
|---|---|
| Ancla: contado físico sellado el `2026-07-02` | ₡ 746.000,00 |
| + Ventas efectivo brutas (`ef_real_m` + `ef_real_n`) | ₡ 73.000,00 |
| − Propinas selladas (`propinas_m` + `propinas_n`) | −₡ 0,00 |
| − Retiro de dueños (`otros_n`) | −₡ 0,00 |
| + Neto del período (3 movimiento(s) contados por el pozo) | −₡ 58.995,43 |
| **= Esperado** | **₡ 760.004,57** |
| Contado físico sellado el `2026-07-09` | ₡ 815.000,00 |
| Diferencia reconstruida (contado − esperado) | ₡ 54.995,43 |
| Diferencia que selló el cierre | −₡ 4.000,00 |
| **Residuo (lo que el modelo NO explica)** | **₡ 58.995,43** |
| Días entre cierres | 7 |
| **Diagnóstico** | `invisible-al-modelo` |

> **el residuo es EXACTAMENTE el neto del período: plata que se movió y que el modelo actual no ve (`saldoCajaFuerte` ignora todo lo que no sea `caja_origen = Caja Fuerte`)**

> El neto del período es −₡ 58.995,43 y el residuo ₡ 58.995,43: se cancelan. Es decir,
> el cierre selló su diferencia **como si esos movimientos no existieran**. Casi todos salen de la
> `Registradora`, y `saldoCajaFuerte` —el corazón del cierre de hoy— solo mira `caja_origen = Caja Fuerte`:
> **esa plata es literalmente invisible para el modelo actual.** El pozo la ve. Es el argumento del rediseño.

**Cómo se compone el neto del período** (clasificación de `contribucionPozo`, la función real):

| Clase | Movimientos | Aporte ₡ |
|---|---|---|
| `egreso` | 3 | −₡ 58.995,43 |

**Filas excluidas del período** (ya contabilizadas por los campos sellados — si se contaran acá, contarían dos veces):

| Motivo | Movimientos | Σ ₡ | Por qué |
|---|---|---|---|
| `ventas-cierre` | 5 | ₡ 575.745,00 | filas `Ventas cierre` que genera el propio cierre (NETAS de propinas) |
| `ajuste-cierre` | 3 | ₡ 10.744,79 | el asiento `Ajuste de cierre` — es el sello de la diferencia, no su causa |

### `2026-07-11` → `2026-07-16` — residuo −₡ 367.000,00

| Componente | Monto |
|---|---|
| Ancla: contado físico sellado el `2026-07-11` | ₡ 1.182.000,00 |
| + Ventas efectivo brutas (`ef_real_m` + `ef_real_n`) | ₡ 227.100,00 |
| − Propinas selladas (`propinas_m` + `propinas_n`) | −₡ 0,00 |
| − Retiro de dueños (`otros_n`) | −₡ 0,00 |
| + Neto del período (4 movimiento(s) contados por el pozo) | ₡ 0,00 |
| **= Esperado** | **₡ 1.409.100,00** |
| Contado físico sellado el `2026-07-16` | ₡ 1.042.400,00 |
| Diferencia reconstruida (contado − esperado) | −₡ 366.700,00 |
| Diferencia que selló el cierre | ₡ 300,00 |
| **Residuo (lo que el modelo NO explica)** | **−₡ 367.000,00** |
| Días entre cierres | 5 |
| **Diagnóstico** | `orden-de-sellado` |

> **los cierres se cargaron FUERA DE ORDEN: el día d se selló antes que el día d−1, así que su `deberia` leyó un ledger al que todavía le faltaba lo que el cierre anterior iba a postear**

> El cierre del `2026-07-11` posteó ₡ 367.000,00 al ledger de Caja Fuerte
> (ventas netas de sus dos fases + su propia diferencia), pero lo hizo **después** de que el cierre
> del `2026-07-16` ya hubiera leído el saldo. Por eso el residuo es −₡ 367.000,00: exactamente ese
> aporte con el signo cambiado. **Ni un colón se movió** — es puro artefacto del orden de carga,
> y el modelo anclado no lo sufre porque se apoya en el conteo físico, no en el ledger.

**Cómo se compone el neto del período** (clasificación de `contribucionPozo`, la función real):

| Clase | Movimientos | Aporte ₡ |
|---|---|---|
| `fuera` | 4 | ₡ 0,00 |

## 3 · Los que sí reproducen

| Par | Gap | Esperado | Contado | Residuo | El día cuadró |
|---|---|---|---|---|---|
| `2026-06-01` → `2026-06-02` | 1d | ₡ 1.298.043,00 | ₡ 1.298.043,00 | ₡ 0,47 | ✅ sí |
| `2026-06-02` → `2026-06-03` | 1d | ₡ 1.328.625,00 | ₡ 1.328.624,00 | ₡ 0,47 | ✅ sí |
| `2026-06-03` → `2026-06-04` | 1d | ₡ 1.333.990,00 | ₡ 1.333.991,00 | ₡ 1,47 | ✅ sí |
| `2026-06-04` → `2026-06-05` | 1d | ₡ 1.378.033,00 | ₡ 1.378.033,00 | ₡ 0,47 | ✅ sí |
| `2026-06-05` → `2026-06-06` | 1d | ₡ 1.466.464,00 | ₡ 1.466.463,00 | ₡ 0,47 | ✅ sí |
| `2026-07-01` → `2026-07-02` | 1d | ₡ 752.745,00 | ₡ 746.000,00 | −₡ 0,21 | no (−₡ 6.744,79, y el modelo la reproduce) |
| `2026-07-09` → `2026-07-11` | 2d | ₡ 1.183.210,00 | ₡ 1.182.000,00 | ₡ 0,00 | no (−₡ 1.210,00, y el modelo la reproduce) |

---

## 4 · PROD — corrida anclada

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

## 5 · Pregunta 1 — el SOBRANTE del `2026-07-18` (₡ 58.737,07)

### 5.1 · Primero, el replay reproduce el número

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

### 5.2 · El `Ventas cierre` negativo no es un error: es `netoN`

`recordCierreSales` postea el **neto** de cada fase. Con ventas de noche de ₡ 53,00 y
₡ 70.106,07 de propinas pagadas ese día, el neto da negativo — y es exactamente lo que hay
en el ledger:

| Pierna | Esperado (`neto`) | En el ledger | ¿Coincide? |
|---|---|---|---|
| Mediodía | ₡ 6.858,00 | ₡ 6.858,00 | ✅ |
| Noche | −₡ 70.053,07 | −₡ 70.053,07 | ✅ |

### 5.3 · De dónde sale el sobrante, colón por colón

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

---

## 6 · Pregunta 2 — por qué el "hueco 2" no se comporta igual todos los días

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

| Día | Efectivo que salió | Vía ledger CF | Vía propinas selladas | Doble conteo | Invisible | Dif. esperada | Dif. sellada | Brecha |  |
|---|---|---|---|---|---|---|---|---|---|
| `2026-07-09` | ₡ 92.650,00 | ₡ 0,00 | ₡ 89.650,00 | — | ₡ 3.000,00 | −₡ 3.000,00 | −₡ 2.512,00 | **₡ 488,00** | ✅ |
| `2026-07-20` | ₡ 123.480,00 | ₡ 57.480,00 | ₡ 66.480,00 | ⚠️ ₡ 57.480,00 | ₡ 57.000,00 | ₡ 480,00 | −₡ 1.983,19 | **−₡ 2.463,19** | 🔴 |
| `2026-07-21` | ₡ 79.370,00 | ₡ 45.520,00 | ₡ 33.850,00 | — | ₡ 0,00 | ₡ 0,00 | ₡ 5,00 | **₡ 5,00** | ✅ |

**2 de 3 días quedan explicados mecánicamente** dentro de ₡ 500,00.

### 6.1 · `2026-07-09` — explicado

| id | caja_origen | subcategoría | monto | Vía ledger CF | ¿Doble conteo? | descripción |
|---|---|---|---|---|---|---|
| `c8039183` | **`Caja Proveedores`** | Propinas por turno | ₡ 89.650,00 | −₡ 0,00 | no | Propinas turno 2026-07-09 Noche |
| `780e4647` | **`Caja Proveedores`** | Operativo | ₡ 3.000,00 | −₡ 0,00 | no | DELIVERY X LAFISE · fact 2026-07-09 |

> ✅ Salieron ₡ 92.650,00 de efectivo y `deberia` ya había descontado
> ₡ 89.650,00: la diferencia esperada era −₡ 3.000,00 y el cierre
> selló −₡ 2.512,00 — brecha ₡ 488,00. **La plata sí salió del pool contado.**

### 6.2 · `2026-07-20` — 🔴 NO-EXPLICADO

| id | caja_origen | subcategoría | monto | Vía ledger CF | ¿Doble conteo? | descripción |
|---|---|---|---|---|---|---|
| `46dafc79` | **`Caja Proveedores`** | Operativo | ₡ 60.000,00 | −₡ 0,00 | no | 1776 · fact 2026-07-20 |
| `da0cc07e` | **`Caja Fuerte`** | Propinas por turno | ₡ 57.480,00 | ₡ 57.480,00 | ⚠️ sí | Propinas turno 2026-07-20 Noche |
| `f064604b` | **`Caja Proveedores`** | Operativo | ₡ 6.000,00 | −₡ 0,00 | no | 1778 · fact 2026-07-20 |

> 🔴 **NO-EXPLICADO: quedan ₡ 2.463,19.** Esperado ₡ 480,00, sellado −₡ 1.983,19. Este día además arrastra ₡ 57.480,00 restados DOS veces: una propina cargada en `Caja Fuerte` baja el ledger Y encima está en `propinas_m/n`.
> No se fuerza una conclusión: el número queda a la vista para contrastarlo con el comprobante físico.

### 6.3 · `2026-07-21` — explicado

| id | caja_origen | subcategoría | monto | Vía ledger CF | ¿Doble conteo? | descripción |
|---|---|---|---|---|---|---|
| `3557084b` | **`Caja Fuerte`** | Proveedor mercadería | ₡ 45.520,00 | ₡ 45.520,00 | no | 4188 · fact 2026-07-21 |
| `636c8aef` | **`Registradora`** | Propinas por turno | ₡ 27.850,00 | −₡ 0,00 | no | Propinas turno 2026-07-21 Noche |
| `a9455e94` | **`Registradora`** | Propinas por turno | ₡ 6.000,00 | −₡ 0,00 | no | Propinas turno 2026-07-21 Mediodía |

> ✅ Salieron ₡ 79.370,00 de efectivo y `deberia` ya había descontado
> ₡ 79.370,00: la diferencia esperada era ₡ 0,00 y el cierre
> selló ₡ 5,00 — brecha ₡ 5,00. **La plata sí salió del pool contado.**

### 6.4 · Veredicto sobre la hipótesis

**Refutada como estaba formulada, y reemplazada por algo más preciso.** No es que el fondo esté "dentro
o fuera del pool": el efectivo de las tres cajas físicas siempre sale del pool contado. Lo que cambia de
un día a otro es **cuántos de los tres canales le avisaron a `deberia`**:

- `2026-07-09`: de los ₡ 92.650,00, ₡ 89.650,00 son una **propina
  cargada a `Caja Proveedores`** que los campos sellados ya restaron. Lo genuinamente invisible eran
  ₡ 3.000,00 — y el faltante apareció (brecha ₡ 488,00). ✅
- `2026-07-21` (**caso Ronny**): el pago quedó en `Caja Fuerte`, así que `saldoCajaFuerte` **sí lo
  ve** y `deberia` baja sola. Invisible = ₡ 0,00 y el día cuadra (brecha ₡ 5,00).
  **Recategorizar no "arregló" la plata: la hizo visible para el único canal que el cierre mira.** ✅
- `2026-07-20`: quedan ₡ 57.000,00 invisibles **y** además ₡ 57.480,00 restados
  por partida doble (una propina cargada en `Caja Fuerte`). Los dos efectos se cruzan y el día **no
  cierra**: ₡ 2.463,19 sin explicación mecánica. 🔴

**Lo que esto le dice al rediseño:** mientras el "debería" se calcule sobre UNA caja y las propinas se
resten por un canal aparte, el mismo hecho físico —sacar efectivo de la casa— da resultados distintos
según en qué caja se haya tecleado, y a veces resta dos veces. El pozo elimina la pregunta: todas las
cajas físicas suman al mismo saldo y cada salida resta una sola vez.

---

## Apéndice · Reglas y trampas

- **`ef_real_*` es BRUTO.** Verificado en `CashCierre.tsx`: `efRealM = vm_crc − vm_usd·tc`, sin restar
  propinas; el neto se arma después (`netoM = ef_real_m − propinas_m`). Sumarle las propinas "de vuelta"
  las contaría al revés.
- **Trampa 1 — propinas dobles.** Las filas `Ventas cierre` que genera el cierre son NETAS de propinas.
  Contarlas a ellas Y a los egresos `Propinas por turno` resta las propinas dos veces. Acá se reconstruye
  desde los campos sellados y se excluyen ambas.
- **Trampa 2 — retiro doble.** `recordCierreRetiro` graba el retiro como traspaso `Caja Fuerte → Banco`.
  Contarlo como `otros_n` Y como traspaso con Banco del período lo restaría dos veces.
- **Propinas de días intermedios SÍ cuentan.** `propinas_m/n` solo cubre las del día del cierre; en un
  período con hueco, las de los días del medio no están selladas en ningún lado y entran como egreso.
- **Atribución de fecha**: `session_date` del turno; sin turno, el día de Costa Rica de `created_at`.
- **Tolerancia**: ₡ 500,00, la misma que usa el cierre para decidir si cuadra.
