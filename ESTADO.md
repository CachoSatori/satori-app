# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-23** (durabilidad de escritura de CAJA ✅ en staging · switch de diagnóstico de Realtime ✅ validado en staging · recuperación de Realtime se REDISEÑA como máquina de 3 estados ⏳ EN CURSO/diseñado). Foto compacta para ponerse al día de un vistazo.
> Historia detallada → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Plan por fases → [ROADMAP.md](ROADMAP.md) · Backlog → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · RCA Realtime → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages.

> **⚠️ PROD (`main`) está FUERA DE USO — riesgo cero, NO tocar.** Todo el trabajo vivo es `staging`.

---

## (a) Ramas

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `04b1a32` | **PROD (fuera de uso).** Capa de inteligencia + fix SW viejo (`fde9264`) + fix fechas-borde (`ff836a0`) + **canario Realtime/candado de auth** (R1 `setAuth` global + saca `getSession` por-hook + guard `channel===ch`; sin round 2). **NO** tiene el PoS, ni la Bandeja, ni la saga Realtime/suspensión nueva. |
| `staging` | `c9e0a24` | **Fuente de verdad del trabajo nuevo.** Todo lo de `main` + PoS/KDS/comandero + FE estructura + inventario activo + Bandeja Etapa 1 + saga Realtime/suspensión + **durabilidad de escritura de caja (jun-23, `0dd258b`)** + **switch de diagnóstico de Realtime solo-staging (jun-23, `c9e0a24`)**. Instrumentación `[rt-diag]` y `[diag-repro]` **siguen activas** (no borrar hasta resolver el rediseño de Realtime, ver §b). |

> Supabase refs: **PROD** = `yiczgdtirrkdvohdquzf` (intocable) · **STAGING** = `hwiatgicyyqyezqwldia`.
> Ramas de la saga Realtime (todas mergeadas a staging): `fix/realtime-jwt-refresh` (R1) · `fix/realtime-socket-revive` (R2, **REVERTIDO**) · `fix/auth-lock-contention` (`09480a6`) · `fix/realtime-resume-refresh` (`97d9c75`) · `fix/realtime-worker-heartbeat` (`b7cf327`/`7cd7760`) · `fix/realtime-resume-diagnostics` (`28901c4`) · **jun-23:** `fix/realtime-reauth-emit` (path channel-stuck fuerza refresh+setAuth y emite `rt:healthy`) · `fix/realtime-reauth-timeout` (`withTimeout` 8s + cinturón por edad 40s + test del hang) · `fix/realtime-resume-revive` (`cf6c77a`: revive la conexión cuando `getSession` expira por timeout).

## (b) 🟡 Realtime tras suspensión profunda — blindaje VALIDADO (no más deadlock) · recuperación se REDISEÑA (máquina de 3 estados, EN CURSO)

**Raíz (dos capas).** (1) Desincronización token HTTP↔socket: tras ~25 min suspendido el socket queda con
**JWT vencido** pero `isConnected()=true` y heartbeat ok → el SDK lo cree vivo. (2) **Más grave:** la conexión TCP
queda **zombi** y las operaciones de auth (`getSession`/`refreshSession`) que `ensureRealtimeHealthy` usa para
recuperarse **se cuelgan y nunca settlean** → el `await` no vuelve, el `finally` no corre y el singleton
`healthInFlight` queda **clavado para siempre** → la app queda muerta hasta recargar.

**Lo VALIDADO (jun-23, staging `c9e0a24`, 100% client-side):** el **blindaje anti-clavado** (`withTimeout` 8s por
auth-op + cinturón por edad `HEALTH_MAX_AGE_MS=40s` + emit por evidencia del hook) **resuelve el deadlock permanente**
— la app ya no queda muerta hasta recargar. Confirmado físicamente.

**Hallazgo NUEVO de esta sesión (por qué el blindaje no alcanza y se REDISEÑA):** el approach actual **emite
`rt:healthy` en el TIMEOUT del refresh** → el hook **re-suscribe con el token VENCIDO** → `InvalidJWTToken` → **loop
infinito** de CHANNEL_ERROR (confirmado en el log de una suspensión de **3–5 h**). El blindaje evita el cuelgue
*permanente*, pero deja un *loop* cuando el refresh no trae token fresco. → **Se rediseña `ensureRealtimeHealthy` +
`useRealtimeRefetch` como MÁQUINA DE 3 ESTADOS** (`ONLINE_SUBSCRIBED` / `OFFLINE_WAITING` / `SESSION_EXPIRED`); regla
madre: **NUNCA emitir `rt:healthy` ni re-suscribir sin un token válido fresco CONFIRMADO; ningún camino termina en
loop**. Diseño y plan → **[PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) ítem PRIORIDAD 1**.

**Reproducción A DEMANDA (jun-23, ✅ validado en el staging desplegado):** `src/shared/diag/realtimeReproSwitch.ts`
expone `window.__satoriDiag` (solo-staging) con `armZombie()` / `armExpired()` / `disarm()` / `status()`. `armZombie`
dispara **CHANNEL_ERROR al instante** → reproducir el bug bajó de **3+ h a ~30 s**. Es la herramienta para validar el
rediseño. Logs `[diag-repro]`. Gateado por `VITE_APP_ENV==='staging'`; en prod lo elimina el DCE.

