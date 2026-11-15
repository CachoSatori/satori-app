// Hallazgos 225/226 (auditoría externa, 15-nov): lectura de montos escritos a mano en Saldo a favor.
import { describe, it, expect } from 'vitest'
import { parseMonto, MSG_MONTO_NEGATIVO, MSG_MONTO_MILES, MSG_MONTO_INVALIDO, msgMontoDecimales } from './montos'

describe('parseMonto — un solo separador decimal, sin miles, sin signo', () => {
  it('entero', () => {
    expect(parseMonto('12345')).toEqual({ valor: 12345, error: null })
    expect(parseMonto('  500 ')).toEqual({ valor: 500, error: null })
  })
  it('céntimos con punto o con coma dan lo mismo', () => {
    expect(parseMonto('12345.50')).toEqual({ valor: 12345.5, error: null })
    expect(parseMonto('12345,50')).toEqual({ valor: 12345.5, error: null })
    expect(parseMonto('0,5')).toEqual({ valor: 0.5, error: null })
  })
  it('«12.345» y «12,345» (¿miles o decimales?) NO se adivinan: error, nunca 12 ni 12345', () => {
    expect(parseMonto('12.345')).toEqual({ valor: null, error: msgMontoDecimales(2) })
    expect(parseMonto('12,345')).toEqual({ valor: null, error: msgMontoDecimales(2) })
  })
  it('separador de miles con varios grupos → error de miles', () => {
    expect(parseMonto('1.234.567')).toEqual({ valor: null, error: MSG_MONTO_MILES })
    expect(parseMonto('1,234,567')).toEqual({ valor: null, error: MSG_MONTO_MILES })
    expect(parseMonto('1.234,50')).toEqual({ valor: null, error: MSG_MONTO_MILES })
    expect(parseMonto('12.')).toEqual({ valor: null, error: MSG_MONTO_MILES })
  })
  it('negativos → error (antes el filtro borraba el «-» y quedaba positivo)', () => {
    expect(parseMonto('-500')).toEqual({ valor: null, error: MSG_MONTO_NEGATIVO })
    expect(parseMonto('-12,50')).toEqual({ valor: null, error: MSG_MONTO_NEGATIVO })
  })
  it('letras, símbolos o espacios internos → error', () => {
    expect(parseMonto('₡500')).toEqual({ valor: null, error: MSG_MONTO_INVALIDO })
    expect(parseMonto('12 345')).toEqual({ valor: null, error: MSG_MONTO_INVALIDO })
    expect(parseMonto('abc')).toEqual({ valor: null, error: MSG_MONTO_INVALIDO })
  })
  it('vacío → sin valor y sin error (lo decide el formulario)', () => {
    expect(parseMonto('')).toEqual({ valor: null, error: null })
    expect(parseMonto('   ')).toEqual({ valor: null, error: null })
    expect(parseMonto(undefined)).toEqual({ valor: null, error: null })
  })
  it('columna entera (maxDecimales 0): no acepta decimales y avisa', () => {
    expect(parseMonto('12345', 0)).toEqual({ valor: 12345, error: null })
    expect(parseMonto('12,5', 0)).toEqual({ valor: null, error: msgMontoDecimales(0) })
  })
})
