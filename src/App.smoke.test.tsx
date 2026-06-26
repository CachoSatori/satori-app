// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Smoke del enrutado que ANTES era invisible por falta de DOM en los tests (corrían en Node, sin
// render real). Reproduce la condición del bug del loop `/`↔`/login`: hay SESIÓN (user) pero el
// PERFIL no carga (loadProfile → null). Entonces:
//   · PrivateRoute('/')   → user && !profile → <Navigate to="/login">
//   · PublicRoute('/login')→ debe mostrar el LoginPage (NO rebotar a '/').
// El fix `8bed794` hizo que PublicRoute exija user&&profile; si se rompiera y volviera a rebotar,
// PrivateRoute↔PublicRoute entran en loop → React tira "Maximum update depth exceeded" y/o el
// login nunca aparece → este test FALLA. Así el loop deja de ser invisible.

type SessionLike = { access_token: string; expires_at: number; user: { id: string } }

const mock = vi.hoisted(() => ({
  // sesión presente (user) — pero el perfil se resuelve a null (abajo) → condición exacta del loop.
  session: {
    access_token: 'tok',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'u1' },
  } as SessionLike,
}))

// Mismo enfoque que useAuth.bootstrap.test.ts: se mockea el SDK, no la lógica de la app.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* noop */ } } } }),
      getSession: async () => ({ data: { session: mock.session }, error: null }),
      refreshSession: async () => ({ data: { session: mock.session, user: mock.session.user }, error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
      signUp: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      startAutoRefresh: async () => { /* noop */ },
      stopAutoRefresh: async () => { /* noop */ },
    },
    // profiles…single() → perfil NULL sin error → useAuth deja profile=null → dispara el redirect.
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
    realtime: {
      worker: false, workerRef: null,
      setAuth: async () => { /* noop */ }, isConnected: () => true,
      connect: () => { /* noop */ }, disconnect: async () => { /* noop */ },
    },
  }),
}))

describe('App routing smoke (DOM) — sesión sin perfil NO entra en loop /↔/login', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubEnv('BASE_URL', '/')                 // basename '' → la URL raíz de happy-dom matchea las rutas
    window.history.replaceState({}, '', '/')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('monta en / con sesión + perfil-nulo y aterriza en /login (sin loop)', async () => {
    const { default: App } = await import('./App')
    render(<App />)

    // El LoginPage real (servido por PublicRoute) muestra el toggle "Crear cuenta".
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear cuenta' })).toBeTruthy())

    // Confirmación dura del NO-loop: quedó estable en /login (PublicRoute no rebotó a '/').
    expect(window.location.pathname).toBe('/login')
  })
})
