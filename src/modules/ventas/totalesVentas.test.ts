// Totales de ventas de las pantallas fuera de Ventas (Resumen, Inicio, Inventario, Finanzas),
// desde los días del PoS (16-nov). Datos ficticios.
import { describe, it, expect } from 'vitest'
import type { CajeroDay, DiaData, SaloneroDay } from '../../shared/types/ventas'
import { totalesDelDia, totalesDelRango } from './totalesVentas'
import { getDayStats } from './ventasUtils'

const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0, promPax: 0, promPlato: 0,
  promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
})
const caj = (o: Partial<CajeroDay>): CajeroDay => ({
  esCajero: true, total: 0, salon: 0, delivery: 0, iva: 0, serv: 0, ordenes: 0, ticketProm: 0, prods: [], ...o,
})
const dia = (s: DiaData['saloneros']): DiaData => ({ fileName: 'pos', uploadedAt: '2026-11-05', saloneros: s })

// Un día del PoS: un mesero con un delivery adentro y una caja con salón y pax.
const D = dia({
  MESERO_A: sal({ total: 100_000, delivery: 20_000, pax: 4, iva: 13_000, serv: 8_000 }),
  'Caja turno noche': caj({ total: 50_000, salon: 30_000, delivery: 20_000, pax: 2, iva: 6_500, serv: 3_000 }),
})

describe('totalesDelDia', () => {
  it('es la misma suma que el módulo Ventas (getDayStats)', () => {
    const t = totalesDelDia(D), s = getDayStats(D)
    expect([t.ventaNeta, t.ventaBruta, t.salon, t.delivery, t.pax, t.promPax])
      .toEqual([s.ventaNeta, s.ventaBruta, s.salon, s.delivery, s.pax, s.promPax])
  })

  it('el delivery del mesero va a delivery (no a salón) y el pax de caja cuenta', () => {
    const t = totalesDelDia(D)
    expect(t.ventaNeta).toBe(150_000)
    expect(t.salon).toBe(80_000 + 30_000)
    expect(t.delivery).toBe(20_000 + 20_000)
    expect(t.pax).toBe(6)
    expect(t.ventaBruta).toBe(150_000 + 13_000 + 8_000 + 6_500 + 3_000)
    expect(t.dias).toBe(1)
  })

  it('sin día → ceros', () => {
    expect(totalesDelDia(undefined)).toMatchObject({ ventaNeta: 0, pax: 0, dias: 0 })
  })
})

describe('totalesDelRango', () => {
  it('suma cada fecha una vez y recalcula el prom/pax del rango', () => {
    const t = totalesDelRango({ '2026-11-05': D, '2026-11-06': D })
    expect(t.ventaNeta).toBe(300_000)
    expect(t.dias).toBe(2)
    expect(t.promPax).toBeCloseTo((110_000 * 2) / 12)
  })
})
