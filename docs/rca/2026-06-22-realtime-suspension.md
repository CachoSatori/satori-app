# RCA — "Se traba tras suspensión profunda" (Realtime / Caja)

> **Fecha:** 2026-06-22 (diagnóstico) · **Actualizado:** 2026-06-24 (resolución final) · **Estado:** **✅ CERRADO —
> RESUELTO Y VALIDADO en staging `3a0fd20`.** La saga se cerró con la **MÁQUINA DE 3 ESTADOS** (`63ef0bb`) + **gateo del
> emit y endurecimiento de `SESSION_EXPIRED`** (`3a0fd20`), AMBOS validados físicamente con `window.__satoriDiag`. El
> approach intermedio de re-auth (emit-on-timeout + revive-on-timeout, §5) **dejaba un loop `InvalidJWT` y fue REEMPLAZADO**
> (ver §9). **Alcance:** 100% client-side. PROD (`main`) fuera de uso y sin estos cambios. La saga vive en `staging`.
> Foto del proyecto → [../../ESTADO.md](../../ESTADO.md) · Backlog → [../../PROMPT-CONTINUACION.md](../../PROMPT-CONTINUACION.md) · RCA del candado viejo → [../../HANG-RCA.md](../../HANG-RCA.md).
>
> **⚠️ Nota de lectura:** las §1–§4 (síntoma, causa raíz, descartadas, cronología) son historia vigente. La **§5 es un
> approach INTERMEDIO que fue REEMPLAZADO**; la **resolución final está en §9**. La §8 quedó superada por la §9.

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

## 5. Approach INTERMEDIO de re-auth (jun-23, staging `90099fb`) — ⚠️ REEMPLAZADO (dejaba un loop). Ver §9.

> **Este approach ya NO es la solución.** Resolvió el deadlock *permanente* (parte B, blindaje anti-clavado — eso SÍ
> sobrevive), pero su parte A **emitía `rt:healthy` en el TIMEOUT del refresh** → el hook re-suscribía con el token
> VENCIDO → `InvalidJWTToken` → **loop infinito de CHANNEL_ERROR** (visto en una suspensión de 3–5 h). Se conserva acá
> como historia; la **resolución final (máquina de 3 estados + gateo + endurecimiento) está en §9**.

`ensureRealtimeHealthy()` re-autenticaba por evidencia y nunca quedaba clavado. Dos partes:

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

## 8. Estado de validación (jun-23) — ⚠️ SUPERADO por §9 (snapshot histórico del approach intermedio)

> Este era el estado del approach intermedio (§5). La validación "limpia" que faltaba acá la cerró el rediseño de §9.
> Se conserva como historia.

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

## 9. ✅ RESOLUCIÓN FINAL — MÁQUINA DE 3 ESTADOS + gateo del emit + endurecimiento de `SESSION_EXPIRED` (jun-24, staging `3a0fd20`)

El approach de §5 (emit-on-timeout) dejaba un **loop `InvalidJWT`**: emitir `rt:healthy` sin token fresco hacía
re-suscribir con el token vencido. Se **reemplazó** por un rediseño estructural, **validado físicamente**.

**`63ef0bb` — Máquina de 3 estados.** `ensureRealtimeHealthy` clasifica el resultado de las auth-ops (con tope
`withTimeout` 8s; discrimina timeout vs completado con los flags `sessionRead`/`refreshCompleted`, **no** con
`isConnected()` que es el zombi) en EXACTAMENTE uno de:
- **`ONLINE_SUBSCRIBED`** (token fresco CONFIRMADO) → `setAuth(freshToken)`, revive el socket si `!isConnected()`, y es
  la **ÚNICA** rama que emite `rt:healthy`.
- **`OFFLINE_WAITING`** (getSession/refresh por timeout, red zombi) → **NO emite, NO `setAuth`, NO re-suscribe**; renueva
  el TCP físico (`disconnect→connect`) y reintenta con **backoff 3s→30s** (un único timer cancelable a nivel módulo).
- **`SESSION_EXPIRED`** → NO toca el socket; deja actuar el deslogueo declarativo (`onAuthStateChange` → `useAuth` →
  `<Navigate to="/login">`).

**Regla madre:** nunca emitir `rt:healthy` ni re-suscribir sin token fresco confirmado; ningún camino termina en loop.
`useRealtimeRefetch` quedó **byte-idéntico** (su contrato `rt:healthy`→re-suscribe no cambió; solo cambió *cuándo* se emite).

**`3a0fd20` — dos fixes sobre la máquina:**
- **FIX 1 (gateo del emit):** flag de módulo `healthyAwaited`. La emisión de `rt:healthy` corre **solo si hay una
  recuperación pendiente** (se enciende en `channel-stuck` o al caer en `OFFLINE_WAITING`; se apaga al volver a
  `ONLINE_SUBSCRIBED`/`SESSION_EXPIRED`). Arregla la **regresión de arranque**: el emit incondicional re-suscribía el
  canal recién creado → `CLOSED` ×5 → FRENO → tiempo real muerto al abrir. Ahora un `'resume'` rutinario sano hace
  `setAuth` SIN emit y el canal inicial se asienta solo.
- **FIX 2 (endurecimiento de `SESSION_EXPIRED`):** `getSession→null` ya **no** es deslogueo directo (en el arranque puede
  dar `null` un tick antes de hidratar desde storage). El **árbitro único** de `SESSION_EXPIRED` es `refresh.error`.

**Validación física (staging desplegado, `window.__satoriDiag`):**
- `armZombie()` → `OFFLINE_WAITING` + backoff, **sin loop de CHANNEL_ERROR ni `InvalidJWT`**; la app espera.
- `disarm()` → `ONLINE_SUBSCRIBED` emite `rt:healthy` → el canal vuelve a `SUBSCRIBED` (recupera).
- `armExpired()` → `SESSION_EXPIRED` (el simulador no dispara `SIGNED_OUT`; hacer `disarm()`/recargar antes de cerrar sesión).
- **Arranque** sin cascada `CLOSED→recreate`; **foco rutinario** sin `re-subscribe por rt:healthy`.
Asesor: build + lint (81 baseline) + test 122/122 verdes; diff solo en `supabase.ts` + su test; hook byte-idéntico.

**Pendiente (no urgente):** ver §0.1(d) de PROMPT-CONTINUACION — el `SESSION_EXPIRED` transitorio del primer tick del
arranque (inofensivo por FIX 2). **Logs `[rt-diag]`/`[diag-repro]` siguen ACTIVOS**; se borran en el **pase quirúrgico de
estabilidad a main** (PROMPT-CONTINUACION §1A).
