// (19-nov) Armado de los comprobantes al proveedor: liquidación con TODAS las facturas (saldada / parcial / sin cubrir)
// y lo que queda por pagar; reenvío por crédito desde credit_applications (sin reversadas) y por factura; el pago normal
// sigue dando EXACTAMENTE lo mismo que antes. Datos ficticios.
import { describe, it, expect } from 'vitest'
import type { CashMovement, CreditApplication, SupplierCredit } from '../../shared/types/database'
import { fi, fd } from './cashUtils'
import { comprobanteTexto, fechaEmisionCR } from './comprobante'
import {
  armarLiquidacion, comprobanteLiquidacion, liquidacionDeCredito, comprobantePago, comprobanteFacturaPagada,
  filaPagoDeMovimiento, type FilaPago,
} from './comprobanteProveedor'

const mov = (o: Partial<CashMovement>): CashMovement => ({
  id: 'm', session_id: null, status: 'aprobado', amount_crc: 30000, amount_usd: 0,
  created_at: '2026-07-05T18:00:00Z', description: 'Factura 12', subcategory: 'Compra', supplier_id: 'SUP', ...o,
} as unknown as CashMovement)
const app = (o: Partial<CreditApplication>): CreditApplication => ({
  id: 'a', credit_id: 'C', applied_to_movement_id: 'f1', amount_applied: 0, currency: 'CRC',
  applied_at: '2026-07-10T15:00:00Z', applied_by: null, client_op_id: null, reversed: false, ...o,
})
const credito = (o: Partial<SupplierCredit> = {}): SupplierCredit => ({
  id: 'C', supplier_id: 'SUP', origin: 'sobrepago', amount_crc: 70000, amount_usd: 0, currency: 'CRC',
  fecha_origen: '2026-07-01', motivo: 'm', referencia: 'TRF-PRUEBA', source_movement_id: null, document_id: null,
  created_by: null, created_at: '2026-07-01T12:00:00Z', client_op_id: null, ...o,
})

describe('armarLiquidacion — cada factura con su estado y el total que queda por pagar', () => {
  // Crédito de 70 000 repartido FIFO entre 4 pendientes: 30k + 20k completas, 20k de 30k, nada a la de 25k.
  const liq = armarLiquidacion({
    facturas: [
      { id: 'f1', fecha: '2026-07-05', desc: 'Factura A', residualPrevio: 30000, usd: 0 },
      { id: 'f2', fecha: '2026-07-06', desc: 'Factura B', residualPrevio: 20000, usd: 0 },
      { id: 'f3', fecha: '2026-07-07', desc: 'Factura C', residualPrevio: 30000, usd: 0 },
      { id: 'f4', fecha: '2026-07-08', desc: 'Factura D', residualPrevio: 25000, usd: 0 },
    ],
    aplicado: { f1: 30000, f2: 20000, f3: 20000 },
    creditoRef: 'TRF-PRUEBA',
    saldoCreditoPrevio: 70000,
  })

  it('2 saldadas + 1 parcial + 1 sin cubrir, en el orden del reparto', () => {
    expect(liq.facturas.map(f => [f.id, f.estado, f.aplicado, f.queda])).toEqual([
      ['f1', 'saldada', 30000, 0],
      ['f2', 'saldada', 20000, 0],
      ['f3', 'parcial', 20000, 10000],
      ['f4', 'sin_cubrir', 0, 25000],
    ])
  })
  it('total aplicado, saldo restante y lo que queda por pagar (10 000 + 25 000)', () => {
    expect(liq.totalAplicado).toBe(70000)
    expect(liq.saldoRestante).toBe(0)
    expect(liq.porPagarCRC).toBe(35000)
    expect(liq.porPagarUSD).toBe(0)
  })
  it('el comprobante (texto de WhatsApp) lista las 4 con su estado y el «Queda por pagar»', () => {
    const t = comprobanteTexto(comprobanteLiquidacion(liq, 'Proveedor de prueba'))
    expect(t).toContain(`• 2026-07-05  ${fi(30000)}  Factura A\n    (saldada ✓)`)
    expect(t).toContain(`• 2026-07-06  ${fi(20000)}  Factura B\n    (saldada ✓)`)
    expect(t).toContain(`• 2026-07-07  ${fi(20000)}  Factura C\n    (parcial · queda ${fi(10000)})`)
    expect(t).toContain(`• 2026-07-08  ${fi(0)}  Factura D\n    (sin cubrir · queda ${fi(25000)})`)
    expect(t).toContain(`Total: ${fi(70000)}`)
    expect(t).toContain('Crédito usado: TRF-PRUEBA')
    expect(t).toContain(`Saldo a favor restante: ${fi(0)}`)
    expect(t).toContain(`Queda por pagar: ${fi(35000)}`)
  })
  it('una factura en $ sin ₡ queda «sin cubrir» con sus dólares en lo que queda por pagar', () => {
    const l2 = armarLiquidacion({
      facturas: [
        { id: 'a', fecha: '2026-07-05', desc: 'x', residualPrevio: 10000, usd: 0 },
        { id: 'b', fecha: '2026-07-06', desc: 'y', residualPrevio: 0, usd: 40 },
      ],
      aplicado: { a: 10000 }, creditoRef: '', saldoCreditoPrevio: 15000,
    })
    expect(l2.facturas.map(f => f.estado)).toEqual(['saldada', 'sin_cubrir'])
    expect([l2.porPagarCRC, l2.porPagarUSD, l2.saldoRestante]).toEqual([0, 40, 5000])
    expect(comprobanteTexto(comprobanteLiquidacion(l2, 'P'))).toContain(`Queda por pagar: ${fd(40)}`)
  })
})

