// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Employee } from '../../shared/types/database'

const updatePayroll = vi.fn<(id: string, p: unknown) => Promise<void>>(async () => {})
const create        = vi.fn<(p: unknown) => Promise<Employee>>(async () => ({}) as Employee)
const toggle        = vi.fn<(id: string, active: boolean) => Promise<void>>(async () => {})

vi.mock('../../shared/api/admin', () => ({
  updateEmployeePayroll: (id: string, p: unknown) => updatePayroll(id, p),
  createEmployee:        (p: unknown) => create(p),
  toggleEmployeeActive:  (id: string, a: boolean) => toggle(id, a),
}))

// El alias del homebanking (U0b) se guarda aparte, con su propia función.
const setBanco = vi.fn<(id: string, n: string | null) => Promise<void>>(async () => {})
vi.mock('../../shared/api/salarios', () => ({
  updateEmployeeHomebankingName: (id: string, n: string | null) => setBanco(id, n),
}))

import SalariosEmpleados from './SalariosEmpleados'

function emp(over: Partial<Employee> & { id: string; full_name: string }): Employee {
  return {
    role: 'salonero',
    profile_id: null,
    is_active: true,
    pos_name: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Employee
}

// ANA ya tiene código; BENITO está sin mapear y en 0.
const ANA    = emp({ id: 'e1', full_name: 'ANA',    biotime_emp_code: '17', hourly_rate_crc: 2600 })
const BENITO = emp({ id: 'e2', full_name: 'BENITO', role: 'cocina' })

function renderList(employees: Employee[] = [ANA, BENITO]) {
  const onRefresh = vi.fn(async () => {})
  const view = render(<SalariosEmpleados employees={employees} onRefresh={onRefresh} />)
  return { onRefresh, view }
}

beforeEach(() => {
  updatePayroll.mockClear()
  create.mockClear()
  toggle.mockClear()
  setBanco.mockClear()
})

describe('Salarios · Empleados / Tarifas — guardado de nómina', () => {
  it('editar una fila y guardar → persiste los 5 campos y se relee', async () => {
    const { onRefresh, view } = renderList()

    fireEvent.click(screen.getAllByText('Editar')[1])   // fila de BENITO

    fireEvent.change(screen.getByLabelText('Tarifa por hora: BENITO'), { target: { value: '2600' } })
    fireEvent.change(screen.getByLabelText('Salario fijo: BENITO'),    { target: { value: '450000' } })
    fireEvent.click(screen.getByLabelText('Participa del 10%: BENITO'))
    fireEvent.change(screen.getByLabelText('Código BioTime: BENITO'),  { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Fecha de ingreso: BENITO'), { target: { value: '2024-03-01' } })

    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(updatePayroll).toHaveBeenCalled())
    expect(updatePayroll).toHaveBeenCalledWith('e2', {
      hourly_rate_crc:    2600,
      fixed_salary_crc:   450000,
      participa_servicio: false,
      biotime_emp_code:   '42',
      fecha_ingreso:      '2024-03-01',
    })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())

    // Relectura: lo que devuelve la base tras el refresh es lo que se ve.
    view.rerender(
      <SalariosEmpleados
        employees={[ANA, { ...BENITO, hourly_rate_crc: 2600, fixed_salary_crc: 450000, participa_servicio: false, biotime_emp_code: '42', fecha_ingreso: '2024-03-01' }]}
        onRefresh={async () => {}}
      />,
    )
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('2024-03-01')).toBeTruthy()
    expect(screen.getByText('No')).toBeTruthy()          // participa del 10% apagado
  })

  it('sin código de BioTime se muestra "sin mapear" y se cuenta arriba', () => {
    renderList()
    expect(screen.getByText('— sin mapear —')).toBeTruthy()
    expect(screen.getByText('1 sin código de BioTime')).toBeTruthy()
  })
})

describe('Salarios · alta de empleados que no existen en la app', () => {
  it('crea un cocinero sin cuenta de login (sin profile_id) con sus datos de nómina', async () => {
    const { onRefresh } = renderList()

    fireEvent.click(screen.getByText('+ Agregar empleado'))
    fireEvent.change(screen.getByPlaceholderText('Ej: JOSE'), { target: { value: 'jose' } })
    fireEvent.change(screen.getByLabelText('Tarifa por hora: nuevo empleado'), { target: { value: '2000' } })
    fireEvent.click(screen.getByText('Crear empleado'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({
      full_name:          'JOSE',      // uppercase, como el resto del maestro
      role:               'cocina',
      hourly_rate_crc:    2000,
      fixed_salary_crc:   0,
      participa_servicio: true,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
    expect(Object.keys(payload)).not.toContain('profile_id')
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})

describe('Salarios · código de BioTime duplicado', () => {
  it('editar: asignarle a BENITO el código de ANA → error y NO se persiste', async () => {
    renderList()

    fireEvent.click(screen.getAllByText('Editar')[1])                       // BENITO
    fireEvent.change(screen.getByLabelText('Código BioTime: BENITO'), { target: { value: '17' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(screen.getByText(/ya es de ANA/)).toBeTruthy())
    expect(updatePayroll).not.toHaveBeenCalled()
  })

  it('alta: crear a alguien con el código de ANA → error y NO se crea', async () => {
    renderList()

    fireEvent.click(screen.getByText('+ Agregar empleado'))
    fireEvent.change(screen.getByPlaceholderText('Ej: JOSE'), { target: { value: 'jose' } })
    fireEvent.change(screen.getByLabelText('Código BioTime: nuevo empleado'), { target: { value: '17' } })
    fireEvent.click(screen.getByText('Crear empleado'))

    await waitFor(() => expect(screen.getByText(/ya es de ANA/)).toBeTruthy())
    expect(create).not.toHaveBeenCalled()
  })

  it('dos usuarios de la misma persona con códigos DISTINTOS sí se guardan (caso legítimo)', async () => {
    renderList()

    fireEvent.click(screen.getAllByText('Editar')[1])                       // BENITO
    fireEvent.change(screen.getByLabelText('Código BioTime: BENITO'), { target: { value: '18' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(updatePayroll).toHaveBeenCalled())
    expect(updatePayroll.mock.calls[0][1]).toMatchObject({ biotime_emp_code: '18' })
  })

  it('si la base rechaza el duplicado (red del índice único), el error se muestra', async () => {
    updatePayroll.mockRejectedValueOnce(new Error('El código de BioTime «99» ya está asignado a otro empleado.'))
    renderList()

    fireEvent.click(screen.getAllByText('Editar')[1])
    fireEvent.change(screen.getByLabelText('Código BioTime: BENITO'), { target: { value: '99' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(screen.getByText(/«99» ya está asignado a otro empleado/)).toBeTruthy())
  })
})

describe('Salarios · inactivos', () => {
  it('desactivar conserva la fila (no borra) y el filtro los muestra aparte', async () => {
    const CARLA = emp({ id: 'e3', full_name: 'CARLA', is_active: false })
    renderList([ANA, CARLA])

    // Por defecto se ven solo los activos.
    expect(screen.queryByText('CARLA')).toBeNull()

    fireEvent.click(screen.getByText('inactivos'))
    expect(screen.getByText('CARLA')).toBeTruthy()

    fireEvent.click(screen.getByText('Activar'))
    await waitFor(() => expect(toggle).toHaveBeenCalledWith('e3', true))
  })
})
