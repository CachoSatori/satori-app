import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase.gen'
import type { Session } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan variables de entorno de Supabase')
}

// Lock real para el refresh de token (Fase 2 de la cirugía de auth, HANG-RCA.md).
// El SDK serializa los refreshes con un lock; el noLock anterior evitaba el hang
// pero permitía refreshes concurrentes entre pestañas (refresh tokens de un solo
// uso → una pestaña podía invalidar la sesión de la otra). Este lock usa
// navigator.locks (serialización real entre pestañas) con un tope de adquisición:
// si en 5s no se consigue (lock colgado, el caso del RCA), se ejecuta SIN lock
// en vez de colgar la UI — el peor caso vuelve a ser el comportamiento anterior.
// INVARIANTE CRÍTICA: LOCK_ACQUIRE_TIMEOUT_MS DEBE ser < AUTH_OP_TIMEOUT_MS (8s). Si no, getSession/
// refreshSession se rinden por withTimeout ANTES de que el fallback "correr sin lock" de
// safeNavigatorLock alcance a dispararse → tras suspensión larga (lock muerto retenido) la máquina
// queda en loop OFFLINE_WAITING eterno, nunca refresca el token y el outbox NO drena.
// VALOR 5_000: deja ~3s de slack para la op lock-free (refreshSession es una llamada de red ~1-2s)
// dentro del presupuesto de 8s; más conservador que 4s frente a falsos "lock no adquirido" en redes/
// dispositivos lentos.
// TRADE-OFF: este tope cumple doble función — paciencia para el refresh legítimo de OTRA pestaña
// (querría ser largo) vs escape de un lock muerto (debe ser < tope por-op). 5s favorece el escape;
// solo un refresh cross-tab legítimo que tarde >5s correría sin lock (red patológica; en estaciones
// de un-dispositivo-por-navegador no aplica).
export const LOCK_ACQUIRE_TIMEOUT_MS = 5_000

export const safeNavigatorLock = async <R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOCK_ACQUIRE_TIMEOUT_MS)
  try {
    return await navigator.locks.request(name, { signal: controller.signal }, async () => {
      clearTimeout(timer)
      return await fn()
    })
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof Error && e.name === 'AbortError') {
      console.warn(`[auth] lock "${name}" no adquirido en ${LOCK_ACQUIRE_TIMEOUT_MS / 1000}s — ejecutando sin lock`)
      return fn()
    }
    throw e
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { lock: safeNavigatorLock },
  // El heartbeat del WebSocket vivía en el hilo principal → el browser lo throttlea en
  // background (pestaña oculta / suspensión profunda de la máquina) → el socket muere
  // (1006 / heartbeat timeout) y la 1ª escritura al despertar se cuelga. worker:true mueve
  // el heartbeat a un Web Worker que el browser NO throttlea (solución oficial Supabase,
  // doc 2026-01-16); heartbeatCallback revive el socket si igual se desconecta.
  realtime: {
    worker: true,
    heartbeatIntervalMs: 15_000,
    heartbeatCallback: (status) => {
      console.log('[rt-diag] heartbeat', status, 'connected=', supabase.realtime.isConnected(), 'workerRef=', !!supabase.realtime.workerRef)
      if (status === 'disconnected' || status === 'error') {
        // socket caído (suspensión/red): revivir explícitamente. El onAuthStateChange
        // global ya re-propaga el JWT fresco al reconectar.
        supabase.realtime.connect()
      }
    },
  },
})

// Realtime se autentica con el JWT del usuario SOLO al crear/unir el canal. Cuando
// supabase-js refresca el token (cada hora, o al volver el foco), el socket ya abierto
// se queda con el token VIEJO; al vencer, el join falla con InvalidJWTToken ("Token has
// expired") y el SDK reintenta con el mismo token muerto → loop de CHANNEL_ERROR → "se
// cuelga" (ver HANG-RCA.md / RCA de Realtime). Acá propagamos CADA cambio de sesión al
// socket para que se re-autentique con el token fresco. En signout (session null) se pasa
// null → Realtime vuelve a la anon key. Listener global, registrado una sola vez (este
// módulo es singleton). El .catch evita un unhandled rejection si el socket aún no abrió.
supabase.auth.onAuthStateChange((_event, session) => {
  supabase.realtime.setAuth(session?.access_token ?? null).catch(() => { /* socket no listo */ })
  // Sesión fresca confirmada (login / refresh OK) → limpiar el latch del logout forzado y el contador de
  // timeouts: recién acá un wedge POSTERIOR puede volver a escalar. Un signOut emite session=null → NO
  // limpia (correcto: seguimos deslogueados sin re-machacar el signOut). Ver HANG-RCA-2 (latch one-shot).
  if (session) { forcedLogoutLatch = false; consecutiveGetSessionTimeouts = 0 }
})

