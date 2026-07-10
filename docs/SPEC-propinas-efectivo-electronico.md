# SPEC — Propinas: efectivo vs electrónico (la cuenta por pagar es SOLO lo electrónico)

> **Estado: 🖊️ FIRMADO · ✅ EN STAGING (validado en piso 2026-07-09).** Satori Sushi Bar · módulo Propinas + Caja.
> Rama de implementación: `feat/propinas-efectivo-electronico` **mergeada a `staging`** (`2a0852e`).
> Migración: `046_pool_barra_electronico.sql` — **aplicada a STAGING out-of-band (2026-07-09, Management API;
> `schema_migrations` intacto)**. **Pendiente: aplicar a PROD** (ref `yiczgdtirrkdvohdquzf`, con firma, post-ventana).

---

## 1. Problema / decisión

Hoy, al cerrar un turno de Propinas, la app calcula el *take-home* de cada empleado sobre el
pool COMPLETO (efectivo + electrónico) y genera en Caja una **cuenta por pagar** ("Propinas por
pagar") por ese total. Pero el **efectivo** de las propinas **ya está físicamente en mano del
equipo** — el salonero/encargado lo reparte en el momento. Registrar una cuenta por pagar por el
efectivo crea un pasivo fantasma: plata que nunca va a "salir" de la caja porque nunca entró.

**Decisión firmada:** la cuenta por pagar de propinas se genera **SOLO por la porción
electrónica** (datáfono / SINPE / tarjeta). El **efectivo se lo quedan los empleados** y **NUNCA**
genera movimiento ni pendiente. El *take-home* por empleado (lo que se muestra y se guarda como
`payout_crc`) **no cambia**: sigue siendo el reparto del pool completo.

En una línea: **cambia el MONTO de la cuenta por pagar, no la matemática del reparto.**

---

## 2. Modelo de datos

### Reinterpretación (sin migrar datos)
- `tip_entries.tip_amount_crc` / `tip_amount_usd` (por empleado) = **propina ELECTRÓNICA**
  individual capturada por el salonero (datáfono/SINPE). Es lo que antes se llamaba "datáfono".
- `tip_sessions.pool_efectivo_crc` / `pool_efectivo_usd` = efectivo del pool general (ya en mano
  del equipo). **Informativo** para la cuenta por pagar.
- `tip_sessions.pool_barra_crc` = **barra EFECTIVO** (ya en mano de la barra).

### Columna nueva (migración 046)
- `tip_sessions.pool_barra_electronico_crc numeric NOT NULL DEFAULT 0` = **barra ELECTRÓNICA**.

> **Sin cambios retroactivos.** Todo turno viejo tiene `pool_barra_electronico_crc = 0` (default):
> su `pool_barra_crc` histórico se interpreta como efectivo, nada se backfillea.

---

## 3. Fórmula del payable (función pura NUEVA, fuera del sagrado)

```
total_electronico_crc
  = Σ tip_amount_crc                     (electrónico ₡ por empleado)
  + Σ tip_amount_usd × exchange_rate     (electrónico $ por empleado, a colones)
  + pool_barra_electronico_crc           (barra electrónica del turno)
```

Vive en `src/shared/api/tips.ts` (`totalElectronicoCrc(entries, exchange_rate,
pool_barra_electronico_crc)` + `summarizeTipPayouts(rows)`), **NO** en `tipCalculations.ts`
(sagrado, intocable).

El efectivo (`pool_efectivo_*`, `pool_barra_crc`) **no entra** en el payable.

---

## 4. Cambios por capa

### 4.1 Migración — `supabase/migrations/046_pool_barra_electronico.sql`
`ALTER TABLE tip_sessions ADD COLUMN IF NOT EXISTS pool_barra_electronico_crc numeric NOT NULL
DEFAULT 0`. Idempotente. **NO se aplica** a ninguna base desde esta rama (db push FRENADO por la
reconciliación del ledger). La aplica el dueño a STAGING (ref `hwiatgicyyqyezqwldia`) con el ritual.
Tipos TS actualizados a mano en `supabase.gen.ts` + `database.ts` (patrón de las columnas `pool_*`).

### 4.2 API — `src/shared/api/tips.ts`
- `TipPayoutSummary` suma `total_electronico_crc` (se conserva `total_payout_crc` para display).
- `getTipPayoutsSince`: trae también `exchange_rate`, `pool_barra_electronico_crc` y
  `tip_amount_crc/usd` de las entries; calcula `total_electronico_crc`; el filtro
  `total_payout_crc > 0` pasa a **`total_electronico_crc > 0`** (un turno solo-efectivo desaparece
  de "Propinas por pagar").
- `createTipSession` / `updateSessionPools` incluyen `pool_barra_electronico_crc`.

### 4.3 Payable — `src/modules/cash/propinaPago.ts`
- `propinaEgresoFields`: `amount_crc = total_electronico_crc`. **Misma** `propKey`, **misma**
  subcategoría `'Propinas por turno'`, **mismo** `caja_origen` `Registradora`, **mismo** método.
  La convención del movimiento NO cambia; solo el monto.

### 4.4 UI Propinas — `TipsModule.tsx` + edición en `TipHistory.tsx`
- Etiquetas por empleado: "Propina/Datáfono ₡/$" → **"Electrónico ₡" / "Electrónico $"**.
- Pool Barra: **DOS inputs** — "Barra efectivo ₡" (`pool_barra_crc`) y "Barra electrónico ₡"
  (`pool_barra_electronico_crc`). A `calcTurno` se le pasa **LA SUMA** de ambos (la firma de
  `calcTurno` **NO cambia**).
- Cierre del turno: el confirm muestra **3 números** — Total asignado · Efectivo ya en mano del
  equipo (informativo) · Electrónico a entregar por el encargado. Se cumple:
  `Total asignado = Efectivo en mano + Electrónico a entregar`.

### 4.5 Caja — `CashTurno.tsx` + `CashCierre.tsx`
"Propinas por pagar" muestra y paga `total_electronico_crc`. `propinasPorPagarDe` /
`propinasPagadasEnFecha` con la MISMA lógica (operan sobre movimientos reales).

### 4.6 Reportes — `ResumenDiario/Semanal`, `ReporteMensual`, `TipHistory/Stats/Quincenal`
La línea "propinas" SIGUE sumando el **TOTAL (ef + elec)**. Donde se suman los pools se agrega la
columna nueva (`+ pool_barra_electronico_crc`); donde `calcHistory` recomputa el reparto, el caller
pasa `pool_barra_crc + pool_barra_electronico_crc`. **Sin cambios de fórmula.**

---

## 5. Identidad del cierre (se preserva sola)

`recordCierreSales` ingresa a Caja Fuerte el **NETO de propinas PAGADAS** por fase. Como el monto
pagado ahora es el **electrónico**, la identidad queda exacta sin tocar esa plomería.

Al **editar** un turno cerrado, `reconcilePropinaEgreso` ajusta el movimiento al nuevo
`total_electronico_crc` (no al payout completo) — así el egreso sigue siendo la porción electrónica.

---

## 6. GUARDRAILS (no negociables)

- `tipCalculations.ts` **BYTE-IDÉNTICO** (git diff vacío). `cashUtils.ts`, `computeTotals`,
  `posFiscal` intactos.
- Sin cambios retroactivos (`pool_barra_electronico_crc` default 0, nada se backfillea).
- NO tocar `main`, NO tocar prod, NO aplicar migraciones.

---

## 7. Tests / gates

- `propinaPago.test.ts`: turno solo-efectivo → payable 0 y fuera de la lista; turno mixto →
  payable = Σ electrónico exacto (₡ + $×TC + barra elec); barra ef+elec → solo elec cuenta.
- Test que fija que `calcTurno` da el mismo `take_home` por empleado con los mismos inputs
  (efectivo + electrónico sumados vs. un único pool barra equivalente).
- `VITE_APP_ENV=production npm run build` → EXIT 0 (NUNCA `tsc --noEmit`, es falso verde).
- Suite completa verde (vitest).
