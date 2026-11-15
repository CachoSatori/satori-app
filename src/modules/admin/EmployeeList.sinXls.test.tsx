// @vitest-environment happy-dom
// D8 A (14-nov) · Admin → Empleados sin el Excel de ventas: no hay lista «Nombres en ventas sin asignar» ni
// desplegable de nombres del XLS, y el «Nombre en Excel» (pos_name) es dato fijo: se muestra y nunca se pierde al editar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { Employee } from '../../shared/types/database'

const rol = vi.hoisted(() => ({ v: 'owner' }))
const api = vi.hoisted(() => ({
  updateEmployee: vi.fn(), createEmployee: vi.fn(), toggleEmployeeActive: vi.fn(), linkProfileToEmployee: vi.fn(),
  getAllProfiles: vi.fn(async () => []),
}))
// Si la pantalla volviera a leer el Excel, encontraría un nombre sin vincular («NOMBRE SUELTO») y armaría la lista.
const ventas = vi.hoisted(() => ({
  getVentasDias: vi.fn(async () => ({
    '2026-11-10': { saloneros: { 'NOMBRE SUELTO': { ventas: 1, pax: 1 }, 'ANA EXCEL': { ventas: 1, pax: 1 } } },
  })),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: rol.v, full_name: 'Prueba' } }) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/admin', () => api)
vi.mock('../../shared/api/posNdf', () => ({ getPromPaxAgregado: vi.fn(async () => []) }))
vi.mock('../../shared/api/ventas', () => ventas)

import EmployeeList from './EmployeeList'

const emp = (id: string, full_name: string, pos_name: string | null, pos_login: string | null) =>
  ({ id, full_name, role: 'salonero', profile_id: null, is_active: true, pos_name, pos_login, created_at: '', updated_at: '' }) as Employee
const EMPS = [emp('e1', 'ANA PRUEBA', 'ANA EXCEL', '034'), emp('e2', 'BETO PRUEBA', null, null)]

describe.each(['owner', 'manager'])('EmployeeList sin Excel (%s)', (r) => {
  beforeEach(() => {
    cleanup()
    rol.v = r
    for (const f of Object.values(api)) f.mockClear()
    api.updateEmployee.mockReset().mockResolvedValue(undefined)
    ventas.getVentasDias.mockClear()
  })

  it('no lee el Excel ni muestra la lista «Nombres en ventas sin asignar»', async () => {
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    await waitFor(() => expect(api.getAllProfiles).toHaveBeenCalled())
    await new Promise(res => setTimeout(res, 0))
    expect(ventas.getVentasDias).not.toHaveBeenCalled()
    expect(screen.queryByText(/sin asignar/)).toBeNull()
    expect(screen.queryByText('NOMBRE SUELTO')).toBeNull()
    expect(screen.queryByText('Crear + vincular')).toBeNull()
  })

  it('muestra el «Nombre en Excel» en la fila y en Editar, sin desplegable', () => {
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    expect(screen.getByText('Nombre en Excel: ANA EXCEL')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Editar')[0])
    expect(screen.getByText('Nombre en Excel: ANA EXCEL')).toBeTruthy()
    expect(screen.queryByText('— sin vincular —')).toBeNull()
    // El único desplegable de la fila en edición es el del rol.
    const fila = screen.getByText('Nombre en Excel: ANA EXCEL').closest('tr')!
    expect(fila.querySelectorAll('select')).toHaveLength(1)
  })

  it('editar y guardar NO manda pos_name: el de la base queda intacto', async () => {
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    fireEvent.click(screen.getAllByText('Editar')[0])
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledTimes(1))
    const [id, payload] = api.updateEmployee.mock.calls[0]
    expect(id).toBe('e1')
    expect(payload).not.toHaveProperty('pos_name')
    expect(payload).toMatchObject({ full_name: 'ANA PRUEBA', role: 'salonero' })
  })

  it('un empleado sin nombre en Excel tampoco recibe pos_name al guardar', async () => {
    render(<EmployeeList employees={EMPS} onRefresh={async () => {}} />)
    fireEvent.click(screen.getAllByText('Editar')[1])
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledTimes(1))
    expect(api.updateEmployee.mock.calls[0][1]).not.toHaveProperty('pos_name')
  })
})
