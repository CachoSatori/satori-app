# Continuación — backlog priorizado (handoff 2026-06-25)

Estado: **PROD (`main` `483d29c`) recibió las OLAS 1 y 1.1 de estabilidad (validadas físicamente) → la app vuelve a ser
usable sin cuelgues.** main = capa de inteligencia + fix SW viejo + fix fechas-borde + canario Realtime/candado de auth
+ **Ola 1** (saga Realtime/suspensión + durabilidad de escritura de caja, SIN diag) + **Ola 1.1** (timeout/abort del flush
del outbox). STAGING (`ee5878a`) = todo el PoS + Bandeja Etapa 1 + esos fixes + la saga Realtime/suspensión + durabilidad
de caja + **flush del outbox con tope** + **switch de diag solo-staging** (`[rt-diag]`, ahora con `armBootHang`)
+ **🆕 esta sesión:** **fix de la PANTALLA NEGRA del bootstrap (✅ VALIDADO en staging — §0-ter; PRIORIDAD 1 de pase a prod)**
+ durabilidad de `createDayMovement` (`dea9486`) + fix de auth-recovery (`e0df9ae`+`14e4546`, 🟡 pendiente físico — §0-bis).
Guardrails de siempre:
**nada a `main`/PROD sin orden explícita, DDL solo migraciones aditivas, sagrados intactos** (`cashUtils`,
`tipCalculations`, `computeTotals`, cierres, cobro/vuelto, `posFiscal`), builds+tests+eslint verdes por commit.
Estado completo → [ESTADO.md](ESTADO.md) · Fases → [ROADMAP.md](ROADMAP.md) · Hallazgos de auditoría → [HALLAZGOS.md](HALLAZGOS.md) ·
RCA Realtime → [docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md) · RCA auth → [docs/HANG-RCA-2.md](docs/HANG-RCA-2.md).

Marcadores: ✅ hecho · 🖊️ espera FIRMA/DECISIÓN de la dueña (plata) · 👁️ espera VALIDACIÓN FÍSICA ·
🟢 ingeniería lista para arrancar · 🔴 bloqueante / urgente.

> **Ya resuelto y EN PROD:** SW viejo (`fde9264`), fechas de borde de mes (`ff836a0`), y el canario
> Realtime/candado de auth. Eran las tres causas viejas del "se traba". **La causa NUEVA (Realtime tras suspensión
> profunda) + la durabilidad de escritura de caja + el timeout/abort del flush del outbox YA ESTÁN EN PROD y validadas
> físicamente** vía **OLA 1 (`2358f6c`)** y **OLA 1.1 (`ead4727`+`483d29c`)** — la cola del outbox drena sola.
> **El foco AHORA es la OLA 2: Bandeja Etapa 1 + mig 038 a prod (§1).**

---

## 0. ✅ RESUELTO esta sesión — Realtime tras suspensión profunda (máquina de 3 estados + gateo + endurecimiento)

`ensureRealtimeHealthy` (en `src/shared/api/supabase.ts`) quedó rediseñada como **MÁQUINA DE 3 ESTADOS** y **validada
físicamente** en el staging desplegado. **Ya NO es un pendiente** — queda acá como referencia para la Ola 1 (pase quirúrgico, §1).
- **`ONLINE_SUBSCRIBED`** (token fresco CONFIRMADO) → `setAuth` + revive socket si cayó + **única** emisión de `rt:healthy`.
- **`OFFLINE_WAITING`** (red zombi / refresh colgado) → NO emite, renueva el TCP, reintenta con backoff (3s→30s, un único timer).
- **`SESSION_EXPIRED`** (solo si `refresh.error`) → NO toca el socket; deja actuar el deslogueo declarativo.

