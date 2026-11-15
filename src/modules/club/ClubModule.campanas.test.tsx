// @vitest-environment happy-dom
// 166 · La pestaña Campañas es solo del owner: el manager no la ve (sigue con «A contactar» en Reportes).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const st = vi.hoisted(() => ({ rol: 'owner' }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: st.rol, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('./Escanear', () => ({ default: () => <div>PANTALLA-ESCANEAR</div> }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'p166-a', nombre: 'Local P166 A', activo: true }],
  getClubUrl: async () => null,
}))

import ClubModule from './ClubModule'

describe('ClubModule · Campañas', () => {
  it('el owner ve la pestaña Campañas', async () => {
    st.rol = 'owner'
    render(<MemoryRouter><ClubModule /></MemoryRouter>)
    expect(await screen.findByText('PANTALLA-ESCANEAR')).toBeTruthy()
    expect(screen.getByText('Campañas')).toBeTruthy()
  })
  it('el manager no la ve (sí ve Reportes)', async () => {
    st.rol = 'manager'
    render(<MemoryRouter><ClubModule /></MemoryRouter>)
    expect(await screen.findByText('PANTALLA-ESCANEAR')).toBeTruthy()
    expect(screen.getByText('Reportes')).toBeTruthy()
    expect(screen.queryByText('Campañas')).toBeNull()
  })
})
