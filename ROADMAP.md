# Satori App — Roadmap a producto óptimo

De dashboard de analítica a sistema operativo del restaurante.
**Satori Sushi Bar · Santa Teresa & Nosara, Costa Rica · Actualizado 2026-06-25**

---

## 📍 Estado real de las fases (handoff 2026-06-25)

Leyenda: ✅ hecho y en PROD · 🟢 hecho y en STAGING (verde, falta validación física/pase a prod) · ⏳ en curso/parcial · 🔲 no empezado.
> Nota: en este bloque ✅ con etiqueta "en STAGING" = mergeado y verde en staging (no necesariamente validado por la dueña ni en prod).

> **PROD (`main` `5f22754`) tiene las Olas 1 y 1.1 de estabilidad (validadas) + el fix de la PANTALLA NEGRA del bootstrap (✅ EN PROD, deploy confirmado `version.json=5f22754`; **✅ validado físicamente por la dueña**) → la app vuelve a ser usable.** El trabajo de FEATURES vive en `staging` (código `ee5878a`); a prod se va por **cherry-pick selectivo**, NUNCA mergeando `staging`→`main`. **🆕 Pendientes de pase a prod (en staging):** durabilidad de `createDayMovement` (`399fc0b`) + fix de auth-recovery (🟡 gateado a suspensión real >1h). Ver ESTADO §b-ter + `docs/HANG-RCA-2.md`.

| Fase | Estado | Dónde |
|---|---|---|
| Capa 1 — Inteligencia (ventas/propinas/caja/reportes/finanzas/auth/realtime/offline) | ✅ | PROD (`main`, migs ≤021) |
| **Estabilidad PWA — fix del SW viejo en prod** (updateViaCache:'none' + version.json cache-bust) | ✅ **VALIDADA en PROD** | PROD (`fde9264`) — RCA `_handoff/PROD-SW-RCA.md` |
| **Fix de fechas de borde de mes** (`-31`→400; helper `monthRangeBounds`, result-preserving) | ✅ **VALIDADA en PROD** | PROD (`ff836a0`) — RCA `_handoff/RCA-FECHAS-BORDE.md` |
| **Fix Realtime/candado de auth** (R1 `setAuth` global + saca `getSession` por-hook; R2 revive REVERTIDO) | ✅ **en PROD vía canario** | PROD (`04b1a32`, cherry-picks `deb7da2`/`18c9082`/`9f3ebe0`). Hist. `HANG-RCA.md` |
| **Realtime se cuelga tras suspensión profunda** (desync token HTTP↔socket + auth-ops zombi que cuelgan la recuperación) | ✅ **RESUELTO Y VALIDADO — EN PROD (Ola 1)** | **PROD (`2358f6c`)** + staging (`3a0fd20`): saga cerrada con la máquina de 3 estados (↓). En prod SIN diag; en staging `[rt-diag]` activo. **RCA → `docs/rca/2026-06-22-realtime-suspension.md`** |
| **REDISEÑO recuperación Realtime — máquina de 3 estados** (`ONLINE_SUBSCRIBED`/`OFFLINE_WAITING`/`SESSION_EXPIRED`) **+ gateo del emit + endurecimiento `SESSION_EXPIRED`** | ✅ **HECHO Y VALIDADO — EN PROD (Ola 1)** | **PROD (`2358f6c`)** + staging (`63ef0bb`+`3a0fd20`). Regla madre: nunca `rt:healthy` sin token fresco confirmado; ningún camino en loop. **Validado físico con `__satoriDiag`** (armZombie→OFFLINE_WAITING sin loop; disarm→recupera; arranque sin cascada CLOSED) |
| **Durabilidad de escritura de Caja** (reintento con tope + encola SIEMPRE en outbox ante timeout/red-zombi) | ✅ **EN PROD y VALIDADA (Ola 1)** | **PROD (`2358f6c`)** + staging (`0dd258b`) — root cause: confiar en `navigator.onLine` (miente en zombi). Tests `cash.durability.test.ts` + `supabase.timeout.test.ts` |
| **Outbox — timeout/abort del flush** (`supabaseExecutor` con `withWriteTimeout`+`.abortSignal()`; **guardarraíl: timeout→retry, NUNCA fatal**) | ✅ **EN PROD y VALIDADA (Ola 1.1) — la cola drena sola** | **PROD (`ead4727`+`483d29c`)** + staging (`4805e23`). Antes el flush quedaba colgado en "por sincronizar" sobre el socket zombi. Test `outbox.test.ts` (9 casos) |
| **🆕 Auth recovery — loop `OFFLINE_WAITING` tras suspensión LARGA** (el caso que la máquina de 3 estados NO cubría: `getSession`/`refreshSession` no vuelven → sin escape) | 🟡 **en STAGING, SOLO unit tests** (gate físico pendiente) | STAGING (`e0df9ae` escape N=3 + `14e4546` signOut acotado + latch one-shot). El lock 10s→5s (`ccef5f1`) fue **red herring** (hardening). **RCA → `docs/HANG-RCA-2.md`**. Gate a prod: **suspensión real >1h** |
| **🆕 `createDayMovement` — durabilidad** (id+`client_op_id`+`withWriteTimeout`+outbox; cierra el hueco nivel-día de Caja) | 🟢 **en STAGING** (`dea9486`) · hotfix prod listo (`399fc0b`, sin mergear) | STAGING + `hotfix/createdaymovement-durability-prod`. Test `cash.durability.test.ts` |
| **🆕 PANTALLA NEGRA — bootstrap de `useAuth` con tope** (getSession + loadProfile sin tope se colgaban → splash 祭 eterno; capa de arranque que ningún fix de realtime tocaba — Hallazgo A) | ✅ **EN PROD (`5f22754`), VALIDADO POR LA DUEÑA** | **PROD (`a1342c8`+`fd2755c`+`5f22754`)** + STAGING (`0adf30e`+`f0f8127`+`8bed794`). Deploy confirmado (`version.json=5f22754`); la app se sostiene abierta sin el cuelgue (antes ~3 min). **Receta de prod = 3 commits + 2 exports en `supabase.ts`** (ver ESTADO §b-ter) |
| **Switch de diagnóstico de Realtime** (`window.__satoriDiag`; reproduce el cuelgue a demanda en ~30 s) | ✅ **validado en STAGING** | STAGING (`c9e0a24`) — solo-staging, gateado por `VITE_APP_ENV`; DCE lo borra de prod. `armZombie` dispara CHANNEL_ERROR al instante |
| **Bandeja fusionada + enlace proveedor + visibilidad pendientes Caja + fechas CR — Etapa 1** | ✅ **COMPLETA y VALIDADA** en staging · **mig 038 APLICADA** (`0205654`) | STAGING (contador registra + "✓ Verificar" validados por la dueña; a prod con el pase del PoS) |
| **Bandeja — Etapa 2** (entrada única foto-primero dentro de Caja Diaria) | 🔲 diseñada | — (ver §1bis) |
| PoS F0 — Fundaciones (offline-first ✅; investigación FE ⏳; spike impresión 🔲) | ⏳ | mixto |
| PoS F1 — Catálogo + salón + multi-local | 🟢 | STAGING (022) |
| PoS F2 — Comandero + KDS + impresión (impresión real = F5) | 🟢 | STAGING (023–025) |
| PoS F3 — Cobro + splits + propina capturada + ticket SIM | 🟢 | STAGING (027–034) |
| FE — **estructura** (SIM, sin Hacienda) | 🟢 | STAGING (036) |
| FE — **real** (emisor certificado CR) | 🔲 | bloqueado por CIIU/CABYS |
| Inventario activo F1 — depleción por venta + COGS real | 🟢 | STAGING (037) |
| Inventario F1 — orden de compra + puente compra→caja→stock | 🔲 | — |
| Propina PoS → pool del turno | ⏳ | rama `propina-pool` (sin merge, espera decisión dueña) |
| **Pase a PROD — OPCIÓN A de la dueña: ESTABILIDAD primero, en 3 OLAS** (ver §"Plan de pase a prod") | 🟢 **Ola 1 + 1.1 ✅ EN PROD** · Ola 2 = siguiente | ✅ Ola 1 estabilidad (`2358f6c`, sin PoS, sin diag) + ✅ Ola 1.1 flush del outbox (`483d29c`) → ⏳ Ola 2 Bandeja Etapa 1 + mig 038 → 🔲 Ola 3 construir Etapa 2 (si hace falta). ⚠️ NUNCA `staging`→`main` (143 commits / 16 migs adelante): solo cherry-pick |
| GRAN pase del PoS a PROD (migs PoS 022–037) | 🔲 **DIFERIDO** | NO es parte de las 3 olas; proyecto aparte y posterior, bloqueado por el PILAR de sesión/auth |
| F4 Loyalty en mesa + Nosara · F5 Hub local | 🔲 | futuro |

> Detalle de cada fase abajo. Lo nuevo de junio (Bandeja fusionada, FE estructura, inventario activo,
> comandero pro) vive en `staging`. Backlog priorizado: [PROMPT-CONTINUACION.md](PROMPT-CONTINUACION.md).

---

## 🚀 PLAN DE PASE A PROD — OPCIÓN A de la dueña (estabilidad primero, 3 OLAS)

> **Principio:** primero **devolver la app estable** a prod, recién después features. ✅ **Ola 1 + 1.1 + fix de la PANTALLA
> NEGRA YA están en prod** (`main` `04b1a32`→`483d29c` (Olas) →`5f22754` (pantalla negra); la cola del outbox drena sola).
> ⚠️ **Staging está ~143 commits y ~16 migraciones adelante de main → NUNCA mergear `staging`→`main`; a prod se va por
> _cherry-pick selectivo_.**

