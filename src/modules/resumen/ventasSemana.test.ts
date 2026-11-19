// Resumen semanal desde los días del PoS (16-nov). Datos ficticios.
import { describe, it, expect } from 'vitest'
import type { DiaData } from '../../shared/types/ventas'
import { ventasDeLaSemana } from './ventasSemana'

const dia = (total: number, pax: number, cajaTotal = 0): DiaData => ({
  fileName: 'pos', uploadedAt: '2026-11-05',
  saloneros: {
    'Mesero Uno': { pax, total, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0, promPax: 0, promPlato: 0,
      promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [] },
    ...(cajaTotal ? { 'Caja turno noche': { esCajero: true as const, total: cajaTotal, salon: 0, delivery: cajaTotal,
      iva: 0, serv: 0, ordenes: 1, ticketProm: cajaTotal, prods: [] } } : {}),
  },
})

describe('ventasDeLaSemana', () => {
  it('días sin xls (después del 20-oct) suman: cada día del PoS entra una vez', () => {
    const r = ventasDeLaSemana({ '2026-11-02': dia(100_000, 5, 20_000), '2026-11-03': dia(50_000, 2) })
    expect(r.ventaNeta).toBe(170_000)
    expect(r.pax).toBe(7)
    expect(r.days.map(d => d.fecha).sort()).toEqual(['2026-11-02', '2026-11-03'])
  })

  it('la caja no entra al ranking de saloneros', () => {
    const r = ventasDeLaSemana({ '2026-11-02': dia(100_000, 5, 20_000) })
    expect(Object.keys(r.salMap)).toEqual(['MESERO UNO'])
    expect(r.salMap['MESERO UNO']).toEqual({ total: 100_000, salon: 100_000, pax: 5, days: 1 })
  })

  it('venta por persona = salón ÷ personas (D4): el delivery de caja no entra (antes neta total ÷ pax)', () => {
    const r = ventasDeLaSemana({ '2026-11-02': dia(100_000, 5, 20_000) })
    expect(r.salon).toBe(100_000)
    expect(r.promPax).toBe(20_000)          // con la neta total sería 120.000 ÷ 5 = 24.000
    expect(ventasDeLaSemana({}).promPax).toBe(0)
  })

  it('semana sin ventas → ceros', () => {
    expect(ventasDeLaSemana({})).toMatchObject({ ventaNeta: 0, ventaBruta: 0, pax: 0, days: [] })
  })
})