const EXPIRY_MARGIN_S = 60
// Backoff del refresh FORZADO (path 'channel-stuck'): aunque getSession() esté sano, el canal
// puede estar roto por JWT vencido en el socket. Forzamos refresh+setAuth, pero como mucho 1 vez
// por ventana, para NO martillar token?grant_type=refresh_token.
const FORCED_REFRESH_MIN_INTERVAL_MS = 30_000
// Tope por operación de auth/socket (getSession/refreshSession/disconnect). Tras suspensión profunda
// el fetch del refresh queda sobre una conexión zombi y NUNCA settlea → sin tope, el async de
// ensureRealtimeHealthy no termina, el finally no corre y healthInFlight queda clavado PARA SIEMPRE
// (toda recuperación posterior —freno 'channel-stuck' y resume visibility/online/focus— sale temprano
// por el guard y no hace nada). Con tope, cada operación resuelve en pocos segundos (éxito o degradado)
// y el in-flight SIEMPRE se libera.
export const AUTH_OP_TIMEOUT_MS = 8_000
// Cinturón anti-clavado (segunda línea de defensa): edad máxima del in-flight. Si una corrida quedó
// pegada más de esto (p. ej. una op que igual no settleó, o timers congelados durante la suspensión),
// la próxima llamada la IGNORA y arranca una nueva en vez de quedar rehén del guard de concurrencia.
// 40s y no 20s: el peor caso LEGÍTIMO es getSession(8s)+refreshSession(8s)+disconnect(8s) ≈ 24s; con
// 20s el cinturón abandonaría una corrida válida en curso y dispararía una concurrente sobre el socket
// compartido. 40s queda por encima de esos 24s y por debajo del objetivo de recuperación (<60s).
const HEALTH_MAX_AGE_MS = 40_000
// Backoff del reintento de OFFLINE_WAITING (sin red / socket caído / red zombi). Es UN ÚNICO timer
// cancelable a nivel módulo: NO acumula timers. Cada vez que clasificamos OFFLINE_WAITING renovamos el
// TCP y reprogramamos este reintento (3s→30s, tope) que vuelve a clasificar vía ensureRealtimeHealthy('resume').
// Se cancela y se resetea el backoff al alcanzar ONLINE_SUBSCRIBED (o SESSION_EXPIRED). Así NUNCA hay
// re-suscripción en loop: 'rt:healthy' solo se emite cuando hay token fresco confirmado (ver más abajo).
const RESUME_RETRY_MIN_MS = 3_000
const RESUME_RETRY_MAX_MS = 30_000
let lastForcedRefresh = 0
let healthInFlight: Promise<void> | null = null
let healthStartedAt = 0
let resumeRetryTimer: ReturnType<typeof setTimeout> | null = null
let resumeRetryDelay = RESUME_RETRY_MIN_MS
// ¿Hay un suscriptor esperando una recuperación? Solo entonces ONLINE_SUBSCRIBED emite 'rt:healthy'.
// Se enciende cuando el hook frenó y llama con reason='channel-stuck', o cuando caímos en OFFLINE_WAITING
// (red zombi / socket caído). Se apaga al volver a ONLINE_SUBSCRIBED (recuperación servida) o a
// SESSION_EXPIRED. Sin este gate, un 'resume' rutinario (arranque / foco con todo sano) emitiría y haría
// re-suscribir el canal que recién se estaba estableciendo → CLOSED → recreate ×5 → FRENO → tiempo real muerto.
let healthyAwaited = false

