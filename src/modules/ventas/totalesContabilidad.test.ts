// Fila TOTAL de «Ventas → Contabilidad → Detalle por día» (`totalesContabilidad`): la usan la pantalla y el correo
// quincenal al contador (Edge `ventas-dia-contador`). Datos ficticios.
import { describe, it, expect } from 'vitest'
import type { CajeroDay, DiaData, SaloneroDay } from '../../shared/types/ventas'
import { getContabilidadDays, getDayStats, totalesContabilidad } from './ventasUtils'

const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0, promPax: 0, promPlato: 0,
  promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
})
const caj = (o: Partial<CajeroDay>): CajeroDay => ({
  esCajero: true, total: 0, salon: 0, delivery: 0, iva: 0, serv: 0, ordenes: 0, ticketProm: 0, prods: [], ...o,
})
const dia = (s: DiaData['saloneros']): DiaData => ({ fileName: 'pos', uploadedAt: '2026-11-05', saloneros: s })

// Dos días con ventas (mesero con delivery + caja) y el 3 sin ventas (no está en el mapa, como en la pantalla).
const DIAS = {
  '2026-11-02': dia({
    MESERO_A: sal({ total: 100_000, delivery: 20_000, pax: 4, iva: 13_000, serv: 8_000 }),
    CAJA_1: caj({ total: 50_000, salon: 30_000, delivery: 20_000, pax: 2, iva: 6_500, serv: 3_000 }),
  }),
  '2026-11-04': dia({ MESERO_B: sal({ total: 60_000, pax: 2, iva: 7_800, serv: 6_000 }) }),
}

describe('totalesContabilidad (fila TOTAL del Detalle por día)', () => {
  const days = getContabilidadDays(2026, 11, DIAS, {})

  it('cada columna del TOTAL = suma de las filas', () => {
    const t = totalesContabilidad(days)
    expect(days.map(d => d.fecha)).toEqual(['2026-11-02', '2026-11-04'])
    expect(t).toMatchObject({
      ventaNeta: 210_000, iva: 27_300, serv: 17_000, ventaBruta: 254_300,
      salon: 170_000, delivery: 40_000, pax: 8,
    })
    for (const k of ['ventaBruta', 'iva', 'serv', 'ventaNeta', 'salon', 'delivery', 'pax'] as const) {
      expect(t[k]).toBe(days.reduce((s, d) => s + d[k], 0))
    }
  })

  it('Prom/PAX del período = neta de salón ÷ personas (no la neta total, no el promedio de los diarios)', () => {
    const t = totalesContabilidad(days)
    expect(t.promPax).toBe(170_000 / 8)
    const promedioDiarios = (getDayStats(DIAS['2026-11-02']).promPax + getDayStats(DIAS['2026-11-04']).promPax) / 2
    expect(t.promPax).not.toBe(promedioDiarios)
    expect(t.promPax).not.toBe(210_000 / 8)
  })

  it('día sin ventas: suma 0 y no cambia nada; sin filas o sin pax, Prom/PAX = 0 (no NaN)', () => {
    const cero = { fecha: '2026-11-03', ventaBruta: 0, ventaNeta: 0, iva: 0, serv: 0, salon: 0, delivery: 0, pax: 0, promPax: 0 }
    expect(totalesContabilidad([...days, cero])).toEqual(totalesContabilidad(days))
    expect(totalesContabilidad([])).toEqual({ ventaBruta: 0, iva: 0, serv: 0, ventaNeta: 0, salon: 0, delivery: 0, pax: 0, promPax: 0 })
    expect(totalesContabilidad([cero]).promPax).toBe(0)
  })
})
