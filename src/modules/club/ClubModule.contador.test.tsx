// @vitest-environment happy-dom
// Fase 1B (mig 160): el contador entra a /club y ve SOLO el Tablero (totales). Nada de Escanear, Miembros ni nombres.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { tableroDePrueba } from './tableroFixture.test-util'

const st = vi.hoisted(() => ({ rol: 'contador' }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: st.rol, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('./Escanear', () => ({ default: () => <div>PANTALLA-ESCANEAR</div> }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'p160-a', nombre: 'Local P160 A', activo: true }],
  getClubUrl: async () => null,
  getTablero: async () => tableroDePrueba(),
}))

import ClubModule from './ClubModule'

describe('ClubModule · contador', () => {
  it('abre en el Tablero, sin pestañas ni Escanear', async () => {
    st.rol = 'contador'
    render(<MemoryRouter><ClubModule /></MemoryRouter>)
    expect(await screen.findByTestId('titular')).toBeTruthy()
    expect(screen.queryByText('PANTALLA-ESCANEAR')).toBeNull()
    expect(screen.queryByText('Miembros')).toBeNull()
    expect(screen.queryByText('Escanear')).toBeNull()
  })
  it('el manager ve la pestaña Tablero junto a las demás (abre en Escanear)', async () => {
    st.rol = 'manager'
    render(<MemoryRouter><ClubModule /></MemoryRouter>)
    expect(await screen.findByText('PANTALLA-ESCANEAR')).toBeTruthy()
    expect(screen.getByText('Tablero')).toBeTruthy()
  })
})
