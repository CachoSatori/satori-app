# Satori App — Estado del proyecto

> Restaurant POS + analítica · Satori Sushi Bar, Santa Teresa & Nosara, Costa Rica
> **Handoff: 2026-06-25 (cierre).** 🚀 **PROD avanzó a `5f22754` — la PANTALLA NEGRA YA ESTÁ EN PROD** (deploy confirmado: `version.json.commit = 5f22754`). STAGING en **`1c8c2b4`** (código `ee5878a`; lineal: `692055d`→`0adf30e`→`f0f8127`→`8bed794`→`ee5878a`→docs `1c8c2b4`). **HEADLINE:** se diagnosticó y **arregló la PANTALLA NEGRA (splash 祭 eterno tras suspensión / cold-launch de la PWA)** y se pasó a prod por hotfix. Causa raíz: `getSession` **y** `loadProfile` del **BOOTSTRAP** (`useAuth.tsx`) no tenían tope → se colgaban sobre el socket zombi → `loading` nunca bajaba. NINGÚN fix de realtime (máquina de 3 estados de `supabase.ts`) tocaba esta capa de arranque — por eso fallaba hace una semana (Hallazgo A). **✅ validado en staging** (determinístico con `__satoriDiag.armBootHang` + natural) y **✅ EN PROD, VALIDADO FÍSICAMENTE POR LA DUEÑA** (la app se sostiene abierta sin el cuelgue/splash negro; antes no aguantaba ~3 min). Próximos pases a prod desde staging: durabilidad de `createDayMovement` (`399fc0b`) y el fix de auth-recovery (gateado a suspensión real >1h).
> Historia detallada → [ESTADO-ARCHIVO.md](ESTADO-ARCHIVO.md) · Fases → [ROADMAP.md](ROADMAP.md) · Backlog/PASE A PROD → [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md) · Hallazgos de auditoría → [HALLAZGOS.md](HALLAZGOS.md) · RCA Realtime → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md) · RCA auth recovery → [docs/HANG-RCA-2.md](docs/HANG-RCA-2.md).

**Stack:** React 19 + TS strict + Vite + PWA · Supabase (Postgres + RLS + Edge Functions) · realtime.
**Despliegue:** `main` → PROD (GitHub Pages, base `/satori-app/`) · `staging` → Cloudflare Pages.

> **PROD (`main` `5f22754`) tiene las OLAS 1 y 1.1 de estabilidad (validadas) + el fix de la PANTALLA NEGRA del bootstrap (✅ EN PROD, validado físicamente por la dueña) → la app vuelve a ser usable sin cuelgues.** El trabajo de FEATURES (PoS, Bandeja) sigue viviendo en `staging`; a prod se va por **cherry-pick selectivo**, NUNCA mergeando `staging`→`main`.

---

## (a) Ramas

| Rama | Hash | Qué es |
|---|---|---|
| `main` | `5f22754` | **PROD (estable, en uso).** Capa de inteligencia + fix SW viejo (`fde9264`) + fix fechas-borde (`ff836a0`) + canario Realtime/candado de auth + **OLA 1 (`2358f6c`)** = saga Realtime/suspensión (worker:true + máquina de 3 estados + gateo del emit + endurecimiento `SESSION_EXPIRED`) **+ durabilidad de escritura de caja**, **SIN diag** + **OLA 1.1 (`ead4727`+`483d29c`)** = timeout/abort del flush del outbox con guardarraíl de plata + **🆕 FIX PANTALLA NEGRA del bootstrap** (FF `483d29c`→`5f22754`, 3 commits `a1342c8`+`fd2755c`+`5f22754` = cherry-picks de `0adf30e`/`f0f8127`/`8bed794`, **+ 2 exports en `supabase.ts`** — ver receta en §(b-ter)). Deploy confirmado (`version.json=5f22754`); **✅ validado físicamente por la dueña en prod**. **NO** tiene el PoS ni la Bandeja. |
| `staging` | `ee5878a` | **Fuente de verdad del trabajo nuevo (FEATURES).** Todo lo de `main` + PoS/KDS/comandero + FE estructura + inventario activo + Bandeja Etapa 1 + saga Realtime/suspensión (`3a0fd20`) + durabilidad de caja (`0dd258b`) + flush del outbox con tope (`4805e23`) + diag de Realtime solo-staging + **🆕 esta sesión:** durabilidad `createDayMovement` (`dea9486`) · auth-recovery (escape `SESSION_EXPIRED` N=3 + signOut acotado + latch, `e0df9ae`+`14e4546`; el lock 10s→5s `ccef5f1` es hardening, NO el fix — ver §b-bis) · **fix PANTALLA NEGRA: bootstrap con tope** (`0adf30e` getSession + `f0f8127` loadProfile+PrivateRoute + `8bed794` PublicRoute anti-loop — §b-ter) · **palanca diag `armBootHang`** (`ee5878a`, solo-staging, DCE en prod). `[rt-diag]`/`[diag-repro]` activos por diseño (gateado por `VITE_APP_ENV`). |

