# RCA — "Se traba tras suspensión profunda" (Realtime / Caja)

> **Fecha:** 2026-06-22 (diagnóstico) · **Actualizado:** 2026-06-23 (fix implementado) · **Estado:** **fix IMPLEMENTADO
> y mergeado a staging `90099fb`** — blindaje anti-clavado VALIDADO físicamente; revive-on-timeout en validación (ver §8).
> **Alcance:** 100% client-side. PROD (`main`) fuera de uso y sin estos cambios. Toda la saga vive en `staging`.
> Foto del proyecto → [../../ESTADO.md](../../ESTADO.md) · Backlog → [../../PROMPT-CONTINUACION.md](../../PROMPT-CONTINUACION.md) · RCA del candado viejo → [../../HANG-RCA.md](../../HANG-RCA.md).

## 1. Síntoma

Tras dejar la máquina **suspendida (~25 min o más)** y volver, la app **se traba**: no entra a ningún
módulo, y la **escritura de caja** queda en "pendiente/cargando" o "sin guardar" (el "sin guardar fantasma"
de Chino Cobano). En consola: **cientos** de `[rt] canal rt-caja: CLOSED`.

## 2. Causa raíz FINAL (confirmada con instrumentación `[rt-diag]` en prueba física)

**Desincronización entre el token HTTP de la sesión y el token del socket Realtime.**

1. Tras la suspensión, el **socket Realtime queda con el JWT vencido** → el join falla con
   `InvalidJWTToken: "Token has expired N sec ago"`.
2. **PERO** `supabase.realtime.isConnected()` devuelve **`true`** y el **heartbeat late ok** (con `worker:true`
   el heartbeat no se throttlea) → el socket *parece* sano a nivel transporte, pero su **token está muerto**.
3. `ensureRealtimeHealthy()` mira `getSession()` (lado **HTTP**, que está sano, o `tokenNeedsRefresh=false`),
   concluye "todo bien", **nunca marca `recovered=true`**, **nunca emite `'rt:healthy'`**.
4. El **freno anti-loop del hook (R1)** corta a los 5 `recreate`, pero queda **esperando un `'rt:healthy'`
   que jamás llega** → Realtime muere, la app no abre módulos, las escrituras quedan colgadas.
5. El refresh HTTP (`token?grant_type=refresh_token`) **SÍ responde 200** — el token nuevo existe; el problema
   es que **nunca se inyecta al socket de forma efectiva**.

**En una frase:** el SDK cree que el socket está vivo (`isConnected=true`, heartbeat ok), pero el socket está
autenticado con un JWT vencido; nuestra recuperación decide sobre el estado HTTP/`isConnected`, no sobre el
**estado real del canal** (CHANNEL_ERROR / InvalidJWT), así que nunca dispara la re-autenticación.

## 2bis. Segunda capa (hallada al implementar el fix, jun-23) — la recuperación misma se cuelga

Al darle a `ensureRealtimeHealthy` la lógica para re-autenticar, apareció una capa más profunda que explicaba por
qué la app quedaba **muerta hasta recargar** (no solo "Realtime caído"):

- Tras la suspensión la **conexión TCP queda zombi**: las propias auth-ops que la recuperación usa —
  `supabase.auth.getSession()` y `refreshSession()` — **se cuelgan sobre esa conexión y NUNCA settlean**.
- `ensureRealtimeHealthy` es un singleton single-flight: marca `healthInFlight` y lo limpia en un `finally`. Si el
  `await getSession()` no vuelve **nunca**, el `finally` **no corre** → `healthInFlight` queda **clavado para siempre**.
- A partir de ahí **TODA** llamada posterior (el freno del hook **y** los disparadores de resume
  visibility/online/focus) sale temprano por el guard `if (healthInFlight) return` → la recuperación no vuelve a
  intentarse **jamás**, ni automáticamente ni al volver a primer plano. De ahí el "muerto hasta recargar".
- Es el mismo patrón del **candado de auth envenenado**: `safeNavigatorLock` le pone tope a la **adquisición** del
  lock (10s) pero **no a la operación** (`fn()`, que envuelve el `getSession`/`refresh` reales); si la operación
  cuelga dentro del lock, la adquisición ya rindió pero el `await` interno no vuelve nunca.

