// Helpers puros del saldo a favor (mig 053). Encodean la MISMA matemática que la RPC apply_supplier_credit.
import { describe, it, expect } from 'vitest'
import { saldoCredito, saldoResidual, maxAplicable, distribuirCreditoFIFO, compararFIFO, type CreditApplicationLike } from './supplierCredits'

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

describe('distribuirCreditoFIFO — reparte un crédito entre varias facturas (más viejas primero)', () => {
  it('FIFO: agota el crédito llenando de la 1ª a la última; el resto queda en 0', () => {
    // saldo 50k, residuales [30k, 30k, 30k] → llena 30k, 20k, 0.
    expect(distribuirCreditoFIFO(50000, [30000, 30000, 30000])).toEqual([30000, 20000, 0])
  })

  it('crédito ≥ Σ residuales → cubre todas exactas (Σ = Σ residuales, no el saldo)', () => {
    expect(distribuirCreditoFIFO(100000, [20000, 30000, 10000])).toEqual([20000, 30000, 10000])
  })

  it('cada monto ≤ su residual y Σ ≤ saldo (invariantes)', () => {
    const saldo = 45000
    const residuales = [10000, 50000, 7000, 20000]
    const montos = distribuirCreditoFIFO(saldo, residuales)
    montos.forEach((m, i) => { expect(m).toBeLessThanOrEqual(residuales[i]); expect(m).toBeGreaterThanOrEqual(0) })
    const sum = montos.reduce((s, m) => s + m, 0)
    expect(sum).toBeLessThanOrEqual(saldo)
    expect(sum).toBe(Math.min(saldo, residuales.reduce((s, r) => s + r, 0)))  // = min(saldo, Σ residuales)
    expect(montos).toEqual([10000, 35000, 0, 0])                              // FIFO exacto
  })

  it('saldo 0 → todo 0; lista vacía → []; residual negativo se trata como 0', () => {
    expect(distribuirCreditoFIFO(0, [10000, 20000])).toEqual([0, 0])
    expect(distribuirCreditoFIFO(50000, [])).toEqual([])
    expect(distribuirCreditoFIFO(50000, [-5000, 30000])).toEqual([0, 30000])
  })
})

// (20-nov, decisión del dueño) Orden del reparto: fecha de factura ↑ (sin fecha al final), después created_at ↑, después id ↑.
// Mutación: volver a ordenar solo por created_at → caen «misma created_at» y «empate total»; nulls first → cae «sin fecha».
describe('compararFIFO — orden total y fijo del reparto (R06)', () => {
  const T = '2026-11-18T15:00:00.000000+00:00'
  const f = (id: string, created_at: string, description = '') => ({ id, created_at, description })
  const orden = (xs: ReturnType<typeof f>[]) => [...xs].sort(compararFIFO).map(x => x.id)

  it('misma created_at, distinta fecha de factura → primero la factura más vieja', () => {
    expect(orden([f('a', T, 'P · fact 2026-11-15'), f('b', T, 'P · fact 2026-11-12')])).toEqual(['b', 'a'])
  })
  it('la fecha de factura manda sobre created_at', () => {
    expect(orden([f('a', '2026-11-10T12:00:00Z', 'P · fact 2026-11-09'), f('b', '2026-11-11T12:00:00Z', 'P · fact 2026-11-01')]))
      .toEqual(['b', 'a'])
  })
  it('misma fecha de factura → created_at; empate total → id, sin importar el orden de entrada', () => {
    const x = f('9f', T, 'P · fact 2026-11-12'), y = f('0a', T, 'P · fact 2026-11-12'), z = f('5c', '2026-11-17T09:00:00Z', 'P · fact 2026-11-12')
    expect(orden([x, y, z])).toEqual(['5c', '0a', '9f'])
    expect(orden([y, z, x])).toEqual(['5c', '0a', '9f'])
    expect(orden([x, z, y])).toEqual(['5c', '0a', '9f'])
  })
  it('sin fecha de factura → al final; entre ellas, created_at y después id', () => {
    expect(orden([f('s2', T), f('c', T, 'P · fact 2026-11-16'), f('s1', T), f('s0', '2026-11-01T12:00:00Z')]))
      .toEqual(['c', 's0', 's1', 's2'])
  })
})
