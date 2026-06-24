# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-24** (Realtime tras suspensión ✅ **RESUELTO Y VALIDADO** en staging — máquina de 3 estados + gateo de la emisión de `rt:healthy` + endurecimiento de `SESSION_EXPIRED` · durabilidad de escritura de CAJA ✅ en staging). Foto compacta para ponerse al día de un vistazo.
> Historia detallada → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Plan por fases → [ROADMAP.md](ROADMAP.md) · Backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · RCA Realtime → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages.

> **⚠️ PROD (`main`) está FUERA DE USO — riesgo cero, NO tocar.** Todo el trabajo vivo es `staging`.

---

## (a) Ramas

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `04b1a32` | **PROD (fuera de uso).** Capa de inteligencia + fix SW viejo (`fde9264`) + fix fechas-borde (`ff836a0`) + **canario Realtime/candado de auth** (R1 `setAuth` global + saca `getSession` por-hook + guard `channel===ch`; sin round 2). **NO** tiene el PoS, ni la Bandeja, ni la saga Realtime/suspensión nueva. |
| `staging` | `3a0fd20` | **Fuente de verdad del trabajo nuevo.** Todo lo de `main` + PoS/KDS/comandero + FE estructura + inventario activo + Bandeja Etapa 1 + **saga Realtime/suspensión CERRADA** (máquina de 3 estados `63ef0bb` + gateo del emit y endurecimiento de `SESSION_EXPIRED` `3a0fd20`) + **durabilidad de escritura de caja (jun-23, `0dd258b`)** + switch de diagnóstico de Realtime solo-staging. Instrumentación `[rt-diag]` y `[diag-repro]` **siguen activas** (se borran en el pase quirúrgico a main, ver §b y PROMPT-CONTINUACION). |

> Supabase refs: **PROD** = `yiczgdtirrkdvohdquzf` (intocable) · **STAGING** = `hwiatgicyyqyezqwldia`.
> Ramas de la saga Realtime (todas mergeadas a staging): `fix/realtime-jwt-refresh` (R1) · `fix/realtime-socket-revive` (R2, **REVERTIDO**) · `fix/auth-lock-contention` (`09480a6`) · `fix/realtime-resume-refresh` (`97d9c75`) · `fix/realtime-worker-heartbeat` (`b7cf327`/`7cd7760`) · `fix/realtime-resume-diagnostics` (`28901c4`) · `fix/realtime-reauth-emit` + `fix/realtime-reauth-timeout` + `fix/realtime-resume-revive` (blindaje 8s + cinturón 40s; **approach intermedio que dejaba un loop `InvalidJWT` → REEMPLAZADO**) · **`fix/realtime-3state-machine` (`63ef0bb`)** = máquina de 3 estados · **`fix/realtime-emit-gating` (`3a0fd20`)** = gateo del emit + endurecimiento `SESSION_EXPIRED`. Cronología completa → RCA + `ESTADO-ARCHIVO.md` (2026-06-24).

## (b) ✅ Realtime tras suspensión profunda — RESUELTO Y VALIDADO en staging (`3a0fd20`)

**Raíz (dos capas).** (1) Desync token HTTP↔socket: tras ~25 min suspendido el socket queda con **JWT vencido** pero
`isConnected()=true` y heartbeat ok → el SDK lo cree vivo. (2) La conexión TCP queda **zombi** y las auth-ops
(`getSession`/`refreshSession`) que la recuperación usaba **se colgaban** → `ensureRealtimeHealthy` clavado → app
muerta hasta recargar.

**La solución (cerrada, 100% client-side):** `ensureRealtimeHealthy` es una **MÁQUINA DE 3 ESTADOS** que clasifica el
resultado de las auth-ops (con tope `withTimeout` 8s) en EXACTAMENTE uno de:
- **`ONLINE_SUBSCRIBED`** (token fresco CONFIRMADO) → `setAuth` + revive socket si cayó + **única** emisión de `rt:healthy`.
- **`OFFLINE_WAITING`** (red zombi / refresh colgado) → NO emite, renueva el TCP y reintenta con backoff (3s→30s, un único timer).
- **`SESSION_EXPIRED`** (solo si `refresh.error`) → NO toca el socket; deja actuar el deslogueo declarativo.

