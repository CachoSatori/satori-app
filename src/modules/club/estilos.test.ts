import { describe, it, expect } from 'vitest'
import { fmtFecha, mesActualCR } from './estilos'

describe('fechas del Club (10-nov)', () => {
  it('una fecha sola es un día del calendario: no se corre al día anterior en Costa Rica', () => {
    expect(fmtFecha('2026-11-09')).toBe(new Date('2026-11-09T12:00:00Z').toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }))
    expect(fmtFecha('2026-11-09')).toMatch(/^09/)
    expect(fmtFecha('2026-11-01')).toMatch(/^01/)
  })
  it('un instante se muestra en la hora de Costa Rica (02:00 UTC del 10 es todavía el 09 en CR)', () => {
    expect(fmtFecha('2026-11-10T02:00:00Z')).toMatch(/^09/)
    expect(fmtFecha(null)).toBe('—')
  })
  it('Reportes abre en el mes en curso de Costa Rica (el 1.º a las 03:00 UTC todavía es el mes anterior en CR)', () => {
    expect(mesActualCR(new Date('2026-11-09T20:00:00Z'))).toBe('2026-11')
    expect(mesActualCR(new Date('2026-12-01T03:00:00Z'))).toBe('2026-11')
    expect(mesActualCR(new Date('2026-12-01T07:00:00Z'))).toBe('2026-12')
  })
})