> Supabase refs: **PROD** = `yiczgdtirrkdvohdquzf` (intocable) · **STAGING** = `hwiatgicyyqyezqwldia`.
> Ramas de la saga Realtime (todas mergeadas a staging): `fix/realtime-jwt-refresh` (R1) · `fix/realtime-socket-revive` (R2, **REVERTIDO**) · `fix/auth-lock-contention` (`09480a6`) · `fix/realtime-resume-refresh` (`97d9c75`) · `fix/realtime-worker-heartbeat` (`b7cf327`/`7cd7760`) · `fix/realtime-resume-diagnostics` (`28901c4`) · `fix/realtime-reauth-emit` + `fix/realtime-reauth-timeout` + `fix/realtime-resume-revive` (blindaje 8s + cinturón 40s; **approach intermedio que dejaba un loop `InvalidJWT` → REEMPLAZADO**) · **`fix/realtime-3state-machine` (`63ef0bb`)** = máquina de 3 estados · **`fix/realtime-emit-gating` (`3a0fd20`)** = gateo del emit + endurecimiento `SESSION_EXPIRED`. Cronología completa → RCA + `ESTADO-ARCHIVO.md` (2026-06-24).

## (b) ✅ Realtime tras suspensión profunda — RESUELTO Y EN PROD (OLA 1, `2358f6c`)

Máquina de 3 estados en `ensureRealtimeHealthy` (`ONLINE_SUBSCRIBED`/`OFFLINE_WAITING`/`SESSION_EXPIRED`; topes
`withTimeout` 8s; regla madre: nunca emitir `rt:healthy` sin token fresco confirmado, ningún camino en loop; gateo del
emit con `healthyAwaited`). **EN PROD sin diag**; en staging `[rt-diag]`/`[diag-repro]` (`window.__satoriDiag`) activos por
diseño (gateado por `VITE_APP_ENV`, DCE en prod — grep del dist de prod por `__satoriDiag|rt-diag|armZombie` → VACÍO).
Detalle/cronología → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md) + `ESTADO-ARCHIVO.md`.

> ⚠️ Esta capa (realtime) era correcta pero **incompleta**: el BOOTSTRAP de `useAuth` era el gemelo sin topear → causaba
> la pantalla negra (ver §b-ter). **Lección: arreglar la capa donde está el síntoma, no la de al lado.**

## (b-bis) 🆕 Auth recovery — el loop `OFFLINE_WAITING` tras suspensión LARGA (corregido esta sesión, SOLO en staging)

La máquina de 3 estados (§b, **EN PROD**) resolvió el caso validado, pero quedaba un modo de falla **distinto**: tras una
suspensión **larga**, el fetch interno de `getSession`/`refreshSession` **no vuelve** (socket zombi) y `classifyRealtime`
caía en `if (!sessionRead) return OFFLINE_WAITING` **sin escape** → loop `OFFLINE_WAITING` eterno, nunca refresca el token,
el outbox no drena. **El fix del lock (`ccef5f1`, 10s→5s) fue un RED HERRING:** el escape `no adquirido` disparó **0 veces**
en todos los logs (incl. una suspensión real de ~4h) → el cuelgue es el fetch de auth, no la adquisición del lock. Queda
como hardening inofensivo, NO es el fix de este bug.

