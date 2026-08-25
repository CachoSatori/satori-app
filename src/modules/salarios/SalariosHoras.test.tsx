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
const cargarExc = vi.fn()   // cuenta cuántas veces la pantalla relee las excepciones

vi.mock('../../shared/api/salarios', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/salarios')>()
  return {
    ...actual,
    getSalaryPeriods:    async () => [PERIODO],
    getWorkDays:         async () => WORK_DAYS,
    getPunchExceptions:  async () => { cargarExc(); return EXCS },
    derivarWorkDays:     (d: string, h: string, l: string) => derivar(d, h, l),
    resolvePunchException: (id: string, u: string) => resolver(id, u),
    overrideHorasDia:    (o: unknown) => override(o),
    getPunchesDeJornada: (l: string, d: string) => marcas(l, d),
  }
})

import SalariosHoras from './SalariosHoras'

// La bandeja se pinta antes de que lleguen las excepciones (con el contador en 0), así
// que esperar a que el elemento EXISTA no alcanza: se espera a que el conteo llegue.
const esperarBandeja = (n: number) =>
  waitFor(() =>
    expect(screen.getByLabelText('Excepciones por revisar').textContent?.trim())
      .toBe(`${n} por revisar`),
  )

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
    marcas: 400, dias: 200, dias_incompletos: 29, tramos_sin_cerrar: 32,
    horas_default: 96, dias_omitidos_manual: 0, horas: 1117.55,
    excepciones: { impar: 29, turno_largo: 0, solapado: 2, sin_mapear: 0 },
  })
  resolver.mockClear(); override.mockClear(); marcas.mockClear(); cargarExc.mockClear()
})

