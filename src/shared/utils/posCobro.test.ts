import { describe, it, expect } from 'vitest'
import { calcularVuelto, convertirCrcAUsd, convertirUsdACrc, vueltoPagoUsd, roundCrc } from './posCobro'

describe('calcularVuelto — efectivo en ₡ (SPEC F18)', () => {
  it('recibido > total → vuelto positivo', () => {
    expect(calcularVuelto(12500, 20000)).toEqual({ vuelto_crc: 7500, falta_crc: 0, alcanza: true })
  })
  it('recibido = total → vuelto 0, alcanza', () => {
    expect(calcularVuelto(12500, 12500)).toEqual({ vuelto_crc: 0, falta_crc: 0, alcanza: true })
  })
  it('recibido < total → vuelto 0, falta lo que resta, no alcanza', () => {
    expect(calcularVuelto(12500, 10000)).toEqual({ vuelto_crc: 0, falta_crc: 2500, alcanza: false })
  })
  it('nunca devuelve vuelto negativo', () => {
    expect(calcularVuelto(5000, 0).vuelto_crc).toBe(0)
  })
  it('redondea cada monto a colón entero (sin céntimos en efectivo)', () => {
    // 12500.4→12500, 20000.4→20000 → vuelto 7500
    expect(calcularVuelto(12500.4, 20000.4)).toEqual({ vuelto_crc: 7500, falta_crc: 0, alcanza: true })
  })
})

describe('conversión de moneda (SPEC F17)', () => {
  it('₡ → $ a 2 decimales', () => {
    expect(convertirCrcAUsd(386528, 500)).toBe(773.06)
  })
  it('$ → ₡ a colón entero', () => {
    expect(convertirUsdACrc(100, 510)).toBe(51000)
  })
  it('TC inválido (0 o negativo) → 0, sin romper', () => {
    expect(convertirCrcAUsd(10000, 0)).toBe(0)
    expect(convertirUsdACrc(100, 0)).toBe(0)
  })
  it('ida y vuelta es estable dentro del redondeo', () => {
    const tc = 505
    const usd = convertirCrcAUsd(50000, tc)   // 99.01
    expect(convertirUsdACrc(usd, tc)).toBeCloseTo(50000, -2)  // ~₡50.000 ± redondeo
  })
})

describe('vueltoPagoUsd — turista paga en $ sobre total ₡ (SPEC F18 dual)', () => {
  it('paga $100 sobre ₡40.000 a TC 510 → recibido ₡51.000, vuelto ₡11.000', () => {
    const r = vueltoPagoUsd(40000, 100, 510)
    expect(r.recibido_crc).toBe(51000)
    expect(r.vuelto_crc).toBe(11000)
    expect(r.alcanza).toBe(true)
  })
  it('paga $50 sobre ₡40.000 a TC 510 → recibido ₡25.500, falta ₡14.500', () => {
    const r = vueltoPagoUsd(40000, 50, 510)
    expect(r.recibido_crc).toBe(25500)
    expect(r.falta_crc).toBe(14500)
    expect(r.alcanza).toBe(false)
  })
  it('el vuelto del pago en $ se entrega en ₡ (la caja da colones)', () => {
    // exactamente el total en $ → vuelto 0
    const tc = 500
    const r = vueltoPagoUsd(50000, 100, tc)
    expect(r.recibido_crc).toBe(50000)
    expect(r.vuelto_crc).toBe(0)
  })
})

describe('roundCrc helper', () => {
  it('redondea media unidad hacia arriba', () => {
    expect(roundCrc(7499.5)).toBe(7500)
  })
})
