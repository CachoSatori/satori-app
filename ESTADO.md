# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-26.** Esta sesión fue de **esquema + tooling de tests + handoff**, todo en `staging` (prod intacto):
> 1. **Migraciones 040–043 (unificación Bandeja↔Caja) FIRMADAS y APLICADAS a la base de staging** (vía `supabase db query`, NO `db push` → **no quedaron en `schema_migrations`**). Esquema verificado 10/10 objetos. Los **archivos `.sql` viven SOLO en la rama `feat/unif-migrations-040-043` (`3c534f4`), sin mergear** → *"esquema aplicado en la base de staging, archivos en rama suelta"*.
> 2. **Decisión OPCIÓN A (firmada):** `accounting_entries` es libro de **AUDITORÍA/REVERSIÓN únicamente; NO alimenta el P&L** (evita un doble-conteo real, ↓§b6). El P&L se sigue derivando en vivo de `getLiveActuals`. Propagación automática = visión futura (SPEC §19).
> 3. **Entorno de tests DOM** (happy-dom + RTL + smoke anti-loop `/`↔`/login`) **mergeado a staging** (`69d7749`), gates verdes.
> 4. **Auth-recovery** reclasificado: el gate de suspensión >1h **PASÓ** → **DIFERIDO** (posiblemente innecesario), código ya **mergeado** en staging (↓§b3).
> 5. **⚠️ Aprendizaje crítico:** el CLI de Supabase estaba **enlazado a PROD**; lo cazó el guardrail → **RITUAL obligatorio** antes de cualquier comando de DB (↓§a + HALLAZGOS.md).
> Historia detallada → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Fases → [ROADMAP.md](ROADMAP.md) · Backlog/PASE A PROD → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · SPEC unificación → [docs/SPEC-unificacion-bandeja-caja.md](docs/SPEC-unificacion-bandeja-caja.md) · RCA Realtime → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md) · RCA auth → [docs/HANG-RCA-2.md](docs/HANG-RCA-2.md) · RCA /caja → rama `rca/caja-hardreload-hang` (sin mergear, no está en staging).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages.

> **PROD (`main` `79d8004`) tiene las OLAS 1 y 1.1 de estabilidad + el fix de la PANTALLA NEGRA + la durabilidad de `createDayMovement` (todo validado físicamente).** FEATURES (PoS, Bandeja), seguridad/integridad (IDOR, mig 039) y el esquema nuevo (040–043) viven en `staging`; a prod se va por **cherry-pick selectivo**, NUNCA mergeando `staging`→`main`.

---

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `79d8004` | **PROD (estable, en uso), INTACTO esta sesión.** Capa de inteligencia + fixes SW/fechas + canario Realtime/candado + **OLA 1** (saga Realtime/suspensión: worker:true + máquina de 3 estados + gateo del emit + endurecimiento `SESSION_EXPIRED` + durabilidad de escritura de caja, SIN diag) + **OLA 1.1** (timeout/abort del flush del outbox) + **PANTALLA NEGRA** (`5f22754`) + **durabilidad `createDayMovement`** (`79d8004`). Migraciones **≤021** (todo lo demás es client-side). **NO** tiene PoS/Bandeja/IDOR/mig-039/040-043. |
| `staging` | `69d7749` | **Fuente de verdad del trabajo nuevo.** Todo `main` + PoS/KDS/comandero + FE estructura + inventario activo + Bandeja Etapa 1 + saga Realtime + durabilidad caja/outbox + **auth-recovery mergeado** (`e0df9ae`+`14e4546`, §b3) + diag solo-staging + IDOR cerrado (`c38a252`) + cascada de inventario **mig 039** (`82d55cd`) + docs SPEC unificación (+§19) + **🆕 entorno de tests DOM** (happy-dom+RTL, `69d7749`). |
| `feat/unif-migrations-040-043` | `3c534f4` | **Rama suelta, FIRMADA.** Contiene los **archivos** `040–043*.sql` (unificación Bandeja↔Caja). El **esquema YA está aplicado a la base de staging** (vía `db query`), pero **los archivos NO están mergeados** a `staging`. Decisión abierta: ¿mergearlos? (los haría fieles al repo). |