describe('liquidacionDeCredito — reenvío por crédito desde credit_applications', () => {
  const movs = [
    mov({ id: 'f1', amount_crc: 30000, created_at: '2026-07-05T18:00:00Z', description: 'Factura A' }),
    mov({ id: 'f2', amount_crc: 30000, created_at: '2026-07-06T18:00:00Z', description: 'Factura B' }),
    mov({ id: 'f3', amount_crc: 20000, created_at: '2026-07-07T18:00:00Z', description: 'Factura C' }),
  ]
  const apps = [
    app({ id: '1', applied_to_movement_id: 'f1', amount_applied: 30000, applied_at: '2026-07-10T15:00:00Z' }),
    app({ id: '2', applied_to_movement_id: 'f2', amount_applied: 15000, applied_at: '2026-07-10T15:00:01Z' }),
    app({ id: '3', applied_to_movement_id: 'f2', amount_applied: 5000, applied_at: '2026-07-11T15:00:00Z' }),   // 2.ª vez, se suma
    app({ id: '4', applied_to_movement_id: 'f3', amount_applied: 20000, reversed: true }),                       // reversada: fuera
    // Otro crédito saldó f2 DESPUÉS: no cambia el comprobante de C (en su momento quedó parcial).
    app({ id: '5', credit_id: 'OTRO', applied_to_movement_id: 'f2', amount_applied: 10000, applied_at: '2026-07-20T15:00:00Z' }),
  ]
  const liq = liquidacionDeCredito(credito(), apps, movs)!

  it('una línea por factura tocada, sin las reversadas; varias imputaciones a la misma factura se suman', () => {
    expect(liq.facturas.map(f => [f.id, f.aplicado, f.estado, f.queda])).toEqual([
      ['f1', 30000, 'saldada', 0],
      ['f2', 20000, 'parcial', 10000],
    ])
  })
  it('totales: aplicado 50 000, saldo restante 20 000 (lo de hoy), queda por pagar 10 000; fecha CR de las imputaciones', () => {
    expect([liq.totalAplicado, liq.saldoRestante, liq.porPagarCRC]).toEqual([50000, 20000, 10000])
    expect(liq.fechaAplicacion).toBe('2026-07-10 a 2026-07-11')
    expect(comprobanteTexto(comprobanteLiquidacion(liq, 'P'))).toContain('Aplicado el 2026-07-10 a 2026-07-11')
  })
  it('sin imputaciones vivas → null (no hay comprobante que reenviar)', () => {
    expect(liquidacionDeCredito(credito(), [apps[3]], movs)).toBeNull()
  })
  it('la fecha de imputación es la de Costa Rica (23:30 CR = 05:30 UTC del día siguiente)', () => {
    const l = liquidacionDeCredito(credito(), [app({ applied_to_movement_id: 'f1', amount_applied: 1000, applied_at: '2026-07-11T05:30:00Z' })], movs)!
    expect(l.fechaAplicacion).toBe('2026-07-10')
  })
})

