import { describe, it, expect } from 'vitest'
import { fi, fip } from './index'

describe('fi() · colones al estándar de los reportes', () => {
  it('₡ pegado, punto de miles y sin decimales', () => {
    expect(fi(1_460_000)).toBe('₡1.460.000')
    expect(fi(999)).toBe('₡999')
    expect(fi(1000)).toBe('₡1.000')
    expect(fi(0)).toBe('₡0')
    expect(fi(1234.6)).toBe('₡1.235')
  })
  it('negativos y vacíos', () => {
    expect(fi(-40_000)).toBe('₡-40.000')
    expect(fi(null)).toBe('—')
    expect(fi(undefined)).toBe('—')
    expect(fi(NaN)).toBe('—')
  })
  it('fip() suma el signo', () => {
    expect(fip(5_000)).toBe('+₡5.000')
    expect(fip(-5_000)).toBe('₡-5.000')
  })
})