**Regla madre cumplida:** nunca `rt:healthy` ni re-suscribir sin token fresco confirmado; ningún camino en loop. Esto
mató el **loop `InvalidJWT`** del viejo emit-on-timeout (`63ef0bb`). Encima: **gateo del emit** (flag `healthyAwaited`:
emite solo si hay recuperación pendiente → arregla la regresión de arranque) y **endurecimiento de `SESSION_EXPIRED`**
(`getSession→null` transitorio del arranque ya no desloguea; árbitro único = `refresh.error`) — `3a0fd20`.
**Validado con `window.__satoriDiag`:** `armZombie`→`OFFLINE_WAITING` + backoff sin loop ni `InvalidJWT`; `disarm`→`ONLINE_SUBSCRIBED`
emite y recupera a SUBSCRIBED; **arranque sin cascada CLOSED**; **foco rutinario → `setAuth` SIN emit**. `useRealtimeRefetch`
byte-idéntico (su contrato no cambió). Cronología → **`docs/rca/2026-06-22-realtime-suspension.md`** + `ESTADO-ARCHIVO.md` (2026-06-24).

---

## 0-bis. 🆕 RESUELTO esta sesión (SOLO en staging, GATED) — el loop `OFFLINE_WAITING` tras suspensión LARGA

La máquina de 3 estados (§0, EN PROD) cubría el caso validado, pero **quedaba un modo de falla distinto**: tras una
suspensión **larga**, `getSession`/`refreshSession` **no vuelven** (el fetch interno queda sobre el socket zombi) y
`classifyRealtime` caía en `if (!sessionRead) return OFFLINE_WAITING` **sin escape** → loop eterno, el token no se
refresca y **el outbox no drena**. **El primer intento (bajar el lock 10s→5s, `ccef5f1`) fue un RED HERRING:** el escape
`no adquirido` disparó **0 veces** en TODOS los logs (incl. suspensión real ~4h) → el cuelgue es el fetch de auth, no la
adquisición del lock. Queda como hardening inofensivo.

**Fix real (client-side, solo staging):**
- `e0df9ae` — contador de timeouts consecutivos de `getSession`; tras **N=3** → `SESSION_EXPIRED` + `signOut({scope:'local'})`
  → `/login` → reingreso → el outbox drena (el signOut local NO toca el IndexedDB del outbox).
- `14e4546` — `signOut` SOLO en el path forzado (`forced:true`); el `refresh.error` vuelve a su comportamiento original
  (sin logout espurio) + **latch one-shot** (se limpia con sesión fresca en `onAuthStateChange`) → mata el ping-pong.

> ⚠️ **VALIDADO SOLO POR UNIT TESTS** (`supabase.timeout.test.ts`). **NO** físicamente aún. **GATE antes de prod:**
> (a) repro con `__satoriDiag.armZombie()` → **UN solo** `signOut`→`/login` sin ping-pong + `disarm()`→`ONLINE`+drain;
> (b) **suspensión real >1h** sobre el build de staging. **El pase a prod de este fix está GATEADO a que (b) pase.** Hotfix
> nuevo desde `main` con `e0df9ae`+`14e4546` (NO `ccef5f1` solo). Diagnóstico → **`docs/HANG-RCA-2.md`**.
> 🔧 **Identidad de build = `{base}version.json`→`.commit`**, NO un hash de chunk (el doc previo anotó mal `supabase-BjfeOB6h.js`).

---

## 0-ter. ✅ RESUELTO Y VALIDADO esta sesión — PANTALLA NEGRA (splash 祭 eterno tras suspensión / cold-launch)

