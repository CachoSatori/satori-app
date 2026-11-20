// Aviso de plata sin repartir (decisión del dueño 20-nov): contraejemplos H1/H2 de
// `src/shared/utils/tipCalculations.prop.test.ts`, caso sin sobrante, redondeo H3 (no avisa) y una propiedad
// que ata el aviso a las guardas del cierre. Datos ficticios.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calcSinRepartir, sinRepartirHistoria, sinRepartirTurno, textoSinRepartir } from './sinRepartir'
import { avisosCierrePropinas } from './guardasCierre'
import { calcHistory, calcTurno, type DraftLine } from '../../shared/utils/tipCalculations'
import type { UserRole } from '../../shared/types/database'

const linea = (id: string, role: UserRole, hours: number | '', pts_rol: number, extra: Partial<DraftLine> = {}): DraftLine => ({
  employeeId: id, employeeName: `Persona Ficticia ${id}`, role, active: true, hours,
  propina_crc: '', propina_usd: '', pts_rol, pts_val: 0, take_home: 0, ...extra,
})

describe('sinRepartirTurno — contraejemplos de las pruebas de propiedades', () => {
  it('H1 (mínimo de fast-check): salonero 0,5 h y 1 punto, sin barra, efectivo ₡0, pozo de barra ₡1 → avisa ₡1', () => {
    const r = sinRepartirTurno(calcTurno([linea('0', 'salonero', 0.5, 1)], 0, 0, 1, 300))
    expect(r).toEqual({
      monto: 1,
      motivos: ['barra_sin_horas'],
      texto: 'Quedan ₡1 sin repartir: hay propina de barra y nadie de barra tiene horas. Revisá las horas o los puntos antes de guardar.',
    })
  })

  it('H2 (mínimo de fast-check): sin líneas, efectivo $0,01 a TC 300 → avisa ₡3, nadie con puntos', () => {
    const r = sinRepartirTurno(calcTurno([], 0, 0.01, 0, 300))
    expect(r?.monto).toBe(3)
    expect(r?.motivos).toEqual(['nadie_con_puntos'])
    expect(r?.texto).toBe('Quedan ₡3 sin repartir: hay pozo para repartir y nadie del turno tiene puntos u horas. Revisá las horas o los puntos antes de guardar.')
  })

  it('H2 con gente en 0 horas (o rol con 0 pts) → avisa todo el pozo general', () => {
    const lines = [linea('a', 'salonero', 0, 10), linea('b', 'runner', 6, 0, { propina_crc: 2000 })]
    const r = sinRepartirTurno(calcTurno(lines, 10000, 0, 0, 500))
    expect(r?.monto).toBe(12000)
    expect(r?.motivos).toEqual(['nadie_con_puntos'])
  })

  it('H1 + H2 a la vez → un solo aviso con el total y los dos motivos', () => {
    const r = sinRepartirTurno(calcTurno([linea('a', 'salonero', 0, 10)], 5000, 0, 2500, 500))
    expect(r?.monto).toBe(7500)
    expect(r?.motivos).toEqual(['barra_sin_horas', 'nadie_con_puntos'])
    expect(r?.texto).toContain(': hay propina de barra y nadie de barra tiene horas y hay pozo para repartir')
  })

  it('H1 con cobertura: el barman cubrió sala (rol efectivo salonero) → la barra queda sin horas', () => {
    const lines = [linea('a', 'salonero', 6, 10), linea('b', 'salonero', 8, 10)] // b es barman que cubrió sala
    const r = sinRepartirTurno(calcTurno(lines, 20000, 0, 3000, 500))
    expect(r?.monto).toBe(3000)
    expect(r?.motivos).toEqual(['barra_sin_horas'])
  })

  it('las líneas inactivas no cuentan como gente de barra ni cobran', () => {
    const lines = [linea('a', 'salonero', 6, 10), linea('b', 'barman', 8, 5, { active: false })]
    expect(sinRepartirTurno(calcTurno(lines, 1000, 0, 4000, 500))?.monto).toBe(4000)
  })
})

describe('sin sobrante o solo redondeo → NO avisa', () => {
  it('turno normal con sala y barra con horas → null', () => {
    const lines = [linea('a', 'salonero', 6, 10, { propina_crc: 10000 }), linea('b', 'barman', 8, 5)]
    expect(sinRepartirTurno(calcTurno(lines, 20000, 10, 15000, 500))).toBeNull()
  })

  it('pozo 0 y nadie trabajó → null', () => {
    expect(sinRepartirTurno(calcTurno([], 0, 0, 0, 500))).toBeNull()
  })

  it('H3 (mínimo de fast-check, calcHistory): 2 personas por cobertura, $795,24 a TC 300,11 → se paga ₡1 de más, no avisa', () => {
    const calc = calcHistory(
      [
        { employee_id: 'e0', hours_worked: 0.5, tip_amount_crc: 0, tip_amount_usd: 0, points: null, payout_crc: null, covered_role: 'runner' },
        { employee_id: 'e1', hours_worked: 0.5, tip_amount_crc: 0, tip_amount_usd: 0, points: null, payout_crc: null, covered_role: 'runner' },
      ],
      [{ id: 'e0', full_name: 'Persona Ficticia 0', role: 'cocina' }, { id: 'e1', full_name: 'Persona Ficticia 1', role: 'cocina' }],
      [{ role: 'runner', points: 1 }],
      { pool_efectivo_crc: 0, pool_efectivo_usd: 795.24, pool_barra_crc: 0, exchange_rate: 300.11 },
    )
    expect(calc.rows.reduce((s, r) => s + r.payout_crc, 0) - Math.round(calc.totalPool)).toBe(1) // H3 tal cual
    expect(sinRepartirHistoria(calc)).toBeNull()
  })

  it('redondeo hacia abajo: 3 personas iguales con ₡100 → cobran 33 c/u, queda ₡1 (< ₡1 por persona) → null', () => {
    const lines = ['a', 'b', 'c'].map(id => linea(id, 'salonero', 1, 1))
    const r = calcTurno(lines, 100, 0, 0, 500)
    expect(r.updatedLines.reduce((s, l) => s + Math.round(l.take_home), 0)).toBe(99)
    expect(sinRepartirTurno(r)).toBeNull()
  })
})

