import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fix de la PANTALLA NEGRA (splash 祭 eterno) tras suspensión LARGA — DOS caminos:
//  (A) el bootstrap llamaba supabase.auth.getSession() SIN tope; si nunca settlea (socket zombi),
//      el .finally(setLoading(false)) jamás corre → loading=true para siempre.
//  (B) aunque getSession vuelva rápido con sesión cacheada, loadProfile (SELECT a profiles) tampoco
//      tenía tope; si se cuelga, el await DENTRO del .then nunca resuelve → loading=true igual.
// Fix: ambos van envueltos en withTimeout (resuelve con fallback al vencer, NO rechaza); loadProfile
// además reintenta 1 vez y, si vuelve a vencer, deja profile en null. Y PrivateRoute manda a /login
// cuando profile=null (no renderiza el módulo a ciegas).
//
// El repo NO tiene React Testing Library ni DOM env (tests en node; ver supabase.timeout.test.ts).
// Por eso NO se renderiza el AuthProvider: se ejercita el PIPELINE EXACTO del bootstrap
// (useAuth.tsx:36-58: withTimeout(getSession).then(setUser; await loadProfile).finally(loading=false),
// con loadProfile = withTimeout(SELECT)+1 reintento) con el mismo patrón de mock + fake timers.
// El caso físico (loading→/login en la app real) lo valida Cacho.

type SessionLike = { access_token: string; expires_at: number; user: { id: string } }
type GetSessionResult =
  | { data: { session: SessionLike }; error: null }
  | { data: { session: null }; error: null }
type ProfileResult = { data: { id: string } | null; error: { message: string } | null }

const mock = vi.hoisted(() => {
  const hang = <T>(): Promise<T> => new Promise<T>(() => { /* nunca settlea (socket zombi) */ })
  return {
    hang,
    getSession: hang as () => Promise<GetSessionResult>,
    profileQuery: hang as () => Promise<ProfileResult>,
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
    // Builder mínimo para supabase.from('profiles').select('*').eq('id', …).single() → mock.profileQuery()
    from: () => ({ select: () => ({ eq: () => ({ single: () => mock.profileQuery() }) }) }),
    realtime: {
      worker: false, workerRef: null,
      setAuth: async () => { /* noop */ }, isConnected: () => true,
      connect: () => { /* noop */ }, disconnect: async () => { /* noop */ },
    },
  }),
}))

// Replica EXACTA del pipeline del bootstrap de useAuth (useAuth.tsx:25-58), sin React (no hay RTL):
//  loadProfile = withTimeout(SELECT, …, {data:null}) + 1 reintento → profile o null.
//  bootstrap   = withTimeout(getSession, …, {session:null}).then(setUser; await loadProfile).finally(loading=false).
async function runBootstrap() {
  const { supabase, withTimeout, AUTH_OP_TIMEOUT_MS } = await import('../api/supabase')
  let loading = true
  let user: { id: string } | null | undefined = undefined
  let profile: { id: string } | null = null   // espeja useState<Profile|null>(null) de useAuth

  const loadProfile = async (userId: string) => {
    const fetchProfile = () => {
      const q = supabase.from('profiles').select('*').eq('id', userId).single()
      return withTimeout(
        Promise.resolve(q),
        AUTH_OP_TIMEOUT_MS,
        'loadProfile (bootstrap)',
        { data: null, error: null } as unknown as Awaited<typeof q>,
      )
    }
    let { data, error } = await fetchProfile()
    if (!data && !error) ({ data, error } = await fetchProfile())
    if (error) return
    if (!data) return
    profile = data as { id: string }
  }

  const p = withTimeout(
    supabase.auth.getSession(),
    AUTH_OP_TIMEOUT_MS,
    'getSession (bootstrap useAuth)',
    { data: { session: null }, error: null },
  )
    .then(async ({ data: { session } }) => {
      user = session?.user ?? null
      if (session?.user) await loadProfile(session.user.id)
    })
    .finally(() => { loading = false })
  return { p, get: () => ({ loading, user, profile }), AUTH_OP_TIMEOUT_MS }
}

describe('useAuth bootstrap — getSession + loadProfile con tope (fix pantalla negra tras suspensión)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.useFakeTimers()
    mock.getSession = mock.hang as () => Promise<GetSessionResult>
    mock.profileQuery = mock.hang as () => Promise<ProfileResult>
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('(A) getSession NUNCA settlea → al vencer el tope, loading=false y user=null (dispara /login)', async () => {
    const { p, get, AUTH_OP_TIMEOUT_MS } = await runBootstrap()
    await Promise.resolve()
    expect(get().loading).toBe(true)                 // antes del tope: splash, pero acotado
    await vi.advanceTimersByTimeAsync(AUTH_OP_TIMEOUT_MS + 100)
    await p
    expect(get().loading).toBe(false)
    expect(get().user).toBe(null)
  })

  it('(B) getSession OK + loadProfile NUNCA settlea → loading=false y profile=null (NO renderiza módulo → /login)', async () => {
    mock.getSession = () => Promise.resolve({
      data: { session: { access_token: 't', expires_at: 9_999_999_999, user: { id: 'u1' } } }, error: null,
    })
    // profileQuery queda colgado (default hang) → withTimeout vence 2 veces (intento + reintento).
    const { p, get, AUTH_OP_TIMEOUT_MS } = await runBootstrap()
    await vi.advanceTimersByTimeAsync(AUTH_OP_TIMEOUT_MS * 2 + 300)
    await p
    expect(get().loading).toBe(false)               // NO splash eterno
    expect(get().user).toEqual({ id: 'u1' })         // hubo sesión
    expect(get().profile).toBe(null)                 // perfil no cargó → PrivateRoute → /login
  })

  it('camino feliz — getSession + loadProfile OK → user y profile seteados, loading false', async () => {
    mock.getSession = () => Promise.resolve({
      data: { session: { access_token: 't', expires_at: 9_999_999_999, user: { id: 'u1' } } }, error: null,
    })
    mock.profileQuery = () => Promise.resolve({ data: { id: 'u1' }, error: null })
    const { p, get } = await runBootstrap()
    await p
    expect(get().loading).toBe(false)
    expect(get().user).toEqual({ id: 'u1' })
    expect(get().profile).toEqual({ id: 'u1' })
  })

  it('camino feliz — getSession SIN sesión → user null, sin loadProfile, loading false', async () => {
    mock.getSession = () => Promise.resolve({ data: { session: null }, error: null })
    const { p, get } = await runBootstrap()
    await p
    expect(get().loading).toBe(false)
    expect(get().user).toBe(null)
    expect(get().profile).toBe(null)                // nunca se llamó loadProfile → queda en null (useState inicial)
  })

  it('loadProfile reintenta 1 vez: 1er intento vence, 2º resuelve → profile seteado', async () => {
    mock.getSession = () => Promise.resolve({
      data: { session: { access_token: 't', expires_at: 9_999_999_999, user: { id: 'u1' } } }, error: null,
    })
    let calls = 0
    mock.profileQuery = () => {
      calls++
      return calls === 1 ? mock.hang<ProfileResult>() : Promise.resolve({ data: { id: 'u1' }, error: null })
    }
    const { p, get, AUTH_OP_TIMEOUT_MS } = await runBootstrap()
    await vi.advanceTimersByTimeAsync(AUTH_OP_TIMEOUT_MS + 100)   // vence el 1er intento → reintenta
    await p
    expect(calls).toBe(2)
    expect(get().loading).toBe(false)
    expect(get().profile).toEqual({ id: 'u1' })
  })
})
