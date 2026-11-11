// Rediseño B4: qué pendientes salen en «Para hacer hoy» según los datos y el rol.
import { describe, it, expect } from 'vitest'
import { calcularPendientes, fraseEstado, HORAS_TURNO_LARGO, type SenalesInicio } from './pendientes'
import { modulosPara } from './modulos'

const TRANQUILO: SenalesInicio = {
  cashOpen: false, cashOpenHours: 0, tipOpen: false, tipOpenHours: 0, pendingCount: 0,
  invOutStock: 0, invLowStock: 0, sopsCount: 12, esLunes: false,
  diasSinCierre: 0, turnosViejos: 0,
}
const visibles = (role: string) => new Set(modulosPara(role).map(m => m.id))
const ids = (s: Partial<SenalesInicio>, role = 'owner') =>
  calcularPendientes({ ...TRANQUILO, ...s }, visibles(role)).map(p => p.id)

describe('B4 · Para hacer hoy', () => {
  it('sin señales no hay pendientes y la frase es «Todo en orden.»', () => {
    const p = calcularPendientes(TRANQUILO, visibles('owner'))
    expect(p).toEqual([])
    expect(fraseEstado(p)).toBe('Todo en orden.')
  })

  it('días sin cierre y turnos viejos salen como malos, con su cantidad', () => {
    const p = calcularPendientes({ ...TRANQUILO, diasSinCierre: 2, turnosViejos: 1 }, visibles('manager'))
    expect(p.map(x => [x.id, x.tono, x.estado])).toEqual([
      ['dias-sin-cierre', 'malo', '2 días sin cierre'],
      ['turnos-viejos', 'malo', '1 turno abierto'],
    ])
    expect(fraseEstado(p)).toBe('Hay 2 cosas para resolver hoy.')
  })

  it('la caja abierta hace mucho sale desde el umbral, y no se duplica con un turno viejo', () => {
    expect(ids({ cashOpen: true, cashOpenHours: HORAS_TURNO_LARGO - 1 })).toEqual([])
    expect(ids({ cashOpen: true, cashOpenHours: HORAS_TURNO_LARGO })).toEqual(['caja-larga'])
    expect(ids({ cashOpen: true, cashOpenHours: 30, turnosViejos: 1 })).toEqual(['turnos-viejos'])
  })

  it('propinas abiertas hace mucho', () => {
    expect(ids({ tipOpen: true, tipOpenHours: 5 })).toEqual([])
    expect(ids({ tipOpen: true, tipOpenHours: 22 })).toEqual(['propinas-larga'])
  })

  it('movimientos por revisar, stock, lunes y procedimientos vacíos salen como pendientes', () => {
    const p = calcularPendientes(
      { ...TRANQUILO, pendingCount: 3, invLowStock: 4, esLunes: true, sopsCount: 0 }, visibles('owner'))
    expect(p.map(x => [x.id, x.estado])).toEqual([
      ['movimientos', '3 por revisar'],
      ['stock-bajo', '4 stock bajo'],
      ['semana', 'Lunes'],
      ['sops-vacios', 'sin contenido'],
    ])
    expect(p.every(x => x.tono === 'pendiente')).toBe(true)
    expect(fraseEstado(p)).toBe('Quedan 4 pendientes para hoy.')
  })

  it('lo malo va primero', () => {
    expect(ids({ pendingCount: 1, invOutStock: 2 })).toEqual(['sin-stock', 'movimientos'])
  })

  it('las señales sin cargar (null) no generan pendientes', () => {
    expect(ids({ diasSinCierre: null, turnosViejos: null })).toEqual([])
  })

  it('solo salen pendientes de módulos que el rol ve en su grilla', () => {
    const todo: Partial<SenalesInicio> = {
      pendingCount: 1, invOutStock: 1, esLunes: true, sopsCount: 0, tipOpen: true, tipOpenHours: 24,
    }
    // El contador no ve SOPs; el cajero no ve Inventario ni Semana.
    expect(ids(todo, 'contador')).toEqual(['propinas-larga', 'sin-stock', 'movimientos', 'semana'])
    expect(ids(todo, 'cajero')).toEqual(['propinas-larga', 'movimientos', 'sops-vacios'])
    expect(ids(todo, 'runner')).toEqual(['sops-vacios'])
  })

  it('un solo pendiente usa la frase en singular', () => {
    expect(fraseEstado(calcularPendientes({ ...TRANQUILO, pendingCount: 1 }, visibles('owner'))))
      .toBe('Queda un pendiente para hoy.')
    expect(fraseEstado(calcularPendientes({ ...TRANQUILO, invOutStock: 1 }, visibles('owner'))))
      .toBe('Hay una cosa para resolver hoy.')
  })
})

describe('B5 · lecturas que fallaron: «sin comprobar», nunca «Todo en orden»', () => {
  it('una señal que falló agrega «sin comprobar» primero (lleva a Caja) y cambia la frase', () => {
    const p = calcularPendientes({ ...TRANQUILO, sinComprobar: ['movimientos'] }, visibles('owner'))
    expect(p.map(x => [x.id, x.path, x.tono, x.estado])).toEqual([
      ['sin-comprobar', '/caja', 'pendiente', 'sin comprobar'],
    ])
    expect(fraseEstado(p)).toBe('No se pudo comprobar todo — revisá Caja.')
  })

  it('la señal que falló no inventa su pendiente (procedimientos en 0 por la falla)', () => {
    expect(ids({ sopsCount: 0, sinComprobar: ['procedimientos'] })).toEqual(['sin-comprobar'])
  })

  it('las demás señales se siguen mostrando, después del aviso', () => {
    expect(ids({ pendingCount: 2, invOutStock: 1, sinComprobar: ['cierres'] }))
      .toEqual(['sin-comprobar', 'sin-stock', 'movimientos'])
  })

  it('una falla en un número del día también impide «Todo en orden»', () => {
    const p = calcularPendientes({ ...TRANQUILO, sinComprobar: ['venta'] }, visibles('contador'))
    expect(fraseEstado(p)).toBe('No se pudo comprobar todo — revisá Caja.')
  })

  it('la falla de un módulo que el rol no ve no cuenta', () => {
    // contador no ve Procedimientos
    expect(ids({ sinComprobar: ['procedimientos'] }, 'contador')).toEqual([])
  })
})
