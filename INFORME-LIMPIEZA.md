# Informe de limpieza — 2026-06-27

Rama: `chore/limpieza-2026-06-27` (creada desde `origin/staging`).
Gate de calidad usado en cada lote: `VITE_APP_ENV=production npm run build` (typecheck real, `tsc -b`)
+ `npm run test` (vitest). **Estado final: verde** — build OK, 141/141 tests OK.

## TL;DR

El código está **muy limpio** de entrada. El proyecto ya compila con `noUnusedLocals` y
`noUnusedParameters` activos, así que **no existe** ningún import/variable local muerto que sobreviva al
build, **no hay `any`** en `src/` (fuera de tests), **no hay `console.log` de debug olvidados** (los de
`[rt-diag]` y el TICKET SIM son intencionales), ni código comentado obsoleto, ni `@ts-ignore`/`debugger`.

Lo único realmente eliminable y seguro fueron **exports/archivos exportados pero nunca importados** (que
`noUnusedLocals` no detecta) y **assets sin referencias**. Eso se ejecutó. El resto de hallazgos cae en
zona money-adjacent / sagrada / protegida (F4-borrado) o es de bajo valor, y se reporta acá.

---

## ✅ Ejecutado (commiteado en esta rama)

| Commit | Qué | Por qué seguro |
|---|---|---|
| `chore(limpieza): elimina código muerto no-money` | borra `src/shared/api/auth.ts` (archivo huérfano); quita `findCustomerByPhone` (crm.ts), `fmtPct`/`monthKey`/`metaDot` y el import muerto `fi as _fi` (ventasUtils.ts) | Cero referencias en todo `src` (1 sola aparición = la declaración). El auth real vive en `useAuth.tsx`, no en `api/auth.ts`. No es money. |
| `chore(limpieza): elimina assets sin referencias` | borra `src/assets/{hero.png,react.svg,vite.svg}` | No se importan ni se referencian en CSS/HTML. `react.svg`/`vite.svg` son restos del scaffold de Vite. Al no importarse, ni entraban al bundle. |

**Archivos modificados:** `src/shared/api/crm.ts`, `src/modules/ventas/ventasUtils.ts`
**Archivos eliminados:** `src/shared/api/auth.ts`, `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`

---

## 🔍 Detectado pero NO tocado (ranking valor / riesgo)

### 1. `InventoryStep.tsx` huérfano — ALTO valor / riesgo MEDIO (zona protegida)
- **Archivo:** `src/modules/inbox/InventoryStep.tsx` (90 líneas, componente `default`).
- **Qué:** no lo importa **nadie** (solo aparece en comentarios). Su última edición fue el commit de la
  unificación F3 ("cola de Revisión de inventario"). La lógica de mapeo se extrajo a
  `shared/api/inventoryIngest.ts` y el flujo vivo es Bandeja → `InvLineTable` → `InvRevision`.
- **Por qué quedaría más limpio:** 90 líneas de un componente superseded por la unificación.
- **Riesgo concreto:** cae de lleno en el **flujo F4/Bandeja→Revisión que el brief marca como "a medio
  estabilizar / no tocar"**. Probablemente seguro de borrar (no se importa, el build lo confirmaría),
  pero requiere tu OK explícito porque está en esa zona.
- **Recomendación:** confirmar que la Bandeja ya no lo renderiza y borrarlo en un commit aparte.

### 2. Exports muertos en archivos money-adjacent — MEDIO valor / riesgo MEDIO
Provablemente muertos (1 sola aparición en todo `src`), pero en archivos de plata/fiscal. **No los toqué**
por la regla money-adjacent → reportar. El build confirmaría que son seguros de quitar:

| Export | Archivo | Nota |
|---|---|---|
| `getCashMovements` | `src/shared/api/cash.ts` | `cash.ts` aloja `deleteCashMovement` (ruta de borrado protegida). El que se usa es `getAllCashMovements`, no este. |
| `getOrderPayments` | `src/shared/api/pos.ts` | pagos de orden (cobro). |
| `getFeDocumentosByOrder` | `src/shared/api/fe.ts` | factura electrónica. |
| `upsertActual` | `src/shared/api/finance.ts` | finanzas/P&L. |
| `updateTipSessionNotes`, `reopenTipSession` | `src/shared/api/tips.ts` | propinas (money). |

- **Recomendación:** quitarlas en un solo commit money-adjacent, corriendo el gate, **vos** o con tu visto.

### 3. Exports muertos en archivos SAGRADOS — NO tocar / riesgo ALTO
- `formatUSD` en `src/shared/utils/tipCalculations.ts` (sagrado)
- `CATEGORIAS_DEFAULT` en `src/modules/cash/cashUtils.ts` (sagrado)
- **Qué:** sin referencias hoy.
- **Riesgo:** son archivos de la lista intocable. Pueden ser API pública pensada a futuro. **Dejar como están.**

### 4. Tipos sin uso en `database.ts` — BAJO valor / riesgo BAJO (pero schema-doc)
- **Archivo:** `src/shared/types/database.ts`
- **Qué:** `ExchangeRate`, `VentasDia`, `VentasHist`, `VentasMeta`, `VentasComp`, `ProductMapRow` están
  definidas y exportadas pero no se importan en ningún lado.