**Causa raíz (capa de ARRANQUE, NO realtime):** en `useAuth.tsx` el bootstrap llamaba `getSession()` **y** `loadProfile()`
**sin tope**; sus `.finally(setLoading(false))`/`await` solo corren si la promesa SETTLEA → sobre el socket zombi se
colgaban → `loading` quedaba `true` para siempre → splash negro. Ningún fix de realtime tocaba esta capa de arranque
(Hallazgo A; por eso fallaba hace una semana). **Fix (3 commits sobre `692055d`):** `0adf30e` getSession con `withTimeout`
(→/login al vencer ~8s) · `f0f8127` loadProfile con `withTimeout`+1 reintento + `PrivateRoute` corta perfil nulo ·
`8bed794` `PublicRoute` exige `user&&profile` (corrige un LOOP `/`↔`/login` que introdujo `f0f8127`). Palanca de diag
`ee5878a` (`__satoriDiag.armBootHang('getSession'|'loadProfile')`, solo-staging). **✅ VALIDADO en staging** (determinístico
con `armBootHang` + natural; Service Worker Clients mostró `…/login`; build prod EXIT 0 + 138/138 tests).

---

## ★ PRIORIDAD 1 (pase a prod) — fix de PANTALLA NEGRA + coordinación de los 3 hotfixes
**Hotfix NUEVO desde `main`** (NUNCA mergear `staging`→`main`): cherry-pick **`0adf30e`+`f0f8127`+`8bed794`** en ese orden.
**NO** incluir `ee5878a` (la palanca de diag no va a prod). Verificación del pase: `VITE_APP_ENV=production npm run build`
(EXIT 0) + `grep -rE "armBootHang|boot-hang|BOOT HANG" dist/` **VACÍO** + suite verde + ritual de identidad
(`{base}version.json`→`.commit`). Requiere **firma de la dueña**. **Coordinar** con los otros 2 pendientes de prod (orden
y agrupación los decide la dueña): (2) `createDayMovement` (`hotfix/createdaymovement-durability-prod` `399fc0b`, ya
verificado, sin `supplier_id`); (3) auth-recovery (`e0df9ae`+`14e4546`, **gateado** a la suspensión real >1h, §0-bis). Los
tres son client-side, **sin migración**.

## ★ PRIORIDAD 2 — Hallazgo B: drain del outbox en `SIGNED_IN` (PLATA)
`outbox.ts` hoy flushea por `'online'` / arranque / un backoff que **se apaga con la cola vacía**; **NO** hay flush atado a
`SIGNED_IN`/re-login → "el outbox drena al reloguear" (premisa del fix de auth-recovery, §0-bis) **NO está garantizado**.
Es plata. Próxima rama: disparar `flushNow()` desde el `onAuthStateChange` con sesión fresca. Detalle → [HALLAZGOS.md](HALLAZGOS.md) §B.

---

## 1. 🟢 PLAN DE PASE A PROD — OPCIÓN A de la dueña: ESTABILIDAD primero, en 3 OLAS — **Ola 1 y 1.1 ✅ HECHAS**
**Principio:** la **estabilidad (Olas 1 + 1.1) fue ANTES que cualquier feature** y **ya está en prod, validada**.
⚠️ **Staging está ~143 commits y ~16 migraciones adelante de main → NUNCA mergear `staging`→`main`; a prod se va por
_cherry-pick selectivo_.** Hacer las olas EN ORDEN → **la SIGUIENTE es la Ola 2**.

### Ola 1 ✅ HECHA (en prod `2358f6c`, validada físicamente) — pase QUIRÚRGICO de estabilidad a MAIN
**Qué se hizo:** cherry-pick/port de la **cadena de la saga Realtime** (worker:true + blindaje por timeout + máquina de 3
estados + gateo del emit + endurecimiento `SESSION_EXPIRED`) **+ la durabilidad de escritura de caja (§0.2)**, SIN el PoS,
sin la Bandeja, sin migraciones (client-side puro). **La instrumentación se borró por prefijo:** logs `[rt-diag]` +
módulo `realtimeReproSwitch` fuera de main; tree-shaking confirmado (grep del dist de prod por `__satoriDiag|rt-diag|armZombie`
→ VACÍO). En `staging` el diag sigue activo por diseño. Caja/propinas/ventas de vuelta en prod **sin cuelgues**.

