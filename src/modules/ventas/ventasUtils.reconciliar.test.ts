// Reconciliar Ventas · A (Cajeros desde el PoS) + B (Hoy: comida/bebida en ₡ por familia).
//
// ── Los dos bugs ───────────────────────────────────────────────────────────────────────────
// A · «Cajeros» descubría sus buckets con `esCajero(nombre)`, que compara contra `CAJEROS_IDS`
//     — una lista de nombres del .xls. El PoS etiqueta la caja con `etiquetaNoMesero()`, que
//     además de «Cajero turno mañana/tarde» produce `Caja · 388`, `Sistema · …` y
//     `Sin salonero`. Esos tres NO están en la lista: su plata contaba en el total del día
//     (`getDayStats`/`aggGeneral` leen la MARCA `esCajero`, no el nombre) pero la pestaña no
//     los mostraba. `allCajeros` los descubre por la marca, así que la pestaña cuadra con el día.
//
// B · «Hoy» sumaba el ₡ de las tarjetas Comidas/Bebidas recorriendo `gen.prods` y preguntándole
//     `pm[nombre]?.tipo` al `ProductMap`. Ese mapa se carga a mano con nombres del .xls y los
//     productos del PoS entran en MAYÚSCULAS desde `pos_ndf_lineas`: sin match no sumaban ₡,
//     y la tarjeta mostraba ₡0 con unidades > 0 (las unidades salen de la FAMILIA). `mixPorFamilia`
//     lee el mismo desglose por familia del que salen esas unidades.
//
// ── Lo que NO cambia ───────────────────────────────────────────────────────────────────────
// Ni el total ni la neta del día: `getDayStats` y `aggGeneral` no se tocaron. Se fija acá.
import { describe, it, expect } from 'vitest'

import type { CajeroDay, DiaData, DiasMap, SaloneroDay } from '../../shared/types/ventas'
import {
  aggCajero, aggGeneral, aggSalonero, allCajeros, allSaloneros, esEntradaCajero,
  getDayStats, mixPorFamilia,
} from './ventasUtils'

const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
})

const caj = (o: Partial<CajeroDay>): CajeroDay => ({
  esCajero: true, total: 0, salon: 0, delivery: 0, iva: 0, serv: 0,
  ordenes: 0, ticketProm: 0, prods: [], ...o,
})

const dia = (saloneros: Record<string, SaloneroDay | CajeroDay>): DiaData =>
  ({ fileName: 'x', uploadedAt: '2026-09-08', saloneros })

/**
 * Un día del PoS con las CUATRO etiquetas que produce `etiquetaNoMesero()`. Solo la primera
 * cae en `CAJEROS_IDS`; las otras tres son las que la pestaña perdía.
 *
 * El mesero trae `com`/`beb` (₡ por familia) y sus `prods` con nombres que el `ProductMap`
 * del .xls NO conoce — es exactamente el caso que dejaba las tarjetas en ₡0.
 */
const DIAS: DiasMap = {
  '2026-09-07': dia({
    MAXO: sal({
      pax: 20, total: 200_000, com: 150_000, beb: 50_000, iCom: 40, iBeb: 25,
      prods: [['ROLL SATORI', 40, 150_000], ['IMPERIAL', 25, 50_000]],
    }),
    'Cajero turno mañana': caj({ total: 60_000, salon: 40_000, delivery: 20_000, ordenes: 4 }),
    'Caja · 388':          caj({ total: 30_000, salon: 10_000, delivery: 20_000, ordenes: 2 }),
    'Sistema · 999':       caj({ total: 10_000, salon: 10_000, delivery:      0, ordenes: 1 }),
    'Sin salonero':        caj({ total:  5_000, salon:  5_000, delivery:      0, ordenes: 1 }),
  }),
}

/** El `ProductMap` real del staging para este día: vacío para los productos del PoS. */
const PM_SIN_MATCH = {}

