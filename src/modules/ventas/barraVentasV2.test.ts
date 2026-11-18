// Ventas v2 · la barra global: estado en la URL, flechas, un solo «Comparar con» y los períodos que ofrece cada
// pestaña (barra simple, pedido del dueño del 18-nov).
import { describe, it, expect } from 'vitest'
import {
  basesDe, cambiarTipo, escribirBarra, leerBarra, moverPeriodo, PERIODOS_SIMPLES, periodoDeBarra, periodoEnPalabras,
  rotuloComparar, type EstadoBarra,
} from './barraVentasV2'

const ANCLA = '2026-11-16' // lunes: N = domingo 15

describe('barra de Ventas v2', () => {
  it('sin nada en la URL: «Ayer» contra los dos (período anterior y año pasado, mismo día de semana)', () => {
    const e = leerBarra(new URLSearchParams('tab=resumen'))
    expect(e).toMatchObject({ tipo: 'ayer', comparar: 'ambos', local: null })
    expect(basesDe(e.comparar)).toEqual(['anteriorEquivalente', 'anioMismoDiaSemana'])
    expect(periodoDeBarra(e, ANCLA).periodo.desde).toBe('2026-11-15')
  })

  it('ida y vuelta por la URL sin tocar `tab`; los `a`/`b` viejos se borran', () => {
    const e: EstadoBarra = { local: 'santa-teresa', tipo: 'mesALaFecha', comparar: 'anio' }
    const sp = escribirBarra(new URLSearchParams('tab=resumen&x=1&a=anioMismasFechas&b=anteriorEquivalente'), e)
    expect(sp.get('tab')).toBe('resumen')
    expect(sp.get('x')).toBe('1')
    expect(sp.get('c')).toBe('anio')
    expect(sp.has('a') || sp.has('b')).toBe(false)
    expect(leerBarra(sp)).toMatchObject(e)
    // «Los dos» es el defecto: no ensucia la URL.
    expect(escribirBarra(new URLSearchParams(''), { ...e, comparar: 'ambos' }).has('c')).toBe(false)
  })

  it('«Comparar con»: una base, la otra o las dos, en orden', () => {
    expect(basesDe('anterior')).toEqual(['anteriorEquivalente'])
    expect(basesDe('anio')).toEqual(['anioMismoDiaSemana'])
    expect(basesDe('ambos')).toEqual(['anteriorEquivalente', 'anioMismoDiaSemana'])
    const { periodo } = periodoDeBarra({ tipo: 'mesALaFecha' }, ANCLA)
    expect(rotuloComparar(periodo, 'anterior')).toBe('Mes anterior a la misma fecha')
    expect(rotuloComparar(periodo, 'anio')).toBe('Año pasado, mismo día de semana')
    expect(rotuloComparar(periodo, 'ambos')).toBe('Los dos')
  })

  it('valores raros caen al defecto; un período que la pestaña no ofrece (link viejo) también', () => {
    expect(leerBarra(new URLSearchParams('p=nada&c=zzz'))).toMatchObject({ tipo: 'ayer', comparar: 'ambos' })
    expect(leerBarra(new URLSearchParams('p=temporada')).tipo).toBe('ayer')
    expect(leerBarra(new URLSearchParams('p=hoy')).tipo).toBe('ayer')
    expect(leerBarra(new URLSearchParams('p=ayer'), 'mesALaFecha', PERIODOS_SIMPLES).tipo).toBe('mesALaFecha')
    // «Mes a la fecha» (links viejos) cuenta como «Mes».
    expect(leerBarra(new URLSearchParams('p=mesALaFecha'), 'semana', PERIODOS_SIMPLES).tipo).toBe('mesALaFecha')
  })

  it('caso de la auditoría: 16-nov, mes a la fecha = 1–15 nov contra 1–15 oct y 2–16 nov 2025; con una sola base, una sola', () => {
    const { periodo } = periodoDeBarra(leerBarra(new URLSearchParams('p=mesALaFecha')), ANCLA)
    expect(periodoEnPalabras(periodo, basesDe('ambos'))).toBe(
      '1 al 15 de noviembre (15 días) contra el mes anterior a la misma fecha (1–15 oct) y contra el año pasado, mismo día de semana (2–16 nov 2025). Hoy, en curso, no entra.')
    expect(periodoEnPalabras(periodo, basesDe('anterior'))).toBe(
      '1 al 15 de noviembre (15 días) contra el mes anterior a la misma fecha (1–15 oct). Hoy, en curso, no entra.')
  })

  it('flechas: ‹ va al mes anterior entero; › desde el mes en curso no tiene a dónde ir', () => {
    const e = leerBarra(new URLSearchParams('p=mesALaFecha'))
    const { periodo } = periodoDeBarra(e, ANCLA)
    const ant = moverPeriodo(e, periodo, -1)!
    expect(periodoDeBarra(ant, ANCLA).periodo).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-31', enCurso: false })
    expect(moverPeriodo(e, periodo, 1)).toBeNull()
  })

  it('flecha › desde «Ayer» = ayer: «Hoy» no se ofrece, así que no hay a dónde ir', () => {
    const e = leerBarra(new URLSearchParams('p=ayer'))
    const { periodo } = periodoDeBarra(e, ANCLA)
    expect(moverPeriodo(e, periodo, 1)).toBeNull()
    expect(moverPeriodo(e, periodo, -1)).toMatchObject({ tipo: 'ayer', dia: '2026-11-14' })
  })

  it('cambiar de tipo: el nuevo período contiene el último día del que se miraba', () => {
    const e = leerBarra(new URLSearchParams('p=semana&d=2026-10-05'))
    const { periodo } = periodoDeBarra(e, ANCLA)
    const mes = cambiarTipo(e, periodo, 'mes')
    expect(periodoDeBarra(mes, ANCLA).periodo).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-31' })
    const ayer = leerBarra(new URLSearchParams('p=ayer'))
    const mesEnCurso = cambiarTipo(ayer, periodoDeBarra(ayer, ANCLA).periodo, 'mes')
    expect(periodoDeBarra(mesEnCurso, ANCLA).periodo).toMatchObject({ desde: '2026-11-01', hasta: '2026-11-15', enCurso: true })
    expect(cambiarTipo(e, periodo, 'rango')).toMatchObject({ tipo: 'rango', desde: '2026-10-05', hasta: '2026-10-11' })
  })

  it('rango incompleto o después de ayer: cae a «Ayer» con el motivo (no rompe la pantalla)', () => {
    expect(periodoDeBarra(leerBarra(new URLSearchParams('p=rango&desde=2026-11-01')), ANCLA))
      .toMatchObject({ aviso: 'Elegí las dos fechas del rango', periodo: { tipo: 'ayer' } })
    expect(periodoDeBarra(leerBarra(new URLSearchParams('p=rango&desde=2026-11-16&hasta=2026-11-20')), ANCLA).aviso)
      .toMatch(/después del último día cerrado/)
  })
})