### Ola 1.1 ✅ HECHA (en prod `ead4727`+`483d29c`, validada físicamente) — timeout/abort del flush del outbox
**Qué se hizo:** las 5 llamadas de red del `supabaseExecutor` (`src/shared/offline/outbox.ts`) envueltas en
`withWriteTimeout` + `.abortSignal()` (mismo patrón que `cash.ts`), con **GUARDARRAÍL DE PLATA**: un timeout devuelve
`'retry'`, NUNCA `'fatal'` (fatal borra la op de la cola = pago perdido). **La cola del outbox drena sola tras suspender
la máquina** (antes el flush quedaba colgado en "por sincronizar" sobre el socket TCP zombi). Tests en `outbox.test.ts`.

### Ola 2 🟢🖊️ — (tras Ola 1) — Bandeja ETAPA 1 a prod con la mig 038
**Qué:** la **Etapa 1** (bandeja unificada `/inbox`, foto+IA Claude, enlace proveedor↔caja, visibilidad de pendientes)
**ya está construida y validada en staging** — esta ola la **activa en prod**. Da **foto+IA real sin construir nada nuevo**.
Es **esquema → firma de la dueña** (mig 038). ⚠️ **A verificar al planearla:** si la **mig 038 / la Etapa 1 se separan
limpio de las migraciones del PoS (022–037)** o vienen acopladas (define si se puede pasar la Bandeja sin arrastrar el PoS).

### Ola 3 🔲 — (cuando la base esté sólida y probada) — CONSTRUIR la Bandeja ETAPA 2
**Qué:** entrada **foto-primero 100% dentro de Caja Diaria** — hoy **🔲 DISEÑADA, SIN código** (no hay nada en
`src/modules/cash` ni `inbox`). Se construye **solo si** tras usar la Etapa 1 sigue haciendo falta.
> **🖊️ DECISIÓN ABIERTA de la dueña (define si la Ola 3 se hace):** *¿la Bandeja **Etapa 1** (unificada con IA, ya lista
> y validada) ALCANZA, o se necesita la **Etapa 2** (integración foto-primero dentro de Caja Diaria, a construir)?*

> **NO confundir con el GRAN PASE del PoS** (migs 022–037, comandero/KDS/cobro): es un **proyecto aparte y DIFERIDO**,
> posterior a estas olas y **bloqueado por el PILAR de escalabilidad de sesión/auth** (abajo) + validación física del PoS (§6).
> La dueña eligió OPCIÓN A (estabilidad), **no** el gran pase del PoS.

### 0.1 — Pendientes secundarios anotados (del trabajo de Realtime/caja)
- **(a) UX — el revive tarda hasta ~30 s en encolar tras suspensión.** Con la red zombi, la primera escritura de caja
  puede tardar hasta ~30 s en caer al outbox (suma de topes de 8s + reintentos). **Funciona** (no se pierde el pago,
  ver durabilidad de caja, ítem 0.2), pero la espera se nota. Ya con la máquina de 3 estados; re-evaluar la UX si molesta.
- **(d) Menor — `SESSION_EXPIRED` transitorio en el arranque (inofensivo).** En el primer tick del arranque
  `getSession()` puede dar `null` → se ve un `SESSION_EXPIRED` transitorio en los logs `[rt-diag]` (**solo en staging**;
  en prod los `[rt-diag]` ya no existen tras la Ola 1). **Inofensivo** (no desloguea ni emite; lo arbitra `refresh.error`); no urgente.
- **(b) ✅ HECHO esta sesión — `createDayMovement` blindado** (`dea9486`, en staging). Mismo patrón que
  `registerCashMovement`: id+`client_op_id` en el cliente, `withWriteTimeout`+`.abortSignal()`, reintento único, y ante
  timeout/red-zombi **encola incondicionalmente en el outbox** (idempotente por `client_op_id`). Contrato intacto
  (`Promise<string>`); sin tocar sagrados. Test en `cash.durability.test.ts` (2 casos nuevos). **Hotfix de prod listo y
  verificado:** `hotfix/createdaymovement-durability-prod` (`399fc0b`, cherry-pick sobre `main` SIN `supplier_id`, sin mergear).
