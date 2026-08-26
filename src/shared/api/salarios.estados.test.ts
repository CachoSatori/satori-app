import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PunchException, SalaryPeriod, WorkDay } from '../types/database'

// Salarios · ciclo de estados del período: abierto → en_revision → cerrado → pagado.
//
// Lo que se prueba acá es CONTROL, no plata: qué transición se permite, qué guarda frena
// y qué queda escrito. La matemática del neto vive en salarios.test.ts y no se toca.
//
// El mock del cliente es el mismo de salarios.test.ts (cola por tabla + registro de
// operaciones): una tabla sin nada encolado devuelve `{ data: [], error: null }`.

interface Op { fn: string; args: unknown[] }
interface Call { table: string; ops: Op[] }

const calls: Call[] = []
const queues: Record<string, { data: unknown; error: unknown }[]> = {}

function enqueue(table: string, res: { data?: unknown; error?: unknown }) {
  ;(queues[table] ??= []).push({ data: res.data ?? null, error: res.error ?? null })
}

function makeQ(table: string) {
  const call: Call = { table, ops: [] }
  calls.push(call)
  const rec = (fn: string) => (...args: unknown[]) => { call.ops.push({ fn, args }); return q }
  const q = {
    select: rec('select'), insert: rec('insert'), upsert: rec('upsert'), update: rec('update'),
    eq: rec('eq'), gte: rec('gte'), lte: rec('lte'), lt: rec('lt'), order: rec('order'),
    single: rec('single'),
    then: (onOk: (r: unknown) => unknown) =>
      Promise.resolve(queues[table]?.shift() ?? { data: [], error: null }).then(onOk),
  }
  return q
}

vi.mock('./supabase', () => ({
  supabase: { from: (table: string) => makeQ(table) },
}))

import {
  setPeriodoEnRevision, cerrarPeriodo, reabrirPeriodo, markPeriodPaid,
  upsertWorkDay, overrideHorasDia, derivarWorkDays, periodoCongeladoEn, periodoCerradoSinPagar,
  exigirTarifasEditables,
  puedeTransicionar, estaCongelado, motivoBloqueoExcepciones, avisoHorasDefault,
  excepcionesSinResolver,
  semaforoPago, LOCAL_DEFAULT,
} from './salarios'

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(queues)) delete queues[k]
})

const lastCall = (table: string) => [...calls].reverse().find(c => c.table === table)!
const opArgs = (c: Call, fn: string) => c.ops.find(o => o.fn === fn)?.args
const callsA = (table: string) => calls.filter(c => c.table === table)

function period(over: Partial<SalaryPeriod> = {}): SalaryPeriod {
  return {
    id: 'per-1', tipo: 'quincena', fecha_ini: '2026-08-01', fecha_fin: '2026-08-15',
    estado: 'abierto', local: null,
    created_by: null, closed_by: null, closed_at: null, paid_by: null, paid_at: null,
    reopened_by: null, reopened_at: null, reopen_motivo: null,
    created_at: '', updated_at: '', ...over,
  } as SalaryPeriod
}

function exc(over: Partial<PunchException> & { id: string; tipo: PunchException['tipo'] }): PunchException {
  return {
    employee_id: 'e1', emp_code: null, work_date: '2026-08-03', local: LOCAL_DEFAULT,
    detalle: null, estado: 'abierta', resuelto_by: null, resuelto_at: null,
    created_at: '', updated_at: '', ...over,
  } as PunchException
}

function wdBiotime(over: Partial<WorkDay> = {}): WorkDay {
  return {
    employee_id: 'e1', work_date: '2026-08-03', local: LOCAL_DEFAULT, hours: 8,
    es_feriado: false, source: 'biotime',
    flags: { tramos_sin_cerrar: 1, horas_default: 3, horas_pares: 5 },
    created_at: '', updated_at: '', ...over,
  } as WorkDay
}

// El período limpio: la nómina existe, no hay marcas abiertas ni horas de la regla.
function periodoLimpio(estado: SalaryPeriod['estado']) {
  enqueue('salary_periods', { data: period({ estado }) })     // lectura
  enqueue('employees', { data: [{ id: 'e1', is_active: true }] })
  // work_days y punch_exceptions caen al default: []
}

// ── Las reglas puras ────────────────────────────────────────────────────────────

