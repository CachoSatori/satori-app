// @vitest-environment happy-dom
// D2 (14-nov) · Admin → Empleados: «Login del PoS» (solo owner; la base lo exige con club_employees_pos_login_guardia)
// y aviso «Login del PoS 041 sin empleado: asignar» con los logins de los últimos 14 días (pos_prompax_agregado, mig 080).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { Employee } from '../../shared/types/database'
import { loginsSinEmpleado, rangoLogins } from './loginsPosSinEmpleado'

const rol = vi.hoisted(() => ({ v: 'owner' }))
const api = vi.hoisted(() => ({
  updateEmployee: vi.fn(), createEmployee: vi.fn(), toggleEmployeeActive: vi.fn(), linkProfileToEmployee: vi.fn(),
  getAllProfiles: vi.fn(async () => []),
}))
const pos = vi.hoisted(() => ({ getPromPaxAgregado: vi.fn() }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: rol.v, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/admin', () => api)
vi.mock('../../shared/api/posNdf', () => pos)
vi.mock('../../shared/api/ventas', () => ({ getVentasDias: async () => [] }))

import EmployeeList from './EmployeeList'

const emp = (id: string, full_name: string, pos_login: string | null, is_active = true) =>
  ({ id, full_name, role: 'salonero', profile_id: null, is_active, pos_name: null, pos_login, created_at: '', updated_at: '' }) as Employee
const EMPS = [emp('e1', 'ANA PRUEBA', '034'), emp('e2', 'BETO PRUEBA', null), emp('e3', 'VIEJO PRUEBA', '099', false)]
const fila = (salonero_login: string | null, tickets: number, dia = '2026-11-10') =>
  ({ dia, franja: 'noche' as const, salonero_login, canal: 'salon', tickets, pax: 0, neta: 0, neta_sin_pax: 0, tickets_sin_pax: 0 })

describe('loginsSinEmpleado', () => {
  it('saca los asignados (también de inactivos), los null y los vacíos; suma por login; más facturas primero', () => {
    const r = loginsSinEmpleado([fila('034', 9), fila('041', 2, '2026-11-08'), fila('041', 3, '2026-11-12'), fila(null, 50),
                                 fila(' ', 1), fila('099', 4), fila('050', 7)], EMPS)
    expect(r).toEqual([{ login: '050', facturas: 7, ultimoDia: '2026-11-10' }, { login: '041', facturas: 5, ultimoDia: '2026-11-12' }])
  })
  it('14 días contados en CR, hoy incluido', () => {
    expect(rangoLogins('2026-11-14')).toEqual({ desde: '2026-11-01', hasta: '2026-11-14' })
    expect(rangoLogins('2026-03-05')).toEqual({ desde: '2026-02-20', hasta: '2026-03-05' })
  })
})

describe('EmployeeList · Login del PoS', () => {
  beforeEach(() => {
    cleanup()
    rol.v = 'owner'
    for (const f of Object.values(api)) f.mockClear()
    api.updateEmployee.mockReset().mockResolvedValue(undefined)
    api.createEmployee.mockReset().mockResolvedValue(emp('e9', 'NUEVO', '041'))
    pos.getPromPaxAgregado.mockReset().mockImplementation(async (local: string) => local === 'santa-teresa' ? [fila('041', 6), fila('034', 3)] : [])
  })

  it('owner: ve el aviso del login sin empleado (14 días, todos los locales) y no el del que ya tiene empleado', async () => {
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    expect(await screen.findByText('Login del PoS 041 sin empleado: asignar')).toBeTruthy()
    expect(screen.queryByText(/Login del PoS 034 sin empleado/)).toBeNull()
    expect(pos.getPromPaxAgregado).toHaveBeenCalledWith('santa-teresa', expect.any(String), expect.any(String))
    expect(pos.getPromPaxAgregado).toHaveBeenCalledWith('nosara', expect.any(String), expect.any(String))
  })

  it('owner: «Asignar» → elegir empleado abre Editar con el login precargado y guarda pos_login', async () => {
    const onRefresh = vi.fn(async () => {})
    render(<EmployeeList employees={EMPS} onRefresh={onRefresh} />)
    await screen.findByText('Login del PoS 041 sin empleado: asignar')
    fireEvent.click(screen.getByText('Asignar'))
    fireEvent.change(screen.getByLabelText('Asignar 041 a un empleado'), { target: { value: 'e2' } })
    const input = screen.getByLabelText('Login del PoS') as HTMLInputElement
    expect(input.value).toBe('041')
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledWith('e2', expect.objectContaining({ pos_login: '041' })))
  })

  it('owner: «+ Empleado nuevo» abre Agregar con el login precargado y lo manda al crear', async () => {
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    await screen.findByText('Login del PoS 041 sin empleado: asignar')
    fireEvent.click(screen.getByText('Asignar'))
    fireEvent.click(screen.getByText('+ Empleado nuevo'))
    expect((screen.getByLabelText('Login del PoS (opcional)') as HTMLInputElement).value).toBe('041')
    fireEvent.change(screen.getByPlaceholderText('Ej: DOLORES'), { target: { value: 'Nuevo Prueba' } })
    fireEvent.submit(screen.getByPlaceholderText('Ej: DOLORES').closest('form')!)
    await waitFor(() => expect(api.createEmployee).toHaveBeenCalledWith({ full_name: 'NUEVO PRUEBA', role: 'salonero', pos_login: '041' }))
  })

  it('owner: editar sin cambiar el login NO lo manda (no ensucia el historial)', async () => {
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    fireEvent.click(screen.getAllByText('Editar')[0])
    expect((screen.getByLabelText('Login del PoS') as HTMLInputElement).value).toBe('034')
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.updateEmployee).toHaveBeenCalled())
    expect(api.updateEmployee.mock.calls[0][1]).not.toHaveProperty('pos_login')
  })

  it('owner: formato inválido no llama a la base; el error de la base se muestra tal cual', async () => {
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    fireEvent.click(screen.getAllByText('Editar')[0])
    fireEvent.change(screen.getByLabelText('Login del PoS'), { target: { value: '41' } })
    fireEvent.click(screen.getByText('Guardar'))
    expect(await screen.findByText('El login del PoS son 3 dígitos (ej. 041).')).toBeTruthy()
    expect(api.updateEmployee).not.toHaveBeenCalled()
    const msg = 'duplicate key value violates unique constraint "employees_pos_login_key"'
    api.updateEmployee.mockRejectedValue(new Error(msg))
    fireEvent.change(screen.getByLabelText('Login del PoS'), { target: { value: '099' } })
    fireEvent.click(screen.getByText('Guardar'))
    expect(await screen.findByText(msg)).toBeTruthy()
  })

  it('no owner: ni el campo, ni el aviso, ni la lectura del PoS', async () => {
    rol.v = 'manager'
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    fireEvent.click(screen.getAllByText('Editar')[0])
    expect(screen.queryByLabelText('Login del PoS')).toBeNull()
    expect(screen.queryByText(/sin empleado: asignar/)).toBeNull()
    expect(pos.getPromPaxAgregado).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.updateEmployee).toHaveBeenCalled())
    expect(api.updateEmployee.mock.calls[0][1]).not.toHaveProperty('pos_login')
  })

  it('si fallan todos los locales, lo dice (no se calla)', async () => {
    pos.getPromPaxAgregado.mockRejectedValue(new Error('No autorizado'))
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    expect(await screen.findByText(/No se pudieron revisar los logins del PoS/)).toBeTruthy()
  })
})
