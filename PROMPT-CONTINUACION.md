# Continuación — backlog priorizado (handoff 2026-06-24)

Estado: **PROD (`main` `04b1a32`) está FUERA DE USO — riesgo cero, NO tocar.** Tiene capa de inteligencia +
fix SW viejo + fix fechas-borde + **canario Realtime/candado de auth** (R1 + fix final). STAGING (`3a0fd20`) =
todo el PoS + Bandeja Etapa 1 + esos fixes + la **saga Realtime/suspensión CERRADA** (máquina de 3 estados + gateo del
emit + endurecimiento `SESSION_EXPIRED`) + **durabilidad de escritura de caja (jun-23)** +
**switch de diagnóstico de Realtime solo-staging**. Guardrails de siempre:
**nada a `main`/PROD sin orden explícita, DDL solo migraciones aditivas, sagrados intactos** (`cashUtils`,
`tipCalculations`, `computeTotals`, cierres, cobro/vuelto, `posFiscal`), builds+tests+eslint verdes por commit.
Estado completo → [ESTADO.md](ESTADO.md) · Fases → [ROADMAP.md](ROADMAP.md) · RCA Realtime →
[docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md).

Marcadores: ✅ hecho · 🖊️ espera FIRMA/DECISIÓN de la dueña (plata) · 👁️ espera VALIDACIÓN FÍSICA ·
🟢 ingeniería lista para arrancar · 🔴 bloqueante / urgente.

> **Ya resuelto y EN PROD:** SW viejo (`fde9264`), fechas de borde de mes (`ff836a0`), y el **canario
> Realtime/candado de auth** (`04b1a32`). Eran las tres causas viejas del "se traba". **La causa NUEVA (Realtime tras
> suspensión profunda) quedó RESUELTA Y VALIDADA en staging (`3a0fd20`):** máquina de 3 estados (`63ef0bb`) + gateo del
> emit + endurecimiento de `SESSION_EXPIRED` (`3a0fd20`), validado físico con `window.__satoriDiag` (ver §0). La
> **durabilidad de escritura de caja** quedó ✅ en staging. **El foco AHORA son los DOS pases a producción (§1A y §1B).**

---

## 0. ✅ RESUELTO esta sesión — Realtime tras suspensión profunda (máquina de 3 estados + gateo + endurecimiento)

`ensureRealtimeHealthy` (en `src/shared/api/supabase.ts`) quedó rediseñada como **MÁQUINA DE 3 ESTADOS** y **validada
físicamente** en el staging desplegado. **Ya NO es un pendiente** — queda acá como referencia para el pase quirúrgico (§1A).
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

## 1A. 🔴🟢 PASE QUIRÚRGICO de estabilidad a MAIN (NO incluye el PoS) — PRIORIDAD AHORA
**Qué:** devolver la **app vieja estable** a producción sin que se trabe — **cherry-pick de la saga Realtime/suspensión
(ya resuelta y validada, §0) + la durabilidad de escritura de caja (§0.2)**, SIN el PoS ni la Bandeja ni las migraciones
022–038. Es client-side puro (sin migración). **Distinto del gran pase del PoS (§1B): no confundir.**
**Antes de pasar (checklist):**
- **Borrar la instrumentación temporal por prefijo:** logs `[rt-diag]` (en `src/shared/api/supabase.ts` y
  `src/shared/hooks/useRealtimeRefetch.ts`) y `[diag-repro]`. **Decidir** si el switch de diagnóstico se queda como
  herramienta permanente de staging o se remueve (removible de un golpe: borrar `src/shared/diag/realtimeReproSwitch.ts`
  + su test + el bloque gateado en `supabase.ts`).
- **Confirmar tree-shaking del código solo-staging:** que `window.__satoriDiag` quede `undefined` en un build prod real.
  ⚠️ **OJO con el footgun de `.env.local`** (§0bis-A): un `npm run build` local compila como STAGING e **incluye** el diag;
  verificar con `VITE_APP_ENV=production npm run build` (o como CI).
- **Ritual de pase** con **firma física de la dueña** + verificación de hash. Cherry-pick selectivo, no merge de staging.

## 1B. 🖊️ GRAN PASE del PoS + Bandeja a PROD (proyecto aparte, DESPUÉS del quirúrgico)
**Qué:** consolidar migraciones **022–038** con guard anti-staging; crear buckets `facturas`/`productos`/`documents` en
prod; regenerar tipos post-merge (es 021→038 en una). **Requiere validar TODO el PoS en piso primero** (§6) y resolver el
**PILAR de escalabilidad de sesión/auth** (abajo, lo bloquea). Autorización única + verificación de hash. Decisión de la dueña.

### 0.1 — Pendientes secundarios anotados (del trabajo de Realtime/caja)
- **(a) UX — el revive tarda hasta ~30 s en encolar tras suspensión.** Con la red zombi, la primera escritura de caja
  puede tardar hasta ~30 s en caer al outbox (suma de topes de 8s + reintentos). **Funciona** (no se pierde el pago,
  ver durabilidad de caja, ítem 0.2), pero la espera se nota. Ya con la máquina de 3 estados; re-evaluar la UX si molesta.
- **(d) 🆕 Menor — `SESSION_EXPIRED` transitorio en el arranque (inofensivo).** En el primer tick del arranque
  `getSession()` puede dar `null` → se ve un `SESSION_EXPIRED` transitorio en los logs `[rt-diag]`. **Inofensivo por el
  FIX 2** (no desloguea ni emite; lo arbitra `refresh.error`). Revisar al limpiar los `[rt-diag]` en el pase quirúrgico (§1A); no urgente.
- **(b) `createDayMovement` no tiene tope ni cola.** Mismo hueco que ya se tapó en `registerCashMovement`/
  `updateCashMovement`/`deleteCashMovement`, pero `createDayMovement` (movimientos de Caja Diaria nivel-día) quedó
  **fuera de alcance hasta ahora**: si su escritura cae sobre el socket zombi, se cuelga sin tope y sin encolar.
  Aplicarle el mismo patrón (`withWriteTimeout` + outbox incondicional ante timeout/red). **Es escritura de plata** →
  con test, sin tocar sagrados.
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
**→ Movido arriba como §1B** (gran pase del PoS, distinto del pase quirúrgico §1A). Resumen: consolidar migraciones
**022–038** con guard anti-staging; crear buckets `facturas`/`productos`/`documents` en prod; regenerar tipos post-merge
(021→038 en una). Bloqueado por el PILAR de escalabilidad de sesión/auth + validación física del PoS (§6).

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
