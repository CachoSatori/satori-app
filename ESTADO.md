# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-28.** Sesión de **infraestructura/seguridad — SIN código nuevo, SIN esquema, SIN datos.** Se cerró el **IDOR de `extract-document` EN PROD**, se **alineó `main` con prod**, y se tapó el footgun del link de Supabase **en staging**. **`staging` = `bb93335`** · **`main` = `a0d9f0d`**.
>
> **Lo que pasó esta sesión (3 cosas):**
> 1. **IDOR de `extract-document` → CERRADO EN PROD.** El fix (commit `c38a252`, "exigir JWT + RLS en el download") vivía **solo en staging**; la versión vieja (descarga con `service_role`, ignora RLS) estaba **desplegada en el Supabase de prod** → el IDOR estaba **vivo en producción**. Se **desplegó la versión segura al Supabase de prod** (`supabase functions deploy extract-document --project-ref yiczgdtirrkdvohdquzf`; **NO va por git** — la función vive en Supabase). Smoke negativo: `POST` sin `Authorization` → **`401`** (gateway, `UNAUTHORIZED_NO_AUTH_HEADER`). ✅ **Validación física:** la dueña leyó una factura real en prod con rol de caja → OK (RLS deja pasar a owner/manager/contador/cajero, mig 016). **Pendiente (OPCIONAL, no bloqueante):** prueba cross-user (usuario con rol fuera de caja → debe dar `403` "Sin acceso al documento"); no se hizo. El cierre está fundamentado en código + RLS + lectura OK.
> 2. **`main` ALINEADO con prod.** Commit `a0d9f0d` (FF): trae `supabase/functions/extract-document/index.ts` desde staging a main, **byte-idéntico** a lo que corre en prod (blob `65d1c3d`). **Un solo archivo.** El push a main disparó el deploy de **GitHub Pages** → **success** (el sitio reconstruido es idéntico: la Edge Function **no** entra al bundle del frontend).
> 3. **Footgun del link de Supabase → TAPADO EN STAGING.** Commit `bb93335` (rama `chore/gitignore-supabase-temp`): `git rm --cached supabase/.temp/` (sin borrar de disco) + línea `supabase/.temp/` en `.gitignore`. Mergeado a staging por FF. **OJO: solo en STAGING, NO en main** → en main `supabase/.temp/linked-project.json` sigue **trackeado apuntando a prod** (pendiente de portar, ver PROMPT-CONTINUACION).
>
> Historia detallada → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Fases → [ROADMAP.md](ROADMAP.md) · Backlog/PASE A PROD → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · Índice de SPECs → [docs/README.md](docs/README.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages.

> **PROD (`main` `a0d9f0d`) tiene las OLAS 1 y 1.1 de estabilidad + el fix de la PANTALLA NEGRA + la durabilidad de `createDayMovement` (todo validado físicamente) + 🆕 el fix del IDOR de `extract-document` (desplegado en el Supabase de prod + alineado en main).** FEATURES (PoS, Bandeja), el resto de seguridad/integridad (mig 039) y el esquema nuevo (040–044) viven en `staging`; a prod se va por **pase quirúrgico selectivo** (esta sesión: 1 archivo a main por FF), **NUNCA mergeando `staging`→`main` en bloque**.

---

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `a0d9f0d` | **PROD (estable, en uso).** = `79d8004` (capa de inteligencia + fixes SW/fechas + canario Realtime/candado + **OLA 1** + **OLA 1.1** + **PANTALLA NEGRA** `5f22754` + **durabilidad `createDayMovement`**) **+ 🆕 `extract-document/index.ts` alineado con prod** (fix IDOR `c38a252`, byte-idéntico a staging, blob `65d1c3d`; FF `79d8004`→`a0d9f0d`). Migraciones **≤021** (todo lo demás es client-side). **NO** tiene PoS/Bandeja/mig-039/040-044 **ni** el `.gitignore` de `supabase/.temp/` → en main `linked-project.json` **sigue trackeado apuntando a prod** (portar). |
| `staging` | `bb93335` | **Fuente de verdad del trabajo nuevo.** = `eefa056` (handoff 2026-06-27: todo `main` + PoS/KDS/comandero + Bandeja Etapa 1 + saga Realtime + durabilidad caja/outbox + auth-recovery mergeado + IDOR `c38a252` + cascada mig 039 + autorización de gerencia inline mig 044 + esquema 040–043 + tests DOM + limpieza de código muerto + borrar-día/descartar-turno por cascada + foto de factura normalizada) **+ 🆕 `chore` `.gitignore supabase/.temp/`** (`bb93335`: untrackea `.temp/` sin borrarlo de disco + lo ignora). |

> **Supabase refs:** **PROD = `yiczgdtirrkdvohdquzf`** ("satori-app", INTOCABLE salvo el `functions deploy` autorizado de esta sesión) · **STAGING = `hwiatgicyyqyezqwldia`** ("satori-staging").
> 🛑 **RITUAL OBLIGATORIO antes de CUALQUIER comando de base** (`migration list`, `db query`, `db push`, `dump`…): correr `cat supabase/.temp/linked-project.json` → el `"ref"` **DEBE** ser `hwiatgicyyqyezqwldia`. **El link puede quedar apuntando a PROD sin avisar.** Si no es staging: `supabase link --project-ref hwiatgicyyqyezqwldia` y re-verificar. **Nunca** correr DB sin confirmar el ref. Ver HALLAZGOS.md.

## (b) PROD vs STAGING

- **En PROD (`main` `a0d9f0d`):** ventas/analítica, propinas, caja (turnos + cierre 2 fases + movimientos + pendientes), ingesta foto vieja, finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline. Migraciones **001–021** + (client-side) fixes SW/fechas, canario, Olas 1+1.1, pantalla negra, durabilidad `createDayMovement`. **🆕 + IDOR de `extract-document` CERRADO** (Edge Function segura desplegada en el Supabase de prod + `extract-document/index.ts` alineado en main).
- **Solo en STAGING (no en main):** todo el **PoS** (catálogo/salón multi-local, comandero, KDS, cobro+splits+ticket SIM, `computeTotals`, FE estructura SIM, inventario activo COGS) · **Bandeja Etapa 1** · diag de Realtime · **cascada mig 039** · **autorización de gerencia inline (mig 044)** · esquema **040–043** aplicado a la base + archivos MERGEADOS · entorno de tests DOM · limpieza de código muerto · borrar-día/descartar-turno por cascada · foto de factura normalizada · **🆕 el `.gitignore` de `supabase/.temp/`** (`bb93335`). Migraciones **022–039** + **040–044** (estas últimas fuera del ledger).
- **En rama aparte (sin merge):** `propina-pool` (espera decisión). Esta sesión dejó dos ramas para review: `chore/gitignore-supabase-temp` (`bb93335`, ya mergeada a staging) y `fix/idor-extract-document-a-main` (`a0d9f0d`, ya mergeada a main).

## (c) Migraciones — **SIN cambios esta sesión**

| Entorno | En el ledger | Notas |
|---|---|---|
| **PROD** | **≤021** | Fixes SW/fechas/Realtime/Olas/pantalla-negra/`createDayMovement` son 100% client-side. El fix del IDOR de esta sesión es una **Edge Function** (no migración). |
| **STAGING** | **022–038** | 022–034 PoS · 036 FE · 037 inventario COGS · 038 Bandeja (firmada). |

**⚠️ Discrepancias de ledger (decisión: NO tocar el historial — reconciliación = sesión dedicada) — sin cambios esta sesión:**
- **009** drift histórico · **035** fantasma (archivo solo en `propina-pool`) · **039** aplicada por dashboard · **040–043** por `db query` · **044** (`delete_movement_cascade` 2→4 args) aplicada a la base de staging fuera de `schema_migrations`. Consecuencia: `db push` se frena por 009/035; NO usar `push`/`repair` hasta la sesión de reconciliación. Todo idempotente.

## (d) Build por módulo — **sin cambios de código esta sesión**

Esta sesión NO tocó código de la app (solo deploy de Edge Function + alineación de git + higiene de repo). **Deploy de GitHub Pages de `main` verde** (run "Deploy to GitHub Pages" → **success**; warning no bloqueante: las actions corren sobre Node 20 deprecado — ver PROMPT-CONTINUACION). El gate de verificación sigue siendo **`VITE_APP_ENV=production npm run build`** (typecheck real `tsc -b`).

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

## (e) Pendientes de PLATA — sin firma/decisión de la dueña — **SIN cambios esta sesión**

> No se tocó nada de plata esta sesión.

1. **`propina-pool`** (rama, sin merge) → pool del turno sin tocar `tipCalculations`. **DECISIÓN:** tarjeta/SINPE ¿al mismo pool que efectivo o separada?
2. **Hora-CR en bordes de período** — `finance.ts:132/139` (P&L borde de año en UTC). Cambia números → validación física. `_handoff/RCA-FECHAS-BORDE.md` §5.
3. **`fix/fecha-cr-consistente`** (`cb25672`, staging) → mes-CR de gastos de noche. Pendiente validación física.
4. **`fix-doble-cobro`** (mig 033, staging) → validación física + decisión de pase.
5. **🖊️ D5 ya implementada en 043** (borrar la foto al borrar la factura) — firmada en el SPEC; verificar comportamiento en staging cuando se construya la UI.

## (f) Pendientes humanos / fiscales / prolijidad — **humanos/fiscales SIN cambios esta sesión**

- **🆕 Prolijidad técnica de esta sesión** (detalle y prioridad → PROMPT-CONTINUACION): (i) **prueba cross-user del IDOR** [opcional]; (ii) **portar el `.gitignore` de `supabase/.temp/` a main** [trivial; hoy en main `linked-project.json` sigue trackeado apuntando a prod]; (iii) **bumpear las GitHub Actions** (`checkout@v4`/`setup-node@v4`/`upload-artifact@v4` corren sobre Node 20 deprecado) [deuda menor, no bloquea].
- **🔐 Rotar tokens de GitHub** (gho_ del remote de SATORI PROPINAS + PAT classic "Claude CLI") — **⚠️ la fecha objetivo (27-jun) ya pasó: rotar YA**.
- **PRÓXIMO (construcción del módulo de unificación):** regenerar los tipos TS contra staging → construir F3–F5 del SPEC. Ver PROMPT-CONTINUACION §★.
- **DIFERIDO — reconciliación del ledger** (009/035/039/040–043/044): sesión dedicada; resolver 035/`propina-pool` primero.
- **DIFERIDO — auth-recovery** (precond. Hallazgo B: outbox drena en `SIGNED_IN`).
- **PLAN DE PASE A PROD — OPCIÓN A (3 OLAS).** Olas 1 y 1.1 ✅ en prod. **🆕 El IDOR — prerequisito de la Ola 2 — YA está en prod** → la **Ola 2 (Bandeja Etapa 1 + mig 038) ya NO está bloqueada por el IDOR**. Detalle → PROMPT-CONTINUACION / ROADMAP.
- **GRAN PASE del PoS — DIFERIDO** (migs 022–037), bloqueado por el PILAR de escalabilidad de sesión/auth.
- **Riesgo latente (registrado, baja prioridad):** `/caja` + Cmd+Shift+R → redirige a `/login` ~20s (recuperable). RCA en la rama `rca/caja-hardreload-hang` (sin mergear).
- **Contadora:** códigos **CIIU/CABYS** (bloquean FE real).
- **⚠️ GOTCHA DE VERIFICACIÓN:** `tsc --noEmit` es **FALSO VERDE** (`tsconfig.json` raíz con `"files": []`). El typecheck REAL es **`VITE_APP_ENV=production npm run build`** (`tsc -b`). Toda verificación de pase corre el build, no `tsc --noEmit`.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión · `posFiscal`.
Todo el trabajo nuevo los **alimenta**, no los cambia.
