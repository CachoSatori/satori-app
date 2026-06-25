import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fix de la PANTALLA NEGRA (splash 祭 eterno) tras suspensión LARGA de la máquina.
// El bootstrap de useAuth (useAuth.tsx:36) llamaba supabase.auth.getSession() SIN tope; si tras
// suspensión ese fetch queda sobre el socket zombi y NUNCA settlea, el `.finally(setLoading(false))`
// jamás corre → loading=true para siempre → splash eterno (RequireAuth lo muestra mientras loading).
// El fix lo envuelve en withTimeout, que NO rechaza: RESUELVE con sesión nula al vencer → user=null →
// loading=false → redirect a /login.
//
// El repo NO tiene React Testing Library ni DOM env (los tests corren en node; ver
// supabase.timeout.test.ts, que mockea @supabase/supabase-js y usa fake timers). Por eso acá NO se
// renderiza el AuthProvider: se ejercita el PIPELINE EXACTO del bootstrap (useAuth.tsx:36-48) —
// withTimeout(getSession,…,{session:null}).then(setUser).finally(setLoading(false)) — con el mismo
// patrón de mock + fake timers. El caso físico (loading→/login en la app) lo valida Cacho.

type SessionLike = { access_token: string; expires_at: number; user: { id: string } }
type GetSessionResult =
  | { data: { session: SessionLike }; error: null }
  | { data: { session: null }; error: null }

const mock = vi.hoisted(() => {
  const hang = <T>(): Promise<T> => new Promise<T>(() => { /* nunca settlea (socket zombi) */ })
  return {
    hang,
    getSession: hang as () => Promise<GetSessionResult>,
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* noop */ } } } }),
      getSession: () => mock.getSession(),
      refreshSession: () => mock.hang(),
      startAutoRefresh: async () => { /* noop */ },
      stopAutoRefresh: async () => { /* noop */ },
      signOut: async () => ({ error: null }),
    },
    realtime: {
      worker: false, workerRef: null,
      setAuth: async () => { /* noop */ }, isConnected: () => true,
      connect: () => { /* noop */ }, disconnect: async () => { /* noop */ },
    },
  }),
}))

// Replica EXACTA del pipeline del bootstrap de useAuth (useAuth.tsx:36-48), sin React (no hay RTL):
// withTimeout(getSession, AUTH_OP_TIMEOUT_MS, …, {session:null}).then(setUser).finally(loading=false).
async function runBootstrap() {
  const { supabase, withTimeout, AUTH_OP_TIMEOUT_MS } = await import('../api/supabase')
  let loading = true
  let user: { id: string } | null | undefined = undefined
  const p = withTimeout(
    supabase.auth.getSession(),
    AUTH_OP_TIMEOUT_MS,
    'getSession (bootstrap useAuth)',
    { data: { session: null }, error: null },
  )
    .then(({ data: { session } }) => { user = session?.user ?? null })
    .finally(() => { loading = false })
  return { p, get: () => ({ loading, user }), AUTH_OP_TIMEOUT_MS }
}

describe('useAuth bootstrap — getSession con tope (fix pantalla negra tras suspensión)', () => {
  beforeEach(() => {
    // supabase.ts exige las env al importar; se stubean ANTES del import dinámico.
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.useFakeTimers()
    mock.getSession = mock.hang as () => Promise<GetSessionResult>
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('getSession NUNCA settlea → al vencer el tope, loading=false y user=null (dispara /login)', async () => {
    const { p, get, AUTH_OP_TIMEOUT_MS } = await runBootstrap()
    // Antes del tope: sigue cargando (no resolvió temprano) → splash, pero acotado.
    await Promise.resolve()
    expect(get().loading).toBe(true)
    // Pasado el tope: withTimeout resuelve con sesión nula → user null, loading false.
    await vi.advanceTimersByTimeAsync(AUTH_OP_TIMEOUT_MS + 100)
    await p
    expect(get().loading).toBe(false)
    expect(get().user).toBe(null)
  })

  it('camino feliz — getSession resuelve CON sesión → user seteado, loading false', async () => {
    mock.getSession = () => Promise.resolve({
      data: { session: { access_token: 't', expires_at: 9_999_999_999, user: { id: 'u1' } } },
      error: null,
    })
    const { p, get } = await runBootstrap()
    await p
    expect(get().loading).toBe(false)
    expect(get().user).toEqual({ id: 'u1' })
  })

  it('camino feliz — getSession resuelve SIN sesión → user null, loading false', async () => {
    mock.getSession = () => Promise.resolve({ data: { session: null }, error: null })
    const { p, get } = await runBootstrap()
    await p
    expect(get().loading).toBe(false)
    expect(get().user).toBe(null)
  })
})