## 3. Lo que NO era (hipótesis descartadas durante la saga)

| Hipótesis | Veredicto | Por qué |
|---|---|---|
| Loop de token viejo (`InvalidJWTToken` por no propagar el refresh al socket) | **Resuelto** (round 1) | `onAuthStateChange` global ya hace `realtime.setAuth` en cada cambio de sesión. Necesario pero **no suficiente** tras suspensión. |
| Contención del candado de auth (`navigator.locks`) por `getSession()` por-hook | **Resuelto** (fix final) | Se sacó el `getSession()` redundante de `useRealtimeRefetch`. Ya en PROD (canario). |
| Heartbeat throttleado en el hilo principal → socket muere en background | **Cubierto** (`worker:true`) | El heartbeat corre en Web Worker no throttleado. El socket ya **no muere** por throttle… pero queda **zombi con JWT vencido** (ver §2). |
| Socket TCP zombi (readyState OPEN pero conexión muerta) | **Parcial / no era el principal** | Real para las **escrituras** (cubierto con abort/retry en `cash.ts`), pero el problema de Realtime es el **token**, no el TCP. |
| `disconnect(); connect()` no-op por guard del SDK | **Bug real, arreglado** | `disconnect()` deja el socket en `closing` síncrono → `connect()` early-return por `isDisconnecting()`. Se arregló con `await disconnect()`. **No** era la raíz final, pero era un eslabón roto de la recuperación. |

## 4. Cronología de la saga (todo en `staging`)

| Tanda | Commit(s) | Qué hizo | Resultado |
|---|---|---|---|
| Round 1 — JWT refresh | `9f3ebe0` (`fix/realtime-jwt-refresh`) | `onAuthStateChange`→`realtime.setAuth` global; guard `channel===ch`; auto-cura canal | **Necesario.** Curó el loop de JWT en operación normal. **En PROD vía canario** (`deb7da2`/`18c9082`/`9f3ebe0`). |
| Round 2 — revive socket | `160d11f` (`fix/realtime-socket-revive`) | Revive del socket en `visibilitychange`/`online` | **REVERTIDO** — subía contención sin beneficio probado. **NO va a prod.** |
| Fix candado | `09480a6` (`fix/auth-lock-contention`) | Saca el `getSession()` por-hook (causa del `[auth] lock no adquirido en 10s`) | **En PROD vía canario.** |
| Recuperación estable | `97d9c75` | `ensureRealtimeHealthy()` singleton single-flight + `refreshSession()` + emite `rt:healthy` solo si hubo recuperación real | Mejoró, pero **no cortó el loop tras suspensión** (origen de esta RCA). |
| Worker + abort/retry | `b7cf327`,`7cd7760` | `worker:true` + `heartbeatCallback` (revive en disconnect/error) + `withWriteTimeout` que **aborta** el fetch colgado y reintenta una vez (cash.ts) | El heartbeat deja de morir por throttle; las escrituras dejan de encolar falso-offline. **Pero el socket queda zombi con JWT vencido.** |
| Diagnóstico + refuerzos | `28901c4` | Instrumentación `[rt-diag]`; **R1 freno anti-loop** (5 fallos → para de recrear, espera `rt:healthy`); **R2** `await disconnect()` antes de `connect()` (arregla el no-op) | **Reveló la raíz final** (§2). El freno corta el loop caliente, pero queda esperando un `rt:healthy` que no llega. |

## 5. El fix IMPLEMENTADO (jun-23, staging `90099fb`, 3 ramas, 100% client-side)

`ensureRealtimeHealthy()` ahora **re-autentica por evidencia y nunca queda clavado**. Dos partes:

**A. Re-auth + emit por evidencia** (`fix/realtime-reauth-emit`): el hook, cuando su freno corta (5 fallos sin
`SUBSCRIBED`), llama a la recuperación con `reason='channel-stuck'`. En ese path el singleton **fuerza
`refreshSession()` + `setAuth(token)`** (gateado por backoff de 30s para no martillar el endpoint) y **emite
`'rt:healthy'` igual** —aunque HTTP/`isConnected` parezcan sanos— para que el hook re-suscriba con `joinPayload`
fresco. La recuperación REAL la valida el hook: solo resetea su freno cuando el canal llega a `SUBSCRIBED`
(evidencia, no `isConnected()`).

