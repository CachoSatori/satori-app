// FASE A — caché de lectura (offline-first).
// Estrategia: red primero (datos frescos, caché actualizado); si no hay red o la
// lectura falla, se sirve el caché de IndexedDB al instante → ningún módulo queda
// vacío sin conexión. El refresh de fondo lo aportan los mecanismos existentes
// (useRealtimeRefetch + refetch al volver el foco), que al reconectar recargan y
// por lo tanto re-escriben este caché. Detalle de diseño en OFFLINE.md.
import { idbGet, idbPut, STORES } from './idb'

const READ_TIMEOUT_MS = 8_000

interface CacheEntry<T> { data: T; ts: number }

// Registro de staleness para el indicador "Sin conexión — datos de las HH:MM".
let oldestStaleTs: number | null = null
function markStale(ts: number) {
  if (oldestStaleTs === null || ts < oldestStaleTs) oldestStaleTs = ts
  window.dispatchEvent(new CustomEvent('satori:stale-data', { detail: { ts: oldestStaleTs } }))
}
export function clearStale() {
  if (oldestStaleTs === null) return
  oldestStaleTs = null
  window.dispatchEvent(new CustomEvent('satori:stale-data', { detail: { ts: null } }))
}
export const getStaleTs = () => oldestStaleTs

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** Lectura con caché: red (timeout 8s) → éxito: actualiza caché y limpia staleness;
 *  fallo/sin red: sirve caché si existe (marcando staleness) o re-lanza el error. */
export async function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (!isOffline()) {
    try {
      const data = await Promise.race([
        fetcher(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout de red')), READ_TIMEOUT_MS)),
      ])
      idbPut(STORES.cache, { data, ts: Date.now() } satisfies CacheEntry<T>, key).catch(() => { /* caché es best-effort */ })
      clearStale()
      return data
    } catch (e) {
      const hit = await idbGet<CacheEntry<T>>(STORES.cache, key).catch(() => undefined)
      if (hit) { markStale(hit.ts); return hit.data }
      throw e
    }
  }
  const hit = await idbGet<CacheEntry<T>>(STORES.cache, key).catch(() => undefined)
  if (hit) { markStale(hit.ts); return hit.data }
  throw new Error('Sin conexión y sin datos guardados de esta pantalla todavía.')
}
