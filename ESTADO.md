# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-27.** Esta sesión **construyó la unificación Bandeja↔Caja en `staging`** (prod intacto):
> ETAPA 1 (tipos), **F3** (módulo de Revisión de inventario, validado físicamente), **F4.1** (la Bandeja
> manda la factura a Revisión + edición de mapeo/nota/proveedor), **fix de borrado en móvil** (modal in-app)
> y **fix de autorización del borrado** (mig **044**: el cajero puede borrar con credenciales de gerencia
> válidas; audita `authorized_by`). Todo mergeado a staging (`f1e1aa9`), gates verdes, revisado por el asesor.
>
> **Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
> **Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages (mergear a
> staging **NO** auto-despliega; el deploy se dispara aparte).
> Detalle histórico → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Fases → [ROADMAP.md](ROADMAP.md) · Backlog →
> [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos → [HALLAZGOS.md](HALLAZGOS.md) · SPEC unificación →
> [docs/SPEC-unificacion-bandeja-caja.md](docs/SPEC-unificacion-bandeja-caja.md) · Casos de borrado →
> [docs/auth-borrado-casos.md](docs/auth-borrado-casos.md).

---

## (a) Ramas

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `79d8004` | **PROD (estable, en uso) — INTACTO esta sesión.** Capa de inteligencia + Olas 1/1.1 de estabilidad + fix PANTALLA NEGRA + durabilidad `createDayMovement`. Migraciones **≤021** (el resto de prod es client-side). **NO** tiene PoS/Bandeja/IDOR/mig-039/040-044. |
| `staging` | `f1e1aa9` | **Fuente de verdad del trabajo nuevo.** Todo `main` + PoS/KDS/comandero + FE estructura + inventario activo + Bandeja Etapa 1 + IDOR cerrado + cascada mig 039 + **🆕 unificación Bandeja↔Caja (esquema 040–044 + F3 + F4.1) + fix borrado-móvil + fix auth-borrado**. |

> **Supabase refs:** PROD = `yiczgdtirrkdvohdquzf` (INTOCABLE) · STAGING = `hwiatgicyyqyezqwldia`.
> 🛑 **RITUAL OBLIGATORIO antes de CUALQUIER comando de base** (`db query`/`gen types`/`migration list`/…):
> `cat supabase/.temp/linked-project.json` → el `"ref"` **DEBE** ser `hwiatgicyyqyezqwldia`. El link puede quedar
> en PROD sin avisar (ya pasó). Si no es staging: `supabase link --project-ref hwiatgicyyqyezqwldia` y re-verificar.
> ⚠️ Pase a prod = **cherry-pick selectivo**, NUNCA `staging`→`main` (staging va ~45 commits / 23 migraciones adelante).

## (b) PROD vs STAGING

- **En PROD (`main` `79d8004`):** ventas/analítica, propinas, caja (turnos + cierre 2 fases + movimientos + pendientes), ingesta foto vieja, finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline. Migraciones **001–021**. **Sin cambios esta sesión.**
- **Solo en STAGING:** todo el **PoS** (catálogo/comandero/KDS/cobro+splits+ticket SIM, FE estructura SIM, inventario activo COGS) · **Bandeja Etapa 1** · **IDOR cerrado** · **cascada mig 039** · **🆕 unificación Bandeja↔Caja** (esquema 040–044 + módulo de Revisión F3 + Bandeja→Revisión F4.1 + edición de metadatos) · **🆕 fix de borrado en móvil** (modal in-app) · **🆕 fix de autorización del borrado** (mig 044) · entorno de tests DOM.

## (c) Migraciones — aplicadas y dónde

| Entorno | En el ledger (`schema_migrations`) | Fuera del ledger (aplicadas a mano) |
|---|---|---|
| **PROD** | **≤021** | — (todo lo demás en prod es client-side) |
| **STAGING** | **022–038** (022–034 PoS · 036 FE · 037 inventario COGS · 038 Bandeja) | **039** (dashboard) · **040–044** (vía `supabase db query --linked --file`) |

> **🆕 040–044 viven en staging FUERA de `schema_migrations`** (se aplicaron por `db query`, no `db push`). Sus archivos `.sql` están en `supabase/migrations/` (el repo es fiel a la base). **044** = autorización de gerencia inline en `delete_movement_cascade` (lógica verificada byte a byte; re-aplicada con solo comentarios en el pase de calidad).
> **⚠️ Discrepancias de ledger (NO tocar — reconciliación = sesión dedicada):** 009 drift · 035 fantasma (archivo solo en `propina-pool`) · 039 dashboard · 040–044 por `db query`. `db push`/`repair` se frenan por 009/035; todo es idempotente. La reconciliación pendiente **ahora incluye 044**.

## (d) Build por módulo

Leyenda: ✅ validado por la dueña · 🟢 verde (build+tests) sin validación física · 🟡 parcial · 🔲 sin código.

| Módulo | Estado | Dónde |
|---|---|---|
| Ventas · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod (maduro) |
| Estabilidad (Olas 1+1.1) · PANTALLA NEGRA · `createDayMovement` durabilidad | ✅ EN PROD, validado | prod (`79d8004`) |
| IDOR `extract-document` cerrado · Cascada inventario (mig 039) | 🟢/✅ | **solo staging** |
| Bandeja Etapa 1 | ✅ validada | staging (mig 038) |
| **🆕 Unificación — esquema 040–044** | 🟢 aplicado a la base de staging | base staging + `supabase/migrations/040–044` |
| **🆕 F3 — módulo de Revisión de inventario** (cola + completar/descartar) | ✅ **validado físicamente en staging** (fixture) | staging (`6e60f60`) |
| **🆕 F4.1 — Bandeja→Revisión + edición mapeo/nota/proveedor** | 🟢 verde (validación física en la app pendiente) | staging (`6863e26`) |
| **🆕 Fix borrado en móvil** (modal de nota in-app) | 🟢 (validación física en teléfono pendiente) | staging (`1eef42d`) |
| **🆕 Fix auth-borrado** (mig 044, cajero+credenciales) | 🟢 (lógica verificada; validación física pendiente) | staging (`7401a5a`/`f1e1aa9`) |
| PoS (comandero/KDS/cobro/ticket SIM) · FE SIM · Inventario activo | 🟢 sin validación física | staging |
| F4.2 (clasificación advisory en CashTurno) · F4.3 ("un solo Agregar") | 🔲 sin código | — (ver ROADMAP §1ter) |

## (e) Pendientes de PLATA — sin firma/decisión de la dueña

> ✅ Las migraciones **040–044 ya están FIRMADAS y aplicadas a staging** — fuera de "pendiente de firma".

1. **`propina-pool`** (rama, sin merge) → pool del turno sin tocar `tipCalculations`. DECISIÓN: ¿tarjeta/SINPE al mismo pool que efectivo o separada?
2. **Hora-CR en bordes de período** — `finance.ts` (P&L borde de año en UTC). Cambia números → validación física.
3. **`fix/fecha-cr-consistente`** (staging) → mes-CR de gastos de noche. Pendiente validación física.
4. **Pase a prod del IDOR + integridad mig 039** (con firma) — DIFERIDO por decisión de la dueña (unificación primero).

## (f) Pendientes humanos / fiscales / prolijidad

- **PRÓXIMO (unificación):** **F4.2** clasificación advisory en CashTurno + **F4.3** el asistente "un solo Agregar" (la unificación visual que falta). Ver PROMPT-CONTINUACION.
- **F4 — reorder del `document_id`** (no bloquea): hoy la tarea nace con `document_id=NULL` y Revisión lo resuelve por `cash_movement_id` (workaround). Fix limpio = en la Bandeja, `setDocEstado` ANTES de setear `classification` (sin migración).
- **Hallazgos del audit de autorización (NO bloquean):** (A) el override de gerencia es cosmético en tablas cuya RLS ya permite cajero; (B) "Borrar el día" (`discardDiaCompleto`) borra movimientos DIRECTO, salteando la cascada (sin auditoría/reversa/descarte de tarea).
- **Test de `buildReviewLines` pendiente** (cálculo de plata, sin test).
- **DIFERIDO — reconciliación del ledger** (009/035/039/040–044): sesión dedicada; resolver 035/`propina-pool` primero.
- **DIFERIDO — auth-recovery + Hallazgo B** (drain del outbox en `SIGNED_IN`): por decisión de la dueña, después de la unificación.
- **DIFERIDO — GRAN pase del PoS** (migs 022–037), bloqueado por el PILAR de escalabilidad de sesión/auth.
- **Contadora:** códigos **CIIU/CABYS** (bloquean FE real).
- **Riesgo latente (baja prioridad):** `/caja` + Cmd+Shift+R → redirige a `/login` ~20s (recuperable). RCA en la rama `rca/caja-hardreload-hang` (sin mergear, no está en staging).
- **⚠️ GOTCHA DE VERIFICACIÓN:** `tsc --noEmit` es **FALSO VERDE** (`tsconfig.json` raíz con `"files": []`). El typecheck REAL es **`VITE_APP_ENV=production npm run build`** (`tsc -b`).

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión · `posFiscal`.
Todo el trabajo nuevo los **alimenta**, no los cambia.