> **Supabase refs:** **PROD = `yiczgdtirrkdvohdquzf`** ("satori-app", INTOCABLE) · **STAGING = `hwiatgicyyqyezqwldia`** ("satori-staging").
> 🛑 **RITUAL OBLIGATORIO antes de CUALQUIER comando de base** (`migration list`, `db query`, `db push`, `dump`…): correr `cat supabase/.temp/linked-project.json` → el `"ref"` **DEBE** ser `hwiatgicyyqyezqwldia`. **El link puede quedar apuntando a PROD sin avisar** (pasó esta sesión). Si no es staging: `supabase link --project-ref hwiatgicyyqyezqwldia` y re-verificar. **Nunca** correr DB sin confirmar el ref. Ver HALLAZGOS.md.

## (b) Trabajo de esta sesión (2026-06-26)

### b1 — Migraciones 040–043 unificación Bandeja↔Caja — FIRMADAS + APLICADAS a staging
Las 4 (DDL aditivo, idempotente) fueron firmadas por la dueña y **aplicadas a la base de staging** vía `supabase db query --linked --file` (como la 039: **NO** por `db push`, **NO** quedan en `schema_migrations`). Esquema verificado **10/10 objetos** (`select` de `information_schema`):
- **040** `inventory_review_task` (cola PENDIENTE/EN_REVISION/COMPLETADA/DESCARTADA + RLS owner/manager/contador, cajero excluido).
- **041** `cash_movements` +`classification`/`suggested_classification`/`suggested_confidence` (nullable, filas viejas NULL).
- **042** `accounting_entries` (libro append-only) + `post_accounting_entry` + trigger `unif_on_cash_movement` (asiento operativo EN el libro + alta de tarea de mercadería, INV-1). **Opción A: sin rollup a `finance_actuals`.**
- **043** `delete_movement_cascade` extendida (revierte asientos + descarta tarea + D5 borra documento) + `complete_inventory_review` + `discard_inventory_review`.
- **3 asunciones firmadas:** (a) "pagado" = `status='aprobado'`; (b) una sola cuenta COGS `a5200` por tarea (split food/bebida = posterior); (c) el trigger de alta de tarea de mercadería se agregó porque **INV-1** lo exige.

### b2 — Decisión OPCIÓN A (firmada): el libro NO alimenta el P&L
`accounting_entries` es **auditoría/reversión únicamente**. **Evita un doble-conteo real:** `FinanzasModule` ya suma `getFinanceActuals()` **+** `getLiveActuals()` (deriva del P&L en vivo desde `cash_movements`); el rollup original habría contado el gasto **dos veces**. Por eso 042 **eliminó** rollup/recompute/índice sobre `finance_actuals`. Propagación granular automática al P&L = **visión futura, SPEC §19**.

### b3 — Auth-recovery — RECLASIFICADO (ya NO es "gateado/pendiente")
El escape del loop `OFFLINE_WAITING` (N=3 timeouts de `getSession` → `SESSION_EXPIRED`+`signOut({scope:'local'})` + latch one-shot) está **MERGEADO en staging** (`e0df9ae`+`14e4546`) — **no vive "solo en una rama"**. El **gate de suspensión real >1h PASÓ**: validado físicamente por la dueña, **la app desplegada se recupera sin él** → queda **DIFERIDO (posiblemente innecesario)**. Si se retoma, exige **cerrar antes la premisa del Hallazgo B** (el outbox debe drenar en `SIGNED_IN`). Detalle → `docs/HANG-RCA-2.md`. (El lock `ccef5f1` 10s→5s fue red herring, hardening inofensivo.)

### b4 — Entorno de tests DOM — mergeado a staging
`happy-dom` + React Testing Library + `vitest.setup.ts` + smoke `src/App.smoke.test.tsx` (renderiza el árbol con router; **falla si reaparece el loop `/`↔`/login`**). Default `node` a propósito (los tests de `supabase.timeout`/`cash.cascade`/`cash.durability` explotan la ausencia de `window`/`navigator`); los DOM piden `// @vitest-environment happy-dom`. Gates verdes (build prod EXIT 0 · vitest 19 files/141 tests). La rama `chore/test-env-happy-dom-rtl` quedó **superada** (su contenido ya está en staging).

### b5 — RITUAL del link a staging (aprendizaje crítico) → §(a) + HALLAZGOS.md.

### b6 — Diagnóstico del ledger (sin tocar el historial) → §(d).

