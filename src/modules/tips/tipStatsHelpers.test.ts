import { describe, it, expect } from 'vitest'
import { distribucionPorPuesto } from './tipStatsHelpers'

describe('distribucionPorPuesto — % de take-home por puesto (incluye cocina)', () => {
  const earners = [
    { role: 'salonero', total: 60000 },
    { role: 'salonero', total: 40000 },  // otra salonera → salonero = 100000
    { role: 'cocina',   total: 50000 },
    { role: 'barman',   total: 30000 },
  ]

  it('agrupa por rol, ordena desc por total', () => {
    const d = distribucionPorPuesto(earners)
    expect(d.total).toBe(180000)
    expect(d.rows.map(r => r.role)).toEqual(['salonero', 'cocina', 'barman'])
    expect(d.rows[0]).toMatchObject({ role: 'salonero', total: 100000 })
  })

  it('COCINA aparece con su % real (no se filtra)', () => {
    const d = distribucionPorPuesto(earners)
    const cocina = d.rows.find(r => r.role === 'cocina')
    expect(cocina).toBeTruthy()
    expect(cocina!.pct).toBeCloseTo(50000 / 180000 * 100, 5)  // ≈ 27.78%
  })

  it('los % suman ~100', () => {
    const d = distribucionPorPuesto(earners)
    const sum = d.rows.reduce((s, r) => s + r.pct, 0)
    expect(sum).toBeCloseTo(100, 5)
  })

  it('roles con take-home 0 (solo generaron, no recibieron) NO ensucian el gráfico', () => {
    const d = distribucionPorPuesto([...earners, { role: 'runner', total: 0 }])
    expect(d.rows.some(r => r.role === 'runner')).toBe(false)
    expect(d.total).toBe(180000)
  })

  it('null-safe: lista nula/vacía o fila sin rol → distribución vacía', () => {
    expect(distribucionPorPuesto(null)).toEqual({ total: 0, rows: [] })
    expect(distribucionPorPuesto([])).toEqual({ total: 0, rows: [] })
    const messy = distribucionPorPuesto([{ role: '', total: 999 }, { role: 'cajero', total: 1000 }])
    expect(messy.rows.map(r => r.role)).toEqual(['cajero'])
    expect(messy.total).toBe(1000)
  })
})