// Tras N timeouts consecutivos de getSession (auth wedgeada: el fetch del refresh no vuelve tras
// suspensión larga — ver HANG-RCA-2), esperar es inútil (la op nunca completa). Escalamos a
// SESSION_EXPIRED para forzar el re-login; el outbox sobrevive y drena al reingresar.
const MAX_GETSESSION_TIMEOUTS = 3
let consecutiveGetSessionTimeouts = 0
// Latch terminal one-shot: una vez escalado a SESSION_EXPIRED FORZADO (auth wedgeada) NO volvemos a forzar
// el signOut en cada resume. Solo lo limpia un onAuthStateChange con sesión fresca (login/refresh OK); un
// signOut emite session=null → NO lo limpia (correcto: seguimos deslogueados sin re-machacar el logout).
let forcedLogoutLatch = false

type RealtimeHealthReason = 'resume' | 'channel-stuck'

// Máquina de 3 estados. La regla madre: NUNCA emitir 'rt:healthy' ni re-suscribir sin un token válido
// FRESCO CONFIRMADO. Solo ONLINE_SUBSCRIBED trae ese token y es el único estado que emite.
type RealtimeDecision =
  | { state: 'ONLINE_SUBSCRIBED'; freshToken: string }
  | { state: 'OFFLINE_WAITING' }
  | { state: 'SESSION_EXPIRED'; forced?: boolean }

const tokenNeedsRefresh = (session: Session | null): boolean => {
  if (!session) return false
  const exp = session.expires_at
  if (!exp) return true
  return exp - Math.floor(Date.now() / 1000) <= EXPIRY_MARGIN_S
}

// Promise.race con tope: si `p` no settlea en `ms`, RESUELVE con `fallback` (no rechaza — seguimos
// en modo degradado) y deja rastro en consola. Es lo que evita que ensureRealtimeHealthy quede
// colgada esperando un await que nunca vuelve (la conexión zombi tras suspensión).
const withTimeout = <T>(p: Promise<T>, ms: number, label: string, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      // Incluimos ms + estado del socket para ver, en la validación física, EN QUÉ operación se
      // colgó y cómo estaba el WebSocket en ese momento (isConnected puede ser el zombi true).
      console.warn(`[rt-diag] withTimeout EXPIRÓ: ${label} (${ms}ms, connected=${supabase.realtime.isConnected()})`)
      resolve(fallback)
    }, ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

// Reintento de OFFLINE_WAITING: un ÚNICO timer cancelable. cancel resetea timer + backoff (lo llama
// ONLINE_SUBSCRIBED y SESSION_EXPIRED); schedule reprograma el reintento creciente (lo llama OFFLINE_WAITING).
const cancelResumeRetry = (): void => {
  if (resumeRetryTimer !== null) { clearTimeout(resumeRetryTimer); resumeRetryTimer = null }
  resumeRetryDelay = RESUME_RETRY_MIN_MS
}
const scheduleResumeRetry = (): void => {
  // Cancelamos cualquier timer previo ANTES de programar → jamás acumulamos timers. El reintento entra
  // por ensureRealtimeHealthy('resume'), que respeta el single-flight + el cinturón por edad existentes.
  if (resumeRetryTimer !== null) clearTimeout(resumeRetryTimer)
  const delay = resumeRetryDelay
  console.log('[rt-diag] ensureRealtimeHealthy: OFFLINE_WAITING → reintento en', delay, 'ms')
  resumeRetryTimer = setTimeout(() => {
    resumeRetryTimer = null
    void ensureRealtimeHealthy('resume')
  }, delay)
  resumeRetryDelay = Math.min(resumeRetryDelay * 2, RESUME_RETRY_MAX_MS)
}

