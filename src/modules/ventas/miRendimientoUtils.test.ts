import { describe, it, expect } from 'vitest'
import {
  addDays, mondayOf, resolvePeriod, datesInPeriod,
  dowBreakdown, bestDowIndex, computeICP, icpVsTeam,
  shiftMonth, monthLabelLong,
  type Period,
} from './miRendimientoUtils'
import { dayOfWeek } from './ventasUtils'
import type { DiasMap, SaloneroDay, ProductMap } from '../../shared/types/ventas'

// ── Fixtures ──────────────────────────────────────────────────
function sal(o: Partial<SaloneroDay>): SaloneroDay {
  return {
    pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
    promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0,
    prods: [], ...o,
  }
}
function dia(saloneros: Record<string, SaloneroDay>): DiasMap[string] {
  return { fileName: 'x.xls', uploadedAt: '2026-07-01', saloneros }
}
const PM: ProductMap = {}

// 2026-07-06 y 2026-07-13 caen el MISMO día de semana (7 días de diferencia);
// 2026-07-07 es el día siguiente (día de semana distinto).
const DIAS: DiasMap = {
  '2026-07-06': dia({
    ANA:  sal({ pax: 10, total: 100000, com: 60000,  beb: 20000, iCom: 30, iBeb: 10 }),
    BETO: sal({ pax: 10, total: 50000,  com: 30000,  beb: 10000, iCom: 15, iBeb: 5 }),
  }),
  '2026-07-13': dia({
    ANA:  sal({ pax: 20, total: 200000, com: 120000, beb: 40000, iCom: 60, iBeb: 20 }),
  }),
  '2026-07-07': dia({
    ANA:  sal({ pax: 5,  total: 50000,  com: 30000,  beb: 10000, iCom: 15, iBeb: 5 }),
  }),
}

// ── Date helpers ──────────────────────────────────────────────
describe('addDays / mondayOf', () => {
  it('addDays suma y resta días (TZ-safe)', () => {
    expect(addDays('2026-07-06', 7)).toBe('2026-07-13')
    expect(addDays('2026-07-06', -1)).toBe('2026-07-05')
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30')
  })
  it('addDays null-safe', () => {
    expect(addDays('', 3)).toBe('')
    expect(addDays('no-fecha', 3)).toBe('')
  })
  it('mondayOf devuelve el lunes ISO de la semana', () => {
    // 2026-07-08 es miércoles → lunes = 2026-07-06
    const mon = mondayOf('2026-07-08')
    expect(dayOfWeek(mon)).toBe(1)         // 1 = lunes
    expect(mon).toBe('2026-07-06')
    // un lunes se mapea a sí mismo
    expect(mondayOf('2026-07-06')).toBe('2026-07-06')
  })
})

// ── resolvePeriod ─────────────────────────────────────────────
describe('resolvePeriod', () => {
  const today = '2026-07-15'
  it('hoy = [today, today]', () => {
    expect(resolvePeriod('hoy', today)).toMatchObject({ from: today, to: today, label: 'Hoy' })
  })
  it('semana = [lunes, today]', () => {
    const p = resolvePeriod('semana', today)
    expect(p.to).toBe(today)
    expect(dayOfWeek(p.from)).toBe(1)
    expect(p.from <= today).toBe(true)
  })
  it('mes = [primer día del mes, today]', () => {
    expect(resolvePeriod('mes', today)).toMatchObject({ from: '2026-07-01', to: today })
  })
  it('rango usa custom y ordena extremos invertidos', () => {
    expect(resolvePeriod('rango', today, { from: '2026-06-01', to: '2026-06-30' }))
      .toMatchObject({ from: '2026-06-01', to: '2026-06-30' })
    // invertido → se ordena
    expect(resolvePeriod('rango', today, { from: '2026-06-30', to: '2026-06-01' }))
      .toMatchObject({ from: '2026-06-01', to: '2026-06-30' })
  })
  it('rango null-safe: falta un extremo → usa el otro; faltan ambos → hoy', () => {
    expect(resolvePeriod('rango', today, { from: '2026-06-01', to: null }))
      .toMatchObject({ from: '2026-06-01', to: '2026-06-01' })
    expect(resolvePeriod('rango', today, {})).toMatchObject({ from: today, to: today })
  })
})

// ── datesInPeriod ─────────────────────────────────────────────
describe('datesInPeriod', () => {
  const all = ['2026-06-30', '2026-07-06', '2026-07-07', '2026-07-13', '2026-07-20']
  it('filtra inclusive por rango', () => {
    const p: Period = { kind: 'rango', from: '2026-07-06', to: '2026-07-13', label: '' }
    expect(datesInPeriod(all, p)).toEqual(['2026-07-06', '2026-07-07', '2026-07-13'])
  })
  it('null-safe ante fechas vacías / lista nula', () => {
    const p: Period = { kind: 'rango', from: '2026-07-01', to: '2026-07-31', label: '' }
    expect(datesInPeriod(null, p)).toEqual([])
    expect(datesInPeriod([''], p)).toEqual([])
    expect(datesInPeriod([...all, ''], p)).toEqual(['2026-07-06', '2026-07-07', '2026-07-13', '2026-07-20'])
  })
})

