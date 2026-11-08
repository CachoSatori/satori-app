// SAL-AUD-01 (mig 084): la planilla se escribe en employee_payroll y se pega a los empleados.
import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { separarPlanilla } from './admin'
import { pegarPlanilla, unirPlanilla } from './salarios'
import type { Employee } from '../types/database'

const emp = (id: string): Employee => ({
  id, full_name: `EMPLEADO ${id}`, role: 'cocina', profile_id: null, is_active: true, pos_name: null,
  created_at: '', updated_at: '',
})

describe('separarPlanilla', () => {
  it('tarifa y salario fijo van a la planilla; lo demás a employees', () => {
    const { planilla, resto } = separarPlanilla({
      hourly_rate_crc: 12345, fixed_salary_crc: 0, participa_servicio: true, biotime_emp_code: '7', fecha_ingreso: undefined,
    })
    expect(planilla).toEqual({ hourly_rate_crc: 12345, fixed_salary_crc: 0 })
    expect(resto).toEqual({ participa_servicio: true, biotime_emp_code: '7' })
  })
  it('sin campos de planilla, la planilla queda vacía', () => {
    expect(separarPlanilla({ full_name: 'X', role: 'cocina' }).planilla).toEqual({})
  })
})

describe('pegarPlanilla', () => {
  it('pega la fila de cada empleado; sin fila → 0 / 0 / null (lo que ve un rol sin acceso)', () => {
    const r = pegarPlanilla([emp('a'), emp('b')], [
      { employee_id: 'a', hourly_rate_crc: 12345, fixed_salary_crc: 50000, nombre_homebanking: 'BENEFICIARIO A' },
    ])
    expect(r[0]).toMatchObject({ id: 'a', hourly_rate_crc: 12345, fixed_salary_crc: 50000, nombre_homebanking: 'BENEFICIARIO A' })
    expect(r[1]).toMatchObject({ id: 'b', hourly_rate_crc: 0, fixed_salary_crc: 0, nombre_homebanking: null })
  })
})

describe('unirPlanilla (tarifas y banco vienen de tablas distintas)', () => {
  it('une por empleado; lo que falta de un lado queda en 0 / null', () => {
    const r = unirPlanilla(
      [{ employee_id: 'a', hourly_rate_crc: 12345, fixed_salary_crc: 0 }],
      [{ employee_id: 'a', nombre_homebanking: 'BENEFICIARIO A' }, { employee_id: 'b', nombre_homebanking: 'BENEFICIARIO B' }],
    )
    expect(r).toEqual([
      { employee_id: 'a', hourly_rate_crc: 12345, fixed_salary_crc: 0, nombre_homebanking: 'BENEFICIARIO A' },
      { employee_id: 'b', hourly_rate_crc: 0, fixed_salary_crc: 0, nombre_homebanking: 'BENEFICIARIO B' },
    ])
  })
  it('manager: ve tarifas y la RLS no le devuelve banco → homebanking null', () => {
    const r = unirPlanilla([{ employee_id: 'a', hourly_rate_crc: 12345, fixed_salary_crc: 50000 }], [])
    expect(r).toEqual([{ employee_id: 'a', hourly_rate_crc: 12345, fixed_salary_crc: 50000, nombre_homebanking: null }])
  })
})
