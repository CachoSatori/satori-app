// El Ratio C/B GENERAL por familia sale de la misma base que las filas por salonero.
//
// ── El leftover ────────────────────────────────────────────────────────────────────────────
// #6 arregló este bug en «Hoy» y después en «Saloneros»: el ratio general salía de `aggGeneral`, que cuenta por
// `pm[nombre]?.tipo` (el `ProductMap` curado a mano, que en un día del PoS no matchea) → `0.00:1` arriba con filas
// que sí tenían valor (`aggSalonero` acumula `com`/`beb` desde `SaloneroDay`, ya partido por familia).
// Ventas v2 · 3.5.5: «Saloneros» se borró (su lugar es «Equipo»); quedan las pruebas de las funciones, que siguen
// vivas en `ventasUtils.ts` (las usan «Resumen», la paridad del 3.5.2 y el correo de cierre).
import { describe, it, expect } from 'vitest'
import type { CajeroDay, DiasMap, SaloneroDay } from '../../shared/types/ventas'
import { aggGeneral, aggSalonero, mixPorFamilia } from './ventasUtils'

const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
})

const caj = (o: Partial<CajeroDay>): CajeroDay => ({
  esCajero: true, total: 0, salon: 0, delivery: 0, iva: 0, serv: 0,
  ordenes: 0, ticketProm: 0, prods: [], ...o,
})

/** El preset por defecto mira los últimos días cargados, así que alcanza con una fecha. */
const FECHA = '2026-09-07'

// Dos meseros con el MISMO ratio 3:1, y nombres de producto que el `ProductMap` no conoce
// — es el caso de staging: los días vienen del PoS y `product_map` se cura a mano.
const DIAS: DiasMap = {
  [FECHA]: {
    fileName: `ndf ${FECHA}`, uploadedAt: '2026-09-08',
    saloneros: {
      TITO: sal({
        pax: 20, total: 200_000, com: 150_000, beb: 50_000, iCom: 40, iBeb: 25,
        prods: [['ROLL SATORI', 40, 150_000], ['IMPERIAL', 25, 50_000]],
      }),
      JULIAN: sal({
        pax: 10, total: 100_000, com: 75_000, beb: 25_000, iCom: 20, iBeb: 12,
        prods: [['ROLL SATORI', 20, 75_000], ['IMPERIAL', 12, 25_000]],
      }),
      'Cajero turno tarde': caj({ total: 40_000, salon: 0, delivery: 40_000, ordenes: 3 }),
    },
  },
}

describe('Ratio C/B general por familia (`mixPorFamilia`, `aggSalonero`, `aggGeneral`)', () => {
  it('el ratio por familia coincide con el de las filas por salonero', () => {
    const mix = mixPorFamilia(DIAS, [FECHA])
    // (150.000 + 75.000) ÷ (50.000 + 25.000) = 3
    expect(mix.com / mix.beb).toBe(3)
    // …y es exactamente el de cada fila, que ya salía por familia.
    expect(aggSalonero('TITO',   [FECHA], DIAS, {}).ratioCB).toBe(3)
    expect(aggSalonero('JULIAN', [FECHA], DIAS, {}).ratioCB).toBe(3)
  })

  it('`aggGeneral.ratioCB` sigue dando 0 — no se tocó; la pantalla ya no lo pinta', () => {
    expect(aggGeneral([FECHA], DIAS, {}).ratioCB).toBe(0)
  })




  it("modo 'xls': un día del Excel usa la cuenta de siempre (ProductMap), no la familia", () => {
    // Mismo día pero cargado del .xls: com/beb del Excel dicen 3:1, el ProductMap dice todo comida.
    const xls: DiasMap = { [FECHA]: { ...DIAS[FECHA], fileName: 'ventas 07-09.xls' } }
    const pm = {
      'ROLL SATORI': { tipo: 'comida', clasificacion: '', subclasificacion: '', multiplicador: 1, costo_unitario: 0 },
      'IMPERIAL':    { tipo: 'comida', clasificacion: '', subclasificacion: '', multiplicador: 1, costo_unitario: 0 },
    }
    expect(aggGeneral([FECHA], xls, pm).ratioCB).toBe(0)   // todo comida según el ProductMap
  })

  it('el total y la neta no se movieron', () => {
    const gen = aggGeneral([FECHA], DIAS, {})
    expect(gen.total).toBe(300_000)        // meseros
    expect(gen.cajTotal).toBe(40_000)
    expect(gen.totalRest).toBe(340_000)
  })
})
