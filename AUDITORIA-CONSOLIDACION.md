# Auditoría de consolidación — Satori App (2026-06-12, rama `consolidacion`)

> Auditoría de staff engineer sobre todo lo construido en estas semanas (caja, propinas, offline,
> PoS F1-F3, roles, comandero, KDS, cobro, splits, jerarquía). **FASE 1 = solo lectura**; la FASE 2
> ejecutó únicamente lo 🟢/🟡-bajo-riesgo con tests verdes tras cada cambio. Todo lo 🔴 queda como
> recomendación para decisión humana — **no se tocó**. (El `AUDITORIA.md` raíz es una auditoría
> ANTERIOR, del 5 jun, de otra rama — se conserva intacta.)

Gates del proyecto: `tsc -b` ✅ · `vitest` **93/93** ✅ · `npm run build` ✅. (ESLint NO es gate — §7.)

---

## 1. Riesgo de sobreescritura / condiciones de carrera  ⚠️ (lo que más preocupa a la dueña)

### 1.1 Outbox offline — 🟢 SÓLIDO (no tocar)
`src/shared/offline/outbox.ts`: replay en orden estricto por `seq`; idempotencia por
`client_op_id UNIQUE` (mig 021 → el duplicado rebota 23505 y se descarta); `retry` frena todo el
flush para no desordenar; lock multi-pestaña `navigator.locks('satori-outbox-flush', ifAvailable)`
+ guard `flushing` anti-reentrada; backoff 5s→60s. Bien diseñado, sin acción.

### 1.2 PoS — NO hay control de concurrencia optimista  🔴 (recomendación, NO arreglar sin acuerdo)
Las escrituras del PoS son last-write-wins; no hay `version`/`If-Match`. Casos reales con 2 tablets:
- **Doble cobro de la misma mesa** (`cobrarOrden`/`cobrarCheck`): el `UPDATE pos_orders … status='open'`
  es idempotente (la 2ª cierra 0 filas), **pero el `INSERT pos_payments` se ejecuta igual** → pueden
  quedar **2 filas de pago** para la misma mesa/check si dos cajas cobran a la vez. La mesa cierra una
  sola vez, pero el registro de pagos queda duplicado. **🔴** (toca dinero/auditoría).
  *Recomendación*: precondición server-side (`INSERT … WHERE NOT EXISTS`), UNIQUE parcial
  `pos_payments(check_id)`, o RPC transaccional. Cambia esquema → decisión humana.
- **Merge / reopen / setChecks multi-paso**: varias sentencias secuenciales desde el cliente, **no
  transacción**. Un corte entre pasos deja estado parcial. **🟡** *Recomendación*: envolver cada uno
  en una RPC `plpgsql` atómica.
- **Realtime + edición local**: `useRealtimeRefetch` dispara `load()` y reemplaza `items`. El modal
  abierto vive en su propio estado (no se pisa), pero la lista de fondo se refresca; un ítem que el
  otro dispositivo borró puede desaparecer bajo el modal. **🟡** *Recomendación*: pausar el refetch
  con un modal abierto (copiar el patrón `pauseWhileTyping` de Propinas).

### 1.3 Caja — 🟢 cubierto
`createCashMovement` genera `id`=`client_op_id` en cliente → replay idempotente; cierre online-only
(OFFLINE.md). Sin acción.

---

## 2. Archivos sobredimensionados  🟡

| Archivo | Antes | Ahora | Nota |
|---|---|---|---|
| `ComanderoModule.tsx` | 1406 | **1281** | FASE 2: 8 piezas hoja → `comanderoShared.tsx` (144). |
| `CashTurno.tsx` | 1391 | 1391 | Toca lógica de caja — no tocado. 🔴 recomendación. |
| `shared/api/pos.ts` | 753 | 753 | Aceptable; partible por dominio en el futuro. 🟢 |

