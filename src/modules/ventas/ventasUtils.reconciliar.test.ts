// Reconciliación del módulo Ventas (pase A+B): los cajeros se leen del PoS y el mix
// comida/bebida de «Hoy» se clasifica por FAMILIA, no por `ProductMap`.
//
// ── Los dos bugs ───────────────────────────────────────────────────────────────────────────
// A · CAJEROS INVISIBLES. `VentasCajeros` listaba los buckets de caja filtrando por NOMBRE
//     (`esCajero` → `CAJEROS_IDS`, la lista de nombres que escribía el .xls). El adaptador del
//     PoS manda a la MISMA rama `CajeroDay` otros buckets que no están en esa lista —
//     `«Caja · 388»`, `«Sistema · 002»`, `«Sin salonero»`—, así que su plata desaparecía de la
//     pestaña aunque `aggGeneral` la contara en `cajTotal`. `cajerosEnRango` filtra por la
//     MARCA `esCajero` del dato, que ponen las dos fuentes.
//
// B · COMIDA/BEBIDA EN ₡0. Las tarjetas de «Hoy» sumaban ₡ cruzando el nombre del producto
//     contra `product_map` (`pm[n].tipo`), una tabla cargada a mano con los nombres de la era
//     del .xls. Con nombres del PoS `pm[n]` sale `undefined` → ₡0 al lado de un contador de
//     unidades con decenas de platos. `mixPorFamilia` suma `SaloneroDay.com`/`.beb`, que
//     `armarDia` llena del MISMO bucle sobre las líneas de `pos_ndf` que llena `iCom`/`iBeb`.
//
// ── Lo que NO cambia ───────────────────────────────────────────────────────────────────────
// Ni el total ni la neta del día: los dos helpers solo LISTAN y SUMAN lo que ya estaba en el
// `DiaData`. Se fija acá abajo contra `getDayStats` y `aggGeneral`.
import { describe, it, expect } from 'vitest'

import type { CajeroDay, DiaData, DiasMap, ProductMap, SaloneroDay } from '../../shared/types/ventas'
import { aggGeneral, cajerosEnRango, getDayStats, mixPorFamilia } from './ventasUtils'

const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
})

const caj = (o: Partial<CajeroDay>): CajeroDay => ({
  esCajero: true, total: 0, salon: 0, delivery: 0, iva: 0, serv: 0,
  ordenes: 0, ticketProm: 0, prods: [], ...o,
})

const dia = (saloneros: Record<string, SaloneroDay | CajeroDay>): DiaData =>
  ({ fileName: 'ndf 2026-09-08', uploadedAt: '2026-09-08', saloneros })

/**
 * Un día tal como lo arma `armarDia` desde `pos_ndf_*`:
 *   · un mesero con su mix por familia ya resuelto (`com`/`beb` + `iCom`/`iBeb`),
 *   · los dos cajeros de turno, que el .xls también nombraba así,
 *   · y los TRES buckets que solo existen del lado del PoS y que el filtro por nombre perdía.
 * Los nombres de producto son los del PoS, que NO están en el `ProductMap` de la app.
 */
const DIA_POS: DiasMap = {
  '2026-09-08': dia({
    MAXO: sal({
      pax: 20, total: 300_000, com: 220_000, beb: 80_000, iCom: 40, iBeb: 25,
      prods: [['ROLL CALIFORNIA', 40, 220_000], ['IMPERIAL 350', 25, 80_000]],
    }),
    'Cajero turno mañana': caj({ total: 100_000, salon: 60_000, delivery: 40_000, ordenes: 8 }),
    'Cajero turno tarde':  caj({ total: 150_000, salon: 90_000, delivery: 60_000, ordenes: 10 }),
    'Caja · 388':          caj({ total: 50_000,  salon: 20_000, delivery: 30_000, ordenes: 4 }),
    'Sistema · 002':       caj({ total: 30_000,  salon: 30_000, delivery: 0,      ordenes: 2 }),
    'Sin salonero':        caj({ total: 20_000,  salon: 15_000, delivery: 5_000,  ordenes: 1 }),
  }),
  // Otra jornada, para que se vea que el rango recorta de verdad.
  '2026-09-01': dia({
    KEVIN:        sal({ pax: 5, total: 50_000, com: 40_000, beb: 10_000, iCom: 8, iBeb: 3 }),
    'Caja · 999': caj({ total: 10_000, salon: 10_000, delivery: 0, ordenes: 1 }),
  }),
}

