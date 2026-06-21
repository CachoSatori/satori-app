# RCA (solo-lectura) — Fechas de fin de período inválidas → 400 de Supabase en reportes

> Investigación SIN tocar código/datos/esquema. Rama: `staging`. Fecha: 2026-06-20.
> Síntoma (dueña, prod, Mac + Lenovo): pantallas de reportes con rango de fechas dan **400**; la URL
> termina en `…session_date=lte.2026-06-31` (y en un caso `…-31T23:59:59Z`). **El 31 de junio no existe**
> (junio = 30 días) → Postgres/PostgREST rechaza la fecha inválida con **400** → pantalla sin datos /
> "timeout de red" / estado vacío.

## Causa raíz (única, repetida)
Varios lugares arman el límite SUPERIOR del mes **concatenando `-31` a `YYYY-MM`** (o `${ym}-31T23:59:59Z`),
asumiendo que todo mes tiene 31 días. Para meses de 30 días (**abr, jun, sep, nov**) y **febrero** (28/29)
la fecha resultante es **inexistente** → 400. El patrón usa `.lte(...)` (≤ último día) con un "último día"
hardcodeado en 31.

---

## Lugares afectados (archivo:línea · pantalla · causa · ¿PLATA?)

### 🔴 BUGS confirmados (producen fecha inválida → 400 en meses ≤30 días y febrero)

1. **`src/pages/HomePage.tsx:214`** — `.lte('session_date', curMonth + '-31')`
   - Pantalla: **Inicio / dashboard** (tarjeta de % de meta del mes; query a `ventas_dias`).
   - Causa: `curMonth` = `YYYY-MM` del mes actual → `2026-06-31`. Corre **al entrar a la app** (landing).
   - **PLATA**: sí (ventas vs meta). Alta visibilidad — es la pantalla de inicio.
   - **Nota clave:** este es el candidato más probable de lo que la dueña vio "en Propinas → Quincenal":
     el dashboard de Inicio dispara esta query al cargar y su 400 aparece como toast/estado de error; las
     pantallas de Propinas (Quincenal/Estadísticas) **no** arman ninguna fecha `-31` por su cuenta (ver abajo).

2. **`src/modules/resumen/ReporteMensual.tsx:77`** — `.lte('session_date', `${ym}-31`)`
   - Pantalla: **Resumen → Reporte Mensual** (ventas del mes; `ventas_dias`).
   - Causa: `ym` = `YYYY-MM` seleccionado → `…-31`.
   - **PLATA**: sí (ventas del mes).

3. **`src/modules/resumen/ReporteMensual.tsx:119`** — `.lte('created_at', `${ym}-31T23:59:59Z`)`
   - Pantalla: **Resumen → Reporte Mensual** (movimientos de caja del mes; `cash_movements`).
   - Causa: `ym` + `-31T23:59:59Z` → timestamp inválido. (Es el caso "`-31T23:59:59Z`" del síntoma.)
   - **PLATA**: sí — consulta el **ledger de caja** (dinero). **Es el de mayor riesgo** (ver más abajo).

4. **`src/modules/inventario/InvFoodCost.tsx:56`** — `const from = `${ym}-01`, to = `${ym}-31`` →
   usado en **:60** y **:64** como `.gte('created_at', `${from}T00:00:00Z`).lte('created_at', `${to}T23:59:59Z`)`
   - Pantalla: **Inventario → Food Cost** (costo de mercadería del mes; `cash_movements` / inventario).
   - Causa: `to = ${ym}-31` → dos queries de rango con timestamp inválido.
   - **PLATA**: sí (food cost = costo/margen).

### 🟡 Mismo "patrón de string de fecha" pero SIN 400 (revisar igual)

5. **`src/shared/api/finance.ts:136,139`** — `to = `${year}-12-31``; `.lte('session_date', to)` y
   `.lte('created_at', `${to}T23:59:59Z`)`
   - Pantalla: **P&L / Finanzas** (`getLiveActuals` — ventas + cash_movements del año).
   - **NO produce 400**: diciembre **sí** tiene 31 días, así que `2026-12-31` es válido. Pero es el **mismo
     pendiente ya flaggeado de "P&L borde de año"**: el rango está en **UTC** (`T00:00:00Z`…`T23:59:59Z`),
     no en hora CR, así que un movimiento del **31-dic de noche (CR)** cae en `+6h` = `1-ene` UTC y queda
     **fuera del año** (o un 1-ene CR de madrugada entra al año anterior). Es la **misma familia** (límite de
     período armado a mano) con **otro modo de falla** (mala atribución de borde, no 400). **PLATA**: sí.

