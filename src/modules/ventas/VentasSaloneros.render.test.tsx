// @vitest-environment happy-dom
//
// «Saloneros», en el DOM: el Ratio C/B GENERAL sale de la misma base que las filas.
//
// ── El leftover ────────────────────────────────────────────────────────────────────────────
// #6 arregló este mismo bug en «Hoy» y quedó pendiente acá. El KPI del header y la fila
// GENERAL pintaban `gen.ratioCB`, que `aggGeneral` calcula con la cuenta por `pm[nombre]?.tipo`
// (`ventasUtils.ts:304-305,321`) — el `ProductMap` curado a mano, que en un día del PoS no
// matchea. Resultado: `0.00:1` arriba, con una tabla debajo cuyas filas SÍ tenían valor,
// porque `aggSalonero` acumula `com`/`beb` desde `SaloneroDay`, ya partido por familia.
//
// ── Lo que NO cambia ───────────────────────────────────────────────────────────────────────
// `aggGeneral` queda intacto: lo consumen otras pantallas con días del .xls, donde la cuenta
// por `ProductMap` sí matchea. Lo que cambia es de dónde saca la PANTALLA el número que pinta.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: null }) }))
// La pantalla ahora importa la capa de I/O de las lentes (para el bloque «venta propia por
// línea»), y esa arrastra el cliente de Supabase. Se mockea igual que en el test de render de
// `VentasSaloneroLineas`: lo que se prueba acá es el cableado, no la lectura del PoS.
vi.mock('./saloneroLentesDatos', () => ({ getLentesDesdePos: vi.fn(async () => ({
  lentes: {
    ventaPropia: [], mesaPropia: [], netaDiaCrc: 0, netaLineasCrc: 0, descuadreCrc: 0, turnos: [],
  },
  nombres: {}, tickets: 0,
})) }))

import VentasSaloneros from './VentasSaloneros'
import type { CajeroDay, DiasMap, Meta, SaloneroDay } from '../../shared/types/ventas'
import { aggGeneral, aggSalonero, mixPorFamilia } from './ventasUtils'

const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
})

const caj = (o: Partial<CajeroDay>): CajeroDay => ({
  esCajero: true, total: 0, salon: 0, delivery: 0, iva: 0, serv: 0,
  ordenes: 0, ticketProm: 0, prods: [], ...o,
})

const METAS: Meta = {
  restaurante: {}, margen: {},
  global: { promPax: 15_000, bebPax: 1.2, ratioCB: 3.0, ticketItem: 7_500, ventas: 800_000 },
  salMetas: {},
}

/** El preset por defecto mira los últimos días cargados, así que alcanza con una fecha. */
const FECHA = '2026-09-07'

// Dos meseros con el MISMO ratio 3:1, y nombres de producto que el `ProductMap` no conoce
// — es el caso de staging: los días vienen del PoS y `product_map` se cura a mano.
const DIAS: DiasMap = {
  [FECHA]: {
    fileName: 'ndf', uploadedAt: '2026-09-08',
    saloneros: {
      MAXO: sal({
        pax: 20, total: 200_000, com: 150_000, beb: 50_000, iCom: 40, iBeb: 25,
        prods: [['ROLL SATORI', 40, 150_000], ['IMPERIAL', 25, 50_000]],
      }),
      GUILLE: sal({
        pax: 10, total: 100_000, com: 75_000, beb: 25_000, iCom: 20, iBeb: 12,
        prods: [['ROLL SATORI', 20, 75_000], ['IMPERIAL', 12, 25_000]],
      }),
      'Cajero turno tarde': caj({ total: 40_000, salon: 0, delivery: 40_000, ordenes: 3 }),
    },
  },
}

const texto = () => (document.body.textContent ?? '').replace(/\s/g, ' ')

describe('VentasSaloneros · Ratio C/B general por familia', () => {
  it('el ratio por familia coincide con el de las filas por salonero', () => {
    const mix = mixPorFamilia(DIAS, [FECHA])
    // (150.000 + 75.000) ÷ (50.000 + 25.000) = 3
    expect(mix.com / mix.beb).toBe(3)
    // …y es exactamente el de cada fila, que ya salía por familia.
    expect(aggSalonero('MAXO',   [FECHA], DIAS, {}).ratioCB).toBe(3)
    expect(aggSalonero('GUILLE', [FECHA], DIAS, {}).ratioCB).toBe(3)
  })

  it('`aggGeneral.ratioCB` sigue dando 0 — no se tocó; la pantalla ya no lo pinta', () => {
    expect(aggGeneral([FECHA], DIAS, {}).ratioCB).toBe(0)
  })

  it('en el DOM pinta 3.00:1 y nunca 0.00:1', () => {
    render(<VentasSaloneros dias={DIAS} pm={{}} metas={METAS} />)
    expect(texto()).toContain('Ratio C/B3.00:1')       // el KPI del header
    expect(texto()).not.toContain('0.00:1')            // ni arriba ni en la fila GENERAL
  })

  it('el general y la fila GENERAL de la tabla dicen lo mismo', () => {
    render(<VentasSaloneros dias={DIAS} pm={{}} metas={METAS} />)
    // Header + 2 filas de salonero + fila GENERAL = 4 apariciones del mismo ratio.
    expect(texto().split('3.00:1').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('sin bebida no divide por cero: 0 y sin NaN', () => {
    const sinBebida: DiasMap = {
      [FECHA]: {
        fileName: 'ndf', uploadedAt: '2026-09-08',
        saloneros: { MAXO: sal({ pax: 5, total: 50_000, com: 50_000, beb: 0, iCom: 10, iBeb: 0 }) },
      },
    }
    render(<VentasSaloneros dias={sinBebida} pm={{}} metas={METAS} />)
    expect(texto()).not.toContain('NaN')
    expect(texto()).toContain('0.00:1')
  })

  it('el total y la neta no se movieron', () => {
    const gen = aggGeneral([FECHA], DIAS, {})
    expect(gen.total).toBe(300_000)        // meseros
    expect(gen.cajTotal).toBe(40_000)
    expect(gen.totalRest).toBe(340_000)
  })
})
