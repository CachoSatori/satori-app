import { describe, it, expect } from 'vitest'
import { splitEven, splitByGroup, splitByItem, checksReconcile } from './posSplit'
import { computeTotals } from './posFiscal'
import type { BillItem } from './posFiscal'

const item = (name: string, price: number, seat: number): BillItem =>
  ({ product_name: name, qty: 1, price_final_crc: price, modifiers: [], tax_type: 'iva13', seat })

// 3 ítems en salón → total con servicio 10% + IVA derivado
const lines: BillItem[] = [
  item('ROLL A', 7500, 1),
  item('ROLL B', 6500, 2),
  item('AGUA', 3900, 1),
]
const TOTAL = computeTotals(lines, 'salon').total

describe('splitEven — reparto parejo (SPEC F15)', () => {
  it('n iguales suman exactamente el total (último absorbe el resto)', () => {
    for (const n of [2, 3, 4, 7]) {
      const parts = splitEven(TOTAL, n)
      expect(parts).toHaveLength(n)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(Math.round(TOTAL))
    }
  })
  it('caso con resto: 10001 / 3 = 3333,3333,3335', () => {
    expect(splitEven(10001, 3)).toEqual([3333, 3333, 3335])
  })
  it('n=1 devuelve el total entero', () => {
    expect(splitEven(12345, 1)).toEqual([12345])
  })
})

describe('splitByGroup — por asiento (SPEC F15)', () => {
  it('agrupa por asiento y reconcilia al total', () => {
    const { checks, total } = splitByGroup(lines, l => String(l.seat), k => `Asiento ${k}`, 'salon')
    expect(total).toBe(TOTAL)
    // asiento 1 = ROLL A + AGUA · asiento 2 = ROLL B
    expect(checks).toHaveLength(2)
    expect(checksReconcile(checks, TOTAL)).toBe(true)
  })
})

describe('splitByItem — por ítem con compartidos (SPEC F15)', () => {
  it('cada ítem a un check distinto reconcilia', () => {
    // ROLL A→0, ROLL B→1, AGUA→0
    const { checks } = splitByItem(lines, i => [0, 1, 0][i], 2, 'salon')
    expect(checks).toHaveLength(2)
    expect(checksReconcile(checks, TOTAL)).toBe(true)
  })
  it('ítem COMPARTIDO (null) se prorratea y la suma sigue exacta', () => {
    // ROLL A→0, ROLL B→1, AGUA compartida
    const { checks } = splitByItem(lines, i => [0, 1, null][i], 2, 'salon')
    expect(checksReconcile(checks, TOTAL)).toBe(true)
  })
  it('TODO compartido = equivalente a parejo, reconcilia', () => {
    const { checks } = splitByItem(lines, () => null, 3, 'salon')
    expect(checks).toHaveLength(3)
    expect(checksReconcile(checks, TOTAL)).toBe(true)
  })
})

describe('INVARIANTE — suma de checks == total (al colón), todos los modos', () => {
  const big: BillItem[] = Array.from({ length: 9 }, (_, i) => item(`P${i}`, 1000 + i * 333, (i % 3) + 1))
  const t = computeTotals(big, 'salon').total
  it('parejo en 2..6 siempre cuadra', () => {
    for (const n of [2, 3, 4, 5, 6]) expect(splitEven(t, n).reduce((a, b) => a + b, 0)).toBe(Math.round(t))
  })
  it('por asiento cuadra', () => {
    expect(checksReconcile(splitByGroup(big, l => String(l.seat), k => k, 'salon').checks, t)).toBe(true)
  })
  it('por ítem con mezcla de exclusivos y compartidos cuadra', () => {
    expect(checksReconcile(splitByItem(big, i => (i % 4 === 0 ? null : i % 3), 3, 'salon').checks, t)).toBe(true)
  })
})

describe('INVARIANTE merge — checks por mesa de origen reconcilian (T1)', () => {
  // Mesa A (asiento como proxy de origen "into") + Mesa B combinada → 2 grupos por origen.
  const itemsA: BillItem[] = [item('ROLL A', 7500, 1), item('AGUA', 3900, 1)]
  const itemsB: BillItem[] = [item('ROLL B', 6500, 1), item('CERVEZA', 2500, 1), item('POSTRE', 4200, 1)]
  const all = [...itemsA, ...itemsB]
  const origin = (_b: BillItem, i: number) => (i < itemsA.length ? 'A' : 'B')
  it('Σ de los 2 checks de merge = total combinado al colón', () => {
    const { checks, total } = splitByGroup(all, origin, k => `Mesa ${k}`, 'salon')
    expect(checks).toHaveLength(2)
    expect(checksReconcile(checks, total)).toBe(true)
    expect(total).toBe(computeTotals(all, 'salon').total)
  })
})
