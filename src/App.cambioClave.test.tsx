// @vitest-environment happy-dom
// Cambio de contraseña OBLIGATORIO (mig 185), enrutado real de la app (App + AuthProvider + CambioClaveProvider) con el
// SDK de Supabase mockeado. Si la base dice que el usuario tiene que cambiar la contraseña:
//   · cualquier ruta → /mi-cuenta, con el aviso arriba y sin «Cancelar» (sí «Cerrar sesión»);
//   · después de cambiarla con éxito se vuelve a consultar y se libera;
//   · sin conexión NO bloquea (la caja offline sigue) y exige al reconectar;
//   · si la consulta falla, no bloquea.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'

const mock = vi.hoisted(() => ({
  role: 'cajero' as string,
  /** Respuestas de seguridad_debo_cambiar_clave, en orden (la última se repite). 'error' = la base falla. */
  debe: [true] as (boolean | 'error' | 'colgada')[],
  llamadas: 0,
  /** Si está, la consulta queda colgada hasta que se llame. */
  soltar: null as null | (() => void),
  tablas: [] as string[],
  signIn: vi.fn(), update: vi.fn(), signOut: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => {
  const session = { access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'u1@ejemplo.test', app_metadata: {} } }
  // Cadena genérica para las consultas de las pantallas: cualquier método devuelve la cadena; al esperar, sin datos.
  const cadena = (tabla?: string): unknown => new Proxy(function () { /* noop */ }, {
    get(_t, prop) {
      if (prop === 'then') {
        return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok)
      }
      if (prop === 'single' || prop === 'maybeSingle') {
        return async () => tabla === 'profiles'
          ? { data: { id: 'u1', full_name: 'Persona Ficticia', email: 'u1@ejemplo.test', role: mock.role, is_active: true }, error: null }
          : { data: null, error: null }
      }
      return () => cadena(tabla)
    },
    apply() { return cadena(tabla) },
  })
  return {
    createClient: () => ({
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* noop */ } } } }),
        getSession: async () => ({ data: { session }, error: null }),
        refreshSession: async () => ({ data: { session, user: session.user }, error: null }),
        signInWithPassword: mock.signIn,
        updateUser: mock.update,
        signOut: mock.signOut,
        startAutoRefresh: async () => { /* noop */ },
        stopAutoRefresh: async () => { /* noop */ },
      },
      from: (t: string) => { mock.tablas.push(t); return cadena(t) },
      rpc: (fn: string) => {
        if (fn !== 'seguridad_debo_cambiar_clave') return cadena()
        const r = mock.debe[Math.min(mock.llamadas, mock.debe.length - 1)]
        mock.llamadas++
        if (mock.soltar === null && r === 'colgada') {
          return new Promise(res => { mock.soltar = () => res({ data: true, error: null }) })
        }
        return Promise.resolve(r === 'error' ? { data: null, error: { code: '42883', message: 'no existe' } } : { data: r, error: null })
      },
      channel: () => cadena(), removeChannel: async () => 'ok', removeAllChannels: async () => [],
      functions: { invoke: async () => ({ data: null, error: null }) },
      storage: { from: () => cadena() },
      realtime: {
        worker: false, workerRef: null,
        setAuth: async () => { /* noop */ }, isConnected: () => true,
        connect: () => { /* noop */ }, disconnect: async () => { /* noop */ },
      },
    }),
  }
})

const enLinea = (v: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, value: v })

async function montar(ruta: string) {
  window.history.replaceState({}, '', ruta)
  const { default: App } = await import('./App')
  render(<App />)
}

