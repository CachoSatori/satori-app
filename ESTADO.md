# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-22** (cierre de la saga Realtime/suspensión). Foto compacta para ponerse al día de un vistazo.
> Historia detallada → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Plan por fases → [ROADMAP.md](ROADMAP.md) · Backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · RCA Realtime → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages.

> **⚠️ PROD (`main`) está FUERA DE USO — riesgo cero, NO tocar.** Todo el trabajo vivo es `staging`.

---

## (a) Ramas

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `04b1a32` | **PROD (fuera de uso).** Capa de inteligencia + fix SW viejo (`fde9264`) + fix fechas-borde (`ff836a0`) + **canario Realtime/candado de auth** (R1 `setAuth` global + saca `getSession` por-hook + guard `channel===ch`; sin round 2). **NO** tiene el PoS, ni la Bandeja, ni la saga Realtime/suspensión nueva. |
| `staging` | `71768d6` | **Fuente de verdad del trabajo nuevo.** Todo lo de `main` + PoS/KDS/comandero + FE estructura + inventario activo + Bandeja Etapa 1 + **saga Realtime/suspensión completa** (worker:true, abort/retry caja, await-disconnect, freno anti-loop, instrumentación `[rt-diag]`). |

> Supabase refs: **PROD** = `yiczgdtirrkdvohdquzf` (intocable) · **STAGING** = `hwiatgicyyqyezqwldia`.
> Ramas de la saga Realtime (todas mergeadas a staging): `fix/realtime-jwt-refresh` (R1) · `fix/realtime-socket-revive` (R2, **REVERTIDO**) · `fix/auth-lock-contention` (`09480a6`) · `fix/realtime-resume-refresh` (`97d9c75`) · `fix/realtime-worker-heartbeat` (`b7cf327`/`7cd7760`) · `fix/realtime-resume-diagnostics` (`28901c4`).

## (b) 🔴 PENDIENTE TÉCNICO PRINCIPAL — Realtime se cuelga tras suspensión profunda

**Raíz FINAL identificada CON DATOS** (instrumentación `[rt-diag]` en prueba física). **NO** es el token-loop viejo
(resuelto), ni el TCP zombi, ni el heartbeat throttleado (`worker:true` ya lo cubre). Es **DESINCRONIZACIÓN entre
el token HTTP de la sesión y el token del socket Realtime**:

- Tras ~25 min suspendido, el socket queda con **JWT vencido** (`InvalidJWTToken: "Token has expired N sec ago"`),
  **pero** `isConnected()=true` y el heartbeat late ok → el SDK lo cree vivo.
- `ensureRealtimeHealthy` decide sobre `getSession()` (HTTP sano / `tokenNeedsRefresh=false`) → concluye "todo bien",
  **nunca** `recovered=true`, **nunca** emite `'rt:healthy'`.
- El **freno anti-loop (R1)** corta a los 5 `recreate` pero **espera un `'rt:healthy'` que jamás llega** → Realtime
  muerto, la app no abre módulos, las escrituras de caja quedan "pendiente/cargando".
- El refresh HTTP (`grant_type=refresh_token`) **da 200** — el token nuevo existe, **nunca se inyecta al socket**.

**FIX PENDIENTE DE DISEÑO (no implementado — requiere cabeza fresca):** `ensureRealtimeHealthy` debe re-autenticar el
socket con `setAuth(tokenFresco)` y emitir `'rt:healthy'` según el **estado REAL del canal** (CHANNEL_ERROR/InvalidJWT),
**no** según `isConnected()` ni solo `tokenNeedsRefresh` HTTP. **Sin crear loop** que martille el endpoint de auth.
Detalle completo y diseño → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md).

> **Instrumentación `[rt-diag]` es TEMPORAL** (en `supabase.ts` y `useRealtimeRefetch.ts`): **borrar por prefijo
> `[rt-diag]`** cuando se implemente y valide el fix de re-auth.

## (c) PROD vs STAGING

