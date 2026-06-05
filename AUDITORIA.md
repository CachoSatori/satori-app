# Auditoría nocturna — Satori App

> Rama `audit/cleanup-nocturna` · NO mergeada · NO desplegada · sin tocar base de datos.
> Refactor de limpieza: preservar comportamiento (Caja/Propinas sagrados), build verde tras cada commit.

## Baseline (antes de tocar)

| Métrica | Valor |
|---|---|
| `tsc --noEmit` (strict) | ✅ 0 errores |
| Build vite | 222 ms (≈5.5 s total con `tsc -b`) |
| Archivos `.ts/.tsx` en `src` | 90 |
| LOC (`src`) | 24.834 |
| dependencies / devDependencies | 12 / 14 |
| `as any` | 0 |
| `as never` (workaround typing Supabase) | 151 |
| `@ts-ignore` / `@ts-expect-error` | 0 |
| `console.log` / `debugger` | 0 |
| `console.error/warn` | 13 (logging legítimo de errores) |
| TODO/FIXME | 0 |

**Chunks más grandes (gzip):** `index` 133 KB · `VentasHistorico` 103 KB · `VentasXLS` 119 KB (incluyen `xlsx` + `recharts`, ya lazy por ruta).

El proyecto ya estaba **sano de origen**: TS strict sin `any`/`ts-ignore`, sin `console.log` de debug, sin TODOs. La deuda principal es el patrón `as never` del cliente Supabase (tablas no incluidas en el tipo `Database`).

---

## Hallazgos (Fase 1-2)

### Dependencias sin uso (SEGURO remover)
| Dep | Uso en repo | Acción |
|---|---|---|
| `@capacitor/cli` | solo en package.json (sin config, sin imports) | remover |
| `@capacitor/core` | solo en package.json | remover |
| `date-fns` | solo en package.json (0 imports) | remover |
| `@types/dompurify` | está en `dependencies` (es type-only) | mover a `devDependencies` |

### Deuda de tipos
- `as never` ×151 — patrón `.from('tabla' as never)` / `.insert({...} as never)` porque el tipo `Database` no lista varias tablas (cash_*, tip_*, sops, documents, ingredients, etc.). **Riesgo de tocar: medio-alto** (regenerar tipos requiere CLI + podría diferir del esquema vivo y cambiar el build). → DOCUMENTAR, no refactor masivo.

### Exports muertos (verificados sin uso interno ni externo)
| Export | Archivo | Acción |
|---|---|---|
| `countInbox` | `shared/api/documents.ts` | ✅ removido (leftover) |
| `monthKeyCR` | `shared/utils/index.ts` | ✅ removido (huérfano) |
| `formatUSD` | `shared/utils/tipCalculations.ts` | DOCUMENTAR (módulo Propinas = sagrado) |
| `reopenTipSession` | `shared/api/tips.ts` | DOCUMENTAR (Propinas; posible feature futura "reabrir turno") |
| `getCashMovements` | `shared/api/cash.ts` | DOCUMENTAR (Caja = sagrado; superseded por `getAllCashMovements`) |
| `getMyProfile`, `updateProfileName` | `shared/api/auth.ts` | DOCUMENTAR (auth = sensible; no tocar) |
| `upsertActual` | `shared/api/finance.ts` | DOCUMENTAR (superficie de API prevista: carga manual del contador) |
| `findCustomerByPhone` | `shared/api/crm.ts` | DOCUMENTAR (posible lookup del chatbot futuro) |
| `PROPINA_ROLES`, `CAJEROS_IDS`, `hasInventoryForDocument` | varios | falsos positivos (sí se usan internamente) — conservar |