// ── dowBreakdown ──────────────────────────────────────────────
describe('dowBreakdown', () => {
  const dates = ['2026-07-06', '2026-07-13', '2026-07-07']
  const rows = dowBreakdown('ANA', dates, DIAS, PM)
  const dowMon = dayOfWeek('2026-07-06')
  const dowTue = dayOfWeek('2026-07-07')

  it('devuelve SIEMPRE 7 filas (dow 0..6)', () => {
    expect(rows).toHaveLength(7)
    expect(rows.map(r => r.dow)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
  it('agrupa por día de semana: 2 lunes trabajados, 1 martes', () => {
    expect(rows[dowMon].days).toBe(2)
    expect(rows[dowTue].days).toBe(1)
  })
  it('mine acumula las ventas del empleado en ese día de semana', () => {
    const mon = rows[dowMon].mine
    expect(mon.total).toBe(300000)        // 100k + 200k
    expect(mon.pax).toBe(30)              // 10 + 20
    expect(mon.promPax).toBeCloseTo(10000, 5)
    expect(mon.ratioCB).toBeCloseTo(3, 5) // (60k+120k)/(20k+40k)
  })
  it('rest = general del restaurante (incluye a otros) → difiere de mine', () => {
    const restMon = rows[dowMon].rest
    // general lunes: ANA(100k+200k) + BETO(50k) = 350k ; pax 30+10 = 40
    expect(restMon.total).toBe(350000)
    expect(restMon.pax).toBe(40)
    expect(restMon.promPax).toBeCloseTo(8750, 5)
    expect(rows[dowMon].mine.promPax).toBeGreaterThan(restMon.promPax)
  })
  it('null-safe: fechas nulas / vacías / empleado inexistente no revientan', () => {
    expect(dowBreakdown('ANA', null, DIAS, PM)).toHaveLength(7)
    expect(dowBreakdown('', dates, DIAS, PM).every(r => r.days === 0)).toBe(true)
    const messy = dowBreakdown('ANA', ['', '2026-07-06', '2099-01-01'], DIAS, PM)
    expect(messy[dowMon].days).toBe(1)    // solo el 07-06 real cuenta
  })
})

// ── bestDowIndex ──────────────────────────────────────────────
describe('bestDowIndex', () => {
  // Set con ganador claro: martes rinde mejor Prom/PAX que lunes.
  const DIAS2: DiasMap = {
    '2026-07-06': dia({ ANA: sal({ pax: 10, total: 80000 }) }),   // lunes: 8000/PAX
    '2026-07-07': dia({ ANA: sal({ pax: 10, total: 150000 }) }),  // martes: 15000/PAX
  }
  it('elige el día de semana con mejor Prom/PAX (días>0)', () => {
    const rows = dowBreakdown('ANA', ['2026-07-06', '2026-07-07'], DIAS2, PM)
    expect(bestDowIndex(rows)).toBe(dayOfWeek('2026-07-07'))  // martes gana
  })
  it('-1 cuando no hay días trabajados', () => {
    expect(bestDowIndex(dowBreakdown('NADIE', ['2026-07-06'], DIAS, PM))).toBe(-1)
    expect(bestDowIndex([])).toBe(-1)
    expect(bestDowIndex(null)).toBe(-1)
  })
})

// ── ICP ───────────────────────────────────────────────────────
describe('computeICP', () => {
  it('propinas/ventas × 100', () => {
    expect(computeICP(15000, 300000)).toBeCloseTo(5, 5)     // 5%
    expect(computeICP(0, 300000)).toBe(0)
  })
  it('ventas <= 0 o NaN → 0 (sin división por cero)', () => {
    expect(computeICP(15000, 0)).toBe(0)
    expect(computeICP(15000, null)).toBe(0)
    expect(computeICP(null, 300000)).toBe(0)   // 0 propinas
    expect(computeICP(15000, -5)).toBe(0)
  })
})

describe('icpVsTeam', () => {
  it('calcula mine, team y diff', () => {
    const r = icpVsTeam(15000, 300000, 40000, 1000000)  // mine 5%, team 4%
    expect(r.mine).toBeCloseTo(5, 5)
    expect(r.team).toBeCloseTo(4, 5)
    expect(r.diff).toBeCloseTo(1, 5)
  })
  it('null-safe → 0s', () => {
    expect(icpVsTeam(null, null, null, null)).toEqual({ mine: 0, team: 0, diff: 0 })
  })
})

// ── shiftMonth / monthLabelLong ───────────────────────────────
describe('shiftMonth', () => {
  it('navega meses con rollover de año', () => {
    expect(shiftMonth('2026-07', -1)).toBe('2026-06')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-07', 0)).toBe('2026-07')
  })
  it('null-safe', () => {
    expect(shiftMonth('', 1)).toBe('')
    expect(shiftMonth('2026', 1)).toBe('2026')
  })
})

describe('monthLabelLong', () => {
  it('formatea YYYY-MM a "Mes YYYY"', () => {
    expect(monthLabelLong('2026-07')).toBe('Julio 2026')
    expect(monthLabelLong('2026-01')).toBe('Enero 2026')
  })
  it('null-safe', () => {
    expect(monthLabelLong('')).toBe('')
  })
})