**B. Blindaje anti-clavado** (`fix/realtime-reauth-timeout` + ajustes): cierra la 2ª capa (§2bis).
- `withTimeout(p, ms, label, fallback)`: `Promise.race` con tope que **resuelve con fallback** (modo degradado, no
  cuelga) si la op no settlea. Aplicado a `getSession` (8s), `refreshSession` (8s) y `realtime.disconnect` (8s).
- **Cinturón por edad** del in-flight (`HEALTH_MAX_AGE_MS=40s`, > el peor caso legítimo ≈24s): si una corrida quedó
  pegada, la próxima la abandona y arranca otra → `healthInFlight` **nunca** queda rehén.
- El **gate del refresh** se consume solo si el refresh **completó** (no si expiró por timeout) → un cuelgue se
  reintenta pronto. En `channel-stuck` se emite `'rt:healthy'` aunque el refresh expire.
- **Revive-on-timeout** (`fix/realtime-resume-revive`): si `getSession` expira por timeout (red zombi, distinto de
  deslogueo real vía flag `sessionRead`), **renueva la conexión física** (`disconnect→connect`) en vez de abortar →
  el `onAuthStateChange` global re-propaga el token fresco al reconectar y el canal vuelve a `SUBSCRIBED`.

**Cuidados cumplidos:** no se confía en `isConnected()` (el zombi); no se crea loop de refresh (single-flight +
backoff + gate por completitud). Cubierto con un test del hang en `src/shared/api/supabase.timeout.test.ts`.

## 6. Instrumentación temporal — SIGUE ACTIVA (no borrar todavía)

Los logs con prefijo **`[rt-diag]`** (en `src/shared/api/supabase.ts` y `src/shared/hooks/useRealtimeRefetch.ts`)
**siguen activos** para la validación física en piso del revive-on-timeout (§8). **Borrarlos por prefijo
`[rt-diag]`** recién cuando esa validación cierre limpio (paso (b) del ítem 0 de PROMPT-CONTINUACION).

## 7. Qué quedó vivo y útil de la saga (no revertir)

- `worker:true` + `heartbeatCallback` — el heartbeat ya no muere por throttle.
- `cash.ts` abort/retry — las escrituras de caja ya **no** encolan falso-offline por un timeout (TCP zombi cubierto).
- **R1 freno anti-loop** — corta los cientos de `recreate` (la app deja de estar "trabada caliente"); queda
  esperando el `rt:healthy` que el fix de re-auth va a emitir.
- `await disconnect()` antes de `connect()` — arregla el no-op del revive.

## 8. Estado de validación (jun-23) y qué falta

- ✅ **Blindaje anti-clavado — VALIDADO físicamente.** El deadlock permanente (app muerta hasta recargar) ya no
  ocurre: `ensureRealtimeHealthy` siempre settlea en pocos segundos y `healthInFlight` siempre se libera, así que la
  recuperación vuelve a correr (sola o al volver a primer plano).
- 🟡 **Revive-on-timeout — validación PARCIAL.** En la última prueba la sesión venció de verdad (>1h suspendida) →
  `getSession` COMPLETÓ y reportó "deslogueado real" → login. **Comportamiento correcto, NO bug.** Falta una prueba
  **limpia** con **sesión todavía viva pero red zombi** (suspensión más corta / token con TTL largo) para confirmar
  en los logs `[rt-diag]` que tras el timeout el canal vuelve a `SUBSCRIBED`.
- **Plan B (si no bastara), NO tocado — código sensible de auth:** ponerle tope al `fn()` DENTRO de
  `safeNavigatorLock` (hoy solo la adquisición tiene tope de 10s, no la operación). Ver §2bis y el ítem 0 de
  PROMPT-CONTINUACION. No es un parche de una línea.
- **Pase a main:** tras la validación limpia → borrar `[rt-diag]` por prefijo y planear el pase con el ritual de
  siempre (es 100% client-side, sin migración).
