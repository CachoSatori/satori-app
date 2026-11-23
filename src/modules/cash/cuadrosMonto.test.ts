// R31 — lectura de los cuadros de monto (apertura, cierre de turno y Cierre del día). Módulo puro.
import { describe, it, expect } from 'vitest'
import { errorDeCuadros, marcaIlegible, msgCuadroIlegible, msgCuadroNegativo } from './cuadrosMonto'

describe('errorDeCuadros', () => {
  it('vacío, cero y montos válidos: sin error', () => {
    expect(errorDeCuadros([
      { nombre: 'A', valor: '', ilegible: false },
      { nombre: 'B', valor: 0, ilegible: false },
      { nombre: 'C', valor: 120000.5, ilegible: false },
    ])).toBeNull()
  })
  it('badInput (el estado es \'\'): «no es un número» con el nombre del cuadro', () => {
    expect(errorDeCuadros([{ nombre: 'Fondo ₡', valor: '', ilegible: true }])).toBe(msgCuadroIlegible('Fondo ₡'))
  })
  it('NaN en el estado (aunque no haya marca): también es ilegible', () => {
    expect(errorDeCuadros([{ nombre: 'X', valor: Number.NaN, ilegible: false }])).toBe(msgCuadroIlegible('X'))
  })
  it('negativo: aviso, salvo admiteNegativo', () => {
    expect(errorDeCuadros([{ nombre: 'X', valor: -450, ilegible: false }])).toBe(msgCuadroNegativo('X'))
    expect(errorDeCuadros([{ nombre: 'X', valor: -450, ilegible: false, admiteNegativo: true }])).toBeNull()
  })
  it('el primero que falla es el que se nombra', () => {
    expect(errorDeCuadros([
      { nombre: 'Bien', valor: 5, ilegible: false },
      { nombre: 'Primero', valor: '', ilegible: true },
      { nombre: 'Segundo', valor: -1, ilegible: false },
    ])).toBe(msgCuadroIlegible('Primero'))
  })
})

describe('marcaIlegible', () => {
  it('lee validity.badInput; sin validity, false', () => {
    expect(marcaIlegible({ validity: { badInput: true } })).toBe(true)
    expect(marcaIlegible({ validity: { badInput: false } })).toBe(false)
    expect(marcaIlegible({})).toBe(false)
  })
})