- **Por qué no lo toqué:** son tipos de dominio que **espejan tablas reales** (varias de ventas/plata).
  El propio header del archivo dice "solo tipos de dominio que usa la app", así que técnicamente
  contradicen su propósito — pero sirven como documentación viva del esquema y son money/ventas-adjacent.
  Cero peso en runtime (solo tipos). Decisión tuya si valen como doc o se borran.

### 5. Tipos generados sin uso en `supabase.gen.ts` — NO tocar
- `TablesInsert`, `TablesUpdate`, `Enums`, `CompositeTypes` sin referencias directas.
- **Es un archivo GENERADO por Supabase.** No editar a mano; se regenera. Dejar como está.

### 6. Duplicación de formatters `fi` / `fip` — BAJO valor / riesgo MEDIO (money-adjacent)
- **Archivos:** `src/shared/utils/index.ts`, `src/modules/ventas/ventasUtils.ts`, `src/modules/cash/cashUtils.ts`
- **Qué:** la función `fi` (formato ₡) está definida **idéntica** (byte a byte) en `shared/utils` y en
  `ventasUtils`; `cashUtils` (sagrado) tiene la suya. `fip` también está duplicada entre `shared/utils` y
  `ventasUtils` (equivalentes).
- **Por qué quedaría más limpio:** una sola fuente de verdad del formato de moneda.
- **Por qué no lo toqué:** `ventasUtils.fi` la importan ~10 componentes de ventas; `cashUtils` es sagrado.
  La unificación (re-exportar desde `shared/utils`) es de comportamiento idéntico, pero toca superficie
  money/ventas y los autores la separaron a propósito. **Requiere tu criterio.**
- **Recomendación:** si se unifica, hacerlo solo para ventas (`ventasUtils` re-exporta `fi`/`fip` de
  `shared/utils`) y dejar `cashUtils` intacto.

### 7. `@types/dompurify` posiblemente redundante — BAJO valor / riesgo BAJO
- **package.json (devDependencies):** `@types/dompurify` ^3.0.5. DOMPurify 3.x **ya trae sus propios
  tipos**, así que el paquete `@types` suele ser innecesario (incluso puede chocar).
- **Por qué no lo toqué:** la regla pide **no** borrar deps que "parecen" sin uso; reportar.
- **Recomendación:** probar quitarlo y correr el build; si pasa, es peso muerto de dev.

### 8. Hallazgos de ESLint pre-existentes — fuera de alcance
`npm run lint` reporta ~74 errores, casi todos **pre-existentes** y de reglas de estilo/react-hooks que
**no** son código muerto y muchos tocan zona protegida:
- Params/vars con prefijo `_` (convención de "ignorar"): el build los acepta (TS exime nombres `_*`); no
  son código muerto, no tocar.
- `react-hooks/refs`, `react-hooks/set-state-in-effect`, `react-refresh/only-export-components`,
  `preserve-caught-error` en `cash.ts`, etc.: son patrones existentes; arreglarlos cambia lógica/estructura
  y/o toca `cash.ts`/`ManagerOverride.tsx`/`useAuth.tsx`/`useRealtimeRefetch.ts`. **No es limpieza de código
  muerto** — queda fuera de este pase.
- Excepción trivial y aislada: `no-useless-escape` en `xlsParser.ts:15` (`\-` dentro de un char class).
  Es money-adjacent (parser de ventas) y, aunque el cambio es equivalente, preferí no tocar el regex sin tu OK.

---

## 🗂️ Reorganización propuesta (NO ejecutada — rompe imports / base path Vite / precache PWA)

El layout actual `src/modules/<dominio>/` + `src/shared/` es coherente y no requiere reorg. Observaciones menores:

- `src/modules/ventas/ReporteMensual.tsx` **y** `src/modules/resumen/ReporteMensual.tsx` coexisten (mismo
  nombre, módulos distintos). No es bug, pero confunde al navegar. Si algún día se consolida "resumen vs
  ventas", unificar nombres. **No mover ahora** (rompe imports).
- `src/assets/` quedó vacío tras borrar los 3 assets — se puede eliminar el directorio, pero es cosmético.
- No proponer mover archivos entre carpetas: en este proyecto el `base` de Vite y el precache de la PWA
  dependen de rutas, y el build no avisaría de un import roto por string.

---

## 🔭 Recomendaciones para el próximo pase

1. **Confirmar y borrar `InventoryStep.tsx`** (ítem 1) una vez verificado que la Bandeja no lo usa — es el
   borrado de mayor valor pendiente.
2. **Barrido de exports muertos money-adjacent** (ítem 2) en un commit dedicado con gate, hecho por la dueña.
3. **Decidir destino de los tipos sin uso de `database.ts`** (ítem 4): doc viva o se borran.
4. **Unificar `fi`/`fip` de ventas** contra `shared/utils` (ítem 6), dejando `cashUtils` intacto.
5. Considerar agregar `argsIgnorePattern: '^_'` / `varsIgnorePattern: '^_'` a la config de ESLint para
   alinear ESLint con TS y bajar el ruido de los ~12 falsos positivos de `_`-prefijados.
6. Evaluar `knip` o `ts-prune` en CI para detectar exports muertos automáticamente (lo que acá se hizo a
   mano), ya que `noUnusedLocals` no cubre exports.
