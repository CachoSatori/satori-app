// Helpers puros del saldo a favor (mig 053). Encodean la MISMA matemática que la RPC apply_supplier_credit.
import { describe, it, expect } from 'vitest'
import { saldoCredito, saldoResidual, maxAplicable, type CreditApplicationLike } from './supplierCredits'

const app = (o: Partial<CreditApplicationLike>): CreditApplicationLike => ({
  amount_applied: 0, reversed: false, credit_id: 'C', applied_to_movement_id: 'F', ...o,
})
const credito = { id: 'C', amount_crc: 100000 }
const factura = { id: 'F', amount_crc: 60000 }

describe('supplierCredits — saldos puros', () => {
  it('saldoCredito = monto − Σ(aplicado no reversado); ignora reversadas y otros créditos', () => {
    const apps = [
      app({ credit_id: 'C', amount_applied: 30000 }),               // cuenta
      app({ credit_id: 'C', amount_applied: 20000, reversed: true }), // reversada → NO cuenta
      app({ credit_id: 'OTRO', amount_applied: 50000 }),             // otro crédito → NO cuenta
    ]
    expect(saldoCredito(credito, apps)).toBe(70000)
  })

  it('saldoResidual = factura − Σ(aplicado no reversado a esa factura)', () => {
    const apps = [
      app({ applied_to_movement_id: 'F', amount_applied: 25000 }),                 // cuenta
      app({ applied_to_movement_id: 'F', amount_applied: 10000, reversed: true }), // reversada → NO
      app({ applied_to_movement_id: 'OTRA', amount_applied: 40000 }),              // otra factura → NO
    ]
    expect(saldoResidual(factura, apps)).toBe(35000)
  })

  it('apply TOTAL: residual llega a 0 (crédito cubre la factura entera)', () => {
    const apps = [app({ applied_to_movement_id: 'F', amount_applied: 60000 })]
    expect(saldoResidual(factura, apps)).toBe(0)
  })

  it('apply PARCIAL: queda residual (> 0 → la factura sigue pendiente)', () => {
    const apps = [app({ applied_to_movement_id: 'F', amount_applied: 20000 })]
    expect(saldoResidual(factura, apps)).toBe(40000)
  })

  it('maxAplicable = min(saldoCredito, saldoResidual), nunca negativo', () => {
    // crédito 100k libre, factura 60k libre → tope = 60k (manda el residual).
    expect(maxAplicable(credito, factura, [])).toBe(60000)
    // crédito ya casi usado (queda 15k), factura entera libre → tope = 15k (manda el crédito).
    const apps = [app({ credit_id: 'C', applied_to_movement_id: 'OTRA', amount_applied: 85000 })]
    expect(maxAplicable(credito, factura, apps)).toBe(15000)
  })

  it('reponer (reversed=true) devuelve el saldo del crédito', () => {
    const activa = [app({ credit_id: 'C', amount_applied: 40000 })]
    expect(saldoCredito(credito, activa)).toBe(60000)
    const repuesta = [app({ credit_id: 'C', amount_applied: 40000, reversed: true })]
    expect(saldoCredito(credito, repuesta)).toBe(100000)  // como si nunca se hubiera aplicado
  })
})