**Fix real (client-side, solo en staging):**
- `e0df9ae` — contador de timeouts consecutivos de `getSession`; tras **N=3** escala a `SESSION_EXPIRED` y fuerza
  `signOut({scope:'local'})` → `onAuthStateChange(null)` → `/login` → el usuario reingresa y el **outbox drena** (el
  `signOut` local NO toca el IndexedDB del outbox).
- `14e4546` — `signOut` SOLO en el path forzado por N-timeouts (`forced:true`); el path `refresh.error` vuelve a su
  comportamiento original (gotrue ya limpia) → sin logout espurio. **Latch one-shot** (`forcedLogoutLatch`): se fuerza UNA
  vez; se limpia solo con sesión fresca confirmada en `onAuthStateChange` → mata el ping-pong de logout cada ~30 s.

> ⚠️ **VALIDADO SOLO POR UNIT TESTS** (auth machine en `supabase.timeout.test.ts`). **NO** se validó físicamente aún.
> **GATE antes de prod:** (a) repro con `__satoriDiag.armZombie()` → **UN solo** `signOut`→`/login` sin ping-pong +
> `disarm()`→`ONLINE_SUBSCRIBED`+drain; (b) **suspensión real >1h** sobre el build de staging. **El pase a prod de este fix
> está GATEADO a que (b) pase.** Diagnóstico completo → **`docs/HANG-RCA-2.md`**.
> 🔧 **RITUAL de identidad de build:** verificar la versión live con **`{base}version.json` → `.commit`**, NO con un hash
> de chunk adivinado. (Corrección: el doc previo anotó mal `supabase-BjfeOB6h.js`; los chunks reales fueron
> `8bed794`→`supabase-BkyNvEiL.js`, `ee5878a`→`supabase-DljVXxoG.js` — pero el hash de chunk cambia por build; usá `version.json`.)

## (b-ter) ✅ PANTALLA NEGRA (splash 祭 eterno tras suspensión / cold-launch) — RESUELTO, EN PROD (`5f22754`) y VALIDADO POR LA DUEÑA

**Síntoma:** tras suspender la máquina (o cold-launch de la PWA), la app quedaba en el splash negro para siempre.
**Causa raíz (capa de ARRANQUE, distinta de realtime):** en `useAuth.tsx` el bootstrap llamaba `getSession()` **y**
`loadProfile()` **sin tope**; sus `.finally(setLoading(false))` / `await` solo corren si la promesa SETTLEA. Sobre el
socket zombi se colgaban → `loading` quedaba `true` para siempre. Ningún fix de realtime tocaba esta capa.

**Fix (3 commits, lineal sobre `692055d`):**
- `0adf30e` — `getSession` del bootstrap envuelto en `withTimeout` (fallback sesión nula → `/login` al vencer ~8s).
- `f0f8127` — `loadProfile` con `withTimeout` + 1 reintento (al vencer 2× deja `profile` null y retorna → `loading` baja);
  `PrivateRoute` corta `profile` nulo → `/login` (Hallazgo G, parcial).
- `8bed794` — `PublicRoute` exige `user && profile` → corrige un **LOOP** `/`↔`/login` que introdujo `f0f8127`.

