import { describe, expect, it } from 'vitest'
import { desvioRelativo, mesDe, pesosPorDiaSemana, proyectarMes, rangoDeLecturaProyeccion } from './proyeccion'
import { diaSemana, sumarDias } from './periodos'

// Datos ficticios. Noviembre 2026: el 1 es domingo. Patrón fijo: viernes y sábado 300, el resto 100.
const MES = { desde: '2026-11-01', hasta: '2026-11-30' }
const patron = (d: string) => (diaSemana(d) === 4 || diaSemana(d) === 5 ? 300 : 100)
function serie(desde: string, hasta: string, f: (d: string) => number = patron): Map<string, number> {
  const m = new Map<string, number>()
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) m.set(d, f(d))
  return m
}
const sumaPatron = (desde: string, hasta: string) => [...serie(desde, hasta).values()].reduce((a, b) => a + b, 0)

describe('proyeccion · ponderada por día de semana (§4.3)', () => {
  it('con un patrón fijo, la proyección es EXACTAMENTE lo que el patrón da en el mes (no la lineal)', () => {
    // N = 10-nov: en 1–10 hay 2 días pesados de 10; en 11–30, 6 de 20. La lineal se queda corta.
    const r = proyectarMes({ meta: 1, mes: MES, N: '2026-11-10', netaPorDia: serie('2026-09-01', '2026-11-10') })
    const exacta = sumaPatron('2026-11-01', '2026-11-30')
    const lineal = (sumaPatron('2026-11-01', '2026-11-10') / 10) * 30
    expect(r.ponderada).toBe(true)
    expect(r.proyeccion).toBeCloseTo(exacta, 6)
    expect(lineal).not.toBeCloseTo(exacta, 0)
    expect(r.rango).toBeCloseTo(0, 6) // las 8 semanas son iguales: sin desvío
  })

  it('meta = lo que da el patrón → ritmo 1 y proyección = meta; necesario por día = lo que falta ÷ días', () => {
    const meta = sumaPatron('2026-11-01', '2026-11-30')
    const r = proyectarMes({ meta, mes: MES, N: '2026-11-10', netaPorDia: serie('2026-09-01', '2026-11-10') })
    expect(r.estado).toBe('enCurso')
    expect(r.ritmo).toBeCloseTo(1, 9)
    expect(r.proyeccion).toBeCloseTo(meta, 6)
    expect(r.vendido).toBe(sumaPatron('2026-11-01', '2026-11-10'))
    expect(r.diasCerrados).toBe(10)
    expect(r.diasQueFaltan).toBe(20)
    expect(r.necesarioPorDia).toBeCloseTo((meta - r.vendido) / 20, 9)
    expect(r.avancePct).toBeCloseTo((r.vendido / meta) * 100, 9)
    // El ritmo NO es el lineal: la meta a la fecha va por peso (2 días pesados de 10 < 1/3 del mes).
    expect(r.metaALaFecha!).toBeLessThan((meta * 10) / 30)
  })

  it('nunca usa el día en curso: lo que haya en «hoy» (N + 1) no mueve nada', () => {
    const base = serie('2026-09-01', '2026-11-10')
    const conHoy = new Map(base).set('2026-11-11', 9_999_999)
    const a = proyectarMes({ meta: 5000, mes: MES, N: '2026-11-10', netaPorDia: base })
    const b = proyectarMes({ meta: 5000, mes: MES, N: '2026-11-10', netaPorDia: conHoy })
    expect(b).toEqual(a)
  })

  it('sin una semana completa de historia (desde el primer día con datos) cae a la lineal = la cuenta de Análisis', () => {
    const m = serie('2026-11-01', '2026-11-10')
    const r = proyectarMes({ meta: 9000, mes: MES, N: '2026-11-10', netaPorDia: m, primerDiaConDatos: '2026-11-05' })
    expect(r.ponderada).toBe(false)
    expect(r.proyeccion).toBeCloseTo((r.vendido / 10) * 30, 9)
    expect(r.metaALaFecha).toBeCloseTo((9000 * 10) / 30, 9) // = metaALaFecha de aLaFecha.ts
  })

  it('mes cerrado (hoy = 1.º del mes siguiente): proyección = lo vendido, ±0, sin necesario por día', () => {
    const r = proyectarMes({ meta: 1000, mes: MES, N: '2026-11-30', netaPorDia: serie('2026-09-01', '2026-11-30') })
    expect(r.estado).toBe('mesCerrado')
    expect(r.proyeccion).toBe(r.vendido)
    expect(r.rango).toBe(0)
    expect(r.necesarioPorDia).toBeNull()
    expect(r.parteDelMes).toBe(1)
  })

  it('el mes todavía sin días cerrados y sin meta', () => {
    const r = proyectarMes({ meta: 1000, mes: MES, N: '2026-10-31', netaPorDia: serie('2026-09-01', '2026-10-31') })
    expect(r.estado).toBe('sinDiasCerrados')
    expect(r.cerrados).toBeNull()
    expect(r.vendido).toBe(0)
    expect(r.ritmo).toBeNull()
    const s = proyectarMes({ meta: 0, mes: MES, N: '2026-11-10', netaPorDia: serie('2026-09-01', '2026-11-10') })
    expect(s.estado).toBe('sinMeta')
    expect(s.avancePct).toBeNull()
    expect(s.ritmo).toBeNull()
  })

  it('ya pasada la meta: necesario por día = 0 (nunca negativo)', () => {
    const r = proyectarMes({ meta: 100, mes: MES, N: '2026-11-10', netaPorDia: serie('2026-09-01', '2026-11-10') })
    expect(r.necesarioPorDia).toBe(0)
  })

  it('con semanas distintas, el rango es lo que falta proyectar × el desvío relativo', () => {
    // Semanas alternas: ×1 y ×2 (por semana ISO, contando hacia atrás desde N).
    const N = '2026-11-10'
    const f = (d: string) => {
      const semanasAtras = Math.floor((Date.parse(N) - Date.parse(d)) / (7 * 86_400_000))
      return patron(d) * (semanasAtras % 2 === 0 ? 1 : 2)
    }
    const m = serie('2026-09-01', N, f)
    const r = proyectarMes({ meta: 1, mes: MES, N, netaPorDia: m })
    const { semanales } = pesosPorDiaSemana(m, N)
    expect(semanales).toHaveLength(8)
    expect(r.rango).toBeGreaterThan(0)
    expect(r.rango).toBeCloseTo((r.proyeccion - r.vendido) * desvioRelativo(semanales), 6)
  })
})

