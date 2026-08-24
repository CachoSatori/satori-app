import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Employee, EmployeeWageRate, WorkDay } from '../types/database'

// Salarios · U0b: contrato del ciclo de pago contra la base + la matemática del neto.
// El mock del cliente registra cada llamada (tabla + operaciones) y devuelve lo que la
// prueba encole, para poder forzar el 42501 de la RLS (el contador intentando pagar).

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
    eq: rec('eq'), gte: rec('gte'), lte: rec('lte'), order: rec('order'), single: rec('single'),
    then: (onOk: (r: unknown) => unknown) =>
      Promise.resolve(queues[table]?.shift() ?? { data: [], error: null }).then(onOk),
  }
  return q
}

vi.mock('./supabase', () => ({
  supabase: { from: (table: string) => makeQ(table) },
}))

import {
  getWorkDays, upsertWorkDay, markPeriodPaid, updateEmployeeHomebankingName,
  tarifaVigente, splitHorasPeriodo, netoDe, nombreBanco, consolidarPeriodo, LOCAL_DEFAULT,
} from './salarios'

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(queues)) delete queues[k]
})

const lastCall = (table: string) => [...calls].reverse().find(c => c.table === table)!
const opArgs = (c: Call, fn: string) => c.ops.find(o => o.fn === fn)?.args

function rate(over: Partial<EmployeeWageRate> & { employee_id: string; efectivo_desde: string }): EmployeeWageRate {
  return {
    id: `r-${over.employee_id}-${over.efectivo_desde}`, tipo: 'hora',
    hourly_rate_crc: 0, fixed_salary_crc: 0, nota: null,
    created_at: '', updated_at: '', ...over,
  } as EmployeeWageRate
}

function wd(over: Partial<WorkDay> & { employee_id: string; work_date: string }): WorkDay {
  return {
    local: LOCAL_DEFAULT, hours: 0, es_feriado: false, source: 'manual',
    created_at: '', updated_at: '', ...over,
  } as WorkDay
}

const emp = (over: Partial<Employee> & { id: string; full_name: string }): Employee =>
  ({ role: 'salonero', profile_id: null, is_active: true, pos_name: null,
     created_at: '', updated_at: '', ...over }) as Employee

// ── Matemática (pura) ───────────────────────────────────────────────────────────

describe('tarifaVigente', () => {
  const rates = [
    rate({ employee_id: 'e1', efectivo_desde: '2026-01-01', hourly_rate_crc: 2000 }),
    rate({ employee_id: 'e1', efectivo_desde: '2026-06-01', hourly_rate_crc: 2600 }),
    rate({ employee_id: 'e1', efectivo_desde: '2026-12-01', hourly_rate_crc: 3000 }),
    rate({ employee_id: 'e2', efectivo_desde: '2026-01-01', hourly_rate_crc: 9999 }),
  ]

  it('toma la de mayor efectivo_desde que YA regía a esa fecha', () => {
    expect(tarifaVigente(rates, 'e1', '2026-08-15')?.hourly_rate_crc).toBe(2600)
  })

  it('ignora las que arrancan después del período', () => {
    expect(tarifaVigente(rates, 'e1', '2026-11-30')?.hourly_rate_crc).toBe(2600)
  })

  it('sin tarifa que ya rija → null (no cae en la de otro empleado)', () => {
    expect(tarifaVigente(rates, 'e1', '2025-12-31')).toBeNull()
    expect(tarifaVigente(rates, 'e3', '2026-08-15')).toBeNull()
  })
})

describe('netoDe · horas × tarifa vigente + fijo', () => {
  it('suma las dos patas (el caso real cobra fijo Y por hora)', () => {
    expect(netoDe(80, rate({ employee_id: 'e1', efectivo_desde: '2026-01-01', hourly_rate_crc: 2600, fixed_salary_crc: 50_000 })))
      .toBe(80 * 2600 + 50_000)
  })
  it('sin tarifa vigente → 0', () => {
    expect(netoDe(80, null)).toBe(0)
  })
})

describe('splitHorasPeriodo', () => {
  const fin = '2026-08-15'
  const rows = [
    wd({ employee_id: 'e1', work_date: fin, hours: 90 }),                              // la manual del período
    wd({ employee_id: 'e1', work_date: '2026-08-03', hours: 8, source: 'biotime' }),   // futura F1d
    wd({ employee_id: 'e2', work_date: fin, hours: 40 }),
  ]
  it('separa la fila manual editable del resto y el total es la suma', () => {
    expect(splitHorasPeriodo(rows, 'e1', fin, LOCAL_DEFAULT))
      .toEqual({ manual: 90, otras: 8, pisadas: 0, total: 98 })
  })
  it('empleado sin horas → todo en cero', () => {
    expect(splitHorasPeriodo(rows, 'e9', fin, LOCAL_DEFAULT))
      .toEqual({ manual: 0, otras: 0, pisadas: 0, total: 0 })
  })
})

describe('nombreBanco · a quién le transfiere el banco', () => {
  it('manda el alias del homebanking', () => {
    expect(nombreBanco(emp({ id: 'e1', full_name: 'ANA', nombre_homebanking: 'ANA MARIA SOTO' }))).toBe('ANA MARIA SOTO')
  })
  it('sin alias (o vacío) cae al nombre del empleado', () => {
    expect(nombreBanco(emp({ id: 'e1', full_name: 'ANA' }))).toBe('ANA')
    expect(nombreBanco(emp({ id: 'e1', full_name: 'ANA', nombre_homebanking: '  ' }))).toBe('ANA')
  })
})