// Clasifica el resultado de las auth-ops (con sus topes withTimeout de 8s) en EXACTAMENTE uno de los tres
// estados. Discrimina "expiró por timeout" vs "completó" con los flags sessionRead / refreshCompleted (los
// mismos del blindaje validado); NO usa isConnected() para decidir el estado (isConnected es el zombi:
// miente true sobre la conexión muerta). reason='channel-stuck' (el FRENO del hook, 5 fallos sin SUBSCRIBED)
// fuerza un refresh aunque getSession parezca sano, porque el canal está roto por JWT vencido en el socket.
const classifyRealtime = async (reason: RealtimeHealthReason): Promise<RealtimeDecision> => {
  const stuck = reason === 'channel-stuck'
  // sessionRead distingue "getSession COMPLETÓ" de "expiró por timeout": se marca dentro del .then real.
  // Si el withTimeout cae al fallback (sesión nula), sessionRead queda false → el null vino de la red
  // zombi, NO de un deslogueo.
  let sessionRead = false
  const { data: { session } } = await withTimeout(
    supabase.auth.getSession().then((r) => { sessionRead = true; return r }),
    AUTH_OP_TIMEOUT_MS,
    'getSession',
    { data: { session: null }, error: null },
  )
  // getSession EXPIRÓ por timeout (red/auth zombi): no sabemos si la sesión vive. Esperamos… pero con
  // tope: tras N timeouts consecutivos la op nunca volverá (auth wedgeada) → escapamos a expirar.
  if (!sessionRead) {
    // getSession no completó (auth wedgeada). Contamos timeouts consecutivos: tras N, escapamos a
    // SESSION_EXPIRED (la op nunca volverá). Un blip transitorio completaría antes de N y resetea abajo.
    consecutiveGetSessionTimeouts++
    if (consecutiveGetSessionTimeouts >= MAX_GETSESSION_TIMEOUTS) {
      consecutiveGetSessionTimeouts = 0
      // One-shot: forzamos el signOut SOLO la 1ª vez (latch). Si ya está latcheado, seguimos esperando
      // (renovamos TCP) sin re-disparar el logout en cada resume → evita el ping-pong eterno de logout.
      if (forcedLogoutLatch) return { state: 'OFFLINE_WAITING' }
      forcedLogoutLatch = true
      return { state: 'SESSION_EXPIRED', forced: true }
    }
    return { state: 'OFFLINE_WAITING' }
  }
  // getSession COMPLETÓ → racha de timeouts rota.
  consecutiveGetSessionTimeouts = 0
  // getSession COMPLETÓ con session=null NO se trata como deslogueo: al arrancar puede dar null un instante
  // antes de hidratar la sesión desde storage (falso positivo). El árbitro ÚNICO de SESSION_EXPIRED es el
  // refreshSession de abajo (refresh.error). Con session=null caemos a ese refresh y él decide.
  const forceRefresh = stuck && (Date.now() - lastForcedRefresh >= FORCED_REFRESH_MIN_INTERVAL_MS)
  // Token vigente confirmado y sin necesidad de forzar refresh → online con ESE token (fresco confirmado).
  // El guard `session &&` es necesario: si es null ya no es ONLINE (cae al refresh) y no accedemos a
  // access_token sobre null.
  if (session && !tokenNeedsRefresh(session) && !forceRefresh) {
    return { state: 'ONLINE_SUBSCRIBED', freshToken: session.access_token }
  }
  // Token vencido, getSession dio null (sin confirmar deslogueo), o forceRefresh por stuck: hay que ir al
  // refresh. El gate (lastForcedRefresh) se consume SOLO si el refresh COMPLETÓ (no si expiró por timeout)
  // → un cuelgue se reintenta pronto.
  let refreshCompleted = false
  const refresh = await withTimeout(
    supabase.auth.refreshSession().then((r) => { refreshCompleted = true; return r }),
    AUTH_OP_TIMEOUT_MS,
    'refreshSession',
    { data: { session: null, user: null }, error: null },
  )
  if (refreshCompleted) lastForcedRefresh = Date.now()
  // refreshSession EXPIRÓ por timeout (red zombi) → conservador: esperar (NO emitir con token vencido).
  if (!refreshCompleted) return { state: 'OFFLINE_WAITING' }
  // refreshSession COMPLETÓ con error de auth → sesión no recuperable = deslogueo.
  if (refresh.error) return { state: 'SESSION_EXPIRED' }
  // refreshSession COMPLETÓ OK con sesión → online con el token FRESCO nuevo.
  if (refresh.data.session) return { state: 'ONLINE_SUBSCRIBED', freshToken: refresh.data.session.access_token }
  // COMPLETÓ sin session y sin error (raro) → conservador: esperar.
  return { state: 'OFFLINE_WAITING' }
}