> ✅ **VALIDADO en staging** — **determinístico** con la palanca `__satoriDiag.armBootHang('getSession'|'loadProfile')`
> (logs `BOOT HANG: … colgado` → `withTimeout EXPIRÓ: … (bootstrap)` → cae a `/login` SIN negro eterno y SIN loop; Service
> Worker Clients mostró `…/login`) **y naturalmente** (cuelgues reales del bootstrap atrapados → `/login`).
> 🚀 **YA EN PROD** (`main` `5f22754`, FF `483d29c`→`5f22754`): deploy confirmado por `version.json.commit=5f22754`.
> ✅ **VALIDADO FÍSICAMENTE POR LA DUEÑA EN PROD** (2026-06-25): la app se sostiene abierta sin el cuelgue/splash negro — antes no aguantaba ~3 min.
>
> ### ⚠️ RECETA DE PROD (REGISTRADA para NO redescubrirla) — NO es "cherry-pick de los 3 commits y listo"
> Cherry-pickear `0adf30e`+`f0f8127`+`8bed794` sobre `main` da **1 conflicto + 1 build break**. La receta correcta es
> **esos 3 commits + DOS `export` en `src/shared/api/supabase.ts`** (nada más):
> 1. **Conflicto en `supabase.ts` (`withTimeout`):** quedarse con el **cuerpo de MAIN** (`_label`, SIN traza/`console.warn`
>    — prod va sin diag) **y agregarle `export`** → `export const withTimeout = <T>(p: Promise<T>, ms: number, _label: string, fallback: T) => {`.
>    **NO** usar la versión de staging (la que dice "y deja rastro en consola" / usa `label` + loguea).
> 2. **Build break:** `useAuth.tsx` importa `withTimeout` **y** `AUTH_OP_TIMEOUT_MS`, que en main existen pero NO se
>    exportaban → exportar la constante existente sin cambiar su valor: `export const AUTH_OP_TIMEOUT_MS = 8_000`. (En staging
>    el `export` venía de `ccef5f1`, que además bajaba el lock 10s→5s — **red herring que NO va a prod**; en el hotfix se
>    exporta a mano sin traerlo.)
> **NO traer** `ee5878a` (la palanca `armBootHang` NO va a prod) ni `ccef5f1` (el cambio de lock). Verificado en el hotfix:
> build prod **EXIT 0**, **vitest 42/42**, dist sin diag, diff = **4 archivos (+205/−11)**.

## (c) PROD vs STAGING

- **En PROD (`main` `5f22754`, estable):** ventas/analítica, propinas, caja (turnos + cierre día 2 fases +
  movimientos + pendientes), ingesta foto vieja, finanzas/P&L, reportes+emails, admin, auth Fase 2, realtime, offline.
  Migraciones **001–021**. **+** fix SW viejo, fix fechas-borde, el canario Realtime/candado, **las OLAS 1 + 1.1 de
  estabilidad** (saga Realtime/suspensión + durabilidad de escritura de caja + timeout/abort del flush del outbox con
  guardarraíl de plata; **SIN diag**), y **🆕 el fix de la PANTALLA NEGRA del bootstrap** (`5f22754`; ✅ validado
  físicamente por la dueña — §b-ter). Todo es client-only (sin migración).
- **Solo en STAGING (no en prod):** todo el **PoS** (catálogo+salón multi-local, comandero, KDS, cobro+splits+ticket
  SIM, `computeTotals`, FE estructura SIM, inventario activo depleción+COGS) · **Bandeja fusionada Etapa 1** + enlace
  proveedor↔caja + visibilidad pendientes + fechas CR · **switch de diagnóstico de Realtime solo-staging**
  (`window.__satoriDiag`: `armZombie`/`armExpired`/`armBootHang`, §b/§b-ter) + la instrumentación `[rt-diag]` activa ·
  **🆕 pendientes de pase a prod:** **durabilidad `createDayMovement`** (hotfix `399fc0b` listo) y el **fix de auth-recovery**
  (§b-bis, gateado a suspensión real >1h). Migraciones **022–038** (sin migración nueva esta sesión, todo client-side).
- **En rama aparte (sin merge):** `propina-pool` (espera decisión de la dueña).

## (d) Migraciones

| Entorno | Hasta | Notas |
|---|---|---|
| **PROD** | **021** | Los fixes SW/fechas/Realtime, **las Olas 1 + 1.1 de estabilidad y el fix de la PANTALLA NEGRA** son 100% client-side (sin migración). |
| **STAGING** | **038** | 022–034 PoS · 036 FE estructura · 037 inventario COGS · **038 Bandeja** (firmada por la dueña). ⚠️ **035:** el ledger la marca aplicada pero el archivo solo vive en `propina-pool` (sin merge) → **discrepancia A INVESTIGAR**, sin tocar el historial. ⚠️ Verificar estado real de la **038** en el ledger antes de actuar (a PROD va con el pase del PoS). |

## (e) Lo construido, por módulo