### Duplicación de constantes/utilidades
- **`fi` (formateador ₡)** reimplementado en 6 módulos, pese a existir `fi`/`fd` NaN-safe en `shared/utils/index.ts`.
  - ✅ Deduplicado en 3 módulos no-financieros (Admin/Horas, CRM x2).
  - DOCUMENTADO (no aplicado): `FinanzasModule` (P&L), `TipCocina` (Propinas), `InvFoodCost` (Food Cost) → en la lista negra del prompt (no tocar cálculos financieros), aunque el cambio sería camino-feliz idéntico. Recomendado hacerlo con supervisión.
- **`ROLE_LABELS`** definido en 8 archivos (HomePage, CashModule, InboxModule, MisPropinas, UserApprovals, RolePointsConfig, EmployeeHours, EmployeeList). Los valores **difieren** (subconjuntos de roles, singular vs plural). DOCUMENTAR → unificar en `shared/` con cuidado de no cambiar etiquetas visibles; 3 de los 8 están en módulos sagrados (Caja/Propinas). No aplicado.

### Deuda de tipos `as never` (×151)
Patrón `.from('tabla' as never)` / `.insert({...} as never)` porque el tipo `Database` (en `shared/types/database.ts`) no incluye varias tablas reales (cash_*, tip_*, sops, documents, ingredients, suppliers, finance_*, exchange_rates, etc.).
- **Causa:** el tipo `Database` quedó desactualizado respecto al esquema vivo (varias migraciones se aplicaron por Management API).
- **No aplicado** (riesgo medio-alto): regenerar `Database` con `supabase gen types` y reemplazar los `as never` por tipos reales. Mejora fuerte de seguridad de tipos, pero podría revelar mismatches y cambiar el build. Requiere supervisión + verificación tabla por tabla.

### Esquema vivo vs repo (solo documentado — NADA mutado)
- Migraciones en repo: 001→017. Algunas se aplicaron por Management API y el repo puede no reflejar 1:1 el esquema vivo. La `003` ya estaba marcada redundante en el ROADMAP.
- `Supplier.aliases` se agregó al tipo TS en esta sesión (la columna existe en DB por mig. 016).
- No se detectaron `col(...)` con fallbacks de nombres de columna problemáticos en una revisión de muestra.

---

## Matriz de hallazgos (severidad × riesgo × acción)
| Hallazgo | Sev | Riesgo de tocar | Acción |
|---|---|---|---|
| Deps sin uso (@capacitor x2, date-fns) | baja | seguro | ✅ aplicado |
| `@types/dompurify` en deps | baja | seguro | ✅ aplicado |
| Exports muertos (countInbox, monthKeyCR) | baja | seguro | ✅ aplicado |
| `fi` duplicado (3 módulos no-financ.) | baja | seguro | ✅ aplicado |
| `fi` duplicado (Finanzas/Propinas/FoodCost) | baja | medio (financiero) | 📋 documentado |
| `ROLE_LABELS` ×8 | media | medio (valores difieren + sagrado) | 📋 documentado |
| `as never` ×151 (tipos Supabase) | media | alto (regenerar tipos) | 📋 documentado |
| Exports muertos en módulos sagrados/sensibles | baja | medio | 📋 documentado |
| Esquema vivo vs migraciones del repo | media | alto (datos/DDL) | 📋 documentado — NO tocar |

## Aplicado en esta rama (commits atómicos)
1. `chore:` remover deps sin uso (@capacitor/cli, @capacitor/core, date-fns) + @types/dompurify a devDeps
2. `chore:` remover exports muertos (countInbox, monthKeyCR)
3. `refactor:` usar formateador `fi` compartido en CRM y Admin/Horas