- **(c) 🆕 BUG NUEVO (descubierto hoy) — `Cmd+Shift+R` estando en `/caja` deja la app colgada.** Un hard-reload en la
  ruta de Caja deja la app trabada (no termina de cargar). **Investigar:** reproducir, mirar consola/network, aislar si
  es Realtime/auth en el arranque de `/caja` o el SW/precache. Sin RCA todavía.

### 0.2 — ✅ Durabilidad de escritura de Caja (ya en staging `0dd258b`)
`registerCashMovement`/`updateCashMovement`/`deleteCashMovement`: el reintento ahora corre con `withWriteTimeout` (no
puede colgar) y, ante timeout o error de red, **encola INCONDICIONALMENTE en el outbox** (idempotente por
`client_op_id`); solo errores reales del server (RLS/FK/constraint) suben con throw. **Root cause** del bug viejo:
confiar en `isOffline()`/`navigator.onLine`, que en red zombi vale `true` → nunca encolaba y se perdía el pago.
Invariante: **toda escritura de caja termina confirmada en el server o encolada — nunca colgada, nunca descartada.**
Test `cash.durability.test.ts`. (No requiere acción; queda como referencia del patrón a replicar en (b).)

## 0bis-A. ⚠️ FOOTGUN de build — `npm run build` local compila como STAGING
Cualquier `npm run build` local **SIN forzar `VITE_APP_ENV`** compila como **STAGING**, no como prod: hay un
`.env.local` que setea `VITE_APP_ENV=staging` y Vite lo carga en **todos** los modos. Consecuencia: el bloque de
diagnóstico gateado por `VITE_APP_ENV==='staging'` (y cualquier código solo-staging) **queda incluido**, no se
tree-shakea. **Para verificar tree-shaking / un build prod real:** forzar el valor explícito —
`VITE_APP_ENV=production npm run build` (process.env gana sobre `.env.local`) o mover `.env.local` aparte. Verificado
en esta sesión: con `VITE_APP_ENV` ≠ staging (explícito **o** sin setear, como en CI) el DCE **elimina** el bloque +
su `import()` → no queda chunk del diag y `window.__satoriDiag` es `undefined`.

## 0bis-B. ⚠️ GOTCHA DE VERIFICACIÓN — `tsc --noEmit` es un FALSO VERDE (usar `npm run build`)
El `tsconfig.json` raíz tiene `"files": []` + `references` (estilo solución) → **`npx tsc --noEmit` no chequea NINGÚN
archivo** (es no-op). El typecheck REAL es **`npm run build`** = `tsc -b` (compila los proyectos referenciados, incl. los
`*.test.ts` vía `tsconfig.app.json`). En el pase de la Ola 1.1 un cast en un test (`SupabaseClient as Record<…>`) pasó
`tsc --noEmit` pero **rompió `tsc -b`** (TS2352); quedó latente en staging y solo apareció en el pase a prod. **Regla:
toda verificación de un pase corre `VITE_APP_ENV=production npm run build`, NUNCA `tsc --noEmit`.** Castear tipos
incompatibles en tests: `x as unknown as T`.

---

## 0bis. 🔐 Rotar los 2 tokens de GitHub (seguridad — pendiente de la sesión)

1. **`gh auth refresh -s repo,read:org,workflow`** (correr en terminal interactiva — abre device-flow en el navegador).
   El token `gho_` que estaba **embebido en el remote de `SATORI PROPINAS`** ya se limpió del `.git/config`
   (`git remote set-url` sin credenciales; auth ahora por osxkeychain), **pero sigue válido en GitHub hasta rotarlo**.
2. **Regenerar el PAT classic `ghp_` "Claude CLI" SIN scope `admin:org`** — su valor quedó en un transcript local de
   Claude Code (`~/.claude/projects/.../*.jsonl`). **Rotar ANTES del 27-jun.** (No está configurado en ningún remote/env/MCP;
   solo persiste en ese log.)

