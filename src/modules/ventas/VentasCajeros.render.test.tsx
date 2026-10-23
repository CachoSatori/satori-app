// @vitest-environment happy-dom
//
// «Cajeros», en el DOM: que muestre los buckets del PoS y que el vacío sea honesto.
//
// Lo que esta pantalla NO puede hacer: decir «cargá archivos XLS» cuando la fuente es el PoS,
// ni esconder la barra de rango porque el período elegido esté vacío (dejaría al usuario sin
// forma de cambiarlo).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// La lente por línea se lee del PoS (`saloneroLentesDatos`). Acá se mockea la I/O para no
// arrastrar el cliente de Supabase al test de render; lo que se prueba es el cableado: que el
// botón llame con el rango de la pantalla y que lo leído se pinte con `BloquesLentes`.
const getLentesDesdePos = vi.fn()
vi.mock('./saloneroLentesDatos', () => ({ getLentesDesdePos: (...a: unknown[]) => getLentesDesdePos(...a) }))

import VentasCajeros from './VentasCajeros'
import type { CajeroDay, DiaData, DiasMap, SaloneroDay } from '../../shared/types/ventas'
import { fi } from './ventasUtils'
import { calcularLentes } from './saloneroLentes'

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

// Los baldes que produce `claveNoMesero`: dos turnos + los tres que NO suman al total.
const DIAS_POS: DiasMap = {
  [DIA_1]: dia({
    MAXO: sal({ pax: 20, total: 200_000 }),
    'Cajero turno mañana': caj({ total: 60_000, salon: 0, delivery: 60_000, ordenes: 4 }),
    'Cajero turno tarde':  caj({ total: 30_000, salon: 0, delivery: 30_000, ordenes: 2 }),
    'Cajero-salón':        caj({ total: 17_000, salon: 17_000, delivery: 0, ordenes: 2 }),
    'Salón sin mesero':    caj({ total: 25_000, salon: 25_000, delivery: 0, ordenes: 3 }),
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

  it('Total Cajeros = mañana + tarde, sin «Cajero-salón», «Salón sin mesero» ni «Sistema y otros»', () => {
    render(<VentasCajeros dias={DIAS_POS} />)
    expect(texto()).toContain(`Total cajeros${plano(fi(90_000))}`)   // 60.000 + 30.000
    expect(texto()).toContain(`Delivery${plano(fi(90_000))}`)
    // Ni los ₡25.000 de «Salón sin mesero» ni los ₡17.000 de «Cajero-salón» entran al total.
    expect(texto()).not.toContain(`Total cajeros${plano(fi(115_000))}`)
    expect(texto()).not.toContain(`Total cajeros${plano(fi(107_000))}`)
    expect(texto()).not.toContain(`Total cajeros${plano(fi(132_000))}`)
  })

  it('«Cajero-salón» tiene tarjeta propia, con su plata, y avisa que no suma al total', () => {
    render(<VentasCajeros dias={DIAS_POS} />)
    expect(screen.getAllByText('Cajero-salón').length).toBeGreaterThan(0)
    expect(texto()).toContain(plano(fi(17_000)))
    // No es una columna del detalle diario (que es solo mañana/tarde) ni un turno.
    expect(screen.queryByRole('columnheader', { name: /cajero-salón/i })).toBeNull()
    expect(texto()).toMatch(/Cajero-salón.*no suma al Total Cajeros/)
  })

  it('la lente por línea se lee a pedido, con el rango de la pantalla, y se pinta acá', async () => {
    // Una factura del rango, partida entre dos personas: la lente A tiene que listarlas.
    getLentesDesdePos.mockResolvedValueOnce({
      lentes: calcularLentes(
        [{ id: 'f1', cajero_login: '111', valor_servido_crc: 9_000, iva_crc: 0, servicio_crc: 0, pax: 2, mesa: '4' }],
        [
          { ticket_id: 'f1', usuario_registra: '026', monto: 5_000, codigo_producto: 'A', cantidad: 1, familia: 2 },
          { ticket_id: 'f1', usuario_registra: '032', monto: 4_000, codigo_producto: 'B', cantidad: 1, familia: 2 },
        ],
      ),
      nombres: { '026': 'Maximiliano', '032': 'Gonzalo' },
      tickets: 1,
    })
    render(<VentasCajeros dias={DIAS_POS} />)
    // Antes de tocar el botón no se lee nada: barrer el PoS cuesta.
    expect(getLentesDesdePos).not.toHaveBeenCalled()
    expect(texto()).not.toContain('Lente A')

    fireEvent.click(screen.getByRole('button', { name: /leer lente por línea/i }))
    await waitFor(() => expect(texto()).toContain('Lente A'))

    // Se llamó UNA vez, con el rango vigente de la pantalla (preset «Mes» → del 1 a hoy).
    expect(getLentesDesdePos).toHaveBeenCalledTimes(1)
    const [rango] = getLentesDesdePos.mock.calls[0] as [{ desde: string; hasta: string }]
    expect(rango.desde).toBe(DIA_1)
    expect(rango.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Y las dos personas de la factura partida aparecen, cada una con lo suyo.
    expect(texto()).toContain('Maximiliano')
    expect(texto()).toContain('Gonzalo')
    expect(texto()).toContain(plano(fi(5_000)))
    expect(texto()).toContain(plano(fi(4_000)))
    // El aviso de que las lentes no se suman con las tarjetas sigue en pantalla.
    expect(texto()).toContain('No se suma')
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