describe('puedeTransicionar · sin saltos', () => {
  it('el camino normal está permitido', () => {
    expect(puedeTransicionar('abierto', 'en_revision')).toBe(true)
    expect(puedeTransicionar('en_revision', 'cerrado')).toBe(true)
    expect(puedeTransicionar('cerrado', 'pagado')).toBe(true)
  })

  it('cerrar sin pasar por revisión sí (revisar es opcional); pagar sin cerrar NO', () => {
    expect(puedeTransicionar('abierto', 'cerrado')).toBe(true)
    expect(puedeTransicionar('abierto', 'pagado')).toBe(false)
    expect(puedeTransicionar('en_revision', 'pagado')).toBe(false)
  })

  it('la única vuelta atrás es a revisión (la reapertura)', () => {
    expect(puedeTransicionar('cerrado', 'en_revision')).toBe(true)
    expect(puedeTransicionar('pagado', 'en_revision')).toBe(true)
    expect(puedeTransicionar('pagado', 'cerrado')).toBe(false)
    expect(puedeTransicionar('cerrado', 'abierto')).toBe(false)
  })

  it('congelado = cerrado o pagado', () => {
    expect(estaCongelado('cerrado')).toBe(true)
    expect(estaCongelado('pagado')).toBe(true)
    expect(estaCongelado('abierto')).toBe(false)
    expect(estaCongelado('en_revision')).toBe(false)
  })
})

describe('motivoBloqueoExcepciones', () => {
  const limpio = semaforoPago([], [], '2026-08-15', ['e1'])

  it('sin nada abierto no hay motivo: se puede avanzar', () => {
    expect(excepcionesSinResolver(limpio)).toBe(0)
    expect(motivoBloqueoExcepciones(limpio, 'cerrar')).toBeNull()
  })

  it('cuenta las dos familias que frenan y dice qué hacer', () => {
    const s = semaforoPago(
      [exc({ id: 'a', tipo: 'impar' }), exc({ id: 'b', tipo: 'sin_mapear', employee_id: null, emp_code: '77' })],
      [wdBiotime()],
      '2026-08-15',
      ['e1'],
    )
    // el día incompleto está ahí, pero NO suma al bloqueo (A8)
    expect(s.diasIncompletos).toBe(1)
    expect(excepcionesSinResolver(s)).toBe(2)   // 1 fichaje + 1 sin_mapear
    const msg = motivoBloqueoExcepciones(s, 'cerrar')!
    expect(msg).toMatch(/2 fichaje\(s\) sin resolver/)
    expect(msg).toMatch(/antes de cerrar/)
    expect(msg).not.toMatch(/regla/)
  })

  // A8 · paso consciente: las 3 h por tramo avisan, no frenan.
  it('las horas puestas por la regla NO bloquean: avisan', () => {
    const s = semaforoPago([], [wdBiotime()], '2026-08-15', ['e1'])
    expect(s.diasIncompletos).toBe(1)
    expect(excepcionesSinResolver(s)).toBe(0)
    expect(motivoBloqueoExcepciones(s, 'cerrar')).toBeNull()

    const aviso = avisoHorasDefault(s, 'cerrar')!
    expect(aviso).toMatch(/1 jornada\(s\) con horas puestas por la regla/)
    expect(aviso).toMatch(/3 h que no midió el reloj/)
    expect(aviso).toMatch(/Se puede cerrar igual/)
  })

  it('sin días incompletos no hay aviso que mostrar', () => {
    expect(avisoHorasDefault(semaforoPago([], [], '2026-08-15', ['e1']), 'pagar')).toBeNull()
  })

  it('las horas dobles NO entran acá: tienen su propio destrabe en la pantalla', () => {
    const s = semaforoPago(
      [],
      [wdBiotime({ flags: null }), { ...wdBiotime({ source: 'manual', work_date: '2026-08-15', flags: null }) }],
      '2026-08-15',
      ['e1'],
    )
    expect(s.dobles).toEqual(['e1'])
    expect(motivoBloqueoExcepciones(s, 'cerrar')).toBeNull()
  })
})

// ── Las transiciones contra la base ─────────────────────────────────────────────

