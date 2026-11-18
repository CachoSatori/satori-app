// @vitest-environment happy-dom
//
// «Hoy» con la cuenta del día de la opción A (18-nov): «Venta Total Restaurante», «Salón», «Delivery», el mensaje
// 📤 y lo que escribe «→ Caja» salen del MISMO número (un redondeo del crudo del día, `getDayStats`), no de la
// suma por persona. Datos ficticios armados para que la suma por persona difiera ₡2 del total del día.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u-owner', role: 'owner' } }) }))
const cash = vi.hoisted(() => ({
  getOpenCashSession: vi.fn(async () => ({ id: 'ses-1', shift_type: 'manana', session_date: '2026-07-01' })),
  createCashMovement:  vi.fn<(m: Record<string, unknown>) => Promise<undefined>>(async () => undefined),
}))
vi.mock('../../shared/api/cash', () => cash)

import VentasHoy from './VentasHoy'
import { armarDia } from './ventasEnVivoDatos'
import { aggGeneral, fi, getDayStats } from './ventasUtils'
import type { TicketNdfConId } from '../../shared/api/posNdf'
import type { Meta } from '../../shared/types/ventas'

const ticket = (over: Partial<TicketNdfConId>): TicketNdfConId => ({
  id: 't1', numero_factura: '5001', estado: 'C', fecha_registra: '2026-07-01T19:42:07-06:00',
  fecha_cierra: null, cajero_login: '222',
  canal: 'salon', mesa: null, salonero_login: '026', registrado_por: 'salonero', turno: 'noche',
  con_servicio: true, servicio_crc: 0, total_crc: 0, valor_servido_crc: 0,
  iva_crc: 0, regalia_crc: 0, descuento_crc: 0, clase_ingreso: 'cobrada',
  pax: 2, pax_nativo: 2, pax_articulo: 2, pax_alerta: 'ok', ...over,
})

// Fecha ANTES del corte del pozo y reloj fijado en ESE día (de noche en CR, 23:30 = 05:30 UTC del siguiente):
// «→ Caja» solo escribe la venta de la jornada en curso, con el turno abierto de ese mismo día (ver `aCaja.ts`).
const FECHA = '2026-07-01'
const DIA = armarDia(FECHA, [
  ticket({ id: 'a', numero_factura: '1', salonero_login: '026', valor_servido_crc: 1000.5 }),
  ticket({ id: 'b', numero_factura: '2', salonero_login: '027', valor_servido_crc: 1000.5 }),
  ticket({ id: 'c', numero_factura: '3', salonero_login: '028', valor_servido_crc: 1000.5 }),
  ticket({ id: 'd', numero_factura: '4', salonero_login: null, registrado_por: 'cajero', cajero_login: '111',
    canal: 'delivery', valor_servido_crc: 500.5 }),
], [], '2026-07-02', { '026': 'MESERO_A', '027': 'MESERO_B', '028': 'MESERO_C' }).dia
const DIAS = { [FECHA]: DIA }
const METAS: Meta = {
  restaurante: {}, margen: {},
  global: { promPax: 15_000, bebPax: 1.2, ratioCB: 3.0, ticketItem: 7_500, ventas: 800_000 },
  salMetas: {},
}
const plano = (s: string) => s.replace(/\s/g, ' ')
const texto = () => plano(document.body.textContent ?? '')

describe('VentasHoy · las cifras del día salen de un solo redondeo (opción A)', () => {
  beforeEach(() => {
    cash.createCashMovement.mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-02T05:30:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('el caso muerde: la suma por persona daba ₡2 más que el total del día', () => {
    const s = getDayStats(DIA), g = aggGeneral([FECHA], DIAS, {})
    expect(s).toMatchObject({ ventaNeta: 3502, salon: 3001, delivery: 501 })
    expect(g.totalRest).toBe(3504)
    expect(g.total + g.cajSalon).toBe(3003)
  })

  it('«Venta Total Restaurante», «Salón» y «Delivery» = la cuenta del día', () => {
    render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    // En orden, dentro del bloque «Restaurante» (la tarjeta «Ventas Salón» de abajo es la de meseros, por persona).
    expect(texto()).toContain(`Venta Total Restaurante${plano(fi(3502))}Salón${plano(fi(3001))}`)
    expect(texto()).toContain(`Delivery${plano(fi(501))}`)
    expect(texto()).not.toContain(`Venta Total Restaurante${plano(fi(3502))}Salón${plano(fi(3003))}`)
  })

  it('el mensaje 📤 dice la venta del día, no la suma por persona', async () => {
    let compartido = ''
    Object.defineProperty(navigator, 'share', {
      configurable: true, value: async ({ text }: { text: string }) => { compartido = text },
    })
    const { getByText } = render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    fireEvent.click(getByText('📤'))
    await waitFor(() => expect(compartido).not.toBe(''))
    expect(compartido).toContain(`💰 Ventas: *${fi(3502)}*`)
    expect(compartido).toContain(`🛵 Delivery: ${fi(501)}`)
    expect(compartido).not.toContain(fi(3504))
  })

  it('«→ Caja» escribe EXACTAMENTE lo que muestra «Venta Total Restaurante» y su aviso dice lo mismo', async () => {
    const { getByText } = render(<VentasHoy dias={DIAS} pm={{}} metas={METAS} />)
    fireEvent.click(getByText('→ Caja'))
    await waitFor(() => expect(cash.createCashMovement).toHaveBeenCalledTimes(1))
    const mov = cash.createCashMovement.mock.calls[0][0]
    expect(mov.amount_crc).toBe(3502)
    expect(mov.amount_crc).toBe(getDayStats(DIA).ventaNeta)
    await waitFor(() => expect(texto()).toContain(plano(`✓ ₡${(3502).toLocaleString('es-CR')} registrado en Caja`)))
  })
})