describe('App · cambio de contraseña obligatorio (mig 185)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubEnv('BASE_URL', '/')
    mock.role = 'cajero'; mock.debe = [true]; mock.llamadas = 0; mock.soltar = null; mock.tablas = []
    mock.signIn.mockReset().mockResolvedValue({ data: {}, error: null })
    mock.update.mockReset().mockResolvedValue({ data: {}, error: null })
    mock.signOut.mockReset().mockResolvedValue({ error: null })
    enLinea(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('marcado: desde la caja va a /mi-cuenta con el aviso; sin «Cancelar», con «Cerrar sesión»', async () => {
    await montar('/caja')
    await waitFor(() => expect(window.location.pathname).toBe('/mi-cuenta'))
    expect((await screen.findByTestId('aviso-cambio-obligatorio')).textContent)
      .toBe('Por seguridad tenés que cambiar tu contraseña antes de seguir.')
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
    // (el menú de la app también tiene «Cerrar sesión»: este es el del formulario)
    const form = screen.getByLabelText('Contraseña actual').closest('form') as HTMLElement
    fireEvent.click(within(form).getByRole('button', { name: 'Cerrar sesión' }))
    await waitFor(() => expect(mock.signOut).toHaveBeenCalled())
  })

  it('mientras corre la primera consulta no se abre la Caja (ni un instante): espera y después redirige', async () => {
    mock.debe = ['colgada']
    await montar('/caja')
    await waitFor(() => expect(mock.llamadas).toBe(1))
    // tiempo de sobra para que la Caja (módulo diferido) cargue y consulte si se renderizara: sin la espera, lo hace
    await new Promise(r => setTimeout(r, 1500))
    expect(mock.tablas.filter(t => t.startsWith('cash_'))).toEqual([])
    expect(window.location.pathname).toBe('/caja')
    await act(async () => { mock.soltar?.() })
    await waitFor(() => expect(window.location.pathname).toBe('/mi-cuenta'))
    expect(mock.tablas.filter(t => t.startsWith('cash_'))).toEqual([])
  })

  it('marcado owner: Admin también redirige a /mi-cuenta', async () => {
    mock.role = 'owner'
    await montar('/admin')
    await waitFor(() => expect(window.location.pathname).toBe('/mi-cuenta'))
  })

  it('después de cambiarla con éxito vuelve a consultar y libera: «Volver al inicio» sale de /mi-cuenta', async () => {
    mock.debe = [true, false]
    await montar('/')
    await screen.findByTestId('aviso-cambio-obligatorio')
    fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: 'vieja-clave-1' } })
    fireEvent.change(screen.getByLabelText('Contraseña nueva (mínimo 8)'), { target: { value: 'Tortuga-verde7' } })
    fireEvent.change(screen.getByLabelText('Repetir contraseña nueva'), { target: { value: 'Tortuga-verde7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Listo: tu contraseña cambió.'))
    expect(mock.llamadas).toBe(2)
    expect(screen.queryByTestId('aviso-cambio-obligatorio')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Volver al inicio' }))
    // el inicio del cajero lo manda a su pantalla (Caja); lo que importa: no rebota a /mi-cuenta
    await waitFor(() => expect(window.location.pathname).not.toBe('/mi-cuenta'))
    await new Promise(r => setTimeout(r, 50))
    expect(window.location.pathname).not.toBe('/mi-cuenta')
  })

  it('sin conexión NO bloquea (ni consulta); al reconectar consulta y exige', async () => {
    enLinea(false)
    await montar('/caja')
    await new Promise(r => setTimeout(r, 50))
    expect(window.location.pathname).toBe('/caja')
    expect(mock.llamadas).toBe(0)
    enLinea(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(window.location.pathname).toBe('/mi-cuenta'))
    expect(mock.llamadas).toBe(1)
  })

  it('si la conexión se corta estando marcado, deja usar la app (la caja offline no se traba)', async () => {
    await montar('/caja')
    await waitFor(() => expect(window.location.pathname).toBe('/mi-cuenta'))
    enLinea(false)
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    window.history.pushState({}, '', '/caja')
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    await new Promise(r => setTimeout(r, 50))
    expect(window.location.pathname).toBe('/caja')
  })

  it('marcado y en modo recuperación (entró con el enlace del correo): /mi-cuenta NO pide la actual y libera', async () => {
    mock.debe = [true, false]
    // lo que deja el evento PASSWORD_RECOVERY de supabase-js para este usuario (ver recuperarClave.ts)
    sessionStorage.setItem('satori-recuperacion', JSON.stringify({ uid: 'u1', hasta: Date.now() + 60_000 }))
    try {
      await montar('/caja')
      await waitFor(() => expect(window.location.pathname).toBe('/mi-cuenta'))
      await screen.findByTestId('aviso-recuperacion')
      expect(screen.queryByTestId('aviso-cambio-obligatorio')).toBeNull()
      expect(screen.queryByLabelText('Contraseña actual')).toBeNull()
      fireEvent.change(screen.getByLabelText('Contraseña nueva (mínimo 8)'), { target: { value: 'Tortuga-verde7' } })
      fireEvent.change(screen.getByLabelText('Repetir contraseña nueva'), { target: { value: 'Tortuga-verde7' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Listo: tu contraseña cambió.'))
      expect(mock.signIn).not.toHaveBeenCalled()
      expect(mock.update).toHaveBeenCalledWith({ password: 'Tortuga-verde7' })
      expect(mock.llamadas).toBe(2)   // volvió a consultar seguridad_debo_cambiar_clave()
      expect(sessionStorage.getItem('satori-recuperacion')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Volver al inicio' }))
      await waitFor(() => expect(window.location.pathname).not.toBe('/mi-cuenta'))
    } finally {
      sessionStorage.clear()
    }
  })

  it('no marcado: no redirige', async () => {
    mock.debe = [false]
    await montar('/caja')
    await waitFor(() => expect(mock.llamadas).toBe(1))
    await new Promise(r => setTimeout(r, 50))
    expect(window.location.pathname).toBe('/caja')
  })

  it('la consulta falla (p. ej. la función no existe): no bloquea', async () => {
    mock.debe = ['error']
    await montar('/caja')
    await waitFor(() => expect(mock.llamadas).toBe(1))
    await new Promise(r => setTimeout(r, 50))
    expect(window.location.pathname).toBe('/caja')
  })
})
