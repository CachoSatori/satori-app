// @vitest-environment happy-dom
//
// Enhancement B2: "Aplicar crédito" reparte UN crédito entre VARIAS facturas (FIFO) en una sola
// operación. Fija lo que no puede volver atrás: pre-llenado FIFO, e imputación por RPC a CADA
// factura con monto>0 (no a las de 0), en orden. El reparto puro vive en supplierCredits.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Supplier, CashMovement, SupplierCredit } from '../../shared/types/database'

const { applySpy } = vi.hoisted(() => ({ applySpy: vi.fn() }))
vi.mock('../../shared/api/cash', () => ({
  createSupplierCredit: vi.fn(async () => 'c-id'),
  applySupplierCredit: applySpy,
}))

import { AplicarCreditoModal } from './CreditoModals'

const supplier = { id: 'S', name: 'Pescados' } as unknown as Supplier
const credit = (o: Partial<SupplierCredit> = {}): SupplierCredit => ({
  id: 'C', supplier_id: 'S', origin: 'sobrepago', amount_crc: 50000, amount_usd: 0, currency: 'CRC',
  fecha_origen: '2026-07-01', motivo: 'm', referencia: 'r', source_movement_id: null, document_id: null,
  created_by: null, created_at: '2026-07-01T12:00:00Z', client_op_id: null, ...o,
})
const fac = (o: Partial<CashMovement>): CashMovement => ({
  id: 'F', supplier_id: 'S', status: 'pendiente', amount_crc: 30000, amount_usd: 0,
  created_at: '2026-07-05T12:00:00Z', description: '', subcategory: '', ...o,
} as unknown as CashMovement)

describe('AplicarCreditoModal — reparte un crédito entre varias facturas (FIFO)', () => {
  beforeEach(() => { applySpy.mockReset(); applySpy.mockResolvedValue('app-id') })

  it('pre-llena FIFO y al aplicar imputa a CADA factura con monto>0 (2 de 3), no a la de 0', async () => {
    const onDone = vi.fn(), onClose = vi.fn()
    // saldo 50k; residuales 30k/30k/30k (más viejas primero) → FIFO 30k, 20k, 0.
    const pendientes = [
      fac({ id: 'f1', created_at: '2026-07-05T12:00:00Z', amount_crc: 30000 }),
      fac({ id: 'f2', created_at: '2026-07-06T12:00:00Z', amount_crc: 30000 }),
      fac({ id: 'f3', created_at: '2026-07-07T12:00:00Z', amount_crc: 30000 }),
    ]
    render(<AplicarCreditoModal supplier={supplier} credits={[credit()]} applications={[]} pendientes={pendientes} onDone={onDone} onClose={onClose} />)

    // El botón confirma el total repartido = 30k + 20k = 50 000 (separador ICU agnóstico).
    const aplicarBtn = screen.getByRole('button', { name: /Aplicar \(/ })
    expect(aplicarBtn.textContent?.replace(/\D/g, '')).toBe('50000')

    fireEvent.click(aplicarBtn)
    await waitFor(() => expect(onDone).toHaveBeenCalled())

    // Una imputación por factura con monto>0, en orden FIFO; la de monto 0 (f3) NO se imputa.
    expect(applySpy).toHaveBeenCalledTimes(2)
    const calls = applySpy.mock.calls.map(c => c[0] as { movement_id: string; amount: number; credit_id: string })
    expect(calls[0]).toMatchObject({ credit_id: 'C', movement_id: 'f1', amount: 30000 })
    expect(calls[1]).toMatchObject({ credit_id: 'C', movement_id: 'f2', amount: 20000 })
    expect(calls.some(c => c.movement_id === 'f3')).toBe(false)
    expect(onClose).toHaveBeenCalled()  // éxito total → cierra
  })

  it('bloquea Aplicar si el total supera el crédito (Σ montos > saldoCredito)', async () => {
    const onDone = vi.fn(), onClose = vi.fn()
    // saldo 10k, una factura de 30k → FIFO pre-llena 10k (≤ saldo) → Aplicar habilitado.
    const pendientes = [fac({ id: 'f1', amount_crc: 30000 })]
    render(<AplicarCreditoModal supplier={supplier} credits={[credit({ amount_crc: 10000 })]} applications={[]} pendientes={pendientes} onDone={onDone} onClose={onClose} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '25000' } })  // 25k > saldo 10k → inválido

    const aplicarBtn = screen.getByRole('button', { name: /Aplicar \(/ }) as HTMLButtonElement
    expect(aplicarBtn.disabled).toBe(true)
    fireEvent.click(aplicarBtn)
    expect(applySpy).not.toHaveBeenCalled()
  })
})
