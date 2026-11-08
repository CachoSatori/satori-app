import { describe, it, expect, vi, beforeEach } from 'vitest'

// Salarios · Fase 0: contrato de escritura del maestro de nómina.
// Desde la mig 083 (SAL-AUD-01) la tarifa y el salario fijo van a employee_payroll; el resto
// (servicio, BioTime, ingreso) sigue en employees. Mock mínimo del cliente: capturamos cada
// escritura con su tabla y controlamos el error que devuelve la base por tabla.
type Escritura = { tabla: string; op: string; payload: unknown; opts?: unknown }
const state: { error: Record<string, { code?: string; message: string } | null>; escrituras: Escritura[] } = {
  error: {},
  escrituras: [],
}
const de = (tabla: string) => state.escrituras.find(e => e.tabla === tabla)?.payload

vi.mock('./supabase', () => ({
  supabase: {
    from: (tabla: string) => ({
      update: (payload: unknown) => {
        state.escrituras.push({ tabla, op: 'update', payload })
        return { eq: async () => ({ error: state.error[tabla] ?? null }) }
      },
      insert: (payload: Record<string, unknown>) => {
        state.escrituras.push({ tabla, op: 'insert', payload })
        return {
          select: () => ({
            single: async () => ({
              data: state.error[tabla] ? null : { id: 'nuevo', ...payload },
              error: state.error[tabla] ?? null,
            }),
          }),
        }
      },
      upsert: async (payload: unknown, opts: unknown) => {
        state.escrituras.push({ tabla, op: 'upsert', payload, opts })
        return { error: state.error[tabla] ?? null }
      },
    }),
  },
}))

import { updateEmployeePayroll, createEmployee } from './admin'

beforeEach(() => {
  state.error = {}
  state.escrituras = []
})

describe('updateEmployeePayroll · guardado de los campos de nómina', () => {
  it('la tarifa va a employee_payroll; servicio, código y fecha a employees (null tal cual)', async () => {
    await updateEmployeePayroll('emp-1', {
      hourly_rate_crc:    2600,
      fixed_salary_crc:   0,
      participa_servicio: false,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
    expect(de('employees')).toEqual({
      participa_servicio: false,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
    expect(de('employee_payroll')).toEqual({ employee_id: 'emp-1', hourly_rate_crc: 2600, fixed_salary_crc: 0 })
    expect(state.escrituras.find(e => e.tabla === 'employee_payroll')?.opts).toEqual({ onConflict: 'employee_id' })
  })

  it('código de BioTime duplicado (23505 del índice) → error claro, no el crudo de Postgres', async () => {
    state.error.employees = { code: '23505', message: 'duplicate key value violates unique constraint "employees_biotime_emp_code_key"' }
    await expect(
      updateEmployeePayroll('emp-2', { biotime_emp_code: '17' }),
    ).rejects.toThrow(/código de BioTime «17» ya está asignado a otro empleado/)
  })

  it('un error cualquiera de la base pasa con su propio mensaje', async () => {
    state.error.employees = { code: '42501', message: 'permission denied for table employees' }
    await expect(
      updateEmployeePayroll('emp-3', { participa_servicio: true }),
    ).rejects.toThrow('permission denied for table employees')
  })

  it('la RLS de employee_payroll (manager) → «solo el dueño o el contador»', async () => {
    state.error.employee_payroll = { code: '42501', message: 'new row violates row-level security policy' }
    await expect(
      updateEmployeePayroll('emp-4', { hourly_rate_crc: 100 }),
    ).rejects.toThrow(/solo el dueño o el contador/)
    expect(state.escrituras.map(e => e.tabla)).toEqual(['employee_payroll'])
  })
})

describe('createEmployee · alta sin cuenta de login', () => {
  it('no manda profile_id ni planilla a employees; la planilla va después a employee_payroll', async () => {
    const creado = await createEmployee({
      full_name:          'EMPLEADO PRUEBA',
      role:               'cocina',
      hourly_rate_crc:    2000,
      fixed_salary_crc:   0,
      participa_servicio: true,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
    expect(de('employees')).toEqual({
      full_name:          'EMPLEADO PRUEBA',
      role:               'cocina',
      participa_servicio: true,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
    expect(Object.keys(de('employees') as object)).not.toContain('profile_id')
    expect(de('employee_payroll')).toEqual({ employee_id: 'nuevo', hourly_rate_crc: 2000, fixed_salary_crc: 0 })
    expect(state.escrituras.map(e => e.tabla)).toEqual(['employees', 'employee_payroll'])
    expect(creado).toMatchObject({ id: 'nuevo', hourly_rate_crc: 2000 })
  })

  it('el alta también traduce el duplicado de código de BioTime', async () => {
    state.error.employees = { code: '23505', message: 'duplicate key value violates unique constraint "employees_biotime_emp_code_key"' }
    await expect(
      createEmployee({ full_name: 'EMPLEADO PRUEBA', role: 'cocina', biotime_emp_code: '17' }),
    ).rejects.toThrow(/«17» ya está asignado a otro empleado/)
  })
})
