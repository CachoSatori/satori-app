// El PAX de los buckets de CAJA tiene que contar en el pax del día.
//
// ── El bug ─────────────────────────────────────────────────────────────────────────────────
// En la Paridad, el PAX del PoS salía ~9% por debajo del xls. No era un problema de dato ni de
// definición: el crudo `pos_ndf_tickets.pax_articulo` sumaba 4.617, idéntico al xls. Lo perdía
// `getDayStats`: al recorrer los buckets del día, la rama `esCajero` sumaba la PLATA
// (`total`, `salon`, `iva`, `serv`) pero NO el pax. Y en el PoS hay tickets de SALÓN
// registrados bajo un login de caja (111/222/388) — sus comensales existieron igual.
//
// El pax se perdía en dos escalones y los dos están arreglados:
//   1. `armarDia` acumulaba `e.pax` para los buckets de caja pero NO lo copiaba al `CajeroDay`,
//      que ni siquiera tenía el campo.
//   2. `getDayStats` / `aggGeneral` no lo sumaban.
//
// ── Lo que NO cambia ───────────────────────────────────────────────────────────────────────
// Ni una cifra de plata, y ningún día del xls: `xlsParser` nunca llenó `pax` en un bucket de
// caja, así que del lado xls el campo llega `undefined` y el `?? 0` lo deja exactamente como
// estaba.
import { describe, it, expect } from 'vitest'

import type { CajeroDay, DiaData, SaloneroDay } from '../../shared/types/ventas'
import { aggGeneral, getDayStats } from './ventasUtils'

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

/** Un día del PoS: 20 comensales del mesero + 4 de un ticket de salón cobrado por la caja. */
const DIA_POS = dia({
  MAXO:         sal({ pax: 20, total: 200_000, iva: 26_000, serv: 20_000, iCom: 40, iBeb: 10 }),
  'Caja (222)': caj({ pax: 4, total: 50_000, salon: 40_000, delivery: 10_000, iva: 6_500, serv: 4_000, ordenes: 3 }),
})

describe('getDayStats — el pax de los buckets de caja cuenta', () => {
  it('suma los comensales de TODOS los tickets, no solo los de meseros', () => {
    // Ésta es LA aserción del bug: antes del fix daba 20 y el día informaba 4 comensales menos.
    expect(getDayStats(DIA_POS).pax).toBe(24)
  })

  it('la plata no se mueve ni un colón', () => {
    const s = getDayStats(DIA_POS)
    expect(s.ventaNeta).toBe(250_000)         // 200.000 + 50.000
    expect(s.iva).toBe(32_500)                // 26.000 + 6.500
    expect(s.serv).toBe(24_000)               // 20.000 + 4.000
    expect(s.ventaBruta).toBe(306_500)
    expect(s.salon).toBe(240_000)             // 200.000 del mesero + 40.000 de salón de caja
    expect(s.delivery).toBe(10_000)
  })

  it('el prom/pax del día ya no está inflado', () => {
    // El numerador (`salon`) SIEMPRE incluyó la parte de salón de caja; el denominador no
    // incluía su gente. El promedio salía alto por un pax corto, no por vender más.
    expect(getDayStats(DIA_POS).promPax).toBe(240_000 / 24)
  })

  it('la caja sigue fuera del ranking: no aparece en `saloneroNames`', () => {
    expect(getDayStats(DIA_POS).saloneroNames).toEqual(['MAXO'])
  })

  it('un día del xls (bucket de caja SIN `pax`) queda exactamente igual', () => {
    const delXls = dia({
      ANA:    sal({ pax: 10, total: 100_000 }),
      CAJERA: caj({ total: 30_000, salon: 30_000 }),   // sin `pax`, como lo arma `xlsParser`
    })
    const s = getDayStats(delXls)
    expect(s.pax).toBe(10)
    expect(s.ventaNeta).toBe(130_000)
    expect(s.promPax).toBe(130_000 / 10)
  })

  it('sin buckets de caja el resultado es el de siempre', () => {
    expect(getDayStats(dia({ ANA: sal({ pax: 6, total: 60_000 }) })).pax).toBe(6)
  })
})

describe('aggGeneral — el pax del día es el de todos; el benchmark del mesero, no', () => {
  const dias = { '2026-09-04': DIA_POS }

  it('`pax` cuenta también los comensales de caja', () => {
    expect(aggGeneral(['2026-09-04'], dias, {}).pax).toBe(24)
  })

  it('`paxSaloneros` deja a la vista el denominador de los ratios', () => {
    expect(aggGeneral(['2026-09-04'], dias, {}).paxSaloneros).toBe(20)
  })

  it('`promPax` y `bebPax` NO se mueven: son el benchmark contra el que se mide un mesero', () => {
    // `total` e `iBeb` son de meseros. Meter el pax de caja abajo y dejar su plata afuera
    // arriba desinflaría el benchmark y movería las evaluaciones («vs general», la racha).
    const g = aggGeneral(['2026-09-04'], dias, {})
    expect(g.promPax).toBe(200_000 / 20)
    expect(g.bebPax).toBe(10 / 20)
  })

  it('la plata de aggGeneral queda igual', () => {
    const g = aggGeneral(['2026-09-04'], dias, {})
    expect(g.total).toBe(200_000)
    expect(g.cajTotal).toBe(50_000)
    expect(g.cajSalon).toBe(40_000)
    expect(g.cajDelivery).toBe(10_000)
    expect(g.totalRest).toBe(250_000)
    expect(g.salon).toBe(240_000)
  })

  it('un día del xls no se mueve: sin `pax` de caja, `pax` == `paxSaloneros`', () => {
    const delXls = { d: dia({ ANA: sal({ pax: 10, total: 100_000 }), CAJERA: caj({ total: 30_000 }) }) }
    const g = aggGeneral(['d'], delXls, {})
    expect(g.pax).toBe(10)
    expect(g.paxSaloneros).toBe(10)
    expect(g.promPax).toBe(100_000 / 10)
  })
})

describe('getDayStats y aggGeneral informan el MISMO pax del día', () => {
  it('las dos vías dan 24, que es lo que pide la Paridad', () => {
    // La Paridad lee el pax de `getDayStats`; el TOTAL del rango, de las dos. Si discreparan,
    // el reporte se marcaría a sí mismo.
    expect(getDayStats(DIA_POS).pax).toBe(aggGeneral(['d'], { d: DIA_POS }, {}).pax)
  })
})