---

## 🚧 PILAR BLOQUEANTE — Arquitectura de sesión/auth escalable y multi-tenant (ALTA prioridad)

> **🔴 BLOQUEA el pase del PoS a PROD (ítem 5).**

La app hoy usa un **candado de sesión** (`navigator.locks`) que se contiende con pocos dispositivos.
El PoS llevará **~10 dispositivos concurrentes** (5 tablets salón + 2 cajas + 2 KDS + 1 cocina),
distintos usuarios al mismo tiempo. Antes del rollout del PoS hay que **rediseñar cómo cada dispositivo
mantiene su sesión sin pelear por el refresh del token**. **Objetivo de diseño:** escalable a
**HOTELERÍA con MÚLTIPLES restaurantes** y a **FRANQUICIAS** (multi-local / multi-tenant). **NO es un
parche:** es **diseño + prueba de carga simulando N dispositivos** antes de tocar prod. **Bloquea el
pase del PoS a producción.**

---

## 1. 🖊️👁️ Hora-CR en bordes de período (PLATA — cambia números, valida la dueña)
**Misma familia que el `-31`, NO tocada en el fix porque cambia atribuciones.** El fix de fechas resolvió el
400 (cobertura por día), pero las queries de plata siguen acotando `created_at` en **UTC** (`…Z`), con offset
**+6h** vs CR. Lugares: `finance.ts:132/139` (P&L borde de **año** — NO da 400 porque dic tiene 31, pero el
31-dic de noche cae en el año equivocado) y similares. **Diseño:** construir los límites en hora CR (mismo
`dateCR` ya usado). **Bloqueado por:** validación física de la dueña contra un cierre conocido (cambia números).
Ver `_handoff/RCA-FECHAS-BORDE.md` §5 + `fix/fecha-cr-consistente` (ya en staging, también pendiente de validar).

## 2. 🔲 Pendientes menores en PROD (prolijidad, NO bloquean — detectados en la validación física de las Olas)
- **404 de un recurso en la ruta `/caja`** (🆕 esta sesión) — aparece en consola, no rompe el flujo. Identificar el
  recurso (asset/manifest/SW/icono) en DevTools → Network y agregarlo o quitar la referencia. *(Relacionado, a mirar
  junto: §0.1(c) "Cmd+Shift+R en `/caja` deja la app colgada".)*
- **404 menor sobre `propinas:1`** — probablemente un icono o source-map; las pantallas cargan igual.
- **Warning cosmético de recharts** (🆕) — `width(-1)/height(-1)` con contenedor de 0px al montar; solo ruido en consola,
  sin impacto visual. Envolver el chart para que no renderice con tamaño 0, o suprimir.
- **La Lenovo del restaurante (KDS de cocina) quedó con bundle viejo** (🆕) — requiere **Unregister SW + Clear site data**
  una vez en ese equipo para tomar el deploy nuevo (el watchdog de arranque debería curarlo solo; si no, a mano).

## 3. 🖊️ Migraciones — discrepancia 035 + verificar 038
- **035:** el ledger de staging la tiene **como aplicada** aunque el archivo solo vive en `propina-pool` (sin merge).
  Sesión dedicada de propinas: entender el origen ANTES de tocar nada. **NO tocar el historial de migraciones**.
- **038 (Bandeja):** el registro previo la marca **aplicada y firmada en STAGING** (`0205654`); este handoff la dejó
  anotada para **confirmar su estado real en el ledger** antes de actuar. A **PROD va con el pase del PoS** (sin aplicar aún ahí).
- Detalle en `_handoff/038-apply.log`. (No puedo verificar el estado del ledger desde acá — cero contacto con la base.)

