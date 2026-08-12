// Saldo a favor de proveedores (Fase B1) — helpers PUROS del residual/saldo, para que la UI (B2) y
// los tests lean lo mismo que calcula la RPC `apply_supplier_credit` (mig 053), sin recomputar en cada lado.
//
//   saldoCredito  = credito.amount_crc − Σ(aplicaciones NO reversadas DE ese crédito)
//   saldoResidual = factura.amount_crc − Σ(aplicaciones NO reversadas A esa factura)
//   máximo aplicable de un crédito a una factura = min(saldoCredito, saldoResidual)

export interface CreditApplicationLike {
  amount_applied: number
  reversed: boolean
  credit_id: string
  applied_to_movement_id: string | null
}
export interface SupplierCreditLike {
  id: string
  amount_crc: number
}
export interface FacturaLike {
  id: string
  amount_crc: number
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/** Suma de lo aplicado (NO reversado) de un crédito. */
export function creditoAplicado(creditId: string, applications: CreditApplicationLike[]): number {
  return round2(applications
    .filter(a => !a.reversed && a.credit_id === creditId)
    .reduce((s, a) => s + N(a.amount_applied), 0))
}

/** Saldo disponible de un crédito = monto − aplicado (no reversado). */
export function saldoCredito(credito: SupplierCreditLike, applications: CreditApplicationLike[]): number {
  return round2(N(credito.amount_crc) - creditoAplicado(credito.id, applications))
}

/** Suma de lo aplicado (NO reversado) a una factura. */
export function facturaAplicado(movementId: string, applications: CreditApplicationLike[]): number {
  return round2(applications
    .filter(a => !a.reversed && a.applied_to_movement_id === movementId)
    .reduce((s, a) => s + N(a.amount_applied), 0))
}

/** Saldo residual de una factura = amount_crc − aplicado (no reversado). */
export function saldoResidual(factura: FacturaLike, applications: CreditApplicationLike[]): number {
  return round2(N(factura.amount_crc) - facturaAplicado(factura.id, applications))
}

/** Máximo aplicable de un crédito a una factura = min(saldoCredito, saldoResidual), nunca negativo. */
export function maxAplicable(
  credito: SupplierCreditLike, factura: FacturaLike, applications: CreditApplicationLike[],
): number {
  return round2(Math.max(0, Math.min(saldoCredito(credito, applications), saldoResidual(factura, applications))))
}

/**
 * Reparte un `saldo` de crédito entre varias facturas por su `residual`, FIFO: llena el residual de
 * cada factura (en el ORDEN recibido — el caller manda las más viejas primero) con el crédito
 * disponible hasta agotarlo; el resto queda en 0. Devuelve los montos alineados 1:1 con `residuales`.
 *
 * Invariantes: cada monto ∈ [0, residual]; Σ montos ≤ saldo (y = min(saldo, Σ residuales)). Puro,
 * sin efectos; la RPC `apply_supplier_credit` es la que realmente lockea y persiste cada imputación.
 */
export function distribuirCreditoFIFO(saldo: number, residuales: number[]): number[] {
  let restante = round2(Math.max(0, N(saldo)))
  return residuales.map(r => {
    const res = Math.max(0, N(r))
    const aplicar = round2(Math.min(res, restante))
    restante = round2(restante - aplicar)
    return aplicar
  })
}