describe('consolidarPeriodo', () => {
  it('una línea por empleado con horas, tarifa vigente y neto', () => {
    const period = { fecha_fin: '2026-08-15' }
    const lineas = consolidarPeriodo(
      [emp({ id: 'e1', full_name: 'ANA' }), emp({ id: 'e2', full_name: 'BENITO', nombre_homebanking: 'BENITO PEREZ' })],
      [
        rate({ employee_id: 'e1', efectivo_desde: '2026-06-01', hourly_rate_crc: 2600 }),
        rate({ employee_id: 'e2', efectivo_desde: '2026-06-01', hourly_rate_crc: 0, fixed_salary_crc: 185_000, tipo: 'quincena' }),
      ],
      [wd({ employee_id: 'e1', work_date: '2026-08-15', hours: 96 })],
      period,
      LOCAL_DEFAULT,
    )
    expect(lineas.map(l => [l.employee.full_name, l.horas, l.neto, l.nombreBanco])).toEqual([
      ['ANA',    96, 96 * 2600, 'ANA'],
      ['BENITO',  0, 185_000,   'BENITO PEREZ'],
    ])
  })

  it('empleado sin tarifa vigente queda en 0 (no explota ni inventa)', () => {
    const lineas = consolidarPeriodo(
      [emp({ id: 'e9', full_name: 'NUEVO' })], [],
      [wd({ employee_id: 'e9', work_date: '2026-08-15', hours: 20 })],
      { fecha_fin: '2026-08-15' }, LOCAL_DEFAULT,
    )
    expect(lineas[0]).toMatchObject({ horas: 20, rate: null, neto: 0 })
  })
})

// ── Contra la base ──────────────────────────────────────────────────────────────

describe('getWorkDays', () => {
  it('filtra por el rango del período', async () => {
    enqueue('work_days', { data: [] })
    await getWorkDays('2026-08-01', '2026-08-15')
    const c = lastCall('work_days')
    expect(opArgs(c, 'gte')).toEqual(['work_date', '2026-08-01'])
    expect(opArgs(c, 'lte')).toEqual(['work_date', '2026-08-15'])
  })
})

describe('upsertWorkDay', () => {
  it('marca la fila como manual y hace upsert sobre la PK (empleado, día, local)', async () => {
    enqueue('work_days', {})
    await upsertWorkDay({ employee_id: 'e1', work_date: '2026-08-15', local: LOCAL_DEFAULT, hours: 96 })
    const [rows, opts] = opArgs(lastCall('work_days'), 'upsert')!
    expect(rows).toEqual({ employee_id: 'e1', work_date: '2026-08-15', local: LOCAL_DEFAULT, hours: 96, source: 'manual' })
    expect(opts).toEqual({ onConflict: 'employee_id,work_date,local' })
  })
})

describe('updateEmployeeHomebankingName', () => {
  it('guarda el alias recortado', async () => {
    enqueue('employees', {})
    await updateEmployeeHomebankingName('e1', '  ANA MARIA SOTO ')
    expect(opArgs(lastCall('employees'), 'update')).toEqual([{ nombre_homebanking: 'ANA MARIA SOTO' }])
  })
  it('vacío se guarda como null, no como cadena vacía', async () => {
    enqueue('employees', {})
    await updateEmployeeHomebankingName('e1', '   ')
    expect(opArgs(lastCall('employees'), 'update')).toEqual([{ nombre_homebanking: null }])
  })
})

describe('markPeriodPaid', () => {
  const lineas = [
    { employee_id: 'e1', monto_neto: 249_600 },
    { employee_id: 'e2', monto_neto: 0 },        // no se paga ₡0
    { employee_id: 'e3', monto_neto: 185_000.4 },
  ]

  it('un pago por empleado con neto > 0 (transferencia) y recién después el período a pagado', async () => {
    enqueue('salary_periods', { data: { estado: 'cerrado' } })   // relectura del estado
    enqueue('employee_payments', {})
    enqueue('salary_periods', {})                                 // update
    const n = await markPeriodPaid('per-1', lineas, 'u-owner')

    expect(n).toBe(2)
    const rows = opArgs(lastCall('employee_payments'), 'insert')![0] as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows.map(r => [r.employee_id, r.monto_neto, r.metodo])).toEqual([
      ['e1', 249_600, 'transferencia'],
      ['e3', 185_000, 'transferencia'],   // redondeado, como el archivo del banco
    ])
    expect(rows.every(r => r.period_id === 'per-1' && r.paid_by === 'u-owner')).toBe(true)

    const upd = opArgs(lastCall('salary_periods'), 'update')![0] as Record<string, unknown>
    expect(upd.estado).toBe('pagado')
    expect(upd.paid_by).toBe('u-owner')
  })

  it('el contador rebota en la RLS y el período NO queda pagado', async () => {
    enqueue('salary_periods', { data: { estado: 'cerrado' } })
    enqueue('employee_payments', { error: { code: '42501', message: 'new row violates row-level security policy' } })
    await expect(markPeriodPaid('per-1', lineas, 'u-contador')).rejects.toThrow(/permiso/i)
    // Solo la relectura del estado: ningún update de salary_periods.
    expect(calls.filter(c => c.table === 'salary_periods' && c.ops.some(o => o.fn === 'update'))).toHaveLength(0)
  })

  it('un período ya pagado no se paga dos veces', async () => {
    enqueue('salary_periods', { data: { estado: 'pagado' } })
    await expect(markPeriodPaid('per-1', lineas, 'u-owner')).rejects.toThrow(/ya está marcado como pagado/i)
    expect(calls.some(c => c.table === 'employee_payments')).toBe(false)
  })

  it('sin ningún neto > 0 no toca la base', async () => {
    await expect(markPeriodPaid('per-1', [{ employee_id: 'e2', monto_neto: 0 }], 'u-owner'))
      .rejects.toThrow(/mayor a/i)
    expect(calls).toHaveLength(0)
  })
})
