// @vitest-environment happy-dom
//
// mig 047 — al pagar un pendiente, el comprobante por email va SOLO a los proveedores con
// notificar_pago='email' + email cargado. Notificar=No → flujo IDÉNTICO al actual (sin confirm,
// sin email). La plata se paga igual (fire-and-forget); el email nunca la bloquea ni la revierte.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import type { CashMovement, Supplier } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  updateMovementStatus:   vi.fn(async () => {}),
  updateCashMovement:     vi.fn(async () => {}),
  sendPagoProveedorEmail: vi.fn<(ids: string[]) => Promise<void>>(async () => {}),
}))
vi.mock('../../shared/api/cash', () => api)
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashPendientes from './CashPendientes'
const { updateMovementStatus, sendPagoProveedorEmail } = api

const mov = (over: Partial<CashMovement>): CashMovement => ({
  id: 'm', session_id: null, status: 'pendiente', amount_crc: 10000, amount_usd: 0,
  created_at: '2026-07-15T18:00:00Z', description: '', subcategory: '', shift: null,
  method: 'Transferencia', caja_origen: 'Banco', supplier_id: null, supplier_name: null, employee_name: null,
  ...over,
} as unknown as CashMovement)

const sup = (over: Partial<Supplier>): Supplier => ({
  id: 's', name: 'S', category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Transferencia', cuenta_iban: '', aliases: null, is_active: true,
  email: null, whatsapp: null, notificar_pago: 'no', created_at: '', updated_at: '',
  ...over,
})

const provA = mov({ id: 'a1', supplier_id: 'A', supplier_name: 'Alfa', description: 'Fact A', amount_crc: 50000 })
const provB = mov({ id: 'b1', supplier_id: 'B', supplier_name: 'Beta', description: 'Fact B', amount_crc: 30000 })
const provA2 = mov({ id: 'a2', supplier_id: 'A', supplier_name: 'Alfa', description: 'Fact A2', amount_crc: 20000, created_at: '2026-07-16T18:00:00Z' })
const provC = mov({ id: 'c1', supplier_id: 'C', supplier_name: 'Gama', description: 'Fact C', amount_crc: 10000 })
const suppliers = [
  sup({ id: 'A', name: 'Alfa', email: 'alfa@ejemplo.test', notificar_pago: 'email' }),  // recibe email
  sup({ id: 'B', name: 'Beta', notificar_pago: 'no' }),                          // no
  sup({ id: 'C', name: 'Gama', email: 'gama@ejemplo.test', notificar_pago: 'email' }),  // recibe email
]

const pagarFila = (texto: string) => {
  const fila = screen.getAllByText(texto).map(el => el.closest('tr')).find(Boolean)!
  fireEvent.click(within(fila).getByText('✓ Pagado'))
}

beforeEach(() => { vi.clearAllMocks(); window.confirm = vi.fn(() => true) })

describe('CashPendientes · notificación de pago al proveedor (mig 047)', () => {
  it('Notificar=Email → confirma anunciando el envío y dispara el email SOLO a ese proveedor', async () => {
    render(<CashPendientes movements={[provA, provB]} sessions={[]} suppliers={suppliers} credits={[]} applications={[]} onRefresh={vi.fn()} />)
    pagarFila('Fact A')
    await waitFor(() => expect(updateMovementStatus).toHaveBeenCalledWith('a1', 'aprobado'))
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain('alfa@ejemplo.test')
    expect(sendPagoProveedorEmail).toHaveBeenCalledTimes(1)
    expect(sendPagoProveedorEmail).toHaveBeenCalledWith(['a1'])   // «✓ Pagado» de una sola = lista de 1
  })

  it('Notificar=No → sin confirm y sin email (flujo idéntico al actual)', async () => {
    render(<CashPendientes movements={[provA, provB]} sessions={[]} suppliers={suppliers} credits={[]} applications={[]} onRefresh={vi.fn()} />)
    pagarFila('Fact B')
    await waitFor(() => expect(updateMovementStatus).toHaveBeenCalledWith('b1', 'aprobado'))
    expect(window.confirm).not.toHaveBeenCalled()
    expect(sendPagoProveedorEmail).not.toHaveBeenCalled()
  })

  it('si el usuario cancela el confirm, NO paga ni notifica', async () => {
    window.confirm = vi.fn(() => false)
    render(<CashPendientes movements={[provA, provB]} sessions={[]} suppliers={suppliers} credits={[]} applications={[]} onRefresh={vi.fn()} />)
    pagarFila('Fact A')
    await Promise.resolve()
    expect(updateMovementStatus).not.toHaveBeenCalled()
    expect(sendPagoProveedorEmail).not.toHaveBeenCalled()
  })

  // (19-nov, dueño) UN correo por pago: una sola llamada por proveedor con TODAS sus facturas pagadas en esa acción.
  it('«Marcar todos pagados» con 2 facturas del mismo proveedor → UNA llamada con los 2 ids', async () => {
    render(<CashPendientes movements={[provA, provA2]} sessions={[]} suppliers={suppliers} credits={[]} applications={[]} onRefresh={vi.fn()} />)
    fireEvent.click(screen.getByText('✓ Marcar todos pagados'))
    await waitFor(() => expect(sendPagoProveedorEmail).toHaveBeenCalledTimes(1))
    expect(updateMovementStatus).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendPagoProveedorEmail).mock.calls[0][0]).toEqual(expect.arrayContaining(['a1', 'a2']))
    expect(vi.mocked(sendPagoProveedorEmail).mock.calls[0][0]).toHaveLength(2)
    // El confirm anuncia UN comprobante para ese proveedor, con la cantidad de facturas.
    const msg = vi.mocked(window.confirm).mock.calls[0][0] as string
    expect(msg.match(/📧/g)).toHaveLength(1)
    expect(msg).toContain('Se enviará un comprobante a: Alfa (alfa@ejemplo.test) · 2 facturas')
  })

  it('«Pagar seleccionados» → UNA llamada solo con las facturas elegidas de ese proveedor', async () => {
    render(<CashPendientes movements={[provA, provA2, provC, provB]} sessions={[]} suppliers={suppliers} credits={[]} applications={[]} onRefresh={vi.fn()} />)
    const fila = screen.getAllByText('Fact A2').map(el => el.closest('tr')).find(Boolean)!
    fireEvent.click(within(fila).getByRole('checkbox'))
    fireEvent.click(screen.getByText(/✓ Pagar seleccionados/))
    await waitFor(() => expect(sendPagoProveedorEmail).toHaveBeenCalledTimes(1))
    expect(sendPagoProveedorEmail).toHaveBeenCalledWith(['a2'])
    expect(updateMovementStatus).toHaveBeenCalledTimes(1)
  })
})
