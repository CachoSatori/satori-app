# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-27.** Sesión de **limpieza + 2 fixes de caja/bandeja**, todo en `staging` (prod intacto). **`staging` = `eefa056`** (limpieza + borrar-día por cascada + foto de factura normalizada, los tres MERGEADOS).
> 1. **Limpieza de código muerto — MERGEADA a staging** (`9b1127c`→`abb2a25`, fast-forward): se borró `src/shared/api/auth.ts` (huérfano, el auth real vive en `useAuth.tsx`), exports sin uso (`crm.ts:findCustomerByPhone`, `ventasUtils.ts:fmtPct/monthKey/metaDot`) y 3 assets del scaffold (`src/assets/{hero,react,vite}`). Informe completo en [INFORME-LIMPIEZA.md](INFORME-LIMPIEZA.md) (incluye lo NO tocado: money-adjacent, sagrados, duplicación de `fi`). Build (typecheck real) + tests verdes.
> 2. **Borrar-día y descartar-turno ahora pasan por la CASCADA — MERGEADO a staging** (`b8ab78c`, fast-forward): `discardDiaCompleto` y `discardCashSession` (`src/shared/api/cash.ts`) borraban `cash_movements` con `.delete()` crudo → salteaban `delete_movement_cascade` (mig 039/044) → dejaban `accounting_entries` huérfanos (sin reversa) e `inventory_review_task` colgadas, sin auditoría. Ahora borran **cada** movimiento por el RPC (con credenciales de gerencia de mig 044), respetando el orden **movimientos→cierre→sesiones**; error parcial recuperable, no tragado. Test nuevo `cash.discardDia.test.ts`. **✅ Validada físicamente** (pruebas A y B: la tarea de Revisión desaparece). *Opcional no bloqueante:* verificación SQL directa de 0 `accounting_entries` huérfanos.
> 3. **Lectura de facturas con IA — foto normalizada en el navegador — MERGEADO a staging** (`eefa056`, fast-forward desde `fix/bandeja-normalizar-imagen`): la misma factura leía bien desde la PC y daba "sin leer" capturada con el teléfono (HEIC/peso/orientación EXIF → Anthropic devolvía vacío). Nuevo helper `src/shared/utils/imageNormalize.ts` (`normalizeInvoiceImage`: decodifica con `createImageBitmap` respetando EXIF y convirtiendo HEIC en iOS Safari, reescala el lado largo a ≤1568px, re-exporta JPEG 0.82; fallback al original sin romper) usado al inicio de `processFile` (cubre cámara/galería/WhatsApp). Front-only, **sin migración**. **✅ Validada físicamente** (captura directa con el teléfono).
>
> **Sesión previa (2026-06-26)** fue de **esquema + tooling de tests + handoff**, todo en `staging` (prod intacto):
> 1. **Migraciones 040–043 (unificación Bandeja↔Caja) FIRMADAS y APLICADAS a la base de staging** (vía `supabase db query`, NO `db push` → **no quedaron en `schema_migrations`**). Esquema verificado 10/10 objetos. Los **archivos `.sql` están ✅ MERGEADOS a staging (`63ca7ce`)** → el repo refleja el esquema real (la rama `feat/unif-migrations-040-043` quedó superada).
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
| `staging` | `eefa056` | **Fuente de verdad del trabajo nuevo.** Todo `main` + PoS/KDS/comandero + FE estructura + inventario activo + Bandeja Etapa 1 + saga Realtime + durabilidad caja/outbox + **auth-recovery mergeado** (`e0df9ae`+`14e4546`, §b3) + diag solo-staging + IDOR cerrado (`c38a252`) + cascada de inventario **mig 039** (`82d55cd`) + **autorización de gerencia inline en el borrado (mig 044)** (`7401a5a`+`f1e1aa9`) + docs SPEC unificación (+§19) + entorno de tests DOM (happy-dom+RTL) + **🆕 limpieza de código muerto** (`9b1127c`→`abb2a25`) + **🆕 borrar-día/descartar-turno por cascada** (`b8ab78c`) + **🆕 foto de factura normalizada en el navegador** (`eefa056`). |
| `fix/bandeja-normalizar-imagen` | `eefa056` | **🆕 MERGEADA a staging (fast-forward), rama superada.** Normaliza la foto de la factura en el navegador antes de subirla (helper `imageNormalize.ts`) → arregla la lectura con IA de capturas del teléfono (HEIC/peso/EXIF). Front-only, sin migración. ✅ validada físicamente. |
| `feat/unif-migrations-040-043` | `3c534f4` | **MERGEADA a staging (`63ca7ce`), rama superada.** Aportó los **archivos** `040–043*.sql` (unificación Bandeja↔Caja), ya en `staging`. El **esquema fue aplicado a la base de staging** vía `db query` (no en `schema_migrations`). |

