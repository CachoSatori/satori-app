import { describe, it, expect, vi, beforeEach } from 'vitest'

// Salarios · Fase 0: contrato de escritura del maestro de nómina contra employees.
// Mock mínimo del cliente: capturamos el payload que sale y controlamos el error que
// devuelve la base (para probar la traducción del 23505 del índice único parcial).
const state: { error: { code?: string; message: string } | null; captured: unknown } = {
  error: null,
  captured: null,
}

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => {
        state.captured = payload
        return { eq: async () => ({ error: state.error }) }
      },
      insert: (payload: Record<string, unknown>) => {
        state.captured = payload
        return {
          select: () => ({
            single: async () => ({
              data: state.error ? null : { id: 'nuevo', ...payload },
              error: state.error,
            }),
          }),
        }
      },
    }),
  },
}))

import { updateEmployeePayroll, createEmployee } from './admin'

beforeEach(() => {
  state.error = null
  state.captured = null
})

describe('updateEmployeePayroll · guardado de los campos de nómina', () => {
  it('manda los 5 campos tal cual, con null en código y fecha sin cargar', async () => {
    await updateEmployeePayroll('emp-1', {
      hourly_rate_crc:    2600,
      fixed_salary_crc:   0,
      participa_servicio: false,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
    expect(state.captured).toEqual({
      hourly_rate_crc:    2600,
      fixed_salary_crc:   0,
      participa_servicio: false,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
  })

  it('código de BioTime duplicado (23505 del índice) → error claro, no el crudo de Postgres', async () => {
    state.error = { code: '23505', message: 'duplicate key value violates unique constraint "employees_biotime_emp_code_key"' }
    await expect(
      updateEmployeePayroll('emp-2', { biotime_emp_code: '17' }),
    ).rejects.toThrow(/código de BioTime «17» ya está asignado a otro empleado/)
  })

  it('un error cualquiera de la base pasa con su propio mensaje', async () => {
    state.error = { code: '42501', message: 'permission denied for table employees' }
    await expect(
      updateEmployeePayroll('emp-3', { hourly_rate_crc: 100 }),
    ).rejects.toThrow('permission denied for table employees')
  })
})

describe('createEmployee · alta sin cuenta de login', () => {
  it('no manda profile_id → la fila queda con profile_id null (FK nullable)', async () => {
    await createEmployee({
      full_name:          'JOSE',
      role:               'cocina',
      hourly_rate_crc:    2000,
      fixed_salary_crc:   0,
      participa_servicio: true,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
    expect(state.captured).toEqual({
      full_name:          'JOSE',
      role:               'cocina',
      hourly_rate_crc:    2000,
      fixed_salary_crc:   0,
      participa_servicio: true,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
    expect(Object.keys(state.captured as object)).not.toContain('profile_id')
  })

  it('el alta también traduce el duplicado de código de BioTime', async () => {
    state.error = { code: '23505', message: 'duplicate key value violates unique constraint "employees_biotime_emp_code_key"' }
    await expect(
      createEmployee({ full_name: 'JOSE', role: 'cocina', biotime_emp_code: '17' }),
    ).rejects.toThrow(/«17» ya está asignado a otro empleado/)
  })
})