### ✅ Revisados y LIMPIOS (no tienen el bug — para que nadie pierda tiempo buscándolo acá)
- **Propinas → Quincenal** (`src/modules/tips/TipQuincenal.tsx`): filtra **en memoria**
  (`sessions.filter(s => s.session_date.startsWith(month))`) y parte Q1/Q2 con
  `Number(session_date.slice(8,10)) ≤/>15` — **robusto, sin `-31`**.
- **Propinas → Estadísticas** y el loader (`getAttendanceHistory`, `getTipSessions`, `getTipEntriesBySession`
  en `src/shared/api/tips.ts`): usan solo `.gte('session_date', …)` (límite inferior) o consulta **por id** —
  **sin límite superior `-31`**.
- **Resumen Semanal** (`src/modules/resumen/ResumenSemanal.tsx`): el `to` se computa por aritmética de
  semana (lunes + N días sobre un `Date`) → fecha válida, sin `-31`.
- **`cash.ts`** (`getPreviousCierre` `.lt('session_date', beforeDate)`, `discardDiaCompleto` `.lt('created_at',
  `${nextStr}T06:00:00Z`)` con `nextStr` = día siguiente vía `setUTCDate(+1)`) → patrón correcto (límite =
  inicio del período siguiente con `<`). **Ya hacen lo que proponemos abajo.**

---

## ¿Cuál es el de mayor riesgo?
**`ReporteMensual.tsx:119`** (Resumen → Reporte Mensual, query a `cash_movements`): es un **reporte de PLATA**
que consulta el **ledger de caja** y **se rompe en TODO mes de 30 días y en febrero** — justo cuando se revisa
el cierre del mes. Falla silenciosa (queda vacío / "timeout"), y el mes afectado es el más común de auditar.
Segundo en criticidad: `HomePage.tsx:214` por **visibilidad** (rompe la pantalla de inicio para todos).

---

## Patrón de arreglo ÚNICO y robusto (propuesta; NO implementado acá)
**Reemplazar `≤ últimoDía` por `< primer-día-del-período-siguiente`.** Así el límite **no depende de cuántos
días tiene el mes** (ni de bisiestos), y maneja el cruce de año solo.

Para un mes `ym = "YYYY-MM"` (mes **1-based** en el string):
```ts
const [y, m] = ym.split('-').map(Number)
// Date.UTC usa mes 0-based → (y, m, 1) = primer día del mes SIGUIENTE (m=12 → enero del año que viene)
const nextFirst = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)   // "YYYY-MM-01" del mes siguiente

// fechas planas (session_date):
.gte('session_date', `${ym}-01`).lt('session_date', nextFirst)

// timestamps (created_at):
.gte('created_at', `${ym}-01T00:00:00Z`).lt('created_at', `${nextFirst}T00:00:00Z`)
```
Reglas:
- Siempre `.lt(primerDíaSiguiente)`, nunca `.lte(últimoDía)`.
- Nunca concatenar un día hardcodeado (`-31`, `-30`). Si se quiere el último día real, ya existe
  `daysInMonth(ym)` en `src/shared/utils/index.ts` y `src/modules/ventas/ventasUtils.ts` — pero el `< primer-día-
  siguiente` es preferible (sin off-by-one, sirve igual para fechas planas y timestamps).
- **Quincena** (si en el futuro se consulta por rango, no en memoria): Q1 = `>= ${ym}-01` y `< ${ym}-16`;
  Q2 = `>= ${ym}-16` y `< ${nextFirst}`.
- **Borde de AÑO / P&L (#5):** el `< primer-día-siguiente` ya evita cualquier `-31`; para cerrar el pendiente
  de atribución, además convendría construir los límites en **hora CR** (mismo `dateCR`/criterio ya usado en
  Movimientos/Pendientes/finance del mes) en vez de `…Z` UTC. Eso es una mejora aparte, no necesaria para el 400.

> Un único helper compartido (ej. `monthRange(ym)` → `{ gte, lt }`) aplicado en los 4 lugares 🔴 + el #5
> elimina la familia entera de bugs y deja un solo punto de verdad. (Implementación = otra tarea.)

## Resumen para el handoff
- **4 lugares con bug de 400** (`-31`): HomePage:214, ReporteMensual:77, ReporteMensual:119, InvFoodCost:56.
- **1 lugar relacionado sin 400** (finance.ts:139, P&L borde de año = pendiente UTC ya conocido).
- **Mayor riesgo:** ReporteMensual:119 (PLATA, ledger de caja, falla todo mes de 30 días + febrero).
- **Propinas/Quincenal/Stats están limpios**: el 400 que se ve "en Propinas" es, con alta probabilidad, la
  query del **dashboard de Inicio** (HomePage:214) que corre al entrar.
- **Arreglo único:** `< primer-día-del-mes-siguiente` (no depende de los días del mes). NO implementado.
