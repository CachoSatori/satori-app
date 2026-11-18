// Fila TOTAL de «Ventas → Contabilidad → Detalle por día» (`totalesContabilidad`): la usan la pantalla y el correo
// quincenal al contador (Edge `ventas-dia-contador`). Datos ficticios.
import { describe, it, expect } from 'vitest'
import type { CajeroDay, ContabilidadDay, DiaData, SaloneroDay } from '../../shared/types/ventas'
import { getContabilidadDays, getDayStats, totalesContabilidad } from './ventasUtils'
import { ventaPorPersonaDeTotales } from './indicadores'

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

// Decisión del dueño (18-nov): una sola fuente de la cuenta. El Prom/PAX de la fila TOTAL (pantalla y correo al
// contador) es SIEMPRE `ventaPorPersonaDeTotales(Σ salón, Σ pax) ?? 0`. Si alguien vuelve a escribir la división a
// mano, los casos con pax 0, nulos, NaN o infinito separan las dos cuentas y esto cae.
describe('totalesContabilidad = ventaPorPersonaDeTotales (paridad, una sola cuenta)', () => {
  const fila = (o: Partial<Record<keyof ContabilidadDay, unknown>>): ContabilidadDay => ({
    fecha: '2026-11-01', ventaBruta: 0, ventaNeta: 0, iva: 0, serv: 0, salon: 0, delivery: 0, pax: 0, promPax: 0, ...o,
  } as ContabilidadDay)
  const sum = (ds: ContabilidadDay[], k: 'salon' | 'pax') => ds.reduce((s, d) => s + (d[k] as number), 0)
  const esperado = (ds: ContabilidadDay[]) => ventaPorPersonaDeTotales(sum(ds, 'salon'), sum(ds, 'pax')) ?? 0

  const casos: Array<[string, ContabilidadDay[]]> = [
    ['días reales del mes', getContabilidadDays(2026, 11, DIAS, {})],
    ['sin filas', []],
    ['pax 0 con venta de salón (solo delivery/caja sin personas)', [fila({ salon: 40_000, pax: 0 })]],
    ['pax nulo', [fila({ salon: 40_000, pax: null }), fila({ salon: 10_000, pax: 2 })]],
    ['salón nulo', [fila({ salon: null, pax: 3 }), fila({ salon: 30_000, pax: 3 })]],
    ['pax undefined', [fila({ salon: 25_000, pax: undefined })]],
    ['salón NaN (dato roto del PoS)', [fila({ salon: Number.NaN, pax: 4 })]],
    ['pax NaN', [fila({ salon: 20_000, pax: Number.NaN })]],
    ['salón infinito', [fila({ salon: Number.POSITIVE_INFINITY, pax: 2 })]],
    ['pax negativo (corrección)', [fila({ salon: 15_000, pax: -1 })]],
  ]

  it.each(casos)('%s: la fila TOTAL da lo mismo que ventaPorPersonaDeTotales', (_n, ds) => {
    const t = totalesContabilidad(ds)
    expect(Number.isFinite(t.promPax)).toBe(true)
    expect(t.promPax).toBe(esperado(ds))
  })

  it('mil períodos al azar (semilla fija): nunca divergen', () => {
    let x = 20261118
    const r = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 }
    for (let i = 0; i < 1000; i++) {
      const ds = Array.from({ length: Math.floor(r() * 16) }, () => fila({
        salon: Math.round(r() * 500_000), pax: r() < 0.3 ? 0 : Math.floor(r() * 40),
      }))
      expect(totalesContabilidad(ds).promPax).toBe(esperado(ds))
    }
  })
})
