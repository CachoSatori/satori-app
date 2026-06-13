import { describe, it, expect } from 'vitest'
import { renderTicketCobro } from './posTicket'
import { computeTotals } from './posFiscal'

const totals = computeTotals(
  [{ product_name: 'SATORI ROLL', qty: 1, price_final_crc: 7500, modifiers: [], tax_type: 'iva13' }],
  'salon',
)

describe('renderTicketCobro — ticket SIM (SPEC §2 D4)', () => {
  it('incluye encabezado, total y deja claro que NO es factura', () => {
    const txt = renderTicketCobro({
      table: 'Mesa 5', channel: 'salon', pax: 2, salonero: 'Ana', cajero: 'Caja',
      lines: [{ name: 'SATORI ROLL', qty: 1, line_total_crc: 7500 }],
      totals,
      pago: { method: 'efectivo', currency: 'CRC', exchange_rate_used: null, received_crc: 10000, received_usd: 0, change_crc: totals.total >= 10000 ? 0 : 10000 - totals.total },
    })
    expect(txt).toContain('SATORI SUSHI BAR')
    expect(txt).toContain('no es factura')
    expect(txt).toContain('Mesa 5')
    expect(txt).toContain('TOTAL')
    expect(txt).toContain('EFECTIVO')
    expect(txt).toContain('Vuelto')
  })

  it('pago en $ muestra TC usado y total en dólares', () => {
    const txt = renderTicketCobro({
      table: 'Mesa 9', channel: 'salon', pax: 1,
      lines: [{ name: 'SATORI ROLL', qty: 1, line_total_crc: 7500 }],
      totals,
      pago: { method: 'efectivo', currency: 'USD', exchange_rate_used: 510, received_crc: 10200, received_usd: 20, change_crc: 10200 - totals.total },
    })
    expect(txt).toContain('TC usado')
    expect(txt).toContain('₡510/$')
    expect(txt).toContain('Total en $')
    expect(txt).toContain('$20.00')
  })

  it('tarjeta no muestra línea de vuelto', () => {
    const txt = renderTicketCobro({
      table: 'Mesa 3', channel: 'salon', pax: 1,
      lines: [{ name: 'SATORI ROLL', qty: 1, line_total_crc: 7500 }],
      totals,
      pago: { method: 'tarjeta', currency: 'CRC', exchange_rate_used: null, received_crc: 0, received_usd: 0, change_crc: 0 },
    })
    expect(txt).toContain('TARJETA')
    expect(txt).not.toContain('Vuelto')
  })
})
