// Ventas v2 · rótulos de las bases (pedido del dueño, 18-nov 12:04): «período anterior» no dice nada;
// cada base se nombra por lo que ES para el período elegido, con sus fechas cortas entre paréntesis.
// Los nombres salen de las MISMAS reglas de `periodos.ts`: si el motor cambia la base, la prueba cae.
import { describe, it, expect } from 'vitest'
import { baseConFechas, conArticulo, nombreBase, periodoEnPalabras } from './barraVentasV2'
import { calcularPeriodo, fechasCortas, type OpcionesPeriodo } from './periodos'
import { bajada } from './resumenV2'

// Reloj de la prueba: 18-nov-2026 (miércoles), N = 17-nov. Datos ficticios.
const ANCLA = '2026-11-18'
const per = (o: Omit<OpcionesPeriodo, 'ancla'>) => calcularPeriodo({ ...o, ancla: ANCLA })
const A = (o: Omit<OpcionesPeriodo, 'ancla'>) => baseConFechas(per(o), 'anteriorEquivalente')

describe('rótulos de la base A (período anterior equivalente), período por período', () => {
  it('Rango 1–15 nov (el caso del dueño) → «15 días anteriores (17–31 oct)»', () => {
    expect(A({ tipo: 'rango', desde: '2026-11-01', hasta: '2026-11-15' })).toBe('15 días anteriores (17–31 oct)')
    expect(A({ tipo: 'rango', desde: '2026-11-10', hasta: '2026-11-10' })).toBe('día anterior (9 nov)')
  })

  it('Quincena 1–15 nov → la MISMA quincena del mes anterior (1–15 oct), como fija la SPEC §3.3', () => {
    expect(A({ tipo: 'quincena', dia: '2026-11-10' })).toBe('misma quincena del mes anterior (1–15 oct)')
    // 2.ª quincena en curso (16–17 nov): mismos días de la 2.ª de octubre.
    expect(A({ tipo: 'quincena' })).toBe('misma quincena del mes anterior, mismos días (16–17 oct)')
  })

  it('Mes a la fecha → «mes anterior a la misma fecha (1–17 oct)»; mes cerrado → «mes anterior»', () => {
    expect(A({ tipo: 'mesALaFecha' })).toBe('mes anterior a la misma fecha (1–17 oct)')
    expect(A({ tipo: 'mes', dia: '2026-10-05' })).toBe('mes anterior (1–30 sep)')
  })

  it('Semana → «semana anterior»; en curso, con «mismos días»', () => {
    expect(A({ tipo: 'semana', dia: '2026-11-11' })).toBe('semana anterior (2–8 nov)')
    expect(A({ tipo: 'semana' })).toBe('semana anterior, mismos días (9–10 nov)')
  })

  it('Ayer → el mismo día de la semana pasada (−7, no el día anterior)', () => {
    expect(A({ tipo: 'ayer' })).toBe('mismo día de la semana pasada (10 nov)')
  })

  it('Temporada → «temporada anterior»; Año a la fecha no tiene base A, la B es «año anterior a la fecha»', () => {
    expect(nombreBase(per({ tipo: 'temporada' }), 'anteriorEquivalente').texto).toBe('temporada anterior')
    const anio = per({ tipo: 'anioALaFecha' })
    expect(anio.bases.anteriorEquivalente).toBeNull()
    expect(baseConFechas(anio, 'anioMismasFechas')).toBe('año anterior a la fecha (1 ene – 17 nov 2025)')
  })

  it('las bases del año: «año pasado, mismas fechas» y «año pasado, mismo día de semana», con su año', () => {
    const p = per({ tipo: 'mesALaFecha' })
    expect(baseConFechas(p, 'anioMismasFechas')).toBe('año pasado, mismas fechas (1–17 nov 2025)')
    expect(baseConFechas(p, 'anioMismoDiaSemana')).toBe('año pasado, mismo día de semana (2–18 nov 2025)')
  })

  it('nunca dice «período anterior» en ningún tipo', () => {
    const tipos = ['ayer', 'semana', 'quincena', 'mesALaFecha', 'mes', 'anioALaFecha', 'temporada'] as const
    for (const tipo of tipos) {
      const p = per({ tipo })
      expect(periodoEnPalabras(p, 'anteriorEquivalente', 'anioMismoDiaSemana')).not.toMatch(/período anterior/i)
    }
  })
})

describe('fechas cortas y artículos', () => {
  it('mismo mes, meses distintos, un día, otro año y cruce de año', () => {
    expect(fechasCortas({ desde: '2026-10-16', hasta: '2026-10-31' }, 2026)).toBe('16–31 oct')
    expect(fechasCortas({ desde: '2026-10-28', hasta: '2026-11-03' }, 2026)).toBe('28 oct – 3 nov')
    expect(fechasCortas({ desde: '2026-11-11', hasta: '2026-11-11' }, 2026)).toBe('11 nov')
    expect(fechasCortas({ desde: '2025-11-02', hasta: '2025-11-16' }, 2026)).toBe('2–16 nov 2025')
    expect(fechasCortas({ desde: '2025-12-28', hasta: '2026-01-03' }, 2026)).toBe('28 dic 2025 – 3 ene')
  })

  it('del / de la / de los; con el / con la', () => {
    expect(conArticulo({ texto: 'x', articulo: 'el' }, 'de')).toBe('del')
    expect(conArticulo({ texto: 'x', articulo: 'la' }, 'de')).toBe('de la')
    expect(conArticulo({ texto: 'x', articulo: 'los' }, 'de')).toBe('de los')
    expect(conArticulo({ texto: 'x', articulo: 'el' }, 'con')).toBe('con el')
  })

  it('la bajada usa el nombre concreto y las fechas: «… arriba de los 15 días anteriores (17–31 oct)»', () => {
    const cifras = (neta: number) => ({ totales: { ventaNeta: neta, pax: 100 }, vpp: { valor: 1 } }) as unknown as Parameters<typeof bajada>[0]
    const p = per({ tipo: 'rango', desde: '2026-11-01', hasta: '2026-11-15' })
    const txt = bajada(cifras(110),
      { id: 'anteriorEquivalente', cifras: cifras(100), nombre: { ...nombreBase(p, 'anteriorEquivalente'), fechas: '17–31 oct' } },
      { id: 'anioMismoDiaSemana', cifras: cifras(110), nombre: { ...nombreBase(p, 'anioMismoDiaSemana'), fechas: '2–16 nov 2025' } })
    expect(txt).toMatch(/^Vas 10 % arriba de los 15 días anteriores \(17–31 oct\) y parejo con el año pasado, mismo día de semana \(2–16 nov 2025\)\./)
  })
})