- **En PROD (`main` `04b1a32`, fuera de uso):** ventas/analítica, propinas, caja (turnos + cierre día 2 fases +
  movimientos + pendientes), ingesta foto vieja, finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline.
  Migraciones **001–021**. **+** fix SW viejo, fix fechas-borde, y el **canario Realtime/candado** (R1 + fix final).
- **Solo en STAGING (no en prod):** todo el **PoS** (catálogo+salón multi-local, comandero, KDS, cobro+splits+ticket
  SIM, `computeTotals`, FE estructura SIM, inventario activo depleción+COGS) · **Bandeja fusionada Etapa 1** + enlace
  proveedor↔caja + visibilidad pendientes + fechas CR · **saga Realtime/suspensión** (worker:true, abort/retry caja,
  await-disconnect, freno, `[rt-diag]`). Migraciones **022–038**.
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
| **🔴 Realtime tras suspensión profunda** | 🟡 **mitigado en staging, raíz hallada, fix de re-auth PENDIENTE** | solo staging (`71768d6`) | Ver §(b) + RCA. worker:true + abort/retry + freno cortan el síntoma; falta la re-auth del socket. |
| Caja — escrituras robustas (abort/retry timeout) | 🟢 | staging | `withWriteTimeout` aborta el fetch zombi + reintenta 1 vez; ya no encola falso-offline |
| Bandeja fusionada Etapa 1 + enlace proveedor + visibilidad pendientes | ✅ Etapa 1 COMPLETA | staging | mig 038, validada con rol contador |
| PoS — catálogo/comandero/KDS/cobro/ticket SIM · FE estructura SIM · Inventario activo F1 | 🟢 | staging | sin validación física; pase a prod pendiente |

## (f) Pendientes de PLATA — sin firma/decisión de la dueña (NO mergear/aplicar sin OK)

1. **`propina-pool`** (rama, sin merge) → conecta `pos_payments.tip_crc` al pool del turno sin tocar `tipCalculations`. **DECISIÓN abierta:** tarjeta/SINPE ¿al mismo pool que efectivo o separada? `git show propina-pool:ESTADO-PROPINA-POOL.md`.
2. **Hora-CR en bordes de período** — misma familia que el `-31`, **NO tocada porque cambia números**: `finance.ts:132/139` (P&L borde de **año**, rango en UTC `…Z` + offset +6h). Requiere validación física. Ver `_handoff/RCA-FECHAS-BORDE.md` §5.
3. **`fix/fecha-cr-consistente`** (`cb25672`, en staging) → mes-CR de gastos de noche en P&L. Pendiente validación física.
4. **`fix-doble-cobro`** (mig 033, en staging) → falta validación física + decisión de pase a PROD.

## (g) Pendientes humanos / operativos / prolijidad

- **🔴 Diseñar el fix de re-auth de Realtime** (raíz ya identificada, §b) — pendiente técnico #1.
- **🔐 Rotar 2 tokens de GitHub:** (a) `gh auth refresh -s repo,read:org,workflow` (el `gho_` que estaba embebido en el remote de `SATORI PROPINAS` ya fue limpiado del config, pero sigue válido en GitHub hasta rotarlo); (b) **regenerar el PAT classic `ghp_` "Claude CLI" sin scope `admin:org`** — su valor quedó en un transcript local; rotar **antes del 27-jun**.
- **Pase del PoS + Bandeja a PROD:** consolidar migraciones 022–038 con guard anti-staging, crear buckets `facturas`/`productos`/`documents` en prod, regenerar tipos. Autorización única + verificación de hash.
- **Discrepancia mig 035** en el ledger de staging → sesión dedicada de propinas, sin tocar el historial.
- **Contadora:** códigos **CIIU/CABYS** (bloquean FE real). **FE real:** emisor certificado CR (Hacienda 4.4) tras `FeProvider` (hoy SIM).
- **Validación física en staging:** comandero pro, FE-SIM, inventario que baja al cerrar. Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md).

> **Ruido conocido:** errores de consola tipo *"message channel closed"* son de EXTENSIONES de Chrome, no de la app.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión · `posFiscal`.
Todo el trabajo nuevo los **alimenta**, no los cambia.
