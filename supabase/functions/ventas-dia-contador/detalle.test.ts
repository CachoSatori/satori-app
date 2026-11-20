// Armado del detalle por día con la lógica REAL de la app (src/): filas de todos los días de la quincena,
// día sin ventas = fila en 0, numeración, día de la semana y fila TOTAL.
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../../src/shared/api/supabase', () => ({ supabase: null }))
import * as app from '../../../src/modules/ventas/ventasDiaContadorPuro'
import { armarDetalle, type LogicaApp } from './detalle.ts'
import { armarQuincena } from './quincena.ts'
import { diasFicticios } from './pruebas.fixtures.ts'

const L = app as unknown as LogicaApp

describe('armarDetalle', () => {
  it('quincena 1: 15 filas; los días sin ventas van en 0 y no cambian los totales', () => {
    const q = armarQuincena(2026, 11, 1)
    const dias = diasFicticios(['2026-11-02', '2026-11-03', '2026-11-10', '2026-11-20'])   // el 20 es de la 2.ª
    const d = armarDetalle(L, dias, q)
    expect(d.filas.map(f => f.n)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    expect(d.diasConVentas).toBe(3)
    const vacio = d.filas.find(f => f.fecha === '2026-11-01')!
    expect([vacio.ventaBruta, vacio.ventaNeta, vacio.iva, vacio.serv, vacio.salon, vacio.delivery, vacio.pax, vacio.promPax, vacio.conVentas])
      .toEqual([0, 0, 0, 0, 0, 0, 0, 0, false])
    // TOTAL = suma de las filas (las en 0 no suman) y Prom/PAX = Σ salón ÷ Σ pax.
    const suma = (k: 'ventaNeta' | 'ventaBruta' | 'iva' | 'serv' | 'salon' | 'delivery' | 'pax') => d.filas.reduce((s, f) => s + f[k], 0)
    for (const k of ['ventaNeta', 'ventaBruta', 'iva', 'serv', 'salon', 'delivery', 'pax'] as const) expect(d.total[k]).toBeCloseTo(suma(k), 6)
    expect(d.total.promPax).toBeCloseTo(suma('salon') / suma('pax'), 9)
    // El 20 (otra quincena) no entra.
    expect(d.filas.some(f => f.fecha === '2026-11-20')).toBe(false)
  })
  it('cada fila es getDayStats del día (neta, bruta = neta + IVA + servicio, Prom/PAX = salón ÷ pax)', () => {
    const q = armarQuincena(2026, 11, 1)
    const dias = diasFicticios(['2026-11-03'])
    const f = armarDetalle(L, dias, q).filas[2]
    const s = app.getDayStats(dias['2026-11-03'] as never)
    expect(f).toMatchObject({ fecha: '2026-11-03', ventaNeta: s.ventaNeta, ventaBruta: s.ventaBruta, salon: s.salon, pax: s.pax, promPax: s.promPax })
    expect(f.ventaBruta).toBeCloseTo(f.ventaNeta + f.iva + f.serv, 6)
    expect(f.promPax).toBeCloseTo(f.salon / f.pax, 9)
    expect(f.dia).toBe('Mar')   // 3-nov-2026 es martes
  })
  it('quincena 2 con meses de 28, 29, 30 y 31 días', () => {
    for (const [y, m, n] of [[2027, 2, 13], [2028, 2, 14], [2026, 9, 15], [2026, 10, 16]] as const) {
      const d = armarDetalle(L, {}, armarQuincena(y, m, 2))
      expect(d.filas.length).toBe(n)
      expect(d.filas[0].fecha.endsWith('-16')).toBe(true)
      expect(d.total.ventaNeta).toBe(0)
      expect(d.total.promPax).toBe(0)   // sin pax: 0, no NaN
      expect(d.diasConVentas).toBe(0)
    }
  })
})
