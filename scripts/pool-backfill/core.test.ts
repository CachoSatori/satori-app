// Paridad del backfill (patrón oracle). El total persistido tiene que ser, AL PESO, el del SAGRADO
// calcHistory().totalPool — el mismo número que muestra Historial al expandir un turno. Acá se fija
// contra escenarios calculados a mano (efectivo + propinaSala + barra), probando además que la
// clasificación sala/barra respeta covered_role y que el total por mes redondea como el correo.
//
// Corre en `npm test` (entorno node por defecto; sin DOM).

import { describe, it, expect } from 'vitest'
import {
  sessionPoolTotal,
  planSessions,
  monthlyTotals,
  groupEntries,
  type SessionRow,
  type EntryRow,
  type EmployeeRow,
  type RolePointsRow,
} from './core.ts'

const rolePoints: RolePointsRow[] = [
  { role: 'salonero', points: 100 },
  { role: 'runner', points: 80 },
  { role: 'barman', points: 100 },
  { role: 'barback', points: 80 },
  { role: 'cajero', points: 100 },
  { role: 'cocina', points: 60 },
  { role: 'manager', points: 100 },
]

const employees: EmployeeRow[] = [
  { id: 'A', full_name: 'Ana', role: 'salonero' },
  { id: 'B', full_name: 'Beto', role: 'runner' },
  { id: 'C', full_name: 'Caro', role: 'barman' },
  { id: 'D', full_name: 'Dani', role: 'salonero' },
  { id: 'E', full_name: 'Eze', role: 'barback' },
]

function session(over: Partial<SessionRow>): SessionRow {
  return {
    id: 's', session_date: '2026-07-10', shift_type: 'PM', status: 'closed',
    exchange_rate: 500,
    pool_efectivo_crc: 0, pool_efectivo_usd: 0, pool_barra_crc: 0, pool_barra_electronico_crc: 0,
    pool_total_crc: null,
    ...over,
  }
}

function entry(over: Partial<EntryRow>): EntryRow {
  return {
    session_id: 's1', employee_id: 'A', hours_worked: 5,
    tip_amount_crc: 0, tip_amount_usd: 0, points: null, payout_crc: null, covered_role: null,
    ...over,
  }
}

describe('sessionPoolTotal — réplica del SAGRADO calcHistory().totalPool', () => {
  // efectivo = 100000 + 100·500 = 150000 ; barra = 20000 + 5000 = 25000
  const s1 = session({
    id: 's1', pool_efectivo_crc: 100000, pool_efectivo_usd: 100,
    pool_barra_crc: 20000, pool_barra_electronico_crc: 5000,
  })
  const baseEntries: EntryRow[] = [
    entry({ employee_id: 'A', tip_amount_crc: 10000 }),                          // sala → +10000
    entry({ employee_id: 'B', tip_amount_usd: 20 }),                             // sala → +10000 (20·500)
    entry({ employee_id: 'C', tip_amount_crc: 99999 }),                          // barra natural → excluida
    entry({ employee_id: 'D', tip_amount_crc: 88888, covered_role: 'barman' }),  // cubre barra → excluida
    entry({ employee_id: 'E', tip_amount_crc: 5000, covered_role: 'salonero' }), // cubre sala → +5000
  ]

  it('efectivo + propinaSala(sala) + barra(ef+elec), a mano = ₡200.000', () => {
    // propinaSala = 10000 + 10000 + 5000 = 25000 ; total = 150000 + 25000 + 25000
    expect(sessionPoolTotal(s1, baseEntries, employees, rolePoints)).toBe(200000)
  })

  it('el total NO depende de los puntos por rol (solo del reparto, no de la suma)', () => {
    const otros: RolePointsRow[] = rolePoints.map((r) => ({ ...r, points: r.points + 37 }))
    expect(sessionPoolTotal(s1, baseEntries, employees, otros)).toBe(200000)
  })

  it('covered_role manda: si E NO cubre sala (barback natural), sale del pool de sala', () => {
    const e = baseEntries.map((x) => (x.employee_id === 'E' ? { ...x, covered_role: null } : x))
    // E ahora barra → propinaSala = 20000 → total = 150000 + 20000 + 25000
    expect(sessionPoolTotal(s1, e, employees, rolePoints)).toBe(195000)
  })

  it('covered_role manda: si D NO cubre barra (salonero natural), entra al pool de sala', () => {
    const e = baseEntries.map((x) => (x.employee_id === 'D' ? { ...x, covered_role: null } : x))
    // D ahora sala → propinaSala = 25000 + 88888 = 113888 → total = 150000 + 113888 + 25000
    expect(sessionPoolTotal(s1, e, employees, rolePoints)).toBe(288888)
  })

  it('barra electrónica cuenta igual que la efectiva (la suma es la que va a calcTurno)', () => {
    const soloElec = session({ id: 's', pool_barra_crc: 0, pool_barra_electronico_crc: 25000 })
    const soloEf = session({ id: 's', pool_barra_crc: 25000, pool_barra_electronico_crc: 0 })
    expect(sessionPoolTotal(soloElec, [], employees, rolePoints))
      .toBe(sessionPoolTotal(soloEf, [], employees, rolePoints))
    expect(sessionPoolTotal(soloElec, [], employees, rolePoints)).toBe(25000)
  })
})