**Recomendación (🟡, lista para ejecutar)**: seguir extrayendo de `ComanderoModule` los modales
autónomos (reciben props, sin closure del padre → mover es mecánico y `tsc` lo verifica):
`CheckoutModal` (~205), `SplitModal` (~130), `ItemPicker` (~140), `CuentaView` (~120),
`MergeModal`/`ReorderModal`/`TransferModal`/`ReabrirModal`. Llevaría el archivo a ~500 líneas.
No se ejecutó completo para acotar el riesgo a un único cambio verificado por sprint.

---

## 3. Parches / hacks / flakes  🟡🟢
- **Flake del harness E2E** (no es código de la app): el plano demo tiene nombres que colisionan
  ("Mesa 1" + "4 pax" ≈ "Mesa 14"); los smokes usaban force-click → mitigado con click por DOM
  exacto. No afecta producción. 🟢
- **`as unknown as SupabaseClient`** (`sb` en `pos.ts`): a propósito, porque las tablas 022-032 aún
  no están en los tipos generados. 🟡 *Recomendación*: regenerar `supabase.gen.ts` al pasar a prod.
- Comentarios "FIX/workaround" (155): casi todos son documentación de decisiones pasadas, no deuda. 🟢

---

## 4. Código muerto / duplicado  🟢
- `tsc` no reporta locales sin usar en los módulos nuevos → sin código muerto a nivel TS.
- ESLint `no-unused-vars` (10): 8 son nombres `_`/`_pm` intencionales; los 2 reales (`iva`/`serv`)
  están en módulos **legacy** sin cobertura → 🟡 no tocados.
- `buildMenu` (2 niveles) quedó `@deprecated` con sus tests; lo reemplaza `buildMenuTree`. Eliminar
  cuando no queden consumidores. 🟢

---

## 5. Peso y velocidad  🟢
- **Lazy-load YA implementado**: `App.tsx` carga los 20 módulos con `lazy()`. PoS/KDS/Admin NO entran
  en el arranque de caja. Sin acción.
- Bundle prod: `index` ~256KB; `recharts` (357KB) y `xlsx` (331KB) en chunks propios lazy (solo
  Ventas). `ComanderoModule` 62KB / `AdminModule` 73KB, ambos lazy. Reparto correcto. 🟢
- Re-renders: `tree`/`searchResults` memoizados; `computeTotals` por render es barato (una mesa).

---

## 6. Migraciones  🟢 (1 nota histórica)
Registradas en staging: 001-009, **0095** (discrepancia histórica conocida), 010-021, y **022-032
todas presentes y coherentes**. 🟡 *Recomendación*: al consolidar 022-032 para prod, revisar el item
`0095`/009 (cosmético, no bloquea).

---

## 7. Seguridad / tipos  🟢🟡
- **RLS** en todas las tablas nuevas (pos_*, menu_*, buckets) por rol vía `get_my_role()`. 🟢
- **TypeScript**: `0` `any` en el código nuevo. 🟢
- **ESLint NO es gate** y arroja 79 issues **pre-existentes**: destaca `react-hooks/rules-of-hooks`
  (6) en `MiRendimiento.tsx` (módulo viejo de ventas) — `useMemo` condicionales, **bug latente real**
  fuera de alcance. 🔴 *Recomendación*: arreglarlo en sprint propio con validación física. El resto
  (`set-state-in-effect`, `exhaustive-deps`) es ruido de un plugin más estricto; comportamiento OK.

---

## Resumen ejecutivo
- **Ejecutado (FASE 2, seguro)**: extracción de 8 piezas hoja del comandero (1406→1281 líneas en el
  archivo gigante; +`comanderoShared.tsx` 144). Sin cambio de comportamiento; tsc + 93 tests + build OK.
- **NO tocado (correcto)**: sagrados, lógica de plata, esquema, módulos legacy sin tests.
- **Top-3 para decisión humana**:
  1. 🔴 Doble-INSERT de pago en cobro concurrente de la misma mesa (UNIQUE/precondición server-side).
  2. 🔴 `rules-of-hooks` en `MiRendimiento.tsx` (bug latente del módulo viejo).
  3. 🟡 Atomicidad de merge/reopen (RPC transaccional) + pausar refetch con modal abierto.