> **Supabase refs:** **PROD = `yiczgdtirrkdvohdquzf`** ("satori-app", INTOCABLE) · **STAGING = `hwiatgicyyqyezqwldia`** ("satori-staging").
> 🛑 **RITUAL OBLIGATORIO antes de CUALQUIER comando de base** (`migration list`, `db query`, `db push`, `dump`…): correr `cat supabase/.temp/linked-project.json` → el `"ref"` **DEBE** ser `hwiatgicyyqyezqwldia`. **El link puede quedar apuntando a PROD sin avisar** (pasó esta sesión). Si no es staging: `supabase link --project-ref hwiatgicyyqyezqwldia` y re-verificar. **Nunca** correr DB sin confirmar el ref. Ver HALLAZGOS.md.

## (b27) Trabajo de esta sesión (2026-06-27)

### b27.1 — Limpieza de código muerto — MERGEADA a staging
Pase conservador de eliminación de código muerto **no-money** (`9b1127c`→`abb2a25`, fast-forward a staging). Se borró el archivo huérfano `src/shared/api/auth.ts` (no lo importaba nadie; el auth real es `useAuth.tsx`), exports sin referencias (`crm.ts:findCustomerByPhone`, `ventasUtils.ts:fmtPct/monthKey/metaDot` + el import muerto `fi as _fi`) y 3 assets sin uso (`src/assets/{hero.png,react.svg,vite.svg}`, restos del scaffold de Vite). Lo money-adjacent / sagrado / dudoso quedó **documentado pero NO tocado** en [INFORME-LIMPIEZA.md](INFORME-LIMPIEZA.md) (exports muertos en `cash.ts`/`fe.ts`/`tips.ts`/`finance.ts`/`pos.ts`, tipos sin uso en `database.ts`, duplicación de `fi`/`fip`, `InventoryStep.tsx` huérfano en zona F4, `@types/dompurify`). Build (typecheck real) + tests verdes.

### b27.2 — Borrar-día y descartar-turno por la cascada — MERGEADO a staging
`discardDiaCompleto` y `discardCashSession` (`src/shared/api/cash.ts`) borraban los `cash_movements` con `.delete()` crudo, **salteando** `delete_movement_cascade` (mig 039/044) → `accounting_entries` huérfanos (con `source_id` a movimientos inexistentes, sin asiento de reversa) + `inventory_review_task` sin descartar, sin auditoría. **Mismo bug que ya estaba resuelto para el borrado POR movimiento.** Fix (`b8ab78c`, front-only, sin migración): ambos hacen `SELECT` de ids y borran **cada** movimiento por `deleteCashMovement` → el RPC (idempotente, con timeout+reintento, **credenciales de gerencia de mig 044**). El cierre (`cash_cierres_dia`) y las sesiones (`cash_sessions`) **siguen** con `.delete()` crudo (no tocan el libro), pero **después** de los movimientos. Secuencial: si una llamada falla, frena y propaga el conteo parcial (recuperable: re-correrlo termina). `handleBorrarDia` (CashCierre) y `descartarTurno` (CashTurno) ahora capturan el `auth` de `requireManager()` y pasan `managerEmail/managerPassword`. Test nuevo `cash.discardDia.test.ts` (cada movimiento por el RPC, nunca `.delete()` de `cash_movements`; orden movimientos→cierre→sesiones; reenvío de credenciales). **✅ Validada físicamente por la dueña en staging:** prueba A (borrar el día) y prueba B (descartar turno), cada una con factura de mercadería; en ambas la tarea de Inventario→Revisión **desaparece** tras el borrado → confirma que la cascada corre (el mismo RPC que borra la tarea reversa el asiento en la misma transacción). *Confirmación OPCIONAL no bloqueante:* la verificación SQL directa de 0 `accounting_entries` huérfanos. **NO se tocaron** las reconciliaciones por `description` (`discardCierreDia`, `recordCierreSales`) — quedan para análisis aparte.

### b27.3 — Bandeja: normalizar la foto de la factura en el navegador — MERGEADO a staging
La misma factura leía bien subida desde la PC y daba **"sin leer"** capturada con el teléfono: el front subía la imagen tal cual (pesada / HEIC / con orientación EXIF) → Anthropic no la procesaba → vacío. Fix (`eefa056`, fast-forward a staging desde `fix/bandeja-normalizar-imagen`, front-only **sin migración**): nuevo helper `src/shared/utils/imageNormalize.ts` — `normalizeInvoiceImage(blob)` decodifica con `createImageBitmap(input, { imageOrientation: 'from-image' })` (respeta EXIF y convierte HEIC→bitmap en iOS Safari; fallback a `<img>`), reescala el lado largo a **≤1568px** (sin agrandar) en canvas y re-exporta **JPEG calidad 0.82**, devolviendo `{ blob, filename: 'factura-*.jpg' }`; ante fallo devuelve el blob ORIGINAL (no empeora lo de hoy). `InboxModule.processFile` lo llama **al inicio** (antes del sha256), cubriendo los tres orígenes (cámara/galería/share de WhatsApp). El objeto en storage queda `.jpg` + `image/jpeg` → `mediaType()` de la Edge Function devuelve `image/jpeg` (**sin tocar `supabase/`**). `targetDimensions` se extrajo como función pura y se testeó (canvas no corre en happy-dom). **✅ Validada físicamente** (captura directa con el teléfono). Follow-up opcional (defensa en profundidad): endurecer `mediaType()` de la Edge Function para no depender solo de la extensión.