Leyenda: ✅ validado por la dueña / 🟢 hecho y verde (tests+build) sin validación física / 🟡 parcial / 🔴 pendiente clave.

| Módulo | Estado | Dónde | Nota |
|---|---|---|---|
| Ventas/analítica · Propinas · Caja+cierre · Finanzas/P&L · Reportes · Admin · Auth · Realtime · Offline | ✅ | prod | maduro. `cashUtils`/`tipCalculations`/`computeTotals` SAGRADOS |
| Estabilidad PWA — SW viejo | ✅ **en PROD** | prod (`fde9264`) | updateViaCache:'none' + version.json cache-bust |
| Fechas de borde de mes (`-31`→400) | ✅ **en PROD** | prod (`ff836a0`) | `monthRangeBounds`, result-preserving |
| Realtime/candado de auth (R1 + fix final) | ✅ **en PROD vía canario** | prod (`04b1a32`) | `setAuth` global + saca `getSession` por-hook. Round 2 REVERTIDO. |
| **Realtime tras suspensión profunda** | ✅ **EN PROD y VALIDADO** (OLA 1) — máquina de 3 estados + gateo del emit + endurecimiento `SESSION_EXPIRED` | **prod** (`2358f6c`) + staging | Ver §(b) + RCA. En prod va SIN diag; en staging `[rt-diag]`/`[diag-repro]` siguen activos. |
| **Caja — durabilidad de escritura** (reintento con tope + outbox) | ✅ **EN PROD y VALIDADA** (OLA 1) | **prod** (`2358f6c`) + staging (`0dd258b`) | `withWriteTimeout` con AbortController + abort del socket zombi; ante timeout/red-zombi **encola SIEMPRE en el outbox** (idempotente por `client_op_id`). Test `cash.durability.test.ts` + `supabase.timeout.test.ts`. |
| **Outbox — timeout/abort del flush** (OLA 1.1) | ✅ **EN PROD y VALIDADA** — la cola drena sola | **prod** (`ead4727`+`483d29c`) + staging (`4805e23`) | Las 5 llamadas de red del `supabaseExecutor` con `withWriteTimeout`+`.abortSignal()`. **Guardarraíl de plata:** un timeout → `'retry'`, NUNCA `'fatal'` (fatal borra la op = pago perdido). Test `outbox.test.ts` (9 casos). |
| **Diagnóstico — switch de reproducción** (solo-staging) | ✅ **validado en staging** | staging (`ee5878a`) | `window.__satoriDiag`: `armZombie`/`armExpired` (realtime) + **`armBootHang('getSession'\|'loadProfile')`/`disarmBootHang`** (pantalla negra del bootstrap, one-shot) + `disarm`/`status`. DCE lo elimina de prod (grep VACÍO). Logs `[diag-repro]`. |
| **🆕 PANTALLA NEGRA — bootstrap con tope** (getSession + loadProfile + guards) | ✅ **EN PROD (`5f22754`), VALIDADO POR LA DUEÑA** | **prod** (`a1342c8`+`fd2755c`+`5f22754`) + staging (`0adf30e`+`f0f8127`+`8bed794`) | Ver §(b-ter) (incluye la **receta de prod**: 3 commits + 2 exports). La app se sostiene abierta sin el cuelgue (antes ~3 min). |
| **🆕 `createDayMovement` — durabilidad** (id+`client_op_id`+`withWriteTimeout`+outbox) | 🟢 **en staging** (`dea9486`) · hotfix prod listo (`399fc0b`, sin mergear) | staging + `hotfix/createdaymovement-durability-prod` | Cierra el hueco nivel-día de Caja Diaria. Test `cash.durability.test.ts` (2 casos). El hotfix de prod NO arrastra `supplier_id` (solo-staging). |
| **🆕 Auth recovery — escape del loop `OFFLINE_WAITING`** (N=3 timeouts → `SESSION_EXPIRED`+signOut local + latch one-shot) | 🟡 **solo unit tests** — falta validación física | staging (`e0df9ae`+`14e4546`) | Ver §(b-bis) + `docs/HANG-RCA-2.md`. **GATE a prod: suspensión real >1h.** El lock `ccef5f1` fue red herring (hardening). |
| **Bandeja ETAPA 1** (unificada `/inbox`, foto+IA + enlace proveedor↔caja + visibilidad pendientes) | ✅ **COMPLETA y validada** | staging | mig 038, validada con rol contador. **= candidata de la Ola 2.** |
| **Bandeja ETAPA 2** (entrada foto-primero 100% dentro de Caja Diaria) | 🔲 **DISEÑADA, SIN código** | — | NO hay nada en `src/modules/cash` ni `inbox`. = Ola 3, gated por decisión de la dueña (¿alcanza la Etapa 1?). |
| PoS — catálogo/comandero/KDS/cobro/ticket SIM · FE estructura SIM · Inventario activo F1 | 🟢 | staging | sin validación física; pase a prod pendiente |

