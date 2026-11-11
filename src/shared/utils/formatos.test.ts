import { describe, expect, it } from 'vitest'
import { fd, fi } from './index'

describe('fi / fd con negativos (pantalla, 08-nov)', () => {
  it('fi: nunca «−0» y el medio redondea para afuera igual en los dos signos', () => {
    expect(fi(-0.4)).toBe('₡ 0')
    expect(fi(0.4)).toBe('₡ 0')
    expect(fi(-1234.5)).toBe(fi(1234.5).replace('₡ ', '₡ -'))
    expect(fi(1234.5)).toBe('₡ ' + (1235).toLocaleString('es-CR'))
    expect(fi(-1234.4)).toBe('₡ ' + (-1234).toLocaleString('es-CR'))
  })
  it('fi: positivos y vacíos, como antes', () => {
    expect(fi(1000)).toBe('₡ ' + (1000).toLocaleString('es-CR'))
    expect(fi(null)).toBe('—')
    expect(fi(Number.NaN)).toBe('—')
  })
  it('fd: dos decimales, nunca «−0,00», simétrico', () => {
    expect(fd(-0.004)).toBe(fd(0))
    expect(fd(-10.005)).toBe(fd(10.005).replace('$ ', '$ -'))
    expect(fd(1234.5)).toBe('$ ' + (1234.5).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  })
})
