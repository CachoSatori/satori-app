// @vitest-environment happy-dom
//
// «Cajeros», en el DOM: que muestre los buckets del PoS y que el vacío sea honesto.
//
// Lo que esta pantalla NO puede hacer: decir «cargá archivos XLS» cuando la fuente es el PoS,
// ni esconder la barra de rango porque el período elegido esté vacío (dejaría al usuario sin
// forma de cambiarlo).
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import VentasCajeros from './VentasCajeros'
import type { CajeroDay, DiaData, DiasMap, SaloneroDay } from '../../shared/types/ventas'
import { fi } from './ventasUtils'

/**
 * El texto de la pantalla con los espacios unificados. `fi()` formatea con
 * `toLocaleString('es-CR')`, que separa los miles con un espacio NO rompible; el matcher de
 * testing-library compara contra un espacio normal y nunca cruzaría. Se normalizan los dos
 * lados y se compara sobre el texto plano.
 */
const texto = () => (document.body.textContent ?? '').replace(/\s/g, ' ')
const plano = (s: string) => s.replace(/\s/g, ' ')

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

/** El preset por defecto es «Mes», así que el día tiene que caer en el mes en curso. */
const HOY   = new Date()
const DIA_1 = `${HOY.getFullYear()}-${String(HOY.getMonth() + 1).padStart(2, '0')}-01`

const DIAS_POS: DiasMap = {
  [DIA_1]: dia({
    MAXO: sal({ pax: 20, total: 200_000 }),
    'Cajero turno mañana': caj({ total: 60_000, salon: 40_000, delivery: 20_000, ordenes: 4 }),
    'Caja · 388':          caj({ total: 30_000, salon: 10_000, delivery: 20_000, ordenes: 2 }),
  }),
}

describe('VentasCajeros · render', () => {
  it('lista los buckets del PoS, incluido el que no está en CAJEROS_IDS', () => {
    render(<VentasCajeros dias={DIAS_POS} />)
    expect(screen.getAllByText('Cajero turno mañana').length).toBeGreaterThan(0)
    // `Caja · 388` es el que se perdía: no está en `CAJEROS_IDS`, solo trae la marca `esCajero`.
    expect(screen.getAllByText('Caja · 388').length).toBeGreaterThan(0)
  })

  it('el total y el delivery suman los DOS buckets, con el delivery por canal', () => {
    render(<VentasCajeros dias={DIAS_POS} />)
    expect(texto()).toContain(`Total cajeros${plano(fi(90_000))}`)
    // Delivery por CANAL: ₡20.000 de cada bucket, incluido el que se perdía.
    expect(texto()).toContain(`Delivery${plano(fi(40_000))}`)
  })

  it('sin ningún día con caja: vacío honesto y SIN mención al XLS', () => {
    render(<VentasCajeros dias={{ [DIA_1]: dia({ MAXO: sal({ total: 200_000 }) }) }} />)
    expect(screen.getByText('Sin datos de cajeros')).toBeTruthy()
    expect(texto()).not.toMatch(/XLS/i)
  })

  it('sin datos EN EL PERÍODO: avisa del período y la barra de rango sigue en pantalla', () => {
    // El día con caja existe, pero es de 2023: fuera del preset «Mes».
    render(<VentasCajeros dias={{ '2023-05-04': DIAS_POS[DIA_1] }} />)
    expect(screen.getByText('Sin ventas de caja en el período')).toBeTruthy()
    expect(screen.getByText('Todo')).toBeTruthy()   // los presets siguen ahí
    expect(texto()).not.toMatch(/XLS/i)
  })
})