## (f) Pendientes de PLATA — sin firma/decisión de la dueña (NO mergear/aplicar sin OK)

1. **`propina-pool`** (rama, sin merge) → conecta `pos_payments.tip_crc` al pool del turno sin tocar `tipCalculations`. **DECISIÓN abierta:** tarjeta/SINPE ¿al mismo pool que efectivo o separada? `git show propina-pool:ESTADO-PROPINA-POOL.md`.
2. **Hora-CR en bordes de período** — misma familia que el `-31`, **NO tocada porque cambia números**: `finance.ts:132/139` (P&L borde de **año**, rango en UTC `…Z` + offset +6h). Requiere validación física. Ver `_handoff/RCA-FECHAS-BORDE.md` §5.
3. **`fix/fecha-cr-consistente`** (`cb25672`, en staging) → mes-CR de gastos de noche en P&L. Pendiente validación física.
4. **`fix-doble-cobro`** (mig 033, en staging) → falta validación física + decisión de pase a PROD.

## (g) Pendientes humanos / operativos / prolijidad

- **🟢 PLAN DE PASE A PROD — OPCIÓN A (estabilidad primero, 3 OLAS). Ola 1 y 1.1 ✅ HECHAS y validadas en prod.** ⚠️ **Staging está ~143 commits y ~16 migraciones adelante de main → NUNCA mergear `staging`→`main`; a prod se va por _cherry-pick selectivo_.** Detalle por ola → PROMPT-CONTINUACION (cabecera).
  - **OLA 1 — ✅ HECHA (en prod, validada físicamente):** pase quirúrgico de estabilidad a main (`2358f6c`): cadena Realtime (worker:true + máquina de 3 estados + gateo del emit + endurecimiento `SESSION_EXPIRED`) **+ durabilidad de escritura de caja**, SIN el PoS y **SIN diag** (logs `[rt-diag]`/`realtimeReproSwitch` borrados por prefijo; tree-shaking confirmado: grep del dist VACÍO). Caja/propinas/ventas de vuelta en prod **sin cuelgues**.
  - **OLA 1.1 — ✅ HECHA (en prod, validada físicamente):** timeout/abort en el ejecutor del flush del outbox (`ead4727`+`483d29c`) con **guardarraíl de plata** (timeout → retry, nunca fatal). **La cola del outbox drena sola tras suspender la máquina.**
  - **OLA 2 (SIGUIENTE) — Bandeja ETAPA 1 a prod** (ya construida y validada en staging) **con la mig 038** (esquema → firma de la dueña). ⚠️ A verificar al planearla: si la **mig 038 / Etapa 1 se separan limpio de las migraciones del PoS (022–037)** o vienen acopladas. Da **foto+IA real** sin construir nada nuevo.
  - **OLA 3 (cuando la base esté sólida) — CONSTRUIR la Bandeja ETAPA 2** (entrada foto-primero 100% dentro de Caja Diaria; hoy **🔲 diseñada, SIN código**). **Solo si** tras usar la Etapa 1 sigue haciendo falta → **DECISIÓN ABIERTA de la dueña**.
