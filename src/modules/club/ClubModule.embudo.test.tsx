// @vitest-environment happy-dom
// Club (mig 162): la pestaña Embudo es de owner y manager; el cajero no la ve (solo «Escanear»).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const st = vi.hoisted(() => ({ rol: 'owner' }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: st.rol, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('./Escanear', () => ({ default: () => <div>escanear</div> }))
// Desde la 160 (#179) el contador abre directo en «Tablero».
vi.mock('./Tablero', () => ({ default: () => <div>tablero</div> }))
vi.mock('../../shared/api/club', async orig => ({
  ...(await orig<typeof import('../../shared/api/club')>()),
  getLocalesClub: async () => [{ id: 'p162-a', nombre: 'Local P162 A', activo: true }],
  getClubUrl: async () => null,
}))

import ClubModule from './ClubModule'

beforeEach(() => { st.rol = 'owner' })

describe('Club → pestaña Embudo', () => {
  it.each(['owner', 'manager'])('%s ve Embudo', async rol => {
    st.rol = rol
    render(<MemoryRouter><ClubModule /></MemoryRouter>)
    expect(await screen.findByText('Embudo')).toBeTruthy()
  })
  it.each(['cajero', 'contador', 'salonero'])('%s no ve Embudo', async rol => {
    st.rol = rol
    render(<MemoryRouter><ClubModule /></MemoryRouter>)
    await screen.findByText(rol === 'contador' ? 'tablero' : 'escanear')
    expect(screen.queryByText('Embudo')).toBeNull()
  })
})
