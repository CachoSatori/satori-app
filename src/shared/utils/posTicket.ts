// Ticket de cobro en modo SIM (texto plano). Replica el formato de
// print-bridge/render.js (precuenta) pero como string para preview/log en la app;
// la impresora real (ESC/POS) y la factura fiscal son futuro (SPEC §2, D4).
import type { BillTotals } from './posFiscal'

const W = 38   // ancho típico de térmica 80mm en monoespaciado
const money = (n: number): string => '₡' + Math.round(Number(n) || 0).toLocaleString('es-CR')
const moneyUsd = (n: number): string => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function row(left: string, right: string): string {
  const l = left.slice(0, W - right.length - 1)
  return l + ' '.repeat(Math.max(1, W - l.length - right.length)) + right
}
const center = (s: string): string => {
  const pad = Math.max(0, Math.floor((W - s.length) / 2))
  return ' '.repeat(pad) + s
}
const rule = (): string => '-'.repeat(W)

export interface TicketLine { name: string; qty: number; line_total_crc: number; modifiers?: string[] }
export interface TicketPago {
  method: 'efectivo' | 'tarjeta' | 'transferencia'
  currency: 'CRC' | 'USD'
  exchange_rate_used: number | null
  received_crc: number
  received_usd: number
  change_crc: number
}
export interface TicketData {
  table: string
  channel: string
  pax: number
  salonero?: string
  cajero?: string
  at?: number
  lines: TicketLine[]
  totals: BillTotals
  pago: TicketPago
}

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'EFECTIVO', tarjeta: 'TARJETA', transferencia: 'TRANSFERENCIA/SINPE',
}

/** Renderiza el ticket de cobro a texto plano (modo SIM). Puro y testeable. */
export function renderTicketCobro(d: TicketData): string {
  const L: string[] = []
  L.push(center('SATORI SUSHI BAR'))
  L.push(center('Santa Teresa, Costa Rica'))
  L.push(center('TICKET DE COBRO (SIM)'))
  L.push(center('no es factura electrónica'))
  L.push(rule())
  L.push(`${d.table}  ·  ${d.channel}  ·  ${d.pax}p`)
  if (d.salonero) L.push(`Atiende: ${d.salonero}`)
  if (d.cajero) L.push(`Cobra: ${d.cajero}`)
  L.push(new Date(d.at ?? Date.now()).toLocaleString('es-CR'))
  L.push(rule())
  for (const it of d.lines) {
    L.push(row(`${it.qty > 1 ? it.qty + 'x ' : ''}${it.name}`, money(it.line_total_crc)))
    if (it.modifiers?.length) L.push('  · ' + it.modifiers.join(', '))
  }
  L.push(rule())
  const t = d.totals
  L.push(row('Consumo (IVA incl.)', money(t.consumo)))
  L.push(row('  Neto', money(t.neto)))
  L.push(row('  IVA', money(t.iva)))
  if (t.servicioAplica) L.push(row('Servicio 10%', money(t.servicio)))
  L.push(row('TOTAL', money(t.total)))
  L.push(rule())
  // Pago
  const p = d.pago
  L.push(row('Método', METHOD_LABEL[p.method] ?? p.method))
  if (p.exchange_rate_used) {
    L.push(row('TC usado', '₡' + p.exchange_rate_used + '/$'))
    L.push(row('Total en $', moneyUsd(p.exchange_rate_used > 0 ? t.total / p.exchange_rate_used : 0)))
  }
  if (p.method === 'efectivo') {
    if (p.received_usd > 0) L.push(row('Recibido', moneyUsd(p.received_usd) + ' (' + money(p.received_crc) + ')'))
    else L.push(row('Recibido', money(p.received_crc)))
    L.push(row('Vuelto', money(p.change_crc)))
  }
  L.push(rule())
  L.push(center('¡Gracias! Pura vida 🌺'))
  L.push('')
  return L.join('\n')
}
