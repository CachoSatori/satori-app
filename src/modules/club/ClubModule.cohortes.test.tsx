// @vitest-environment happy-dom
// Club (mig 161): las pestañas Cohortes y Ranking son de owner y manager; el cajero no las ve (solo «Escanear»).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const st = vi.hoisted(() => ({ rol: 'owner' }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: st.rol, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('./Escanear', () => ({ default: () => <div>escanear</div> }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'p161-a', nombre: 'Local P161 A', activo: true }],
  getClubUrl: async () => null,
}))

import ClubModule from './ClubModule'

beforeEach(() => { st.rol = 'owner' })

describe('Club → pestañas Cohortes y Ranking', () => {
  it.each(['owner', 'manager'])('%s ve Cohortes y Ranking', async rol => {
    st.rol = rol
    render(<MemoryRouter><ClubModule /></MemoryRouter>)
    expect(await screen.findByText('Cohortes')).toBeTruthy()
    expect(screen.getByText('Ranking')).toBeTruthy()
  })
  it('cajero: ni Cohortes ni Ranking', async () => {
    st.rol = 'cajero'
    render(<MemoryRouter><ClubModule /></MemoryRouter>)
    await screen.findByText('escanear')
    expect(screen.queryByText('Cohortes')).toBeNull()
    expect(screen.queryByText('Ranking')).toBeNull()
  })
})
