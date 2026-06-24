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
// si en 10s no se consigue (lock colgado, el caso del RCA), se ejecuta SIN lock
// en vez de colgar la UI — el peor caso vuelve a ser el comportamiento anterior.
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000

const safeNavigatorLock = async <R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
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
const AUTH_OP_TIMEOUT_MS = 8_000
// Cinturón anti-clavado (segunda línea de defensa): edad máxima del in-flight. Si una corrida quedó
// pegada más de esto (p. ej. una op que igual no settleó, o timers congelados durante la suspensión),
// la próxima llamada la IGNORA y arranca una nueva en vez de quedar rehén del guard de concurrencia.
// 40s y no 20s: el peor caso LEGÍTIMO es getSession(8s)+refreshSession(8s)+disconnect(8s) ≈ 24s; con
// 20s el cinturón abandonaría una corrida válida en curso y dispararía una concurrente sobre el socket
// compartido. 40s queda por encima de esos 24s y por debajo del objetivo de recuperación (<60s).
const HEALTH_MAX_AGE_MS = 40_000
let lastForcedRefresh = 0
let healthInFlight: Promise<void> | null = null
let healthStartedAt = 0

type RealtimeHealthReason = 'resume' | 'channel-stuck'

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

// reason='resume' (visibilitychange/online/focus): conservador — refresca solo si el token está
// por vencer, revive solo si el socket cayó, emite 'rt:healthy' solo si hubo recuperación real.
// NO recrea canales en cada cambio de pestaña.
// reason='channel-stuck' (el FRENO del hook, 5 fallos sin SUBSCRIBED): evidencia dura de canal
// trabado pese a isConnected()=true (zombi token-vencido). Acá NO alcanza mirar HTTP: forzamos
// refresh+setAuth (gateado por backoff) y SIEMPRE emitimos 'rt:healthy' para que el hook
// re-suscriba con joinPayload fresco. La recuperación real la valida el hook: solo resetea su
// freno cuando el canal llega a SUBSCRIBED (evidencia, no isConnected()).
// BLINDAJE anti-clavado: cada await de auth/socket tiene tope (withTimeout) y el guard se descarta
// por edad (HEALTH_MAX_AGE_MS), así esta función SIEMPRE settlea en pocos segundos y healthInFlight
// SIEMPRE se libera → los caminos de recuperación vuelven a correr (auto y al volver a primer plano).
export const ensureRealtimeHealthy = (reason: RealtimeHealthReason = 'resume'): Promise<void> => {
  // Guard de concurrencia + cinturón por edad: reusamos el in-flight solo si sigue VIGENTE; si quedó
  // clavado (más viejo que HEALTH_MAX_AGE_MS) lo abandonamos y arrancamos uno nuevo.
  if (healthInFlight && Date.now() - healthStartedAt < HEALTH_MAX_AGE_MS) return healthInFlight
  healthStartedAt = Date.now()
  const myStart = healthStartedAt   // identidad de ESTA corrida (el guard impide dos en el mismo ms)
  const run = (async () => {
    let recovered = false
    const stuck = reason === 'channel-stuck'
    try {
      console.log('[rt-diag] ensureRealtimeHealthy: start reason=', reason)
      // sessionRead distingue "getSession COMPLETÓ" de "expiró por timeout": se marca dentro del .then
      // real (mismo patrón que refreshCompleted). Si el withTimeout cae al fallback (sesión nula),
      // sessionRead queda false → sabemos que el token null vino de la red zombi, no de un deslogueo.
      let sessionRead = false
      const { data: { session } } = await withTimeout(
        supabase.auth.getSession().then((r) => { sessionRead = true; return r }),
        AUTH_OP_TIMEOUT_MS,
        'getSession',
        { data: { session: null }, error: null },
      )
      let token = session?.access_token ?? null
      const forceRefresh = stuck && (Date.now() - lastForcedRefresh >= FORCED_REFRESH_MIN_INTERVAL_MS)
      if (tokenNeedsRefresh(session) || forceRefresh) {
        // El gate (lastForcedRefresh) se consume SOLO si el refresh COMPLETÓ (resolvió, con éxito o
        // error real), NO si expiró por timeout: así un cuelgue se reintenta pronto en vez de quemar
        // la ventana de 30s sobre un refresh que nunca volvió.
        let refreshCompleted = false
        const refresh = await withTimeout(
          supabase.auth.refreshSession().then((r) => { refreshCompleted = true; return r }),
          AUTH_OP_TIMEOUT_MS,
          'refreshSession',
          { data: { session: null, user: null }, error: null },
        )
        if (refreshCompleted) lastForcedRefresh = Date.now()
        if (!refresh.error && refresh.data.session) { token = refresh.data.session.access_token; recovered = true }
      }
      if (!token) {
        if (!sessionRead) {
          // getSession EXPIRÓ por timeout (red zombi tras suspensión) → token null NO es deslogueo. La
          // cura validada es revivir la conexión física: disconnect→connect fuerza un socket TCP nuevo
          // sobre red sana, y el onAuthStateChange global re-propaga el token fresco al reconectar → el
          // canal vuelve a SUBSCRIBED. Lo hacemos en AMBOS reason. NO setAuth(null): no tenemos token y
          // tumbaría la auth del socket compartido.
          console.log('[rt-diag] ensureRealtimeHealthy: getSession timeout → renuevo conexión (disconnect→connect)')
          await withTimeout(
            (async () => { await supabase.realtime.disconnect() })(),
            AUTH_OP_TIMEOUT_MS,
            'realtime.disconnect (token-timeout)',
            undefined,
          )
          supabase.realtime.connect()
          if (stuck) {
            // stuck: el hook está frenado esperando el evento → lo emitimos para que re-suscriba.
            console.log('[rt-diag] ensureRealtimeHealthy: token timeout + stuck → emit rt:healthy')
            window.dispatchEvent(new Event('rt:healthy'))
          }
          // resume: NO emitimos — el reconnect + el onAuthStateChange disparan la re-suscripción solos.
          return
        }
        // sessionRead === true: getSession COMPLETÓ y confirmó que NO hay sesión = deslogueo real. No hay
        // nada que reconectar. Comportamiento de siempre: stuck emite igual (el hook sigue reintentando;
        // autoRefresh/onAuthStateChange repondrán el token), resume aborta.
        if (stuck) {
          console.log('[rt-diag] ensureRealtimeHealthy: sin token (deslogueado real) → emit rt:healthy igual (stuck)')
          window.dispatchEvent(new Event('rt:healthy'))
        } else {
          console.log('[rt-diag] ensureRealtimeHealthy: sin token (deslogueado real) → abort')
        }
        return
      }
      await supabase.realtime.setAuth(token).catch(() => { /* socket no listo */ })
      const connected = supabase.realtime.isConnected()
      console.log('[rt-diag] ensureRealtimeHealthy: isConnected=', connected)
      if (!connected) {
        console.log('[rt-diag] ensureRealtimeHealthy: revive socket (await disconnect → connect)')
        await withTimeout(
          (async () => { await supabase.realtime.disconnect() })(),
          AUTH_OP_TIMEOUT_MS,
          'realtime.disconnect',
          undefined,
        )
        supabase.realtime.connect()
        recovered = true
      }
      // 'channel-stuck': canal roto por evidencia del hook → re-suscribir es la cura (setAuth ya
      // dejó el joinPayload fresco; un JOIN nuevo se autentica bien). Emitimos aunque HTTP/isConnected
      // parezcan sanos: ese es justo el zombi de isConnected()=true. Vale incluso si el refresh expiró
      // por timeout: mientras haya algún token (de getSession o del refresh), llegamos hasta acá.
      if (recovered || stuck) {
        console.log('[rt-diag] ensureRealtimeHealthy: emit rt:healthy (recovered=', recovered, 'stuck=', stuck, ')')
        window.dispatchEvent(new Event('rt:healthy'))
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
