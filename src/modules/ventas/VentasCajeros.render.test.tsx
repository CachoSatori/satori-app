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

// Los baldes que produce `claveNoMesero`: dos turnos + los dos que NO suman al total.
const DIAS_POS: DiasMap = {
  [DIA_1]: dia({
    MAXO: sal({ pax: 20, total: 200_000 }),
    'Cajero turno mañana': caj({ total: 60_000, salon: 0, delivery: 60_000, ordenes: 4 }),
    'Cajero turno tarde':  caj({ total: 30_000, salon: 0, delivery: 30_000, ordenes: 2 }),
    'Salón sin mesero':         caj({ total: 25_000, salon: 25_000, delivery: 0, ordenes: 3 }),
    'Sistema y otros':     caj({ total:  5_000, salon: 0, delivery: 5_000, ordenes: 1 }),
  }),
}

describe('VentasCajeros · render', () => {
  it('muestra las DOS tarjetas de turno, y ninguna tarjeta por login', () => {
    render(<VentasCajeros dias={DIAS_POS} />)
    expect(screen.getAllByText('Cajero turno mañana').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cajero turno tarde').length).toBeGreaterThan(0)
    // La etiqueta del 222 nunca dice «noche».
    expect(texto()).not.toMatch(/noche/i)
    // Y ya no hay tarjetas por login ni el balde de salón sin mesero.
    expect(texto()).not.toContain('Caja · ')
    expect(texto()).not.toContain('Sin salonero')
    expect(texto()).not.toContain('Salón sin mesero')
  })

  it('Total Cajeros = mañana + tarde, sin «Salón sin mesero» ni «Sistema y otros»', () => {
    render(<VentasCajeros dias={DIAS_POS} />)
    expect(texto()).toContain(`Total cajeros${plano(fi(90_000))}`)   // 60.000 + 30.000
    expect(texto()).toContain(`Delivery${plano(fi(90_000))}`)
    // Los ₡25.000 de «Salón sin mesero» NO entran al total.
    expect(texto()).not.toContain(`Total cajeros${plano(fi(115_000))}`)
  })

  it('«Sistema y otros» se ve, pero avisando que no suma al total', () => {
    render(<VentasCajeros dias={DIAS_POS} />)
    expect(texto()).toContain('Sistema y otros')
    expect(texto()).toContain(plano(fi(5_000)))
    expect(texto()).toContain('no suma al Total Cajeros')
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