// Copia LITERAL del armado que tenía CashPendientes.tsx antes del 19-nov (comprobanteDeRows): el nuevo tiene que dar lo mismo.
function armadoViejo(name: string, esPropinas: boolean, rows: FilaPago[]) {
  const sumCRC = rows.reduce((s, r) => s + r.residual, 0)
  const sumUSD = rows.reduce((s, r) => s + r.usd, 0)
  return {
    tituloTexto: 'Comprobante de pago',
    tituloPNG: esPropinas ? 'Comprobante de pago de propinas' : 'Comprobante de pago a proveedor',
    proveedor: name,
    lineas: rows.map(r => ({
      fecha: r.fecha, nota: r.ref,
      monto: r.residual ? fi(r.residual) : (r.usd ? fd(r.usd) : '—'),
      subnotaTexto: r.aplicado > 0 ? `facturado ${fi(r.crc)} − crédito ${fi(r.aplicado)} = pagado ${fi(r.residual)}` : undefined,
      subnotaPNG:   r.aplicado > 0 ? `facturado ${fi(r.crc)}  −  crédito ${fi(r.aplicado)}` : undefined,
    })),
    totalTexto: `${sumCRC ? fi(sumCRC) : ''}${sumUSD ? (sumCRC ? ' · ' : '') + fd(sumUSD) : ''}`,
    totalPNG:   `${sumCRC ? fi(sumCRC) : ''}${sumUSD ? (sumCRC ? '  ·  ' : '') + fd(sumUSD) : ''}`,
  }
}

describe('pago normal — mismas cifras que antes', () => {
  const filas: FilaPago[][] = [
    [{ fecha: '2026-07-05', ref: 'Factura 12', crc: 30000, usd: 0, aplicado: 0, residual: 30000 }],
    [{ fecha: '2026-07-05', ref: 'F1', crc: 30000, usd: 0, aplicado: 10000, residual: 20000 },
     { fecha: '2026-07-06', ref: '', crc: 0, usd: 45.5, aplicado: 0, residual: 0 }],
    [{ fecha: '2026-07-07', ref: 'Propinas turno', crc: 12345.67, usd: 10, aplicado: 0, residual: 12345.67 }],
  ]
  it.each(filas.map((f, i) => [i, f] as const))('caso %i: comprobantePago = armado viejo', (_i, f) => {
    expect(comprobantePago('Proveedor de prueba', false, f)).toEqual(armadoViejo('Proveedor de prueba', false, f))
    expect(comprobantePago('Propinas', true, f)).toEqual(armadoViejo('Propinas', true, f))
  })

  it('reenvío por factura (Historial): mismo comprobante que el post-pago de esa factura, con el desglose del crédito', () => {
    const m = mov({ id: 'f1', amount_crc: 30000 })
    const apps = [app({ applied_to_movement_id: 'f1', amount_applied: 10000 }), app({ id: 'r', applied_to_movement_id: 'f1', amount_applied: 5000, reversed: true })]
    const d = comprobanteFacturaPagada(m, '2026-07-05', 'Proveedor de prueba', apps)
    expect(d).toEqual(comprobantePago('Proveedor de prueba', false, [filaPagoDeMovimiento(m, '2026-07-05', apps)]))
    expect(d.totalTexto).toBe(fi(20000))
    expect(d.lineas[0].subnotaTexto).toBe(`facturado ${fi(30000)} − crédito ${fi(10000)} = pagado ${fi(20000)}`)
  })
  it('reenvío de una factura que el crédito cubrió entera: dice ₡0 (no queda vacío)', () => {
    const m = mov({ id: 'f1', amount_crc: 30000 })
    const d = comprobanteFacturaPagada(m, '2026-07-05', 'P', [app({ applied_to_movement_id: 'f1', amount_applied: 30000 })])
    expect([d.lineas[0].monto, d.totalTexto, d.totalPNG]).toEqual([fi(0), fi(0), fi(0)])
  })
})

describe('textos y fechas', () => {
  it('la fecha de emisión del PNG es la de Costa Rica (23:30 CR = 05:30 UTC del día siguiente)', () => {
    expect(fechaEmisionCR(new Date('2026-07-11T05:30:00Z'))).toBe('10/7/2026')
  })
  it('los textos que lee el proveedor no tutean ni vosean', () => {
    const liq = armarLiquidacion({ facturas: [{ id: 'a', fecha: '2026-07-05', desc: 'x', residualPrevio: 100, usd: 0 }], aplicado: {}, creditoRef: 'R', saldoCreditoPrevio: 10 })
    const t = comprobanteTexto(comprobanteLiquidacion(liq, 'P')) + comprobanteTexto(comprobantePago('P', false, [{ fecha: '', ref: '', crc: 1, usd: 0, aplicado: 0, residual: 1 }]))
    expect(t).not.toMatch(/\b(vos|tu|tus|tenés|tienes|podés|puedes|revisá|revisa)\b/i)
  })
})
