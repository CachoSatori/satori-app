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
let healthInFlight: Promise<void> | null = null

const tokenNeedsRefresh = (session: Session | null): boolean => {
  if (!session) return false
  const exp = session.expires_at
  if (!exp) return true
  return exp - Math.floor(Date.now() / 1000) <= EXPIRY_MARGIN_S
}

// Recuperación de sesión + socket al volver de background. Single-flight: N disparos
// concurrentes (varios hooks + useAuth) colapsan en UNA operación → no apila el candado
// de auth ni martilla el endpoint de token. Fuerza refreshSession() (getSession NO
// refresca un token vencido), propaga el token fresco al socket, y revive el WebSocket
// si quedó caído. Solo emite 'rt:healthy' si hubo recuperación real (refresh o revive),
// para no recrear canales en cada cambio de pestaña.
export const ensureRealtimeHealthy = (): Promise<void> => {
  if (healthInFlight) return healthInFlight
  healthInFlight = (async () => {
    let recovered = false
    try {
      const { data: { session } } = await supabase.auth.getSession()
      let token = session?.access_token ?? null
      if (tokenNeedsRefresh(session)) {
        const { data, error } = await supabase.auth.refreshSession()
        if (!error && data.session) { token = data.session.access_token; recovered = true }
      }
      if (!token) return            // deslogueado: nada que revivir
      await supabase.realtime.setAuth(token).catch(() => { /* socket no listo */ })
      if (!supabase.realtime.isConnected()) {
        supabase.realtime.disconnect()
        supabase.realtime.connect()
        recovered = true
      }
      if (recovered) window.dispatchEvent(new Event('rt:healthy'))
    } catch (e) {
      console.warn('[rt] ensureRealtimeHealthy falló', e)
    } finally {
      healthInFlight = null
    }
  })()
  return healthInFlight
}

// Disparadores globales, registrados UNA sola vez (este módulo es singleton).
if (typeof window !== 'undefined') {
  const onResume = () => {
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
