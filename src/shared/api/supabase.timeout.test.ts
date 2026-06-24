import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Tests de la MÁQUINA DE 3 ESTADOS de ensureRealtimeHealthy con los dos fixes de gating:
//  FIX 1 — ONLINE_SUBSCRIBED emite 'rt:healthy' SOLO si hay una recuperación pendiente (healthyAwaited):
//          un 'resume' rutinario sano (arranque/foco) NO emite → el canal inicial se asienta solo.
//  FIX 2 — SESSION_EXPIRED solo se alcanza por refresh.error (getSession→null transitorio del arranque ya
//          NO es deslogueo; lo arbitra el refresh).
// Regla madre intacta: nunca emitir sin token fresco confirmado; ningún camino en loop.

// Formas ESTRUCTURALES (sin `any` ni casts) de los resultados de auth, mismo patrón que el switch de diag:
// ensureRealtimeHealthy solo mira session.access_token / session.expires_at y la verdad de `error`.
type AuthErrorLike = { name: string; message: string; status?: number; code?: string }
type SessionLike = { access_token: string; expires_at: number }
type GetSessionResult =
  | { data: { session: SessionLike }; error: null }
  | { data: { session: null }; error: null }
type RefreshSessionResult =
  | { data: { session: SessionLike | null; user: null }; error: null }
  | { data: { session: null; user: null }; error: AuthErrorLike }

// Controlador del mock, hoisteado para que la factory de vi.mock (que se eleva sobre los imports) lo
// capture. Cada test reescribe getSession/refreshSession para fijar el estado a ejercitar. `hang` vive
// adentro: vi.hoisted se eleva sobre cualquier const del módulo, así que no puede referenciar externos.
// calls.setAuth distingue ONLINE_SUBSCRIBED (única rama que hace setAuth) de OFFLINE/EXPIRED — útil para
// observar que se llegó a ONLINE incluso cuando la emisión queda gateada (healthyAwaited=false).
const mock = vi.hoisted(() => {
  const hang = <T>(): Promise<T> => new Promise<T>(() => { /* nunca settlea (zombi) */ })
  return {
    hang,
    calls: { connect: 0, disconnect: 0, setAuth: 0 },
    isConnected: true,
    getSession: hang as () => Promise<GetSessionResult>,
    refreshSession: hang as () => Promise<RefreshSessionResult>,
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* noop */ } } } }),
      getSession: () => mock.getSession(),
      refreshSession: () => mock.refreshSession(),
      startAutoRefresh: async () => { /* noop */ },
      stopAutoRefresh: async () => { /* noop */ },
    },
    realtime: {
      worker: false,
      workerRef: null,
      setAuth: async () => { mock.calls.setAuth++ },
      isConnected: () => mock.isConnected,
      connect: () => { mock.calls.connect++ },
      disconnect: async () => { mock.calls.disconnect++ },
    },
  }),
}))

// Sesión con vencimiento relativo: secs grande (>EXPIRY_MARGIN 60s) = token fresco; secs chico = "por vencer".
const sessionExpiringIn = (secs: number): SessionLike => ({
  access_token: `tok-${secs}`,
  expires_at: Math.floor(Date.now() / 1000) + secs,
})
const freshSession = (): GetSessionResult => ({ data: { session: sessionExpiringIn(3_600) }, error: null })
const freshRefresh = (): RefreshSessionResult => ({ data: { session: sessionExpiringIn(3_600), user: null }, error: null })
const authError: AuthErrorLike = { name: 'AuthApiError', message: 'session expired', status: 401, code: 'session_expired' }

// Importa supabase.ts con window AÚN ausente (el bloque de triggers se saltea), luego inyecta un window con
// EventTarget real para observar 'rt:healthy'. Devuelve la función y un contador de emisiones.
async function loadModule(): Promise<{ ensureRealtimeHealthy: (r?: 'resume' | 'channel-stuck') => Promise<void>; healthyEvents: () => number }> {
  const mod = await import('./supabase')
  const rtWindow = new EventTarget()
  Object.defineProperty(globalThis, 'window', { value: rtWindow, configurable: true, writable: true })
  let count = 0
  rtWindow.addEventListener('rt:healthy', () => { count++ })
  return { ensureRealtimeHealthy: mod.ensureRealtimeHealthy, healthyEvents: () => count }
}