// MÁQUINA DE 3 ESTADOS. Regla madre: NUNCA emitir 'rt:healthy' ni re-suscribir sin un token válido FRESCO
// CONFIRMADO; ningún camino termina en loop.
//  · ONLINE_SUBSCRIBED → setAuth(freshToken); revive el socket si cayó; ÚNICA emisión de 'rt:healthy'.
//  · OFFLINE_WAITING  → NO emite, NO setAuth, NO re-suscribe: renueva el TCP y reintenta con backoff.
//  · SESSION_EXPIRED  → NO emite, NO toca el socket: deja actuar el deslogueo declarativo (→ /login).
// BLINDAJE anti-clavado (intacto): cada await de auth/socket tiene tope (withTimeout) y el guard se
// descarta por edad (HEALTH_MAX_AGE_MS), así esta función SIEMPRE settlea y healthInFlight SIEMPRE se libera.
export const ensureRealtimeHealthy = (reason: RealtimeHealthReason = 'resume'): Promise<void> => {
  // Guard de concurrencia + cinturón por edad: reusamos el in-flight solo si sigue VIGENTE; si quedó
  // clavado (más viejo que HEALTH_MAX_AGE_MS) lo abandonamos y arrancamos uno nuevo.
  if (healthInFlight && Date.now() - healthStartedAt < HEALTH_MAX_AGE_MS) return healthInFlight
  healthStartedAt = Date.now()
  const myStart = healthStartedAt   // identidad de ESTA corrida (el guard impide dos en el mismo ms)
  const run = (async () => {
    try {
      console.log('[rt-diag] ensureRealtimeHealthy: start reason=', reason)
      // channel-stuck = el hook frenó (5 fallos sin SUBSCRIBED) y llama esperando 'rt:healthy' para
      // re-suscribir → marcamos la espera ya, aunque esta corrida termine en OFFLINE_WAITING.
      if (reason === 'channel-stuck') healthyAwaited = true
      const decision = await classifyRealtime(reason)
      console.log('[rt-diag] ensureRealtimeHealthy: estado=', decision.state)
      if (decision.state === 'ONLINE_SUBSCRIBED') {
        // Token fresco CONFIRMADO: lo propagamos al socket y revivimos el TCP SOLO si cayó. Acá sí miramos
        // isConnected() (ya clasificamos el estado SIN él): solo decide si hace falta el disconnect→connect.
        await supabase.realtime.setAuth(decision.freshToken).catch(() => { /* socket no listo */ })
        if (!supabase.realtime.isConnected()) {
          console.log('[rt-diag] ensureRealtimeHealthy: ONLINE pero socket caído → revive (await disconnect → connect)')
          await withTimeout(
            (async () => { await supabase.realtime.disconnect() })(),
            AUTH_OP_TIMEOUT_MS,
            'realtime.disconnect',
            undefined,
          )
          supabase.realtime.connect()
        }
        cancelResumeRetry()
        // ÚNICA emisión de 'rt:healthy' en todo el módulo: solo con token fresco confirmado Y solo si hay
        // una recuperación pendiente (healthyAwaited). Un 'resume' rutinario sano (arranque/foco) llega acá
        // con healthyAwaited=false → NO emite → el canal inicial se asienta solo (no lo re-suscribimos).
        if (healthyAwaited) {
          console.log('[rt-diag] ensureRealtimeHealthy: ONLINE_SUBSCRIBED → emit rt:healthy (recuperación servida)')
          window.dispatchEvent(new Event('rt:healthy'))
        } else {
          console.log('[rt-diag] ensureRealtimeHealthy: ONLINE_SUBSCRIBED → setAuth, SIN emit (nada que recuperar)')
        }
        healthyAwaited = false   // recuperación servida (o no había nada pendiente)
      } else if (decision.state === 'OFFLINE_WAITING') {
        // Sin token fresco confirmado (red zombi / refresh colgado): NO emitir, NO setAuth con token
        // vencido/null, NO re-suscribir. Renovar el TCP físico (cura validada del path token-timeout) y
        // reintentar con backoff vía 'resume'. NO setAuth(null): tumbaría la auth del socket compartido.
        console.log('[rt-diag] ensureRealtimeHealthy: OFFLINE_WAITING → renuevo TCP (disconnect→connect), sin emit')
        await withTimeout(
          (async () => { await supabase.realtime.disconnect() })(),
          AUTH_OP_TIMEOUT_MS,
          'realtime.disconnect (offline-waiting)',
          undefined,
        )
        supabase.realtime.connect()
        // Quedó una recuperación pendiente: cuando una próxima corrida llegue a ONLINE_SUBSCRIBED con token
        // fresco, ESA emite 'rt:healthy' para que el hook re-suscriba. Acá NO emitimos.
        healthyAwaited = true
        scheduleResumeRetry()
      } else {
        // SESSION_EXPIRED por DOS orígenes, tratados distinto:
        //  (1) refresh.error (forced ≠ true) → gotrue YA limpió la sesión → SOLO deslogueo declarativo;
        //      NO forzamos signOut (evita logout espurio ante hipos transitorios del refresh).
        //  (2) N timeouts de getSession (forced=true, auth wedgeada, ver HANG-RCA-2) → gotrue NO limpió →
        //      forzamos UN signOut LOCAL (one-shot por el latch): dispara onAuthStateChange(session=null) →
        //      useAuth → <Navigate to="/login">; el usuario reingresa y el outbox drena (signOut local NO
        //      toca el IndexedDB del outbox). Sin red no se cuelga (scope:'local' es client-side), idempotente.
        // En ambos: NO emitir, NO re-suscribir, NO disconnect/connect en loop. Cancelamos backoff y espera.
        if (decision.forced === true) {
          void supabase.auth.signOut({ scope: 'local' }).catch(() => { /* ya deslogueado / sin sesión */ })
        }
        console.log('[rt-diag] ensureRealtimeHealthy: SESSION_EXPIRED → deslogueo declarativo, sin emit')
        healthyAwaited = false
        cancelResumeRetry()
      }
    } catch (e) {
      console.warn('[rt-diag] ensureRealtimeHealthy: catch', e)
    } finally {
      // Solo limpiamos si seguimos siendo el in-flight vigente: si el cinturón por edad ya arrancó
      // otra corrida (healthStartedAt cambió), NO le pisamos su referencia (evita que una corrida
      // vieja-y-tardía anule el in-flight de la nueva).
      if (healthStartedAt === myStart) healthInFlight = null
    }
  })()
  healthInFlight = run
  return run
}

