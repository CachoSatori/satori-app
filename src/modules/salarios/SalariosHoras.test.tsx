// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Employee, PunchException, SalaryPeriod, TimePunch, WorkDay } from '../../shared/types/database'

// Salarios · BioTime F1d: la pestaña Horas. Se prueba el camino real —
// recalcular el período → ver las horas derivadas → limpiar la bandeja.

let rol: 'owner' | 'manager' | 'contador' | 'cajero' = 'owner'
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1' }, profile: { role: rol } }),
}))

vi.mock('../../shared/api/supabase', () => ({ supabase: { from: () => ({}) } }))

const PERIODO: SalaryPeriod = {
  id: 'per-1', tipo: 'quincena', fecha_ini: '2026-08-01', fecha_fin: '2026-08-15',
  estado: 'abierto', local: null, paid_by: null, paid_at: null, created_at: '', updated_at: '',
}

const emp = (id: string, full_name: string): Employee =>
  ({ id, full_name, role: 'cocina', profile_id: null, is_active: true, pos_name: null,
     created_at: '', updated_at: '' }) as Employee

const EMPLEADOS: Employee[] = [emp('e1', 'NACHO'), emp('e2', 'SELENA')]

let WORK_DAYS: WorkDay[] = []
let EXCS: PunchException[] = []

const derivar   = vi.fn<(d: string, h: string, l: string) => Promise<unknown>>()
const resolver  = vi.fn<(id: string, u: string) => Promise<void>>(async () => {})
const override  = vi.fn<(o: unknown) => Promise<void>>(async () => {})
const marcas    = vi.fn<(l: string, d: string) => Promise<TimePunch[]>>(async () => [])

vi.mock('../../shared/api/salarios', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/salarios')>()
  return {
    ...actual,
    getSalaryPeriods:    async () => [PERIODO],
    getWorkDays:         async () => WORK_DAYS,
    getPunchExceptions:  async () => EXCS,
    derivarWorkDays:     (d: string, h: string, l: string) => derivar(d, h, l),
    resolvePunchException: (id: string, u: string) => resolver(id, u),
    overrideHorasDia:    (o: unknown) => override(o),
    getPunchesDeJornada: (l: string, d: string) => marcas(l, d),
  }
})

import SalariosHoras from './SalariosHoras'

function wd(over: Partial<WorkDay> & { employee_id: string; source: WorkDay['source'] }): WorkDay {
  return {
    work_date: '2026-08-01', local: 'santa-teresa', hours: 8, es_feriado: false,
    flags: null, created_at: '', updated_at: '', ...over,
  } as WorkDay
}

function exc(over: Partial<PunchException> & { id: string; tipo: PunchException['tipo'] }): PunchException {
  return {
    employee_id: null, emp_code: null, work_date: '2026-08-03', local: 'santa-teresa',
    detalle: null, estado: 'abierta', resuelto_by: null, resuelto_at: null,
    created_at: '', updated_at: '', ...over,
  } as PunchException
}

beforeEach(() => {
  rol = 'owner'
  WORK_DAYS = []
  EXCS = []
  derivar.mockReset()
  derivar.mockResolvedValue({
    local: 'santa-teresa', desde: '2026-08-01', hasta: '2026-08-15',
    marcas: 400, dias: 200, dias_3h_default: 26, dias_omitidos_manual: 0, horas: 1099.55,
    excepciones: { impar: 29, turno_largo: 0, solapado: 2, sin_mapear: 0 },
  })
  resolver.mockClear(); override.mockClear(); marcas.mockClear()
})