### b-previas (resueltas, EN PROD — detalle en ESTADO-ARCHIVO.md + RCAs)
- **Realtime tras suspensión profunda** — máquina de 3 estados en `ensureRealtimeHealthy` (topes `withTimeout` 8s; nunca `rt:healthy` sin token fresco; gateo `healthyAwaited`). EN PROD sin diag (`2358f6c`); en staging `[rt-diag]`/`__satoriDiag` activos (gateado por `VITE_APP_ENV`).
- **PANTALLA NEGRA** (splash 祭 eterno) — bootstrap de `useAuth` (`getSession`+`loadProfile`) sin tope se colgaba sobre el socket zombi. Fix `withTimeout` + guards (`5f22754`, validado por la dueña). **Receta de pase a prod (3 commits + 2 `export` en `supabase.ts`, NO traer `armBootHang` ni el lock) registrada en ESTADO-ARCHIVO.md.**
- **IDOR `extract-document`** (Edge Function) — CERRADO en staging (`c38a252`): exige JWT, baja bajo RLS sin `service_role`, CORS por allowlist. Validado los 2 lados. Prerequisito de seguridad #1 de la Bandeja. **Solo en staging.**
- **Borrado de caja → cascada de inventario (mig 039)** — `delete_movement_cascade` cierra el inventario huérfano del `ON DELETE SET NULL` de mig 017. Validado end-to-end por la dueña. **Solo en staging** (aplicada por dashboard → no en `schema_migrations`).

## (c) PROD vs STAGING

- **En PROD (`main` `79d8004`):** ventas/analítica, propinas, caja (turnos + cierre 2 fases + movimientos + pendientes), ingesta foto vieja, finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline. Migraciones **001–021** + (client-side) fixes SW/fechas, canario, Olas 1+1.1, pantalla negra, durabilidad `createDayMovement`. **Sin cambios esta sesión.**
- **Solo en STAGING:** todo el **PoS** (catálogo/salón multi-local, comandero, KDS, cobro+splits+ticket SIM, `computeTotals`, FE estructura SIM, inventario activo COGS) · **Bandeja Etapa 1** · diag de Realtime · **IDOR cerrado** · **cascada mig 039** · **🆕 esquema 040–043 aplicado a la base** (archivos en rama suelta) · **🆕 entorno de tests DOM**. Migraciones **022–039** + **040–043** (estas últimas fuera del ledger).
- **En rama aparte (sin merge):** `propina-pool` (espera decisión); `feat/unif-migrations-040-043` (archivos 040-043).

## (d) Migraciones

| Entorno | En el ledger | Notas |
|---|---|---|
| **PROD** | **≤021** | Fixes SW/fechas/Realtime/Olas/pantalla-negra/`createDayMovement` son 100% client-side (sin migración). |
| **STAGING** | **022–038** | 022–034 PoS · 036 FE · 037 inventario COGS · 038 Bandeja (firmada). |

**⚠️ Discrepancias de ledger (decisión: NO tocar el historial — reconciliación = sesión dedicada de infraestructura):**
- **009** — drift histórico (existe `0095_drift_baseline.sql`); el ledger remoto tiene un `009` que no matchea el archivo local.
- **035** — fantasma: el ledger la marca aplicada pero el **archivo solo vive en `propina-pool`** (sin merge).
- **039** — aplicada por el **dashboard**, NO en `schema_migrations`.
- **040–043** — aplicadas por **`db query`** esta sesión, NO en `schema_migrations`.
- Consecuencia: `supabase db push` **se frena** por 009/035 (remote-not-in-local). NO usar `push`/`repair` hasta la sesión de reconciliación. Todo es idempotente (re-aplicar no rompe).

## (e) Lo construido, por módulo

Leyenda: ✅ validado por la dueña / 🟢 verde (tests+build) sin validación física / 🟡 parcial / 🔲 sin código.