**Regla madre:** nunca emitir `rt:healthy` ni re-suscribir sin token fresco confirmado; ningún camino termina en loop.
Esto **mató el loop `InvalidJWT`** del viejo emit-on-timeout (`63ef0bb`). Encima: **gateo del emit** con flag
`healthyAwaited` (emite solo si hay recuperación pendiente → arregla la regresión de arranque) y **endurecimiento de
`SESSION_EXPIRED`** (`getSession→null` transitorio del arranque ya no desloguea; lo arbitra `refresh.error`) — `3a0fd20`.

**Validado físicamente** en el staging desplegado con `window.__satoriDiag`: `armZombie` → `OFFLINE_WAITING` + backoff
**sin loop ni `InvalidJWT`**; `disarm` → `ONLINE_SUBSCRIBED` emite y recupera a `SUBSCRIBED`; **arranque sin cascada
CLOSED**; **foco rutinario → `setAuth` SIN emit** (sin churn). Cronología completa →
[docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md) + `ESTADO-ARCHIVO.md` (2026-06-24).

> **Instrumentación `[rt-diag]` (en `supabase.ts` y `useRealtimeRefetch.ts`) y `[diag-repro]` (switch
> `src/shared/diag/realtimeReproSwitch.ts`, `window.__satoriDiag`) SIGUEN ACTIVAS — NO borrar** todavía: se remueven
> por prefijo en el **pase quirúrgico de estabilidad a main** (Ola 1 — PROMPT-CONTINUACION §1). El switch está gateado por
> `VITE_APP_ENV==='staging'` (el DCE lo elimina de prod).

## (c) PROD vs STAGING

- **En PROD (`main` `04b1a32`, fuera de uso):** ventas/analítica, propinas, caja (turnos + cierre día 2 fases +
  movimientos + pendientes), ingesta foto vieja, finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline.
  Migraciones **001–021**. **+** fix SW viejo, fix fechas-borde, y el **canario Realtime/candado** (R1 + fix final).
- **Solo en STAGING (no en prod):** todo el **PoS** (catálogo+salón multi-local, comandero, KDS, cobro+splits+ticket
  SIM, `computeTotals`, FE estructura SIM, inventario activo depleción+COGS) · **Bandeja fusionada Etapa 1** + enlace
  proveedor↔caja + visibilidad pendientes + fechas CR · **saga Realtime/suspensión CERRADA** (worker:true + máquina de
  3 estados + gateo del emit + endurecimiento `SESSION_EXPIRED`, `[rt-diag]`) **+ durabilidad de escritura de caja jun-23**
  (reintento con tope + encola SIEMPRE en outbox) **+ switch de diagnóstico de Realtime solo-staging** (`window.__satoriDiag`, §b).
  Migraciones **022–038** (el trabajo de Realtime/caja es client-only, sin migración).
- **En rama aparte (sin merge):** `propina-pool` (espera decisión de la dueña).

## (d) Migraciones

| Entorno | Hasta | Notas |
|---|---|---|
| **PROD** | **021** | Los fixes SW/fechas/Realtime son 100% client-side (sin migración). |
| **STAGING** | **038** | 022–034 PoS · 036 FE estructura · 037 inventario COGS · **038 Bandeja** (firmada por la dueña). ⚠️ **035:** el ledger la marca aplicada pero el archivo solo vive en `propina-pool` (sin merge) → **discrepancia A INVESTIGAR**, sin tocar el historial. ⚠️ Verificar estado real de la **038** en el ledger antes de actuar (a PROD va con el pase del PoS). |

## (e) Lo construido, por módulo

