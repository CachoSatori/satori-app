import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock del SDK: getSession y refreshSession NUNCA settlean — simulan la conexión zombi tras
// suspensión profunda (el fetch queda sobre un socket muerto y no vuelve). Sin el blindaje
// (withTimeout + cinturón por edad), ensureRealtimeHealthy colgaría para siempre y este test haría
// timeout. Factory inline: vi.mock se hoistea sobre los imports → no puede referenciar consts del módulo.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* noop */ } } } }),
      getSession: () => new Promise(() => { /* nunca resuelve (zombi) */ }),
      refreshSession: () => new Promise(() => { /* nunca resuelve (zombi) */ }),
      startAutoRefresh: async () => { /* noop */ },
      stopAutoRefresh: async () => { /* noop */ },
    },
    realtime: {
      worker: false,
      workerRef: null,
      setAuth: async () => { /* noop */ },
      isConnected: () => true,
      connect: () => { /* noop */ },
      disconnect: async () => { /* noop */ },
    },
  }),
}))

describe('ensureRealtimeHealthy — blindaje anti-clavado (timeouts)', () => {
  beforeEach(() => {
    // supabase.ts exige las env al importar; se stubean ANTES del import dinámico.
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()
    // Quitamos el window inyectado: si quedara, el próximo import correría el bloque de triggers
    // (document.addEventListener) y document no existe en Node → tiraría al importar.
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('channel-stuck: aunque getSession/refreshSession se cuelguen, RESUELVE, emite rt:healthy y libera el in-flight para otra corrida', async () => {
    // Import con window AÚN ausente → el bloque de triggers (visibility/online/focus) se saltea.
    const { ensureRealtimeHealthy } = await import('./supabase')

    // Recién ahora inyectamos un window con EventTarget real (Node trae EventTarget y Event), para que
    // el emit de rt:healthy del path stuck funcione y podamos observarlo. El módulo resuelve `window`
    // contra globalThis en tiempo de ejecución, así que toma este.
    const rtWindow = new EventTarget()
    Object.defineProperty(globalThis, 'window', { value: rtWindow, configurable: true, writable: true })
    let healthyEvents = 0
    rtWindow.addEventListener('rt:healthy', () => { healthyEvents++ })

    // --- 1ª corrida ---
    let settled = false
    const p1 = ensureRealtimeHealthy('channel-stuck').then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)                    // sigue esperando el getSession colgado (no resolvió temprano)

    // getSession (tope 8s) → sesión nula → fuerza refresh → refreshSession (tope 8s) → nulo → sin token,
    // pero como es 'stuck' emite rt:healthy igual y corta. Avanzamos más allá de los dos topes.
    await vi.advanceTimersByTimeAsync(8_100)       // vence getSession
    await vi.advanceTimersByTimeAsync(8_100)       // vence refreshSession
    await p1
    expect(settled).toBe(true)                     // el blindaje la destrabó (no quedó colgada)
    expect(healthyEvents).toBe(1)                  // stuck emitió rt:healthy pese al token null

    // --- 2ª corrida: el in-flight quedó liberado → vuelve a ejecutar (no quedó bloqueada) ---
    let settled2 = false
    const p2 = ensureRealtimeHealthy('channel-stuck').then(() => { settled2 = true })
    await Promise.resolve()
    expect(settled2).toBe(false)                   // re-ejecuta (queda pendiente), no devolvió un cacheado
    await vi.advanceTimersByTimeAsync(8_100)
    await vi.advanceTimersByTimeAsync(8_100)
    await p2
    expect(settled2).toBe(true)
    expect(healthyEvents).toBe(2)                  // la 2ª corrida también emitió
  })
})
