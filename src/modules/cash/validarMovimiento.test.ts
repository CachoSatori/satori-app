import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { errorMontos, errorMovimiento, errorTraspaso, esDireccionValida, parsearMonto, TRASPASOS } from './validarMovimiento'

describe('errorMontos', () => {
  it('egresos y traspasos: nunca negativos', () => {
    for (const tipo of ['egreso_operativo', 'egreso_mercaderia', 'egreso_personal', 'traspaso']) {
      expect(errorMontos({ tipo, crc: -1, usd: 0 }), tipo).toMatch(/negativo/)
      expect(errorMontos({ tipo, crc: -1, usd: 5 }), tipo).toMatch(/negativo/)
      expect(errorMontos({ tipo, crc: 0, usd: -1 }), tipo).toMatch(/dólares/)
      expect(errorMontos({ tipo, crc: 5000, usd: 0 }), tipo).toBeNull()
    }
  })
  it('ingreso: colones negativos SOLO con dólares (el vuelto)', () => {
    expect(errorMontos({ tipo: 'ingreso', crc: -1200, usd: 40 })).toBeNull()
    expect(errorMontos({ tipo: 'ingreso', crc: -1200, usd: 0 })).toMatch(/vuelto/)
    expect(errorMontos({ tipo: 'ingreso', crc: 100, usd: -1 })).toMatch(/dólares/)
  })
  it('números raros: NaN e Infinity no pasan; vacío = 0', () => {
    expect(errorMontos({ tipo: 'ingreso', crc: NaN, usd: 0 })).toMatch(/válido/)
    expect(errorMontos({ tipo: 'ingreso', crc: Infinity, usd: 0 })).toMatch(/válido/)
    expect(errorMontos({ tipo: 'ingreso', crc: '', usd: '' })).toBeNull()
  })
})

describe('dirección del traspaso: solo de la lista', () => {
  it('las dos direcciones de la lista valen; texto libre u otra flecha, no', () => {
    expect(TRASPASOS).toEqual(['Banco → Caja Fuerte', 'Caja Fuerte → Banco'])
    for (const t of TRASPASOS) expect(esDireccionValida(t)).toBe(true)
    for (const t of ['Banco -> Caja Fuerte', 'Ajuste', '', null, 'banco → caja fuerte']) expect(esDireccionValida(t)).toBe(false)
    expect(errorTraspaso({ tipo: 'traspaso', subcategory: 'Banco -> Caja Fuerte' })).toMatch(/lista/)
    expect(errorTraspaso({ tipo: 'ingreso', subcategory: 'lo que sea' })).toBeNull()
  })
  it('la app no arma traspasos con texto libre: CashMovimientos usa la lista y el retiro del cierre usa una de sus direcciones', () => {
    const mov = readFileSync(join(__dirname, 'CashMovimientos.tsx'), 'utf8')
    const conceptosTraspaso = mov.match(/type: 'traspaso',[^\n]*sub: ([^,]+),/g) ?? []
    expect(conceptosTraspaso.length).toBe(2)
    for (const c of conceptosTraspaso) expect(c).toMatch(/sub: TRASPASOS\[[01]\]/)
    const api = readFileSync(join(__dirname, '../../shared/api/cash.ts'), 'utf8')
    for (const sub of api.match(/subcategory:\s+'[^']*→[^']*'/g) ?? []) {
      expect(esDireccionValida(sub.replace(/subcategory:\s+'|'$/g, ''))).toBe(true)
    }
  })
})

describe('parsearMonto: nada inválido se vuelve 0', () => {
  it('formatos válidos (punto o coma decimal, miles con punto)', () => {
    expect(parsearMonto('1500')).toBe(1500)
    expect(parsearMonto('1500.50')).toBe(1500.5)
    expect(parsearMonto('1500,50')).toBe(1500.5)
    expect(parsearMonto('1.234,5')).toBe(1234.5)
    expect(parsearMonto(' -1200 ')).toBe(-1200)
    expect(parsearMonto(42)).toBe(42)
  })
  it('vacío = 0 (campo sin cargar)', () => {
    for (const v of ['', '   ', null, undefined]) expect(parsearMonto(v)).toBe(0)
  })
  it('lo inválido queda NaN (nunca 0)', () => {
    for (const v of ['abc', '12abc', '1,2,3', '1.5,5', Number.NaN, Infinity, -Infinity, {}, '∞']) {
      expect(Number.isNaN(parsearMonto(v)), String(v)).toBe(true)
    }
  })
})

describe('errorMovimiento: el movimiento completo después del cambio', () => {
  it('egreso nunca negativo, aunque tenga dólares', () => {
    expect(errorMovimiento({ tipo: 'egreso_operativo', crc: -1, usd: 10 })).toMatch(/negativo/)
  })
  it('un ingreso con vuelto (₡ < 0, $ > 0) no puede pasar a egreso', () => {
    expect(errorMovimiento({ tipo: 'ingreso', crc: -1200, usd: 40 })).toBeNull()
    expect(errorMovimiento({ tipo: 'egreso_mercaderia', crc: -1200, usd: 40 })).toMatch(/negativo/)
  })
  it('coma decimal válida; texto inválido, NaN e infinito no', () => {
    expect(errorMovimiento({ tipo: 'ingreso', crc: '1500,5', usd: 0 })).toBeNull()
    expect(errorMovimiento({ tipo: 'ingreso', crc: '15oo', usd: 0 })).toMatch(/válido/)
    expect(errorMovimiento({ tipo: 'ingreso', crc: Infinity, usd: 0 })).toMatch(/válido/)
  })
  it('cero en las dos monedas: solo si se exige monto', () => {
    expect(errorMovimiento({ tipo: 'ingreso', crc: 0, usd: '', exigirMonto: true })).toMatch(/cero/)
    expect(errorMovimiento({ tipo: 'ingreso', crc: 0, usd: 0 })).toBeNull()
  })
  it('traspaso: con subcategoría, la dirección tiene que ser de la lista', () => {
    expect(errorMovimiento({ tipo: 'traspaso', crc: 100, usd: 0, subcategory: 'Banco -> Caja Fuerte' })).toMatch(/lista/)
    expect(errorMovimiento({ tipo: 'traspaso', crc: 100, usd: 0, subcategory: TRASPASOS[0] })).toBeNull()
  })
})
