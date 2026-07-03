# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-07-03. Ola de 10 pases a STAGING (todos FF, todos validados físicamente por Ismael). PROD intacta.** Se cerró el trabajo grande de Caja/Cierre/Revisión: cierre visual + fórmula USD firmada, autorización de gerencia por SOLO contraseña (mig 045 firmada + aplicada a staging), Tier 3 completo (foto en Revisión, panel lateral, adjuntar con confirmación, orden y flujo guiado del asistente), Opción B (la diferencia del cierre entra al ledger como Ajuste), **propinas por la vía real (el faltante fantasma quedó enterrado)** y rediseño de Caja a tema claro. **`main` = `a14da50` (INTACTA)** · **`staging` = `ddb1c08`.**
>
> **Lo que pasó esta sesión, en una línea:** todo lo de arriba entró a `staging` por pases quirúrgicos FF-only; **NADA fue a `main`/PROD**; se aplicó **una** migración nueva (**045**) a **staging** (no a prod); se cambió el modelo de IA de la Edge Function a Sonnet **solo en staging**; y se destapó (y reconcilió en staging) una **deuda histórica de −$2678** en el ledger USD de Caja Fuerte.
>
> Historia detallada de esta sesión → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) (bloque 2026-07-03) · Fases → [ROADMAP.md](ROADMAP.md) · Backlog / PLAN DEL PASE A PROD → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · Índice de SPECs → [docs/README.md](docs/README.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages (`satori-staging.pages.dev`).

---

## (a) Ramas y proyectos Supabase

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `a14da50` | **PROD (estable, en uso). INTACTA esta sesión.** Capa de inteligencia + estabilidad (Olas 1/1.1, pantalla negra, `createDayMovement`) + IDOR de `extract-document` cerrado + GitHub Actions Node 24 + drain del outbox en `SIGNED_IN` + render de Propinas estabilizado. Migraciones **≤021** (el resto es client-side). **NO** tiene nada del PoS, Bandeja, unificación, ni ninguna de las 10 cosas de esta ola. |
| `staging` | `ddb1c08` | **Fuente de verdad del trabajo nuevo.** Todo `main` + PoS/KDS/comandero + Bandeja + unificación Bandeja↔Caja construida (asistente "➕ Agregar", Revisión de inventario) + toda la ola 2026-07-03 (cierre visual/USD, autorización por contraseña, Tier 3, Opción B, propinas vía real, tema claro). Migraciones **022–045** (038–045 aplicadas fuera del ledger). |

> **Supabase refs:** **PROD = `yiczgdtirrkdvohdquzf`** ("satori-app", INTOCABLE) · **STAGING = `hwiatgicyyqyezqwldia`** ("satori-staging").
> 🛑 **RITUAL OBLIGATORIO antes de CUALQUIER comando de base** (`migration list`, `db query`, `db push`, `dump`…): correr **`cat supabase/.temp/project-ref`** → **DEBE** decir `hwiatgicyyqyezqwldia`. **Cambió: ya NO es `linked-project.json` (no existe en el CLI v2.105) — es `project-ref`.** Si no es staging: `supabase link --project-ref hwiatgicyyqyezqwldia` y re-verificar. Ver HALLAZGOS.md.

## (b) PROD vs STAGING

- **En PROD (`main` `a14da50`):** ventas/analítica, propinas, caja (turnos + cierre 2 fases + movimientos + pendientes), ingesta foto vieja, finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline. Migraciones **001–021** + fixes client-side + IDOR de `extract-document` (Edge Function). **Nada de la ola de esta sesión.**
- **Solo en STAGING (no en main):** **PoS** completo (catálogo/salón, comandero, KDS, cobro+splits+ticket SIM, FE estructura SIM, inventario activo COGS) · **Bandeja + unificación Bandeja↔Caja construida** (F41–F43: "➕ Agregar" único, asistente foto/IA, Revisión de inventario) · cascada mig 039 · autorización inline mig 044 · esquema 040–043 · **🆕 toda la ola 2026-07-03:** cierre resumen+tema claro+fórmula USD firmada, **autorización SOLO por contraseña (mig 045)**, Tier 3 Revisión/asistente, **Opción B (ajuste al ledger)**, **propinas por la vía real**, tema claro de Caja. Migraciones **022–045**.
- **En rama aparte (sin merge):** `propina-pool` (espera decisión). Las 8 ramas feature de esta ola (`feat/...`, `fix/...`) están mergeadas a staging por FF y **quedan vivas en origin** por si la dueña quiere revisarlas antes del pase.

## (c) Migraciones

| Entorno | En el ledger (`schema_migrations`) | Notas |
|---|---|---|
| **PROD** | **≤021** | Todo lo posterior es client-side o Edge Function. **Ninguna mig 022–045 está en prod.** |
| **STAGING** | **022–038** en el ledger · **039–045 aplicadas FUERA del ledger** | 039 por dashboard · 040–043 por `db query` · 044 (delete_cascade 2→4 args) por `db query` · **🆕 045 (`045_verify_manager_by_password.sql`) aplicada a staging esta sesión** con `db query --linked`. |

**⚠️ Discrepancias de ledger (reconciliación = sesión dedicada, no tocar el historial):** 009 drift histórico · 035 fantasma (solo en `propina-pool`) · 039–045 aplicadas out-of-band. `db push` se frena por 009/035 — NO usar `push`/`repair` hasta la sesión de reconciliación. Todo idempotente. **Esto es deuda directa del pase a prod** (ver §f).

## (d) Build por módulo — todo validado físicamente por Ismael

Los 10 pases de esta ola fueron **validados físicamente en staging por Ismael** (no solo verde de CI). Gate de cada pase: **`VITE_APP_ENV=production npm run build` → EXIT 0 (con pipefail)** + suite completa verde (llegó a 38 archivos / 272 tests) + Cloudflare Pages verde + `version.json` = el commit esperado. ⚠️ El typecheck real es el **build** (`tsc -b`), NO `tsc --noEmit` (falso verde por `tsconfig` raíz con `files:[]`). ⚠️ El check **"Supabase Preview"** sale rojo crónico/pre-existente en todos los commits — ajeno; validan `Cloudflare Pages` (staging) y `build`+`deploy` Pages (prod).

Leyenda: ✅ validado físicamente / 🟢 verde sin validación física / 🔲 sin código.

| Módulo | Estado | Dónde |
|---|---|---|
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod (maduro; `cashUtils`/`tipCalculations`/`computeTotals` SAGRADOS) |
| Estabilidad (Olas 1+1.1) · Pantalla negra · `createDayMovement` · IDOR `extract-document` · outbox `SIGNED_IN` · render Propinas | ✅ EN PROD | prod |
| PoS (comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo COGS | 🟢 sin validación física | solo staging |
| Unificación Bandeja↔Caja construida (asistente "➕ Agregar" + Revisión de inventario) | ✅ validada | solo staging |
| **🆕 Cierre: resumen en filas + tema claro + verificación ₡\|US$ + fórmula USD firmada** (`calcDeberiaUSD` incluye `saldoBase.usd`) | ✅ validada | solo staging |
| **🆕 Autorización de gerencia SOLO POR CONTRASEÑA** (mig 045) + edición de pagos exige autorización | ✅ validada | solo staging (mig 045 en staging, NO prod) |
| **🆕 Tier 3 Revisión:** foto en detalle · panel lateral desktop con zoom · adjuntar con confirmación (pago intacto) | ✅ validada | solo staging |
| **🆕 Asistente:** orden nuevo + nota "sin foto" + flujo guiado (foto protagonista / manual) | ✅ validada | solo staging |
| **🆕 Opción B — Ajuste de cierre al ledger** (faltante→egreso, sobrante→ingreso, ₡ y US$; idempotente por `client_op_id` determinístico) | ✅ **firmada + validada** | solo staging |
| **🆕 Propinas por la VÍA REAL** (paga desde el cierre; la matemática resta propinas pagadas; faltante fantasma enterrado) | ✅ **firmada + validada** | solo staging |
| **🆕 Rediseño Caja tema claro** (KPI cards `.cd-saldo-*`, 4 pestañas) + Ajustes en ₡/US$ | ✅ validada | solo staging |

## (e) Pendientes de PLATA — FIRMADOS y APLICADOS (a staging) esta sesión

> Todo esto tiene **firma de la dueña** y **ya está aplicado en staging** (falta el pase a prod, §f).

1. **✅ Fórmula USD del cuadre de cierre (FIRMADA).** `calcDeberiaUSD` ahora incluye `saldoBase.usd` → detecta retiros USD sin registrar (antes invisibles). Destapó los −$2678 históricos.
2. **✅ Opción B — Ajuste de cierre al ledger (FIRMADA).** La diferencia del cierre se materializa como movimiento real en Caja Fuerte → el ledger arranca mañana del físico contado. Idempotente; deshacer borra el ajuste.
3. **✅ Propinas por la vía real (FIRMADA).** El cierre resta propinas efectivamente pagadas (movimientos), no un tipeo. `tipCalculations`/`calcTurno` **byte-idénticos** (sagrado intacto).
4. **🖊️ Foto de comprobante obligatoria al pagar propina** — DIFERIDO con firma (fuera de scope de esta ola; pase siguiente).
5. **`propina-pool`** (rama, sin merge) → decisión pendiente: tarjeta/SINPE ¿al mismo pool que efectivo o separada?

## (f) Deuda para el PASE ÚNICO A PROD (próxima sesión — plan completo en PROMPT-CONTINUACION)

El próximo trabajo grande es **un pase único, ordenado, de toda esta ola (`a4b1be3..ddb1c08`) a `main`**, en su propia sesión. Piezas:

1. **Cherry-pick FF-only de la ola a `main`**, en orden (ver PROMPT-CONTINUACION). NUNCA `staging`→`main` en bloque.
2. **Aplicar migraciones 038–045 en prod** — con la **reconciliación del ledger** primero (`schema_migrations` vs las aplicadas out-of-band en staging; resolver 009/035). Es la deuda que bloquea `db push`.
3. **Replicar el secret `ANTHROPIC_MODEL=claude-sonnet-4-5`** en el proyecto Supabase de **prod** (hoy solo en staging; mejora la lectura de facturas — validado por Ismael).
4. **Sinceramiento USD en prod:** repetir el ajuste inicial de Caja Fuerte (−$2678 espejo) con el **conteo físico del día del pase**.
5. **Verificar `version.json`** en el deploy vivo de GitHub Pages tras el pase.
- **Otros diferidos:** foto de comprobante al pagar propina; Tier 1 (monto-on-modify desde Revisión) **descartado por la dueña** (Revisión no modifica caja); reconciliación del ledger de migraciones (009/035/039–045).
- **🔐 Rotar tokens de GitHub** (gho_ + PAT "Claude CLI") — la fecha objetivo ya pasó, rotar YA.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja (la matemática del "debería") · cobro/vuelto/conversión · `posFiscal`.
Todo el trabajo nuevo los **alimenta**, no los cambia. (La ola de esta sesión tocó la *plomería* del cierre con firma, pero `tipCalculations`/`calcTurno`/`saldoCajaFuerte` quedaron byte-idénticos.)
