// @vitest-environment happy-dom
// «Login del PoS» en Admin → Empleados: solo el owner lo edita; valida; mensaje de duplicado;
// lista de logins que vendieron sin empleado.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Employee } from '../../shared/types/database'

const H = vi.hoisted(() => ({ role: 'owner' as string, update: vi.fn(), logins: [] as { salonero_login: string | null; dia: string }[] }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'p', role: H.role } }) }))
vi.mock('../../shared/api/admin', () => ({
  createEmployee: vi.fn(), toggleEmployeeActive: vi.fn(), linkProfileToEmployee: vi.fn(),
  getAllProfiles: vi.fn(async () => []),
  updateEmployee: (...a: unknown[]) => H.update(...a),
}))
vi.mock('../../shared/api/ventas', () => ({ getVentasDias: vi.fn(async () => ({})) }))
vi.mock('../../shared/api/posNdf', () => ({ getLoginsDeFacturasRecientes: vi.fn(async () => H.logins) }))

import EmployeeList from './EmployeeList'

const emp = (id: string, full_name: string, pos_login: string | null): Employee => ({
  id, full_name, role: 'salonero', profile_id: null, is_active: true, pos_name: null, pos_login,
  created_at: '', updated_at: '',
})
const EMPS = [emp('a', 'EMPLEADO A', '026'), emp('b', 'EMPLEADO B', null)]

beforeEach(() => { H.role = 'owner'; H.update.mockReset(); H.update.mockResolvedValue(undefined); H.logins = [] })

describe('EmployeeList · Login del PoS', () => {
  it('owner: edita el login y lo guarda', async () => {
    const onRefresh = vi.fn(async () => {})
    render(<EmployeeList employees={EMPS} onRefresh={onRefresh} />)
    fireEvent.click(screen.getAllByText('Editar')[1])
    fireEvent.change(screen.getByLabelText('Login del PoS: EMPLEADO B'), { target: { value: '041' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(H.update).toHaveBeenCalledWith('b', expect.objectContaining({ pos_login: '041' })))
  })

  it('owner: vacío lo deja sin login (null)', async () => {
    render(<EmployeeList employees={EMPS} onRefresh={vi.fn(async () => {})} />)
    fireEvent.click(screen.getAllByText('Editar')[0])
    fireEvent.change(screen.getByLabelText('Login del PoS: EMPLEADO A'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(H.update).toHaveBeenCalledWith('a', expect.objectContaining({ pos_login: null })))
  })

  it('duplicado con la lista cargada → mensaje y no guarda', async () => {
    render(<EmployeeList employees={EMPS} onRefresh={vi.fn(async () => {})} />)
    fireEvent.click(screen.getAllByText('Editar')[1])
    fireEvent.change(screen.getByLabelText('Login del PoS: EMPLEADO B'), { target: { value: '026' } })
    fireEvent.click(screen.getByText('Guardar'))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Ese login ya lo tiene EMPLEADO A.')
    expect(H.update).not.toHaveBeenCalled()
  })

  it('si la base rechaza por el índice único → «Ese login ya lo tiene …»', async () => {
    H.update.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "employees_pos_login_key"'))
    render(<EmployeeList employees={EMPS} onRefresh={vi.fn(async () => {})} />)
    fireEvent.click(screen.getAllByText('Editar')[1])
    fireEvent.change(screen.getByLabelText('Login del PoS: EMPLEADO B'), { target: { value: '041' } })
    fireEvent.click(screen.getByText('Guardar'))
    expect((await screen.findByRole('alert')).textContent).toBe('Ese login ya lo tiene otro empleado.')
  })

  it('no owner: no hay campo editable ni lista de logins, y no se manda pos_login', async () => {
    H.role = 'manager'
    render(<EmployeeList employees={EMPS} onRefresh={vi.fn(async () => {})} />)
    expect(screen.getByText('Login del PoS: 026')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Editar')[0])
    expect(screen.queryByLabelText('Login del PoS: EMPLEADO A')).toBeNull()
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(H.update).toHaveBeenCalled())
    expect(H.update.mock.calls[0][1]).not.toHaveProperty('pos_login')
    expect(screen.queryByTestId('logins-sin-empleado')).toBeNull()
  })

  it('owner: lista los logins que vendieron sin empleado', async () => {
    H.logins = [{ salonero_login: '041', dia: '2026-11-03' }, { salonero_login: '026', dia: '2026-11-01' }]
    render(<EmployeeList employees={EMPS} onRefresh={vi.fn(async () => {})} />)
    const panel = await screen.findByTestId('logins-sin-empleado')
    const logins = [...panel.querySelectorAll('li strong')].map(n => n.textContent)
    expect(logins).toEqual(['041'])   // el 026 ya tiene empleado
  })

  it('owner: 111 y 222 no salen como «sin empleado»: van marcados login de caja con su turno', async () => {
    H.logins = [{ salonero_login: '111', dia: '2026-11-03' }, { salonero_login: '222', dia: '2026-11-02' }]
    render(<EmployeeList employees={EMPS} onRefresh={vi.fn(async () => {})} />)
    const panel = await screen.findByTestId('logins-sin-empleado')
    expect(panel.querySelectorAll('li').length).toBe(0)
    expect(panel.textContent).toContain('Todos tienen empleado asignado')
    const cajas = screen.getByTestId('logins-de-caja').textContent!
    expect(cajas).toContain('111 login de caja, turno mañana (1 factura, última: 2026-11-03)')
    expect(cajas).toContain('222 login de caja, turno tarde (1 factura, última: 2026-11-02)')
  })
})