Leyenda: ✅ validado por la dueña / 🟢 hecho y verde (tests+build) sin validación física / 🟡 parcial / 🔴 pendiente clave.

| Módulo | Estado | Dónde | Nota |
|---|---|---|---|
| Ventas/analítica · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod | maduro. `cashUtils`/`tipCalculations`/`computeTotals` SAGRADOS |
| Estabilidad PWA — SW viejo | ✅ **en PROD** | prod (`fde9264`) | updateViaCache:'none' + version.json cache-bust |
| Fechas de borde de mes (`-31`→400) | ✅ **en PROD** | prod (`ff836a0`) | `monthRangeBounds`, result-preserving |
| Realtime/candado de auth (R1 + fix final) | ✅ **en PROD vía canario** | prod (`04b1a32`) | `setAuth` global + saca `getSession` por-hook. Round 2 REVERTIDO. |
| **Realtime tras suspensión profunda** | ✅ **RESUELTO Y VALIDADO** (máquina de 3 estados + gateo del emit + endurecimiento `SESSION_EXPIRED`) | solo staging (`63ef0bb`+`3a0fd20`) | Ver §(b) + RCA. Validado físico con `__satoriDiag`. `[rt-diag]`/`[diag-repro]` activos hasta el pase quirúrgico a main. |
| **Caja — durabilidad de escritura** (reintento con tope + outbox) | ✅ **en staging** (mergeado, test verde) | staging (`0dd258b`) | El reintento corre con `withWriteTimeout` y, ante timeout/red-zombi, **encola SIEMPRE en el outbox** (idempotente por `client_op_id`). Antes el reintento corría sin tope y el encolado dependía de `navigator.onLine` (miente en zombi) → se perdía el pago. Test `cash.durability.test.ts`. |
| **Diagnóstico Realtime — switch de reproducción** (solo-staging) | ✅ **validado en staging** (se usó para cerrar la saga) | staging | `window.__satoriDiag` (`armZombie`/`armExpired`/`disarm`/`status`); `armZombie` dispara CHANNEL_ERROR al instante → reproduce el cuelgue de 3+ h en ~30 s. DCE lo elimina de prod. Logs `[diag-repro]`. |
| **Bandeja ETAPA 1** (unificada `/inbox`, foto+IA + enlace proveedor↔caja + visibilidad pendientes) | ✅ **COMPLETA y validada** | staging | mig 038, validada con rol contador. **= candidata de la Ola 2.** |
| **Bandeja ETAPA 2** (entrada foto-primero 100% dentro de Caja Diaria) | 🔲 **DISEÑADA, SIN código** | — | NO hay nada en `src/modules/cash` ni `inbox`. = Ola 3, gated por decisión de la dueña (¿alcanza la Etapa 1?). |
| PoS — catálogo/comandero/KDS/cobro/ticket SIM · FE estructura SIM · Inventario activo F1 | 🟢 | staging | sin validación física; pase a prod pendiente |

## (f) Pendientes de PLATA — sin firma/decisión de la dueña (NO mergear/aplicar sin OK)

1. **`propina-pool`** (rama, sin merge) → conecta `pos_payments.tip_crc` al pool del turno sin tocar `tipCalculations`. **DECISIÓN abierta:** tarjeta/SINPE ¿al mismo pool que efectivo o separada? `git show propina-pool:ESTADO-PROPINA-POOL.md`.
2. **Hora-CR en bordes de período** — misma familia que el `-31`, **NO tocada porque cambia números**: `finance.ts:132/139` (P&L borde de **año**, rango en UTC `…Z` + offset +6h). Requiere validación física. Ver `_handoff/RCA-FECHAS-BORDE.md` §5.
3. **`fix/fecha-cr-consistente`** (`cb25672`, en staging) → mes-CR de gastos de noche en P&L. Pendiente validación física.
4. **`fix-doble-cobro`** (mig 033, en staging) → falta validación física + decisión de pase a PROD.