describe('ensureRealtimeHealthy — máquina de 3 estados + gating de la emisión', () => {
  beforeEach(() => {
    // supabase.ts exige las env al importar; se stubean ANTES del import dinámico.
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.useFakeTimers()
    // Estado por defecto: zombi (ambas auth-ops cuelgan), socket "conectado".
    mock.calls.connect = 0
    mock.calls.disconnect = 0
    mock.calls.setAuth = 0
    mock.isConnected = true
    mock.getSession = mock.hang as () => Promise<GetSessionResult>
    mock.refreshSession = mock.hang as () => Promise<RefreshSessionResult>
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()   // aísla el estado de módulo (healthyAwaited, backoff…) entre tests
    // Quitamos el window inyectado: si quedara, el próximo import correría el bloque de triggers
    // (document.addEventListener) y document no existe en Node → tiraría al importar.
    Reflect.deleteProperty(globalThis, 'window')
  })

  // FIX 1 — el caso del arranque/foco: 'resume' sano SIN recuperación pendiente NO debe emitir.
  it('resume rutinario sano (sin recuperación pendiente): ONLINE_SUBSCRIBED pero NO emite', async () => {
    mock.getSession = () => Promise.resolve(freshSession())
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    await ensureRealtimeHealthy('resume')
    expect(mock.calls.setAuth).toBeGreaterThanOrEqual(1)   // llegó a ONLINE_SUBSCRIBED (setAuth con token fresco)
    expect(healthyEvents()).toBe(0)                        // pero healthyAwaited=false → NO emite (canal inicial se asienta solo)
  })

  // FIX 1 — el hook frenó (channel-stuck) y espera el evento: ONLINE_SUBSCRIBED SÍ emite.
  it('channel-stuck → ONLINE_SUBSCRIBED: emite EXACTAMENTE 1 vez', async () => {
    // channel-stuck fuerza el refresh (gate abierto en módulo fresco): el token fresco llega por refresh.
    mock.getSession = () => Promise.resolve(freshSession())
    mock.refreshSession = () => Promise.resolve(freshRefresh())
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    await ensureRealtimeHealthy('channel-stuck')
    expect(healthyEvents()).toBe(1)
  })

  // FIX 1 — OFFLINE_WAITING marca la espera; una corrida posterior ONLINE la sirve y emite.
  it('OFFLINE_WAITING marca la espera y luego un resume ONLINE emite (mismo import, sin reset)', async () => {
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()   // getSession cuelga (default zombi)

    // 1ª corrida: red zombi → OFFLINE_WAITING (healthyAwaited=true), NO emite.
    const p1 = ensureRealtimeHealthy('resume')
    await vi.advanceTimersByTimeAsync(8_100)   // vence getSession
    await p1
    expect(healthyEvents()).toBe(0)

    // 2ª corrida (mismo módulo → healthyAwaited persiste true): token fresco → ONLINE → emite.
    mock.getSession = () => Promise.resolve(freshSession())
    await ensureRealtimeHealthy('resume')
    expect(healthyEvents()).toBe(1)            // pasó de 0 a 1: la recuperación pendiente se sirvió
  })

  // FIX 2 — getSession→null transitorio del arranque + refresh con token → ONLINE (no falso expired).
  it('getSession→null + refresh trae token fresco: ONLINE_SUBSCRIBED (NO SESSION_EXPIRED)', async () => {
    mock.getSession = () => Promise.resolve({ data: { session: null }, error: null })
    mock.refreshSession = () => Promise.resolve(freshRefresh())
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    await ensureRealtimeHealthy('resume')
    expect(mock.calls.setAuth).toBeGreaterThanOrEqual(1)   // llegó a ONLINE (el refresh resolvió el null transitorio)
    expect(mock.calls.disconnect).toBe(0)                  // NO fue SESSION_EXPIRED ni OFFLINE
    expect(healthyEvents()).toBe(0)                        // resume sin espera pendiente → gateado
  })

  // FIX 2 — el ÚNICO camino a SESSION_EXPIRED: getSession→null + refresh con AuthError.
  it('getSession→null + refresh→AuthError: SESSION_EXPIRED, sin emit, sin tocar el socket', async () => {
    mock.getSession = () => Promise.resolve({ data: { session: null }, error: null })
    mock.refreshSession = () => Promise.resolve({ data: { session: null, user: null }, error: authError })
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    await ensureRealtimeHealthy('resume')
    expect(healthyEvents()).toBe(0)
    expect(mock.calls.setAuth).toBe(0)         // SESSION_EXPIRED → NO setAuth
    expect(mock.calls.disconnect).toBe(0)      // NO toca el socket
    expect(mock.calls.connect).toBe(0)
  })

  // Mantenido — zombi puro: RESUELVE (no se cuelga), 0 emit, renueva el socket y libera el in-flight.
  it('zombi puro (getSession/refresh cuelgan, channel-stuck): OFFLINE_WAITING, 0 emit, libera el in-flight', async () => {
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    let settled = false
    const p1 = ensureRealtimeHealthy('channel-stuck').then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)                // sigue esperando el getSession colgado (no resolvió temprano)

    await vi.advanceTimersByTimeAsync(8_100)   // vence getSession → OFFLINE_WAITING (no llega a refreshSession)
    await p1
    expect(settled).toBe(true)                 // el blindaje la destrabó
    expect(healthyEvents()).toBe(0)            // OFFLINE_WAITING NO emite
    expect(mock.calls.disconnect).toBeGreaterThanOrEqual(1)   // intentó renovar el TCP
    expect(mock.calls.connect).toBeGreaterThanOrEqual(1)

    // 2ª corrida: el in-flight quedó liberado → vuelve a ejecutar.
    let settled2 = false
    const p2 = ensureRealtimeHealthy('channel-stuck').then(() => { settled2 = true })
    await Promise.resolve()
    expect(settled2).toBe(false)
    await vi.advanceTimersByTimeAsync(8_100)
    await p2
    expect(settled2).toBe(true)
    expect(healthyEvents()).toBe(0)            // sigue sin emitir: nunca hubo token fresco
  })

  // Mantenido — single-flight: dos llamadas concurrentes comparten el mismo in-flight.
  it('single-flight: dos llamadas concurrentes comparten el mismo in-flight (no arranca dos corridas)', async () => {
    const { ensureRealtimeHealthy } = await loadModule()   // getSession cuelga (default zombi)
    const a = ensureRealtimeHealthy('resume')
    const b = ensureRealtimeHealthy('resume')
    expect(b).toBe(a)
    await vi.advanceTimersByTimeAsync(8_100)   // destraba ambas (OFFLINE_WAITING)
    await a
  })
})
