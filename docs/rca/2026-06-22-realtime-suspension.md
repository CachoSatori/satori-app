# RCA — "Se traba tras suspensión profunda" (Realtime / Caja)

> **Fecha:** 2026-06-22 · **Estado:** raíz final IDENTIFICADA CON DATOS, **fix de re-auth pendiente de diseño**.
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

## 5. El fix PENDIENTE (diseño — NO implementado)

`ensureRealtimeHealthy()` debe **re-autenticar el socket** con `setAuth(tokenFresco)` y **emitir `'rt:healthy'`**
basándose en el **estado REAL del canal** (`CHANNEL_ERROR` / `InvalidJWT` / "Token has expired"), **NO** en
`isConnected()` ni solo en `tokenNeedsRefresh` del lado HTTP.

**Idea de diseño (a refinar con cabeza fresca):**
- Detectar la condición "socket con JWT vencido pese a `isConnected()=true`": p. ej. el hook pasa al singleton la
  señal de que el canal está en `CHANNEL_ERROR`/`InvalidJWT` (estado real), o el singleton fuerza un
  `refreshSession()` + `setAuth(token)` + verifica que el join vuelva a `SUBSCRIBED`.
- Tras re-autenticar de verdad, **emitir `'rt:healthy'`** para que el hook re-suscriba (el freno R1 ya espera ese evento).
- **Cuidado n°1 — NO crear un loop de refresh** que martille `token?grant_type=refresh_token`: gatear por evidencia
  (estado real del canal + single-flight + backoff), no por cada `visibilitychange`.
- **Cuidado n°2 — el zombi de `isConnected()`:** no confiar en `isConnected()` como prueba de salud; un socket con
  `readyState=OPEN` y heartbeat ok puede tener el token muerto.

> **Requiere sesión dedicada con cabeza fresca.** No es un parche de una línea.

## 6. Instrumentación temporal a remover

Los logs con prefijo **`[rt-diag]`** (en `src/shared/api/supabase.ts` y `src/shared/hooks/useRealtimeRefetch.ts`)
son **temporales**, para la prueba física que confirmó esta RCA. **Borrarlos por prefijo `[rt-diag]`** cuando se
implemente y valide el fix de re-auth.

## 7. Qué quedó vivo y útil de la saga (no revertir)

- `worker:true` + `heartbeatCallback` — el heartbeat ya no muere por throttle.
- `cash.ts` abort/retry — las escrituras de caja ya **no** encolan falso-offline por un timeout (TCP zombi cubierto).
- **R1 freno anti-loop** — corta los cientos de `recreate` (la app deja de estar "trabada caliente"); queda
  esperando el `rt:healthy` que el fix de re-auth va a emitir.
- `await disconnect()` antes de `connect()` — arregla el no-op del revive.
