// Tests de CARACTERIZACIÓN de tipCalculations.ts (sagrado).
// Fijan lo que el código HACE HOY, no lo que "debería" hacer. Si algo se ve mal, queda marcado
// con `// RARO:` y el test igual fija el comportamiento actual. NO se tocó tipCalculations.ts.
// Nombres y montos inventados.
import { describe, it, expect } from 'vitest'
import {
  calcTurno,
  calcHistory,
  formatNum,
  formatUSD,
  formatCRC,
  BAR_ROLES,
  NO_PROPINA_ROLES,
  PROPINA_ROLES,
  ROL_ORDER,
  type DraftLine,
} from './tipCalculations'
import type { UserRole } from '../types/database'

const NBSP = ' ' // separador de miles que usa toLocaleString('es-CR')

function line(over: Partial<DraftLine> & { role: UserRole }): DraftLine {
  return {
    employeeId: over.employeeId ?? 'id',
    employeeName: 'Persona Ficticia',
    active: true,
    hours: 8,
    propina_crc: 0,
    propina_usd: 0,
    pts_rol: 10,
    pts_val: 0,
    take_home: 0,
    ...over,
  }
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const redondeados = (r: ReturnType<typeof calcTurno>) => r.updatedLines.map(l => Math.round(l.take_home))

// Puntos por rol inventados (no son los de producción).
const PTS = { salonero: 10, barman: 8, barback: 5, runner: 6, cocina: 3, cajero: 4 } as const

describe('calcTurno — turno realista (montos inventados)', () => {
  const lineas = () => [
    line({ employeeId: 'sal-a', role: 'salonero', hours: 6, pts_rol: PTS.salonero, propina_crc: 18_500, propina_usd: 10 }),
    line({ employeeId: 'sal-b', role: 'salonero', hours: 5, pts_rol: PTS.salonero, propina_crc: 12_000 }),
    line({ employeeId: 'sal-c', role: 'salonero', hours: 4.5, pts_rol: PTS.salonero, propina_usd: 5 }),
    line({ employeeId: 'bar-a', role: 'barman', hours: 7, pts_rol: PTS.barman }),
    line({ employeeId: 'bbk-a', role: 'barback', hours: 6, pts_rol: PTS.barback }),
    line({ employeeId: 'run-a', role: 'runner', hours: 5, pts_rol: PTS.runner, propina_crc: 4_000 }),
    line({ employeeId: 'coc-a', role: 'cocina', hours: 8, pts_rol: PTS.cocina }),
    line({ employeeId: 'coc-b', role: 'cocina', hours: 8, pts_rol: PTS.cocina }),
    line({ employeeId: 'sal-d', role: 'salonero', hours: 6, pts_rol: PTS.salonero, active: false, propina_crc: 9_000 }),
  ]
  // efectivo ₡95.000 + $40 × 512 = 115.480 · datáfonos sala: 18.500 + 10×512 + 12.000 + 5×512 + 4.000 = 42.180
  const r = calcTurno(lineas(), 95_000, 40, 30_000, 512)

  it('totales del pool', () => {
    expect(r.totals.generalPool).toBe(157_660)
    expect(r.totals.barraPool).toBe(30_000)
    expect(r.totals.totalPool).toBe(187_660)
    // 60 + 50 + 45 + 56 + 30 + 30 + 24 + 24
    expect(r.totals.totalPoints).toBe(319)
    expect(r.totals.generalRate).toBeCloseTo(157_660 / 319, 10)
  })

  it('pts_val = horas × pts_rol; el inactivo queda en 0', () => {
    expect(r.updatedLines.map(l => l.pts_val)).toEqual([60, 50, 45, 56, 30, 30, 24, 24, 0])
  })

  it('take_home redondeado por persona (como se guarda en payout_crc)', () => {
    // barra 30.000 por horas: barman 7/13, barback 6/13
    expect(redondeados(r)).toEqual([29_654, 24_712, 22_240, 43_831, 28_673, 14_827, 11_862, 11_862, 0])
  })

  it('Σ take_home sin redondear = pool total', () => {
    expect(sum(r.updatedLines.map(l => l.take_home))).toBeCloseTo(187_660, 6)
  })

  it('Σ de los payouts redondeados se pasa 1 colón del pool', () => {
    // RARO: cada payout se redondea por separado (Math.round) y la suma da 187.661 contra un
    // pool de 187.660. No hay ajuste del residuo. Con más gente la deriva puede crecer.
    expect(sum(redondeados(r))).toBe(187_661)
  })
})

describe('calcTurno — redondeo', () => {
  it('3 personas iguales con ₡100.000 → 33.333,33 c/u; redondeado suma 99.999', () => {
    // RARO: se "pierde" 1 colón al redondear cada payout.
    const r = calcTurno([line({ role: 'salonero' }), line({ role: 'salonero' }), line({ role: 'salonero' })], 100_000, 0, 0, 500)
    expect(r.updatedLines[0].take_home).toBeCloseTo(33_333.333333, 5)
    expect(redondeados(r)).toEqual([33_333, 33_333, 33_333])
    expect(sum(redondeados(r))).toBe(99_999)
  })

  it('2 personas iguales con ₡100.001 → 50.000,5 c/u; redondeado suma 100.002', () => {
    // RARO: al revés del anterior, el redondeo "crea" 1 colón (x,5 sube en los dos).
    const r = calcTurno([line({ role: 'salonero' }), line({ role: 'salonero' })], 100_001, 0, 0, 500)
    expect(r.updatedLines.map(l => l.take_home)).toEqual([50_000.5, 50_000.5])
    expect(sum(redondeados(r))).toBe(100_002)
  })

  it('USD fraccionario × tipo de cambio no se redondea en el pool', () => {
    const r = calcTurno([line({ role: 'salonero', propina_usd: 0.5 })], 0, 1.25, 0, 517)
    // 1,25 × 517 = 646,25 · 0,5 × 517 = 258,5
    expect(r.totals.generalPool).toBe(904.75)
  })

  it('horas y puntos fraccionarios', () => {
    const r = calcTurno([
      line({ role: 'salonero', hours: 4.5, pts_rol: 10 }),
      line({ role: 'cocina', hours: 7.5, pts_rol: 2.5 }),
    ], 64_125, 0, 0, 500)
    // 45 + 18,75 = 63,75 puntos → tasa 1.005,88…
    expect(r.totals.totalPoints).toBe(63.75)
    expect(redondeados(r)).toEqual([45_265, 18_860])
  })
})

describe('calcTurno — monedas y tipo de cambio', () => {
  it('solo ₡', () => {
    expect(calcTurno([line({ role: 'salonero' })], 50_000, 0, 0, 520).totals.generalPool).toBe(50_000)
  })

  it('solo $', () => {
    expect(calcTurno([line({ role: 'salonero' })], 0, 100, 0, 520).totals.generalPool).toBe(52_000)
  })

  it('tipo de cambio 0 → los $ (efectivo y datáfono) no entran al pool', () => {
    // RARO: no hay aviso; $25 de efectivo y $10 de datáfono se vuelven ₡0 en silencio.
    const r = calcTurno([line({ role: 'salonero', propina_usd: 10 })], 1_000, 25, 0, 0)
    expect(r.totals.generalPool).toBe(1_000)
  })

  it('tipo de cambio undefined → NaN en todo, aunque no haya ningún $', () => {
    // RARO: `(0 || 0) * undefined` es NaN; pool, tasa y take_home quedan NaN.
    const r = calcTurno([line({ role: 'salonero' })], 1_000, 0, 0, undefined as unknown as number)
    expect(r.totals.generalPool).toBeNaN()
    expect(r.totals.totalPool).toBeNaN()
    expect(r.totals.generalRate).toBeNaN()
    expect(r.updatedLines[0].take_home).toBeNaN()
    expect(r.totals.totalPoints).toBe(80)
  })

  it('pool_efectivo NaN se toma como 0 (por el `|| 0`)', () => {
    expect(calcTurno([line({ role: 'salonero' })], NaN, NaN, 0, 500).totals.generalPool).toBe(0)
  })

  it('pool_barra NaN no se reparte pero vuelve NaN el totalPool', () => {
    // RARO: la barra no tiene `|| 0`; el general queda bien y el total queda NaN.
    const r = calcTurno([line({ role: 'barman' })], 10_000, 0, NaN, 500)
    expect(r.totals.generalPool).toBe(10_000)
    expect(r.totals.totalPool).toBeNaN()
    expect(r.updatedLines[0].take_home).toBe(10_000)
  })
})

describe('calcTurno — pool vacío o sin receptores', () => {
  it('sin líneas: tasa 0 y el totalPool igual cuenta efectivo + barra', () => {
    const r = calcTurno([], 100_000, 10, 20_000, 500)
    expect(r.totals).toEqual({ generalPool: 105_000, barraPool: 20_000, totalPool: 125_000, totalPoints: 0, generalRate: 0 })
    expect(r.updatedLines).toEqual([])
  })

  it('todo en 0 → todo en 0', () => {
    const r = calcTurno([line({ role: 'salonero' })], 0, 0, 0, 500)
    expect(r.totals).toEqual({ generalPool: 0, barraPool: 0, totalPool: 0, totalPoints: 80, generalRate: 0 })
    expect(r.updatedLines[0].take_home).toBe(0)
  })

  it('todos con 0 puntos → nadie cobra pero el pool sigue contando', () => {
    // RARO: ₡60.000 quedan en totalPool sin repartir (Σ take_home = 0).
    const r = calcTurno([line({ role: 'salonero', pts_rol: 0 }), line({ role: 'runner', pts_rol: 0 })], 60_000, 0, 0, 500)
    expect(r.totals.generalRate).toBe(0)
    expect(r.totals.totalPool).toBe(60_000)
    expect(r.updatedLines.map(l => l.take_home)).toEqual([0, 0])
  })

  it('todos con 0 horas → igual que 0 puntos', () => {
    const r = calcTurno([line({ role: 'salonero', hours: 0 }), line({ role: 'salonero', hours: '' })], 40_000, 0, 0, 500)
    expect(r.totals.totalPoints).toBe(0)
    expect(r.updatedLines.map(l => l.take_home)).toEqual([0, 0])
    expect(r.totals.totalPool).toBe(40_000)
  })

  it('pool de barra sin nadie de barra → no se reparte pero suma al totalPool', () => {
    // RARO: ₡30.000 de barra quedan en totalPool y nadie los recibe.
    const r = calcTurno([line({ role: 'salonero' }), line({ role: 'runner' })], 100_000, 0, 30_000, 500)
    expect(r.totals.totalPool).toBe(130_000)
    expect(sum(r.updatedLines.map(l => l.take_home))).toBe(100_000)
  })

  it('barra con barman de 0 horas → no se reparte', () => {
    const r = calcTurno([line({ role: 'salonero' }), line({ role: 'barman', hours: 0 })], 80_000, 0, 30_000, 500)
    expect(r.updatedLines.map(l => l.take_home)).toEqual([80_000, 0])
    expect(r.totals.totalPool).toBe(110_000)
  })

  it('un solo receptor (salonero) se lleva todo el general', () => {
    const r = calcTurno([line({ role: 'salonero', hours: 3, pts_rol: 7, propina_crc: 12_345 })], 54_321, 0, 0, 500)
    expect(r.updatedLines[0].take_home).toBe(66_666)
    expect(r.totals.totalPool).toBe(66_666)
  })

  it('un solo receptor de barra se lleva general + barra', () => {
    const r = calcTurno([line({ role: 'barback', hours: 5, pts_rol: 5 })], 20_000, 0, 7_500, 500)
    expect(r.updatedLines[0].take_home).toBe(27_500)
    expect(r.totals.totalPool).toBe(27_500)
  })
})

describe('calcTurno — negativos', () => {
  it('propina de datáfono negativa (devolución) resta del pool', () => {
    const r = calcTurno([line({ role: 'salonero', propina_crc: -5_000 }), line({ role: 'salonero' })], 45_000, 0, 0, 500)
    expect(r.totals.generalPool).toBe(40_000)
    expect(r.updatedLines.map(l => l.take_home)).toEqual([20_000, 20_000])
  })

  it('horas negativas dan payout negativo y le suben la parte a los demás', () => {
    // RARO: no se valida; −2 h → −20 puntos → payout −20.000 y el otro cobra 80.000 de un pool de 60.000.
    const r = calcTurno([line({ role: 'salonero', hours: 8 }), line({ role: 'salonero', hours: -2 })], 60_000, 0, 0, 500)
    expect(r.totals.totalPoints).toBe(60)
    expect(r.updatedLines.map(l => l.take_home)).toEqual([80_000, -20_000])
  })

  it('pool de barra negativo no se reparte pero resta del totalPool', () => {
    // RARO: el total queda por debajo de lo repartido (Σ take_home 50.000, totalPool 45.000).
    const r = calcTurno([line({ role: 'barman' })], 50_000, 0, -5_000, 500)
    expect(r.updatedLines[0].take_home).toBe(50_000)
    expect(r.totals.totalPool).toBe(45_000)
  })

  it('efectivo negativo deja pool y payouts negativos', () => {
    const r = calcTurno([line({ role: 'salonero' })], -10_000, 0, 0, 500)
    expect(r.updatedLines[0].take_home).toBe(-10_000)
  })
})

describe('calcTurno — roles y propinas individuales', () => {
  it('la propina del barman/barback NO entra al pool; la de cocina SÍ', () => {
    // RARO: cocina está en NO_PROPINA_ROLES (no tiene campo en la UI) pero calcTurno sí suma su
    // propina si viene cargada; barman/barback se ignoran. Las dos listas no coinciden.
    const r = calcTurno([
      line({ role: 'barman', propina_crc: 7_000 }),
      line({ role: 'barback', propina_crc: 3_000 }),
      line({ role: 'cocina', propina_crc: 2_000 }),
    ], 0, 0, 0, 500)
    expect(r.totals.generalPool).toBe(2_000)
  })

  it('la barra se reparte por HORAS, no por puntos', () => {
    const r = calcTurno([
      line({ role: 'barman', hours: 6, pts_rol: 8 }),
      line({ role: 'barback', hours: 6, pts_rol: 5 }),
    ], 0, 0, 24_000, 500)
    expect(r.updatedLines.map(l => l.take_home)).toEqual([12_000, 12_000])
  })

  it('el inactivo conserva el take_home/pts_val que traía (no se resetea)', () => {
    // RARO: la copia mantiene valores viejos del llamador para los inactivos.
    const r = calcTurno([
      line({ role: 'salonero' }),
      line({ role: 'salonero', active: false, take_home: 12_345, pts_val: 99 }),
    ], 10_000, 0, 0, 500)
    expect(r.updatedLines[1].take_home).toBe(12_345)
    expect(r.updatedLines[1].pts_val).toBe(99)
    expect(r.updatedLines[0].take_home).toBe(10_000)
  })

  it('el take_home/pts_val que traen los activos se pisa', () => {
    const r = calcTurno([line({ role: 'salonero', take_home: 777, pts_val: 5 })], 10_000, 0, 0, 500)
    expect(r.updatedLines[0].pts_val).toBe(80)
    expect(r.updatedLines[0].take_home).toBe(10_000)
  })

  it("propina '' cuenta como 0", () => {
    expect(calcTurno([line({ role: 'salonero', propina_crc: '', propina_usd: '' })], 1_000, 0, 0, 500).totals.generalPool).toBe(1_000)
  })
})

describe('calcTurno — montos grandes e invariante Σ = pool', () => {
  it('montos muy grandes reparten exacto', () => {
    const r = calcTurno([
      line({ role: 'salonero', hours: 10, pts_rol: 10 }),
      line({ role: 'runner', hours: 10, pts_rol: 5 }),
      line({ role: 'barman', hours: 10, pts_rol: 5 }),
    ], 40_000_000, 10_000, 8_000_000, 500)
    expect(r.totals.generalPool).toBe(45_000_000)
    expect(r.updatedLines.map(l => l.take_home)).toEqual([22_500_000, 11_250_000, 19_250_000])
    expect(r.totals.totalPool).toBe(53_000_000)
  })

  it.each([
    [95_000, 40, 30_000, 512],
    [123_456, 17, 9_999, 505.37],
    [1, 0, 1, 530],
    [0, 333, 0, 499.99],
  ])('Σ take_home ≈ totalPool (efectivo %d, $%d, barra %d, tc %d) si hay puntos y horas de barra', (crc, usd, barra, tc) => {
    const r = calcTurno([
      line({ role: 'salonero', hours: 6.5, pts_rol: 10, propina_crc: 3_210, propina_usd: 7 }),
      line({ role: 'runner', hours: 4, pts_rol: 6 }),
      line({ role: 'barman', hours: 7, pts_rol: 8 }),
      line({ role: 'barback', hours: 3.5, pts_rol: 5 }),
      line({ role: 'cocina', hours: 9, pts_rol: 3 }),
    ], crc, usd, barra, tc)
    expect(sum(r.updatedLines.map(l => l.take_home))).toBeCloseTo(r.totals.totalPool, 6)
    // y la deriva del redondeo por persona nunca supera media unidad por persona
    expect(Math.abs(sum(redondeados(r)) - r.totals.totalPool)).toBeLessThanOrEqual(r.updatedLines.length / 2)
  })
})

// ── calcHistory ─────────────────────────────────────────────────────────────

const ROLE_POINTS = [
  { role: 'salonero' as UserRole, points: PTS.salonero },
  { role: 'barman' as UserRole, points: PTS.barman },
  { role: 'barback' as UserRole, points: PTS.barback },
  { role: 'runner' as UserRole, points: PTS.runner },
  { role: 'cocina' as UserRole, points: PTS.cocina },
  { role: 'cajero' as UserRole, points: PTS.cajero },
]

const EMPLEADOS = [
  { id: 'e1', full_name: 'Salonero Uno', role: 'salonero' as UserRole },
  { id: 'e2', full_name: 'Salonero Dos', role: 'salonero' as UserRole },
  { id: 'e3', full_name: 'Runner Uno', role: 'runner' as UserRole },
  { id: 'e4', full_name: 'Barman Uno', role: 'barman' as UserRole },
  { id: 'e5', full_name: 'Cocina Uno', role: 'cocina' as UserRole },
  { id: 'e7', full_name: 'Encargado Uno', role: 'manager' as UserRole },
]

function entry(employee_id: string, hours_worked: number, extra: Partial<Parameters<typeof calcHistory>[0][number]> = {}) {
  return { employee_id, hours_worked, tip_amount_crc: 0, tip_amount_usd: 0, points: null, payout_crc: null, ...extra }
}

describe('calcHistory — sesión realista (montos inventados)', () => {
  const entries = [
    entry('e1', 6, { tip_amount_crc: 15_000, tip_amount_usd: 10 }),
    entry('e2', 5, { tip_amount_crc: 9_000 }),
    entry('e3', 5, { covered_role: 'barback', tip_amount_crc: 2_000 }),
    entry('e4', 7),
    entry('e5', 8),
    entry('baja', 4, { tip_amount_crc: 5_000 }),          // empleado que ya no está en la lista
    entry('e7', 3, { tip_amount_crc: 3_000 }),             // manager: sin puntos en ROLE_POINTS
  ]
  const session = { pool_efectivo_crc: 60_000, pool_efectivo_usd: 20, pool_barra_crc: 18_000, exchange_rate: 505 }
  const h = calcHistory(entries, EMPLEADOS, ROLE_POINTS, session)

  it('totales: efectivo 70.100 + datáfonos 20.050 + 9.000 + 3.000 = 102.150', () => {
    expect(h.generalPool).toBe(102_150)
    expect(h.barraPool).toBe(18_000)
    expect(h.totalPool).toBe(120_150)
    // 60 + 50 + 25 (runner cubriendo barback) + 56 + 24 + 0 (manager sin puntos)
    expect(h.totalPoints).toBe(215)
  })

  it('filas: rol efectivo, cobertura, puntos y payout redondeado', () => {
    expect(h.rows.map(r => [r.employeeId, r.role, r.coveredRole, r.pts_rol, r.pts_val, r.payout_crc])).toEqual([
      ['e1', 'salonero', null, 10, 60, 28_507],
      ['e2', 'salonero', null, 10, 50, 23_756],
      ['e3', 'barback', 'barback', 5, 25, 19_378],
      ['e4', 'barman', null, 8, 56, 37_107],
      ['e5', 'cocina', null, 3, 24, 11_403],
      ['e7', 'manager', null, 0, 0, 0],
    ])
  })

  it('el empleado que no está en la lista se descarta junto con su propina', () => {
    // RARO: la entrada 'baja' (₡5.000 de datáfono, 4 h) desaparece del pool y del reparto sin aviso.
    expect(h.rows.find(r => r.employeeId === 'baja')).toBeUndefined()
  })

  it('el runner que cubrió barback: su datáfono NO entra al pool (cuenta como barra)', () => {
    // RARO (posiblemente intencional): los ₡2.000 cargados por e3 no están en generalPool
    // porque con cobertura su rol efectivo es de barra.
    expect(h.rows.find(r => r.employeeId === 'e3')?.propina_crc).toBe(2_000)
    expect(h.generalPool).toBe(102_150)
  })

  it('el manager sin puntos configurados cobra 0, pero su datáfono sí entra al pool', () => {
    expect(h.rows.find(r => r.employeeId === 'e7')?.payout_crc).toBe(0)
  })

  it('Σ payout_crc se pasa 1 colón del totalPool', () => {
    // RARO: 120.151 repartidos contra 120.150 de pool (redondeo por persona, sin ajuste).
    expect(sum(h.rows.map(r => r.payout_crc))).toBe(120_151)
  })

  it('coincide con calcTurno para los mismos datos (TipsModule guarda calcTurno, Historial relee con calcHistory)', () => {
    const lines = h.rows.map(r => line({
      employeeId: r.employeeId, role: r.role, hours: r.hours, pts_rol: r.pts_rol,
      propina_crc: r.propina_crc, propina_usd: r.propina_usd,
    }))
    const t = calcTurno(lines, 60_000, 20, 18_000, 505)
    expect(t.totals.totalPool).toBe(h.totalPool)
    expect(redondeados(t)).toEqual(h.rows.map(r => r.payout_crc))
  })
})

describe('calcHistory — bordes', () => {
  const session = { pool_efectivo_crc: 30_000, pool_efectivo_usd: 0, pool_barra_crc: 0, exchange_rate: 500 }

  it('sin entradas → sin filas, totales del efectivo', () => {
    const h = calcHistory([], EMPLEADOS, ROLE_POINTS, session)
    expect(h.rows).toEqual([])
    expect(h.totalPool).toBe(30_000)
    expect(h.generalRate).toBe(0)
  })

  it('points y payout_crc guardados en la entrada se ignoran (se recalculan)', () => {
    const h = calcHistory([entry('e1', 8, { points: 999, payout_crc: 1 })], EMPLEADOS, ROLE_POINTS, session)
    expect(h.rows[0].pts_val).toBe(80)
    expect(h.rows[0].payout_crc).toBe(30_000)
  })

  it('covered_role null y undefined → rol natural, coveredRole null', () => {
    const h = calcHistory([entry('e1', 4, { covered_role: null }), entry('e2', 4)], EMPLEADOS, ROLE_POINTS, session)
    expect(h.rows.map(r => [r.role, r.coveredRole])).toEqual([['salonero', null], ['salonero', null]])
  })

  it('barman cubriendo salonero: su datáfono pasa a contar y deja la barra', () => {
    const h = calcHistory(
      [entry('e4', 5, { covered_role: 'salonero', tip_amount_crc: 4_000 })],
      EMPLEADOS, ROLE_POINTS, { ...session, pool_barra_crc: 10_000 },
    )
    expect(h.generalPool).toBe(34_000)
    expect(h.rows[0].payout_crc).toBe(34_000)
    expect(h.totalPool).toBe(44_000)
  })

  it('rol repetido en rolePoints: gana el último', () => {
    const h = calcHistory([entry('e1', 2)], EMPLEADOS,
      [{ role: 'salonero', points: 10 }, { role: 'salonero', points: 3 }], session)
    expect(h.rows[0].pts_rol).toBe(3)
  })

  it('payout x,5 redondea hacia arriba (Math.round)', () => {
    const h = calcHistory([entry('e1', 1), entry('e2', 1)], EMPLEADOS, ROLE_POINTS, { ...session, pool_efectivo_crc: 3 })
    expect(h.rows.map(r => r.payout_crc)).toEqual([2, 2])
  })

  it('tipo de cambio 0 en la sesión: los $ quedan fuera', () => {
    const h = calcHistory([entry('e1', 1, { tip_amount_usd: 50 })], EMPLEADOS, ROLE_POINTS,
      { ...session, pool_efectivo_usd: 100, exchange_rate: 0 })
    expect(h.generalPool).toBe(30_000)
  })

  it('tipo de cambio null → se toma como 0; undefined → payout NaN', () => {
    // RARO: con undefined, Math.round(NaN) = NaN y el historial mostraría NaN en cada payout.
    const h = calcHistory([entry('e1', 1)], EMPLEADOS, ROLE_POINTS,
      { ...session, exchange_rate: null as unknown as number })
    // null en la multiplicación vale 0, así que acá NO hay NaN:
    expect(h.rows[0].payout_crc).toBe(30_000)
    const h2 = calcHistory([entry('e1', 1)], EMPLEADOS, ROLE_POINTS,
      { ...session, exchange_rate: undefined as unknown as number })
    expect(h2.rows[0].payout_crc).toBeNaN()
  })
})

describe('formatters y listas de roles', () => {
  it('formatNum: es-CR, máximo 1 decimal', () => {
    expect(formatNum(1_234.56)).toBe(`1${NBSP}234,6`)
    expect(formatNum(1_234.04)).toBe(`1${NBSP}234`)
    expect(formatNum(319)).toBe('319')
  })

  it('formatUSD: en-US con 2 decimales', () => {
    // RARO: en propinas el $ sale en formato en-US ("$1,234.50") y en caja fd da "$ 1 234,50".
    expect(formatUSD(1_234.5)).toBe('$1,234.50')
    expect(formatUSD(-5)).toBe('-$5.00')
  })

  it('formatCRC (= fi) redondea al colón', () => {
    expect(formatCRC(999.5)).toBe(`₡ 1${NBSP}000`)
  })

  it('listas de roles', () => {
    expect(BAR_ROLES).toEqual(['barman', 'barback'])
    expect(NO_PROPINA_ROLES).toEqual(['barman', 'barback', 'cocina'])
    expect(PROPINA_ROLES).toEqual(['salonero', 'runner', 'cajero', 'manager'])
    expect(ROL_ORDER).toEqual(['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero', 'manager'])
  })
})
