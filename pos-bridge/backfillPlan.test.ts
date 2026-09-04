import { describe, it, expect } from 'vitest'

import {
  acumular, agruparPorMes, conteoVacio, describirConteo, enumerarDias,
  parsearArgs, PAUSA_POR_DEFECTO, sumar, sumarDias,
} from './backfillPlan.ts'

describe('parsearArgs', () => {
  it('el modo principal: un rango explícito', () => {
    expect(parsearArgs(['--desde', '2026-08-05', '--hasta', '2026-09-03'])).toEqual({
      desde: '2026-08-05', hasta: '2026-09-03', todo: false, dryRun: false,
      orden: 'reciente-primero', pausaMs: PAUSA_POR_DEFECTO,
    })
  })

  it('--todo descubre el rango solo', () => {
    expect(parsearArgs(['--todo'])).toMatchObject({ desde: null, hasta: null, todo: true })
  })

  it('--dry-run, --orden asc y --pausa-ms', () => {
    expect(parsearArgs(['--desde', '2026-07-01', '--hasta', '2026-07-31', '--dry-run', '--orden', 'asc', '--pausa-ms', '800']))
      .toMatchObject({ dryRun: true, orden: 'viejo-primero', pausaMs: 800 })
  })

  it('exige el rango completo si no es --todo', () => {
    expect(() => parsearArgs([])).toThrow(/Faltan --desde y --hasta/)
    expect(() => parsearArgs(['--desde', '2026-09-01'])).toThrow(/Faltan/)
  })

  it('--todo y un rango explícito no se mezclan (escondería cuál mandó)', () => {
    expect(() => parsearArgs(['--todo', '--desde', '2026-09-01', '--hasta', '2026-09-02']))
      .toThrow(/no se combina/)
  })

  it('rechaza fechas inválidas, rango al revés y basura', () => {
    expect(() => parsearArgs(['--desde', '01/09/2026', '--hasta', '2026-09-02'])).toThrow()
    expect(() => parsearArgs(['--desde', '2026-02-31', '--hasta', '2026-03-01'])).toThrow(/inexistente/)
    expect(() => parsearArgs(['--desde', '2026-09-05', '--hasta', '2026-09-01'])).toThrow(/al revés/)
    expect(() => parsearArgs(['--desde', '2026-09-01', '--hasta', '2026-09-02', '--zaraza'])).toThrow(/desconocida/)
    expect(() => parsearArgs(['2026-09-01'])).toThrow(/Sobran/)
    expect(() => parsearArgs(['--desde'])).toThrow(/necesita un valor/)
    expect(() => parsearArgs(['--desde', '2026-09-01', '--hasta', '2026-09-02', '--pausa-ms', '-5'])).toThrow(/pausa-ms/)
    expect(() => parsearArgs(['--desde', '2026-09-01', '--hasta', '2026-09-02', '--orden', 'lateral'])).toThrow(/asc \| desc/)
  })
})

describe('enumerarDias', () => {
  it('por defecto va del MÁS RECIENTE al más viejo', () => {
    expect(enumerarDias('2026-09-01', '2026-09-04'))
      .toEqual(['2026-09-04', '2026-09-03', '2026-09-02', '2026-09-01'])
  })

  it('--orden asc lo da vuelta', () => {
    expect(enumerarDias('2026-09-01', '2026-09-03', 'viejo-primero'))
      .toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })

  it('incluye los dos extremos y el día suelto', () => {
    expect(enumerarDias('2026-09-01', '2026-09-01')).toEqual(['2026-09-01'])
  })

  it('cruza fin de mes, fin de año y bisiesto', () => {
    expect(enumerarDias('2026-08-30', '2026-09-02', 'viejo-primero'))
      .toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'])
    expect(enumerarDias('2026-12-30', '2027-01-02', 'viejo-primero'))
      .toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(enumerarDias('2028-02-27', '2028-03-01', 'viejo-primero'))
      .toEqual(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01'])
  })

  it('un mes entero da sus días exactos', () => {
    expect(enumerarDias('2026-07-01', '2026-07-31')).toHaveLength(31)
    expect(enumerarDias('2026-02-01', '2026-02-28')).toHaveLength(28)
  })

  it('rango al revés → vacío (no explota el loop)', () => {
    expect(enumerarDias('2026-09-05', '2026-09-01')).toEqual([])
  })
})

describe('sumarDias', () => {
  it('cruza los bordes sin líos de zona', () => {
    expect(sumarDias('2026-09-01', -1)).toBe('2026-08-31')
    expect(sumarDias('2027-01-01', -1)).toBe('2026-12-31')
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('agruparPorMes', () => {
  it('agrupa respetando el orden en que vienen (reciente → viejo)', () => {
    const dias = enumerarDias('2026-07-30', '2026-09-02')
    const tramos = agruparPorMes(dias)
    expect(tramos.map((t) => t.mes)).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(tramos[0].dias).toEqual(['2026-09-02', '2026-09-01'])
    expect(tramos[1].dias).toHaveLength(31)
    expect(tramos[2].dias).toEqual(['2026-07-31', '2026-07-30'])
  })

  it('un solo mes es un solo tramo', () => {
    expect(agruparPorMes(enumerarDias('2026-09-01', '2026-09-04'))).toHaveLength(1)
  })

  it('lista vacía → sin tramos', () => {
    expect(agruparPorMes([])).toEqual([])
  })
})

describe('conteos', () => {
  const r = (fecha: string, over = {}) =>
    ({ fecha, tickets: 10, guardados: 10, lineas: 40, error: null, ...over })

  it('suma tickets, líneas y el rango real de días CON ventas', () => {
    let c = conteoVacio()
    c = acumular(c, r('2026-09-03'))
    c = acumular(c, r('2026-09-02', { tickets: 0, guardados: 0, lineas: 0 }))   // día vacío
    c = acumular(c, r('2026-09-01'))
    expect(c).toMatchObject({
      dias: 3, diasVacios: 1, tickets: 20, guardados: 20, lineas: 80, errores: 0,
      primerDia: '2026-09-01', ultimoDia: '2026-09-03',
    })
  })

  it('un día con error cuenta como error y no suma nada', () => {
    const c = acumular(conteoVacio(), r('2026-09-01', { error: 'ECONNREFUSED' }))
    expect(c).toMatchObject({ dias: 1, errores: 1, tickets: 0, primerDia: null })
  })

  it('sumar() junta tramos y conserva el rango global', () => {
    const a = acumular(conteoVacio(), r('2026-09-01'))
    const b = acumular(conteoVacio(), r('2026-07-15'))
    expect(sumar(a, b)).toMatchObject({
      dias: 2, tickets: 20, primerDia: '2026-07-15', ultimoDia: '2026-09-01',
    })
  })

  it('la línea de resumen dice lo que hay que mirar', () => {
    const c = acumular(conteoVacio(), r('2026-09-01'))
    expect(describirConteo('2026-09', c))
      .toBe('2026-09 · días=1 (vacíos 0) · tickets=10 guardados=10 · líneas=40 · errores=0 · 2026-09-01…2026-09-01')
    expect(describirConteo('TOTAL', conteoVacio())).toContain('sin ventas')
  })
})
