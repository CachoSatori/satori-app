import { describe, expect, it } from 'vitest'
import { mesDe, pesosPorDiaSemana, proyectarMes, rangoDeLecturaProyeccion, ruidoDiario, semanasDeHistoria, ultimoDomingoCerrado } from './proyeccion'
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

  it('± NO mide la temporada: semanas que suben o bajan enteras (mismo patrón) dan ±0', () => {
    // Cada semana lunes–domingo 10 % más alta que la anterior: es tendencia, no ruido.
    const lunes0 = '2026-09-07'
    const f = (d: string) => patron(d) * 1.1 ** Math.floor((Date.parse(d) - Date.parse(lunes0)) / (7 * 86_400_000))
    const r = proyectarMes({ meta: 1, mes: MES, N: '2026-11-10', netaPorDia: serie('2026-09-01', '2026-11-10', f) })
    expect(r.ponderada).toBe(true)
    expect(r.sigma).toBeCloseTo(0, 9)
    expect(r.rango).toBeCloseTo(0, 6)
  })

  it('± con ruido diario: lo que falta × σ × √(1/m + 1/k), y σ = desvío de neta ÷ (peso × nivel de la semana)', () => {
    // Patrón fijo y un lunes de cada dos con +50 %: eso sí es ruido de un día.
    const N = '2026-11-10'
    let lunes = 0
    const f = (d: string) => (diaSemana(d) === 0 && lunes++ % 2 === 0 ? patron(d) * 1.5 : patron(d))
    const m = serie('2026-09-01', N, f)
    const r = proyectarMes({ meta: 1, mes: MES, N, netaPorDia: m })
    const semanas = semanasDeHistoria(N)
    const sigma = ruidoDiario(m, semanas, pesosPorDiaSemana(m, semanas))
    expect(sigma).toBeGreaterThan(0.05)
    expect(r.sigma).toBeCloseTo(sigma, 12)
    expect(r.rango).toBeCloseTo((r.proyeccion - r.vendido) * sigma * Math.sqrt(1 / 20 + 1 / 10), 6)
  })

  it('ritmo × meta = proyección (son la misma lectura: la pantalla no muestra las dos como %)', () => {
    const r = proyectarMes({ meta: 7777, mes: MES, N: '2026-11-10', netaPorDia: serie('2026-09-01', '2026-11-10') })
    expect(r.ritmo! * r.meta).toBeCloseTo(r.proyeccion, 6)
  })
})

describe('proyeccion · piezas', () => {
  it('historia = 8 semanas lunes–domingo que terminan el último domingo cerrado', () => {
    expect(ultimoDomingoCerrado('2026-11-10')).toBe('2026-11-08') // martes → domingo anterior
    expect(ultimoDomingoCerrado('2026-11-15')).toBe('2026-11-15') // domingo → él mismo
    expect(ultimoDomingoCerrado('2026-11-16')).toBe('2026-11-15') // lunes → la víspera
    const w = semanasDeHistoria('2026-11-10')
    expect(w).toHaveLength(8)
    expect(w[0]).toEqual({ desde: '2026-09-14', hasta: '2026-09-20' })
    expect(w[7]).toEqual({ desde: '2026-11-02', hasta: '2026-11-08' })
    for (const s of w) expect(diaSemana(s.desde)).toBe(0)
    // Desde el primer día con datos: solo las semanas completas.
    expect(semanasDeHistoria('2026-11-10', '2026-10-27')).toHaveLength(1)
  })

  it('pesos: promedio de cada día de semana en las 8 semanas (un día ausente = 0); lo de esta semana no entra', () => {
    const m = serie('2026-09-01', '2026-11-10')
    m.delete('2026-11-02') // un lunes sin ventas (cerrado)
    m.set('2026-11-09', 9_999_999) // lunes de la semana en curso: fuera de la historia
    const pesos = pesosPorDiaSemana(m, semanasDeHistoria('2026-11-10'))
    expect(pesos[0]).toBeCloseTo((100 * 7) / 8, 9)
    expect(pesos[4]).toBe(300)
    expect(pesos[1]).toBe(100)
  })

  it('sin 8 semanas completas (lo dice la guía) cae a la lineal y sin ±', () => {
    const r = proyectarMes({ meta: 9000, mes: MES, N: '2026-11-10', netaPorDia: serie('2026-09-01', '2026-11-10'),
      primerDiaConDatos: '2026-09-15' }) // la semana del 14-sep queda incompleta: 7 semanas
    expect(r.ponderada).toBe(false)
    expect(r.rango).toBe(0)
    expect(r.proyeccion).toBeCloseTo((r.vendido / 10) * 30, 9)
  })

  it('rango de lectura: desde el lunes de la 8.ª semana (o el 1.º del mes), hasta N', () => {
    expect(rangoDeLecturaProyeccion(MES, '2026-11-17')).toEqual({ desde: '2026-09-21', hasta: '2026-11-17' })
    expect(rangoDeLecturaProyeccion(MES, '2026-11-30')).toEqual({ desde: '2026-10-05', hasta: '2026-11-30' })
  })
})

describe('proyeccion · mesDe', () => {
  it('largo de cada mes, con bisiesto y diciembre', () => {
    expect(mesDe('2026-11-17')).toEqual({ desde: '2026-11-01', hasta: '2026-11-30' })
    expect(mesDe('2028-02-10')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
    expect(mesDe('2026-12-31')).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' })
  })
})
