// «A la fecha» (Ventas v2, fase 1.3): nunca un período en curso contra uno completo.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  alineadoAlCorte, alinearPeriodosMix, alinearPromPax, corteDe, diasCerradosDelAnio, mismaFechaEnAnio, metaALaFecha,
  rangoAnioNatural, rangoMesNatural, rangoQuincenaNatural, rangoTrimestreNatural, totalesEnRango, variacion,
} from './aLaFecha'
import { calcularPeriodo } from './periodos'
import { periodoMes, periodoRango, periodoSemana } from './periodosPromPax'
import type { ContabilidadDay } from '../../shared/types/ventas'

afterEach(() => vi.useRealTimers())

const dia = (fecha: string, ventaNeta: number, salon = ventaNeta, pax = 10): ContabilidadDay =>
  ({ fecha, ventaNeta, ventaBruta: ventaNeta, iva: 0, serv: 0, salon, delivery: ventaNeta - salon, pax, promPax: 0 })

describe('corte (hora CR, D2=A hasta ayer)', () => {
  it('reloj de noche en CR: 16-nov 23:30 CR = 17-nov 05:30 UTC → hoy 16, N = 15', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T05:30:00Z'))
    const c = corteDe()
    expect(c.ancla).toBe('2026-11-16')
    expect(c.N).toBe('2026-11-15')
    expect([c.anio, c.mes, c.dia]).toEqual([2026, 11, 15])
  })
  it('1-ene: N es el 31-dic del año anterior (ese año ya está cerrado)', () => {
    const c = corteDe('2027-01-01')
    expect(c.N).toBe('2026-12-31')
    expect(alineadoAlCorte(rangoAnioNatural(2026), false, c)).toEqual(rangoAnioNatural(2026))
    expect(alineadoAlCorte(rangoAnioNatural(2027), false, c)).toBeNull()
  })
})

