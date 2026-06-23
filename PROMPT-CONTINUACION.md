# Continuación — backlog priorizado (handoff 2026-06-22)

Estado: **PROD (`main` `04b1a32`) está FUERA DE USO — riesgo cero, NO tocar.** Tiene capa de inteligencia +
fix SW viejo + fix fechas-borde + **canario Realtime/candado de auth** (R1 + fix final). STAGING (`90099fb`) =
todo el PoS + Bandeja Etapa 1 + esos fixes + **la saga Realtime/suspensión completa, incl. el fix de re-auth de jun-23**. Guardrails de siempre:
**nada a `main`/PROD sin orden explícita, DDL solo migraciones aditivas, sagrados intactos** (`cashUtils`,
`tipCalculations`, `computeTotals`, cierres, cobro/vuelto, `posFiscal`), builds+tests+eslint verdes por commit.
Estado completo → [ESTADO.md](ESTADO.md) · Fases → [ROADMAP.md](ROADMAP.md) · RCA Realtime →
[docs/rca/2026-06-22-realtime-suspension.md](docs/rca/2026-06-22-realtime-suspension.md).

Marcadores: ✅ hecho · 🖊️ espera FIRMA/DECISIÓN de la dueña (plata) · 👁️ espera VALIDACIÓN FÍSICA ·
🟢 ingeniería lista para arrancar · 🔴 bloqueante / urgente.

> **Ya resuelto y EN PROD:** SW viejo (`fde9264`), fechas de borde de mes (`ff836a0`), y el **canario
> Realtime/candado de auth** (`04b1a32`). Eran las tres causas viejas del "se traba". La causa NUEVA (Realtime
> tras suspensión profunda) ya tiene **fix implementado en staging `90099fb`**, blindaje validado; resta la
> validación limpia del revive-on-timeout → ítem 0.

---

## 0. 🟡 PENDIENTE TÉCNICO #1 — Cerrar el fix de Realtime tras suspensión (fix YA en staging, falta validación limpia)

**Contexto:** el fix de re-auth está **implementado y mergeado a staging `90099fb`** (3 ramas, 100% client-side). La
raíz tenía dos capas: (1) desync token HTTP↔socket, y (2) las auth-ops (`getSession`/`refreshSession`) que la
recuperación usa **se cuelgan sobre la conexión zombi y nunca settlean** → `ensureRealtimeHealthy` quedaba clavado
(`healthInFlight` nunca liberado) → app muerta hasta recargar. El **blindaje anti-clavado** (`withTimeout` 8s por
auth-op + cinturón por edad 40s + emit por evidencia del hook) **está VALIDADO físicamente: el deadlock permanente
ya no pasa**. Detalle + cronología → **`docs/rca/2026-06-22-realtime-suspension.md`**.

Lo que queda, en orden:

**(a) 🟡 Validación limpia del revive-on-timeout.** `fix/realtime-resume-revive` (`cf6c77a`): cuando `getSession`
expira por timeout (red zombi, distinto de deslogueo real vía flag `sessionRead`), renueva la conexión física
(disconnect→connect) para que el canal suba a **SUBSCRIBED**. La última prueba **no fue concluyente**: la sesión
venció de verdad (>1h suspendida) → `getSession` COMPLETÓ y reportó "deslogueado real" → login (comportamiento
CORRECTO, no bug). **Falta** reproducir con **sesión TODAVÍA VIVA pero red zombi** (suspensión más corta o token con
TTL largo) y confirmar en los logs `[rt-diag]` que tras el timeout el canal vuelve a **SUBSCRIBED**.

**(b) 🟢 Si (a) pasa → limpieza + pase a main.** **Borrar los logs `[rt-diag]`** por prefijo (en `supabase.ts` y
`useRealtimeRefetch.ts`), y planear el **pase a PROD (`main`) con ritual** (canario / verificación de hash; recordar
que `main` está fuera de uso → el pase es de bajo riesgo pero igual se hace con el ritual de siempre). Es 100%
client-side, sin migración.

**(c) 📋 Plan B documentado (si el revive no bastara) — NO tocado, código sensible de auth.** Hoy `safeNavigatorLock`
solo le pone tope a la **adquisición** del lock (10s), **no a la operación** (`fn()`, que envuelve el `getSession`/
`refreshSession` reales). Si tras (a) el canal siguiera sin subir porque el `fn()` cuelga DENTRO del lock, el plan B
es ponerle un tope al `fn()` dentro de `safeNavigatorLock`. **Es auth sensible** (un tope mal puesto puede correr el
refresh sin lock o abortar una sesión válida) → requiere diseño cuidadoso y prueba, no es un parche de una línea.

> ⚠️ La instrumentación `[rt-diag]` (en `supabase.ts` y `useRealtimeRefetch.ts`) **SIGUE ACTIVA**: **NO borrar** hasta
> cerrar (a). Recién ahí se borra por prefijo `[rt-diag]` (paso (b)).

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