- **OLA 1 — ✅ HECHA (en prod `2358f6c`, validada físicamente).** Pase QUIRÚRGICO de estabilidad a `main` (cherry-pick,
  SIN el PoS): cadena de la saga Realtime (worker:true + blindaje por timeout + máquina de 3 estados + gateo del emit +
  endurecimiento `SESSION_EXPIRED`) **+ durabilidad de escritura de caja**. Client-side, sin migración. Se borró la
  instrumentación por prefijo (`[rt-diag]`/`realtimeReproSwitch` fuera de main; tree-shaking confirmado: grep del dist de
  prod → VACÍO). Caja/propinas/ventas de vuelta en prod **sin cuelgues**.
- **OLA 1.1 — ✅ HECHA (en prod `ead4727`+`483d29c`, validada físicamente).** Timeout/abort en el ejecutor del flush del
  outbox (`supabaseExecutor`), con **guardarraíl de plata** (timeout → `'retry'`, NUNCA `'fatal'`). **La cola del outbox
  drena sola tras suspender la máquina** (antes el flush quedaba colgado en "por sincronizar" sobre el socket zombi).
- **OLA 2 — (SIGUIENTE) — llevar la Bandeja ETAPA 1 a prod con la mig 038.** La Etapa 1 (unificada
  `/inbox`, foto+IA, enlace proveedor↔caja) **ya está construida y validada en staging**; esto la activa en prod. Es
  esquema → **firma de la dueña**. ⚠️ **A verificar al planearla:** si la **mig 038 / Etapa 1 se separan limpio de las
  migraciones del PoS (022–037)** o vienen acopladas. Da **foto+IA real sin construir nada nuevo**.
- **OLA 3 — (cuando la base esté sólida y probada) — CONSTRUIR la Bandeja ETAPA 2** (entrada foto-primero 100% dentro
  de Caja Diaria; hoy **🔲 diseñada, SIN código**). **Solo si** tras usar la Etapa 1 sigue haciendo falta. → **DECISIÓN
  ABIERTA de la dueña:** ¿alcanza la Etapa 1 o se necesita la Etapa 2?
- **🆕 PASE A PROD — estado (detalle/orden en PROMPT-CONTINUACION §1):**
  1. ✅ **PANTALLA NEGRA — HECHA, EN PROD (`5f22754`), VALIDADA POR LA DUEÑA.** Hotfix FF a `main`; deploy confirmado (`version.json=5f22754`) y validación física en dispositivo OK. **Receta = 3 commits + 2 exports** (ESTADO §b-ter).
  2. 🟢 **`createDayMovement` — PENDIENTE:** `hotfix/createdaymovement-durability-prod` (`399fc0b`), **verificada y lista** (sin `supplier_id`).
  3. 🟡 **Auth-recovery** (`e0df9ae`+`14e4546`, NO el lock `ccef5f1` solo) — **PENDIENTE, gateado** a la suspensión real >1h (`docs/HANG-RCA-2.md`). El orden lo decide la dueña.

> El **gran pase del PoS** (migs 022–037, comandero/KDS/cobro) es un **proyecto aparte y DIFERIDO**, posterior a estas
> olas y bloqueado por el PILAR de sesión/auth (abajo). No confundir con la Ola 2 (que lleva **solo** la Bandeja Etapa 1).

---

## 🚧 PILAR BLOQUEANTE — Arquitectura de sesión/auth escalable y multi-tenant (alta prioridad)

> **🔴 BLOQUEA EL PASE DEL PoS A PRODUCCIÓN.**

La app hoy usa un **candado de sesión** (`navigator.locks`) que se contiende con pocos dispositivos.
El PoS llevará **~10 dispositivos concurrentes** (5 tablets salón + 2 cajas + 2 KDS + 1 cocina),
distintos usuarios al mismo tiempo. Antes del rollout del PoS hay que **rediseñar cómo cada dispositivo
mantiene su sesión sin pelear por el refresh del token**.

**Objetivo de diseño:** escalable a **HOTELERÍA con MÚLTIPLES restaurantes** y a **FRANQUICIAS**
(multi-local / multi-tenant).

**NO es un parche:** es **diseño + prueba de carga simulando N dispositivos** antes de tocar prod.
**Bloquea el pase del PoS a producción.**

---

## 🧾 Bandeja / Caja — Etapa 1 (✅ COMPLETA y validada en staging) y Etapa 2 (🔲 diseñada)

**Etapa 1 — en staging, validada físicamente por la dueña.** Se fusionaron las dos bandejas en una
sola (`/inbox`, foto-primero, con IA Claude). Se eliminó "Bandeja Proveedores" (`/proveedor` +
`ProveedorBandeja.tsx` + tile + ROLE_LANDING); el rol `proveedor` queda muerto en el enum (DDL solo
aditivo). Matriz de pago por rol (cajero/manager: Efectivo con caja abierta · Transferencia→Pendiente
o Pagado-desde-Banco; contador/owner: solo Pendiente o Banco, nunca efectivo). Verificado de factura
(`FacturaVerify`) en Caja→Movimientos y Finanzas. Sobre eso:
- **Enlace proveedor↔caja:** la Bandeja resuelve `supplier_id` (match por nombre o alta mínima) en
  los 4 caminos → el pago aparece bajo su proveedor en Caja→Proveedores con estado + indicador de
  foto (📷 / "⚠ falta factura" + agregar foto → bucket `documents` + IA + inventario).
- **Visibilidad pendientes en Caja Diaria:** los pagos transferencia-pendiente nivel-día se muestran
  (solo-lectura, no tocan la matemática del efectivo). `created_at` = día de registro; la fecha de
  factura va a la descripción.
- **Fechas/mes en hora CR** (`dateCR`) en Movimientos/Pendientes/P&L — **MERGEADO a staging**
  (`cb25672`). **Pendiente validación física:** Movimientos de noche + P&L borde de mes.
- **mig 038 APLICADA a staging** (la dueña firmó y la corrió; cierre por CLI + tipos en `0205654`):
  enciende los dos caminos que estaban gateados por RLS — el **contador registra** egresos no-efectivo
  desde la Bandeja y el botón **"✓ Verificar"** (RPC `mark_factura_verified`). Ambos **VALIDADOS
  físicamente por la dueña** con usuario rol contador → **Etapa 1 cerrada en staging**. (No en prod:
  la 038 va a prod con el pase del PoS.)

**Etapa 2 — diseñada, pendiente.** Entrada única **foto-primero 100% dentro de Caja Diaria**: se
retira el camino `facturas` (queda legacy); **foto obligatoria**; la IA lee todo y **sugiere**
tipo/categoría (mercadería/operativo/personal/socios) mapeando a las categorías existentes, el humano
confirma; **propinas** piden turno (AM/PM)+fecha en vez de proveedor y concilian el pendiente;
**offline Opción A** (se registra el pago igual, la IA procesa al volver la red).

## 🆕 Backlog nuevo (junio 18) — además de las fases de arriba

- **✅ RESUELTO y EN PROD (jun-21) — Estabilidad de la PWA (SW viejo):** registro manual con
  `updateViaCache:'none'` + `injectRegister:null` + chequeo de `version.json` con cache-bust (`fde9264`).
  Funciona en GitHub Pages (donde `_headers` no aplica). Validado Mac/iPhone/Lenovo. En staging además
  está el `public/_headers` no-cache (Cloudflare) y el refresco de token en foco (`useAuth refreshOnFocus`).
- **✅ RESUELTO y EN PROD (jun-21) — Fechas de borde de mes (400 por `-31`):** helper `monthRangeBounds`
  (límite superior exclusivo = 1° del mes siguiente) en Inicio/Reporte Mensual/Food Cost; result-preserving
  para meses de 31 días (`ff836a0`). RCA `_handoff/RCA-FECHAS-BORDE.md`.