describe('A · los cajeros salen de la MARCA `esCajero`, no del nombre', () => {
  it('`allCajeros` encuentra las cuatro etiquetas del PoS', () => {
    expect(allCajeros(DIAS)).toEqual(
      ['Caja · 388', 'Cajero turno mañana', 'Sin salonero', 'Sistema · 999'].sort(),
    )
  })

  it('el total de la pestaña cuadra con el `cajTotal` del día', () => {
    const nombres = allCajeros(DIAS)
    const totPestana = nombres
      .map(n => aggCajero(n, ['2026-09-07'], DIAS))
      .reduce((s, c) => s + c.total, 0)
    expect(totPestana).toBe(aggGeneral(['2026-09-07'], DIAS, PM_SIN_MATCH).cajTotal)
    expect(totPestana).toBe(105_000)
  })

  it('el delivery viaja por CANAL, ticket a ticket, y no por quién cobró', () => {
    const nombres = allCajeros(DIAS)
    const aggs = nombres.map(n => aggCajero(n, ['2026-09-07'], DIAS))
    expect(aggs.reduce((s, c) => s + c.delivery, 0)).toBe(40_000)
    expect(aggs.reduce((s, c) => s + c.salon, 0)).toBe(65_000)
    // `Caja · 388` tiene delivery propio: filtrando por nombre se perdían ₡20.000.
    expect(aggCajero('Caja · 388', ['2026-09-07'], DIAS).delivery).toBe(20_000)
  })

  it('acota al período: un rango sin días no devuelve cajeros', () => {
    expect(allCajeros(DIAS, [])).toEqual([])
    expect(allCajeros(DIAS, ['2026-01-01'])).toEqual([])
    expect(allCajeros(DIAS, ['2026-09-07']).length).toBe(4)
  })

  it('`esEntradaCajero` distingue el bucket de caja del mesero', () => {
    const d = DIAS['2026-09-07'].saloneros
    expect(esEntradaCajero(d['Caja · 388'])).toBe(true)
    expect(esEntradaCajero(d['MAXO'])).toBe(false)
    expect(esEntradaCajero(undefined)).toBe(false)
  })
})

describe('B · el ₡ de comida/bebida sale de la familia, no del ProductMap', () => {
  it('con el ProductMap vacío, la cuenta vieja daba ₡0 con unidades > 0', () => {
    const gen = aggGeneral(['2026-09-07'], DIAS, PM_SIN_MATCH)
    const viejoCom = Object.entries(gen.prods)
      .reduce((s, [n, v]) => s + ((PM_SIN_MATCH as Record<string, { tipo: string }>)[n]?.tipo === 'comida' ? v.m : 0), 0)
    expect(viejoCom).toBe(0)
    expect(gen.iCom).toBe(40)   // …y las unidades sí estaban. El bug, exacto.
  })

  it('`mixPorFamilia` devuelve ₡ coherentes con esas mismas unidades', () => {
    const mix = mixPorFamilia(DIAS, ['2026-09-07'])
    const gen = aggGeneral(['2026-09-07'], DIAS, PM_SIN_MATCH)
    expect(mix.com).toBe(150_000)
    expect(mix.beb).toBe(50_000)
    expect(mix.iCom).toBe(gen.iCom)
    expect(mix.iBeb).toBe(gen.iBeb)
    // Coherencia: si hay unidades, hay plata.
    expect(mix.iCom > 0 && mix.com > 0).toBe(true)
    expect(mix.iBeb > 0 && mix.beb > 0).toBe(true)
  })

  it('NO es la neta del día: la caja no trae desglose comida/bebida', () => {
    const mix = mixPorFamilia(DIAS, ['2026-09-07'])
    const stats = getDayStats(DIAS['2026-09-07'])
    expect(mix.com + mix.beb).toBe(200_000)
    expect(stats.ventaNeta).toBe(305_000)
    expect(mix.com + mix.beb).toBeLessThan(stats.ventaNeta)
  })

  it('un día sin datos da ceros, no NaN', () => {
    expect(mixPorFamilia(DIAS, [])).toEqual({ com: 0, beb: 0, iCom: 0, iBeb: 0 })
    expect(mixPorFamilia(DIAS, ['2026-01-01'])).toEqual({ com: 0, beb: 0, iCom: 0, iBeb: 0 })
  })
})

