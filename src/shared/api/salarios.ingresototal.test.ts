import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Employee, WorkDay } from '../types/database'

// Salarios · consolidado con ingreso total (salario + propinas). MOSTRAR, no pagar.
//
// La regla que sostiene todo el archivo: las propinas se muestran y NADA más. Ya se pagan
// por su propio camino (efectivo / Caja), así que sumarlas al neto sería pagarlas dos
// veces. Los tests de no-regresión de abajo son los que lo demuestran.

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
    limit: rec('limit'), single: rec('single'),
    then: (onOk: (r: unknown) => unknown) =>
      Promise.resolve(queues[table]?.shift() ?? { data: [], error: null }).then(onOk),
  }
  return q
}

vi.mock('./supabase', () => ({ supabase: { from: (table: string) => makeQ(table) } }))
// tips.ts arrastra la caché offline; acá solo se prueba la lectura, así que el envoltorio
// se vuelve transparente (si no, el segundo test leería el resultado del primero).
vi.mock('../offline/cache', () => ({ cachedFetch: (_k: string, fn: () => unknown) => fn() }))
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn() }))

import { sumPayoutsPorEmpleado, getTipPayoutsPorEmpleado } from './tips'
import { consolidarPeriodo, ingresoTotalDe, LOCAL_DEFAULT } from './salarios'

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(queues)) delete queues[k]
})

const lastCall = (table: string) => [...calls].reverse().find(c => c.table === table)!
const opArgs = (c: Call, fn: string) => c.ops.find(o => o.fn === fn)?.args

const emp = (over: Partial<Employee> & { id: string; full_name: string }): Employee =>
  ({ role: 'salonero', profile_id: null, is_active: true, pos_name: null,
     hourly_rate_crc: 0, fixed_salary_crc: 0,
     created_at: '', updated_at: '', ...over }) as Employee

const wd = (over: Partial<WorkDay> & { employee_id: string; work_date: string }): WorkDay =>
  ({ local: LOCAL_DEFAULT, hours: 0, es_feriado: false, source: 'manual',
     flags: null, created_at: '', updated_at: '', ...over }) as WorkDay

// ── La suma de propinas (pura) ──────────────────────────────────────────────────

describe('sumPayoutsPorEmpleado', () => {
  it('suma el payout de cada persona a lo largo de todos los turnos', () => {
    const m = sumPayoutsPorEmpleado([
      { tip_entries: [
        { employee_id: 'e1', payout_crc: 12_000 },
        { employee_id: 'e2', payout_crc:  8_500 },
      ] },
      { tip_entries: [
        { employee_id: 'e1', payout_crc: 15_000 },
      ] },
    ])
    expect(m.get('e1')).toBe(27_000)
    expect(m.get('e2')).toBe(8_500)
  })

  it('quien no cobró propinas no aparece → el consolidado lo lee como 0', () => {
    const m = sumPayoutsPorEmpleado([{ tip_entries: [{ employee_id: 'e1', payout_crc: 1_000 }] }])
    expect(m.get('e3')).toBeUndefined()
    expect(Number(m.get('e3')) || 0).toBe(0)
  })

  it('tolera turnos sin entries, payout null y entries sin empleado resuelto', () => {
    const m = sumPayoutsPorEmpleado([
      { tip_entries: null },
      { tip_entries: [] },
      { tip_entries: [
        { employee_id: 'e1', payout_crc: null },      // todavía sin repartir
        { employee_id: null, payout_crc: 9_999 },     // sin empleado: no hay a quién sumarle
        { employee_id: 'e1', payout_crc: 5_000 },
      ] },
    ])
    expect(m.get('e1')).toBe(5_000)
    expect([...m.keys()]).toEqual(['e1'])
  })
})

describe('getTipPayoutsPorEmpleado', () => {
  it('pide SOLO turnos cerrados dentro del rango del período', async () => {
    enqueue('tip_sessions', { data: [
      { id: 's1', session_date: '2026-08-03', tip_entries: [{ employee_id: 'e1', payout_crc: 12_000 }] },
    ] })
    const m = await getTipPayoutsPorEmpleado('2026-08-01', '2026-08-15')

    const c = lastCall('tip_sessions')
    expect(opArgs(c, 'gte')).toEqual(['session_date', '2026-08-01'])
    expect(opArgs(c, 'lte')).toEqual(['session_date', '2026-08-15'])
    // un turno abierto se sigue repartiendo: su payout puede cambiar en el próximo guardado
    expect(opArgs(c, 'eq')).toEqual(['status', 'closed'])
    expect(m.get('e1')).toBe(12_000)
  })

  it('sin turnos en el rango devuelve un Map vacío, no explota', async () => {
    enqueue('tip_sessions', { data: [] })
    await expect(getTipPayoutsPorEmpleado('2026-09-01', '2026-09-15')).resolves.toEqual(new Map())
  })

  // Fallar fuerte y no devolver 0: un ₡0 falso le diría a alguien que no le tocó nada.
  it('si la lectura falla, propaga el error en vez de fingir ₡0', async () => {
    enqueue('tip_sessions', { error: { message: 'permission denied for table tip_entries' } })
    await expect(getTipPayoutsPorEmpleado('2026-08-01', '2026-08-15')).rejects.toThrow(/permission denied/)
  })
})

