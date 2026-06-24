# Continuación — backlog priorizado (handoff 2026-06-23)

Estado: **PROD (`main` `04b1a32`) está FUERA DE USO — riesgo cero, NO tocar.** Tiene capa de inteligencia +
fix SW viejo + fix fechas-borde + **canario Realtime/candado de auth** (R1 + fix final). STAGING (`c9e0a24`) =
todo el PoS + Bandeja Etapa 1 + esos fixes + la saga Realtime/suspensión + **durabilidad de escritura de caja (jun-23)** +
**switch de diagnóstico de Realtime solo-staging (jun-23)**. Guardrails de siempre:
**nada a `main`/PROD sin orden explícita, DDL solo migraciones aditivas, sagrados intactos** (`cashUtils`,
`tipCalculations`, `computeTotals`, cierres, cobro/vuelto, `posFiscal`), builds+tests+eslint verdes por commit.
Estado completo → [ESTADO.md](ESTADO.md) · Fases → [ROADMAP.md](ROADMAP.md) · RCA Realtime →
[docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md).

Marcadores: ✅ hecho · 🖊️ espera FIRMA/DECISIÓN de la dueña (plata) · 👁️ espera VALIDACIÓN FÍSICA ·
🟢 ingeniería lista para arrancar · 🔴 bloqueante / urgente.

> **Ya resuelto y EN PROD:** SW viejo (`fde9264`), fechas de borde de mes (`ff836a0`), y el **canario
> Realtime/candado de auth** (`04b1a32`). Eran las tres causas viejas del "se traba". La causa NUEVA (Realtime
> tras suspensión profunda) tiene el **blindaje anti-deadlock VALIDADO en staging `c9e0a24`**, pero el approach
> emite `rt:healthy` en el timeout del refresh → **loop `InvalidJWT`** → se **REDISEÑA como máquina de 3 estados**
> (ítem 0 / PRIORIDAD 1). Reproducible a demanda con `window.__satoriDiag`. La **durabilidad de escritura de caja** quedó ✅ en staging.

---

## 0. 🔴 PRIORIDAD 1 — Rediseñar la recuperación de Realtime como MÁQUINA DE 3 ESTADOS

**Qué.** Rediseñar `ensureRealtimeHealthy` (en `src/shared/api/supabase.ts`) + `useRealtimeRefetch`
(`src/shared/hooks/useRealtimeRefetch.ts`) como una **máquina de 3 estados explícita**:
- **`ONLINE_SUBSCRIBED`** — token fresco confirmado, socket conectado, canal en SUBSCRIBED.
- **`OFFLINE_WAITING`** — sin red / socket caído / red zombi: **NO** se re-suscribe; se espera y se reintenta con backoff.
- **`SESSION_EXPIRED`** — `getSession` CONFIRMÓ que no hay sesión: deslogueo real → a login, sin tocar el socket.

**Regla madre (inquebrantable):** **NUNCA emitir `rt:healthy` ni re-suscribir el canal sin un token válido FRESCO
CONFIRMADO. Ningún camino puede terminar en loop.**

**El bug que obliga el rediseño (causa raíz confirmada).** Hoy se **emite `rt:healthy` en el TIMEOUT del refresh**
(cuando `getSession`/`refreshSession` no settlean sobre la red zombi y el `withTimeout` cae al fallback). El hook, al
recibir `rt:healthy`, **re-suscribe con el token VENCIDO** → el join falla con `InvalidJWTToken` ("Token has expired")
→ el SDK reintenta con el mismo token muerto → **loop infinito de CHANNEL_ERROR** (confirmado en el log de una
suspensión de **3–5 h**). El blindaje anti-clavado (`withTimeout` 8s + cinturón 40s) ya evita el cuelgue *permanente*
—VALIDADO—, pero NO evita este *loop*: **emitir "sano" sin token fresco es el error de diseño**. El rediseño lo cierra
estructuralmente: `OFFLINE_WAITING` no emite `rt:healthy` ni re-suscribe; solo se transiciona a `ONLINE_SUBSCRIBED`
(y se emite) cuando hay un token fresco confirmado.

**Cómo validar (sin esperar 3 h):** con el switch de diagnóstico ya mergeado — `window.__satoriDiag` en el staging
desplegado:
- `armZombie()` → reproduce el cuelgue/loop (auth-ops que no settlean + socket caído) **al instante**.
- `armExpired()` → reproduce el deslogueo real (`getSession`→`session:null`, `refreshSession`→AuthError) → debe llevar
  a `SESSION_EXPIRED`/login, **no** a loop.
- `disarm()` → vuelve a la normalidad → debe recuperar a `ONLINE_SUBSCRIBED`.
Criterio de éxito: en ningún arm/disarm queda un loop de CHANNEL_ERROR; la recuperación llega a SUBSCRIBED **solo** con
token fresco. Detalle + cronología → **`docs/rca/2026-06-22-realtime-suspension.md`**.