- **PASE A PROD — estado (detalle + orden → PROMPT-CONTINUACION §1):**
  1. ✅ **PANTALLA NEGRA — HECHA, EN PROD (`5f22754`), VALIDADA POR LA DUEÑA.** Hotfix `hotfix/pantalla-negra-prod` mergeado por FF a `main`; deploy confirmado (`version.json=5f22754`) y **✅ validación física en dispositivo OK** (la app se sostiene abierta sin el cuelgue). Receta registrada en §(b-ter).
  2. 🟢 **`createDayMovement` durabilidad — PENDIENTE de pase:** `hotfix/createdaymovement-durability-prod` (`399fc0b`) **verificada y lista** (sin `supplier_id`).
  3. 🟡 **Auth-recovery (`e0df9ae`+`14e4546`) — PENDIENTE, GATEADO:** hotfix nuevo desde `main` (NO el lock `ccef5f1` solo), **gateado a la suspensión real >1h** (§b-bis).
  El orden y la coordinación los decide la dueña.
- **🔐 Rotar 2 tokens de GitHub:** (a) `gh auth refresh -s repo,read:org,workflow` (el `gho_` que estaba embebido en el remote de `SATORI PROPINAS` ya fue limpiado del config, pero sigue válido en GitHub hasta rotarlo); (b) **regenerar el PAT classic `ghp_` "Claude CLI" sin scope `admin:org`** — su valor quedó en un transcript local; rotar **antes del 27-jun**.
- **GRAN PASE del PoS a PROD — DIFERIDO** (NO es parte de las 3 olas; la dueña eligió estabilidad primero): consolidar migraciones del PoS (022–037) con guard anti-staging, buckets, tipos, validar TODO el PoS en piso. Es un proyecto aparte y posterior, bloqueado además por el PILAR de escalabilidad de sesión/auth. No confundir con la Ola 2 (que lleva **solo** la Bandeja Etapa 1 + mig 038).
- **Discrepancia mig 035** en el ledger de staging → sesión dedicada de propinas, sin tocar el historial.
- **Contadora:** códigos **CIIU/CABYS** (bloquean FE real). **FE real:** emisor certificado CR (Hacienda 4.4) tras `FeProvider` (hoy SIM).
- **Validación física en staging:** comandero pro, FE-SIM, inventario que baja al cerrar. Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md).
- **⚠️ GOTCHA DE VERIFICACIÓN (vale para TODO pase futuro):** **`tsc --noEmit` es un FALSO VERDE** en este repo — el `tsconfig.json` raíz tiene `"files": []` + `references`, así que **no chequea ningún archivo**. El typecheck REAL es **`npm run build`** (`tsc -b`, que compila los `*.test.ts`). En el pase de la Ola 1.1 un cast en un test pasó `tsc --noEmit` pero rompió el build de prod (`tsc -b`); quedó latente en staging y solo apareció en el pase a main. **Regla: toda verificación de un pase corre `VITE_APP_ENV=production npm run build`, no `tsc --noEmit`.** Castear tipos incompatibles en tests: `x as unknown as T`.
- **Pendientes NO urgentes detectados en la validación física de prod (no bloquean):** (1) **404 de un recurso en la ruta `/caja`** en prod — aparece en consola, no rompe el flujo; identificar el recurso (asset/manifest/SW) en un pase aparte. (2) **Warning cosmético de recharts** (`width(-1)/height(-1)` con contenedor 0px al montar) — solo ruido. (3) **La Lenovo del restaurante (KDS de cocina) quedó con bundle viejo** → requiere **Unregister SW + Clear site data** una vez (el watchdog de arranque debería curarlo solo).

> **Ruido conocido:** (1) errores de consola tipo *"message channel closed"* son de EXTENSIONES de Chrome, no de la app.
> (2) En el arranque, `getSession()` puede dar `null` en el primer tick → se ve un `SESSION_EXPIRED` transitorio en los
> logs `[rt-diag]` (**solo en staging**; en prod los `[rt-diag]` ya no existen tras la Ola 1). **Inofensivo** (no desloguea
> ni emite; lo arbitra `refresh.error`); no urgente.

---

## Sagrados (NUNCA reimplementar sin acuerdo explícito)
`cashUtils` · `tipCalculations` · `computeTotals` (fórmula fiscal) · cierres de caja · cobro/vuelto/conversión · `posFiscal`.
Todo el trabajo nuevo los **alimenta**, no los cambia.
