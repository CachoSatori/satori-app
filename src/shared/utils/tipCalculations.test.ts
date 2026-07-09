import { describe, it, expect } from 'vitest'
import { calcTurno } from './tipCalculations'
import type { DraftLine } from './tipCalculations'
import type { UserRole } from '../types/database'

function line(over: Partial<DraftLine> & { role: UserRole }): DraftLine {
  return {
    employeeId: over.employeeId ?? Math.random().toString(36).slice(2),
    employeeName: 'Test',
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

describe('calcTurno — reparto del pool de propinas', () => {
  it('pool general = efectivo + datáfonos de sala, repartido por puntos (pts_rol × horas)', () => {
    const salonero = line({ role: 'salonero', hours: 8, pts_rol: 10, propina_crc: 20_000 })
    const runner   = line({ role: 'runner', hours: 4, pts_rol: 5 })
    const { totals, updatedLines } = calcTurno([salonero, runner], 80_000, 0, 0, 500)
    // pool = 80.000 efectivo + 20.000 datáfono salonero = 100.000
    expect(totals.generalPool).toBe(100_000)
    // puntos: 8×10=80 + 4×5=20 = 100 → tasa 1.000/punto
    expect(totals.totalPoints).toBe(100)
    expect(totals.generalRate).toBe(1_000)
    expect(updatedLines[0].take_home).toBe(80_000)
    expect(updatedLines[1].take_home).toBe(20_000)
    // lo distribuido = el pool completo
    expect(updatedLines.reduce((s, l) => s + l.take_home, 0)).toBe(totals.totalPool)
  })

  it('el efectivo en USD entra al pool al tipo de cambio', () => {
    const s = line({ role: 'salonero', hours: 1, pts_rol: 1 })
    const { totals } = calcTurno([s], 0, 100, 0, 510)
    expect(totals.generalPool).toBe(51_000)
  })

  it('pool barra se reparte SOLO entre barra, por horas, además del pool general', () => {
    const salonero = line({ role: 'salonero', hours: 5, pts_rol: 10 })
    const barman   = line({ role: 'barman', hours: 6, pts_rol: 10 })
    const barback  = line({ role: 'barback', hours: 2, pts_rol: 5 })
    const { totals, updatedLines } = calcTurno([salonero, barman, barback], 120_000, 0, 40_000, 500)
    // puntos: 50 + 60 + 10 = 120 → tasa = 1.000
    expect(totals.generalRate).toBe(1_000)
    // barra: 8h totales → barman 6/8 de 40.000 = 30.000 + general 60.000
    expect(updatedLines[1].take_home).toBe(90_000)
    // barback 2/8 de 40.000 = 10.000 + general 10.000
    expect(updatedLines[2].take_home).toBe(20_000)
    // salonero NO recibe pool barra
    expect(updatedLines[0].take_home).toBe(50_000)
    expect(totals.totalPool).toBe(160_000)
  })

  it('inactivos no participan ni aportan datáfono', () => {
    const activo   = line({ role: 'salonero', hours: 8, pts_rol: 10 })
    const inactivo = line({ role: 'salonero', hours: 8, pts_rol: 10, active: false, propina_crc: 50_000 })
    const { totals, updatedLines } = calcTurno([activo, inactivo], 40_000, 0, 0, 500)
    expect(totals.generalPool).toBe(40_000)
    expect(updatedLines[0].take_home).toBe(40_000)
    expect(updatedLines[1].take_home).toBe(0)
  })

  it('sin puntos trabajados → tasa 0, nadie cobra (no divide por cero)', () => {
    const { totals } = calcTurno([], 100_000, 0, 0, 500)
    expect(totals.generalRate).toBe(0)
    expect(Number.isFinite(totals.generalRate)).toBe(true)
  })

  it('no muta las líneas originales', () => {
    const orig = line({ role: 'salonero', hours: 8, pts_rol: 10 })
    calcTurno([orig], 10_000, 0, 0, 500)
    expect(orig.take_home).toBe(0)
    expect(orig.pts_val).toBe(0)
  })

  // GUARDRAIL (propinas-efectivo-electronico): la UI ahora divide la barra en efectivo +
  // electrónico y le pasa a calcTurno la SUMA. Este test fija que el take_home por empleado es
  // idéntico se pase la barra como un único número o como la suma de sus dos partes — la firma de
  // calcTurno no cambió y el reparto es invariante a cómo se componga ese total de barra.
  it('mismo take_home con la barra dividida (efectivo + electrónico) vs. como un único pool', () => {
    const mk = () => [
      line({ employeeId: 'sal', role: 'salonero', hours: 5, pts_rol: 10, propina_crc: 15_000 }),
      line({ employeeId: 'bar', role: 'barman', hours: 6, pts_rol: 10 }),
      line({ employeeId: 'bbk', role: 'barback', hours: 2, pts_rol: 5 }),
    ]
    const unico   = calcTurno(mk(), 120_000, 50, 40_000, 600)          // barra = 40.000 de una
    const dividido = calcTurno(mk(), 120_000, 50, 25_000 + 15_000, 600) // barra = 25.000 ef + 15.000 elec
    const th = (r: ReturnType<typeof calcTurno>) =>
      Object.fromEntries(r.updatedLines.map(l => [l.employeeId, Math.round(l.take_home)]))
    expect(th(dividido)).toEqual(th(unico))
    expect(unico.totals.totalPool).toBe(dividido.totals.totalPool)
  })
})
