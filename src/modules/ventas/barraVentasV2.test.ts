// Ventas v2 · la barra global: estado en la URL, flechas, bases que nunca quedan iguales.
import { describe, it, expect } from 'vitest'
import { elegirBase, escribirBarra, leerBarra, moverPeriodo, periodoDeBarra, periodoEnPalabras } from './barraVentasV2'

const ANCLA = '2026-11-16' // lunes: N = domingo 15

describe('barra de Ventas v2', () => {
  it('sin nada en la URL: «Ayer» contra período anterior + año anterior mismo día de semana (D3=A)', () => {
    const e = leerBarra(new URLSearchParams('tab=resumen'))
    expect(e).toMatchObject({ tipo: 'ayer', baseA: 'anteriorEquivalente', baseB: 'anioMismoDiaSemana', local: null })
    expect(periodoDeBarra(e, ANCLA).periodo.desde).toBe('2026-11-15')
  })

  it('ida y vuelta por la URL sin tocar `tab`', () => {
    const e = { local: 'santa-teresa', tipo: 'mesALaFecha' as const, baseA: 'anioMismasFechas' as const, baseB: 'anteriorEquivalente' as const }
    const sp = escribirBarra(new URLSearchParams('tab=resumen&x=1'), e)
    expect(sp.get('tab')).toBe('resumen')
    expect(sp.get('x')).toBe('1')
    expect(leerBarra(sp)).toMatchObject(e)
  })

  it('valores raros en la URL caen al defecto; bases iguales vuelven a las de D3', () => {
    expect(leerBarra(new URLSearchParams('p=nada&a=zzz')).tipo).toBe('ayer')
    expect(leerBarra(new URLSearchParams('a=anioMismasFechas&b=anioMismasFechas')))
      .toMatchObject({ baseA: 'anteriorEquivalente', baseB: 'anioMismoDiaSemana' })
  })

  it('caso de la auditoría: 16-nov, mes a la fecha = 1–15 nov contra 1–15 oct y 2–16 nov 2025', () => {
    const { periodo } = periodoDeBarra(leerBarra(new URLSearchParams('p=mesALaFecha')), ANCLA)
    expect(periodoEnPalabras(periodo, 'anteriorEquivalente', 'anioMismoDiaSemana')).toBe(
      '1 al 15 de noviembre (15 días) contra el mes anterior a la misma fecha (1–15 oct) y contra el año pasado, mismo día de semana (2–16 nov 2025). Hoy, en curso, no entra.')
  })

  it('flechas: ‹ va al mes anterior entero; › desde el mes en curso no tiene a dónde ir', () => {
    const e = leerBarra(new URLSearchParams('p=mesALaFecha'))
    const { periodo } = periodoDeBarra(e, ANCLA)
    const ant = moverPeriodo(e, periodo, -1)!
    expect(periodoDeBarra(ant, ANCLA).periodo).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-31', enCurso: false })
    expect(moverPeriodo(e, periodo, 1)).toBeNull()
  })

  it('elegir en A la base que ya está en B las intercambia', () => {
    const e = leerBarra(new URLSearchParams(''))
    expect(elegirBase(e, 'A', 'anioMismoDiaSemana')).toMatchObject({ baseA: 'anioMismoDiaSemana', baseB: 'anteriorEquivalente' })
    expect(elegirBase(e, 'B', 'anioMismasFechas')).toMatchObject({ baseA: 'anteriorEquivalente', baseB: 'anioMismasFechas' })
  })

  it('rango incompleto o después de ayer: cae a «Ayer» con el motivo (no rompe la pantalla)', () => {
    expect(periodoDeBarra(leerBarra(new URLSearchParams('p=rango&desde=2026-11-01')), ANCLA))
      .toMatchObject({ aviso: 'Elegí las dos fechas del rango', periodo: { tipo: 'ayer' } })
    expect(periodoDeBarra(leerBarra(new URLSearchParams('p=rango&desde=2026-11-16&hasta=2026-11-20')), ANCLA).aviso)
      .toMatch(/después del último día cerrado/)
  })
})