// ── El consolidado ──────────────────────────────────────────────────────────────

describe('consolidarPeriodo · ingreso total', () => {
  const period = { fecha_fin: '2026-08-15' }
  const ANA    = emp({ id: 'e1', full_name: 'ANA', hourly_rate_crc: 2_600 })
  const BENITO = emp({ id: 'e2', full_name: 'BENITO', fixed_salary_crc: 185_000 })
  const HORAS  = [wd({ employee_id: 'e1', work_date: '2026-08-15', hours: 96 })]

  it('ingresoTotal = salario + propinas, y el salario NO se mueve', () => {
    const [ana, benito] = consolidarPeriodo(
      [ANA, BENITO], HORAS, period, LOCAL_DEFAULT,
      new Map([['e1', 27_000], ['e2', 8_500]]),
    )
    expect(ana.neto).toBe(96 * 2_600)                       // el salario, intacto
    expect(ana.propinasPeriodo).toBe(27_000)
    expect(ana.ingresoTotal).toBe(96 * 2_600 + 27_000)

    expect(benito.neto).toBe(185_000)
    expect(benito.ingresoTotal).toBe(185_000 + 8_500)
  })

  it('quien no cobró propinas queda en 0 y su ingreso total es su salario', () => {
    const [ana] = consolidarPeriodo([ANA], HORAS, period, LOCAL_DEFAULT, new Map())
    expect(ana.propinasPeriodo).toBe(0)
    expect(ana.ingresoTotal).toBe(ana.neto)
  })

  it('sin el mapa de propinas se comporta igual que antes de mostrarlas', () => {
    const [ana] = consolidarPeriodo([ANA], HORAS, period, LOCAL_DEFAULT)
    expect(ana.propinasPeriodo).toBe(0)
    expect(ana.ingresoTotal).toBe(ana.neto)
  })

  it('ingresoTotalDe tolera null/undefined sin ensuciar el número', () => {
    expect(ingresoTotalDe(100, 50)).toBe(150)
    expect(ingresoTotalDe(100, null as unknown as number)).toBe(100)
    expect(ingresoTotalDe(NaN, 50)).toBe(50)
  })
})

// ── NO-REGRESIÓN: la plata que sale no cambió ───────────────────────────────────
// Es el corazón del pase. Si algún día alguien "mejora" el consolidado sumando las
// propinas al neto, esto tiene que ponerse rojo: se estarían pagando dos veces.

describe('las propinas NO tocan lo que se transfiere', () => {
  const period = { fecha_fin: '2026-08-15' }
  const ANA    = emp({ id: 'e1', full_name: 'ANA', hourly_rate_crc: 2_600 })
  const BENITO = emp({ id: 'e2', full_name: 'BENITO', fixed_salary_crc: 185_000 })
  const HORAS  = [wd({ employee_id: 'e1', work_date: '2026-08-15', hours: 96 })]

  // Todo lo que la pantalla usa para transferir: el neto de cada línea (que alimenta el
  // Excel del banco y el payload de markPeriodPaid) y el total del período.
  const loQueSePaga = (l: ReturnType<typeof consolidarPeriodo>) =>
    l.map(x => ({ id: x.employee.id, neto: x.neto, nombreBanco: x.nombreBanco }))

  it('el neto por empleado es idéntico con y sin propinas', () => {
    const sin = consolidarPeriodo([ANA, BENITO], HORAS, period, LOCAL_DEFAULT)
    const con = consolidarPeriodo(
      [ANA, BENITO], HORAS, period, LOCAL_DEFAULT,
      new Map([['e1', 27_000], ['e2', 8_500]]),
    )
    expect(loQueSePaga(con)).toEqual(loQueSePaga(sin))
  })

  it('el total a transferir tampoco se mueve', () => {
    const total = (l: ReturnType<typeof consolidarPeriodo>) =>
      l.reduce((s, x) => s + Math.round(x.neto), 0)
    const sin = consolidarPeriodo([ANA, BENITO], HORAS, period, LOCAL_DEFAULT)
    const con = consolidarPeriodo(
      [ANA, BENITO], HORAS, period, LOCAL_DEFAULT, new Map([['e1', 999_999], ['e2', 999_999]]),
    )
    expect(total(con)).toBe(total(sin))
    expect(total(con)).toBe(96 * 2_600 + 185_000)
  })

  it('una propina gigantesca no cambia un colón del salario', () => {
    const [ana] = consolidarPeriodo([ANA], HORAS, period, LOCAL_DEFAULT, new Map([['e1', 10_000_000]]))
    expect(ana.neto).toBe(96 * 2_600)
    expect(ana.pagoHoras).toBe(96 * 2_600)
    expect(ana.fijo).toBe(0)
  })
})
