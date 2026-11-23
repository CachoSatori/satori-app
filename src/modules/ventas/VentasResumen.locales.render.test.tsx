// @vitest-environment happy-dom
//
// D16 en Ventas → Resumen: la base devuelve los locales con Nosara antes (orden por id); la barra los muestra con
// Santa Teresa primero, la elige por defecto y lee ESE local. Si la URL trae otro local que el usuario ve, se respeta.
// Pasa por el `getLocalesVentas` real (solo la base está simulada). Datos ficticios.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const st = vi.hoisted(() => ({ role: 'owner', mios: [] as string[] }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role: st.role } }) }))
vi.mock('../../shared/api/supabase', () => ({
  supabase: {
    // Como la base: activos de `locations`, en orden de id (nosara < santa-teresa).
    from: () => ({ select: () => ({ eq: async () => ({ data: [
      { id: 'nosara', name: 'Satori Nosara' }, { id: 'santa-teresa', name: 'Satori Santa Teresa' },
    ], error: null }) }) }),
    rpc: async () => ({ data: st.mios, error: null }),
  },
}))

import { datos } from './resumenV2.fixture'
import { armarLectura } from './resumenV2'
const fx = datos('2026-09-01', 78)
const cargar = vi.fn(async (_local: string) => armarLectura(fx.tickets, fx.lineas, {}))
vi.mock('./resumenV2Datos', async orig => ({
  ...(await orig<typeof import('./resumenV2Datos')>()),
  cargarLecturaResumen: (local: string) => cargar(local),
  cargarLecturaRango: async () => armarLectura(fx.tickets, fx.lineas, {}),
}))

import VentasResumen from './VentasResumen'

const abrir = (url: string) => render(<MemoryRouter initialEntries={[url]}><VentasResumen /></MemoryRouter>)
const opciones = () => [...(screen.getByLabelText('Local') as HTMLSelectElement).options].map(o => o.textContent)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T05:30:00Z'))
  st.role = 'owner'; st.mios = []
  cargar.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Ventas → Resumen · locales (D16)', () => {
  it('Santa Teresa primera en el selector, elegida por defecto, y se lee Santa Teresa', async () => {
    abrir('/ventas?tab=resumen&p=mes&d=2026-10-01')
    await waitFor(() => expect(opciones()).toEqual(['Satori Santa Teresa', 'Satori Nosara']))
    expect((screen.getByLabelText('Local') as HTMLSelectElement).value).toBe('santa-teresa')
    expect(cargar.mock.calls.map(c => c[0])).not.toContain('nosara')
    expect(cargar.mock.calls.map(c => c[0])).toContain('santa-teresa')
  })

  it('lo que el usuario ya eligió (URL) se respeta', async () => {
    abrir('/ventas?tab=resumen&p=mes&d=2026-10-01&local=nosara')
    await waitFor(() => expect(opciones()).toEqual(['Satori Santa Teresa', 'Satori Nosara']))
    expect((screen.getByLabelText('Local') as HTMLSelectElement).value).toBe('nosara')
    await waitFor(() => expect(cargar.mock.calls.at(-1)?.[0]).toBe('nosara'))
  })

  it('manager solo de otro local (mis_locales): no hay selector y se lee el suyo', async () => {
    st.role = 'manager'; st.mios = ['nosara']
    abrir('/ventas?tab=resumen&p=mes&d=2026-10-01')
    await waitFor(() => expect(cargar.mock.calls.at(-1)?.[0]).toBe('nosara'))
    expect(screen.queryByLabelText('Local')).toBeNull()
  })
})