## 4. 🔲 Bandeja ETAPA 2 — entrada única foto-primero 100% dentro de Caja Diaria (DISEÑADA, SIN código → es la Ola 3)
**= la Ola 3 de §1, y solo si la DECISIÓN ABIERTA de la dueña dice que la Etapa 1 no alcanza.** Hoy no hay código en
`src/modules/cash` ni `inbox`. La Bandeja **Etapa 1** (lo que SÍ está hecho y validado en staging) es distinta. Diseño de la Etapa 2:
- **Una sola entrada foto-primero** dentro de **Caja Diaria**; se **retira** el camino `facturas` (queda legacy).
- **Foto OBLIGATORIA** por pago. La **IA lee y SUGIERE** tipo/categoría (mercadería/operativo/personal/socios)
  mapeando a las categorías existentes; el **humano confirma** (nunca auto-commit de montos).
- **Propinas:** pide **turno (AM/PM)+fecha** en vez de proveedor y **concilia el pendiente**.
- **Offline — Opción A:** se registra el pago igual sin red; la IA procesa la foto al volver internet.

## 5. 🖊️ GRAN PASE del PoS a PROD — DIFERIDO (NO es una de las 3 olas)
La dueña eligió OPCIÓN A (estabilidad, §1). El gran pase del PoS es un **proyecto aparte y posterior**: consolidar las
migraciones del PoS (**022–037**) con guard anti-staging; crear buckets `facturas`/`productos`/`documents` en prod;
regenerar tipos. Bloqueado por el **PILAR de escalabilidad de sesión/auth** (abajo) + validación física del PoS (§6).
(La **Bandeja Etapa 1 + mig 038** NO espera a esto: va sola en la **Ola 2** — ver §1, sujeto a verificar que la 038 se
separe limpio de 022–037.)

## 6. 👁️ Validación física pendiente en staging (construido, verde, sin probar en piso)
Checklist en [REPORTE-NOCHE-2.md](REPORTE-NOCHE-2.md): **cobro + anti-doble-cobro** (mig 033), **comandero pro**,
**FE estructura (SIM)**, **inventario activo** (stock baja por receta + COGS al cerrar).

## 7. 🖊️ DECISIÓN dueña — propina PoS → pool (`propina-pool`, sin merge)
¿Propina de tarjeta/SINPE al **mismo** pool que efectivo (implementado) o **separada**? Sin tocar
`tipCalculations`. `git show propina-pool:ESTADO-PROPINA-POOL.md`.

## 8. 🟢 Deudas a futuro (documentadas, no urgentes)
- **Cuentas por pagar / crédito a proveedores 7-15-30 días** (fecha de PAGO ≠ fecha de registro).
- **Alerta de cambio de precio** de un producto (que el contador la detecte → ajustar la receta).
- **Offline robusto** con base local que sincroniza al volver internet.
- **Unidades de inventario por presentación** (kilo/litro/gramos; huevos por maple/caja) por ingrediente.
- **FE real:** emisor certificado CR (Hacienda 4.4) detrás de `FeProvider`. Bloqueado por CIIU/CABYS de la contadora.

## 9. 🟢 Deuda de lint del repo (ingeniería lista, baja prioridad)
`npm run lint` (eslint .) reporta **81 problemas (69 err + 12 warn) preexistentes** repartidos en ~30 archivos —
NO de ningún fix reciente. **Se absorbe en la estabilización por módulo:** al tocar un módulo, se limpia su lint
ahí; **NO barrido masivo** (68/69 son manuales — solo 1 autofixable con `--fix` — y caen en módulos en uso →
riesgo sin ganancia funcional). Dos grupos:
- **Grupo A (~28, cosmético/seguro):** `no-unused-vars`, `preserve-caught-error` (3 en `cash.ts`, solo
  observabilidad — NO matemática), `react-refresh/only-export-components`, `eslint-disable` muertos.
- **Grupo B (~41, correctness/perf-adjacent — revisar por archivo, NO `--fix` a ciegas):**
  `react-hooks/set-state-in-effect`, `react-hooks/refs`, `react-hooks/preserve-manual-memoization`.