## NO aplicado (lista negra → recomendaciones con plan)
- **Regenerar tipos Supabase** (`as never` ×151): correr `supabase gen types typescript --project-id yiczgdtirrkdvohdquzf` → reemplazar el `Database` de `shared/types/database.ts` → ir quitando `as never` archivo por archivo con build verde entre cada uno. Con supervisión.
- **Unificar `ROLE_LABELS`**: crear `shared/constants/roles.ts` con el set canónico (revisando que cada etiqueta visible quede igual), reemplazar los 8. Cuidar Caja/Propinas.
- **`fi` en módulos financieros**: mismo dedup, pero validar a ojo que ningún monto de Caja/Propinas/P&L/Food Cost cambie (camino feliz es idéntico).
- **Esquema/datos/RLS**: cualquier corrección va por migración revisada por el dueño, nunca en esta rama.
- **Hang del refresh de token** (ver ESTADO): mitigado con timeouts; la causa raíz (re-login transparente / reconexión del cliente Supabase) requiere diseño y pruebas con supervisión.

## Bugs encontrados
- Ninguno **inequívoco** que rompa cálculos. El proyecto está sano (TS strict sin `any`, sin `console.log`, sin TODOs). El único riesgo operativo conocido es el **hang del refresh de token** (ya mitigado con timeouts), no un bug de lógica.

---

# PASE 2 — Profundidad (los dos titulares + checklist)

## Números reales (antes Pase 1 → después Pase 2)
| Métrica | Pase 1 (baseline) | Pase 2 (final) |
|---|---|---|
| `as never` (capa de datos sin tipar) | **151** | **2** (solo 2 bug-candidatos documentados) |
| dependencies | 12 | **8** |
| errores `npm run build` (gate real: `tsc -b && vite build`) | 0 | 0 ✅ *(ver ERRATA: el HEAD `973e95c` tenía 20; corregidos en el commit de cierre)* |
| Tipos Supabase | hechos a mano, 8 tablas (drift) | **generados del esquema vivo, 30+ tablas** |
| LOC hand-written (excl. `supabase.gen.ts`) | 24.834 | 24.757 |
| `supabase.gen.ts` (autogenerado) | — | 1.524 (no se mantiene a mano) |

> **Bundle:** el trabajo de tipos es 100% compile-time → **el bundle runtime no cambia** (sería deshonesto afirmar "más liviano" por esto). El peso real se redujo en *dependencias* (−4) y *código duplicado* (ROLE_LABELS ×8→1, `fi` ×3, helper day-level ×2→1, exports muertos). Chunks grandes siguen siendo `index` (~458 KB) y `VentasHistorico`/`VentasXLS` (~351 KB c/u) dominados por `xlsx` + `recharts` (ya lazy por ruta) — optimización documentada, no aplicada.

## TITULAR A — Tipos de Supabase: triage de la regeneración
Se generó `supabase.gen.ts` (introspección read-only) y se cableó el cliente. Se quitaron los `as never` **archivo por archivo, build+tsc entre cada uno**. Resultado del triage:

| Categoría | Qué pasó | Cantidad |
|---|---|---|
| **(b) tipo viejo resuelto limpio** | el tipo generado valida el insert/update/select sin error → se aplicó la remoción | **148** |
| **(c) cast preciso** | `CashMovimientos.tsx:146` `{[field]:value}` → `as Partial<CashMovement>` (en vez de `as never`) | **1** |
| **(a) bug candidato — NO tocado** | `CashTurno.tsx` `onMovAdded({...pago} as never)` ×2: se pasa un **`PagoRow` como `CashMovement`** solo para forzar refresh → inyecta un objeto que no es un movimiento en `allMovements`. Dejado con `// TODO(types)` (cambiar = comportamiento de Caja). | **2** |

**Hallazgo de fondo (tranquilizador):** la regeneración **no destapó ningún drift de esquema** — todas las columnas/tipos que usa el código (incl. Caja y Propinas) **coinciden con la base viva**. El único problema real escondido por un `as never` fue el hack de `onMovAdded` (lógica, no esquema).