describe('el total y la neta del día NO se mueven', () => {
  it('`getDayStats` sigue sumando meseros + caja', () => {
    const stats = getDayStats(DIAS['2026-09-07'])
    expect(stats.ventaNeta).toBe(200_000 + 105_000)
    expect(stats.delivery).toBe(40_000)
    expect(stats.salon).toBe(200_000 + 65_000)
  })

  it('`aggGeneral` sigue dando el mismo `totalRest`', () => {
    expect(aggGeneral(['2026-09-07'], DIAS, PM_SIN_MATCH).totalRest).toBe(305_000)
  })
})

// ── Micropase «coherencia C/B»: el mismo root, tres lugares más ──────────────────────────────

describe('el Ratio C/B general se puede derivar del mix por familia', () => {
  it('`aggGeneral.ratioCB` sale en 0 con el ProductMap vacío — por eso no se muestra', () => {
    // No es un bug de `aggGeneral`: es la misma cuenta por `pm[nombre]?.tipo` de siempre, y se
    // deja intacta a propósito (la usan otras pantallas con días del .xls). Lo que cambia es
    // de dónde saca «Hoy» el número que PINTA.
    expect(aggGeneral(['2026-09-07'], DIAS, PM_SIN_MATCH).ratioCB).toBe(0)
  })

  it('el ratio por familia sí tiene valor, y es com ÷ beb del mismo mix de las tarjetas', () => {
    const mix = mixPorFamilia(DIAS, ['2026-09-07'])
    expect(mix.com / mix.beb).toBe(3)   // 150.000 ÷ 50.000
  })

  it('la tabla por salonero YA era por familia: `aggSalonero.ratioCB` no se toca', () => {
    // `aggSalonero` acumula `com`/`beb` desde `SaloneroDay`, que ya viene partido por familia.
    // Su ratio coincide con el general por familia — que es justamente el punto de coherencia.
    expect(aggSalonero('MAXO', ['2026-09-07'], DIAS, PM_SIN_MATCH).ratioCB).toBe(3)
  })
})

describe('`allSaloneros` excluye la caja por MARCA, no por nombre', () => {
  it('los buckets de caja del PoS ya no entran a la lista de meseros', () => {
    expect(allSaloneros(DIAS)).toEqual(['MAXO'])
  })

  it('las etiquetas del .xls también quedan afuera (no hay regresión del caso viejo)', () => {
    const soloXls: DiasMap = {
      '2026-09-07': dia({
        MAXO: sal({ total: 100_000 }),
        'Cajero turno mañana': caj({ total: 50_000 }),
      }),
    }
    expect(allSaloneros(soloXls)).toEqual(['MAXO'])
  })

  it('las filas que se van eran fantasmas: `aggSalonero` ya les daba cero', () => {
    // Es lo que hace que sacarlas NO mueva ninguna cifra: las pantallas que las listaban
    // filtran por `total > 0` o `days > 0`, así que nunca aportaron nada.
    const fantasma = aggSalonero('Caja · 388', ['2026-09-07'], DIAS, PM_SIN_MATCH)
    expect(fantasma.total).toBe(0)
    expect(fantasma.days).toBe(0)
  })

  it('sacarlas no mueve el total ni la neta del día', () => {
    expect(getDayStats(DIAS['2026-09-07']).ventaNeta).toBe(305_000)
    expect(aggGeneral(['2026-09-07'], DIAS, PM_SIN_MATCH).totalRest).toBe(305_000)
  })
})
