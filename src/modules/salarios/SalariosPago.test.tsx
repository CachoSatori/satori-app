// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Employee, PunchException, SalaryPeriod, WorkDay } from '../../shared/types/database'

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

let WORK_DAYS: WorkDay[] = []
// F1d: las excepciones abiertas del período frenan el pago.
let EXCS: PunchException[] = []

const upsert   = vi.fn<(w: unknown) => Promise<void>>(async () => {})
const pagar    = vi.fn<(id: string, l: unknown, by: string) => Promise<number>>(async () => 2)
const download = vi.fn()

vi.mock('../../shared/api/salarios', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/salarios')>()
  return {
    ...actual,
    getSalaryPeriods:   async () => [PERIODO],
    getWorkDays:        async () => WORK_DAYS,
    getPeriodPayments:  async () => [],
    getPunchExceptionsTodosLosLocales: async () => EXCS,
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
     hourly_rate_crc: 0, fixed_salary_crc: 0,
     created_at: '', updated_at: '', ...over }) as Employee

// La tarifa vive en el EMPLEADO (employees.hourly_rate_crc / fixed_salary_crc), que es lo
// que la pestaña Empleados/Tarifas escribe. `employee_wage_rates` ya no se lee.
const ANA    = emp({ id: 'e1', full_name: 'ANA', hourly_rate_crc: 2600 })
const BENITO = emp({ id: 'e2', full_name: 'BENITO', nombre_homebanking: 'BENITO PEREZ MORA', fixed_salary_crc: 185_000 })
const INACTIVO = emp({ id: 'e3', full_name: 'VIEJO', is_active: false })
const SIN_TARIFA = emp({ id: 'e4', full_name: 'NUEVO' })

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
    es_feriado: false, source: 'manual', flags: null, created_at: '', updated_at: '',
  }]
  EXCS = []
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
    // Se manda también la TARIFA usada: markPeriodPaid la congela en salary_lines.snapshot
    // para que un pago viejo se pueda auditar aunque después le suban el precio de la hora.
    expect(pagar.mock.calls[0][1]).toEqual([
      { employee_id: 'e1', monto_neto: 249_600, horas: 96, hourly_rate: 2600, fijo: 0 },
      { employee_id: 'e2', monto_neto: 185_000, horas: 0,  hourly_rate: 0,    fijo: 185_000 },
    ])
    expect(pagar.mock.calls[0][2]).toBe('u-1')
  })

  it('el contador arma la nómina y baja el archivo, pero NO marca el pago', async () => {
    rol = 'contador'
    await renderPago()
    expect((screen.getByText('Marcar pagado') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Descargar Excel para el banco') as HTMLButtonElement).disabled).toBe(false)
  })

  // ── F1d · el semáforo del fichaje ──────────────────────────────────────────────
  // La regla de las 3 h (mig 059) le sacó el filo a los impares: esos días ya valen algo,
  // así que bloquear la quincena entera por un olvido sería peor que pagarla.
  function exc(over: Partial<PunchException> & { id: string; tipo: PunchException['tipo'] }): PunchException {
    return {
      employee_id: 'e1', emp_code: null, work_date: '2026-08-03', local: 'santa-teresa',
      detalle: null, estado: 'abierta', resuelto_by: null, resuelto_at: null,
      created_at: '', updated_at: '', ...over,
    } as PunchException
  }

  it('un fichaje incompleto (impar/solapado/turno largo) AVISA pero NO frena el pago', async () => {
    window.confirm = vi.fn(() => true)
    EXCS = [
      exc({ id: 'x1', tipo: 'impar',    work_date: '2026-08-03' }),
      exc({ id: 'x2', tipo: 'solapado', work_date: '2026-08-04' }),
    ]
    await renderPago()
    expect(await screen.findByText(/2 jornada\(s\) con fichaje incompleto/)).toBeTruthy()
    const btn = screen.getByText('Marcar pagado') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await waitFor(() => expect(pagar).toHaveBeenCalledTimes(1))
    expect((window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/fichaje incompleto/)
  })

  it('una marca SIN EMPLEADO avisa fuerte y viaja al confirm, pero no bloquea', async () => {
    window.confirm = vi.fn(() => true)
    EXCS = [exc({ id: 'x1', tipo: 'sin_mapear', employee_id: null, emp_code: '8' })]
    await renderPago()
    expect(await screen.findByText(/sin empleado asignado/)).toBeTruthy()
    expect((screen.getByText('Marcar pagado') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('Marcar pagado'))
    await waitFor(() => expect(pagar).toHaveBeenCalledTimes(1))
    expect((window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/NO ESTÉ COBRANDO/)
  })

  it('si el confirm de las marcas sin empleado se cancela, no se paga', async () => {
    window.confirm = vi.fn(() => false)
    EXCS = [exc({ id: 'x1', tipo: 'sin_mapear', employee_id: null, emp_code: '8' })]
    await renderPago()
    fireEvent.click(screen.getByText('Marcar pagado'))
    await waitFor(() => expect(window.confirm).toHaveBeenCalled())
    expect(pagar).not.toHaveBeenCalled()
  })

  // El único caso que sí frena: el total del período suma la fila manual Y los días de
  // BioTime, así que se puede pagar de más.
  it('las horas contadas dos veces FRENAN el pago hasta que una persona lo destrabe', async () => {
    window.confirm = vi.fn(() => true)
    WORK_DAYS = [
      ...WORK_DAYS,   // la fila manual de ANA (96 h el 15/08)
      { employee_id: 'e1', work_date: '2026-08-03', local: 'santa-teresa', hours: 8,
        es_feriado: false, source: 'biotime', flags: null, created_at: '', updated_at: '' },
    ]
    // el total de ANA ahora es 96 (a mano) + 8 (BioTime): el input arranca en 104
    render(<SalariosPago employees={[ANA, BENITO, INACTIVO]} />)
    await screen.findByDisplayValue('104')
    expect(await screen.findByText(/tiene\(n\) el total del período cargado/)).toBeTruthy()
    const btn = screen.getByText('Marcar pagado') as HTMLButtonElement
    expect(btn.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText(/Revisé las horas de 1 empleado/))
    expect((screen.getByText('Marcar pagado') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('Marcar pagado'))
    await waitFor(() => expect(pagar).toHaveBeenCalledTimes(1))
    expect((window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/Horas dobles confirmadas/)
  })

  // ── #1 · el neto ────────────────────────────────────────────────────────────────
  // El bug de la prueba en staging: TODOS los netos daban ₡0 porque la tarifa se leía de
  // employee_wage_rates (vigencia por fecha) y las filas estaban fechadas DESPUÉS del
  // período. Ahora sale de la tarifa del empleado.
  it('el neto sale de la tarifa DEL EMPLEADO y deja de dar ₡0', async () => {
    await renderPago()
    expect(screen.getAllByText(money(249_600)).length).toBeGreaterThan(0)   // 96 × 2.600
    expect(screen.getAllByText(money(185_000)).length).toBeGreaterThan(0)   // el fijo
    expect(screen.getAllByText(money(434_600)).length).toBeGreaterThan(0)   // total
    // y la tarifa se muestra, no "sin tarifa"
    expect(screen.getAllByText(money(2_600)).length).toBeGreaterThan(0)
  })

  it('un activo CON horas y SIN tarifa se destaca en vez de quedar en ₡0 callado', async () => {
    WORK_DAYS = [...WORK_DAYS, {
      employee_id: 'e4', work_date: '2026-08-15', local: 'santa-teresa', hours: 40,
      es_feriado: false, source: 'manual' as const, flags: null, created_at: '', updated_at: '',
    }]
    window.confirm = vi.fn(() => true)
    render(<SalariosPago employees={[ANA, BENITO, INACTIVO, SIN_TARIFA]} />)
    await screen.findByDisplayValue('96')

    expect(await screen.findByText(/NINGUNA tarifa cargada/)).toBeTruthy()
    expect(screen.getByText('sin tarifa')).toBeTruthy()
    fireEvent.click(screen.getByText('Marcar pagado'))
    await waitFor(() => expect(pagar).toHaveBeenCalled())
    const confirms = (window.confirm as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string)
    expect(confirms.join('\n')).toMatch(/SIN TARIFA .*NUEVO/s)
  })

  it('sin nadie sin tarifa, el cartel no aparece', async () => {
    await renderPago()
    expect(screen.queryByText(/NINGUNA tarifa cargada/)).toBeNull()
  })

  // ── #3a · el aviso de doble conteo explica cómo se destraba ──────────────────────
  it('el freno por horas dobles dice que NO se resuelve en la pestaña Horas', async () => {
    WORK_DAYS = [...WORK_DAYS, {
      employee_id: 'e1', work_date: '2026-08-03', local: 'santa-teresa', hours: 8,
      es_feriado: false, source: 'biotime' as const, flags: null, created_at: '', updated_at: '',
    }]
    render(<SalariosPago employees={[ANA, BENITO, INACTIVO]} />)
    await screen.findByDisplayValue('104')
    // el "no" va en <strong>: se compara el texto del párrafo entero
    const explica = await screen.findByText(/se destraba resolviendo marcas/i)
    expect(explica.textContent?.replace(/\s+/g, ' '))
      .toMatch(/no se destraba resolviendo marcas en la pestaña Horas.*confirmás acá abajo/i)
  })

  // A8 · paso consciente: las horas que no midió el reloj no frenan la nómina, pero quien
  // paga tiene que decir que sí en su propio confirm. Cancelar ahí NO paga.
  const DIA_INCOMPLETO = {
    employee_id: 'e2', work_date: '2026-08-03', local: 'santa-teresa', hours: 7,
    es_feriado: false, source: 'biotime' as const,
    flags: { pares: 1, horas_pares: 4, tramos_sin_cerrar: 1, horas_default: 3, horas_origen: 'mixto' },
    created_at: '', updated_at: '',
  }

  it('las jornadas incompletas NO bloquean, pero piden confirmación aparte al pagar', async () => {
    window.confirm = vi.fn(() => true)
    WORK_DAYS = [...WORK_DAYS, DIA_INCOMPLETO]
    await renderPago()

    const btn = screen.getByText('Marcar pagado') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)

    await waitFor(() => expect(pagar).toHaveBeenCalledTimes(1))
    const confirms = (window.confirm as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string)
    expect(confirms[0]).toMatch(/1 día\(s\) con marca incompleta contados a 3 h/)
    expect(confirms[0]).toMatch(/1 tramo\(s\) sin cerrar = 3 h que no midió el reloj/)
    expect(confirms.at(-1)).toMatch(/como PAGADO/)
  })

  it('cancelar la confirmación de las jornadas incompletas NO paga', async () => {
    window.confirm = vi.fn(() => false)
    WORK_DAYS = [...WORK_DAYS, DIA_INCOMPLETO]
    await renderPago()
    fireEvent.click(screen.getByText('Marcar pagado'))
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1))
    expect(pagar).not.toHaveBeenCalled()
  })

  // El archivo del banco es lo que MUEVE la plata; "Marcar pagado" es solo el registro.
  it('el bloqueo por horas dobles también frena el Excel del banco', async () => {
    WORK_DAYS = [
      ...WORK_DAYS,
      { employee_id: 'e1', work_date: '2026-08-03', local: 'santa-teresa', hours: 8,
        es_feriado: false, source: 'biotime', flags: null, created_at: '', updated_at: '' },
    ]
    render(<SalariosPago employees={[ANA, BENITO, INACTIVO]} />)
    await screen.findByDisplayValue('104')
    expect((screen.getByText('Descargar Excel para el banco') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText(/Revisé las horas de 1 empleado/))
    expect((screen.getByText('Descargar Excel para el banco') as HTMLButtonElement).disabled).toBe(false)
  })

  // Resolver la bandeja no cambia un colón de lo que se paga: la señal de las 3 h sale de
  // work_days.flags, no del estado de la excepción.
  it('avisa las horas puestas por la regla aunque la bandeja esté limpia', async () => {
    window.confirm = vi.fn(() => true)
    EXCS = [exc({ id: 'x1', tipo: 'impar', estado: 'resuelta', resuelto_by: 'u-1' })]
    WORK_DAYS = [
      ...WORK_DAYS,
      { employee_id: 'e2', work_date: '2026-08-03', local: 'santa-teresa', hours: 7,
        es_feriado: false, source: 'biotime',
        flags: { pares: 1, horas_pares: 4, tramos_sin_cerrar: 1, horas_default: 3, horas_origen: 'mixto' },
        created_at: '', updated_at: '' },
    ]
    await renderPago()
    expect(screen.queryByText(/fichaje incompleto/)).toBeNull()
    expect(await screen.findByText(/tramo\(s\) sin cerrar/)).toBeTruthy()
    fireEvent.click(screen.getByText('Marcar pagado'))
    await waitFor(() => expect(pagar).toHaveBeenCalledTimes(1))
    // el paso consciente de A8 va en su PROPIO confirm, antes del de pagar
    expect((window.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toMatch(/1 día\(s\) con marca incompleta contados a 3 h/)
  })

  // La fila editable comparte PK con la jornada del último día: el upsert la PISA. Si el
  // cálculo no lo descuenta, el total guardado queda por debajo del tecleado.
  it('editar el total no se come la jornada derivada del último día', async () => {
    WORK_DAYS = [
      { employee_id: 'e1', work_date: '2026-08-14', local: 'santa-teresa', hours: 72,
        es_feriado: false, source: 'biotime', flags: null, created_at: '', updated_at: '' },
      { employee_id: 'e1', work_date: '2026-08-15', local: 'santa-teresa', hours: 8,
        es_feriado: false, source: 'biotime', flags: null, created_at: '', updated_at: '' },
    ]
    render(<SalariosPago employees={[ANA, BENITO, INACTIVO]} />)
    const input = await screen.findByDisplayValue('80')
    fireEvent.change(input, { target: { value: '82' } })
    fireEvent.blur(input)

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
    // 82 tecleadas − 72 que sobreviven = 10 en la fila manual (que reemplaza a las 8).
    // Con el bug era 82 − 80 = 2, y el total recargado daba 74: 8 h de menos.
    expect(upsert.mock.calls[0][0]).toMatchObject({
      employee_id: 'e1', work_date: '2026-08-15', local: 'santa-teresa', hours: 10,
    })
  })

  it('las excepciones YA resueltas no avisan nada', async () => {
    window.confirm = vi.fn(() => true)
    EXCS = [exc({ id: 'x1', tipo: 'impar', estado: 'resuelta', resuelto_by: 'u-1' })]
    await renderPago()
    expect(screen.queryByText(/fichaje incompleto/)).toBeNull()
    expect((screen.getByText('Marcar pagado') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('Marcar pagado'))
    await waitFor(() => expect(pagar).toHaveBeenCalledTimes(1))
  })
})