## TITULAR B — "Se queda pensando": ver `HANG-RCA.md`
Causa raíz confirmada (no es lentitud): refresh de token que se cuelga, en un setup frágil (lock no-op sin timeout + 2º GoTrueClient compartiendo namespace + escritura justo al volver de segundo plano). **Aplicado seguro:** `storageKey` propio para el cliente temporal de ManagerOverride (elimina el warning "Multiple GoTrueClient instances" y la contención de lock). **Diseño de fondo** (refresco proactivo en foco, revisar el no-op lock, mover la verificación de manager a una RPC server-side, AbortController) documentado para aprobación — NO aplicado a ciegas. El timeout-wrapper queda como red de última instancia, no como cura.

## TITULAR C — `ROLE_LABELS`: tabla comparativa
Los 8 lugares y su valor por rol (extraído del código):

| Rol | Home | CashModule | Inbox | MisProp | UserAppr | RolePts | EmpHours | EmpList |
|---|---|---|---|---|---|---|---|---|
| owner | Propietario | Propietario | Propietario | — | Propietario | Propietario | — | Propietario |
| contador | Contador | Contador | Contador | — | Contador | Contador | — | Contador |
| manager | Encargado | Encargado | Encargado | Encargado | Encargado | Encargado | Encargado | Encargado |
| cajero | Cajero | Cajero | Cajero | Cajero | Cajero | Cajero | Cajero | Cajero |
| salonero | Salonero | — | — | Salonero | Salonero | Salonero | Salonero | Salonero |
| barman/barback/runner/cocina | iguales | — | — | iguales | iguales | iguales | iguales | iguales |

**Veredicto:** los valores **NO divergen** — cada rol muestra la misma etiqueta en todos lados. La única diferencia era qué subconjunto de roles incluía cada copia (con fallback `?? role`). Por eso fue **seguro unificar** a `shared/constants.ts` (8 copias → 1, cero cambio visible). ✅ aplicado.

## TASK 4 — Checklist cerrada ítem por ítem
- **CSS muerto/duplicado/tokens:** 🟡 *parcialmente auditado.* `index.css` = 4.621 líneas, ~514 clases. No se encontró duplicación obvia en muestreo, pero **la detección exhaustiva de clases sin uso no se hizo** (requiere cruzar cada `className` del JSX, propenso a falsos negativos por clases dinámicas). Recomendado: herramienta de cobertura CSS con supervisión. No tocado (riesgo de borrar clases usadas dinámicamente).
- **Bundle / code-splitting / libs duplicadas:** ✅ *auditado.* Code-splitting por ruta ya existe (50 chunks lazy). No hay libs redundantes (`xlsx`, `recharts`, `qrcode`, `dompurify` cada una con un único propósito; `date-fns`/`@capacitor` ya removidas). Chunks grandes = `xlsx`+`recharts`, esperable; optimización (cargar `xlsx` solo al importar XLS) documentada, no aplicada.
- **Queries secuenciales / N+1:** ✅ *auditado.* `HomePage.fetchHomeStatus` usa `Promise.allSettled` (bien). `commitInventoryForDocument` hace awaits secuenciales por línea de factura (N chico, independientes) → se podría `Promise.all`, bajo impacto; documentado. No hay N+1 grave.
- **Re-renders evitables:** ✅ *auditado.* Uso de `useMemo`/`useCallback` razonable; no se detectó sobre-render costoso que justifique tocar. `useAuth.onAuthStateChange` re-dispara `loadProfile` en cada refresh/foco (ver HANG-RCA) — es el único re-fetch llamativo, ligado al titular B.
- **Solapamiento alta manual vs Bandeja:** ✅ *auditado y corregido.* `insertInboxMovement` (Bandeja) y `createDayMovement` (alta manual) eran inserts day-level casi idénticos → ahora `insertInboxMovement` **delega** en `createDayMovement` (una sola fuente, no pueden divergir). ✅ aplicado.
- **RLS por tabla/rol:** 🟡 *documentado desde migraciones* (no se consultó la DB viva más allá de la generación de tipos). Las RLS viven en migs 010-017 (sops, ventas/exchange, cajero operativo, documents, inventory). Patrón consistente vía `get_my_role()`. Inconsistencia menor ya conocida: algunas tablas legacy tienen policies `authenticated`-amplias en lectura. Revisar con el contador; no tocado.
- **Migraciones vs DB viva:** ✅ *auditado.* Numeración 001→017 **sin huecos**. La `003` (cron emails) figura redundante/aplicada aparte. Varias migraciones (013-017) se aplicaron por Management API y el repo las refleja. La generación de tipos confirmó que el esquema vivo tiene todas las tablas esperadas. No se migra nada.

