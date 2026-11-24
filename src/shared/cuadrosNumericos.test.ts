// Reglas de los cuadros numéricos fuera de caja (R35): lo ilegible es NaN y da un aviso que nombra el cuadro; vacío vale
// solo donde la pantalla ya lo aceptaba; los topes («1e3» = 1000) se cumplen. Módulo puro.
import { describe, expect, it } from 'vitest'
import { errorDeNumeros, leerCuadro, numeroDe, reglaDe, valorInput } from './cuadrosNumericos'
import * as tips from '../modules/tips/validarTurno'
import * as shared from './cuadrosNumericos'

describe('leerCuadro · lo que trae un <input type="number">', () => {
  it('badInput → NaN aunque value sea "" (antes contaba como vacío = 0)', () => {
    expect(Number.isNaN(leerCuadro({ value: '', validity: { badInput: true } }))).toBe(true)
  })
  it('vacío → "", número → número; «1e3» es legible (1000): el tope lo frena la regla', () => {
    expect(leerCuadro({ value: '', validity: { badInput: false } })).toBe('')
    expect(leerCuadro({ value: '12.5' })).toBe(12.5)
    expect(leerCuadro({ value: '1e3' })).toBe(1000)
  })
  it('valorInput: NaN → "" para que React no borre lo que se ve', () => {
    expect(valorInput(Number.NaN)).toBe('')
    expect(valorInput(7)).toBe(7)
  })
  it('validarTurno reexporta los mismos helpers (mudanza sin cambios)', () => {
    expect(tips.alEscribir).toBe(shared.alEscribir)
    expect(tips.esIlegible).toBe(shared.esIlegible)
    expect(tips.valorInput).toBe(shared.valorInput)
  })
})

describe('numeroDe · texto de un cuadro de texto (Promociones, Retos)', () => {
  it.each([['12.5', 12.5], ['12,5', 12.5], ['.5', 0.5], ['15', 15], [' 7 ', 7]])('«%s» → %s', (t, n) => {
    expect(numeroDe(t)).toBe(n)
  })
  it.each(['0-450', '5-', '1e3', '1.2.3', '--', 'abc', '12abc'])('«%s» → NaN (antes se borraban letras y signos y quedaba otro número)', t => {
    expect(Number.isNaN(numeroDe(t))).toBe(true)
  })
  it('vacío → null', () => {
    expect(numeroDe('')).toBeNull()
    expect(numeroDe(undefined)).toBeNull()
  })
})

describe('errorDeNumeros · aviso que nombra el cuadro', () => {
  it('ilegible → «no es un número», con el nombre', () => {
    expect(errorDeNumeros([{ nombre: 'Orden', valor: Number.NaN, entero: true, vacioVale: true }]))
      .toBe('«Orden»: lo escrito no es un número. Va un número entero de 0 en adelante, o borralo.')
  })
  it('vacío: vale donde ya valía; si no, «falta el número»', () => {
    expect(errorDeNumeros([{ nombre: 'Orden', valor: '', vacioVale: true }])).toBeNull()
    expect(errorDeNumeros([{ nombre: 'El premio vale (días)', valor: '', entero: true, min: 7, max: 90 }]))
      .toBe('«El premio vale (días)»: falta el número. Va un número entero de 7 a 90.')
  })
  it('negativo, decimal en entero, fuera de rango, tope («1e3» como 1000) → aviso', () => {
    expect(errorDeNumeros([{ nombre: 'Monto ₡', valor: -5 }])).toContain('«Monto ₡»: va un número de 0 en adelante')
    expect(errorDeNumeros([{ nombre: 'Puntos +', valor: 2.5, entero: true }])).toContain('«Puntos +»: va un número entero')
    expect(errorDeNumeros([{ nombre: 'Merma %', valor: 1000, max: 50 }])).toBe('«Merma %»: va un número de 0 a 50.')
    expect(errorDeNumeros([{ nombre: 'Cantidad', valor: 0, mayorQue: 0 }])).toBe('«Cantidad»: va un número mayor que 0.')
  })
  it('devuelve el PRIMER cuadro malo; todos bien → null', () => {
    const c = [{ nombre: 'A', valor: 3 }, { nombre: 'B', valor: Number.NaN }, { nombre: 'C', valor: -1 }]
    expect(errorDeNumeros(c)).toMatch(/^«B»/)
    expect(errorDeNumeros([{ nombre: 'A', valor: 3 }, { nombre: 'B', valor: '4.5' }])).toBeNull()
  })
  it('reglaDe describe la regla con ejemplo', () => {
    expect(reglaDe({ nombre: 'x', valor: 1, entero: true, min: 1, max: 20 })).toBe('un número entero de 1 a 20')
    expect(reglaDe({ nombre: 'x', valor: 1, ejemplo: '15 o 12.5', max: 100 })).toBe('un número de 0 a 100 (por ejemplo 15 o 12.5)')
  })
})
