// Armado PURO de los comprobantes que se le mandan al proveedor (19-nov). Solo PRESENTACIÓN: lee montos que ya
// existen (amount_crc, amount_usd, credit_applications) con los mismos helpers de supplierCredits.ts; no escribe
// nada, no recalcula la RPC ni muta amount_crc. El dibujo (PNG / texto / envío) sigue en ./comprobante.
//
//   · comprobantePago        → pago normal (Pendientes y reenvío por factura desde Historial de pagos).
//   · armarLiquidacion       → resultado de aplicar un crédito: CADA factura pendiente del proveedor
//                              («saldada», «parcial · queda X», «sin cubrir · queda X») + lo que queda por pagar.
//                              Se arma con el SNAPSHOT previo a aplicar (no con el estado después del refresco).
//   · liquidacionDeCredito   → reenvío por crédito, rearmado desde credit_applications (append-only, sin `reversed`).
//                              (Dueño, 19-nov) SOLO las facturas que tocó ese crédito, con su estado al aplicar: no hay
//                              historial de estados para saber qué otras estaban pendientes ese día, así que NO lleva
//                              «sin cubrir» ni «Queda por pagar» (ver comprobanteReenvioCredito).
import type { CashMovement, CreditApplication, SupplierCredit } from '../../shared/types/database'
import { fi, fd } from './cashUtils'
import { dateCR } from '../../shared/utils'
import { facturaAplicado, saldoResidual } from './supplierCredits'
import type { ComprobanteData } from './comprobante'

const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
const EPS = 0.001

// ── Pago normal ──────────────────────────────────────────────────────────────────────────────────
export interface FilaPago {
  fecha: string
  ref: string
  crc: number       // amount_crc original
  usd: number
  aplicado: number  // crédito aplicado (no reversado)
  residual: number  // crc − aplicado = lo transferido
}

/** Comprobante de pago. MISMO armado que tenía CashPendientes (líneas, desglose del crédito y total). */
export function comprobantePago(nombre: string, esPropinas: boolean, rows: FilaPago[]): ComprobanteData {
  // Comprobante = lo transferido = Σ RESIDUAL (amount_crc − crédito aplicado). NO muta amount_crc.
  const sumCRC = rows.reduce((s, r) => s + r.residual, 0)
  const sumUSD = rows.reduce((s, r) => s + r.usd, 0)
  return {
    tituloTexto: 'Comprobante de pago',
    tituloPNG: esPropinas ? 'Comprobante de pago de propinas' : 'Comprobante de pago a proveedor',
    proveedor: nombre,
    lineas: rows.map(r => ({
      fecha: r.fecha,
      nota: r.ref,
      monto: r.residual ? fi(r.residual) : (r.usd ? fd(r.usd) : '—'),
      // Desglose del crédito aplicado (mig 053). El texto lleva "= pagado Z"; el PNG no (espaciado).
      subnotaTexto: r.aplicado > 0 ? `facturado ${fi(r.crc)} − crédito ${fi(r.aplicado)} = pagado ${fi(r.residual)}` : undefined,
      subnotaPNG:   r.aplicado > 0 ? `facturado ${fi(r.crc)}  −  crédito ${fi(r.aplicado)}` : undefined,
    })),
    totalTexto: `${sumCRC ? fi(sumCRC) : ''}${sumUSD ? (sumCRC ? ' · ' : '') + fd(sumUSD) : ''}`,
    totalPNG:   `${sumCRC ? fi(sumCRC) : ''}${sumUSD ? (sumCRC ? '  ·  ' : '') + fd(sumUSD) : ''}`,
  }
}

/** Fila de pago de UNA factura, leída del movimiento real y de las aplicaciones (no reversadas). */
export function filaPagoDeMovimiento(m: CashMovement, fecha: string, applications: CreditApplication[]): FilaPago {
  return {
    fecha,
    ref: m.description || m.subcategory || '',
    crc: N(m.amount_crc),
    usd: N(m.amount_usd),
    aplicado: facturaAplicado(m.id, applications),
    residual: saldoResidual(m, applications),
  }
}

