// @vitest-environment happy-dom
//
// Mi Rendimiento · «Ver como» (firmado por Ismael, 2026-10-29).
//   · OWNER: puede elegir a otro empleado (`?empleado=<id>`), en solo lectura.
//   · MANAGER (y cualquier otro rol): ve SOLO su propio rendimiento. El parámetro se IGNORA, no se
//     cargan los demás empleados y no hay selector.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const H = vi.hoisted(() => ({
  profile: null as null | { id: string; full_name: string; role: string },
  getAllEmployees: vi.fn(),
  getEmployeeByProfileId: vi.fn(),
}))

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: H.profile, loading: false }) }))
vi.mock('../../shared/api/ventas', () => ({
  getVentasDias: vi.fn(async () => ({})),
  getProductMap: vi.fn(async () => ({})),
  getMetas: vi.fn(async () => ({ restaurante: {}, margen: {}, global: { promPax: 15000, bebPax: 1.2, ratioCB: 3, ticketItem: 7500, ventas: 800000 }, salMetas: {} })),
  getComps: vi.fn(async () => []),
}))
vi.mock('../../shared/api/tips', () => ({ getAttendanceHistory: vi.fn(async () => []) }))
vi.mock('../../shared/api/admin', () => ({
  getAllEmployees: H.getAllEmployees,
  getEmployeeByProfileId: H.getEmployeeByProfileId,
}))

import MiRendimientoWrap from './MiRendimientoWrap'

const emp = (id: string, full_name: string, role: string, is_active = true) =>
  ({ id, full_name, role, is_active, profile_id: null, pos_name: null, pos_login: null, created_at: '', updated_at: '' })

const PECHE  = emp('e-peche',  'PECHE',  'manager')
const FRANCO = emp('e-franco', 'FRANCO', 'barman')

const montar = (url: string) => render(
  <MemoryRouter initialEntries={[url]}><MiRendimientoWrap /></MemoryRouter>,
)
const texto = () => (document.body.textContent ?? '').replace(/\s/g, ' ')

beforeEach(() => {
  H.getAllEmployees.mockReset().mockResolvedValue([PECHE, FRANCO])
  H.getEmployeeByProfileId.mockReset()
})

describe('MiRendimiento · «Ver como» solo para owner', () => {
  it('un MANAGER con ?empleado= NO puede ver a otro: carga lo suyo y no hay selector', async () => {
    H.profile = { id: 'p-peche', full_name: 'Inés', role: 'manager' }
    H.getEmployeeByProfileId.mockResolvedValue(PECHE)
    montar('/mi-rendimiento?empleado=e-franco')
    await waitFor(() => expect(H.getEmployeeByProfileId).toHaveBeenCalledWith('p-peche'))
    expect(H.getAllEmployees).not.toHaveBeenCalled()          // ni siquiera se lee la lista
    // Su propia vista: el encabezado es SU perfil (Inés), y nada de FRANCO.
    await waitFor(() => expect(texto()).toContain('Satori · Inés'))
    expect(texto()).not.toContain('FRANCO')
    expect(texto()).not.toContain('Ver como')
    expect(texto()).not.toContain('solo lectura')
  })

  it('un SALONERO con ?empleado= tampoco', async () => {
    H.profile = { id: 'p-franco', full_name: 'Franco', role: 'salonero' }
    H.getEmployeeByProfileId.mockResolvedValue(FRANCO)
    montar('/mi-rendimiento?empleado=e-peche')
    await waitFor(() => expect(H.getEmployeeByProfileId).toHaveBeenCalledWith('p-franco'))
    expect(H.getAllEmployees).not.toHaveBeenCalled()
    expect(texto()).not.toContain('Ver como')
  })

  it('el OWNER con ?empleado= ve a ese empleado, rotulado «solo lectura», con el selector', async () => {
    H.profile = { id: 'p-owner', full_name: 'Ismael', role: 'owner' }
    montar('/mi-rendimiento?empleado=e-franco')
    await waitFor(() => expect(texto()).toContain('Viendo como FRANCO · solo lectura'))
    expect(H.getAllEmployees).toHaveBeenCalled()
    expect(H.getEmployeeByProfileId).not.toHaveBeenCalled()  // no carga su propio perfil
    expect(texto()).toContain('Ver como')
  })

  it('el OWNER sin ?empleado= ve su propio perfil y el selector para elegir', async () => {
    H.profile = { id: 'p-owner', full_name: 'Ismael', role: 'owner' }
    H.getEmployeeByProfileId.mockResolvedValue(null)
    montar('/mi-rendimiento')
    await waitFor(() => expect(texto()).toContain('Ver como'))
    expect(H.getEmployeeByProfileId).toHaveBeenCalledWith('p-owner')
    expect(texto()).not.toContain('solo lectura')
  })
})
