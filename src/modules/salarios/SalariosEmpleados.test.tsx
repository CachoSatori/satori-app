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

// El alias del homebanking (U0b) y la regla de horario (Capa 3) se guardan cada uno con su
// propia función: el payload de `updateEmployeePayroll` es un contrato cerrado (mig 055).
const setBanco   = vi.fn<(id: string, n: string | null) => Promise<void>>(async () => {})
const setHorario = vi.fn<(id: string, e: string | null, s: string | null) => Promise<void>>(async () => {})
// La guarda del período cerrado (ciclo de estados): la tarifa no tiene fecha, así que
// cambiarla con un período cerrado sin pagar le movería el neto por atrás. Deja pasar por
// defecto; la prueba que la ejercita le pone el rechazo.
const guardaTarifas = vi.fn<() => Promise<void>>(async () => {})
vi.mock('../../shared/api/supabase', () => ({ supabase: { from: () => ({}) } }))
// El módulo real, con las ESCRITURAS interceptadas: los helpers puros de Capa 3
// (`horaHabitualHHMM`) tienen que ser los DE VERDAD, porque la ficha los usa para pintar.
vi.mock('../../shared/api/salarios', async (orig) => ({
  ...(await orig<typeof import('../../shared/api/salarios')>()),
  updateEmployeeHomebankingName: (id: string, n: string | null) => setBanco(id, n),
  updateEmployeeHorasHabituales: (id: string, e: string | null, s: string | null) => setHorario(id, e, s),
  exigirTarifasEditables: () => guardaTarifas(),
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

// La EDICIÓN vive en Tarifas (v3): Personal quedó de solo lectura. Por eso el helper por
// defecto monta la vista de Tarifas — es donde están los botones que estas pruebas usan.
function renderList(employees: Employee[] = [ANA, BENITO]) {
  const onRefresh = vi.fn(async () => {})
  const view = render(<SalariosEmpleados employees={employees} onRefresh={onRefresh} vista="tarifas" />)
  return { onRefresh, view }
}

/** Personal: quién trabaja y en qué puesto. De SOLO LECTURA. */
function renderPersonal(employees: Employee[] = [ANA, BENITO]) {
  const onRefresh = vi.fn(async () => {})
  const view = render(<SalariosEmpleados employees={employees} onRefresh={onRefresh} vista="personal" />)
  return { onRefresh, view }
}

beforeEach(() => {
  updatePayroll.mockClear()
  create.mockClear()
  toggle.mockClear()
  setBanco.mockClear()
  setHorario.mockClear()
  guardaTarifas.mockClear()
  guardaTarifas.mockResolvedValue(undefined)
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
        vista="tarifas"
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
      // v3 · el alta de COCINA arranca sin 10% de servicio (el default por puesto).
      // Salón y barra arrancan en true; ver el caso de abajo.
      participa_servicio: false,
      biotime_emp_code:   null,
      fecha_ingreso:      null,
    })
    expect(Object.keys(payload)).not.toContain('profile_id')
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('v3 · elegir un puesto de salón mueve el 10% a Sí en el alta', async () => {
    renderList()

    fireEvent.click(screen.getByText('+ Agregar empleado'))
    fireEvent.change(screen.getByPlaceholderText('Ej: JOSE'), { target: { value: 'karen' } })
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'salonero' } })
    fireEvent.click(screen.getByText('Crear empleado'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload.role).toBe('salonero')
    expect(payload.participa_servicio).toBe(true)
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

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ UNA SOLA FUENTE DEL HORARIO (v3 · fix del piloto)                                      ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
// El horario se editaba en DOS lados —acá y en Ficha— y el mismo dato terminaba distinto
// según dónde se mirara. Ahora Personal y Tarifas lo MUESTRAN y la Ficha es su única dueña.
// Estas pruebas son la red: si vuelve a aparecer un input de horario en esta pantalla, o si
// esta pantalla vuelve a escribir la regla, se ponen en rojo.
describe('Salarios · el horario se MUESTRA acá y se edita SOLO en Ficha', () => {
  const CON_REGLA = emp({
    id: 'e3', full_name: 'CARLA',
    hora_entrada_habitual: '08:00:00', hora_salida_habitual: '17:00:00',
  })

  it('muestra tipo y horas en 24 h, y dice «Flexible» en vez de fingir una hora', () => {
    renderPersonal([CON_REGLA, BENITO])
    expect(screen.getByText('Fijo · 08:00 → 17:00')).toBeTruthy()
    expect(screen.getByText('Flexible')).toBeTruthy()
  })

  it('Personal es de SOLO LECTURA: no hay botón Editar ni inputs de nómina', () => {
    renderPersonal()
    expect(screen.queryByText('Editar')).toBeNull()
    expect(screen.queryByLabelText('Tarifa por hora: ANA')).toBeNull()
    expect(screen.queryByLabelText('Código BioTime: ANA')).toBeNull()
    // Lo que SÍ es de Personal: quién trabaja.
    expect(screen.getAllByText('Desactivar').length).toBeGreaterThan(0)
    expect(screen.getByText('+ Agregar empleado')).toBeTruthy()
  })

  it('NINGUNA de las dos vistas tiene input de horario — ni editando una fila', () => {
    renderPersonal([CON_REGLA])
    expect(screen.queryByLabelText('Hora de entrada habitual: CARLA')).toBeNull()

    renderList([CON_REGLA])
    fireEvent.click(screen.getByText('Editar'))
    expect(screen.queryByLabelText('Hora de entrada habitual: CARLA')).toBeNull()
    expect(screen.queryByLabelText('Hora de salida habitual: CARLA')).toBeNull()
  })

  it('guardar desde Tarifas NUNCA escribe la regla de horario', async () => {
    renderList([CON_REGLA])
    fireEvent.click(screen.getByText('Editar'))
    fireEvent.change(screen.getByLabelText('Tarifa por hora: CARLA'), { target: { value: '3000' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(updatePayroll).toHaveBeenCalled())
    expect(setHorario).not.toHaveBeenCalled()
  })

  it('el alta tampoco escribe horario: se carga después, en Ficha', async () => {
    create.mockResolvedValueOnce({ id: 'e9' } as Employee)
    renderList()
    fireEvent.click(screen.getByText('+ Agregar empleado'))
    expect(screen.queryByLabelText('Hora de entrada habitual: nuevo empleado')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Ej: JOSE'), { target: { value: 'jose' } })
    fireEvent.click(screen.getByText('Crear empleado'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(setHorario).not.toHaveBeenCalled()
    expect(create.mock.calls[0][0]).not.toHaveProperty('hora_entrada_habitual')
  })

  it('lo que la Ficha guarda es lo que Personal muestra (una sola fuente)', () => {
    // Ficha guarda → el módulo relee `employees` → Personal pinta el dato nuevo.
    const { view } = renderPersonal([CON_REGLA])
    expect(screen.getByText('Fijo · 08:00 → 17:00')).toBeTruthy()

    view.rerender(
      <SalariosEmpleados
        employees={[{ ...CON_REGLA, hora_entrada_habitual: '16:00:00', hora_salida_habitual: '23:30:00' }]}
        onRefresh={async () => {}}
        vista="personal"
      />,
    )
    expect(screen.getByText('Fijo · 16:00 → 23:30')).toBeTruthy()
    expect(screen.queryByText('Fijo · 08:00 → 17:00')).toBeNull()
  })

  it('la tabla apunta a dónde se edita, para que nadie lo busque acá', () => {
    renderPersonal()
    expect(screen.getAllByTitle('El horario se edita en la pestaña Ficha').length).toBeGreaterThan(0)
  })
})

// ── El período cerrado congela las tarifas ────────────────────────────────────────
describe('Salarios · Empleados / Tarifas — guarda del período cerrado', () => {
  it('con un período cerrado sin pagar, cambiar la tarifa REBOTA y no persiste', async () => {
    guardaTarifas.mockRejectedValue(new Error('El período 2026-08-01 → 2026-08-15 está cerrado y todavía no se pagó'))
    renderList()
    fireEvent.click(screen.getAllByText('Editar')[0])   // ANA
    fireEvent.change(screen.getByLabelText('Tarifa por hora: ANA'), { target: { value: '3000' } })
    fireEvent.click(screen.getByText('Guardar'))

    expect(await screen.findByText(/cerrado y todavía no se pagó/)).toBeTruthy()
    expect(updatePayroll).not.toHaveBeenCalled()
  })

  it('tocar SOLO el código de BioTime no dispara la guarda: no es plata', async () => {
    renderList()
    fireEvent.click(screen.getAllByText('Editar')[0])   // ANA, tarifa intacta
    fireEvent.change(screen.getByLabelText('Código BioTime: ANA'), { target: { value: '31' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(updatePayroll).toHaveBeenCalledTimes(1))
    expect(guardaTarifas).not.toHaveBeenCalled()
  })
})
