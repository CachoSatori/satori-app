# HANG-RCA-2 — Loop OFFLINE_WAITING tras suspensión larga (el outbox no drena)

> RCA del segundo cuelgue de recuperación de auth. Complementa `HANG-RCA.md` (raíz).
> Archivos: `src/shared/api/supabase.ts` (`classifyRealtime` / `ensureRealtimeHealthy`).

## Síntoma

Tras una **suspensión larga** de la máquina (laptop dormida horas), al despertar la app queda
clavada: la máquina de 3 estados entra en **`OFFLINE_WAITING` y reintenta para siempre**. Nunca
recupera el token, nunca llega a `SESSION_EXPIRED`, y **el outbox de caja NO drena** (los pagos
encolados se quedan sin subir hasta un reload manual). Confirmado en producción (Ola 1).

## Hipótesis DESCARTADA — inversión del lock (10s > 8s)

Primera teoría: `LOCK_ACQUIRE_TIMEOUT_MS` (10s) era mayor que `AUTH_OP_TIMEOUT_MS` (8s), así que
`getSession`/`refreshSession` se rendían por `withTimeout` (8s) **antes** de que el escape "correr sin
lock" de `safeNavigatorLock` (10s) llegara a dispararse → la op nunca escapaba el lock muerto.

**Refutada por los logs.** En TODAS las capturas (incluida una suspensión real de ~4h) el mensaje
`[auth] lock "<name>" no adquirido en Ns — ejecutando sin lock` **disparó 0 veces**. Es decir: el
lock SÍ se adquiría; el cuelgue no estaba en la adquisición. Además, `armZombie` (el repro switch de
staging) stubea `getSession`/`refreshSession` para que **cuelguen directamente** — reproduce el bug
sin tocar el lock. → El cuelgue real está **DENTRO de la op de auth** (el `fetch` del refresh no
vuelve sobre la conexión zombi tras suspensión), no en el candado.

El fix del lock (`LOCK_ACQUIRE_TIMEOUT_MS` 10s → 5s, ya en staging) es **hardening inofensivo**
(deja un margen sano para el escape de adquisición), pero **NO es el fix de este bug**.

## Causa raíz REAL

En `classifyRealtime` (`supabase.ts`), el camino de timeout de `getSession` no tenía escape:

```ts
if (!sessionRead) return { state: 'OFFLINE_WAITING' }
```

`sessionRead` queda `false` cuando `getSession` **no completa** (cae al fallback del `withTimeout`).
`ensureRealtimeHealthy` trata `OFFLINE_WAITING` reprogramando un reintento con backoff (3s→30s). Pero
si la auth está **wedgeada** (el fetch nunca vuelve tras la suspensión profunda), **cada reintento
vuelve a colgarse igual** → `OFFLINE_WAITING` eterno. Nunca se alcanza `refreshSession` ni
`SESSION_EXPIRED`, así que el deslogueo declarativo (→ `/login`) nunca ocurre y el outbox no drena.

## El fix (cause-agnostic)

No intentamos adivinar por qué el fetch no vuelve: contamos **timeouts consecutivos de
`getSession`**. Tras `N = 3`, escalamos a `SESSION_EXPIRED` y **forzamos el deslogueo local**
(`supabase.auth.signOut({ scope: 'local' })`), porque gotrue NO limpia la sesión por el camino de
timeout (solo lo hace ante un `refresh.error` real).

- `signOut({ scope: 'local' })` dispara `onAuthStateChange(session=null)` → `useAuth` →
  `<Navigate to="/login">`. El usuario reingresa y el outbox **drena al volver** (el `signOut` local
  NO toca el IndexedDB del outbox: la cola sobrevive al re-login).
- Es **client-side**: sin red no se cuelga. Es **idempotente**: si ya no había sesión, no pasa nada.
- Un blip transitorio (un solo timeout aislado) **NO escala**: `getSession` completa antes de N y el
  contador se **resetea**. Solo una auth genuinamente wedgeada acumula N timeouts seguidos.

```ts
const MAX_GETSESSION_TIMEOUTS = 3
let consecutiveGetSessionTimeouts = 0
// …en classifyRealtime:
if (!sessionRead) {
  consecutiveGetSessionTimeouts++
  if (consecutiveGetSessionTimeouts >= MAX_GETSESSION_TIMEOUTS) {
    consecutiveGetSessionTimeouts = 0
    return { state: 'SESSION_EXPIRED' }
  }
  return { state: 'OFFLINE_WAITING' }
}
consecutiveGetSessionTimeouts = 0   // getSession completó → racha rota
```

## Validación

- **Test determinístico** (`supabase.timeout.test.ts`): `getSession` colgada → un timeout NO escala
  (`signOut` = 0); tras N ciclos del backoff escala **exactamente una vez** (`signOut` = 1) y nunca
  emite `rt:healthy`. Los tests existentes de `SESSION_EXPIRED` siguen verdes con el `signOut`
  agregado al mock.
- **Suspensión real > 1h**: al despertar, la app escala a `/login` en vez de quedar en loop; tras
  reingresar, el outbox drena.

## Alcance

100% client-side. Sin migración, sin tocar esquema. No se toca `AUTH_OP_TIMEOUT_MS`,
`LOCK_ACQUIRE_TIMEOUT_MS`, ni el resto de la máquina de 3 estados fuera del escape descrito.
