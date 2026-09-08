// @vitest-environment happy-dom
//
// «Hoy», en el DOM: las tarjetas Comidas/Bebidas con el ₡ por FAMILIA del PoS.
//
// El caso que fija este test es el de staging: los días vienen del PoS y el `ProductMap` está
// vacío para esos nombres. Antes las dos tarjetas mostraban ₡0 con las unidades > 0 al lado —
// las unidades salen de la familia, la plata salía del `ProductMap`. Ahora las dos salen del
// mismo desglose, y como la caja no lo trae, se rotula «no neta».
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: null }) }))
vi.mock('../../shared/api/cash', () => ({
  getOpenCashSession: vi.fn(async () => null),
  createCashMovement:  vi.fn(async () => undefined),
}))

import VentasHoy from './VentasHoy'
import type { CajeroDay, DiasMap, Meta, SaloneroDay } from '../../shared/types/ventas'
import { aggGeneral, fi, getDayStats } from './ventasUtils'

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

/** Nombres de producto tal como llegan de `pos_ndf_lineas`: en MAYÚSCULAS y sin ProductMap. */
const DIAS: DiasMap = {
  '2026-09-07': {
    fileName: 'ndf 2026-09-07', uploadedAt: '2026-09-08',
    saloneros: {
      MAXO: sal({
        pax: 20, total: 200_000, com: 150_000, beb: 50_000, iCom: 40, iBeb: 25,
        iva: 26_000, serv: 20_000,
        prods: [['ROLL SATORI', 40, 150_000], ['IMPERIAL', 25, 50_000]],
      }),
      'Caja · 388': caj({ pax: 4, total: 105_000, salon: 65_000, delivery: 40_000, ordenes: 7 }),
    },
  },
}

const texto = () => (document.body.textContent ?? '').replace(/\s/g, ' ')
const plano = (s: string) => s.replace(/\s/g, ' ')

describe('VentasHoy · tarjetas Comidas / Bebidas', () => {
  it('muestra ₡ por familia aunque el ProductMap no conozca los productos del PoS', () => {
    render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    expect(texto()).toContain(`Comidas${plano(fi(150_000))}`)
    expect(texto()).toContain(`Bebidas${plano(fi(50_000))}`)
    // Y NUNCA ₡0 con unidades al lado, que era el síntoma.
    expect(texto()).not.toContain(`Comidas${plano(fi(0))}`)
    expect(texto()).not.toContain(`Bebidas${plano(fi(0))}`)
  })

  it('rotula «no neta» en las dos tarjetas, junto a las unidades', () => {
    render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    expect(texto()).toContain('40 platos · no neta')
    expect(texto()).toContain('25 bebidas · no neta')
  })

  it('el total y la neta del día NO se mueven', () => {
    render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    // La neta del día sigue saliendo de `getDayStats` — meseros + caja, sin tocar.
    expect(getDayStats(DIAS['2026-09-07']).ventaNeta).toBe(305_000)
    // Y el KPI de meseros de la cabecera sigue valiendo lo mismo que antes del cambio.
    expect(texto()).toContain(`Ventas Salón${plano(fi(200_000))}`)
    // «no neta» no es decorativo: comida + bebida (₡200.000) < neta del día (₡305.000).
    expect(150_000 + 50_000).toBeLessThan(getDayStats(DIAS['2026-09-07']).ventaNeta)
  })
})

// ── Micropase «coherencia C/B» ──────────────────────────────────────────────────────────────

describe('VentasHoy · Ratio C/B (₡) en la misma base que las tarjetas', () => {
  it('muestra el ratio por familia, no el 0.00:1 del ProductMap vacío', () => {
    // `aggGeneral` sigue devolviendo 0 —no se tocó—, pero la pantalla ya no pinta ESE número.
    expect(aggGeneral(['2026-09-07'], DIAS, {}).ratioCB).toBe(0)
    render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    expect(texto()).toContain('Ratio C/B (₡)3.00:1')   // 150.000 ÷ 50.000
    expect(texto()).not.toContain('Ratio C/B (₡)0.00:1')
  })

  it('el ratio cuadra con las tarjetas Comidas/Bebidas que ya estaban corregidas', () => {
    render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    // Las dos tarjetas y el ratio salen del MISMO mix por familia: 150.000 / 50.000 = 3.00.
    expect(texto()).toContain(`Comidas${plano(fi(150_000))}`)
    expect(texto()).toContain(`Bebidas${plano(fi(50_000))}`)
    expect(texto()).toContain('3.00:1')
  })
})

describe('VentasHoy · el bloque «Restaurante» no se esconde', () => {
  it('muestra «Venta Total Restaurante» aunque la caja se llame `Caja · 388`', () => {
    // `Caja · 388` no está en `CAJEROS_IDS`: con la detección por nombre este bloque entero
    // —y con él la NETA DEL DÍA— desaparecía de la pantalla.
    render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    expect(texto()).toContain(`Venta Total Restaurante${plano(fi(305_000))}`)
    expect(texto()).toContain(plano(fi(305_000)))
  })

  it('el bucket de caja aparece con su propio KPI, salón y delivery', () => {
    render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    expect(texto()).toContain(`Caja · 388${plano(fi(105_000))}`)
    expect(texto()).toContain(`S: ${plano(fi(65_000))} · D: ${plano(fi(40_000))}`)
  })

  it('sin ningún bucket de caja el bloque sigue sin aparecer', () => {
    const soloMeseros: DiasMap = {
      '2026-09-07': {
        fileName: 'ndf', uploadedAt: '2026-09-08',
        saloneros: { MAXO: sal({ pax: 20, total: 200_000, com: 150_000, beb: 50_000, iCom: 40, iBeb: 25 }) },
      },
    }
    render(<VentasHoy dias={soloMeseros} pm={{}} metas={METAS} />)
    expect(texto()).not.toContain('Venta Total Restaurante')
  })
})

describe('VentasHoy · el ranking no lista buckets de caja', () => {
  it('`Caja · 388` no aparece como una fila de mesero en ₡0', () => {
    render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    const t = texto()
    const ranking = t.slice(t.indexOf('Ranking del día'), t.indexOf('Top Productos'))
    expect(ranking).toContain('MAXO')
    expect(ranking).not.toContain('Caja · 388')
    expect(ranking).not.toContain(plano(fi(0)))
  })
})
