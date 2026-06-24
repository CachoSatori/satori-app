import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Tests de la MÁQUINA DE 3 ESTADOS de ensureRealtimeHealthy. Regla madre: NUNCA emitir 'rt:healthy' sin
// un token válido FRESCO CONFIRMADO; ningún camino termina en loop. Cubrimos los tres estados:
//   · ZOMBI  (getSession/refreshSession se cuelgan)           → OFFLINE_WAITING → 0 emisiones, renueva TCP.
//   · EXPIRED (getSession→null / refresh→AuthError)            → SESSION_EXPIRED → 0 emisiones, no re-suscribe.
//   · ONLINE  (token fresco vía getSession o refreshSession)   → ONLINE_SUBSCRIBED → 1 emisión.
// + single-flight / liberación del in-flight (blindaje anti-clavado, intacto).

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
const mock = vi.hoisted(() => {
  const hang = <T>(): Promise<T> => new Promise<T>(() => { /* nunca settlea (zombi) */ })
  return {
    hang,
    calls: { connect: 0, disconnect: 0 },
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
      setAuth: async () => { /* noop */ },
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

describe('ensureRealtimeHealthy — máquina de 3 estados', () => {
  beforeEach(() => {
    // supabase.ts exige las env al importar; se stubean ANTES del import dinámico.
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.useFakeTimers()
    // Estado por defecto: zombi (ambas auth-ops cuelgan), socket "conectado".
    mock.calls.connect = 0
    mock.calls.disconnect = 0
    mock.isConnected = true
    mock.getSession = mock.hang as () => Promise<GetSessionResult>
    mock.refreshSession = mock.hang as () => Promise<RefreshSessionResult>
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()
    // Quitamos el window inyectado: si quedara, el próximo import correría el bloque de triggers
    // (document.addEventListener) y document no existe en Node → tiraría al importar.
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('ZOMBI (getSession/refreshSession cuelgan, channel-stuck): RESUELVE, NO emite, renueva el socket y libera el in-flight para una 2ª corrida', async () => {
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    // --- 1ª corrida ---
    let settled = false
    const p1 = ensureRealtimeHealthy('channel-stuck').then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)                    // sigue esperando el getSession colgado (no resolvió temprano)

    // getSession (tope 8s) expira → sessionRead=false → OFFLINE_WAITING (NO llega a refreshSession).
    await vi.advanceTimersByTimeAsync(8_100)       // vence getSession
    await p1
    expect(settled).toBe(true)                     // el blindaje la destrabó (no quedó colgada)
    expect(healthyEvents()).toBe(0)                // OFFLINE_WAITING NO emite (antes el bug emitía: ESA era la causa del loop)
    expect(mock.calls.disconnect).toBeGreaterThanOrEqual(1)  // intentó renovar el TCP
    expect(mock.calls.connect).toBeGreaterThanOrEqual(1)

    // --- 2ª corrida: el in-flight quedó liberado → vuelve a ejecutar (no quedó bloqueada) ---
    let settled2 = false
    const p2 = ensureRealtimeHealthy('channel-stuck').then(() => { settled2 = true })
    await Promise.resolve()
    expect(settled2).toBe(false)                   // re-ejecuta (queda pendiente), no devolvió un cacheado
    await vi.advanceTimersByTimeAsync(8_100)
    await p2
    expect(settled2).toBe(true)
    expect(healthyEvents()).toBe(0)                // sigue sin emitir: nunca hubo token fresco
  })

  it('EXPIRED — getSession COMPLETA con session=null: SESSION_EXPIRED, NO emite, NO re-suscribe', async () => {
    // armExpired del switch de diag parchea AMBOS, pero con getSession→null la clasificación corta en
    // SESSION_EXPIRED sin llegar a refreshSession (ese error queda como red de seguridad, no se ejercita).
    mock.getSession = () => Promise.resolve({ data: { session: null }, error: null })
    mock.refreshSession = () => Promise.resolve({ data: { session: null, user: null }, error: authError })
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    await ensureRealtimeHealthy('resume')
    expect(healthyEvents()).toBe(0)                // deslogueo real → el deslogueo declarativo lleva a /login
    expect(mock.calls.disconnect).toBe(0)          // NO toca el socket
    expect(mock.calls.connect).toBe(0)
  })

  it('EXPIRED — refreshSession COMPLETA con AuthError: SESSION_EXPIRED, NO emite, NO re-suscribe', async () => {
    // getSession trae una sesión por-vencer (fuerza el refresh) y el refresh falla con error de auth real.
    mock.getSession = () => Promise.resolve({ data: { session: sessionExpiringIn(10) }, error: null })
    mock.refreshSession = () => Promise.resolve({ data: { session: null, user: null }, error: authError })
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    await ensureRealtimeHealthy('resume')
    expect(healthyEvents()).toBe(0)
    expect(mock.calls.disconnect).toBe(0)
    expect(mock.calls.connect).toBe(0)
  })

  it('OFFLINE — refreshSession se cuelga: OFFLINE_WAITING, NO emite, renueva el socket', async () => {
    // getSession completa (token por-vencer) → fuerza refresh → refresh se cuelga (red zombi) → OFFLINE_WAITING.
    mock.getSession = () => Promise.resolve({ data: { session: sessionExpiringIn(10) }, error: null })
    mock.refreshSession = mock.hang as () => Promise<RefreshSessionResult>
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    const p = ensureRealtimeHealthy('resume')
    await vi.advanceTimersByTimeAsync(8_100)       // vence refreshSession
    await p
    expect(healthyEvents()).toBe(0)                // refresh sin token fresco → NO emite
    expect(mock.calls.disconnect).toBeGreaterThanOrEqual(1)  // renovó el TCP
    expect(mock.calls.connect).toBeGreaterThanOrEqual(1)
  })

  it('ONLINE — getSession trae token fresco no vencido: ONLINE_SUBSCRIBED, emite EXACTAMENTE 1 vez', async () => {
    mock.getSession = () => Promise.resolve({ data: { session: sessionExpiringIn(3_600) }, error: null })
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    await ensureRealtimeHealthy('resume')
    expect(healthyEvents()).toBe(1)                // ÚNICA emisión: token fresco confirmado
  })

  it('ONLINE — refreshSession trae token fresco: ONLINE_SUBSCRIBED, emite EXACTAMENTE 1 vez', async () => {
    // getSession trae token por-vencer (fuerza refresh) y el refresh resuelve con una sesión nueva fresca.
    mock.getSession = () => Promise.resolve({ data: { session: sessionExpiringIn(10) }, error: null })
    mock.refreshSession = () => Promise.resolve({ data: { session: sessionExpiringIn(3_600), user: null }, error: null })
    const { ensureRealtimeHealthy, healthyEvents } = await loadModule()

    await ensureRealtimeHealthy('channel-stuck')
    expect(healthyEvents()).toBe(1)
  })

  it('single-flight: dos llamadas concurrentes comparten el mismo in-flight (no arranca dos corridas)', async () => {
    // getSession cuelga (default zombi): la 1ª corrida queda in-flight; la 2ª, dentro de la edad máxima,
    // devuelve la MISMA promesa en vez de arrancar otra (guard de concurrencia, blindaje intacto).
    const { ensureRealtimeHealthy } = await loadModule()
    const a = ensureRealtimeHealthy('resume')
    const b = ensureRealtimeHealthy('resume')
    expect(b).toBe(a)
    await vi.advanceTimersByTimeAsync(8_100)       // destraba ambas (OFFLINE_WAITING)
    await a
  })
})
