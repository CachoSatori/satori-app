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