## (b) Sesión previa (2026-06-26)

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
- **Solo en STAGING:** todo el **PoS** (catálogo/salón multi-local, comandero, KDS, cobro+splits+ticket SIM, `computeTotals`, FE estructura SIM, inventario activo COGS) · **Bandeja Etapa 1** · diag de Realtime · **IDOR cerrado** · **cascada mig 039** · **autorización de gerencia inline en el borrado (mig 044)** · esquema 040–043 aplicado a la base + archivos MERGEADOS (`63ca7ce`) · entorno de tests DOM · **🆕 limpieza de código muerto** (`9b1127c`→`abb2a25`) · **🆕 borrar-día/descartar-turno por cascada** (`b8ab78c`) · **🆕 foto de factura normalizada en el navegador** (`eefa056`, ✅ validada). Migraciones **022–039** + **040–044** (estas últimas fuera del ledger).
- **En rama aparte (sin merge):** `propina-pool` (espera decisión). *(`feat/unif-migrations-040-043` ya fue MERGEADA — `63ca7ce`; `fix/bandeja-normalizar-imagen` ya fue MERGEADA — `eefa056`.)*

## (d) Migraciones

| Entorno | En el ledger | Notas |
|---|---|---|
| **PROD** | **≤021** | Fixes SW/fechas/Realtime/Olas/pantalla-negra/`createDayMovement` son 100% client-side (sin migración). |
| **STAGING** | **022–038** | 022–034 PoS · 036 FE · 037 inventario COGS · 038 Bandeja (firmada). |

**⚠️ Discrepancias de ledger (decisión: NO tocar el historial — reconciliación = sesión dedicada de infraestructura):**
- **009** — drift histórico (existe `0095_drift_baseline.sql`); el ledger remoto tiene un `009` que no matchea el archivo local.
- **035** — fantasma: el ledger la marca aplicada pero el **archivo solo vive en `propina-pool`** (sin merge).
- **039** — aplicada por el **dashboard**, NO en `schema_migrations`.
- **040–043** — aplicadas por **`db query`** (sesión 2026-06-26), NO en `schema_migrations`.
- **044** — `delete_movement_cascade` con autorización de gerencia inline (firma pasa de 2→4 args; **dropea** la versión de 2 args para evitar overload ambiguo). FIRMADA (Opción A), aplicada a la base de **staging**, fuera de `schema_migrations` (igual que 039–043). Es la que habilita al cajero a borrar con credenciales válidas y el RPC que ahora usa el borrar-día/descartar-turno (§b27.2). Requiere 043 aplicada antes.
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
| Autorización de gerencia inline en el borrado (mig 044) | 🟢 en staging | **solo staging** (`7401a5a`+`f1e1aa9`) |
| **🆕 Borrar-día / descartar-turno por la cascada** (no dejan asientos huérfanos) | ✅ validada físicamente (pruebas A y B: la tarea de Revisión desaparece) | **staging** (`b8ab78c`) |
| **🆕 Bandeja: foto normalizada en el navegador** (HEIC/peso/EXIF → JPEG ≤1568px) | ✅ validada físicamente | **staging** (`eefa056`) |
| Auth-recovery (escape loop OFFLINE_WAITING) | 🟡 **DIFERIDO** (gate >1h pasó; posiblemente innecesario) | mergeado en staging (`e0df9ae`+`14e4546`) |
| **🆕 Esquema unificación 040–043** (tablas/funciones/columnas) | 🟢 **aplicado a la base de staging** (10/10) · ✅ archivos MERGEADOS (`63ca7ce`) | base staging + `supabase/migrations/040–043` |
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

- **🆕 ✅ Validación física de los 2 fixes de esta sesión — COMPLETA.** Borrar-día/descartar-turno (§b27.2): pruebas A y B en staging, la tarea de Inventario→Revisión desaparece tras el borrado. Foto de factura normalizada (§b27.3): captura directa con el teléfono. **Único pendiente OPCIONAL no bloqueante:** verificación SQL directa de 0 `accounting_entries` huérfanos tras un borrado de día (confirmación de cinturón-y-tiradores; la desaparición de la tarea ya evidencia que la cascada corrió).
- **PRÓXIMO (construcción del módulo de unificación):** **regenerar los tipos TS** contra staging (ya existen `accounting_entries`, `inventory_review_task`, las RPCs, las 3 columnas) → luego construir F3–F5 del SPEC (módulo de Inventarios, "Agregar" único, cascada en UI). Ver PROMPT-CONTINUACION §1.
- **✅ RESUELTO:** los archivos 040–043 fueron **MERGEADOS a `staging`** (`63ca7ce`) → el repo es fiel al esquema de la base.
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