## (g) Pendientes humanos / operativos / prolijidad

- **🔴 PLAN DE PASE A PROD — decisión de la dueña: OPCIÓN A (estabilidad primero, 3 OLAS).** Prod (`main`) está FUERA DE USO → primero **devolver la app estable**, recién después features. ⚠️ **Staging está ~143 commits y ~16 migraciones adelante de main → NUNCA mergear `staging`→`main`; a prod se va por _cherry-pick selectivo_.** Detalle por ola → PROMPT-CONTINUACION (cabecera).
  - **OLA 1 (PRIORIDAD 1) — pase QUIRÚRGICO de estabilidad a main:** cherry-pick de la cadena Realtime (worker:true + blindaje + máquina de 3 estados + gateo del emit + endurecimiento `SESSION_EXPIRED`) **+ durabilidad de escritura de caja**, **SIN el PoS**. Client-side, sin migración. Pre-req: **borrar logs `[rt-diag]`/`[diag-repro]` por prefijo**, confirmar tree-shaking del código solo-staging en build de prod (`window.__satoriDiag`; ojo footgun `.env.local`), ritual de pase con firma física. Objetivo: caja/propinas/ventas de vuelta en prod **sin cuelgues**.
  - **OLA 2 (tras Ola 1) — Bandeja ETAPA 1 a prod** (ya construida y validada en staging) **con la mig 038** (esquema → firma de la dueña). ⚠️ A verificar al planearla: si la **mig 038 / Etapa 1 se separan limpio de las migraciones del PoS (022–037)** o vienen acopladas. Da **foto+IA real** sin construir nada nuevo.
  - **OLA 3 (cuando la base esté sólida) — CONSTRUIR la Bandeja ETAPA 2** (entrada foto-primero 100% dentro de Caja Diaria; hoy **🔲 diseñada, SIN código**). **Solo si** tras usar la Etapa 1 sigue haciendo falta → **DECISIÓN ABIERTA de la dueña**.
- **🔐 Rotar 2 tokens de GitHub:** (a) `gh auth refresh -s repo,read:org,workflow` (el `gho_` que estaba embebido en el remote de `SATORI PROPINAS` ya fue limpiado del config, pero sigue válido en GitHub hasta rotarlo); (b) **regenerar el PAT classic `ghp_` "Claude CLI" sin scope `admin:org`** — su valor quedó en un transcript local; rotar **antes del 27-jun**.
- **GRAN PASE del PoS a PROD — DIFERIDO** (NO es parte de las 3 olas; la dueña eligió estabilidad primero): consolidar migraciones del PoS (022–037) con guard anti-staging, buckets, tipos, validar TODO el PoS en piso. Es un proyecto aparte y posterior, bloqueado además por el PILAR de escalabilidad de sesión/auth. No confundir con la Ola 2 (que lleva **solo** la Bandeja Etapa 1 + mig 038).
- **Discrepancia mig 035** en el ledger de staging → sesión dedicada de propinas, sin tocar el historial.
- **Contadora:** códigos **CIIU/CABYS** (bloquean FE real). **FE real:** emisor certificado CR (Hacienda 4.4) tras `FeProvider` (hoy SIM).
- **Validación física en staging:** comandero pro, FE-SIM, inventario que baja al cerrar. Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md).

> **Ruido conocido:** (1) errores de consola tipo *"message channel closed"* son de EXTENSIONES de Chrome, no de la app.
> (2) En el arranque, `getSession()` puede dar `null` en el primer tick → se ve un `SESSION_EXPIRED` transitorio en los
> logs `[rt-diag]`. **Inofensivo por el FIX 2** (no desloguea ni emite; lo arbitra `refresh.error`). Revisar al limpiar
> los `[rt-diag]` en la Ola 1 (pase quirúrgico); no urgente.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión · `posFiscal`.
Todo el trabajo nuevo los **alimenta**, no los cambia.
