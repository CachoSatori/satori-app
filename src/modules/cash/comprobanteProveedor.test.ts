// (19-nov) Armado de los comprobantes al proveedor: liquidación con TODAS las facturas (saldada / parcial / sin cubrir)
// y lo que queda por pagar; reenvío por crédito desde credit_applications (sin reversadas, solo lo que tocó el crédito,
// sin «Queda por pagar»: decisión del dueño) y por factura; el pago normal sigue dando EXACTAMENTE lo mismo. Datos ficticios.
import { describe, it, expect } from 'vitest'
import type { CashMovement, CreditApplication, SupplierCredit } from '../../shared/types/database'
import { fi, fd } from './cashUtils'
import { comprobanteTexto, fechaEmisionCR } from './comprobante'
import {
  armarLiquidacion, comprobanteLiquidacion, liquidacionDeCredito, comprobantePago, comprobanteFacturaPagada,
  comprobanteReenvioCredito, filaPagoDeMovimiento, PIE_SALDO_HOY, SALDADA_CON_CREDITO, type FilaPago,
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
  it('total aplicado 50 000; aplicado en dos días → título «Crédito aplicado del X al Y» (fecha CR)', () => {
    expect(liq.totalAplicado).toBe(50000)
    expect(liq.fechaAplicacion).toBe('2026-07-10 al 2026-07-11')
    expect(comprobanteTexto(comprobanteReenvioCredito(liq, 'P'))).toContain('— Crédito aplicado del 2026-07-10 al 2026-07-11\n')
  })
  it('sin imputaciones vivas → null (no hay comprobante que reenviar)', () => {
    expect(liquidacionDeCredito(credito(), [apps[3]], movs)).toBeNull()
  })
  it('la fecha de imputación es la de Costa Rica (23:30 CR = 05:30 UTC del día siguiente)', () => {
    const l = liquidacionDeCredito(credito(), [app({ applied_to_movement_id: 'f1', amount_applied: 1000, applied_at: '2026-07-11T05:30:00Z' })], movs)!
    expect(l.fechaAplicacion).toBe('2026-07-10')
    expect(comprobanteReenvioCredito(l, 'P').tituloTexto).toBe('Crédito aplicado el 2026-07-10')
  })

  // Punto 2 (verificador): una factura que no está entre los movimientos cargados NO es «saldada».
  it('factura fuera de los movimientos cargados → «sin datos», no «saldada»', () => {
    const l = liquidacionDeCredito(credito(), [app({ applied_to_movement_id: 'NO-CARGADA', amount_applied: 7000 })], movs)!
    expect(l.facturas.map(f => [f.estado, f.aplicado, f.queda])).toEqual([['sin_datos', 7000, 0]])
    const t = comprobanteTexto(comprobanteReenvioCredito(l, 'P'))
    expect(t).toContain('(sin datos de la factura)')
    expect(t).not.toContain('saldada')
  })

  // Punto 3 (R06): a igual fecha, el orden lo fija el id, no el orden en que llegaron las imputaciones.
  it('dos facturas del mismo día: orden fijo por id, llegue como llegue', () => {
    const mismos = [mov({ id: 'fb', created_at: '2026-07-05T18:00:00Z' }), mov({ id: 'fa', created_at: '2026-07-05T19:00:00Z' })]
    const ida = [app({ id: 'x', applied_to_movement_id: 'fb', amount_applied: 100 }), app({ id: 'y', applied_to_movement_id: 'fa', amount_applied: 200 })]
    expect(liquidacionDeCredito(credito(), ida, mismos)!.facturas.map(f => f.id)).toEqual(['fa', 'fb'])
    expect(liquidacionDeCredito(credito(), [...ida].reverse(), [...mismos].reverse())!.facturas.map(f => f.id)).toEqual(['fa', 'fb'])
  })
})