describe('calcSinRepartir — núcleo', () => {
  const pozo = (totalPool: number, extra: Partial<{ generalPool: number; barraPool: number; totalPoints: number }> = {}) =>
    ({ generalPool: totalPool, barraPool: 0, totalPoints: 10, totalPool, ...extra })

  it('resto sin H1/H2 de ₡1 o más por persona → motivo «redondeo» (defensa)', () => {
    const r = calcSinRepartir(pozo(1000), [{ role: 'salonero', hours: 5, cobra: 400 }, { role: 'runner', hours: 5, cobra: 400 }])
    expect(r).toEqual({ monto: 200, motivos: ['redondeo'], texto: textoSinRepartir(200, ['redondeo']) })
  })

  it('resto justo en el borde: < n no avisa, = n avisa', () => {
    const dos = (cobra: number) => [{ role: 'salonero' as UserRole, hours: 5, cobra }, { role: 'runner' as UserRole, hours: 5, cobra }]
    expect(calcSinRepartir(pozo(101.9), dos(50))).toBeNull()
    expect(calcSinRepartir(pozo(102), dos(50))?.monto).toBe(2)
  })

  it('pagar de más nunca se avisa como «sin repartir»', () => {
    expect(calcSinRepartir(pozo(100), [{ role: 'salonero', hours: 5, cobra: 150 }])).toBeNull()
  })

  it('H1 con monto menor a ₡0,5 (céntimos) → no avisa ₡0', () => {
    expect(calcSinRepartir(pozo(0.3, { generalPool: 0, barraPool: 0.3, totalPoints: 0 }), [])).toBeNull()
  })
})

// ── Propiedad: el aviso aparece exactamente cuando las guardas del cierre (H1/H2) saltan ──
const ROLES: UserRole[] = ['salonero', 'barman', 'barback', 'runner', 'cocina', 'cajero', 'manager']
const vacioO = <T>(a: fc.Arbitrary<T>) => fc.oneof({ weight: 1, arbitrary: fc.constant('' as const) }, { weight: 6, arbitrary: a })
const lineasArb = fc.array(fc.record({
  role: fc.constantFrom(...ROLES), active: fc.boolean(),
  hours: vacioO(fc.integer({ min: 0, max: 28 }).map(x => x / 2)),
  propina_crc: vacioO(fc.integer({ min: 0, max: 150000 })),
  propina_usd: vacioO(fc.integer({ min: 0, max: 30000 }).map(c => c / 100)),
  pts_rol: fc.integer({ min: 0, max: 6 }),
}), { maxLength: 14 }).map(ls => ls.map((l, i): DraftLine => ({ ...l, employeeId: `emp-${i}`, employeeName: `Persona Ficticia ${i}`, pts_val: 0, take_home: 0 })))
const pozoArb = fc.record({
  efCrc: fc.integer({ min: 0, max: 2_000_000 }), efUsd: fc.integer({ min: 0, max: 100_000 }).map(c => c / 100),
  barra: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 500_000 })), tc: fc.integer({ min: 30000, max: 90000 }).map(c => c / 100),
})

describe('propiedad (semilla fija, R11)', () => {
  it('avisa ⇔ guardas H1/H2; si no avisa, lo no repartido es < ₡0,5 por persona; si avisa, monto = round(totalPool − Σ cobrado)', () => {
    fc.assert(fc.property(lineasArb, pozoArb, (ls, p) => {
      const r = calcTurno(ls, p.efCrc, p.efUsd, p.barra, p.tc)
      const aviso = sinRepartirTurno(r)
      const guardas = avisosCierrePropinas(ls, p.efCrc, p.efUsd, p.barra, p.tc)
      expect(aviso !== null).toBe(guardas.length > 0)
      const activos = r.updatedLines.filter(l => l.active)
      const resto = r.totals.totalPool - activos.reduce((s, l) => s + Math.round(l.take_home), 0)
      if (aviso) expect(aviso.monto).toBe(Math.round(resto))
      else expect(resto).toBeLessThanOrEqual(activos.length / 2 + 1e-6)
    }), { seed: 20261120, numRuns: 400 })
  })
})