describe('SalariosHoras — recálculo', () => {
  it('recalcula el período elegido en el local elegido y muestra el resumen', async () => {
    render(<SalariosHoras employees={EMPLEADOS} />)
    const btn = await screen.findByRole('button', { name: /Recalcular horas del período/i })

    fireEvent.click(btn)

    await waitFor(() => expect(derivar).toHaveBeenCalledWith('2026-08-01', '2026-08-15', 'santa-teresa'))
    expect(await screen.findByText(/200 jornada\(s\)/)).toBeTruthy()
    expect(screen.getByText(/1117\.55 h/)).toBeTruthy()
    const linea = screen.getByText(/tramo\(s\) sin cerrar/)
    expect(linea.textContent?.replace(/\s+/g, ' '))
      .toMatch(/29 jornada\(s\) incompleta\(s\): 32 tramo\(s\) sin cerrar = 96 h a 3 h por tramo/)
    expect(screen.getByText(/31 excepción\(es\)/)).toBeTruthy()
  })

  it('avisa cuando el recálculo NO tocó jornadas por tener horas a mano', async () => {
    derivar.mockResolvedValue({
      local: 'santa-teresa', desde: '2026-08-01', hasta: '2026-08-15',
      marcas: 10, dias: 3, dias_incompletos: 0, tramos_sin_cerrar: 0,
      horas_default: 0, dias_omitidos_manual: 2, horas: 20,
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
    const celdas = screen.getAllByRole('cell').map(c => c.textContent?.replace(/\s+/g, ' '))
    // Empleado · Jornadas · Incompletas · Medidas · Default · BioTime · a mano · Total
    expect(celdas.slice(0, 8)).toEqual(['NACHO', '2', '—', '15.00', '—', '15.00', '96.00', '111.00'])
    expect(screen.getByText(/tienen horas cargadas a mano/)).toBeTruthy()
  })

  it('muestra por empleado las jornadas incompletas y qué parte de las horas puso la regla', async () => {
    WORK_DAYS = [
      // día completo: 8 h medidas
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-01', hours: 8,
           flags: { pares: 1, horas_pares: 8, tramos_sin_cerrar: 0, horas_default: 0, horas_origen: 'biotime' } }),
      // TURNO CORTADO: 4 h medidas + 1 tramo sin cerrar = 7 h
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-02', hours: 7,
           flags: { pares: 1, horas_pares: 4, tramos_sin_cerrar: 1, horas_default: 3, horas_origen: 'mixto' } }),
      // día sin ningún par, con dos tramos abiertos = 6 h
      wd({ employee_id: 'e1', source: 'biotime', work_date: '2026-08-03', hours: 6,
           flags: { pares: 0, horas_pares: 0, tramos_sin_cerrar: 2, horas_default: 6, horas_origen: 'default' } }),
    ]
    render(<SalariosHoras employees={EMPLEADOS} />)

    expect(await screen.findByText('NACHO')).toBeTruthy()
    const celdas = screen.getAllByRole('cell').map(c => c.textContent?.replace(/\s+/g, ' '))
    // Empleado · Jornadas · Incompletas · Horas medidas · Horas default · BioTime · a mano · Total
    expect(celdas.slice(0, 8)).toEqual(['NACHO', '3', '2 (3 tramos)', '12.00', '9', '21.00', '—', '21.00'])

    const cartel = screen.getByText(/por cada tramo sin cerrar/)
    expect(cartel.textContent?.replace(/\s+/g, ' '))
      .toMatch(/2 jornada\(s\) incompleta\(s\) en el período: 9 h las puso la regla/)
  })

  it('sin jornadas incompletas no aparece el aviso de las horas default', async () => {
    WORK_DAYS = [wd({ employee_id: 'e1', source: 'biotime', hours: 8,
                      flags: { pares: 1, horas_pares: 8, tramos_sin_cerrar: 0, horas_default: 0 } })]
    render(<SalariosHoras employees={EMPLEADOS} />)
    expect(await screen.findByText('NACHO')).toBeTruthy()
    expect(screen.queryByText(/por cada tramo sin cerrar/)).toBeNull()
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

    await esperarBandeja(2)
    expect(screen.getByText('Código 8 (sin empleado)')).toBeTruthy()

    fireEvent.click(screen.getByText('NACHO'))
    fireEvent.click(await screen.findByRole('button', { name: /Ver marcas/i }))

    await waitFor(() => expect(marcas).toHaveBeenCalledWith('santa-teresa', '2026-08-03'))
    // 22:00 UTC = 16:00 en Costa Rica (UTC−6 fijo)
    expect(await screen.findByText(/16:00 in/)).toBeTruthy()
  })

  // #2 · la marca cruda puede no tener employee_id resuelto: filtrar solo por él dejaba el
  // renglón VACÍO, indistinguible de "no hubo marcas".
  it('muestra las marcas aunque la cruda no tenga employee_id resuelto', async () => {
    EXCS = [exc({ id: 'x1', tipo: 'impar', employee_id: 'e1', work_date: '2026-08-03' })]
    marcas.mockResolvedValue([
      { id: 'p1', employee_id: null, emp_code: '18', punch_at: '2026-08-03T17:00:00Z', punch_state: 'in' } as TimePunch,
    ])
    render(<SalariosHoras employees={EMPLEADOS} />)
    await esperarBandeja(1)
    fireEvent.click(screen.getAllByText('NACHO').at(-1)!)
    fireEvent.click(await screen.findByRole('button', { name: /Ver marcas/i }))

    expect(await screen.findByText(/11:00 in/)).toBeTruthy()
    expect(screen.getByText(/todas las de la jornada/)).toBeTruthy()
  })

  it('si de verdad no hay marcas lo dice, no deja el renglón en blanco', async () => {
    EXCS = [exc({ id: 'x1', tipo: 'impar', employee_id: 'e1', work_date: '2026-08-03' })]
    marcas.mockResolvedValue([])
    render(<SalariosHoras employees={EMPLEADOS} />)
    await esperarBandeja(1)
    fireEvent.click(screen.getAllByText('NACHO').at(-1)!)
    fireEvent.click(await screen.findByRole('button', { name: /Ver marcas/i }))
    expect(await screen.findByText(/Sin marcas crudas en esa jornada/)).toBeTruthy()
  })

  it('el botón Actualizar re-carga el período y nada más', async () => {
    EXCS = [exc({ id: 'x1', tipo: 'impar', employee_id: 'e1' })]
    render(<SalariosHoras employees={EMPLEADOS} />)
    await esperarBandeja(1)
    const antes = cargarExc.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(cargarExc.mock.calls.length).toBe(antes + 1))
    // no recalcula, no resuelve, no corrige: solo relee
    expect(derivar).not.toHaveBeenCalled()
    expect(resolver).not.toHaveBeenCalled()
    expect(override).not.toHaveBeenCalled()
  })

  it('el encabezado cuenta las abiertas y, aparte, las ya resueltas', async () => {
    EXCS = [
      exc({ id: 'x1', tipo: 'impar', employee_id: 'e1' }),
      exc({ id: 'x2', tipo: 'impar', employee_id: 'e1', work_date: '2026-08-04' }),
      exc({ id: 'x3', tipo: 'impar', employee_id: 'e2', estado: 'resuelta', resuelto_by: 'u-1' }),
    ]
    render(<SalariosHoras employees={EMPLEADOS} />)
    await esperarBandeja(2)
    expect(screen.getByLabelText('Excepciones resueltas').textContent?.trim()).toBe('1 resueltas')
  })

  it('la tarjeta del grupo muestra el puesto del empleado; la sin_mapear no', async () => {
    EXCS = [
      exc({ id: 'x1', tipo: 'impar', employee_id: 'e1' }),
      exc({ id: 'x2', tipo: 'sin_mapear', emp_code: '8', work_date: '2026-08-04' }),
    ]
    render(<SalariosHoras employees={EMPLEADOS} />)
    await esperarBandeja(2)
    // EMPLEADOS son rol 'cocina' → ROLE_LABELS.cocina
    expect(screen.getByText('Cocina')).toBeTruthy()
    expect(screen.getAllByText('Cocina')).toHaveLength(1)   // la del código 8 no lo tiene
  })

  // ── Capa 2 · corrección por resta ────────────────────────────────────────────
  // El impar de UNA marca no se corrige escribiendo horas: se muestra la hora real del
  // reloj, de qué lado va (BioTime se equivoca seguido con quien marca una sola vez) y se
  // completa la otra mitad. Las horas salen de la resta.
  const impar1 = (over: Partial<PunchException> = {}) => exc({
    id: 'x1', tipo: 'impar', employee_id: 'e1', work_date: '2026-08-03',
    // 17:07Z = 11:07 en Costa Rica (UTC−6 fijo)
    detalle: { cuantas: 1, marcas: [{ id: 'p1', punch_at: '2026-08-03T17:07:00Z', punch_state: 'in' }] },
    ...over,
  })

  async function abrirCaso(e: PunchException[] = [impar1()]) {
    EXCS = e
    render(<SalariosHoras employees={EMPLEADOS} />)
    await esperarBandeja(e.length)
    fireEvent.click(screen.getAllByText('NACHO').at(-1)!)
  }

  it('muestra la hora real, el lado y pide la otra mitad', async () => {
    await abrirCaso()
    expect(screen.getByText('11:07')).toBeTruthy()                       // la del reloj
    expect(screen.getByLabelText('Lado de la marca 2026-08-03').textContent).toMatch(/Entrada/)
    expect(screen.getByText('salió')).toBeTruthy()                        // pide la salida
    expect(screen.getByLabelText('Salida 2026-08-03')).toBeTruthy()
    expect(screen.getByText('= —')).toBeTruthy()                          // sin complemento, sin horas
    expect((screen.getByText('Guardar') as HTMLButtonElement).disabled).toBe(true)
  })

  it('completa la mitad que falta y calcula las horas por resta, en vivo', async () => {
    await abrirCaso()
    fireEvent.change(screen.getByLabelText('Salida 2026-08-03'), { target: { value: '19:22' } })
    expect(screen.getByText('= 8.25 h')).toBeTruthy()                     // 11:07 → 19:22
    expect((screen.getByText('Guardar') as HTMLButtonElement).disabled).toBe(false)
  })

  it('voltear el lado cambia QUÉ mitad se pide y recalcula', async () => {
    await abrirCaso()
    fireEvent.change(screen.getByLabelText('Salida 2026-08-03'), { target: { value: '19:22' } })
    expect(screen.getByText('= 8.25 h')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Lado de la marca 2026-08-03'))

    // ahora la marca real es la SALIDA y se pide la entrada
    expect(screen.getByLabelText('Lado de la marca 2026-08-03').textContent).toMatch(/Salida/)
    expect(screen.getByText('entró')).toBeTruthy()
    expect(screen.getByLabelText('Entrada 2026-08-03')).toBeTruthy()
    // el complemento tecleado ahora es la ENTRADA: 19:22 → 11:07 cruza medianoche = 15.75 h
    expect(screen.getByText('= 15.75 h')).toBeTruthy()
  })

  it('Guardar escribe las horas calculadas con su motivo y después resuelve', async () => {
    await abrirCaso()
    fireEvent.change(screen.getByLabelText('Salida 2026-08-03'), { target: { value: '19:00' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(override).toHaveBeenCalled())
    expect(override.mock.calls[0][0]).toMatchObject({
      employee_id: 'e1', work_date: '2026-08-03', local: 'santa-teresa',
      hours: 7.88, userId: 'u-1',
      motivo: 'entró 11:07 → salió 19:00 (marca real: entrada 11:07, mitad completada a mano)',
    })
    await waitFor(() => expect(resolver).toHaveBeenCalledWith('x1', 'u-1'))
  })

  it('el botón de 3 h acepta el default derivado sin escribir override', async () => {
    await abrirCaso()
    fireEvent.click(screen.getByText('3 h'))
    await waitFor(() => expect(resolver).toHaveBeenCalledWith('x1', 'u-1'))
    expect(override).not.toHaveBeenCalled()
  })

  it('avisa —sin bloquear— cuando la resta da un turno absurdo', async () => {
    await abrirCaso()
    fireEvent.change(screen.getByLabelText('Salida 2026-08-03'), { target: { value: '10:00' } })
    expect(screen.getByText('= 22.88 h')).toBeTruthy()
    expect(screen.getByText(/más de 16 h, revisalo/)).toBeTruthy()
    expect((screen.getByText('Guardar') as HTMLButtonElement).disabled).toBe(false)
  })

  it('el estado no se filtra entre casos', async () => {
    await abrirCaso([
      impar1(),
      impar1({ id: 'x2', work_date: '2026-08-04',
               detalle: { cuantas: 1, marcas: [{ id: 'p2', punch_at: '2026-08-04T14:00:00Z', punch_state: 'out' }] } }),
    ])
    fireEvent.change(screen.getByLabelText('Salida 2026-08-03'), { target: { value: '19:22' } })
    expect(screen.getByText('= 8.25 h')).toBeTruthy()
    // el segundo caso (marca real = salida 08:00) sigue vacío
    expect((screen.getByLabelText('Entrada 2026-08-04') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('= —')).toBeTruthy()
  })

  it('los casos que NO son impar de una marca siguen con el input numérico', async () => {
    EXCS = [
      exc({ id: 'x1', tipo: 'solapado', employee_id: 'e1', work_date: '2026-08-03',
            detalle: { marcas: [{ id: 'p1', punch_at: '2026-08-03T17:00:00Z' }] } }),
      exc({ id: 'x2', tipo: 'impar', employee_id: 'e1', work_date: '2026-08-04',
            detalle: { cuantas: 2, marcas: [
              { id: 'p1', punch_at: '2026-08-04T14:00:00Z', punch_state: 'in' },
              { id: 'p2', punch_at: '2026-08-04T22:00:00Z', punch_state: 'in' },
            ] } }),
    ]
    render(<SalariosHoras employees={EMPLEADOS} />)
    await esperarBandeja(2)
    fireEvent.click(screen.getAllByText('NACHO').at(-1)!)

    expect(screen.getByLabelText('Horas corregidas 2026-08-03')).toBeTruthy()
    expect(screen.getByLabelText('Horas corregidas 2026-08-04')).toBeTruthy()
    expect(screen.getAllByText('Corregir a mano')).toHaveLength(2)
    expect(screen.queryByText('Guardar')).toBeNull()
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
    await esperarBandeja(1)
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