describe('setPeriodoEnRevision', () => {
  it('abierto → en_revision, sin tocar el rastro de reapertura', async () => {
    enqueue('salary_periods', { data: period({ estado: 'abierto' }) })
    enqueue('salary_periods', { data: period({ estado: 'en_revision' }) })
    const p = await setPeriodoEnRevision('per-1', 'u-contador')
    expect(p.estado).toBe('en_revision')
    const patch = opArgs(lastCall('salary_periods'), 'update')![0] as Record<string, unknown>
    expect(patch).toEqual({ estado: 'en_revision' })
  })

  it('un período ya cerrado no vuelve a revisión por esta puerta (esa es la reapertura)', async () => {
    enqueue('salary_periods', { data: period({ estado: 'cerrado' }) })
    // `cerrado → en_revision` es una transición válida, pero sin motivo no es reapertura:
    // descongelar por acá dejaría el período editable sin rastro de quién ni por qué.
    await expect(setPeriodoEnRevision('per-1', 'u-1')).rejects.toThrow(/reabrirlo con un motivo/i)
    expect(callsA('salary_periods').some(c => c.ops.some(o => o.fn === 'update'))).toBe(false)
  })
})

describe('cerrarPeriodo', () => {
  it('cierra y firma quién y cuándo', async () => {
    periodoLimpio('en_revision')
    enqueue('salary_periods', { data: period({ estado: 'cerrado' }) })
    const p = await cerrarPeriodo('per-1', 'u-contador')
    expect(p.estado).toBe('cerrado')
    const patch = opArgs(lastCall('salary_periods'), 'update')![0] as Record<string, unknown>
    expect(patch.estado).toBe('cerrado')
    expect(patch.closed_by).toBe('u-contador')
    expect(typeof patch.closed_at).toBe('string')
  })

  it('también se puede cerrar directo desde abierto (revisar es opcional)', async () => {
    periodoLimpio('abierto')
    enqueue('salary_periods', { data: period({ estado: 'cerrado' }) })
    await expect(cerrarPeriodo('per-1', 'u-1')).resolves.toMatchObject({ estado: 'cerrado' })
  })

  it('REBOTA si quedan fichajes sin resolver, y no escribe nada', async () => {
    enqueue('salary_periods', { data: period({ estado: 'en_revision' }) })
    enqueue('employees', { data: [{ id: 'e1', is_active: true }] })
    enqueue('punch_exceptions', { data: [exc({ id: 'a', tipo: 'impar' })] })

    await expect(cerrarPeriodo('per-1', 'u-1')).rejects.toThrow(/sin resolver.*antes de cerrar/i)
    expect(callsA('salary_periods').some(c => c.ops.some(o => o.fn === 'update'))).toBe(false)
  })

  // A8: el día con horas de la regla no frena el cierre — el aviso lo da la pantalla.
  it('cierra igual con jornadas de horas por defecto (A8: aviso, no bloqueo)', async () => {
    enqueue('salary_periods', { data: period({ estado: 'abierto' }) })
    enqueue('employees', { data: [{ id: 'e1', is_active: true }] })
    enqueue('work_days', { data: [wdBiotime()] })
    enqueue('salary_periods', { data: period({ estado: 'cerrado' }) })

    await expect(cerrarPeriodo('per-1', 'u-1')).resolves.toMatchObject({ estado: 'cerrado' })
  })

  it('pero una marca sin mapear sí lo frena', async () => {
    enqueue('salary_periods', { data: period({ estado: 'abierto' }) })
    enqueue('employees', { data: [{ id: 'e1', is_active: true }] })
    enqueue('punch_exceptions', { data: [exc({ id: 'a', tipo: 'sin_mapear', employee_id: null, emp_code: '77' })] })

    await expect(cerrarPeriodo('per-1', 'u-1')).rejects.toThrow(/sin resolver.*antes de cerrar/i)
    expect(callsA('salary_periods').some(c => c.ops.some(o => o.fn === 'update'))).toBe(false)
  })

  it('un período ya cerrado no se cierra dos veces', async () => {
    enqueue('salary_periods', { data: period({ estado: 'cerrado' }) })
    await expect(cerrarPeriodo('per-1', 'u-1')).rejects.toThrow(/ya está cerrado/i)
  })

  it('un pagado no se puede cerrar: primero se reabre', async () => {
    enqueue('salary_periods', { data: period({ estado: 'pagado' }) })
    await expect(cerrarPeriodo('per-1', 'u-1')).rejects.toThrow(/No se puede pasar un período de pagado a cerrado/i)
  })
})

