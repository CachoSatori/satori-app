# Handoff — Mi Rendimiento: "la casa del empleado"

**Rama:** `feat/mi-rendimiento-casa-empleado` (desde `staging`)
**Fecha:** 2026-07-17
**Alcance:** Etapa 1. Rehacer la sección del empleado como hub de rendimiento + propinas, **tema CLARO** (el de Caja), mobile-first. **SIN esquema, SIN migración** — solo display sobre datos que ya existen.

---

## Qué se construyó

Un único hub en `/mi-rendimiento` (roles: salonero, barman, barback, runner, cocina) con **filtro de período global** y 6 pestañas en tema claro:

| Pestaña | Contenido |
|---|---|
| **心 Resumen** | KPIs ricos del período (Ventas, PAX, Prom/PAX, Beb/PAX) con delta vs general y **% de meta** coloreado; detalle (Ratio C/B en ₡ y en unidades, Prom/Plato, Prom/Bebida, Ticket/item); **ranking del día** cuando el período es un solo día; top productos del período. |
| **📅 Por día** | Tarjetas por día de la semana (Prom/PAX, PAX prom, Beb/PAX, Ratio C/B), marca **★ mejor día**, **gráfico de barras** Prom/PAX por día, y **tabla comparativa yo vs restaurante**. |
| **🍱 Productos** | 3 bloques **General / Comidas / Bebidas** con **toggle ₡ / unidades** (clasifica por `ProductMap.tipo`). |
| **🗓️ Semana** | Vista de semanas calendario (actual + 4 previas) — se mantiene, es complementaria. |
| **¥ Propinas** | Integrada como pestaña. **Selector de mes** (‹ ›, salto directo e histórico clicable), **ICP + benchmark del equipo**, Q1/Q2 e histórico. |
| **🏆 Competencias** | Mis competencias activas (portado, re-tematizado a claro). |

- **Filtro de período GLOBAL** (Hoy · Esta semana · Este mes · Rango exacto) gobierna Resumen / Por día / Productos. **Reemplaza el fijo-60-días.** Default: *Este mes*.
- **Roles sin venta individual** (cocina/runner/barback, o sin match de nombre): el hub **arranca en Propinas** y las sub-vistas de ventas invitan a ir a esa pestaña.
- La ruta vieja `/mis-propinas` **redirige** a `/mi-rendimiento?tab=propinas` (no rompe cards del Home ni enlaces).

---

## El ICP: ahora "ICP electrónico" (propina GENERADA, no reparto)

La primera versión usaba `payout_crc` (el **reparto del pool**), que en un sistema pooled mide *take-home*, no eficiencia de propina. **Corregido:** el numerador del ICP es ahora la **propina electrónica GENERADA** por el empleado — `tip_amount_crc + tip_amount_usd × TC` —, que es el dato real que cada uno registra al lado de sus horas.

```
ICP electrónico = Σ (tip_amount_crc + tip_amount_usd×TC) del empleado / ventas del empleado × 100
Benchmark equipo = Σ generado electrónico del equipo / ventas del restaurante × 100
```

- **`payout_crc` (lo cobrado) se mantiene** para los KPIs de take-home ("Este mes", "Total cobrado") y la tabla/quincenal. **Son dos números distintos y ambos se muestran** — no se conflan.
- USD×TC con el TC de la sesión (`exchange_rate`), mismo patrón que `totalElectronicoCrc`. Todo null-safe (`tip_amount_*`/TC pueden venir 0/NULL).
- Copy en la UI aclara que es propina **electrónica** generada, distinta del reparto.
- Helpers puros nuevos y testeados: `electronicTipCrc`, `sumElectronicTips` (incluye caso USD).

### Follow-up (fuera de alcance de este cambio)
`src/modules/ventas/VentasICP.tsx` (el ICP del lado **owner/manager**) todavía usa `payout_crc` como numerador. Quedó **sin tocar** para respetar el alcance (solo Mi Rendimiento). Si se quiere consistencia, alinearlo a "generado electrónico" en un cambio aparte.

---

## Archivos

**Nuevos**
- `src/modules/ventas/miRendimientoUtils.ts` — lógica **pura y testeable**: `resolvePeriod`, `datesInPeriod`, `dowBreakdown` (yo-vs-resto por día de semana), `bestDowIndex`, `computeICP`/`icpVsTeam`, `shiftMonth`. Todo null-safe.
- `src/modules/ventas/miRendimientoUtils.test.ts` — 25 tests (períodos, día-de-semana, ICP, filtros, null-safe).
- `src/modules/ventas/MiRendimiento.render.test.tsx` — 9 tests de render (monta el hub, recorre las 6 pestañas, casos null-safe, arranque propinas-primero, perfil no vinculado).
- `HANDOFF-MI-RENDIMIENTO.md` (este archivo).

**Modificados**
- `src/modules/ventas/MiRendimiento.tsx` — reescrito: hub claro con período global + 6 pestañas. ICP electrónico (generado) + take-home (payout) separados.
- `src/modules/ventas/MiRendimientoWrap.tsx` — carga ventas (365d, antes 90d) **+ propinas** (empleado vinculado + asistencia 12m para el benchmark).
- `src/shared/api/tips.ts` — `getAttendanceHistory` trae `tip_amount_crc/usd` + `exchange_rate`; `AttendanceRow` extendido (aditivo, null-safe).
- `src/App.tsx` — `/mis-propinas` → redirect; quitado el import de `MisPropinas`.
- `src/index.css` — nueva sección `mr-*` (tema claro). **No modifica** ninguna clase existente (`.vt-*`, `.cd-*` intactas → Caja y Ventas sin tocar).

**Eliminado**
- `src/modules/tips/MisPropinas.tsx` — superseded por la pestaña integrada (solo lo referenciaba App.tsx).

---

## Verificación (todo en verde)

- **Sagrados diff VACÍO:** `tipCalculations.ts`, `computeTotals` (vive en `posFiscal.ts`), `cashUtils.ts`, `posFiscal.ts` — sin cambios.
- **Typecheck real** (`tsc -b`): EXIT 0.
- **Build producción** (`VITE_APP_ENV=production npm run build`): EXIT 0.
- **Suite completa** (sin env): **351 tests / 44 archivos** verde (incluye +40 nuevos: helpers puros + render smoke + ICP electrónico con caso USD).
- **ESLint** de los archivos tocados: EXIT 0.

## Pendiente para el review

- **QA visual en teléfono real** con sesión de empleado + datos reales (login requerido, no verificable sin credenciales). El render test cubre estructura y no-crash; falta la validación de "se ve y se siente" en dispositivo.
- Decidir si se alinea el **ICP de `VentasICP`** (owner/manager) a "generado electrónico" para consistencia (hoy usa `payout_crc`).