// Decisión del dueño (19-nov): el reenvío por crédito muestra SOLO las facturas que tocó ese crédito, con su estado al
// aplicar y el total aplicado; sin «Queda por pagar» ni «sin cubrir», y con la línea fija para el saldo de hoy.
describe('reenvío por crédito — mismo escenario que el comprobante original', () => {
  // 4 pendientes; el crédito de 70 000 deja f1 y f2 saldadas, f3 parcial y f4 sin cubrir (el original lista las 4).
  const enElMomento = [
    mov({ id: 'f1', status: 'aprobado', amount_crc: 30000, created_at: '2026-07-05T18:00:00Z', description: 'Factura A' }),
    mov({ id: 'f2', status: 'aprobado', amount_crc: 20000, created_at: '2026-07-06T18:00:00Z', description: 'Factura B' }),
    mov({ id: 'f3', status: 'pendiente', amount_crc: 30000, created_at: '2026-07-07T18:00:00Z', description: 'Factura C' }),
    mov({ id: 'f4', status: 'pendiente', amount_crc: 25000, created_at: '2026-07-08T18:00:00Z', description: 'Factura D' }),
  ]
  const apps = [
    app({ id: '1', applied_to_movement_id: 'f1', amount_applied: 30000, applied_at: '2026-07-10T15:00:00Z' }),
    app({ id: '2', applied_to_movement_id: 'f2', amount_applied: 20000, applied_at: '2026-07-10T15:00:01Z' }),
    app({ id: '3', applied_to_movement_id: 'f3', amount_applied: 20000, applied_at: '2026-07-10T15:00:02Z' }),
  ]
  const original = comprobanteLiquidacion(armarLiquidacion({
    facturas: enElMomento.map(m => ({ id: m.id, fecha: m.created_at.slice(0, 10), desc: m.description, residualPrevio: m.amount_crc, usd: 0 })),
    aplicado: { f1: 30000, f2: 20000, f3: 20000 }, creditoRef: 'TRF-PRUEBA', saldoCreditoPrevio: 70000,
  }), 'P')
  // Después se pagan f4 (por transferencia) y el resto de f3 con OTRO crédito: el reenvío no cambia.
  const despues = enElMomento.map(m => ({ ...m, status: 'aprobado' } as CashMovement))
  const apps2 = [...apps, app({ id: '9', credit_id: 'OTRO', applied_to_movement_id: 'f3', amount_applied: 10000, applied_at: '2026-07-15T15:00:00Z' })]
  const reenvio = comprobanteReenvioCredito(liquidacionDeCredito(credito(), apps2, despues)!, 'P')
  const t = comprobanteTexto(reenvio)

  it('lista las 2 saldadas y la parcial con lo aplicado, iguales a esas líneas del original', () => {
    expect(reenvio.lineas.map(l => [l.fecha, l.monto, l.subnotaTexto])).toEqual([
      ['2026-07-05', fi(30000), 'saldada ✓'],
      ['2026-07-06', fi(20000), 'saldada ✓'],
      ['2026-07-07', fi(20000), `parcial · queda ${fi(10000)}`],
    ])
    expect(reenvio.lineas).toEqual(original.lineas.slice(0, 3))
    expect(t).toContain(`Total: ${fi(70000)}`)
  })
  it('título con la fecha CR de la aplicación y la línea fija del pie', () => {
    expect(reenvio.tituloTexto).toBe('Crédito aplicado el 2026-07-10')
    expect(reenvio.pie).toEqual(['Crédito usado: TRF-PRUEBA', PIE_SALDO_HOY])
    expect(PIE_SALDO_HOY).toBe('Para el saldo pendiente de hoy, consulte con nosotros.')
  })
  it('NO muestra «Queda por pagar» ni facturas «sin cubrir» (el original sí)', () => {
    expect(comprobanteTexto(original)).toContain('Queda por pagar')
    expect(comprobanteTexto(original)).toContain('sin cubrir')
    expect(t).not.toMatch(/queda por pagar/i)
    expect(t).not.toMatch(/sin cubrir/i)
    expect(t).not.toContain('Factura D')
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
  // Punto 5 (verificador): saldada SOLO con crédito no es «Comprobante de pago … ₡0» ni «TOTAL A PAGAR».
  it('reenvío de una factura que el crédito cubrió entera: «Saldada con crédito a favor», sin ₡0 ni TOTAL A PAGAR', () => {
    const m = mov({ id: 'f1', amount_crc: 30000 })
    const d = comprobanteFacturaPagada(m, '2026-07-05', 'P', [app({ applied_to_movement_id: 'f1', amount_applied: 30000 })])
    expect(SALDADA_CON_CREDITO).toBe('Saldada con crédito a favor')
    expect([d.tituloTexto, d.tituloPNG, d.totalLabel]).toEqual([SALDADA_CON_CREDITO, SALDADA_CON_CREDITO, 'SALDADA CON CRÉDITO A FAVOR'])
    expect([d.lineas[0].monto, d.totalPNG, d.lineas[0].subnotaPNG]).toEqual([fi(30000), fi(30000), `facturado ${fi(30000)} − crédito ${fi(30000)}`])
    const t = comprobanteTexto(d)
    expect(t).toContain(`Saldada con crédito a favor: ${fi(30000)}`)
    expect(t).not.toContain('Comprobante de pago')
    expect(t).not.toContain(fi(0))
    expect(t).not.toMatch(/total a pagar/i)
  })
  it('una factura de ₡0 sin crédito sigue siendo comprobante de pago y dice ₡0 (no queda vacío)', () => {
    const d = comprobanteFacturaPagada(mov({ id: 'z', amount_crc: 0 }), '2026-07-05', 'P', [])
    expect([d.tituloTexto, d.lineas[0].monto, d.totalTexto, d.totalLabel]).toEqual(['Comprobante de pago', fi(0), fi(0), undefined])
  })
})

describe('textos y fechas', () => {
  it('la fecha de emisión del PNG es la de Costa Rica (23:30 CR = 05:30 UTC del día siguiente)', () => {
    expect(fechaEmisionCR(new Date('2026-07-11T05:30:00Z'))).toBe('10/7/2026')
  })
  it('los textos que lee el proveedor no tutean ni vosean', () => {
    const liq = armarLiquidacion({ facturas: [{ id: 'a', fecha: '2026-07-05', desc: 'x', residualPrevio: 100, usd: 0 }], aplicado: {}, creditoRef: 'R', saldoCreditoPrevio: 10 })
    const reenvio = liquidacionDeCredito(credito(), [app({ applied_to_movement_id: 'm', amount_applied: 10 })], [mov({})])!
    const t = comprobanteTexto(comprobanteLiquidacion(liq, 'P')) + comprobanteTexto(comprobantePago('P', false, [{ fecha: '', ref: '', crc: 1, usd: 0, aplicado: 0, residual: 1 }]))
      + comprobanteTexto(comprobanteReenvioCredito(reenvio, 'P'))
      + comprobanteTexto(comprobanteFacturaPagada(mov({}), '', 'P', [app({ applied_to_movement_id: 'm', amount_applied: 30000 })]))
    expect(t).not.toMatch(/\b(vos|tu|tus|tenés|tienes|podés|puedes|revisá|revisa)\b/i)
  })
})
