// @vitest-environment happy-dom
//
// Mi Rendimiento · «Ver como» (firmado por el dueño, 2026-10-29).
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

const PIPO  = emp('e-pipo',  'PIPO',  'manager')
const MARCOS = emp('e-marcos', 'MARCOS', 'barman')

const montar = (url: string) => render(
  <MemoryRouter initialEntries={[url]}><MiRendimientoWrap /></MemoryRouter>,
)
const texto = () => (document.body.textContent ?? '').replace(/\s/g, ' ')

beforeEach(() => {
  H.getAllEmployees.mockReset().mockResolvedValue([PIPO, MARCOS])
  H.getEmployeeByProfileId.mockReset()
})

describe('MiRendimiento · «Ver como» solo para owner', () => {
  it('un MANAGER con ?empleado= NO puede ver a otro: carga lo suyo y no hay selector', async () => {
    H.profile = { id: 'p-pipo', full_name: 'Paula', role: 'manager' }
    H.getEmployeeByProfileId.mockResolvedValue(PIPO)
    montar('/mi-rendimiento?empleado=e-marcos')
    await waitFor(() => expect(H.getEmployeeByProfileId).toHaveBeenCalledWith('p-pipo'))
    expect(H.getAllEmployees).not.toHaveBeenCalled()          // ni siquiera se lee la lista
    // Su propia vista: el encabezado es SU perfil (Paula), y nada de MARCOS.
    await waitFor(() => expect(texto()).toContain('Satori · Paula'))
    expect(texto()).not.toContain('MARCOS')
    expect(texto()).not.toContain('Ver como')
    expect(texto()).not.toContain('solo lectura')
  })

  it('un SALONERO con ?empleado= tampoco', async () => {
    H.profile = { id: 'p-marcos', full_name: 'Marcos', role: 'salonero' }
    H.getEmployeeByProfileId.mockResolvedValue(MARCOS)
    montar('/mi-rendimiento?empleado=e-pipo')
    await waitFor(() => expect(H.getEmployeeByProfileId).toHaveBeenCalledWith('p-marcos'))
    expect(H.getAllEmployees).not.toHaveBeenCalled()
    expect(texto()).not.toContain('Ver como')
  })

  it('el OWNER con ?empleado= ve a ese empleado, rotulado «solo lectura», con el selector', async () => {
    H.profile = { id: 'p-owner', full_name: 'Dueño Demo', role: 'owner' }
    montar('/mi-rendimiento?empleado=e-marcos')
    await waitFor(() => expect(texto()).toContain('Viendo como MARCOS · solo lectura'))
    expect(H.getAllEmployees).toHaveBeenCalled()
    expect(H.getEmployeeByProfileId).not.toHaveBeenCalled()  // no carga su propio perfil
    expect(texto()).toContain('Ver como')
  })

  it('el OWNER sin ?empleado= ve su propio perfil y el selector para elegir', async () => {
    H.profile = { id: 'p-owner', full_name: 'Dueño Demo', role: 'owner' }
    H.getEmployeeByProfileId.mockResolvedValue(null)
    montar('/mi-rendimiento')
    await waitFor(() => expect(texto()).toContain('Ver como'))
    expect(H.getEmployeeByProfileId).toHaveBeenCalledWith('p-owner')
    expect(texto()).not.toContain('solo lectura')
  })
})