export const SALDADA_CON_CREDITO = 'Saldada con crédito a favor'

/** Reenvío por factura (Historial de pagos): el mismo comprobante del pago, para una sola factura.
 *  Si el crédito la cubrió entera (no se transfirió nada), NO es un «Comprobante de pago … ₡0» ni un «TOTAL A PAGAR»:
 *  es «Saldada con crédito a favor», con lo facturado y el crédito que la saldó. Una factura de ₡0 sin crédito dice ₡0. */
export function comprobanteFacturaPagada(
  m: CashMovement, fecha: string, nombre: string, applications: CreditApplication[],
): ComprobanteData {
  const fila = filaPagoDeMovimiento(m, fecha, applications)
  if (fila.aplicado > EPS && fila.residual <= EPS && fila.usd <= EPS) {
    const desglose = `facturado ${fi(fila.crc)} − crédito ${fi(fila.aplicado)}`
    return {
      tituloTexto: SALDADA_CON_CREDITO,
      tituloPNG: SALDADA_CON_CREDITO,
      proveedor: nombre,
      lineas: [{ fecha: fila.fecha, nota: fila.ref, monto: fi(fila.aplicado), subnotaTexto: desglose, subnotaPNG: desglose }],
      totalTexto: fi(fila.aplicado),
      totalPNG: fi(fila.aplicado),
      totalLabel: SALDADA_CON_CREDITO.toUpperCase(),
      totalLabelTexto: SALDADA_CON_CREDITO,
    }
  }
  const d = comprobantePago(nombre, false, [fila])
  if (!d.totalTexto) {
    return {
      ...d,
      lineas: d.lineas.map(l => ({ ...l, monto: fi(0) })),
      totalTexto: fi(0),
      totalPNG: fi(0),
    }
  }
  return d
}

// ── Liquidación de saldo a favor ─────────────────────────────────────────────────────────────────
// 'sin_datos' = la factura no está entre los movimientos cargados (solo en el reenvío): no se sabe cómo quedó.
export type EstadoFactura = 'saldada' | 'parcial' | 'sin_cubrir' | 'sin_datos'

export interface FacturaLiquidada {
  id: string
  fecha: string
  desc: string
  aplicado: number   // crédito imputado a esta factura en esta liquidación
  queda: number      // ₡ que queda por pagar de la factura después de imputar
  quedaUSD: number   // $ de la factura (el crédito es solo ₡): queda entero salvo que la factura quede saldada
  estado: EstadoFactura
}

export interface Liquidacion {
  facturas: FacturaLiquidada[]
  totalAplicado: number
  porPagarCRC: number   // Σ queda de las facturas que siguen pendientes
  porPagarUSD: number
  creditoRef: string
  saldoRestante: number // saldo a favor que le queda al crédito
}

export interface FacturaPrevia {
  id: string
  fecha: string
  desc: string
  residualPrevio: number  // residual ₡ ANTES de aplicar
  usd: number
}

const estadoDe = (aplicado: number, queda: number): EstadoFactura =>
  aplicado <= EPS ? 'sin_cubrir' : (queda <= EPS ? 'saldada' : 'parcial')

function totales(facturas: FacturaLiquidada[]) {
  const pend = facturas.filter(f => f.estado === 'parcial' || f.estado === 'sin_cubrir')
  return {
    totalAplicado: r2(facturas.reduce((s, f) => s + f.aplicado, 0)),
    porPagarCRC: r2(pend.reduce((s, f) => s + f.queda, 0)),
    porPagarUSD: r2(pend.reduce((s, f) => s + f.quedaUSD, 0)),
  }
}

