import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { errorMontos, errorTraspaso, esDireccionValida, TRASPASOS } from './validarMovimiento'

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
