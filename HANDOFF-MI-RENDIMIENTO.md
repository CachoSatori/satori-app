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

## ⚠️ Decisión que necesita tu visto bueno: el ICP

La referencia (satori-dashboard) define **ICP = propina_generada / ventas × 100**. Pero en esta app las propinas son un **pool que se reparte por puntos/horas**: **NO existe "propina generada" por persona**, solo lo **cobrado** (`payout_crc`).

Por eso el ICP se implementó como el único cálculo que los datos soportan:

```
ICP = propinas COBRADAS del período / ventas del empleado × 100
Benchmark equipo = Σ propinas del equipo / ventas del restaurante × 100
```

- "Mi ICP" y "Equipo (benchmark)" usan el **mismo mes**; ventas del empleado por el heurístico nombre↔empleado actual; ventas del equipo por `aggGeneral`.
- Es **read-only** sobre lo ya calculado (los sagrados no se tocan).
- Si preferís otra definición (p.ej. propina por hora, o ICP sobre venta bruta), es un cambio localizado en `computeICP`/`icpVsTeam` + la pestaña Propinas. **Confirmar antes de Etapa 2.**

---

## Archivos

**Nuevos**
- `src/modules/ventas/miRendimientoUtils.ts` — lógica **pura y testeable**: `resolvePeriod`, `datesInPeriod`, `dowBreakdown` (yo-vs-resto por día de semana), `bestDowIndex`, `computeICP`/`icpVsTeam`, `shiftMonth`. Todo null-safe.
- `src/modules/ventas/miRendimientoUtils.test.ts` — 25 tests (períodos, día-de-semana, ICP, filtros, null-safe).
- `src/modules/ventas/MiRendimiento.render.test.tsx` — 9 tests de render (monta el hub, recorre las 6 pestañas, casos null-safe, arranque propinas-primero, perfil no vinculado).
- `HANDOFF-MI-RENDIMIENTO.md` (este archivo).

**Modificados**
- `src/modules/ventas/MiRendimiento.tsx` — reescrito: hub claro con período global + 6 pestañas.
- `src/modules/ventas/MiRendimientoWrap.tsx` — carga ventas (365d, antes 90d) **+ propinas** (empleado vinculado + asistencia 12m para el benchmark).
- `src/App.tsx` — `/mis-propinas` → redirect; quitado el import de `MisPropinas`.
- `src/index.css` — nueva sección `mr-*` (tema claro). **No modifica** ninguna clase existente (`.vt-*`, `.cd-*` intactas → Caja y Ventas sin tocar).

**Eliminado**
- `src/modules/tips/MisPropinas.tsx` — superseded por la pestaña integrada (solo lo referenciaba App.tsx).

---

## Verificación (todo en verde)

- **Sagrados diff VACÍO:** `tipCalculations.ts`, `computeTotals` (vive en `posFiscal.ts`), `cashUtils.ts`, `posFiscal.ts` — sin cambios.
- **Typecheck real** (`tsc -b`): EXIT 0.
- **Build producción** (`VITE_APP_ENV=production npm run build`): EXIT 0.
- **Suite completa** (sin env): **345 tests / 44 archivos** verde (incluye +34 nuevos).
- **ESLint** de los archivos tocados: EXIT 0.

## Pendiente para el review

- **QA visual en teléfono real** con sesión de empleado + datos reales (login requerido, no verificable sin credenciales). El render test cubre estructura y no-crash; falta la validación de "se ve y se siente" en dispositivo.
- Confirmar la **definición del ICP** (arriba).
