// @vitest-environment happy-dom
//
// El bloque «venta propia por línea» dentro de la tarjeta de Saloneros, en el DOM.
//
// Lo que se fija acá es lo que NO puede pasar: que se lea como el desglose del total de la
// tarjeta. Son dos ejes distintos sobre la misma neta —la tarjeta acredita la factura entera al
// salonero del pedido, la lente reparte línea por línea— y sumarlos contaría dos veces toda mesa
// compartida. Por eso el bloque va rotulado, con su propio total, y avisa que no se suman.
//
// Lo otro que se fija es el COSTO: la lectura del PoS no se dispara al entrar a la pestaña, solo
// al abrir una tarjeta. Saloneros hoy pinta al instante sobre el `dias` que ya está en memoria y
// eso no se puede romper.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: null }) }))

const H = vi.hoisted(() => ({ getLentesDesdePos: vi.fn() }))
vi.mock('./saloneroLentesDatos', () => ({ getLentesDesdePos: H.getLentesDesdePos }))

import VentasSaloneros from './VentasSaloneros'
import type { DiasMap, Meta, SaloneroDay } from '../../shared/types/ventas'
import { calcularLentes, type LineaLente, type TicketLente } from './saloneroLentes'

const sal = (o: Partial<SaloneroDay>): SaloneroDay => ({
  pax: 0, total: 0, com: 0, beb: 0, iCom: 0, iBeb: 0, iva: 0, serv: 0,
  promPax: 0, promPlato: 0, promBebida: 0, ratioCB: 0, ratioU: 0, bebPax: 0, prods: [], ...o,
})

const METAS: Meta = {
  restaurante: {}, margen: {},
  global: { promPax: 15_000, bebPax: 1.2, ratioCB: 3.0, ticketItem: 7_500, ventas: 800_000 },
  salMetas: {},
}

const FECHA = '2026-09-07'

/** La TARJETA acredita la factura entera a MAXO: ₡10.000. */
const DIAS: DiasMap = {
  [FECHA]: {
    fileName: 'ndf', uploadedAt: '2026-09-08',
    saloneros: {
      MAXO: sal({
        pax: 2, total: 10_000, com: 7_000, beb: 3_000, iCom: 2, iBeb: 1,
        prods: [['ROLL SATORI', 2, 7_000], ['IMPERIAL', 1, 3_000]],
      }),
    },
  },
}

/** …pero de esa factura, GONZA comandó ₡4.000. La lente reparte 6.000 / 4.000. */
const ticket = (o: Partial<TicketLente> = {}): TicketLente => ({
  id: 'f1', cajero_login: '111', valor_servido_crc: 10_000,
  iva_crc: 0, servicio_crc: 0, pax: 2, mesa: '7', ...o,
})
const linea = (o: Partial<LineaLente> = {}): LineaLente => ({
  ticket_id: 'f1', usuario_registra: '026', monto: 6_000,
  codigo_producto: 'X1', cantidad: 1, familia: 3, ...o,
})

const LENTES = {
  lentes: calcularLentes([ticket()], [
    linea({ usuario_registra: '026', monto: 6_000 }),
    linea({ usuario_registra: '032', monto: 4_000, codigo_producto: 'X2' }),
    linea({ usuario_registra: '026', monto: 0, codigo_producto: '677', familia: 19, cantidad: 2 }),
  ]),
  nombres: { '026': 'MAXO', '032': 'GONZA' },
  tickets: 1,
}

const texto = () => (document.body.textContent ?? '').replace(/\s/g, ' ')

beforeEach(() => {
  H.getLentesDesdePos.mockReset()
  H.getLentesDesdePos.mockResolvedValue(LENTES)
})

describe('VentasSaloneros · bloque «venta propia por línea»', () => {
  it('NO lee el PoS al entrar a la pestaña — la pestaña sigue siendo instantánea', () => {
    render(<VentasSaloneros dias={DIAS} pm={{}} metas={METAS} />)
    expect(H.getLentesDesdePos).not.toHaveBeenCalled()
  })

  it('lee recién al abrir una tarjeta, y una sola vez', async () => {
    render(<VentasSaloneros dias={DIAS} pm={{}} metas={METAS} />)
    fireEvent.click(screen.getByText('MAXO'))
    await waitFor(() => expect(H.getLentesDesdePos).toHaveBeenCalledTimes(1))
  })

  it('muestra el turno y el TOTAL PROPIO del bloque, no el de la tarjeta', async () => {
    render(<VentasSaloneros dias={DIAS} pm={{}} metas={METAS} />)
    fireEvent.click(screen.getByText('MAXO'))
    await waitFor(() => expect(texto()).toContain('Total venta propia'))
    // La tarjeta dice ₡10.000 (la factura entera). La venta propia de MAXO es ₡6.000, porque
    // ₡4.000 los comandó GONZA. Los dos números conviven en pantalla, y son distintos.
    expect(texto()).toContain('Venta propia · por línea')
    expect(texto()).toContain('Mañana · almuerzo')
    expect(texto()).toMatch(/Total venta propia.*6[  ]000/)
  })

  it('dice explícitamente que NO es el desglose y que no se suman', async () => {
    render(<VentasSaloneros dias={DIAS} pm={{}} metas={METAS} />)
    fireEvent.click(screen.getByText('MAXO'))
    await waitFor(() => expect(texto()).toContain('Total venta propia'))
    expect(texto()).toContain('No es el desglose')
    expect(texto()).toContain('no se suman')
    expect(texto()).toContain('otra lectura')
  })

  it('una persona que no está en la lente NO muestra ₡0: dice que no aparece', async () => {
    const otro: DiasMap = {
      [FECHA]: {
        fileName: 'ndf', uploadedAt: '2026-09-08',
        saloneros: { ROSAURA: sal({ pax: 4, total: 20_000, com: 15_000, beb: 5_000, iCom: 4, iBeb: 2 }) },
      },
    }
    render(<VentasSaloneros dias={otro} pm={{}} metas={METAS} />)
    fireEvent.click(screen.getByText('ROSAURA'))
    await waitFor(() => expect(texto()).toContain('No aparece en la lente por línea'))
    expect(texto()).toContain('No es lo mismo que')
    expect(texto()).not.toContain('Total venta propia')
  })

  it('si las líneas no cuadran con las facturas, lo dice en vez de taparlo', async () => {
    H.getLentesDesdePos.mockResolvedValue({
      ...LENTES,
      lentes: { ...LENTES.lentes, descuadreCrc: 1_500 },
    })
    render(<VentasSaloneros dias={DIAS} pm={{}} metas={METAS} />)
    fireEvent.click(screen.getByText('MAXO'))
    await waitFor(() => expect(texto()).toContain('no suman lo que dicen las facturas'))
  })
})
