import { describe, it, expect } from 'vitest'

import { anteriorFactura, compararFactura, mayorFactura, normalizarFactura } from './factura.ts'

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

describe('anteriorFactura — el tope del cursor por debajo de una R', () => {
  it('resta uno como entero, no como texto', () => {
    expect(anteriorFactura('110850')).toBe('110849')
    expect(anteriorFactura('5001')).toBe('5000')
    expect(anteriorFactura('1')).toBe('0')
  })

  it('el préstamo cruza los ceros y suelta el cero a la izquierda', () => {
    expect(anteriorFactura('1000')).toBe('999')
    expect(anteriorFactura('100')).toBe('99')
    expect(anteriorFactura('10')).toBe('9')
    expect(anteriorFactura('2000000000000000000000')).toBe('1999999999999999999999')  // > 2^53
  })

  it('normaliza antes: ceros a la izquierda y decimales en cero', () => {
    expect(anteriorFactura(' 005001.00 ')).toBe('5000')
  })

  it("no hay anterior de '0', y lo ilegible da null", () => {
    expect(anteriorFactura('0')).toBeNull()
    expect(anteriorFactura('A-1')).toBeNull()
    expect(anteriorFactura(null)).toBeNull()
  })

  it('anterior(n) < n, siempre, por compararFactura', () => {
    for (const n of ['1', '10', '100', '110850', '99999999999999999999']) {
      expect(compararFactura(anteriorFactura(n)!, n)).toBe(-1)
    }
  })
})
