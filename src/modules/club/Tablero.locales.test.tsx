// @vitest-environment happy-dom
// D16 en Club → Tablero: la base devuelve los locales por id (Nosara antes); el selector muestra Santa Teresa primero,
// la elige por defecto y el tablero se lee de Santa Teresa. Pasa por el `getLocalesClub` real (base simulada).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { tableroDePrueba } from './tableroFixture.test-util'

const st = vi.hoisted(() => ({ leidos: [] as string[], guardado: null as string | null }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => {
  const filas = [
    { location_id: 'nosara', nombre: 'Satori Nosara', club_activo: true },
    { location_id: 'santa-teresa', nombre: 'Satori Santa Teresa', club_activo: true },
  ]
  return { supabase: { from: () => ({ select: () => ({ order: async () => ({ data: filas, error: null }) }) }) } }
})
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  localActual: () => st.guardado,
  getTablero: async (_mes: string, local: string) => { st.leidos.push(local); return tableroDePrueba() },
}))

import Tablero from './Tablero'

beforeEach(() => { st.leidos = []; st.guardado = null })

describe('Club → Tablero · locales (D16)', () => {
  it('sin local recordado: Santa Teresa primera, elegida y leída (nunca Nosara)', async () => {
    render(<Tablero />)
    await screen.findByTestId('titular')
    const sel = screen.getByLabelText('Local') as HTMLSelectElement
    expect([...sel.options].map(o => o.value)).toEqual(['santa-teresa', 'nosara'])
    expect(sel.value).toBe('santa-teresa')
    expect(st.leidos).toEqual(['santa-teresa'])
  })

  it('con un local recordado que ve: lo respeta', async () => {
    st.guardado = 'nosara'
    render(<Tablero />)
    await screen.findByTestId('titular')
    await waitFor(() => expect((screen.getByLabelText('Local') as HTMLSelectElement).value).toBe('nosara'))
    expect(st.leidos).toEqual(['nosara'])
  })
})
