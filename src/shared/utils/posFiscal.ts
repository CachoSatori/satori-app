// PoS TRAMO 3 — modelo fiscal CR (spec de la dueña). ÚNICA verdad de la
// matemática de impuestos: pura, sin IO, testeada. Resuelve DECISIÓN-NOCTURNA #7/#8.
//
// Reglas:
//  - El precio cargado por producto es FINAL (IVA incluido — lo que ve el cliente).
//  - El desglose neto/IVA se DERIVA acá, nunca se persiste ni se edita a mano.
//  - Los deltas de modificadores también son precios FINALES y heredan el tax_type.
//  - Servicio 10% por CANAL (salón/barra SÍ, delivery NO), aplicado al armar la cuenta.
//
// ✅ CALIBRADO CONFIRMADO (2026-06-12, documentos reales de Nube de Fuego —
// pre-cuenta + factura electrónica del mismo sistema, idénticas en cálculo):
// servicio = 10% del subtotal NETO · IVA = 13% solo del neto (el servicio NO
// lleva IVA) · total = neto × 1,23. El criterio vive en SERVICE_CONFIG.
// PENDIENTE-CONTADORA: solo CIIU/CABYS del menú.

export type TaxType = 'iva13' | 'iva4' | 'iva2' | 'iva1' | 'exento'
export type Canal = 'salon' | 'barra' | 'delivery'

/** Tasas de IVA vigentes en CR (gastronomía = 13% estándar). */
export const TAX_RATES: Record<TaxType, number> = {
  iva13: 0.13, iva4: 0.04, iva2: 0.02, iva1: 0.01, exento: 0,
}

export const TAX_LABEL: Record<TaxType, string> = {
  iva13: 'IVA 13%', iva4: 'IVA 4%', iva2: 'IVA 2%', iva1: 'IVA 1%', exento: 'Exento',
}

/**
 * PARÁMETRO CENTRALIZADO del impuesto de servicio.
 * ✅ CALIBRADO contra factura real de Nube de Fuego (2026-06-12): base 'neto',
 * servicio sin IVA — ver test de regresión "ticket real" en posFiscal.test.ts.
 * PENDIENTE solo CIIU/CABYS de la contadora (no afecta esta matemática).
 *  - rate:     10% estándar de gastronomía.
 *  - base:     'neto' (CONFIRMADO) | 'total' (sobre el consumo con IVA).
 *  - taxed:    ¿el servicio lleva IVA 13%? CONFIRMADO: false.
 *  - channels: canales que cobran servicio (salón y barra; delivery NO).
 */
export const SERVICE_CONFIG = {
  rate: 0.10,
  base: 'neto' as 'neto' | 'total',
  taxed: false,
  channels: ['salon', 'barra'] as Canal[],
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

/** Desglosa un precio FINAL (IVA incluido) en neto + IVA según el tipo. */
export function splitNetIva(finalCrc: number, taxType: TaxType): { neto: number; iva: number } {
  const final = Number(finalCrc) || 0
  const rate = TAX_RATES[taxType] ?? 0
  const neto = round2(final / (1 + rate))
  return { neto, iva: round2(final - neto) }
}

export interface BillModifier { name: string; price_delta_crc: number }
export interface BillItem {
  product_name: string
  qty: number
  price_final_crc: number          // base del producto, IVA incluido
  modifiers: BillModifier[]        // deltas finales (IVA incluido), heredan tax_type
  tax_type: TaxType
  seat?: number
  /** Flag de la ficha del producto: ¿lleva impuesto de servicio 10%? (default SÍ;
   *  ej. merchandising NO). Se combina con la regla por canal: delivery nunca. */
  applies_service?: boolean
}

/** Precio FINAL de una línea = (base + Σ deltas) × qty. Todo IVA incluido. */
export function lineFinal(it: BillItem): number {
  const unit = (Number(it.price_final_crc) || 0)
    + (it.modifiers ?? []).reduce((s, m) => s + (Number(m.price_delta_crc) || 0), 0)
  return round2(unit * (Number(it.qty) || 1))
}

export interface BillLine extends BillItem { final: number; neto: number; iva: number }

export interface BillTotals {
  lines: BillLine[]
  consumo: number       // subtotal FINAL (IVA incluido) — lo que consumió la mesa
  neto: number          // subtotal neto derivado
  iva: number           // IVA total derivado
  servicio: number      // impuesto de servicio (0 si el canal no lo cobra)
  servicioIva: number   // IVA del servicio (0 salvo SERVICE_CONFIG.taxed)
  servicioAplica: boolean
  servicioBase: 'neto' | 'total'
  total: number         // consumo + servicio + IVA del servicio
}

/**
 * ÚNICA función de totales del PoS. Recibe los ítems de la cuenta y el canal;
 * devuelve el desglose completo para mostrar (consumo · servicio · IVA · total).
 */
export function computeTotals(items: BillItem[], canal: Canal): BillTotals {
  const lines: BillLine[] = (items ?? []).map(it => {
    const final = lineFinal(it)
    const { neto, iva } = splitNetIva(final, it.tax_type)
    return { ...it, final, neto, iva }
  })

  const consumo = round2(lines.reduce((s, l) => s + l.final, 0))
  const neto = round2(lines.reduce((s, l) => s + l.neto, 0))
  const iva = round2(lines.reduce((s, l) => s + l.iva, 0))

  const servicioAplica = SERVICE_CONFIG.channels.includes(canal)
  const servicioBase = SERVICE_CONFIG.base
  // Solo los ítems con applies_service (default true) aportan a la base del 10%
  const svcLines = lines.filter(l => l.applies_service !== false)
  const baseAmount = servicioBase === 'neto'
    ? round2(svcLines.reduce((s, l) => s + l.neto, 0))
    : round2(svcLines.reduce((s, l) => s + l.final, 0))
  const servicio = servicioAplica ? round2(baseAmount * SERVICE_CONFIG.rate) : 0
  const servicioIva = servicioAplica && SERVICE_CONFIG.taxed ? round2(servicio * TAX_RATES.iva13) : 0
  const total = round2(consumo + servicio + servicioIva)

  return { lines, consumo, neto, iva, servicio, servicioIva, servicioAplica, servicioBase, total }
}

/** Agrupa los ítems por asiento (para la vista "por cliente" de la cuenta). */
export function groupBySeat(items: BillItem[]): Map<number, BillItem[]> {
  const m = new Map<number, BillItem[]>()
  for (const it of items ?? []) {
    const seat = it.seat ?? 0
    if (!m.has(seat)) m.set(seat, [])
    m.get(seat)!.push(it)
  }
  return m
}