/**
 * Resultado de aplicar un crédito, para el comprobante. `facturas` = TODAS las pendientes del proveedor en el orden
 * del reparto (FIFO), con su residual ANTES de aplicar; `aplicado` = lo que de verdad entró por factura (id → ₡).
 * Una factura sin monto queda «sin cubrir». Saldada = su residual llegó a 0 (la misma regla con que la RPC la aprueba).
 */
export function armarLiquidacion(input: {
  facturas: FacturaPrevia[]
  aplicado: Record<string, number>
  creditoRef: string
  saldoCreditoPrevio: number
}): Liquidacion {
  const facturas = input.facturas.map(f => {
    const aplicado = r2(Math.max(0, N(input.aplicado[f.id])))
    const queda = Math.max(0, r2(N(f.residualPrevio) - aplicado))
    const estado = estadoDe(aplicado, queda)
    return { id: f.id, fecha: f.fecha, desc: f.desc, aplicado, queda, quedaUSD: estado === 'saldada' ? 0 : N(f.usd), estado }
  })
  const t = totales(facturas)
  return { facturas, ...t, creditoRef: input.creditoRef, saldoRestante: Math.max(0, r2(N(input.saldoCreditoPrevio) - t.totalAplicado)) }
}

const ts = (s: string): number => { const t = Date.parse(s); return Number.isFinite(t) ? t : 0 }

/** Reenvío por crédito (dueño, 19-nov): solo lo que se sabe con certeza de ESE momento. */
export interface ReenvioCredito {
  facturas: FacturaLiquidada[]   // solo las que tocó el crédito: 'saldada' | 'parcial' | 'sin_datos'
  totalAplicado: number
  creditoRef: string
  fechaAplicacion?: string       // día CR (o «X al Y») de las imputaciones de este crédito
}

/**
 * Reenvío por crédito: rearma desde `credit_applications` (append-only), sin las reversadas. Una línea por factura que
 * ESTE crédito tocó (si se aplicó en varias veces, se suman). «queda» = monto − todo lo aplicado (no reversado, de
 * cualquier crédito) hasta la última imputación de este crédito: lo aplicado después no cambia este comprobante.
 * Una factura que no está en `movements` queda «sin datos» (no se adivina). Orden: fecha y, a igual fecha, id (R06).
 */
