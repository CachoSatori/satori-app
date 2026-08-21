// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Employee, EmployeeWageRate, SalaryPeriod, WorkDay } from '../../shared/types/database'

// Salarios · U0b: la pantalla que cierra el ciclo. Se prueba el camino real —
// horas → neto → archivo del banco → marcar pagado — y el gate del contador.

let rol: 'owner' | 'manager' | 'contador' = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1' }, profile: { role: rol } }),
}))

// El cliente real explota sin variables de entorno: lo reemplazamos para poder usar
// las funciones PURAS de verdad (consolidarPeriodo y compañía) y mockear solo la red.
vi.mock('../../shared/api/supabase', () => ({ supabase: { from: () => ({}) } }))

const PERIODO: SalaryPeriod = {
  id: 'per-1', tipo: 'quincena', fecha_ini: '2026-08-01', fecha_fin: '2026-08-15',
  estado: 'abierto', local: null, paid_by: null, paid_at: null, created_at: '', updated_at: '',
}

const RATES: EmployeeWageRate[] = [
  { id: 'r1', employee_id: 'e1', tipo: 'hora', hourly_rate_crc: 2600, fixed_salary_crc: 0,
    efectivo_desde: '2026-06-01', nota: null, created_at: '', updated_at: '' },
  { id: 'r2', employee_id: 'e2', tipo: 'quincena', hourly_rate_crc: 0, fixed_salary_crc: 185_000,
    efectivo_desde: '2026-06-01', nota: null, created_at: '', updated_at: '' },
]

let WORK_DAYS: WorkDay[] = []

const upsert   = vi.fn<(w: unknown) => Promise<void>>(async () => {})
const pagar    = vi.fn<(id: string, l: unknown, by: string) => Promise<number>>(async () => 2)
const download = vi.fn()

vi.mock('../../shared/api/salarios', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/salarios')>()
  return {
    ...actual,
    getSalaryPeriods:   async () => [PERIODO],
    getWorkDays:        async () => WORK_DAYS,
    getWageRatesUpTo:   async () => RATES,
    getPeriodPayments:  async () => [],
    upsertWorkDay:      (w: unknown) => upsert(w),
    markPeriodPaid:     (id: string, l: unknown, by: string) => pagar(id, l, by),
  }
})

vi.mock('../../shared/utils/planillaBanco', async (orig) => {
  const actual = await orig<typeof import('../../shared/utils/planillaBanco')>()
  return { ...actual, downloadPlanillaXlsx: (...a: unknown[]) => download(...a) }
})

import SalariosPago from './SalariosPago'

// El separador de miles de es-CR depende del ICU del runtime (espacio duro, punto…):
// formateamos igual que la app y comparamos con los espacios normalizados.
const plano = (s: string) => s.replace(/\s+/g, ' ').trim()
const money = (n: number) => (content: string) => plano(content) === plano(`₡ ${n.toLocaleString('es-CR')}`)

const emp = (over: Partial<Employee> & { id: string; full_name: string }): Employee =>
  ({ role: 'salonero', profile_id: null, is_active: true, pos_name: null,
     created_at: '', updated_at: '', ...over }) as Employee

const ANA    = emp({ id: 'e1', full_name: 'ANA' })
const BENITO = emp({ id: 'e2', full_name: 'BENITO', nombre_homebanking: 'BENITO PEREZ MORA' })
const INACTIVO = emp({ id: 'e3', full_name: 'VIEJO', is_active: false })

async function renderPago() {
  const view = render(<SalariosPago employees={[ANA, BENITO, INACTIVO]} />)
  // Esperamos a que el período haya traído horas y tarifas: la tabla se pinta antes.
  await screen.findByDisplayValue('96')
  return view
}

beforeEach(() => {
  rol = 'owner'
  WORK_DAYS = [{
    employee_id: 'e1', work_date: '2026-08-15', local: 'santa-teresa', hours: 96,
    es_feriado: false, source: 'manual', created_at: '', updated_at: '',
  }]
  upsert.mockClear(); pagar.mockClear(); download.mockClear()
})

describe('Salarios · Pago del período', () => {
  it('el neto sale de horas × tarifa vigente + fijo, y el inactivo no entra', async () => {
    await renderPago()
    expect(screen.getByLabelText('Horas del período: ANA')).toHaveProperty('value', '96')
    expect(screen.getAllByText(money(249_600)).length).toBeGreaterThan(0)  // 96 × 2.600
    expect(screen.getAllByText(money(185_000)).length).toBeGreaterThan(0)  // fijo de BENITO
    expect(screen.queryByText('VIEJO')).toBeNull()
    expect(screen.getAllByText(money(434_600)).length).toBeGreaterThan(0)  // total del período
  })

  it('editar las horas persiste SOLO la fila manual del período', async () => {
    await renderPago()
    const input = screen.getByLabelText('Horas del período: ANA')
    fireEvent.change(input, { target: { value: '100' } })
    fireEvent.blur(input)
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
    expect(upsert).toHaveBeenCalledWith({
      employee_id: 'e1', work_date: '2026-08-15', local: 'santa-teresa', hours: 100,
    })
  })

  it('el neto se puede pisar a mano y es el que manda', async () => {
    await renderPago()
    fireEvent.change(screen.getByLabelText('Neto a pagar: ANA'), { target: { value: '300000' } })
    expect(screen.getAllByText(money(485_000)).length).toBeGreaterThan(0)   // 300.000 + 185.000
  })

  it('descargar el archivo manda nombre del banco, monto entero y el concepto', async () => {
    await renderPago()
    fireEvent.click(screen.getByText('Descargar Excel para el banco'))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [benef, concepto, nombreArchivo] = download.mock.calls[0]
    expect(benef).toEqual([
      { nombre: 'ANA', monto: 249_600 },                  // sin alias → cae al nombre
      { nombre: 'BENITO PEREZ MORA', monto: 185_000 },    // con alias del homebanking
    ])
    expect(concepto).toBe('PAGO DE SALARIOS')
    expect(nombreArchivo).toBe('planilla-salarios-2026-08-01-a-2026-08-15.xlsx')
  })

  it('el concepto es editable y viaja al archivo', async () => {
    await renderPago()
    fireEvent.change(screen.getByLabelText('Concepto para el banco'), { target: { value: 'PAGO QUINCENA AGOSTO' } })
    fireEvent.click(screen.getByText('Descargar Excel para el banco'))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(download.mock.calls[0][1]).toBe('PAGO QUINCENA AGOSTO')
  })

  it('marcar pagado registra un pago por empleado con neto > 0', async () => {
    window.confirm = vi.fn(() => true)
    await renderPago()
    fireEvent.click(screen.getByText('Marcar pagado'))
    await waitFor(() => expect(pagar).toHaveBeenCalledTimes(1))
    expect(pagar.mock.calls[0][0]).toBe('per-1')
    expect(pagar.mock.calls[0][1]).toEqual([
      { employee_id: 'e1', monto_neto: 249_600 },
      { employee_id: 'e2', monto_neto: 185_000 },
    ])
    expect(pagar.mock.calls[0][2]).toBe('u-1')
  })

  it('el contador arma la nómina y baja el archivo, pero NO marca el pago', async () => {
    rol = 'contador'
    await renderPago()
    expect((screen.getByText('Marcar pagado') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Descargar Excel para el banco') as HTMLButtonElement).disabled).toBe(false)
  })
})