describe('reabrirPeriodo', () => {
  it('cerrado → en_revision dejando el motivo, quién y cuándo', async () => {
    enqueue('salary_periods', { data: period({ estado: 'cerrado' }) })
    enqueue('salary_periods', { data: period({ estado: 'en_revision', reopen_motivo: 'faltaba fichaje de NACHO' }) })

    const p = await reabrirPeriodo('per-1', 'u-contador', '  faltaba fichaje de NACHO  ')
    expect(p.estado).toBe('en_revision')
    const patch = opArgs(lastCall('salary_periods'), 'update')![0] as Record<string, unknown>
    expect(patch.estado).toBe('en_revision')
    expect(patch.reopened_by).toBe('u-contador')
    expect(patch.reopen_motivo).toBe('faltaba fichaje de NACHO')   // recortado
    expect(typeof patch.reopened_at).toBe('string')
  })

  it('un período PAGADO también se reabre (y los pagos registrados no se tocan)', async () => {
    enqueue('salary_periods', { data: period({ estado: 'pagado' }) })
    enqueue('salary_periods', { data: period({ estado: 'en_revision' }) })
    await reabrirPeriodo('per-1', 'u-owner', 'se pagó de menos a SELENA')
    expect(callsA('employee_payments')).toHaveLength(0)
    expect(callsA('salary_lines')).toHaveLength(0)
  })

  it('sin motivo no se reabre, y ni siquiera lee el período', async () => {
    await expect(reabrirPeriodo('per-1', 'u-1', '   ')).rejects.toThrow(/necesita un motivo/i)
    expect(calls).toHaveLength(0)
  })

  it('un período abierto no se "reabre"', async () => {
    enqueue('salary_periods', { data: period({ estado: 'abierto' }) })
    await expect(reabrirPeriodo('per-1', 'u-1', 'me equivoqué')).rejects.toThrow(/cerrado o pagado/i)
  })
})

// ── El pago: sin saltos y sin fichajes abiertos ─────────────────────────────────

describe('markPeriodPaid · guardas del ciclo', () => {
  const lineas = [{ employee_id: 'e1', monto_neto: 100_000, horas: 40, hourly_rate: 2500, fijo: 0 }]

  it('no se paga un período abierto: primero hay que cerrarlo', async () => {
    enqueue('salary_periods', { data: { estado: 'abierto', fecha_ini: '2026-08-01', fecha_fin: '2026-08-15' } })
    await expect(markPeriodPaid('per-1', lineas, 'u-owner')).rejects.toThrow(/Solo se paga un período cerrado/i)
    expect(callsA('employee_payments')).toHaveLength(0)
  })

  it('no se paga con fichajes sin resolver, aunque el período esté cerrado', async () => {
    enqueue('salary_periods', { data: { estado: 'cerrado', fecha_ini: '2026-08-01', fecha_fin: '2026-08-15' } })
    enqueue('employees', { data: [{ id: 'e1', is_active: true }] })
    enqueue('punch_exceptions', { data: [exc({ id: 'a', tipo: 'impar' })] })

    await expect(markPeriodPaid('per-1', lineas, 'u-owner')).rejects.toThrow(/sin resolver.*antes de pagar/i)
    expect(callsA('employee_payments')).toHaveLength(0)
  })

  it('paga con jornadas de horas por defecto: A8 avisa en pantalla, no frena la API', async () => {
    enqueue('salary_periods', { data: { estado: 'cerrado', fecha_ini: '2026-08-01', fecha_fin: '2026-08-15' } })
    enqueue('employees', { data: [{ id: 'e1', is_active: true }] })
    enqueue('work_days', { data: [wdBiotime()] })
    enqueue('employee_payments', {})
    enqueue('salary_lines', {})
    enqueue('salary_periods', {})

    await expect(markPeriodPaid('per-1', lineas, 'u-owner')).resolves.toBe(1)
  })

  it('cerrado y limpio: paga', async () => {
    enqueue('salary_periods', { data: { estado: 'cerrado', fecha_ini: '2026-08-01', fecha_fin: '2026-08-15' } })
    enqueue('employees', { data: [{ id: 'e1', is_active: true }] })
    enqueue('employee_payments', {})
    enqueue('salary_lines', {})
    enqueue('salary_periods', {})

    await expect(markPeriodPaid('per-1', lineas, 'u-owner')).resolves.toBe(1)
    const upd = opArgs(lastCall('salary_periods'), 'update')![0] as Record<string, unknown>
    expect(upd.estado).toBe('pagado')
  })

  // El gate de rol vive en la RLS (mig 056 §7.4): el contador rebota al INSERTAR el pago,
  // no al cerrar. Acá se fija que el mensaje lo mande al lugar correcto.
  it('el contador rebota en la RLS al pagar y el período NO queda pagado', async () => {
    enqueue('salary_periods', { data: { estado: 'cerrado', fecha_ini: '2026-08-01', fecha_fin: '2026-08-15' } })
    enqueue('employees', { data: [{ id: 'e1', is_active: true }] })
    enqueue('employee_payments', { error: { code: '42501', message: 'row-level security' } })

    await expect(markPeriodPaid('per-1', lineas, 'u-contador'))
      .rejects.toThrow(/El pago lo marcan solo el dueño o el gerente/i)
    expect(callsA('salary_periods').some(c => c.ops.some(o => o.fn === 'update'))).toBe(false)
  })
})