**Plan B documentado (si hiciera falta — código sensible de auth, NO tocado).** `safeNavigatorLock` (en `supabase.ts`)
hoy solo le pone tope a la **adquisición** del lock (10s), **no a la operación** (`fn()`, que envuelve el `getSession`/
`refreshSession` reales). Si el `fn()` cuelga DENTRO del lock, ponerle un tope ahí. **Es auth sensible** (un tope mal
puesto corre el refresh sin lock o aborta una sesión válida) → diseño cuidadoso + prueba, no parche de una línea.

> ⚠️ La instrumentación `[rt-diag]` (`supabase.ts` + `useRealtimeRefetch.ts`) y `[diag-repro]` (el switch) **SIGUEN
> ACTIVAS — NO borrar** hasta que el rediseño esté resuelto y validado con `__satoriDiag`. Recién ahí: borrar logs por
> prefijo, y **decidir si el switch se queda como herramienta permanente de staging o se remueve** (es removible de un
> golpe: borrar `src/shared/diag/realtimeReproSwitch.ts` + su test + el bloque gateado en `supabase.ts`).

### 0.1 — Pendientes secundarios anotados (relacionados, fuera del rediseño en sí)
- **(a) UX — el revive tarda hasta ~30 s en encolar tras suspensión.** Con la red zombi, la primera escritura de caja
  puede tardar hasta ~30 s en caer al outbox (suma de topes de 8s + reintentos). **Funciona** (no se pierde el pago,
  ver durabilidad de caja, ítem 0.2), pero la espera se nota. Revisar al rediseñar la máquina de estados.
- **(b) `createDayMovement` no tiene tope ni cola.** Mismo hueco que ya se tapó en `registerCashMovement`/
  `updateCashMovement`/`deleteCashMovement`, pero `createDayMovement` (movimientos de Caja Diaria nivel-día) quedó
  **fuera de alcance hasta ahora**: si su escritura cae sobre el socket zombi, se cuelga sin tope y sin encolar.
  Aplicarle el mismo patrón (`withWriteTimeout` + outbox incondicional ante timeout/red). **Es escritura de plata** →
  con test, sin tocar sagrados.
- **(c) 🆕 BUG NUEVO (descubierto hoy) — `Cmd+Shift+R` estando en `/caja` deja la app colgada.** Un hard-reload en la
  ruta de Caja deja la app trabada (no termina de cargar). **Investigar:** reproducir, mirar consola/network, aislar si
  es Realtime/auth en el arranque de `/caja` o el SW/precache. Sin RCA todavía.

### 0.2 — ✅ Durabilidad de escritura de Caja (ya en staging `c9e0a24`, contexto para el rediseño)
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

## 2. 🔲 404 menor en prod sobre `propinas:1` (prolijidad, baja prioridad)
Un recurso falta en prod (`propinas:1` en Network) — probablemente un icono o un source-map. **NO afecta la
operación** (las pantallas cargan). Identificar el archivo exacto (DevTools → Network, filtro vacío, recargar)
y agregarlo o quitar la referencia. No urgente.

## 3. 🖊️ Migraciones — discrepancia 035 + verificar 038
- **035:** el ledger de staging la tiene **como aplicada** aunque el archivo solo vive en `propina-pool` (sin merge).
  Sesión dedicada de propinas: entender el origen ANTES de tocar nada. **NO tocar el historial de migraciones**.
- **038 (Bandeja):** el registro previo la marca **aplicada y firmada en STAGING** (`0205654`); este handoff la dejó
  anotada para **confirmar su estado real en el ledger** antes de actuar. A **PROD va con el pase del PoS** (sin aplicar aún ahí).
- Detalle en `_handoff/038-apply.log`. (No puedo verificar el estado del ledger desde acá — cero contacto con la base.)

## 4. 🟢 ETAPA 2 — entrada única foto-primero 100% dentro de Caja Diaria (diseñada, sin arrancar)
La Bandeja Etapa 1 ya está validada. Etapa 2:
- **Una sola entrada foto-primero** dentro de **Caja Diaria**; se **retira** el camino `facturas` (queda legacy).
- **Foto OBLIGATORIA** por pago. La **IA lee y SUGIERE** tipo/categoría (mercadería/operativo/personal/socios)
  mapeando a las categorías existentes; el **humano confirma** (nunca auto-commit de montos).
- **Propinas:** pide **turno (AM/PM)+fecha** en vez de proveedor y **concilia el pendiente**.
- **Offline — Opción A:** se registra el pago igual sin red; la IA procesa la foto al volver internet.

## 5. 🖊️ Pase del PoS + Bandeja a PROD (gran salto, decisión de la dueña)
Consolidar migraciones **022–038** con guard anti-staging; crear buckets `facturas`/`productos`/`documents`
en prod; regenerar tipos post-merge. Requiere autorización única + verificación de hash. Es 021→038 en una.

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