describe('SalariosHoras — recálculo', () => {
  it('recalcula el período elegido en el local elegido y muestra el resumen', async () => {
    render(<SalariosHoras employees={EMPLEADOS} />)
    const btn = await screen.findByRole('button', { name: /Recalcular horas del período/i })

    fireEvent.click(btn)

    await waitFor(() => expect(derivar).toHaveBeenCalledWith('2026-08-01', '2026-08-15', 'santa-teresa'))
    expect(await screen.findByText(/200 jornada\(s\)/)).toBeTruthy()
    expect(screen.getByText(/1099\.55 h/)).toBeTruthy()
    expect(screen.getByText(/26 jornada\(s\) a 3 h por defecto/)).toBeTruthy()
    expect(screen.getByText(/31 excepción\(es\)/)).toBeTruthy()
  })

  it('avisa cuando el recálculo NO tocó jornadas por tener horas a mano', async () => {
    derivar.mockResolvedValue({
      local: 'santa-teresa', desde: '2026-08-01', hasta: '2026-08-15',
      marcas: 10, dias: 3, dias_3h_default: 0, dias_omitidos_manual: 2, horas: 20,
      excepciones: { impar: 0, turno_largo: 0, solapado: 0, sin_mapear: 0 },
    })
    render(<SalariosHoras employees={EMPLEADOS} />)
    fireEvent.click(await screen.findByRole('button', { name: /Recalcular/i }))
    expect(await screen.findByText(/2 jornada\(s\) NO se tocaron/)).toBeTruthy()
  })

  it('el cajero no puede recalcular', async () => {
    rol = 'cajero'
    render(<SalariosHoras employees={EMPLEADOS} />)
    const btn = await screen.findByRole('button', { name: /Recalcular/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('el contador SÍ puede recalcular (arma la nómina)', async () => {
    rol = 'contador'
    render(<SalariosHoras employees={EMPLEADOS} />)
    const btn = await screen.findByRole('button', { name: /Recalcular/i })
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('SalariosHoras — horas derivadas', () => {
  it('separa las horas de BioTime de las cargadas a mano y avisa la doble carga', async () => {
    WORK_DAYS = [
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 8 }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-02', hours: 7 }),
      wd({ employee_id: 'e1', source: 'manual',  work_date: '2026-08-15', hours: 96 }),
      wd({ employee_id: 'e2', source: 'biotime', work_date: '2026-08-01', hours: 5.5 }),
    ]
    render(<SalariosHoras employees={EMPLEADOS} />)

    expect(await screen.findByText('NACHO')).toBeTruthy()
    expect(screen.getByText('15.00')).toBeTruthy()      // biotime de NACHO
    expect(screen.getByText('96.00')).toBeTruthy()      // manual de NACHO
    expect(screen.getByText('111.00')).toBeTruthy()     // el total que SUMA las dos
    expect(screen.getByText(/tienen horas cargadas a mano/)).toBeTruthy()
  })

  it('muestra por empleado los días contados a 3 h y los que tienen marca suelta', async () => {
    WORK_DAYS = [
      // dos jornadas medidas, una de ellas con una marca suelta al lado
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 8,
           flags: { horas_origen: 'biotime', pares: 1, impares: 0, solapados: 0 } }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-02', hours: 6,
           flags: { horas_origen: 'biotime', pares: 1, impares: 1, solapados: 0 } }),
      // y dos jornadas sin ningún par → default de 3 h
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-03', hours: 3,
           flags: { horas_origen: '3h_default_impar', pares: 0, impares: 1, solapados: 0 } }),
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-04', hours: 3,
           flags: { horas_origen: '3h_default_impar', pares: 0, impares: 1, solapados: 1 } }),
    ]
    render(<SalariosHoras employees={EMPLEADOS} />)

    expect(await screen.findByText('NACHO')).toBeTruthy()
    // el "2" va en <strong> y el "(6 h)" al lado: se compara el texto de la celda entera
    const celda = screen.getByTitle(/6\.00 h puestas por la regla/)
    expect(celda.textContent?.replace(/\s+/g, ' ')).toBe('2 (6 h)')
    // 8 + 6 + 3 + 3 = 20, y como no hay horas a mano el Total repite el mismo número
    expect(screen.getAllByText('20.00')).toHaveLength(2)
    // la otra mitad del título: la columna de al lado cuenta los días que SÍ midieron
    // pero tienen una marca suelta (1: el 02/08). Si se confunde con la de 3 h, falla.
    const celdas = screen.getAllByRole('cell').map(c => c.textContent?.replace(/\s+/g, ' '))
    expect(celdas.slice(0, 4)).toEqual(['NACHO', '4', '2 (6 h)', '1'])
    const cartel = screen.getByText(/por no tener ninguna marca cerrada/)
    expect(cartel.textContent?.replace(/\s+/g, ' ')).toMatch(/2 jornada\(s\) del período se contaron a 3 h/)
  })

  it('sin días al default no aparece el aviso de las 3 h', async () => {
    WORK_DAYS = [wd({ employee_id: 'e1', source: 'biotime', hours: 8,
                      flags: { horas_origen: 'biotime', pares: 1, impares: 0, solapados: 0 } })]
    render(<SalariosHoras employees={EMPLEADOS} />)
    expect(await screen.findByText('NACHO')).toBeTruthy()
    expect(screen.queryByText(/por no tener ninguna marca cerrada/)).toBeNull()
  })

  it('sin doble carga no aparece el aviso', async () => {
    WORK_DAYS = [wd({ employee_id: 'e2', source: 'biotime', hours: 5 })]
    render(<SalariosHoras employees={EMPLEADOS} />)
    expect(await screen.findByText('SELENA')).toBeTruthy()
    expect(screen.queryByText(/tienen horas cargadas a mano/)).toBeNull()
  })
})

