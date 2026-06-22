import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase.gen'

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

// Revivir el SOCKET de Realtime (Round 2). El round 1 (setAuth de arriba) curó el JWT vencido,
// pero tras un sleep largo (~5h) o una caída de red el WebSocket EN SÍ muere con un cierre sucio
// (1006). El SDK marca los canales como "errored" y reintenta el rejoin sobre un socket muerto en
// loop (CHANNEL_ERROR → TIMED_OUT → CLOSED, sin fin): recrear el canal NO alcanza porque el problema
// es el transporte. Hay que revivir el socket COMPARTIDO una sola vez, a nivel global (el socket de
// Realtime es único para toda la app; si cada hook intentara revivirlo se pelearían). Al reconectar,
// phoenix re-une solo los canales "errored" sobre el socket sano (onConnOpen → channel.rejoin()).
// Se dispara al volver el foco (visibilitychange→visible) y al recuperar la red (online), que es
// justo cuando el socket muerto en background necesita resucitar. disconnect() devuelve una Promise
// (la ignoramos con .catch; nunca rechaza) y deja closeWasClean=true para que el auto-reconnect de
// phoenix no pelee con nuestro connect() inmediato.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const reviveSocket = () => {
    if (!supabase.realtime.isConnected()) {
      supabase.realtime.disconnect().catch(() => { /* nunca rechaza; teardown del socket muerto */ })
      supabase.realtime.connect()
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reviveSocket()
  })
  window.addEventListener('online', reviveSocket)
}