describe('alineadoAlCorte: mismas fechas en otro año', () => {
  const c = corteDe('2026-11-17')   // N = 16-nov
  it('mes en curso: este año 1–16; año anterior 1–16 (no el mes completo)', () => {
    expect(alineadoAlCorte(rangoMesNatural(2026, 11), true, c)).toEqual({ desde: '2026-11-01', hasta: '2026-11-16' })
    expect(alineadoAlCorte(rangoMesNatural(2025, 11), true, c)).toEqual({ desde: '2025-11-01', hasta: '2025-11-16' })
    expect(alineadoAlCorte(rangoMesNatural(2024, 11), true, c)).toEqual({ desde: '2024-11-01', hasta: '2024-11-16' })
  })
  it('coincide con la base «año anterior, mismas fechas» del motor', () => {
    const p = calcularPeriodo({ tipo: 'mesALaFecha', ancla: c.ancla })
    expect(alineadoAlCorte(rangoMesNatural(2025, 11), true, c)).toEqual({ desde: p.bases.anioMismasFechas!.desde, hasta: p.bases.anioMismasFechas!.hasta })
    const a = calcularPeriodo({ tipo: 'anioALaFecha', ancla: c.ancla })
    expect(alineadoAlCorte(rangoAnioNatural(2025), true, c)).toEqual({ desde: a.bases.anioMismasFechas!.desde, hasta: a.bases.anioMismasFechas!.hasta })
  })
  it('mes cerrado: entero; mes futuro: nada', () => {
    expect(alineadoAlCorte(rangoMesNatural(2026, 10), false, c)).toEqual(rangoMesNatural(2026, 10))
    expect(alineadoAlCorte(rangoMesNatural(2026, 12), false, c)).toBeNull()
  })
  it('trimestre y quincena en curso', () => {
    expect(alineadoAlCorte(rangoTrimestreNatural(2025, 4), true, c)).toEqual({ desde: '2025-10-01', hasta: '2025-11-16' })
    expect(alineadoAlCorte(rangoQuincenaNatural(2025, 11, 2), true, c)).toEqual({ desde: '2025-11-16', hasta: '2025-11-16' })
  })
  it('meses de 30, 31 y 28 días', () => {
    const c31 = corteDe('2027-01-01')            // N = 31-dic
    expect(alineadoAlCorte(rangoMesNatural(2026, 12), false, c31)).toEqual(rangoMesNatural(2026, 12))
    const c30 = corteDe('2026-10-01')            // N = 30-sep (mes de 30 cerrado)
    expect(alineadoAlCorte(rangoMesNatural(2026, 9), false, c30)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
    const cFeb = corteDe('2028-02-29')           // N = 28-feb-2028 (bisiesto, en curso)
    expect(alineadoAlCorte(rangoMesNatural(2027, 2), true, cFeb)).toEqual({ desde: '2027-02-01', hasta: '2027-02-28' })
    const c29 = corteDe('2028-03-01')            // N = 29-feb-2028
    expect(mismaFechaEnAnio(c29.N, 2027)).toBe('2027-02-28')
    expect(alineadoAlCorte(rangoAnioNatural(2027), true, c29)).toEqual({ desde: '2027-01-01', hasta: '2027-02-28' })
  })
})

describe('totales y variación', () => {
  const dias = [dia('2025-11-01', 100), dia('2025-11-20', 900), dia('2026-11-01', 120), dia('2026-11-17', 50)]
  const c = corteDe('2026-11-17')
  it('el mes en curso contra los mismos días: +20 %, no −87 %', () => {
    const vivo = totalesEnRango(dias, alineadoAlCorte(rangoMesNatural(2026, 11), true, c))
    const base = totalesEnRango(dias, alineadoAlCorte(rangoMesNatural(2025, 11), true, c))
    expect(vivo.ventaNeta).toBe(120)        // hoy (17) no entra
    expect(base.ventaNeta).toBe(100)        // el 20-nov-2025 no entra
    expect(variacion(vivo, base)).toBeCloseTo(20)
  })
  it('sin datos: «—» (null), nunca −100 %', () => {
    expect(variacion(totalesEnRango(dias, null), totalesEnRango(dias, rangoMesNatural(2025, 11)))).toBeNull()
  })
  it('venta por persona = salón ÷ personas (D4), no la neta total', () => {
    const t = totalesEnRango([dia('2026-01-02', 1000, 800, 10)], rangoMesNatural(2026, 1))
    expect(t.ventaPorPersona).toBe(80)
    expect(totalesEnRango([dia('2026-01-02', 1000, 800, 0)], rangoMesNatural(2026, 1)).ventaPorPersona).toBeNull()
  })
})

describe('Mix → Comparar', () => {
  const c = corteDe('2026-11-17')
  it('noviembre en curso contra octubre y febrero: mismos días y rótulo en palabras', () => {
    const { periodos, aviso } = alinearPeriodosMix(['2026-11', '2026-10', '2026-02'], c)
    expect(periodos[0]).toMatchObject({ enCurso: true, rango: { desde: '2026-11-01', hasta: '2026-11-16' }, rotulo: '1 al 16 de noviembre (16 días)' })
    expect(periodos[1]).toMatchObject({ recortado: true, rango: { desde: '2026-10-01', hasta: '2026-10-16' }, notaLargo: null })
    expect(periodos[2].rango).toEqual({ desde: '2026-02-01', hasta: '2026-02-16' })
    expect(aviso).toContain('noviembre 2026 va a la fecha')
  })
  it('k = 30 contra febrero (28): febrero entero y la nota del largo', () => {
    const { periodos } = alinearPeriodosMix(['2026-11', '2026-02'], corteDe('2026-12-01'))
    expect(periodos[0].enCurso).toBe(false)     // noviembre ya cerró: nadie se corta
    const r = alinearPeriodosMix(['2026-12', '2026-02'], corteDe('2026-12-31'))
    expect(r.periodos[1]).toMatchObject({ rango: { desde: '2026-02-01', hasta: '2026-02-28' }, notaLargo: '28 días contra 30' })
  })
  it('sin período en curso: meses enteros y sin aviso', () => {
    const { periodos, aviso } = alinearPeriodosMix(['2026-09', '2026-10'], c)
    expect(periodos.map(p => p.rango)).toEqual([rangoMesNatural(2026, 9), rangoMesNatural(2026, 10)])
    expect(aviso).toBeNull()
  })
  it('año en curso contra el anterior: 1-ene a la misma fecha', () => {
    const { periodos } = alinearPeriodosMix(['todo-2026', 'todo-2025'], c)
    expect(periodos[1].rango).toEqual({ desde: '2025-01-01', hasta: '2025-11-16' })
  })
  it('el día 1 el mes de hoy no tiene días cerrados', () => {
    const { periodos } = alinearPeriodosMix(['2026-11', '2026-10'], corteDe('2026-11-01'))
    expect(periodos[0].rango).toBeNull()
    expect(periodos[1].rango).toEqual(rangoMesNatural(2026, 10))
  })
})

describe('Prom/PAX explicado', () => {
  const c = corteDe('2026-11-17')
  it('mes en curso: 1–16 nov contra 1–16 oct (no contra octubre entero)', () => {
    const r = alinearPromPax(periodoMes(2026, 11), 'anterior', c)
    expect(r).toMatchObject({ enCurso: true, actual: { desde: '2026-11-01', hasta: '2026-11-16' }, comp: { desde: '2026-10-01', hasta: '2026-10-16' } })
    expect(alinearPromPax(periodoMes(2026, 11), 'anio-anterior', c)).toMatchObject({ comp: { desde: '2025-11-01', hasta: '2025-11-16' } })
  })
  it('semana en curso: lunes → ayer contra los mismos días de la semana anterior', () => {
    const r = alinearPromPax(periodoSemana('2026-11-17'), 'anterior', corteDe('2026-11-19'))   // N = mié 18
    expect(r).toMatchObject({ actual: { desde: '2026-11-16', hasta: '2026-11-18' }, comp: { desde: '2026-11-09', hasta: '2026-11-11' } })
  })
  it('rango que termina hoy: se corta en ayer y la base tiene el mismo largo', () => {
    const r = alinearPromPax(periodoRango('2026-11-10', '2026-11-17'), 'anterior', c)
    expect(r).toMatchObject({ actual: { hasta: '2026-11-16' }, comp: { desde: '2026-11-03', hasta: '2026-11-09' } })
  })
  it('mes cerrado: igual que antes', () => {
    expect(alinearPromPax(periodoMes(2026, 10), 'anterior', c)).toMatchObject({ enCurso: false, actual: { hasta: '2026-10-31' } })
  })
  it('período sin días cerrados: error claro', () => {
    expect(alinearPromPax(periodoMes(2026, 12), 'anterior', c)).toHaveProperty('error')
  })
})

describe('Proyección', () => {
  it('días cerrados del año y meta a la fecha', () => {
    expect(diasCerradosDelAnio(corteDe('2026-11-17'))).toBe(320)
    expect(metaALaFecha(3_000, 16, 30)).toBe(1_600)
  })
})