describe('SalariosHoras — bandeja de excepciones', () => {
  it('agrupa por persona, expande y muestra las marcas crudas del día', async () => {
    EXCS = [
      exc({ id: 'x1', tipo: 'impar', employee_id: 'e1', work_date: '2026-08-03' }),
      exc({ id: 'x2', tipo: 'sin_mapear', emp_code: '8', work_date: '2026-08-04' }),
    ]
    marcas.mockResolvedValue([
      { id: 'p1', employee_id: 'e1', emp_code: '5', punch_at: '2026-08-03T22:00:00Z', punch_state: 'in' } as TimePunch,
    ])
    render(<SalariosHoras employees={EMPLEADOS} />)

    expect(await screen.findByText('Excepciones de fichaje (2)')).toBeTruthy()
    expect(screen.getByText('Código 8 (sin empleado)')).toBeTruthy()

    fireEvent.click(screen.getByText('NACHO'))
    fireEvent.click(await screen.findByRole('button', { name: /Ver marcas/i }))

    await waitFor(() => expect(marcas).toHaveBeenCalledWith('santa-teresa', '2026-08-03'))
    // 22:00 UTC = 16:00 en Costa Rica (UTC−6 fijo)
    expect(await screen.findByText(/16:00 in/)).toBeTruthy()
  })

  it('resolver una excepción la marca resuelta con el usuario de la sesión', async () => {
    EXCS = [exc({ id: 'x1', tipo: 'impar', employee_id: 'e1' })]
    render(<SalariosHoras employees={EMPLEADOS} />)
    fireEvent.click(await screen.findByText('NACHO'))
    fireEvent.click(await screen.findByRole('button', { name: /Marcar resuelta/i }))
    await waitFor(() => expect(resolver).toHaveBeenCalledWith('x1', 'u-1'))
  })

  it('corregir a mano escribe el override y cierra la excepción en el mismo gesto', async () => {
    EXCS = [exc({ id: 'x1', tipo: 'impar', employee_id: 'e1', work_date: '2026-08-03' })]
    WORK_DAYS = [wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-03', hours: 0 })]
    render(<SalariosHoras employees={EMPLEADOS} />)
    // NACHO aparece en la tabla de horas Y en la bandeja: se abre el de la bandeja.
    await screen.findByText('Excepciones de fichaje (1)')
    fireEvent.click(screen.getAllByText('NACHO').at(-1)!)

    fireEvent.change(screen.getByLabelText('Horas corregidas 2026-08-03'), { target: { value: '7.5' } })
    fireEvent.click(screen.getByRole('button', { name: /Corregir a mano/i }))

    await waitFor(() => expect(override).toHaveBeenCalled())
    expect(override.mock.calls[0][0]).toMatchObject({
      employee_id: 'e1', work_date: '2026-08-03', local: 'santa-teresa',
      hours: 7.5, userId: 'u-1', horas_biotime: 0,
    })
    await waitFor(() => expect(resolver).toHaveBeenCalledWith('x1', 'u-1'))
  })

  it('sin horas escritas no escribe nada y avisa', async () => {
    EXCS = [exc({ id: 'x1', tipo: 'impar', employee_id: 'e1', work_date: '2026-08-03' })]
    render(<SalariosHoras employees={EMPLEADOS} />)
    fireEvent.click(await screen.findByText('NACHO'))
    fireEvent.click(screen.getByRole('button', { name: /Corregir a mano/i }))
    expect(await screen.findByText(/Escribí las horas del día/)).toBeTruthy()
    expect(override).not.toHaveBeenCalled()
  })

  it('la sin_mapear no ofrece corregir horas: todavía no hay a quién acreditárselas', async () => {
    EXCS = [exc({ id: 'x2', tipo: 'sin_mapear', emp_code: '8' })]
    render(<SalariosHoras employees={EMPLEADOS} />)
    fireEvent.click(await screen.findByText('Código 8 (sin empleado)'))
    expect(screen.queryByRole('button', { name: /Corregir a mano/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Marcar resuelta/i })).toBeTruthy()
  })
})
