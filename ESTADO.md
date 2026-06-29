# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-28 (continuación — CI/infra + 2 fixes de plata client-side). SIN esquema, SIN datos.** CI/infra (Actions @v5/Node 24 en main+staging, `.temp/` untrackeado en main, 2 ramas de prep borradas) **+ Hallazgo B cerrado** (drain del outbox en `SIGNED_IN`) **+ estabilización del render de Propinas** (no más parpadeo "₡ —"). Los 2 fixes de plata son client-side puro (matemática intacta) y 🟢 en staging, **pendientes validación física**. **`main` = `52d1475`** · **`staging` = `ec70598`**.
>
> **Lo que pasó esta sesión (3 cosas):**
> 1. **GitHub Actions del `deploy.yml` → Node 24 (`@v5`), en MAIN y STAGING.** `actions/checkout@v5` · `setup-node@v5` · `upload-pages-artifact@v5` · `deploy-pages@v5` (GitHub forzaba Node 24 desde 2-jun y retira Node 20 el 16-sep). **MAIN `52d1475`** (FF; deploy de GitHub Pages **verde**, build 29s + deploy 10s, y **el warning de Node 20 desapareció** — 0 anotaciones). **STAGING `3b821f0`** (FF; el workflow **no** corre en staging — es solo cerrar el drift). `deploy.yml` ahora **byte-idéntico entre main y staging**. **NO se tocó `node-version: 20` del build** (es el Node del build de prod; subirlo a 22 es un cambio aparte → PROMPT-CONTINUACION).
> 2. **`supabase/.temp/` untrackeado + ignorado también en MAIN** (`52d1475`, FF; recreado a mano, **no** cherry-pick, porque el `.gitignore` de main no tenía la línea `.claude/` de staging). Antes el fix vivía **solo en staging** → en main `linked-project.json` seguía **trackeado apuntando a PROD** (`yiczgdtirrkdvohdquzf`). Ahora **un clon fresco de main ya NO arranca enlazado a prod.** Los archivos quedan en disco (solo se untrackean). Gate `VITE_APP_ENV=production npm run build` → **EXIT 0**.
> 3. **Limpieza de ramas.** Las 2 ramas de prep (`chore/gitignore-supabase-temp-a-main` → main, `chore/bump-actions-node24` → staging) se integraron por FF y **se borraron del remoto** (verificadas como contenidas antes de borrar).
> 4. **🆕 Hallazgo B (PLATA, client-side) → CERRADO EN STAGING.** `492eaa5` (rama `fix/outbox-flush-on-signin`, FF, ya borrada): `initOutbox` drena el outbox **al reloguear** (`supabase.auth.onAuthStateChange` gateado a `SIGNED_IN` vía el predicado testeable `shouldFlushOnAuthEvent` → reset de backoff + `autoFlush`, **no** `flushNow` directo); guard `outboxWired` contra doble-registro. **NO** toca el `onAuthStateChange` global de `supabase.ts` ni el esquema. +4 tests; build EXIT 0; 155 verdes. **Desbloquea la precondición del auth-recovery.** ⏳ Pendiente validación física (es plata).
> 5. **🆕 Render de Propinas ESTABILIZADO → en STAGING (PLATA, client-side).** `ec70598` (rama `fix/propinas-render-estabilidad`, FF): bug de prod que dejaba Propinas **inusable** (los "Take Home" parpadeaban a "₡ —" al editar; el picker de Coberturas mostraba/perdía gente). Fix: `take_home`/`pts_val` **DERIVADOS en un `useMemo`** (no en estado → nunca un frame en 0); el picker **excluye a los activos** (helper puro `availableForCobertura`) y `addCobertura`/`removeCobertura` **persisten** (upsert/delete → sobreviven un refetch); el refetch por auto-eco se corta con `pauseWhile` (3s) + `lastLocalWriteRef`. **`tipCalculations.ts`/`calcTurno` BYTE-IDÉNTICO** → el payout al cerrar es **idéntico** (merge 1:1 verificado; el `?? 0` es código muerto); `tips.ts` sin cambios de firma; **sin migración**. Build EXIT 0, 159 tests verdes, **verificación adversarial 4/4 PASS**. ⏳ Pendiente validación física. **Bug de PROD → el port a prod es PRIORITARIO** (cherry-pick selectivo: `TipsModule.tsx` byte-idéntico en main → entra limpio; los 2 archivos nuevos no chocan), con firma + ritual de build.
>
> Historia detallada → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Fases → [ROADMAP.md](ROADMAP.md) · Backlog/PASE A PROD → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · Índice de SPECs → [docs/README.md](docs/README.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages.

> **PROD (`main` `52d1475`) tiene las OLAS 1 y 1.1 de estabilidad + el fix de la PANTALLA NEGRA + la durabilidad de `createDayMovement` + el fix del IDOR de `extract-document` (todo validado físicamente) + 🆕 las GitHub Actions del deploy en Node 24 (`@v5`) y el untrack de `supabase/.temp/`.** FEATURES (PoS, Bandeja), el resto de seguridad/integridad (mig 039) y el esquema nuevo (040–044) viven en `staging`; a prod se va por **pase quirúrgico selectivo**, **NUNCA mergeando `staging`→`main` en bloque**.

---

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `52d1475` | **PROD (estable, en uso).** = `a0d9f0d` (capa de inteligencia + fixes SW/fechas + canario Realtime/candado + **OLA 1** + **OLA 1.1** + **PANTALLA NEGRA** `5f22754` + **durabilidad `createDayMovement`** + **IDOR `extract-document` alineado con prod**, blob `65d1c3d`) **+ 🆕 GitHub Actions del `deploy.yml` en Node 24 (`@v5`)** (`1788520`, FF) **+ 🆕 `supabase/.temp/` untrackeado + ignorado** (`52d1475`, FF; `linked-project.json` ya NO se trackea → clon fresco no arranca en prod). Migraciones **≤021** (todo lo demás es client-side). **NO** tiene PoS/Bandeja/mig-039/040-044. |
| `staging` | `ec70598` | **Fuente de verdad del trabajo nuevo.** = `bb93335` (handoff 2026-06-28: todo `main` + PoS/KDS/comandero + Bandeja Etapa 1 + saga Realtime + durabilidad caja/outbox + auth-recovery + IDOR `c38a252` + cascada mig 039 + autorización de gerencia inline mig 044 + esquema 040–043 + tests DOM + limpieza de código muerto + borrar-día/descartar-turno por cascada + foto de factura normalizada + `.gitignore` de `supabase/.temp/`) **+ GitHub Actions del `deploy.yml` en Node 24 (`@v5`)** (`3b821f0`, FF; `deploy.yml` byte-idéntico a main; el workflow **no** corre en staging — solo cierra el drift) **+ drain del outbox en `SIGNED_IN`** (`492eaa5`, Hallazgo B) **+ 🆕 render de Propinas estabilizado** (`ec70598`; take_home derivado en useMemo + picker de coberturas + refetch gateado; `calcTurno` byte-idéntico, payout idéntico, sin migración). |

> **Supabase refs:** **PROD = `yiczgdtirrkdvohdquzf`** ("satori-app", INTOCABLE salvo el `functions deploy` autorizado de esta sesión) · **STAGING = `hwiatgicyyqyezqwldia`** ("satori-staging").
> 🛑 **RITUAL OBLIGATORIO antes de CUALQUIER comando de base** (`migration list`, `db query`, `db push`, `dump`…): correr `cat supabase/.temp/linked-project.json` → el `"ref"` **DEBE** ser `hwiatgicyyqyezqwldia`. **El link puede quedar apuntando a PROD sin avisar.** Si no es staging: `supabase link --project-ref hwiatgicyyqyezqwldia` y re-verificar. **Nunca** correr DB sin confirmar el ref. Ver HALLAZGOS.md.

## (b) PROD vs STAGING

- **En PROD (`main` `52d1475`):** ventas/analítica, propinas, caja (turnos + cierre 2 fases + movimientos + pendientes), ingesta foto vieja, finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline. Migraciones **001–021** + (client-side) fixes SW/fechas, canario, Olas 1+1.1, pantalla negra, durabilidad `createDayMovement`. **+ IDOR de `extract-document` CERRADO** (Edge Function segura desplegada en el Supabase de prod + `extract-document/index.ts` alineado en main). **🆕 + GitHub Actions del deploy en Node 24 (`@v5`) + `supabase/.temp/` untrackeado** (clon fresco de main ya no arranca en prod).
- **Solo en STAGING (no en main):** todo el **PoS** (catálogo/salón multi-local, comandero, KDS, cobro+splits+ticket SIM, `computeTotals`, FE estructura SIM, inventario activo COGS) · **Bandeja Etapa 1** · diag de Realtime · **cascada mig 039** · **autorización de gerencia inline (mig 044)** · esquema **040–043** aplicado a la base + archivos MERGEADOS · entorno de tests DOM · limpieza de código muerto · borrar-día/descartar-turno por cascada · foto de factura normalizada · **🆕 el `.gitignore` de `supabase/.temp/`** (`bb93335`). Migraciones **022–039** + **040–044** (estas últimas fuera del ledger).
- **En rama aparte (sin merge):** `propina-pool` (espera decisión). 🆕 Las 2 ramas de prep de esta sesión (`chore/gitignore-supabase-temp-a-main` → main, `chore/bump-actions-node24` → staging) ya se integraron por FF y **se borraron del remoto**.

## (c) Migraciones — **SIN cambios esta sesión**

| Entorno | En el ledger | Notas |
|---|---|---|
| **PROD** | **≤021** | Fixes SW/fechas/Realtime/Olas/pantalla-negra/`createDayMovement` son 100% client-side. El fix del IDOR (sesión previa) es una **Edge Function** (no migración). El bump de Actions + untrack de `.temp/` de esta sesión no tocan el ledger. |
| **STAGING** | **022–038** | 022–034 PoS · 036 FE · 037 inventario COGS · 038 Bandeja (firmada). |

**⚠️ Discrepancias de ledger (decisión: NO tocar el historial — reconciliación = sesión dedicada) — sin cambios esta sesión:**
- **009** drift histórico · **035** fantasma (archivo solo en `propina-pool`) · **039** aplicada por dashboard · **040–043** por `db query` · **044** (`delete_movement_cascade` 2→4 args) aplicada a la base de staging fuera de `schema_migrations`. Consecuencia: `db push` se frena por 009/035; NO usar `push`/`repair` hasta la sesión de reconciliación. Todo idempotente.

## (d) Build por módulo — **2 fixes de plata client-side esta sesión (Hallazgo B + render de Propinas)**

Esta sesión: CI (bump de Actions + untrack de `.temp/`) **+ 2 fixes de plata client-side** (Hallazgo B y la estabilización del render de Propinas — ambos 🟢 en staging, `calcTurno`/sagrados **byte-idénticos**, sin migración, pendientes validación física). **Deploy de GitHub Pages de `main` (`52d1475`) verde** (run "Deploy to GitHub Pages" → **success**, build 29s + deploy 10s) **y el warning de Node 20 desapareció** (0 anotaciones — las actions ahora corren `@v5`/Node 24). **El `node-version: 20` del build sigue igual** (es el Node del build de prod; subirlo a 22 es un cambio aparte → PROMPT-CONTINUACION). El gate de verificación sigue siendo **`VITE_APP_ENV=production npm run build`** (typecheck real `tsc -b`; **EXIT 0** esta sesión). ⚠️ Nota CI: el check **"Supabase Preview"** (GitHub App) sale en rojo de forma **crónica y pre-existente** (idéntico en `a0d9f0d`/`1788520`/`52d1475`), ajeno a este cambio; lo que valida el deploy es `build`+`deploy` (Pages) y `Cloudflare Pages`, en verde.

Leyenda: ✅ validado por la dueña / 🟢 verde sin validación física / 🟡 parcial / 🔲 sin código.

| Módulo | Estado | Dónde |
|---|---|---|
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod (maduro; `cashUtils`/`tipCalculations`/`computeTotals` SAGRADOS) |
| Estabilidad (Olas 1+1.1) · PANTALLA NEGRA · `createDayMovement` durabilidad | ✅ **EN PROD, VALIDADO** | prod |
| **🆕 IDOR `extract-document` cerrado** | ✅ **EN PROD** (desplegado + main alineado) · validación física: lectura OK con rol de caja · pendiente OPCIONAL prueba cross-user | prod (Edge Function en Supabase + `a0d9f0d`) + staging (`c38a252`) |
| Cascada de inventario (mig 039) · Autorización de gerencia inline (mig 044) | ✅/🟢 | **solo staging** |
| Borrar-día / descartar-turno por la cascada · Bandeja: foto normalizada | ✅ validada físicamente | **solo staging** (`b8ab78c` / `eefa056`) |
| Auth-recovery (escape loop OFFLINE_WAITING) | 🟡 **DIFERIDO** (gate >1h pasó; posiblemente innecesario) | mergeado en staging |
| Esquema unificación 040–043 · Entorno de tests DOM | 🟢 aplicado/mergeado a staging | **solo staging** |
| Bandeja Etapa 1 | ✅ COMPLETA y validada | staging (mig 038) |
| PoS (catálogo/comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo | 🟢 sin validación física | staging |
| **🆕 Render de Propinas estabilizado** (take_home derivado en useMemo; picker de coberturas; refetch gateado) | 🟢 **en STAGING** (`ec70598`) — build EXIT 0 + 159 tests + verif. adversarial 4/4 · ⏳ validación física pendiente | **solo staging**; `calcTurno` byte-idéntico, payout idéntico, sin migración. **Port a prod PRIORITARIO** (bug de prod; cherry-pick limpio) |

## (e) Pendientes de PLATA — sin firma/decisión de la dueña — **SIN cambios esta sesión**

> No se tocó nada de plata esta sesión.

1. **`propina-pool`** (rama, sin merge) → pool del turno sin tocar `tipCalculations`. **DECISIÓN:** tarjeta/SINPE ¿al mismo pool que efectivo o separada?
2. **Hora-CR en bordes de período** — `finance.ts:132/139` (P&L borde de año en UTC). Cambia números → validación física. `_handoff/RCA-FECHAS-BORDE.md` §5.
3. **`fix/fecha-cr-consistente`** (`cb25672`, staging) → mes-CR de gastos de noche. Pendiente validación física.
4. **`fix-doble-cobro`** (mig 033, staging) → validación física + decisión de pase.
5. **🖊️ D5 ya implementada en 043** (borrar la foto al borrar la factura) — firmada en el SPEC; verificar comportamiento en staging cuando se construya la UI.

## (f) Pendientes humanos / fiscales / prolijidad — **humanos/fiscales SIN cambios esta sesión**

- **🆕 Prolijidad técnica** (detalle y prioridad → PROMPT-CONTINUACION): (i) **prueba cross-user del IDOR** [opcional, sigue pendiente]; (ii) **subir el `node-version: 20` del build a Node 22** [aparte; toca el toolchain del build de prod]; (iii) **check "Supabase Preview" en rojo crónico** [pre-existente, ajeno a este operativo; mirar aparte — parece config/secret del GitHub App de Supabase branching]. **✅ Cerrado esta sesión:** bump de GitHub Actions a `@v5`/Node 24 (main+staging, deploy verde, warning de Node 20 ido) y untrack de `supabase/.temp/` a main (footgun del link cerrado para clones frescos).
- **🆕 PORT A PROD PRIORITARIO — estabilización del render de Propinas** (`ec70598`, 🟢 en staging): es un **bug de PROD** que deja Propinas inusable (parpadeo de Take Home + picker de coberturas). Va por **cherry-pick selectivo** (`TipsModule.tsx` byte-idéntico en main → entra limpio; los 2 archivos nuevos `tipShiftHelpers.ts`/`.test.ts` no chocan), con **firma de la dueña + ritual de build**, tras validación física en staging.
- **🔐 Rotar tokens de GitHub** (gho_ del remote de SATORI PROPINAS + PAT classic "Claude CLI") — **⚠️ la fecha objetivo (27-jun) ya pasó: rotar YA**.
- **PRÓXIMO (construcción del módulo de unificación):** regenerar los tipos TS contra staging → construir F3–F5 del SPEC. Ver PROMPT-CONTINUACION §★.
- **DIFERIDO — reconciliación del ledger** (009/035/039/040–043/044): sesión dedicada; resolver 035/`propina-pool` primero.
- **DIFERIDO — auth-recovery** (precond. **Hallazgo B — drain del outbox en `SIGNED_IN` — ✅ CERRADA en staging** `492eaa5`; ya no bloquea si se retoma).
- **PLAN DE PASE A PROD — OPCIÓN A (3 OLAS).** Olas 1 y 1.1 ✅ en prod. **🆕 El IDOR — prerequisito de la Ola 2 — YA está en prod** → la **Ola 2 (Bandeja Etapa 1 + mig 038) ya NO está bloqueada por el IDOR**. Detalle → PROMPT-CONTINUACION / ROADMAP.
- **GRAN PASE del PoS — DIFERIDO** (migs 022–037), bloqueado por el PILAR de escalabilidad de sesión/auth.
- **Riesgo latente (registrado, baja prioridad):** `/caja` + Cmd+Shift+R → redirige a `/login` ~20s (recuperable). RCA en la rama `rca/caja-hardreload-hang` (sin mergear).
- **Contadora:** códigos **CIIU/CABYS** (bloquean FE real).
- **⚠️ GOTCHA DE VERIFICACIÓN:** `tsc --noEmit` es **FALSO VERDE** (`tsconfig.json` raíz con `"files": []`). El typecheck REAL es **`VITE_APP_ENV=production npm run build`** (`tsc -b`). Toda verificación de pase corre el build, no `tsc --noEmit`.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión · `posFiscal`.
Todo el trabajo nuevo los **alimenta**, no los cambia.
