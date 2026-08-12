// @vitest-environment happy-dom
//
// Bug/UX: al pagar la ÚLTIMA factura (o "Marcar todos pagados"), el grupo sale de Pendientes y ya no
// se puede emitir el comprobante. Fix: tras el pago exitoso, un result view "Comprobante de pago"
// (Descargar PNG + WhatsApp) armado desde un SNAPSHOT de lo pagado. Este test fija que el result view
// aparece tras pagar (con Descargar + WhatsApp) y que sólo se cierra con "Cerrar" — sin tocar la
// lógica de pago (updateMovementStatus se llama igual).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { CashMovement, Supplier } from '../../shared/types/database'

const { pagoSpy } = vi.hoisted(() => ({ pagoSpy: vi.fn() }))
vi.mock('../../shared/api/cash', () => ({
  updateMovementStatus: (...a: unknown[]) => pagoSpy(...a),
  updateCashMovement: vi.fn(async () => {}),
  sendPagoProveedorEmail: vi.fn(),
  createSupplierCredit: vi.fn(),
  applySupplierCredit: vi.fn(),
}))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashPendientes from './CashPendientes'

const mov = (o: Partial<CashMovement>): CashMovement => ({
  id: 'm', session_id: null, status: 'pendiente', amount_crc: 30000, amount_usd: 0,
  created_at: '2026-07-05T18:00:00Z', description: 'Factura 12', subcategory: 'Compra', shift: null,
  supplier_name: 'Pescados del Pacífico', supplier_id: 'SUP', employee_name: null,
  ...o,
} as unknown as CashMovement)

const sup = (o: Partial<Supplier> = {}): Supplier => ({
  id: 'SUP', name: 'Pescados del Pacífico', whatsapp: '89900324', notificar_pago: 'no', email: null,
  category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal', metodo_pago: 'Efectivo',
  cuenta_iban: '', aliases: null, is_active: true, created_at: '', updated_at: '',
  ...o,
} as unknown as Supplier)

describe('CashPendientes — comprobante POST-pago', () => {
  beforeEach(() => { pagoSpy.mockReset(); pagoSpy.mockResolvedValue(undefined) })

  it('tras "Marcar todos pagados" aparece el comprobante del pagado; sólo cierra con Cerrar', async () => {
    const onRefresh = vi.fn()
    render(<CashPendientes movements={[mov({ id: 'f1' })]} sessions={[]} suppliers={[sup()]} credits={[]} applications={[]} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: /Marcar todos pagados/ }))

    // El pago corre igual que siempre (no se tocó la lógica) y se refresca.
    const titulo = await screen.findByText(/Comprobante de pago ·/)
    expect(pagoSpy).toHaveBeenCalledWith('f1', 'aprobado')
    expect(onRefresh).toHaveBeenCalled()

    // El result view (scoped al modal — "Descargar comprobante"/"WhatsApp" también viven en el grupo).
    const modal = titulo.closest('.cd-modal') as HTMLElement
    const w = within(modal)
    expect(w.getByRole('button', { name: /Descargar comprobante/ })).toBeTruthy()
    expect(w.getByRole('button', { name: /WhatsApp/ })).toBeTruthy()   // el proveedor tiene número
    expect(w.getByText(/Total pagado/)).toBeTruthy()

    // Sólo cierra con "Cerrar".
    fireEvent.click(w.getByRole('button', { name: /^Cerrar$/ }))
    expect(screen.queryByText(/Comprobante de pago ·/)).toBeNull()
  })
})
