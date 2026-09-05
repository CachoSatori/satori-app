import { describe, it, expect } from 'vitest'

import { compararFactura, mayorFactura, normalizarFactura } from './factura.ts'

describe('normalizarFactura', () => {
  it('limpia espacios, ceros a la izquierda y decimales en cero', () => {
    expect(normalizarFactura(' 005001 ')).toBe('5001')
    expect(normalizarFactura('5001.00')).toBe('5001')
    expect(normalizarFactura('5001.')).toBe('5001')
    expect(normalizarFactura(5001)).toBe('5001')
    expect(normalizarFactura('0')).toBe('0')
  })

  it('devuelve null cuando no es un entero decimal', () => {
    for (const v of [null, undefined, '', '  ', 'A-5001', '5001.75', '-5', {}]) {
      expect(normalizarFactura(v)).toBeNull()
    }
  })
})

describe('compararFactura', () => {
  it('compara por VALOR, no como texto ("9" NO es mayor que "10")', () => {
    expect(compararFactura('9', '10')).toBe(-1)
    expect(compararFactura('10', '9')).toBe(1)
    expect(compararFactura('5001', '5001')).toBe(0)
    expect(compararFactura('5002', '5001')).toBe(1)
  })

  it('funciona arriba de 2^53, donde Number ya miente', () => {
    const a = '9007199254740993'
    const b = '9007199254740992'
    expect(compararFactura(a, b)).toBe(1)
    expect(Number(a) > Number(b)).toBe(false)   // ← por eso NO se usa Number
  })
})

describe('mayorFactura', () => {
  it('devuelve el mayor de la tanda, respetando el cursor actual', () => {
    expect(mayorFactura(['5001', '5010', '5009'])).toBe('5010')
    expect(mayorFactura(['5001', '5009'], '5010')).toBe('5010')
    expect(mayorFactura(['5011'], '5010')).toBe('5011')
  })

  it('ignora los ilegibles y tolera la tanda vacía', () => {
    expect(mayorFactura(['x', null, '5003'], null)).toBe('5003')
    expect(mayorFactura([], null)).toBeNull()
    expect(mayorFactura([], '5001')).toBe('5001')
  })
})
