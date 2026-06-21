import { describe, it, expect } from 'vitest'
import { monthRangeBounds } from './dateRange'

// El bug original: límite superior `${ym}-31` → fecha inválida en meses ≤30 días y febrero.
// El helper debe devolver SIEMPRE como límite superior (exclusivo) el 1° del mes siguiente,
// que nunca es una fecha inválida y no depende del largo del mes.

const isValidISODate = (s: string) => {
  // 'YYYY-MM-DD' que round-trip-ea por Date.UTC sin desbordar (ej. 2026-06-31 NO round-trip-ea).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

describe('monthRangeBounds', () => {
  it('junio (30 días): límite superior = 1° de julio, no 06-31', () => {
    const b = monthRangeBounds('2026-06')
    expect(b.start).toBe('2026-06-01')
    expect(b.startTs).toBe('2026-06-01T00:00:00Z')
    expect(b.endExclusive).toBe('2026-07-01')
    expect(b.endExclusiveTs).toBe('2026-07-01T00:00:00Z')
    expect(isValidISODate(b.endExclusive)).toBe(true)
  })

  it('febrero no bisiesto (28 días): límite superior = 1° de marzo', () => {
    const b = monthRangeBounds('2026-02')
    expect(b.start).toBe('2026-02-01')
    expect(b.endExclusive).toBe('2026-03-01')
    expect(isValidISODate(b.endExclusive)).toBe(true)
  })

  it('febrero bisiesto (29 días, 2028): límite superior = 1° de marzo', () => {
    const b = monthRangeBounds('2028-02')
    expect(b.endExclusive).toBe('2028-03-01')
    expect(isValidISODate(b.endExclusive)).toBe(true)
  })

  it('mes de 31 días (enero): límite superior = 1° de febrero (equivale a <= 01-31)', () => {
    const b = monthRangeBounds('2026-01')
    expect(b.start).toBe('2026-01-01')
    expect(b.endExclusive).toBe('2026-02-01')
    expect(b.endExclusiveTs).toBe('2026-02-01T00:00:00Z')
  })

  it('diciembre → enero del año siguiente (cruce de año)', () => {
    const b = monthRangeBounds('2026-12')
    expect(b.start).toBe('2026-12-01')
    expect(b.endExclusive).toBe('2027-01-01')
    expect(b.endExclusiveTs).toBe('2027-01-01T00:00:00Z')
    expect(isValidISODate(b.endExclusive)).toBe(true)
  })

  it('el límite superior NUNCA es una fecha inválida (todos los meses del año)', () => {
    for (let m = 1; m <= 12; m++) {
      const ym = `2026-${String(m).padStart(2, '0')}`
      const b = monthRangeBounds(ym)
      expect(isValidISODate(b.endExclusive)).toBe(true)
      // y siempre es un día 01
      expect(b.endExclusive.slice(8, 10)).toBe('01')
    }
  })
})