/** El `ProductMap` real de esta base: no conoce NINGÚN nombre del PoS. Ese es el bug B. */
const PM_VACIO: ProductMap = {}

const FECHA = '2026-09-08'

describe('A · cajerosEnRango — los buckets de caja salen del dato, no del nombre', () => {
  it('lista los CINCO buckets marcados `esCajero`, no solo los dos que nombra el xls', () => {
    expect(cajerosEnRango(DIA_POS, [FECHA])).toEqual([
      'Caja · 388',
      'Cajero turno mañana',
      'Cajero turno tarde',
      'Sin salonero',
      'Sistema · 002',
    ])
  })

  it('no lista meseros', () => {
    expect(cajerosEnRango(DIA_POS, [FECHA])).not.toContain('MAXO')
  })

  it('la suma de los buckets listados ES el `cajTotal` del día — la pestaña ya no muestra de menos', () => {
    const nombres = cajerosEnRango(DIA_POS, [FECHA])
    const suma = nombres.reduce(
      (s, n) => s + (DIA_POS[FECHA].saloneros[n] as CajeroDay).total, 0,
    )
    expect(suma).toBe(aggGeneral([FECHA], DIA_POS, PM_VACIO).cajTotal)
    expect(suma).toBe(350_000)   // el filtro por nombre daba 250.000: se perdían 100.000
  })

  it('recorta por RANGO: una jornada fuera del período no aporta columnas', () => {
    expect(cajerosEnRango(DIA_POS, ['2026-09-01'])).toEqual(['Caja · 999'])
    expect(cajerosEnRango(DIA_POS, [])).toEqual([])
  })

  it('una fecha sin datos no rompe ni inventa buckets', () => {
    expect(cajerosEnRango(DIA_POS, ['2026-01-01'])).toEqual([])
  })
})

describe('B · mixPorFamilia — el ₡ de comida/bebida sale de la familia del PoS', () => {
  it('devuelve plata donde el cruce por `ProductMap` daba ₡0', () => {
    const porProductMap = Object.entries(aggGeneral([FECHA], DIA_POS, PM_VACIO).prods)
      .reduce((s, [n, v]) => s + (PM_VACIO[n]?.tipo === 'comida' ? v.m : 0), 0)
    expect(porProductMap).toBe(0)              // el bug

    expect(mixPorFamilia([FECHA], DIA_POS)).toEqual({ com: 220_000, beb: 80_000 })
  })

  it('₡ y unidades son coherentes: los dos salen de los mismos buckets de mesero', () => {
    const gen = aggGeneral([FECHA], DIA_POS, PM_VACIO)
    const mix = mixPorFamilia([FECHA], DIA_POS)
    // Sin división por cero y con un promedio que se puede leer: ₡5.500 el plato, ₡3.200 la bebida.
    expect(gen.iCom).toBeGreaterThan(0)
    expect(gen.iBeb).toBeGreaterThan(0)
    expect(mix.com / gen.iCom).toBe(5_500)
    expect(mix.beb / gen.iBeb).toBe(3_200)
  })

  it('NO incluye la caja — por eso va rotulado «no neta»', () => {
    const mix  = mixPorFamilia([FECHA], DIA_POS)
    const gen  = aggGeneral([FECHA], DIA_POS, PM_VACIO)
    expect(mix.com + mix.beb).toBe(gen.total)          // el neto de MESEROS
    expect(mix.com + mix.beb).not.toBe(gen.totalRest)  // NO el del día
  })

  it('suma varias jornadas y tolera fechas sin datos', () => {
    expect(mixPorFamilia([FECHA, '2026-09-01'], DIA_POS)).toEqual({ com: 260_000, beb: 90_000 })
    expect(mixPorFamilia(['2026-01-01'], DIA_POS)).toEqual({ com: 0, beb: 0 })
  })
})

describe('lo que NO se movió', () => {
  it('el total y la neta del día quedan idénticos: ningún helper nuevo los toca', () => {
    const stats = getDayStats(DIA_POS[FECHA])
    const gen   = aggGeneral([FECHA], DIA_POS, PM_VACIO)
    expect(gen.totalRest).toBe(650_000)   // 300.000 de meseros + 350.000 de caja
    expect(stats.ventaNeta).toBe(650_000)
    expect(gen.total).toBe(300_000)
  })
})