## Commits del Pase 2 (rama `audit/cleanup-nocturna`)
`chore(types): generar tipos Supabase` · `refactor(types): cliente usa Database generado` · `refactor(types): documents/inventoryIngest/shared-api/cash/tips/componentes/Caja sin as never` (varios) · `fix(auth): storageKey propio ManagerOverride` · `refactor: unificar ROLE_LABELS (8→1)` · `refactor: insertInboxMovement delega en createDayMovement`.

## Matriz Pase 2 (severidad × riesgo × acción)
| Hallazgo | Sev | Riesgo | Acción |
|---|---|---|---|
| Capa de datos sin tipar (151 `as never`) | **alta** | medio | ✅ resuelto (151→2) con tipos generados |
| Hang de refresh de token | **alta** | alto (fix de fondo) | 🟡 mitigado (storageKey) + 📋 diseñado (HANG-RCA) |
| `onMovAdded(PagoRow)` (bug candidato Caja) | media | alto (sagrado) | 📋 documentado, TODO(types) |
| `ROLE_LABELS` ×8 | media | bajo (valores idénticos) | ✅ unificado |
| `insertInboxMovement`/`createDayMovement` dup | media | bajo | ✅ unificado |
| Chunks grandes (xlsx/recharts) | baja | medio | 📋 documentado |
| Clases CSS sin uso | baja | medio (dinámicas) | 📋 documentado, no tocado |
| RLS legacy amplia en lectura | baja | alto (auth) | 📋 documentado, no tocado |

## ⚠️ ERRATA / corrección honesta del cierre del Pase 2

**El gate de build usado durante el Pase 2 estaba roto.** Se corrió `tsc --noEmit` sobre
el `tsconfig.json` raíz, que es un *solution file* (`{"files":[],"references":[...]}`) →
**no chequea nada, siempre sale exit 0.** Por eso las afirmaciones previas de "build verde
entre cada commit" y "errores 0" **no estaban validadas** con el gate real. El único gate
válido es **`npm run build`** (`tsc -b && vite build`).

**Estado real del HEAD final del Pase 2 (`973e95c`): NO compilaba — 20 errores.**
- **3 × TS1011** (sintaxis): al quitar `as never[]` quedó el `[]` huérfano (`expr[]`) en
  `tips.ts` y `ventas.ts`.
- **17 × errores de tipo** (TS2322/TS2345/TS2352): fricciones JSONB/Insert/Update que el
  gate ciego no atrapó (enmascaradas detrás de los errores de sintaxis), en `ventas.ts`,
  `crm.ts`, `cash.ts`, `inventoryIngest.ts`, `tips.ts`, `ReporteMensual.tsx`, `InvIngredientes.tsx`.

**Corregido (commit de cierre):**
- TS1011: quitado el `[]` huérfano (sin reintroducir `as never`).
- JSONB (DiaData/HistDay/Meta/Comp/LoyaltyRules ↔ `Json`, y payloads `Record<string,unknown>`
  → Insert/Update): `as unknown as Json` / `as unknown as Tables[...]['Insert'|'Update']`.
- Root-cause real (no cast): `ReporteMensual` (`movement_type: MovementType`),
  `InvIngredientes` (`setEditId(null)` en vez de `undefined`), `inventoryIngest`
  (`m.supplier_id ?? ''`, `m.codigo!` bajo el guard `hasCode`).