- **✅ RESUELTO y EN PROD vía canario (jun-22) — Contención del candado de auth (tercera causa
  del "se traba"):** el `getSession()` por-hook de `useRealtimeRefetch` tomaba `navigator.locks` en cada
  (re)suscripción → con varios módulos/dispositivos se apilaban pedidos → `[auth] lock no adquirido en 10s` →
  app trabada. R1 `onAuthStateChange` global propaga el JWT al socket (cura el loop `InvalidJWTToken`/"Token has
  expired"); R2 revive del socket **mergeado y luego REVERTIDO** (subía la contención sin beneficio probado); fix
  final (`fix/auth-lock-contention`, `09480a6`) **saca el `getSession()` redundante**. Pasó a PROD por canario
  (`04b1a32`, cherry-picks `deb7da2`/`18c9082`/`9f3ebe0`; sin round 2). Es client-side sin migración. Hist. `HANG-RCA.md`.
- **✅ EN STAGING (jun-23) — Durabilidad de escritura de Caja:** en `registerCashMovement`/`updateCashMovement`/
  `deleteCashMovement` el **reintento** corría SIN tope sobre el TCP zombi → la promesa nunca settleaba → la fila se
  perdía al navegar; y el encolado dependía de `isOffline()` (`navigator.onLine`), que en zombi vale `true` → nunca
  encolaba. Fix (`0dd258b`/`283f86e`): el reintento va con `withWriteTimeout` y, ante timeout o error de red, **encola
  INCONDICIONALMENTE en el outbox** (idempotente por `client_op_id`); solo errores reales del server (RLS/FK) suben.
  Invariante: **toda escritura de caja termina confirmada en el server o encolada — nunca colgada, nunca descartada en
  silencio.** Test `cash.durability.test.ts`.
- **✅ VALIDADO EN STAGING (jun-23) — Switch de diagnóstico de Realtime (solo-staging):** `src/shared/diag/`
  `realtimeReproSwitch.ts` expone `window.__satoriDiag` (`armZombie`/`armExpired`/`disarm`/`status`). Reproduce el
  cuelgue de Realtime **a demanda en ~30 s** (antes 3+ h): `armZombie` dispara CHANNEL_ERROR al instante. Gateado por
  `VITE_APP_ENV==='staging'` (DCE lo borra de prod). Es la herramienta para validar el rediseño de Realtime. Logs `[diag-repro]`.
- **✅ RESUELTO Y VALIDADO EN STAGING (jun-24) — Realtime se cuelga tras suspensión profunda:** raíz en dos capas —
  (1) desync token HTTP↔socket (socket con JWT vencido pero `isConnected()=true`), y (2) la más grave: las auth-ops
  (`getSession`/`refreshSession`) que la recuperación usa **se colgaban sobre la conexión zombi y nunca settleaban** →
  `ensureRealtimeHealthy` clavado → app muerta hasta recargar. **Solución cerrada:** `ensureRealtimeHealthy` rediseñada
  como **MÁQUINA DE 3 ESTADOS** (`63ef0bb`: `ONLINE_SUBSCRIBED`/`OFFLINE_WAITING`/`SESSION_EXPIRED`; regla madre — nunca
  `rt:healthy` sin token fresco confirmado, ningún camino en loop → mató el **loop `InvalidJWT`** del viejo
  emit-on-timeout), más **gateo del emit** (flag `healthyAwaited`: emite solo si hay recuperación pendiente → arregla la
  regresión de arranque) y **endurecimiento de `SESSION_EXPIRED`** (`getSession→null` transitorio del arranque ya no
  desloguea; árbitro único = `refresh.error`) — `3a0fd20`. **Validado físicamente** con `window.__satoriDiag`
  (armZombie→OFFLINE_WAITING + backoff sin loop; disarm→recupera a SUBSCRIBED; arranque sin cascada CLOSED; foco
  rutinario sin re-subscribe). `useRealtimeRefetch` byte-idéntico (su contrato no cambió). Detalle →
  **`docs/rca/2026-06-22-realtime-suspension.md`** + `ESTADO-ARCHIVO.md` (2026-06-24). ✅ **YA EN PROD vía la Ola 1
  (`2358f6c`), SIN diag** (los `[rt-diag]`/`realtimeReproSwitch` se borraron por prefijo en el pase; grep del dist de
  prod → VACÍO). En `staging` los `[rt-diag]`/`[diag-repro]` siguen activos por diseño (gateados por `VITE_APP_ENV`).
- **⏳ PENDIENTE (cambia números, valida la dueña) — hora-CR en bordes de período:** el fix del `-31`
  resolvió el 400, pero las queries de plata siguen acotando `created_at` en **UTC** (`…Z`). `finance.ts:132/139`
  (P&L borde de **año** — NO da 400 porque dic tiene 31, pero el 31-dic de noche cae en el año equivocado por
  el offset +6h) y similares. Pasar los límites a hora CR. Misma familia que el `-31`, **NO tocada** porque
  cambia atribuciones → requiere validación física. Ver `_handoff/RCA-FECHAS-BORDE.md` §5.
- **🔲 404 menor en prod sobre `propinas:1`** (recurso faltante, probablemente icono o source-map; **NO afecta
  operación**). Prolijidad, baja prioridad — falta identificar el archivo exacto (Network con filtro vacío).
- **🔲 Discrepancia mig 035** en el ledger de staging (registrada como aplicada sin merge) — sesión dedicada
  de propinas, **sin tocar el historial** hasta entender el origen.
- **Cuentas por pagar / crédito a proveedores 7-15-30 días** (fecha de PAGO ≠ fecha de registro).
- **Alerta de cambio de precio** de un producto (que el contador la detecte y se ajuste la receta).
- **Offline robusto** con base local que sincroniza con Supabase al volver internet.
- **Unidades de inventario por presentación** (kilo/litro/gramos; huevos por maple/caja) editables por
  ingrediente, recordadas por proveedor.
- **🔲 Deuda de lint (69 err + 12 warn preexistentes) — PRIORIDAD BAJA, debajo de la estabilización de
  caja/bandeja/propinas/ventas.** `npm run lint` (eslint .) reporta 81 problemas repartidos en ~30 archivos;
  es deuda preexistente, NO de ningún fix reciente. **NO hacer barrido masivo:** 68 de los 69 errores son
  manuales (solo 1 es autofixable con `--fix`) y caen en módulos en uso → riesgo sin ganancia funcional.
  **Estrategia:** absorber la limpieza POR ARCHIVO dentro de la estabilización módulo-por-módulo ya planeada
  (al tocar un módulo, se limpia su lint). Desglose:
  - **Grupo A (~28: `no-unused-vars`, `preserve-caught-error`, `react-refresh/only-export-components`,
    `eslint-disable` muertos)** = cosmético, seguro. *(Los 3 `preserve-caught-error` están en `cash.ts` y son
    solo observabilidad — NO tocan matemática.)*
  - **Grupo B (~41: `react-hooks/set-state-in-effect`, `react-hooks/refs`, `react-hooks/preserve-manual-memoization`)**
    = correctness/perf-adjacent, requiere revisión por archivo, **NO `--fix` a ciegas.**

---

## 0. Dónde estamos hoy (honesto)

Satori App no es un POS. Hoy es una capa de inteligencia de negocio que se monta sobre el POS existente: las ventas entran por import XLS (export del POS actual), y sobre esos datos la app calcula todo lo demás.

**Lo que ya funciona en producción (maduro):**

| Dominio | Estado |
|---|---|
| Ventas / analítica | ✅ 16 vistas (Hoy, Mix, Análisis, MenuEng, Evaluación, ICP, Saloneros, Metas…) |
| Propinas | ✅ pool por turno, coberturas (persistidas en DB), verificación, quincenal, pool cocina, stats, registro de turnos atrasados (fecha+turno) con bloqueo de duplicados, edición completa desde Historial (modal, incl. cobertura) |
| Caja | ✅ turnos (Caja Diaria: proveedores + pagos operativos), cierre del día 2 fases (TC config, retiro a banco), movimientos (Cuenta P&L por mov., Banco→Caja Fuerte, ajustes de cierre), pendientes agrupados por proveedor + comprobante PNG, resumen mensual, descartar turno / deshacer cierre |
| **Ingesta por foto (IA)** | ✅ **Bandeja operativa**: foto de factura/comprobante → Claude Haiku 4.5 (multi-doc, esquema CR) → genera el movimiento solo; revisión humana en manuscritas/baja confianza |
| Finanzas / P&L | ✅ presupuesto vs real automático desde caja/ventas; cuenta contable explícita por movimiento; retiros/ajustes fuera del P&L |
| Reportes | ✅ diario, semanal, mensual unificado, emails automáticos (ventas+propinas) |
| Admin | ✅ empleados, puntos por rol, tipo de cambio, horas trabajadas |
| Datos históricos | ✅ 2023→hoy migrados y verificados |
| SOPs | ✅ CRUD + **19 procedimientos reales migrados** (caja, servicio, delivery, pagos, manager) con render legible |
| Usuarios / Auth | ✅ login + **auto-registro de empleados** + aprobación del owner (rol + activación) por pantalla Admin |
| Inventario / Recetas | 🟢 (staging) depleción por venta + COGS real al cerrar pedido PoS (mig 037); UI de carga/recetas/food-cost existe. Falta: orden de compra + puente compra→caja. En PROD sigue 🟡 (UI vacía) |

**Arquitectura:** React 19 + TS + Vite · Supabase (Postgres + RLS + Edge Functions) · PWA.
Code-splitting por módulo. Despliegue automático en push a main.
**Hardening (2026-06-03):** TS `strict` activado · ErrorBoundary raíz · tokens de diseño globales ·
RLS endurecida (escritura por rol en sops/ventas/exchange) · rutas gateadas por rol · auto-update PWA.

**Hotfixes y limpieza (2026-06-05):** Propinas — fix del cierre (`savePayouts` UPDATE por id, bug NOT NULL `session_id`) + quitada la verificación de pool (Propinas = solo cálculo/reparto), **en producción**. Auditoría `audit/cleanup-nocturna` reconciliada y **mergeada** (`as never`→0). Caja — fix `onMovAdded` (refresca en vez de inyectar fila fantasma al borrar/editar pago) en `chore/limpiar-y-docs`. **Cierre del día:** la lógica correcta es el **saldo de Caja Fuerte por ledger** (canónico `satori-caja`); el intento `fix/caja-cierre-cf` (snapshot del remanente previo) se **descartó** por doble-conteo y la rama se borró. El fix real se valida primero en el **módulo Prueba** (simulador read-only) con un helper compartido `saldoCajaFuerte`.

**El gran límite estructural:** la app consume datos del POS, no los genera. Por eso depende de un import manual y no tiene control sobre la operación en tiempo real. El roadmap apunta a cerrar ese círculo.

---

## 1. Visión: las 3 capas

```
CAPA 3 — CRECIMIENTO   Fidelización · Chatbot WhatsApp · Delivery · Reservas · Marketing
─────────────────────────────────────────────────────────────────────────────────────────
CAPA 2 — OPERACIÓN     POS nativo · Inventario activo · Recetas/COGS · KDS
─────────────────────────────────────────────────────────────────────────────────────────
CAPA 1 — INTELIGENCIA  Ventas · Propinas · Caja · Reportes  ◀── HOY (✅)
```

Hoy tenemos sólida la Capa 1. El roadmap construye la Capa 2 (que convierte a Satori en el sistema de registro, no solo el que lee) y luego la Capa 3 (crecimiento y relación con el cliente).

---

## 2. Roadmap por fases

Orden por dependencia + retorno.
**Tallas:** S (días) · M (1–2 sprints) · L (3–5 sprints) · XL (programa de varios meses)

---

### PRIORIDADES EN CURSO (2026-06-05) — Caja robusta → tiempo real → offline

Orden acordado (cada uno es base del siguiente):

1. **Caja: no perder datos + propinas por pagar + tipos de movimiento** · M — ✅ **MERGEADO a `main`** (en producción).
   - **Bug A — no perder lo cargado al recargar:** ✅ pagos/ingresos del turno se derivan de la base (`sessionMovements`) + borradores; ingresos adicionales se persisten al instante. Dedup por `persistedId`.
   - **Bug C — propinas por pagar:** ✅ cerrar Propinas ya **no** crea el egreso solo; en Caja aparece "Propinas por pagar" → **Paga ahora** (aprobado) o **Deja pendiente** (`pendiente`, no descuenta hasta pagarse).
   - **Tipos de movimiento (taxonomía):** ✅ categorías completas + **pass-through electrónico** (propinas/delivery por SINPE/Lafise/Bitcoin = retiro de efectivo, **no P&L**). Lafise = canal de cobro, **no** método. Delivery dueños = Egreso-Socios.
   - **+ 4 mejoras de robustez (2026-06-08):** ✅ (1) detección de propinas pagadas cross-turno, (2) anti doble-click + confirm al pagar propinas, (3) helper `saldoCajaFuerte` (scaffold para el módulo Prueba), (4) guard anti doble-submit en pago/ingreso. **Validado:** build + lint + contrato de esquema (tipos generados del esquema vivo). Runtime logueado = smoke-test del dueño.
1b. **Caja: cierre por ledger + saldo unificado + Caja Diaria única/día** · M — ✅ **MERGEADO** (2026-06-09, en producción). Cierre del día usa `saldoCajaFuerte`; **una sola fórmula** del saldo de Caja Fuerte (tarjeta=cierre=simulador); **Caja Diaria de proveedores única por día** (apertura única, check de mediodía, cierre de proveedores como paso propio, bóveda gateada); cierre robusto (error de ventas visible, orden de fases, "Borrar TODO el día"); **módulo Prueba** (simulador read-only); carryover validado en apertura. ⚠️ **Pendiente del dueño:** correr la **migración 018** (columnas `midday_check_by/at`).
2. **Sesión sólida** · M — ✅ **COMPLETA Y EN PRODUCCIÓN** (Fase 1: 06-09 · Fase 2: 06-12, validada por la dueña). Refresco proactivo + timeouts (F1); lock real `safeNavigatorLock` con escape de 10s + `verify_manager` server-side (mig 019) (F2). RCA cerrado — detalle en `HANG-RCA.md`.
3. **Tiempo real multi-dispositivo** · L — ✅ **EN PRODUCCIÓN** (2026-06-12, mig 020 + `useRealtimeRefetch`): caja y propinas se ven en vivo entre dispositivos, con reconexión, refetch al foco y pause-while-typing.
4. **Offline-first** · L/XL — ✅ **CONSTRUIDO en rama `offline-first`** (2026-06-12, en verificación del asesor + prueba física): caché de lectura IndexedDB + outbox idempotente (`client_op_id`, mig 021) + política documentada en `OFFLINE.md`. **Es la F0 del plan PoS (sección siguiente).**
5. **Entorno preview/staging** · S/M — ✅ **OPERATIVO** (2026-06-11): Cloudflare Pages desde rama `staging` + Supabase staging con **espejo de datos reales de prod** re-clonable con un comando (`scripts/clone-prod-to-staging.sh`). Detalle en `STAGING.md`.

> ✅ **Correcciones de pago de la dueña (06-11, en prod):** proveedores solo Efectivo/Transferencia; categorías únicas Delivery/Propinas con detalle en la nota (+ Delivery dueños como opción propia). ✅ **P1c y P1d CERRADOS** (06-12): la dueña confirmó que el historial de propinas y el tracking de datáfono actuales son exactamente lo esperado. ✅ **P3b/P3d en prod** (errores visibles en Caja; bundle: VentasXLS 350→19KB, VentasHistorico 351→5KB). ⏳ **Deuda menor:** P3c (estados vacíos).

> ⚠️ **Pendiente (pase aparte, no tocar datos ahora):** revisar el mapeo a QuickBooks de los deliverys/propinas cobrados por medio electrónico — la recategorización vieja "delivery x sinpe → operativo 7100" quedó mal (son **pass-through**, no gasto). El mapeo nuevo ya los excluye (`finance.ts`); falta recategorizar el **histórico**.

---

## 🍣 PoS Satori + KDS — Piloto Santa Teresa (plan completo, pedido de la dueña 2026-06-12)

> Decisión estratégica tomada: **construir el PoS propio** (no comprar/integrar), arrancando con
> un **piloto en Santa Teresa** y multi-local desde el diseño (Nosara + franquicias después).
> Este plan reemplaza la discusión abierta de la vieja "FASE 3 — buy vs build".
> Nada de esto vive solo en chats: este documento es la fuente de verdad del plan.

### F0 — Fundaciones (en curso)
- ✅ **Offline-first** (este sprint, rama `offline-first`): caché de lectura + outbox idempotente.
  El PoS opera en un local con internet inestable — esta capa es el piso de todo lo que sigue.
- 🔎 **Investigación de proveedores de facturación electrónica CR** (obligatoria para operar un
  PoS): comparar APIs/costos/SLAs de los emisores certificados ante Hacienda, requisitos de
  comprobante (FE/TE), contingencia. Entregable: matriz de decisión para la dueña.
- 🔌 **Spike del puente de impresión** con la térmica **3nStar RPT004**: probar impresión por LAN
  (ESC/POS) desde un proceso local en la mini-PC. ⚠️ Este puente se diseña desde el día 1 como
  **embrión del HUB LOCAL de F5** (no un script descartable).

### F1 — Catálogo + salón + multi-local · M
- **Catálogo con modificadores**: precio base + modificador **obligatorio** donde aplique
  (ej. mojito → elegir licor), modificadores opcionales (extra/sin/término), combos.
- **Editor de salón**: mapa de mesas editable por la gerencia (zonas, uniones).
- **Tabla `locations`**: multi-local desde el diseño — todo lo nuevo (catálogo, salón, tickets,
  KDS, impresoras) cuelga de un `location_id`. Piloto = Santa Teresa; Nosara y franquicias se
  agregan como filas, no como refactor.

### F2 — Comandero (tablet) + KDS + impresión · L
- **Comandero en tablet**:
  - **PAX OBLIGATORIO ≥ 1 al abrir la mesa — nunca 0** —, siempre visible y **editable**
    durante el servicio; **pax por ticket** al cerrar (alimenta las métricas de ICP/saloneros).
  - **Asignación de ítems a asiento/cliente** (la base de los splits de F3).
  - **Cursos** con un tap: bebida / entrada / principal — y **"marchar" por partes**
    (la cocina recibe cada curso cuando el salonero lo dispara).
- **KDS web** en TVs/mini-PC:
  - Orden de categorías **configurable** por la gerencia.
  - **Timers** por comanda verde→rojo, umbrales **configurables por curso**.
  - Pantallas de **salón** y **delivery** separadas.
- **Ruteo de impresión configurable por admin** sobre las 3 impresoras: **CAJA / BARRA / SALÓN**
  (las **previas** salen en SALÓN). Vía el puente de impresión LAN de F0.
- **Modo contingencia**: si el KDS cae, las comandas salen **en papel por LAN** (mismo puente) —
  el servicio nunca se detiene.

### Modelo fiscal del PoS (spec de la dueña, 2026-06-12 — estándar gastronomía CR)
- **Precio final con IVA incluido** por producto (lo que ve el cliente en la carta) + tipo de
  impuesto (default **IVA 13%**, opciones exento/otras tasas). El **desglose neto/IVA se deriva
  automáticamente** (neto = precio/1.13) y es solo-lectura en Admin.
- Los **deltas de modificadores también son precios finales** (IVA incluido) y heredan el tipo
  de impuesto del producto.
- **Servicio 10% por CANAL**, no por producto: salón y barra SÍ, delivery NO. Se aplica al armar
  la cuenta/cobro, con desglose visible (consumo · servicio 10% · IVA · total).
- Toda la matemática fiscal vive en **una sola función pura** (`computeTotals(items, canal)`)
  con tests. ⏳ **PENDIENTE-CONTADORA**: base exacta del 10% (¿neto o total con IVA?) y si el
  servicio lleva IVA — default implementado: 10% sobre el subtotal neto, parámetro centralizado.

### F3 — Cobro completo + Modo Evento · L
- **Flujo de cobro CONFIRMADO con la operación actual (2026-06-12, documentos reales de Nube
  de Fuego)**: la **pre-cuenta** (🧾 cuenta de mesa, ya construida en el comandero) es el
  documento PREVIO **no fiscal** que se lleva a la mesa; la **factura electrónica se emite e
  imprime SOLO al confirmar el método de pago** (tarjeta / efectivo / transferencia-SINPE).
  El cobro de F3 replica ese orden exacto: **cuenta → método → emisión → impresión**.
  Calibración fiscal confirmada con esos mismos documentos: servicio = 10% del subtotal NETO,
  IVA = 13% solo del neto (el servicio NO lleva IVA), total = neto × 1,23 — el default de
  `SERVICE_CONFIG` ya coincidía; test de regresión "ticket real" en `posFiscal.test.ts`.
  Pendiente de la contadora: solo CIIU/CABYS.
- **Previas desde la tablet** (impresas en SALÓN), **splits** por cliente / por productos /
  partes iguales / por montos; cobro **₡/$ al TC de admin**; cierre de cuenta **desde la tablet
  o desde caja**; **descuentos con `verify_manager`** (autorización de gerencia server-side, ya
  en producción).
- **Facturación electrónica integrada** (el proveedor elegido en F0) → **retiro de Nube de
  Fuego** (fin del sistema actual).
- **Modo Evento — doble ticket**: el mismo **código corto** se imprime en **BARRA y CAJA**;
  la barra **solo produce contra su impresora** (control anti-pérdida en eventos de volumen).
- Venta → `ventas_dias` directo · propina del cobro → `tip_sessions` · efectivo → caja
  (se elimina el import XLS — el círculo del ROADMAP original se cierra acá).

### F4 — Loyalty en mesa + réplica Nosara · M
- **QR individual de miembro** (CRM/loyalty ya construido) **leído en la mesa** desde el
  comandero → identifica al cliente, suma puntos al cobrar.
- **Réplica en Nosara**: segundo `location_id` con su salón, impresoras y KDS — la prueba de
  fuego del diseño multi-local de F1.

### F5 — HUB LOCAL (importante para la dueña) · L
- La **mini-PC como servidor local**: las tablets hablan con el **hub por LAN**, el **KDS
  funciona SIN internet**, y el hub **sincroniza a la nube al reconectar** (la outbox de F0 es
  el mismo patrón, elevado al hub).
- El puente de impresión de F0/F2 **es** el embrión de este hub: mismo proceso, misma mini-PC,
  primero imprime, después sirve.

### 🔄 Refinamiento PoS — feedback de la dueña tras la primera prueba física (2026-06-12)
**Fuente de verdad de este ciclo (rama `pos-refinamiento`):**
1. **Gestor de Productos unificado** (reemplaza la pestaña "Precios"): Admin → Productos con TODO el
   ciclo de vida — crear/editar (nombre, categoría, subcategoría), precio final IVA incl. con desglose
   derivado, tipo de impuesto, **flag "aplica servicio 10%"** (default SÍ, destildable p.ej.
   merchandising; se combina con la regla por canal: delivery nunca lo aplica), costo visible (receta
   o carga rápida) con **margen calculado**, botón crear/editar receta, activo/desactivado y
   eliminación. Filtros (default solo activos; desactivados/todos), búsqueda, **export CSV** según
   filtro. Campos estándar gastronómicos: **implementados** estación de preparación (cocina/barra/
   ninguna), tiempo estimado de preparación (min) y alérgenos; **DECISIÓN-PRODUCTO (pendiente)**:
   código PLU/SKU, visibilidad por canal (salón/delivery/QR), foto del plato, descripción para carta
   QR. **DECISIÓN**: el nombre del producto es inmutable post-creación (es la llave del histórico de
   ventas); "eliminar" = desactivar (el histórico lo referencia).
2. **Modificadores desde el producto** (modelo de la dueña): los grupos se definen UNA vez (ej. "Ron"
   con sus variantes y deltas default); la asignación vive EN el producto — al editar "Mojito" se
   elige el grupo y CUÁLES variantes aplican, con **override de delta por producto**. El comandero
   respeta variantes habilitadas y overrides.
3. **KDS — ruteo por estación y orden escalonado**: (a) cocina SOLO comida, barra SOLO bebida (campo
   estación de la ficha; nada cruzado); (b) orden escalonado configurable por SUBCATEGORÍA en Admin →
   KDS (ej.: 1° crudos/pesca local, 2° nigiris y sashimis, 3° rolls/principales); (c) **postres**: en
   rush no pueden quedar al fondo — marca de prioridad visual + suben en la comanda + timer propio más
   corto configurable. **Evolución documentada**: "carril propio de postres" (columna dedicada en el
   KDS) cuando el volumen lo pida.
4. **Editor de salón — realismo**: mover mesas por el plano (drag en tablet con fallback de flechas
   paso grande/chico) + **elementos no-mesa** (barra, maceteros, estaciones, paredes/divisores)
   agregables, movibles y redimensionables — decorativos, no abren pedidos.
5. **Acceso por tile en Home** (cierra DECISIÓN-NOCTURNA #10): salonero/manager/owner ven "Comandero";
   cocina ve "KDS" — nadie tipea rutas.

### 👥 Operación por roles — pedido de la dueña (2026-06-12, rama `operacion-roles`)
**Objetivo: cada puesto físico (compu del cajero, tablet del salonero, teléfono de la bandeja
de proveedores) abre la app y aterriza DIRECTO en su pantalla, viendo solo lo suyo.**
1. **Foto de factura de proveedor — guardada y visible (prioridad máxima)**: bucket de Storage
   `facturas` (privado, RLS por rol), al registrar un pago a proveedor las fotos se suben y quedan
   vinculadas al movimiento (`cash_movements.attachments`); en Caja Diaria y en el historial el pago
   muestra miniatura → tap abre la foto completa (para revisar nombres de productos y precios).
   Múltiples fotos por pago; en móvil la cámara abre directo (input `capture`). Si no hay red al
   registrar, el pago entra igual y la foto se avisa como no subida (la foto requiere conexión).
2. **Aterrizaje y permisos por rol**: cajero → Caja Diaria; salonero → Comandero; **rol nuevo
   `proveedor`** (la "bandeja": teléfono fijo en recepción de mercadería) → pantalla dedicada de
   registrar pago con botón de foto gigante, y NADA más; manager/owner → Home completo. El
   aterrizaje ocurre al abrir la app (una vez por sesión de pestaña); el botón Home sigue
   funcionando para navegar lo permitido. Rutas fuera del rol: ni tile ni acceso por URL.
3. **Cierre de turno del salonero + métricas propias**: pantalla "Mi Turno" — ventas del turno,
   ticket promedio (por mesa y por pax), propinas propias y el cierre respetando `canCloseShift`
   (el último turno no cierra con mesas abiertas). Los datos salen de un **RPC `my_turno_stats`
   SECURITY DEFINER** que solo computa `auth.uid()` — garantía estructural de que cada salonero
   ve únicamente lo suyo.
4. **Gestión de usuarios desde Admin** (ya existía Admin → Usuarios: rol + habilitar/deshabilitar;
   se extiende con el rol `proveedor` y el flujo documentado): **crear cuentas** = el empleado se
   registra (correo real o alias `satorisushibar+nombre@gmail.com`) → queda "pendiente" → el owner
   le asigna rol y lo habilita desde esta pantalla. Crear cuentas server-side requeriría la
   service key en un backend (Edge Function) — innecesario por ahora.
5. **PWA por puesto**: shortcuts del manifest (Registrar proveedor, Comandero, Caja) + guía de
   instalación por dispositivo en el reporte. Con el aterrizaje por rol, el mismo ícono abre lo
   correcto para cada quien.

#### 📬 Fase futura — Reportes quincenales por correo a saloneros · M (NO implementado)
Cada quincena, un correo automático a cada salonero con SUS métricas (ventas, promedios, propinas
del período) al correo de su cuenta. Requiere: (a) servicio de email transaccional (Resend/Postmark
— Resend tiene tier gratis 100 mails/día y DX simple), (b) **Edge Function** programada
(`supabase functions deploy` + cron via pg_cron o Scheduled Functions) que computa las métricas por
salonero (mismas consultas que `my_turno_stats`, agregadas por quincena) y dispara los correos,
(c) plantilla HTML simple con la identidad Satori. Decisiones pendientes: día/hora de corte
(1 y 16 de cada mes, 9am CR sugerido), y si el correo incluye comparativa vs quincena anterior.

### Reglas transversales (valen para TODAS las fases)
- El **turno de la mañana puede cerrar con mesas abiertas**; el **último turno NO** (el día no
  cierra con mesas vivas).
- **Transferencia de mesas entre saloneros** con **atribución correcta de métricas** (ventas,
  propinas e ICP siguen al salonero correcto en cada tramo).
- Todo lo offline respeta la política de `OFFLINE.md` (cierres y aperturas requieren conexión
  al servidor que corresponda — en F5, el "servidor" pasa a ser el hub local).

### Infraestructura del piloto (recomendación)
- **Router con backup LTE** (failover a datos móviles): el offline-first salva la operación,
  pero la facturación electrónica y la sincronización agradecen un segundo camino a internet.
- Mini-PC (hub/KDS) + 3 térmicas 3nStar RPT004 (CAJA/BARRA/SALÓN) + tablets de comandero + TVs.

---

### FASE 0 — Cierre de pendientes actuales · S

Lo que ya está construido pero necesita un último paso para rendir.

- Aplicar `supabase/migrations/003_tips_email_cron.sql` (cron emails propinas día 1/15)
- Cargar costos unitarios reales (UI lista: Ventas → Config → Costos, inline o CSV) → enciende food cost en MenuEng
- DNS SiteGround para enviar emails desde `@satoricostarica.com` (hoy sale de `onboarding@resend.dev`)
- Definir metas mensuales en todos los meses para que el reporte mensual compare contra objetivo
- **Hardening: hang del refresh de token** — cuando la sesión vence, el cliente Supabase puede colgar una request (escrituras de caja/bandeja). Mitigado con timeouts + aviso; **RCA en `HANG-RCA.md`, fix de fondo diseñado, pendiente de aprobación**. Optimizar también la recarga post-cierre (hoy refetch de ~1.2k movimientos).
- **Cierre del día por ledger** — implementar el helper compartido `saldoCajaFuerte(movements)` (regla del canónico `satori-caja`) y enchufarlo al "debería quedar" del cierre, **previa validación en el módulo Prueba**. Que `CashResumen` use el mismo helper (una sola verdad del saldo).
- **Módulo "Prueba" (admin-only)** — simulador read-only con datos reales, sin escribir; primer uso: cierre de Caja Fuerte.
- **Tipos de movimiento faltantes en el turno de Caja** — definir con el dueño cuáles agregar.
- (Opcional) **entorno preview/staging** para pruebas visuales antes de producción.

**Valor:** completa el círculo de lo ya invertido. Esfuerzo casi nulo.

---

### FASE 1 — Inventario activo + Recetas + COGS real · L

La UI ya existe; falta datos + la lógica que lo conecta a las ventas. Es la base de la rentabilidad real.

#### 1.1 Carga inicial de inventario · S
- Cargar ingredientes (nombre, unidad, stock actual, stock mínimo, costo/unidad, proveedor)
- Import CSV masivo (mismo patrón que costos de productos)

#### 1.2 Recetas (Bill of Materials) · M
- Constructor de receta: producto vendido → lista de ingredientes × cantidad
- Costo teórico automático: la receta calcula `costo_unitario` del producto → reemplaza la carga manual
- Vincular `product_map` ↔ `recipes` por nombre

#### 1.3 Consumo automático (depletion) · M
- Al registrarse ventas del día, descontar ingredientes según receta × unidades vendidas
- Movimiento de inventario automático por cada venta
- Food cost teórico vs real: comparar consumo esperado vs compras reales (merma)

#### 1.4 Alertas y compras · M
- Alerta de stock bajo (≤ mínimo) en HomePage y módulo
- Orden de compra sugerida por proveedor
- Integración con Caja: aprobar una compra genera el `egreso_mercaderia` y baja stock al recibir

**Valor:** food cost preciso, control de merma, evita quiebres de stock.
**Depende de:** Fase 0 (costos) — aunque las recetas luego automatizan el costo.

---

### FASE 2 — Fidelización / CRM de clientes · L

Net new. No requiere POS para arrancar. El número de teléfono actúa como ID universal — conecta WhatsApp, delivery, reservas y visitas presenciales en un solo perfil.

> **Contexto de diseño (sesión 2026-06-02):** El chatbot de WhatsApp (Fase 2B más abajo) es el principal canal de captación de datos de clientes. Cada cliente que escribe al bot queda registrado automáticamente. La tarjeta Apple/Google Wallet es el canal de fidelización sin fricción — el cliente no descarga ninguna app. El iPhone del encargado con la cámara escanea el QR de la tarjeta para sumar puntos en visitas presenciales.

#### 2.1 Base de clientes · M

**Tabla nueva en Supabase: `customers`**

```sql
customers (
  id              uuid primary key default gen_random_uuid(),
  phone           text unique not null,        -- ID natural, viene de WhatsApp
  name            text,
  email           text,
  birth_date      date,
  channel_origin  text,                        -- 'whatsapp' | 'presencial' | 'manual'
  first_seen      timestamptz default now(),
  last_seen       timestamptz,
  total_visits    int default 0,
  total_spent_crc numeric default 0,
  points          int default 0,
  tier            text default 'nuevo',        -- 'nuevo' | 'regular' | 'vip' | 'embajador'
  wallet_pass_id  text,                        -- ID del .pkpass emitido
  notes           text,
  active          boolean default true
)
```

**Tabla nueva: `customer_interactions`**

```sql
customer_interactions (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references customers(id),
  type          text,     -- 'delivery' | 'reserva' | 'presencial' | 'puntos_canje'
  channel       text,     -- 'whatsapp' | 'opentable' | 'qr_scan' | 'manual'
  amount_crc    numeric,
  points_earned int,
  points_spent  int,
  reference_id  text,     -- ID del pedido, reserva, etc.
  created_at    timestamptz default now()
)
```

- Alta rápida desde caja o admin; búsqueda por teléfono
- Perfil individual con historial completo de interacciones

#### 2.2 Programa de puntos · M

**Reglas de acumulación (configurables en Admin):**
- Por monto gastado: X puntos por cada ₡1.000
- Por visita: bonus fijo por primera visita del mes
- Por cumpleaños: bonus en el mes de cumpleaños
- Por referido: puntos cuando un referido hace su primera compra

**Tiers sugeridos:**

| Tier | Criterio | Beneficio |
|---|---|---|
| Nuevo | Primera visita | Tarjeta digital |
| Regular | 3+ visitas o ₡25.000 acumulado | 5% descuento acumulación |
| VIP | 10+ visitas o ₡80.000 acumulado | Acceso prioritario, 10% descuento |
| Embajador | VIP + referidos activos | Beneficios exclusivos, trato personalizado |

**Canje de puntos:**
- Descuento en cuenta
- Cortesías (roll gratuito, bebida, postre)
- Experiencias (omakase para 2, cena con el chef)

#### 2.3 Tarjeta digital Apple Wallet + Google Wallet · M

**Cómo funciona:**
1. Cliente hace pedido/reserva por WhatsApp (primera vez)
2. Bot pregunta: "¿Querés tu tarjeta Satori con tus puntos?"
3. Servidor genera un archivo `.pkpass` personalizado vía PassKit API (o desarrollo propio)
4. Cliente recibe link "Agregar a Wallet" — un tap, tarjeta en el celular
5. La tarjeta se actualiza en tiempo real con cada visita

**Qué muestra la tarjeta:**
- Logo Satori con diseño de marca
- Nombre del cliente
- Puntos acumulados (actualización en tiempo real)
- Tier actual (Nuevo / Regular / VIP / Embajador)
- Código QR único para escanear en el local
- Notificación push automática al sumar puntos, subir de tier o recibir un beneficio
- **Geo-fence:** aparece en pantalla de bloqueo cuando el cliente entra al restaurante

**Stack técnico:**
- Plataforma: PassKit ($30-80/mes todo incluido) o desarrollo propio con `@walletpass/pass-js`
- Hosting del pass server: Supabase Edge Function o Railway
- Apple: archivo `.pkpass` + certificado de PassType ID (Apple Developer Program, ya existente si hay Capacitor)
- Android: Google Wallet Objects API (`.gpay` format)

**Implementación recomendada:** empezar con PassKit para validar adopción, migrar a desarrollo propio si el volumen lo justifica.

#### 2.4a QR de auto-registro de clientes · ✅ HECHO (2026-06-03)

El cliente se registra solo escaneando un QR (no requiere Wallet ni app):
- Pestaña **"QR registro"** en Clientes (gerencia): genera el QR del formulario público
  `/registro` (CrmQR.tsx + lib qrcode), descargar PNG / copiar link → compartir por WhatsApp.
- Página pública **`/registro`** (RegistroCliente.tsx, sin login, mobile-first): nombre + teléfono
  (email/cumple opcionales) → crea el cliente con channel_origin='whatsapp'. Maneja duplicados.
- Migration 007: policy de insert anónimo. **Probado end-to-end (HTTP 201).**
- Es el arranque de la base de clientes SIN depender de WhatsApp API ni Wallet.

#### 2.4b Lector QR en Satori App (pantalla del encargado) · S — pendiente (necesita Wallet 2.3)

Pantalla dedicada en la app para el encargado de turno:
- Abre la cámara del iPhone desde la app
- Escanea el QR de la tarjeta Wallet del cliente
- Muestra el perfil del cliente: nombre, tier, puntos, última visita
- Botón "Registrar visita" → suma puntos, actualiza `last_seen`, envía push al cliente
- Opción de agregar nota o ajuste manual de puntos

**Hardware:** ninguno adicional. El iPhone que ya tienen sirve.

**Opción futura NFC (Fase 2.5):**
Si se quiere la experiencia "acercar el celular sin tocar pantalla", se necesita un lector NFC VAS certificado como el **DotOrigin VTAP100** (~$150). Requiere certificado NFC de Apple (trámite aparte). No es necesario para lanzar — el QR funciona exactamente igual.

#### 2.5 Módulo CRM en Satori App · M

Nuevo módulo accesible para Owner y Manager:

**Vista principal — lista de clientes:**
- Tabla con filtros: Todos / Nuevos (últimos 7d) / Frecuentes / En riesgo (+30d sin visita) / Por tier
- Búsqueda por nombre o teléfono
- Exportar CSV

**Perfil individual:**
- Datos personales, canal de origen, tier, puntos
- Historial completo de interacciones (delivery, reservas, presencial)
- Total gastado, ticket promedio, frecuencia de visita
- Botón "Enviar mensaje WhatsApp" (abre wa.me con el número)

**Dashboard métricas de fidelización:**

| Sección | Métricas |
|---|---|
| Adquisición | Clientes nuevos / semana, canal de origen, conversión WhatsApp → tarjeta |
| Retención | Clientes activos (30d), frecuencia promedio, clientes en riesgo |
| Valor | LTV, ticket promedio por tier, top 20 por gasto total |
| Puntos | Emitidos vs canjeados, distribución por tier, próximos a vencer |
| Comportamiento | Delivery vs presencial, hora/día preferido, productos más pedidos por tier |

**Valor de esta fase:** repetición de clientes, dato propio de demanda, base para campañas dirigidas, métricas reales de CLV.
**Depende de:** nada bloqueante. Se potencia mucho cuando exista el bot de WhatsApp (captación automática).

---

### FASE 2B — Chatbot WhatsApp: Delivery + Reservas · L

> **Contexto de diseño (sesión 2026-06-02):** Canal único que atiende delivery y reservas de mesa. Elimina comisiones de apps externas (25-30% por pedido). Registra automáticamente a los clientes en el CRM. Se integra con Supabase existente. El número de teléfono del chat es la llave que une todo el ecosistema de fidelización.

#### Stack técnico

| Pieza | Tecnología | Costo mensual |
|---|---|---|
| WhatsApp Business API | Twilio | ~$15-40 según volumen |
| Servidor del bot | Node.js en Railway/Render | ~$5-10 |
| Pagos delivery | Stripe (Payment Links) | 2.9% + $0.30/transacción |
| Reservas | OpenTable API (ver abajo) | Sin costo adicional |
| Base de datos | Supabase existente | $0 adicional |
| **Total estimado** | **~200 pedidos + 100 reservas/mes** | **~$30-60/mes** |

**Comparación:** Uber Eats / Rappi cobran 25-30% por pedido. En 200 pedidos de ₡12.000 promedio → ~₡720.000/mes en comisiones. El chatbot propio cuesta menos de ₡30.000/mes.

#### Estructura del bot — máquina de estados

```
INICIO
  ├── DELIVERY
  │     ├── ELIGIENDO_CATEGORIA
  │     ├── ELIGIENDO_PRODUCTO
  │     ├── CONFIRMAR_ITEM
  │     ├── CART_REVIEW
  │     ├── OFERTA_BEBIDAS          ← siempre antes de confirmar
  │     ├── PIDIENDO_DIRECCION
  │     ├── ESPERANDO_PAGO         ← Stripe Payment Link
  │     └── PEDIDO_CONFIRMADO      ← notificación cliente + grupo interno
  │
  └── RESERVAS
        ├── PIDIENDO_FECHA
        ├── PIDIENDO_PERSONAS
        ├── MOSTRANDO_SLOTS        ← OpenTable API
        ├── ELIGIENDO_SLOT
        ├── PIDIENDO_NOMBRE
        └── RESERVA_CONFIRMADA     ← notificación cliente + OpenTable

Estados de error:
  TIMEOUT (20 min sin respuesta) → reinicio
  INPUT_INVALIDO (reintento x2) → reinicio con aviso
  PAGO_FALLIDO → ofrecer reintento
  FUERA_DE_HORARIO → informar y ofrecer reserva
```

**Tabla nueva en Supabase: `bot_sessions`**

```sql
bot_sessions (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,          -- vincula con customers.phone
  state        text not null,
  cart         jsonb default '[]',     -- [{product_id, name, qty, price}]
  address      text,
  total_crc    numeric,
  stripe_link  text,
  stripe_paid  boolean default false,
  ot_slot_id   text,                   -- OpenTable slot seleccionado
  created_at   timestamptz default now(),
  expires_at   timestamptz,            -- now() + 20 min
  customer_id  uuid references customers(id)
)
```

#### Integración OpenTable

- **API oficial:** REST, requiere aprobación como partner (~3-4 semanas — iniciar este trámite antes que el desarrollo)
- **Endpoints clave:**
  - `GET /availability` — consulta slots disponibles para fecha + personas
  - `POST /reservations` — crea la reserva
  - `DELETE /reservations/{id}` — cancela
- **Portal partner:** `opentable.com/restaurant-solutions/api-partners`
- **Sandbox disponible** para desarrollo antes de la aprobación final

#### Flujo de conversación — Delivery (resumen)

```
Bot: "Hola! Satori 🍣 — Delivery o Reserva?"
  → Delivery
Bot: [categorías del menú]
  → Elige rolls
Bot: [productos con precio]
  → Agrega Spicy Tuna Roll
Bot: "¿Agregás algo más?"
  → No, continuar
Bot: "Antes de confirmar — ¿sumamos algo de tomar?"   ← SIEMPRE
  → Cerveza artesanal
Bot: "¿Dirección de entrega?"
  → [dirección]
Bot: "Resumen: Spicy Tuna + Cerveza + delivery = ₡12.900. Pagar: [link Stripe]"
  → [cliente paga]
Bot: "¡Confirmado! Pedido #ST-2847 · 35-45 min"
  → Notificación automática al grupo interno de Satori
```

#### Flujo de conversación — Reserva (resumen)

```
Bot: "¿Para qué fecha? (ej: 20/06)"
Bot: "¿Cuántas personas?"
Bot: "Disponibilidad 20/06 para 4: 7:00PM / 7:30PM / 8:00PM / 8:30PM"
  → Elige 7:30PM
Bot: "¿Nombre para la reserva?"
Bot: "✅ Confirmado — Satori Santa Teresa · 20 jun · 7:30PM · 4 personas · #R-0492"
```

#### Integración con CRM (Fase 2)

- Al primer mensaje del cliente → crear/actualizar `customers` con su phone
- Al confirmar pedido → crear `customer_interactions` con tipo `delivery`
- Al confirmar reserva → crear `customer_interactions` con tipo `reserva`
- Si el cliente no tiene tarjeta Wallet → ofrecer al final de la primera interacción
- Si el cliente ya tiene tarjeta → actualizar puntos automáticamente

#### Plan de implementación

| Semana | Actividad | Responsable |
|---|---|---|
| 1 | Solicitar cuenta Twilio + aprobación Meta (1-7 días). Iniciar trámite OpenTable (3-4 semanas). Abrir cuenta Stripe. Definir menú de delivery (15-20 productos de lanzamiento). | Socios |
| 2-3 | Desarrollo: flujo delivery completo, integración Stripe, flujo reservas con OpenTable, notificaciones al equipo, integración con tabla `customers`. | Desarrollo |
| 4 | Pruebas internas con el equipo. Ajuste de textos, tiempos, manejo de errores. | Equipo Satori |
| 5 | Lanzamiento con grupo reducido. Monitoreo activo. | Todos |

> ⚠️ **Cuello de botella:** la aprobación de OpenTable como partner tarda 3-4 semanas. Iniciar ese trámite desde el principio, en paralelo con todo lo demás.

**Alcance de lanzamiento recomendado:** solo delivery, solo los 15-20 platos más pedidos, solo pago con tarjeta. Un menú amplio de primera puede confundir. Se expande una vez adoptado.

**Valor:** cero comisiones por pedido, captación automática de clientes al CRM, reservas sin intermediarios, disponibilidad 24h.
**Depende de:** Fase 2 (tabla `customers`) para el CRM — aunque puede lanzar en paralelo sin CRM y conectarlo después.

---

### FASE 2C — Finanzas / Contabilidad (P&L estilo QuickBooks) · L

> **Contexto (sesión 2026-06-03):** Hoy los gastos/costos se manejan en QuickBooks. Objetivo:
> traer ese P&L a Satori App para tener **presupuesto vs real** dentro del mismo sistema y
> migrar los históricos. Punto de partida: `budget 2026.xlsx` (export QB) — Net Earnings
> proyectado ₡66.2M/2026.

#### 2C.1 Plan de cuentas + presupuesto · ✅ HECHO (foundation)
- Migration `006_finance.sql`: tablas `finance_accounts` (plan de cuentas jerárquico con códigos
  5200/5320/7150…), `finance_budget` (presupuesto × cuenta × mes), `finance_actuals` (reales). RLS.
- **Budget 2026 importado** desde QuickBooks: 60 cuentas, 516 líneas (43 hojas × 12 meses).
- Módulo `/finanzas` (財): vista P&L — Ingresos → Costo de ventas → Utilidad bruta → Gastos →
  Utilidad neta, por mes o año, con columnas **Presupuesto · Real · Variación** (FinanzasModule.tsx).
- APLICAR migration 006 en Supabase para activar el módulo.

#### 2C.2 Migrar reales históricos (años anteriores) · M
- Import de transacciones reales por cuenta/mes a `finance_actuals` (CSV/Excel desde QB).
- Mapear las cuentas QB → `finance_accounts` (matching por código/nombre).
- Cargar 2023/2024/2025 para comparar año contra año.

#### 2C.3 Conexión con datos vivos de Satori · ✅ HECHO (v1)
- **Ingresos automáticos** ✅: `ventas_dias` → Ventas Salón/Delivery reales por mes.
- **Egresos de Caja** ✅: `cash_movements` mapeados por tipo (mercadería→Food 5200, personal→Staff
  Wages 6200, operativo→Insumos 7120, socios→Consumos Dueños). getLiveActuals(year).
- La columna "Real" del P&L ya se llena sola desde lo que registra la app (+ suma manual si la hay).
- **v2 ✅ HECHO**: mapeo FINO por subcategoría → cuenta QB exacta (Gas→7780, Agua→7760, Luz→7770,
  Músicos→7500, Seguridad→7200, Mantenimiento→Repairs, Licor→5330, Salarios→6200…). Correcciones:
  propinas por tarjeta EXCLUIDAS (pass-through, no gasto); Músicos van a Música, no a Operativo.
- **Pendiente (v3)**: food cost desde Inventario (recetas, Fase 1) en vez de "mercadería" de caja;
  separar CCSS/INS/aguinaldos de salarios cuando la nómina tenga su propia fuente; opción de elegir
  la cuenta del P&L directamente al cargar un gasto en Caja (mapeo 100% contable).

#### 2C.4 Edición y reportes · M
- Editar presupuesto inline (por cuenta/mes), crear cuentas nuevas.
- Export del P&L (PDF/imprimir), comparativo presupuesto vs real con alertas de desvío.
- Estado de resultados anual + mensual; márgenes (%) por línea como QuickBooks.

**Valor:** P&L y control de costos dentro de Satori, presupuesto vs real automático, base para
decisiones financieras sin depender de QuickBooks.
**Depende de:** nada para arrancar (2C.1 ya hecho). El "Real" automático se potencia con Fase 1 (food cost) y la Caja ya existente.

---

### FASE 3 — POS nativo (el gran salto) · XL

> ➡️ **SUPERSEDIDA (2026-06-12): la decisión build-vs-buy está tomada (BUILD) y el plan
> completo y vigente vive arriba en "PoS Satori + KDS — Piloto Santa Teresa".**
> Esta sección queda como referencia histórica del alcance original.

Convierte a Satori en el sistema de registro. Reemplaza el import XLS: las ventas, propinas y caja se generan dentro de la app en tiempo real.

#### 3.1 Catálogo / Menú · M
- Productos vendibles desde `product_map` (precio, categoría, modificadores, disponibilidad)
- Gestión de modificadores (extra, sin, término) y combos

#### 3.2 Mesas y salón · M
- Mapa del salón, estado de mesa (libre/ocupada/cuenta pedida), unir/dividir mesas
- Asignación de salonero a mesa (alimenta directo las métricas de saloneros)

#### 3.3 Toma de orden (app de mesero) · L
- Orden por mesa, agregar/quitar ítems, notas a cocina, enviar
- Multi-dispositivo, offline-first (la conexión en Santa Teresa puede fallar)

#### 3.4 KDS — Kitchen Display System · M
- Pantalla de cocina/barra con comandas en tiempo real, marcar preparado/entregado
- Tiempos de preparación por estación

#### 3.5 Cobro y cierre de cuenta · L
- Split de cuenta, métodos (efectivo/tarjeta/SINPE/Bitcoin)
- Propina en el cobro → alimenta `tip_sessions` automáticamente
- Venta → `ventas_dias` directo (elimina el import XLS)
- Efectivo → `cash_sessions` directo
- **Integración con fidelización:** identificar cliente al cobrar → suma puntos automáticamente

#### 3.6 Factura electrónica (Hacienda CR) · L
- Comprobante electrónico (FE/TE), XML firmado, envío a Hacienda, contingencia
- Requisito legal para operar un POS en Costa Rica

**Valor:** fin del import manual, datos en tiempo real, control total de la operación, una sola fuente de verdad.
**Depende de:** decisión buy/build + Fases 1 y 2 idealmente listas.

---

### FASE 4 — Canales de crecimiento · L

Sobre el POS nativo (o el catálogo, si se hace antes).

- **Pedido online / QR menú:** carta digital por QR en mesa, pedido sin mesero
- **Delivery ampliado:** integración con apps (Uber Eats, etc.) o pedido directo desde web
- **Marketing automation:** promos por temporada, recuperación de clientes dormidos (ya tenemos Resend + datos de CRM), campañas por tier/segmento
- **Competencias gamificadas:** extender el sistema de competencias de saloneros a clientes (retos mensuales, badges, premios)

---

### FASE 5 — Madurez operativa y financiera · L (continuo)

Lo que hace la operación escalable y auditable.

- **Planificación de turnos:** scheduling ligado a empleados + horas reales ya registradas
- **Nómina / planilla:** sueldos + propinas + horas → export para pago (CCSS/INS si aplica)
- **Contabilidad / impuestos:** export para contador, conciliación, declaración IVA
- **Multi-local:** arquitectura para 2+ sucursales (Santa Teresa + Nosara) con consolidado
- **BI / tablero ejecutivo:** dashboards configurables, comparativas, alertas inteligentes
- **Auditoría y backups:** log de acciones sensibles, respaldos automáticos, retención de datos
- **Hardening PWA:** offline real, sincronización en background, instalación nativa

---

## 3. Dependencias (resumen visual)

```
Fase 0 (pendientes) ──▶ Fase 1 (Inventario/Recetas/COGS)
                                    │
Fase 2  (Fidelización/CRM)          │
Fase 2B (Chatbot WhatsApp) ─────────┼──▶ Fase 3 (POS nativo) ──▶ Fase 4 (Canales)
                                    │                                    │
                                    └────────────────────────────────────┴──▶ Fase 5
```

- **Fase 0 y Fase 2/2B son independientes** → se pueden hacer ya, en paralelo.
- **Fase 2B (bot)** se potencia con Fase 2 (CRM), pero puede lanzar sin ella y conectarse después.
- **Fase 1** desbloquea el food cost real y prepara el "stock baja al vender" del POS.
- **Fase 3 (POS)** es el cuello: gran esfuerzo + decisión legal. Todo lo de arriba la potencia, no la bloquea.

---

## 4. Recomendación de secuencia

1. **Ahora:** Fase 0 (días) — cobrar lo ya invertido.
2. **Próximas semanas:** Fase 2 (CRM/Fidelización) + Fase 2B (Chatbot) en paralelo — independientes, generan dato propio de clientes desde el día 1.
3. **Siguiente trimestre:** Fase 1 (Inventario/Recetas) — máximo retorno sobre infraestructura existente; food cost real.
4. **Decisión estratégica:** evaluar buy vs build del POS (integrar con POS actual vía API o construir nativo + factura electrónica).
5. **Programa mayor:** Fase 3 (POS) y luego Fases 4–5.

> **Quick win de mayor impacto/esfuerzo inmediato:** Fase 2B (chatbot). Elimina comisiones de plataformas, capta clientes en el CRM automáticamente y genera un canal propio de delivery y reservas en ~5 semanas. Usa la infraestructura Supabase que ya existe.

---

---

### FASE 2D — Pagos, conciliación e ingesta por foto · L  ◀ NUEVO (2026-06-04)

Objetivo: **que no falte ningún pago** y que la operación pase de *digitar* a *confirmar*.
Diseño técnico completo acordado con el dueño. La Fase A (modelo de datos) ya está en producción.

#### ✅ Fase A — Correcciones de modelo (hecha, 2026-06-04)
- **Retiro a banco = traspaso** (Caja Fuerte → Banco), fuera del P&L (antes `egreso_socios`).
- **`egreso_socios` no alimenta el P&L** (retiros/distribución = equity). "Consumos Dueños" solo por carga manual del contador.
- **Ingresos de caja selectos al P&L** (aceite/reciclaje/otros → cuenta nueva `otros_ingresos`, mig. 014). Ventas efectivo e "Ingreso de cambio" excluidos (no duplicar con POS / float).
- **Cuenta contable explícita** `cash_movements.account_id` (mig. 015) + selector "Cuenta P&L" en Movimientos. `getLiveActuals` la usa si está; si no, mapea por subcategoría. Cierra el hueco de alquiler/patentes/lavandería/suscripciones/etc.
- **Bitcoin** disponible como método de pago en proveedores (lista unificada `cashUtils.METODOS_PAGO`).

#### 🟡 Fase A — Pendiente (cleanup de datos)
- **Recategorizar histórico `egreso_socios`**: separar *deliverys* (repartidor externo → operativo `7100`/direct operating) de *retiros reales de socios*. ~105 movimientos importados bajo `egreso_socios`; requiere criterio del dueño/contador.
- Separar Gerencia (`6100`) de Staff (`6200`) en `egreso_personal`.
- Confirmar `caja_origen='Banco'` en compras por transferencia (PMT, guayafrut, Isleña, Pescados…) para que no toquen la caja física.
- ✅ Retiro de dueños **descuenta de Caja Fuerte** (traspaso Caja Fuerte → Banco; el saldo de CF resta los traspasos salientes). Las ventas en efectivo del cierre entran a Caja Fuerte.

#### ✅ Fase B — Bandeja + ingesta IA — **OPERATIVA EN PRODUCCIÓN** (2026-06-04)
> La foto de una factura/comprobante entra a la app, la IA la lee y **genera el movimiento solo**; el encargado revisa en Caja con las facturas físicas.
- ✅ Tabla `documents` + bucket Storage + RLS + `suppliers.aliases[]` (mig. 016).
- ✅ Edge Function `extract-document` (**Claude Haiku 4.5**, JSON estricto) **desplegada** + secret `ANTHROPIC_API_KEY` cargado + **probada end-to-end**. Modelo configurable por env `ANTHROPIC_MODEL` (Sonnet para más precisión).
- ✅ **Multi-documento**: una foto → `documentos[]` → N filas. Esquema CR rico (factura/proforma/comprobante/propinas/otro, clave FE, IVA 1%/13%, ítems 2 líneas, unidades, condicion_pago, banco, moneda USD).
- ✅ **Auto-genera el movimiento al subir** (si confianza ≥0.4 + cuadra + no requiere revisión). Manuscritas/baja confianza → quedan en Bandeja con aviso ⚠ + validación obligatoria. Crédito→pendiente; comprobante→concilia pendiente único o egreso; propinas→excluido del P&L; USD→TC del día.
- ✅ PWA **Share Target** (`public/sw-share.js`) + subida manual/cámara. Anti-duplicado SHA-256 / `clave_fe`.
- 🟡 Afinar el prompt con 8–10 fotos reales variadas por proveedor (BELCA, Isleña, PMT, Guayafrut, SINPE, LAFISE/BN, mariscos manuscritos).
- 🔭 Futuro: webhook WhatsApp Cloud API (Meta) como entrada alternativa.

#### ✅ Fase C — Auto-inventario (2026-06-04, en producción)
- ✅ Migración 017: `supplier_item_map` (mapeo aprendido proveedor↔ingrediente), `ingredient_prices` (historial), trazas `inventory_movements.document_id/cash_movement_id`, RLS (cajero carga inventario).
- ✅ **Inventario pendiente** en la Bandeja: facturas con el gasto ya creado → `InventoryStep` empareja cada ítem (mapeo aprendido por código → fuzzy → vincular/crear/no-inventario), **factor de conversión explícito**, entra stock + actualiza costo + guarda historial de precios, y **aprende** el mapeo para auto-emparejar la próxima factura del proveedor.
- ✅ Idempotente por `document_id` (no suma stock dos veces). El gasto NO se rehace (es de Fase B); pagar un comprobante no vuelve a tocar el stock.
- ✅ Trazabilidad: badge "📄 factura" en Movimientos de inventario; mini-historial de precios al editar un ingrediente. Catálogo de ingredientes se construye al vuelo.
- 🟡 Refinar `factor_conversion` por proveedor con uso real; cargar los ~30-40 insumos frecuentes acelera las primeras facturas.

#### 🔭 Fase D — Conciliación bancaria
- Import del resumen bancario → cada línea matchea comprobante/pendiente (monto+fecha+referencia) → **conciliación automática**: marca pagados y detecta pagos sin comprobante.

**Tablas/cambios pendientes:** `documents`, `suppliers.aliases[]`, bucket Storage. (`cash_movements.account_id` y `otros_ingresos` ya aplicados.)

---

## 5. Matriz impacto / esfuerzo

| Iniciativa | Impacto | Esfuerzo | Prioridad |
|---|---|---|---|
| Fase 0 — pendientes | Medio | S | 🔥 Ahora |
| Fase 1 — Inventario/Recetas/COGS | Alto | L | 🔥 Alta |
| Fase 2 — Fidelización / CRM | Alto | L | ⭐ Alta (paralelo) |
| Fase 2B — Chatbot WhatsApp | Alto | L | ⭐ Alta (paralelo) |
| Fase 2 + 2B juntas | Muy alto | L | ✨ Sinergia máxima |
| **Fase 2D — Pagos/conciliación + ingesta por foto** | **Muy alto** | **L** | **🔥 Fases A+B+C ✅ operativas; D (banco) pendiente** |
| Fase 3 — POS nativo | Muy alto | XL | 🧭 Estratégica |
| Fase 3.6 — Factura electrónica | Crítico (legal) | L | 🧭 con POS |
| Fase 4 — Canales | Alto | L | Después de POS |
| Fase 5 — Nómina/Contabilidad/Multi-local | Medio-alto | L+ | Continuo |

---

## 6. Decisiones pendientes del equipo

Estas decisiones no las puede tomar el desarrollo — requieren alineación entre socios:

| Decisión | Opciones | Impacto |
|---|---|---|
| Alcance del menú de delivery | 15-20 platos de lanzamiento | Define Fase 2B |
| Trámite OpenTable | Iniciar YA (tarda 3-4 semanas) | Crítico para Fase 2B |
| Tiers y beneficios de puntos | Definir reglas de acumulación/canje | Define Fase 2 |
| NFC vs QR para tarjeta Wallet | QR recomendado (sin hardware). NFC requiere lector ~$150 + certificado Apple | Define Fase 2 |
| POS: build vs buy/integrar | Construir propio vs integrar con el POS actual | Define Fase 3 |
| Sucursales: Santa Teresa y Nosara | ¿Misma base de datos o separadas? | Define Fase 5 |

---

*Documento vivo — actualizar con cada sprint completado.*
*Para el estado del sprint actual, ver `ESTADO.md`.*