| Módulo | Estado | Dónde |
|---|---|---|
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod (maduro; `cashUtils`/`tipCalculations`/`computeTotals` SAGRADOS) |
| Estabilidad PWA (SW viejo) · Fechas borde · Realtime/candado | ✅ **en PROD** | prod |
| Realtime tras suspensión · Durabilidad caja · Outbox flush (Olas 1+1.1) | ✅ **EN PROD y VALIDADO** | prod (`2358f6c`/`483d29c`) + staging |
| PANTALLA NEGRA (bootstrap con tope) · `createDayMovement` durabilidad | ✅ **EN PROD, VALIDADO** | prod (`5f22754`/`79d8004`) |
| IDOR `extract-document` cerrado | 🟢 validado 2 lados | **solo staging** (`c38a252`) |
| Cascada de inventario (mig 039) | ✅ validado e2e por la dueña | **solo staging** (`82d55cd`) |
| Auth-recovery (escape loop OFFLINE_WAITING) | 🟡 **DIFERIDO** (gate >1h pasó; posiblemente innecesario) | mergeado en staging (`e0df9ae`+`14e4546`) |
| **🆕 Esquema unificación 040–043** (tablas/funciones/columnas) | 🟢 **aplicado a la base de staging** (10/10) · 🔲 archivos sin mergear | base staging + rama `feat/unif-migrations-040-043` |
| **🆕 Entorno de tests DOM** (happy-dom+RTL+smoke) | 🟢 mergeado, gates verdes | staging (`69d7749`) |
| Bandeja Etapa 1 | ✅ COMPLETA y validada | staging (mig 038) |
| Bandeja Etapa 2 / "Agregar" único | 🔲 **SUBSUMIDA por SPEC unificación** (código sin construir) | — (SPEC §19; ROADMAP §1ter) |
| PoS (catálogo/comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo | 🟢 sin validación física | staging |

## (f) Pendientes de PLATA — sin firma/decisión de la dueña

> ✅ **Las migraciones 040–043 YA están FIRMADAS y aplicadas a staging** — salieron de "pendiente de firma".

1. **`propina-pool`** (rama, sin merge) → pool del turno sin tocar `tipCalculations`. **DECISIÓN:** tarjeta/SINPE ¿al mismo pool que efectivo o separada?
2. **Hora-CR en bordes de período** — `finance.ts:132/139` (P&L borde de año en UTC). Cambia números → validación física. `_handoff/RCA-FECHAS-BORDE.md` §5.
3. **`fix/fecha-cr-consistente`** (`cb25672`, staging) → mes-CR de gastos de noche. Pendiente validación física.
4. **`fix-doble-cobro`** (mig 033, staging) → validación física + decisión de pase.
5. **🖊️ D5 ya implementada en 043** (borrar la foto al borrar la factura, para recargar sin que el dedupe por `sha256` la frene) — firmada en el SPEC; verificar comportamiento en staging cuando se construya la UI.

## (g) Pendientes humanos / operativos / prolijidad

- **PRÓXIMO (construcción del módulo de unificación):** **regenerar los tipos TS** contra staging (ya existen `accounting_entries`, `inventory_review_task`, las RPCs, las 3 columnas) → luego construir F3–F5 del SPEC (módulo de Inventarios, "Agregar" único, cascada en UI). Ver PROMPT-CONTINUACION §1.
- **DECISIÓN abierta:** ¿mergear los archivos 040–043 a `staging`? (ya firmados + aplicados; haría el repo fiel a la base).
- **DIFERIDO — reconciliación del ledger** (009/035/039/040–043): sesión dedicada; resolver 035/`propina-pool` primero.
- **DIFERIDO — auth-recovery** (§b3): requiere cerrar la premisa Hallazgo B (outbox drena en `SIGNED_IN`).
- **PLAN DE PASE A PROD — OPCIÓN A (3 OLAS).** Olas 1 y 1.1 ✅ en prod. ⚠️ Staging está muy por delante de main → **solo cherry-pick**, nunca merge. Próximas: pase del IDOR + mig 039 (con firma) y, luego, Ola 2 (Bandeja Etapa 1 + mig 038). Detalle → PROMPT-CONTINUACION.
- **🔐 Rotar tokens de GitHub** (gho_ del remote de SATORI PROPINAS + PAT classic "Claude CLI") — **antes del 27-jun**.
- **GRAN PASE del PoS — DIFERIDO** (migs 022–037), bloqueado por el PILAR de escalabilidad de sesión/auth.
- **Riesgo latente (registrado, baja prioridad):** `/caja` + Cmd+Shift+R → redirige a `/login` ~20s (recuperable, sin pérdida de datos). RCA en la **rama `rca/caja-hardreload-hang`** (sin mergear; 2 debilidades latentes: import sin tope + idbGet sin tope). No bloquea el módulo nuevo.
- **Contadora:** códigos **CIIU/CABYS** (bloquean FE real).
- **⚠️ GOTCHA DE VERIFICACIÓN:** `tsc --noEmit` es **FALSO VERDE** (el `tsconfig.json` raíz tiene `"files": []`). El typecheck REAL es **`VITE_APP_ENV=production npm run build`** (`tsc -b`, compila los `*.test.ts`). Toda verificación de pase corre el build, no `tsc --noEmit`.
- **Ruido conocido:** errores "message channel closed" = extensiones de Chrome; `SESSION_EXPIRED` transitorio en el primer tick del arranque (inofensivo, solo staging).

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión · `posFiscal`.
Todo el trabajo nuevo los **alimenta**, no los cambia.
