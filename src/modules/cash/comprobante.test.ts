// Generador de comprobante compartido (texto WhatsApp). Fija que arma líneas + total + pie como
// espera cada caller (pago normal y liquidación de crédito). El PNG (Canvas) necesita DOM y no se
// testea acá; el texto es determinista (sin fecha de emisión) → oráculo exacto.
import { describe, it, expect } from 'vitest'
import { comprobanteTexto, waNumber, type ComprobanteData } from './comprobante'

describe('comprobante — texto para WhatsApp', () => {
  it('pago normal: título, proveedor, líneas (con nota y subnota de desglose) y total', () => {
    const d: ComprobanteData = {
      tituloTexto: 'Comprobante de pago',
      tituloPNG: 'Comprobante de pago a proveedor',
      proveedor: 'Pescados del Pacífico',
      lineas: [
        { fecha: '2026-07-05', nota: 'Factura 12', monto: '₡30 000' },
        { fecha: '2026-07-06', nota: 'Factura 13', monto: '₡7 000', subnotaTexto: 'facturado ₡10 000 − crédito ₡3 000 = pagado ₡7 000' },
      ],
      totalTexto: '₡37 000',
      totalPNG: '₡37 000',
    }
    expect(comprobanteTexto(d)).toBe(
      '*Satori Sushi Bar* — Comprobante de pago\n' +
      'Pescados del Pacífico\n\n' +
      '• 2026-07-05  ₡30 000  Factura 12\n' +
      '• 2026-07-06  ₡7 000  Factura 13\n' +
      '    (facturado ₡10 000 − crédito ₡3 000 = pagado ₡7 000)\n\n' +
      'Total: ₡37 000',
    )
  })

  it('liquidación de crédito: líneas saldada/residual + pie (crédito usado / saldo restante)', () => {
    const d: ComprobanteData = {
      tituloTexto: 'Comprobante de aplicación de saldo a favor',
      tituloPNG: 'Comprobante de aplicación de saldo a favor',
      proveedor: 'Verduras La Huerta',
      lineas: [
        { fecha: '2026-07-05', nota: 'saldada ✓', monto: '₡30 000' },
        { fecha: '2026-07-06', nota: 'residual ₡10 000', monto: '₡20 000' },
      ],
      totalTexto: '₡50 000',
      totalPNG: '₡50 000',
      totalLabel: 'TOTAL APLICADO',
      pie: ['Crédito usado: TRF-889900', 'Saldo a favor restante: ₡0'],
    }
    const out = comprobanteTexto(d)
    expect(out).toContain('*Satori Sushi Bar* — Comprobante de aplicación de saldo a favor\nVerduras La Huerta')
    expect(out).toContain('• 2026-07-05  ₡30 000  saldada ✓')
    expect(out).toContain('• 2026-07-06  ₡20 000  residual ₡10 000')
    expect(out).toContain('\nTotal: ₡50 000\n\n')
    expect(out.endsWith('Crédito usado: TRF-889900\nSaldo a favor restante: ₡0')).toBe(true)
  })

  it('línea sin nota no agrega separador; waNumber sigue exportado desde acá', () => {
    const d: ComprobanteData = {
      tituloTexto: 'X', tituloPNG: 'X', proveedor: 'P',
      lineas: [{ fecha: '2026-07-05', nota: '', monto: '₡100' }],
      totalTexto: '₡100', totalPNG: '₡100',
    }
    expect(comprobanteTexto(d)).toBe('*Satori Sushi Bar* — X\nP\n\n• 2026-07-05  ₡100\n\nTotal: ₡100')
    expect(waNumber('89900324')).toBe('50689900324')
  })
})