describe('planSessions — idempotencia y filtrado', () => {
  const sessions: SessionRow[] = [
    session({ id: 's1', session_date: '2026-07-10', shift_type: 'PM', pool_efectivo_crc: 100000, pool_efectivo_usd: 100, pool_barra_crc: 20000, pool_barra_electronico_crc: 5000, pool_total_crc: null }),
    session({ id: 's2', session_date: '2026-07-20', shift_type: 'AM', pool_efectivo_crc: 49500, pool_total_crc: 49500 }),   // ya correcto
    session({ id: 's3', session_date: '2026-08-01', shift_type: 'PM', exchange_rate: 10, pool_efectivo_crc: 12345, pool_efectivo_usd: 0.06, pool_total_crc: 12000 }), // 12345.6, stale
    session({ id: 's4', session_date: '2026-07-25', shift_type: 'PM', status: 'open', pool_efectivo_crc: 999999 }),          // ABIERTA → fuera
  ]
  const entries: EntryRow[] = [
    entry({ session_id: 's1', employee_id: 'A', tip_amount_crc: 10000 }),
    entry({ session_id: 's1', employee_id: 'B', tip_amount_usd: 20 }),
    entry({ session_id: 's1', employee_id: 'E', tip_amount_crc: 5000, covered_role: 'salonero' }),
  ]
  const plans = planSessions(sessions, groupEntries(entries), employees, rolePoints)

  it('excluye las sesiones abiertas', () => {
    expect(plans.map((p) => p.id)).toEqual(['s1', 's2', 's3'])
  })
  it('changed=true cuando el total actual es NULL', () => {
    expect(plans.find((p) => p.id === 's1')).toMatchObject({ poolTotal: 200000, current: null, changed: true })
  })
  it('changed=false cuando ya está persistido y coincide', () => {
    expect(plans.find((p) => p.id === 's2')).toMatchObject({ poolTotal: 49500, current: 49500, changed: false })
  })
  it('changed=true cuando el total actual quedó viejo', () => {
    const p3 = plans.find((p) => p.id === 's3')!
    expect(p3.changed).toBe(true)
    expect(p3.poolTotal).toBeCloseTo(12345.6, 5)
  })

  it('total por mes = Σ crudo, redondeado al final (como el correo)', () => {
    const m = monthlyTotals(plans)
    expect(m.find((x) => x.month === '2026-07')).toMatchObject({ sessions: 2, total: 249500, totalRounded: 249500 })
    const ago = m.find((x) => x.month === '2026-08')!
    expect(ago.total).toBeCloseTo(12345.6, 5)
    expect(ago.totalRounded).toBe(12346)
  })
})