export function liquidacionDeCredito(
  credito: SupplierCredit, applications: CreditApplication[], movements: CashMovement[],
): ReenvioCredito | null {
  const vivas = applications.filter(a => !a.reversed)
  const mias = vivas.filter(a => a.credit_id === credito.id && a.applied_to_movement_id)
  if (!mias.length) return null
  const movById = new Map(movements.map(m => [m.id, m]))
  const porFactura = new Map<string, CreditApplication[]>()
  for (const a of mias) {
    const id = a.applied_to_movement_id!
    porFactura.set(id, [...(porFactura.get(id) ?? []), a])
  }
  const facturas: FacturaLiquidada[] = [...porFactura.entries()].map(([id, apps]) => {
    const m = movById.get(id)
    const aplicado = r2(apps.reduce((s, a) => s + N(a.amount_applied), 0))
    if (!m) return { id, fecha: '', desc: 'factura fuera del período cargado', aplicado, queda: 0, quedaUSD: 0, estado: 'sin_datos' as const }
    const hasta = Math.max(...apps.map(a => ts(a.applied_at)))
    const aplicadoHasta = r2(vivas
      .filter(a => a.applied_to_movement_id === id && ts(a.applied_at) <= hasta)
      .reduce((s, a) => s + N(a.amount_applied), 0))
    const queda = Math.max(0, r2(N(m.amount_crc) - aplicadoHasta))
    const estado = estadoDe(aplicado, queda)
    return {
      id, fecha: dateCR(m.created_at), desc: (m.description || m.subcategory || '').slice(0, 26),
      aplicado, queda, quedaUSD: estado !== 'saldada' ? N(m.amount_usd) : 0, estado,
    }
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const dias = mias.map(a => dateCR(a.applied_at)).filter(Boolean).sort()
  const fechaAplicacion = dias.length ? (dias[0] === dias[dias.length - 1] ? dias[0] : `${dias[0]} al ${dias[dias.length - 1]}`) : undefined
  return {
    facturas,
    totalAplicado: r2(facturas.reduce((s, f) => s + f.aplicado, 0)),
    creditoRef: credito.referencia ?? '',
    fechaAplicacion,
  }
}

export const PIE_SALDO_HOY = 'Para el saldo pendiente de hoy, consulte con nosotros.'

/** Título del reenvío: «Crédito aplicado el <fecha CR>» (o «del X al Y» si se aplicó en varios días). */
export function tituloReenvioCredito(fechaAplicacion?: string): string {
  if (!fechaAplicacion) return 'Crédito aplicado'
  return fechaAplicacion.includes(' al ') ? `Crédito aplicado del ${fechaAplicacion}` : `Crédito aplicado el ${fechaAplicacion}`
}

/** Comprobante del REENVÍO por crédito (PNG + texto WhatsApp): las facturas que tocó, su estado al aplicar y el total
 *  aplicado. Sin «Queda por pagar» ni «sin cubrir» (no se pueden reconstruir exactos) y con la línea fija del pie. */
export function comprobanteReenvioCredito(r: ReenvioCredito, proveedor: string): ComprobanteData {
  const titulo = tituloReenvioCredito(r.fechaAplicacion)
  return {
    tituloTexto: titulo,
    tituloPNG: titulo,
    proveedor,
    lineas: r.facturas.map(f => ({
      fecha: f.fecha,
      nota: f.desc,
      monto: fi(f.aplicado),
      subnotaTexto: etiquetaEstado(f),
      subnotaPNG: etiquetaEstado(f),
    })),
    totalTexto: fi(r.totalAplicado),
    totalPNG: fi(r.totalAplicado),
    totalLabel: 'TOTAL APLICADO',
    pie: [
      ...(r.creditoRef ? [`Crédito usado: ${r.creditoRef}`] : []),
      PIE_SALDO_HOY,
    ],
  }
}

/** «₡X», «$ Y» o «₡X · $ Y» (₡ siempre que haya ₡ o no haya $). */
export function montoMixto(crc: number, usd: number): string {
  const partes: string[] = []
  if (crc > EPS || usd <= EPS) partes.push(fi(crc))
  if (usd > EPS) partes.push(fd(usd))
  return partes.join(' · ')
}

/** Etiqueta del estado de una factura en el comprobante y en pantalla. */
export function etiquetaEstado(f: FacturaLiquidada): string {
  if (f.estado === 'saldada') return 'saldada ✓'
  if (f.estado === 'sin_datos') return 'sin datos de la factura'
  const q = montoMixto(f.queda, f.quedaUSD)
  return f.estado === 'parcial' ? `parcial · queda ${q}` : `sin cubrir · queda ${q}`
}

/** Comprobante de la liquidación (PNG + texto WhatsApp). Una línea por factura con su estado. */
export function comprobanteLiquidacion(liq: Liquidacion, proveedor: string): ComprobanteData {
  return {
    tituloTexto: 'Comprobante de aplicación de saldo a favor',
    tituloPNG: 'Comprobante de aplicación de saldo a favor',
    proveedor,
    lineas: liq.facturas.map(f => ({
      fecha: f.fecha,
      nota: f.desc,
      monto: fi(f.aplicado),
      subnotaTexto: etiquetaEstado(f),
      subnotaPNG: etiquetaEstado(f),
    })),
    totalTexto: fi(liq.totalAplicado),
    totalPNG: fi(liq.totalAplicado),
    totalLabel: 'TOTAL APLICADO',
    pie: [
      `Crédito usado${liq.creditoRef ? `: ${liq.creditoRef}` : ''}`,
      `Saldo a favor restante: ${fi(liq.saldoRestante)}`,
      `Queda por pagar: ${montoMixto(liq.porPagarCRC, liq.porPagarUSD)}`,
    ],
  }
}
