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
let lastForcedRefresh = 0
let healthInFlight: Promise<void> | null = null

type RealtimeHealthReason = 'resume' | 'channel-stuck'

const tokenNeedsRefresh = (session: Session | null): boolean => {
  if (!session) return false
  const exp = session.expires_at
  if (!exp) return true
  return exp - Math.floor(Date.now() / 1000) <= EXPIRY_MARGIN_S
}

// reason='resume' (visibilitychange/online/focus): conservador — refresca solo si el token está
// por vencer, revive solo si el socket cayó, emite 'rt:healthy' solo si hubo recuperación real.
// NO recrea canales en cada cambio de pestaña.
// reason='channel-stuck' (el FRENO del hook, 5 fallos sin SUBSCRIBED): evidencia dura de canal
// trabado pese a isConnected()=true (zombi token-vencido). Acá NO alcanza mirar HTTP: forzamos
// refresh+setAuth (gateado por backoff) y SIEMPRE emitimos 'rt:healthy' para que el hook
// re-suscriba con joinPayload fresco. La recuperación real la valida el hook: solo resetea su
// freno cuando el canal llega a SUBSCRIBED (evidencia, no isConnected()).
export const ensureRealtimeHealthy = (reason: RealtimeHealthReason = 'resume'): Promise<void> => {
  if (healthInFlight) return healthInFlight
  healthInFlight = (async () => {
    let recovered = false
    const stuck = reason === 'channel-stuck'
    try {
      console.log('[rt-diag] ensureRealtimeHealthy: start reason=', reason)
      const { data: { session } } = await supabase.auth.getSession()
      let token = session?.access_token ?? null
      const forceRefresh = stuck && (Date.now() - lastForcedRefresh >= FORCED_REFRESH_MIN_INTERVAL_MS)
      if (tokenNeedsRefresh(session) || forceRefresh) {
        lastForcedRefresh = Date.now()
        const { data, error } = await supabase.auth.refreshSession()
        if (!error && data.session) { token = data.session.access_token; recovered = true }
      }
      if (!token) { console.log('[rt-diag] ensureRealtimeHealthy: sin token (deslogueado) → abort'); return }
      await supabase.realtime.setAuth(token).catch(() => { /* socket no listo */ })
      const connected = supabase.realtime.isConnected()
      console.log('[rt-diag] ensureRealtimeHealthy: isConnected=', connected)
      if (!connected) {
        console.log('[rt-diag] ensureRealtimeHealthy: revive socket (await disconnect → connect)')
        await supabase.realtime.disconnect()
        supabase.realtime.connect()
        recovered = true
      }
      // 'channel-stuck': canal roto por evidencia del hook → re-suscribir es la cura (setAuth ya
      // dejó el joinPayload fresco; un JOIN nuevo se autentica bien). Emitimos aunque HTTP/isConnected
      // parezcan sanos: ese es justo el zombi de isConnected()=true.
      if (recovered || stuck) {
        console.log('[rt-diag] ensureRealtimeHealthy: emit rt:healthy (recovered=', recovered, 'stuck=', stuck, ')')
        window.dispatchEvent(new Event('rt:healthy'))
      }
    } catch (e) {
      console.warn('[rt-diag] ensureRealtimeHealthy: catch', e)
    } finally {
      healthInFlight = null
    }
  })()
  return healthInFlight
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