// Disparadores globales, registrados UNA sola vez (este módulo es singleton).
if (typeof window !== 'undefined') {
  // worker:true mueve el heartbeat a un Web Worker (no throttleado). `worker` es el flag de
  // config; `workerRef` recién se puebla cuando el socket abre y arranca el worker, así que
  // en load puede estar vacío todavía — se confirma activo en el primer '[rt-diag] heartbeat'.
  console.log('[rt-diag] worker config=', supabase.realtime.worker, 'workerRef ya activo=', !!supabase.realtime.workerRef)
  const onResume = () => {
    console.log('[rt-diag] onResume vis=', document.visibilityState)
    if (document.visibilityState === 'visible') {
      supabase.auth.startAutoRefresh().catch(() => {})
      void ensureRealtimeHealthy()
    } else {
      supabase.auth.stopAutoRefresh().catch(() => {})
    }
  }
  document.addEventListener('visibilitychange', onResume)
  window.addEventListener('online', () => { void ensureRealtimeHealthy() })
  window.addEventListener('focus', () => { void ensureRealtimeHealthy() })
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNÓSTICO SOLO-STAGING (removible de un golpe): switch para reproducir A DEMANDA
// el cuelgue de Realtime tras suspensión, sin suspender la máquina por horas. Todo lo
// de arriba queda BYTE-POR-BYTE intacto. Para REMOVERLO: borrar este bloque + el módulo
// src/shared/diag/realtimeReproSwitch.ts (y su test).
//
// En prod (VITE_APP_ENV != 'staging') Vite reemplaza import.meta.env.VITE_APP_ENV por su
// string literal → este `if` queda en `if (false)` y el bundler lo elimina por DCE junto
// con su import() dinámico → el código de diagnóstico NUNCA corre fuera de staging.
if (import.meta.env.VITE_APP_ENV === 'staging') {
  import('../diag/realtimeReproSwitch')
    .then((m) => m.installRealtimeReproSwitch?.(supabase))
    .catch(() => { /* diagnóstico no crítico */ })
}