> **Instrumentación `[rt-diag]` (en `supabase.ts` y `useRealtimeRefetch.ts`) y `[diag-repro]` SIGUEN ACTIVAS — NO
> borrar** hasta que el rediseño de Realtime esté resuelto y validado con `__satoriDiag`. Recién entonces se borra por
> prefijo y se decide si el switch se queda como herramienta permanente de staging o se remueve.
> Diagnóstico y cronología completos → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md).

## (c) PROD vs STAGING

- **En PROD (`main` `04b1a32`, fuera de uso):** ventas/analítica, propinas, caja (turnos + cierre día 2 fases +
  movimientos + pendientes), ingesta foto vieja, finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline.
  Migraciones **001–021**. **+** fix SW viejo, fix fechas-borde, y el **canario Realtime/candado** (R1 + fix final).
- **Solo en STAGING (no en prod):** todo el **PoS** (catálogo+salón multi-local, comandero, KDS, cobro+splits+ticket
  SIM, `computeTotals`, FE estructura SIM, inventario activo depleción+COGS) · **Bandeja fusionada Etapa 1** + enlace
  proveedor↔caja + visibilidad pendientes + fechas CR · **saga Realtime/suspensión** (worker:true, blindaje por
  timeout, freno, `[rt-diag]`) **+ durabilidad de escritura de caja jun-23** (reintento con tope + encola SIEMPRE en
  outbox) **+ switch de diagnóstico de Realtime solo-staging jun-23** (`window.__satoriDiag`, §b).
  Migraciones **022–038** (el trabajo de jun-23 es client-only, sin migración).
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
| **Realtime tras suspensión profunda** | 🟡 **blindaje VALIDADO (no más deadlock); recuperación se REDISEÑA** (máquina de 3 estados, en curso) | solo staging (`c9e0a24`) | Ver §(b) + RCA. El emit-on-timeout deja un loop `InvalidJWT` → rediseño = PROMPT-CONTINUACION **P1**. `[rt-diag]` activo. |
| **Caja — durabilidad de escritura** (reintento con tope + outbox) | ✅ **en staging** (mergeado, test verde) | staging (`0dd258b`) | El reintento corre con `withWriteTimeout` y, ante timeout/red-zombi, **encola SIEMPRE en el outbox** (idempotente por `client_op_id`). Antes el reintento corría sin tope y el encolado dependía de `navigator.onLine` (miente en zombi) → se perdía el pago. Test `cash.durability.test.ts`. |
| **Diagnóstico Realtime — switch de reproducción** (solo-staging) | ✅ **validado en staging** | staging (`c9e0a24`) | `window.__satoriDiag` (`armZombie`/`armExpired`/`disarm`/`status`); `armZombie` dispara CHANNEL_ERROR al instante → reproduce el cuelgue de 3+ h en ~30 s. DCE lo elimina de prod. Logs `[diag-repro]`. |
| Bandeja fusionada Etapa 1 + enlace proveedor + visibilidad pendientes | ✅ Etapa 1 COMPLETA | staging | mig 038, validada con rol contador |
| PoS — catálogo/comandero/KDS/cobro/ticket SIM · FE estructura SIM · Inventario activo F1 | 🟢 | staging | sin validación física; pase a prod pendiente |

## (f) Pendientes de PLATA — sin firma/decisión de la dueña (NO mergear/aplicar sin OK)

1. **`propina-pool`** (rama, sin merge) → conecta `pos_payments.tip_crc` al pool del turno sin tocar `tipCalculations`. **DECISIÓN abierta:** tarjeta/SINPE ¿al mismo pool que efectivo o separada? `git show propina-pool:ESTADO-PROPINA-POOL.md`.
2. **Hora-CR en bordes de período** — misma familia que el `-31`, **NO tocada porque cambia números**: `finance.ts:132/139` (P&L borde de **año**, rango en UTC `…Z` + offset +6h). Requiere validación física. Ver `_handoff/RCA-FECHAS-BORDE.md` §5.
3. **`fix/fecha-cr-consistente`** (`cb25672`, en staging) → mes-CR de gastos de noche en P&L. Pendiente validación física.
4. **`fix-doble-cobro`** (mig 033, en staging) → falta validación física + decisión de pase a PROD.

## (g) Pendientes humanos / operativos / prolijidad

- **🟡 PRIORIDAD 1 — Rediseñar la recuperación de Realtime como máquina de 3 estados** (§b): `ensureRealtimeHealthy` + `useRealtimeRefetch` → `ONLINE_SUBSCRIBED` / `OFFLINE_WAITING` / `SESSION_EXPIRED`. Regla madre: **nunca emitir `rt:healthy` ni re-suscribir sin token fresco CONFIRMADO; ningún camino en loop**. El blindaje anti-deadlock ya está; falta matar el **loop `InvalidJWT`** del emit-on-timeout. Reproducir y validar con `window.__satoriDiag` (`armZombie`/`armExpired`). Recién con esto resuelto y validado → **borrar logs `[rt-diag]`/`[diag-repro]`** y planear el pase a main. Plan B documentado (tope al `fn()` dentro de `safeNavigatorLock`, auth sensible) en PROMPT-CONTINUACION ítem PRIORIDAD 1.
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