describe('proyeccion · piezas', () => {
  it('pesos: promedio de cada día de semana en las 8 semanas que terminan en N (un día ausente = 0)', () => {
    const m = serie('2026-09-01', '2026-11-10')
    m.delete('2026-11-09') // un lunes sin ventas (cerrado)
    const { pesos } = pesosPorDiaSemana(m, '2026-11-10')
    expect(pesos[0]).toBeCloseTo((100 * 7) / 8, 9)
    expect(pesos[4]).toBe(300)
    expect(pesos[1]).toBe(100)
  })

  it('desvío relativo: 0 con semanas iguales o con menos de 2; conocido con [100, 300]', () => {
    expect(desvioRelativo([500, 500, 500])).toBe(0)
    expect(desvioRelativo([500])).toBe(0)
    expect(desvioRelativo([100, 300])).toBeCloseTo(Math.SQRT2 / 2, 9)
  })

  it('rango de lectura: desde lo más viejo entre el 1.º del mes y N − 55, hasta N', () => {
    expect(rangoDeLecturaProyeccion(MES, '2026-11-17')).toEqual({ desde: '2026-09-23', hasta: '2026-11-17' })
    expect(rangoDeLecturaProyeccion(MES, '2026-11-30')).toEqual({ desde: '2026-10-06', hasta: '2026-11-30' })
  })
})

describe('proyeccion · mesDe', () => {
  it('largo de cada mes, con bisiesto y diciembre', () => {
    expect(mesDe('2026-11-17')).toEqual({ desde: '2026-11-01', hasta: '2026-11-30' })
    expect(mesDe('2028-02-10')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
    expect(mesDe('2026-12-31')).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' })
  })
})
