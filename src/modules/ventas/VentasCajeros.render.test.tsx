// @vitest-environment happy-dom
//
// Pase A, en el DOM: la pestaña Cajeros lee el PoS y su vacío es honesto.
//
// Dos cosas que el dueño ve y que antes mentían:
//   1. El vacío decía «Los cajeros aparecen cuando cargás archivos XLS con ventas de delivery».
//      Los cajeros ya NO salen de un XLS: los arma `armarDia` desde `pos_ndf_*`, con el canal
//      real de cada ticket. Ese texto mandaba al usuario a buscar un archivo que no existe.
//   2. El vacío se comía la barra de rango. Como el vacío depende del PERÍODO elegido, el
//      usuario quedaba encerrado en un rango sin datos y sin controles para ampliarlo.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { CajeroDay, DiasMap, SaloneroDay } from '../../shared/types/ventas'
import VentasCajeros from './VentasCajeros'
// El monto se compara con el MISMO formateador que usa la app (`₡ 200 000`, con su espacio
// fino): el test mira el cableado, no cómo se escribe un número.
import { fi } from './ventasUtils'

const caj = (o: Partial<CajeroDay>): CajeroDay => ({
  esCajero: true, total: 0, salon: 0, delivery: 0, iva: 0, serv: 0,
  ordenes: 0, ticketProm: 0, prods: [], ...o,
})

const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
})

/** El preset por defecto es «Mes», así que la jornada tiene que caer en el mes en curso. */
const HOY = new Date()
const ESTE_MES = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, '0')}`
const JORNADA = `${ESTE_MES}-01`

const DIAS_POS: DiasMap = {
  [JORNADA]: {
    fileName: `ndf ${JORNADA}`, uploadedAt: JORNADA,
    saloneros: {
      MAXO:                 sal({ pax: 10, total: 200_000 }),
      'Cajero turno tarde': caj({ total: 150_000, salon: 90_000, delivery: 60_000, ordenes: 10 }),
      // El bucket que el filtro por NOMBRE perdía: el PoS lo nombra por login.
      'Caja · 388':         caj({ total: 50_000, salon: 20_000, delivery: 30_000, ordenes: 4 }),
    },
  },
}

describe('VentasCajeros · vacío honesto', () => {
  it('sin ventas cargadas NO menciona archivos XLS', () => {
    render(<VentasCajeros dias={{}} />)
    expect(screen.getByText('Sin ventas cargadas')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/XLS/i)
  })

  it('el vacío deja la barra de rango a mano, para poder ampliar el período', () => {
    render(<VentasCajeros dias={{}} />)
    expect(screen.getByRole('button', { name: 'Todo' })).toBeTruthy()
  })

  it('con ventas pero sin caja en el período, lo dice por lo que es', () => {
    render(<VentasCajeros dias={{ [JORNADA]: { fileName: 'x', uploadedAt: JORNADA, saloneros: { MAXO: sal({ total: 100 }) } } }} />)
    expect(screen.getByText('Sin movimientos de caja en el período')).toBeTruthy()
  })
})

describe('VentasCajeros · lee los buckets del PoS', () => {
  it('muestra también el bucket que el PoS nombra por login, y no al mesero', () => {
    render(<VentasCajeros dias={DIAS_POS} />)
    expect(screen.getAllByText('Cajero turno tarde').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Caja · 388').length).toBeGreaterThan(0)
    expect(screen.queryByText('MAXO')).toBeNull()
  })

  it('el «Total cajeros» suma los DOS buckets — antes se perdían ₡50.000', () => {
    render(<VentasCajeros dias={DIAS_POS} />)
    const kpi = screen.getByText('Total cajeros').parentElement!
    expect(kpi.textContent).toContain(fi(200_000))   // 150.000 + 50.000
  })
})