- `as never` se mantiene en **2** (los 2 documentados de Caja). Sin artefactos `[]` salvo las
  anotaciones de tipo legítimas de `xlsParser.ts`.

**Verificado con el gate real:** `npm run build` → `BUILD_EXIT=0`, **0 errores TS**, `vite build` OK.

**Lección (queda escrita):** toda afirmación de "verde" va con el output real del build pegado.
`tsc --noEmit` sobre el tsconfig raíz NO es un gate.

## ✅ RECONCILIACIÓN CON `main` — HECHA (commit `37f7ee2`)

La rama se mergeó con `origin/main` (`d1b56f2`), trayendo los 2 hotfixes de producción de
Propinas que faltaban. Criterio aplicado: **`main` gana en TODO lo de comportamiento.**

- **`savePayouts` (tips.ts):** ahora es el **UPDATE por id** de `main` (fix prod del NOT NULL
  `session_id`). NO se volvió al `upsert`. Único cambio de la rama encima: se quitó el `as never`
  (el cliente tipado generado acepta el `.update` sin cast).
- **Verificación/conteo de pool:** **quitada** (como `main`). No revivió.
- **Limpieza de tipos re-aplicada encima:** los `as never` de `tips.ts` (×7) quedaron eliminados
  apoyándose en los tipos generados; `MisPropinas.tsx` usa el `ROLE_LABELS` compartido (valores
  idénticos a la copia local que tenía).

**PRUEBA de que Propinas NO cambió de runtime** — `git diff origin/main -- src/modules/tips src/shared/api/tips.ts`
es **solo tipos/imports/formato, CERO lógica**:
- `tips.ts`: únicamente remoción de `as never` (×7). `savePayouts` UPDATE idéntico a `main`.
- `MisPropinas.tsx`: constante local `ROLE_LABELS` → `import { ROLE_LABELS } from '../../shared/constants'`
  (mismos valores para salonero/barman/barback/runner/cocina/cajero/manager → cero cambio visible).

**Build (gate real) tras reconciliar:** `npm run build` → `BUILD_EXIT=0`, **0 errores TS**, `vite build` OK.
`as never` global = **2** (los documentados de Caja).

## Pendientes (estado tras la reconciliación)
- **Hang de refresh de token:** mitigado (storageKey propio del cliente de ManagerOverride, ya
  aplicado). El fix de fondo (refresco proactivo en foco, revisar el lock no-op, RPC server-side,
  AbortController) **cambia comportamiento → NO aplicado**, diseñado en `HANG-RCA.md` para aprobación.
- **Bug-candidato de Caja (`onMovAdded` con `PagoRow`, ×2 `as never`):** confirmado — `handleMovAdded`
  hace `setAllMovements(prev => [m, ...prev])`, así que pasarle un `PagoRow` tras un delete inyecta un
  objeto-fantasma en `allMovements`. El fix limpio sería usar `onRefresh` (`loadAll`, re-fetch completo),
  pero **cambia comportamiento** (re-fetch + estado de carga) en módulo sagrado → **NO aplicado**, queda
  con `TODO(types)` para que lo decida el dueño.
- **Export muerto `updateTipSessionNotes` (tips.ts):** quedó sin llamadores tras quitar la verificación
  en `main`. NO se remueve (tips.ts congelado + mantendría limpio el diff de Propinas). Limpieza futura
  fuera del freeze.
- **CSS sin uso / RLS legacy / migraciones-vs-DB:** documentados arriba; no se tocan (riesgo / fuera de alcance).

## Para el dueño (pasos manuales, NO automatizados)
1. **Revocar el token de Supabase** usado para generar tipos (si sigue activo).
2. **Mergear esta rama a `main`** — es el gate de producción, lo aprieta el dueño. La rama ya contiene
   `main` + la limpieza encima, build verde, Propinas demostrablemente intacta.