// ── Congelado: qué deja de editarse ─────────────────────────────────────────────

describe('período cerrado = horas congeladas', () => {
  it('upsertWorkDay rebota y NO escribe', async () => {
    enqueue('salary_periods', { data: [period({ estado: 'cerrado' })] })
    await expect(
      upsertWorkDay({ employee_id: 'e1', work_date: '2026-08-10', local: LOCAL_DEFAULT, hours: 96 }),
    ).rejects.toThrow(/congeladas/i)
    expect(callsA('work_days')).toHaveLength(0)
  })

  it('overrideHorasDia rebota y NO escribe', async () => {
    enqueue('salary_periods', { data: [period({ estado: 'pagado' })] })
    await expect(
      overrideHorasDia({
        employee_id: 'e1', work_date: '2026-08-10', local: LOCAL_DEFAULT,
        hours: 7.5, userId: 'u-1', horas_biotime: 3,
      }),
    ).rejects.toThrow(/congeladas/i)
    expect(callsA('work_days')).toHaveLength(0)
  })

  it('con el período en revisión las horas se siguen editando', async () => {
    enqueue('salary_periods', { data: [period({ estado: 'en_revision' })] })
    enqueue('work_days', {})
    await upsertWorkDay({ employee_id: 'e1', work_date: '2026-08-10', local: LOCAL_DEFAULT, hours: 96 })
    expect(opArgs(lastCall('work_days'), 'upsert')![0]).toMatchObject({ hours: 96, source: 'manual' })
  })

  it('una fecha fuera de todo período cerrado se edita igual', async () => {
    enqueue('salary_periods', { data: [] })
    enqueue('work_days', {})
    await upsertWorkDay({ employee_id: 'e1', work_date: '2026-09-02', local: LOCAL_DEFAULT, hours: 8 })
    expect(callsA('work_days')).toHaveLength(1)
  })

  // El recálculo de BioTime escribe las MISMAS horas por otra puerta (RPC del servidor).
  it('derivarWorkDays no recalcula sobre un período congelado', async () => {
    enqueue('salary_periods', { data: [period({ estado: 'cerrado' })] })
    await expect(derivarWorkDays('2026-08-01', '2026-08-15')).rejects.toThrow(/congeladas/i)
  })

  it('periodoCongeladoEn acota por fecha y no rompe si la lectura falla', async () => {
    enqueue('salary_periods', { data: [period({ estado: 'cerrado' })] })
    const p = await periodoCongeladoEn('2026-08-10')
    expect(p?.id).toBe('per-1')
    const c = lastCall('salary_periods')
    expect(opArgs(c, 'lte')).toEqual(['fecha_ini', '2026-08-10'])
    expect(opArgs(c, 'gte')).toEqual(['fecha_fin', '2026-08-10'])

    enqueue('salary_periods', { error: { message: 'boom' } })
    await expect(periodoCongeladoEn('2026-08-10')).resolves.toBeNull()
  })
})

describe('período cerrado sin pagar = tarifas congeladas', () => {
  it('exigirTarifasEditables rebota mientras haya un cerrado sin pagar', async () => {
    enqueue('salary_periods', { data: [period({ estado: 'cerrado' })] })
    await expect(exigirTarifasEditables()).rejects.toThrow(/cerrado y todavía no se pagó/i)
  })

  it('sin ningún período cerrado, las tarifas se editan', async () => {
    enqueue('salary_periods', { data: [] })
    await expect(exigirTarifasEditables()).resolves.toBeUndefined()
  })

  // Un período PAGADO ya congeló su tarifa en salary_lines (mig 056): cambiarla hoy no le
  // mueve un colón a lo transferido, y bloquear para siempre sería absurdo.
  it('un período pagado no bloquea las tarifas', async () => {
    enqueue('salary_periods', { data: [] })   // el filtro pide estado='cerrado'
    await expect(periodoCerradoSinPagar()).resolves.toBeNull()
    expect(opArgs(lastCall('salary_periods'), 'eq')).toEqual(['estado', 'cerrado'])
  })
})
