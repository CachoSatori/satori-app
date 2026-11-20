// @vitest-environment happy-dom
//
// (20-nov) FIFO del crédito desde la pantalla real: sin «· fact», la fecha efectiva es el día del movimiento que arma
// CashPendientes (session_date del turno; a nivel día, el día CR del registro), nunca el día UTC de created_at.
// Mutación: `fechaMov = m => m.created_at.slice(0, 10)` → caen las dos. Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CashMovement, CashSession, Supplier, SupplierCredit } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  updateMovementStatus:   vi.fn(async () => {}),
  updateCashMovement:     vi.fn(async () => {}),
  sendPagoProveedorEmail: vi.fn(async () => {}),
  createSupplierCredit:   vi.fn(async () => 'c'),
  applySupplierCredit:    vi.fn<(p: { movement_id: string; amount: number }) => Promise<string>>(async () => 'app'),
}))
vi.mock('../../shared/api/cash', () => api)
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashPendientes from './CashPendientes'

const mov = (over: Partial<CashMovement>): CashMovement => ({
  id: 'm', session_id: null, status: 'pendiente', amount_crc: 30000, amount_usd: 0,
  created_at: '2026-11-12T12:00:00Z', description: '', subcategory: 'Compra', shift: null,
  method: 'Transferencia', caja_origen: 'Banco', supplier_id: 'P', supplier_name: 'Proveedor de prueba', employee_name: null,
  ...over,
} as unknown as CashMovement)
const proveedor = {
  id: 'P', name: 'Proveedor de prueba', category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Transferencia', cuenta_iban: '', aliases: null, is_active: true, email: null, whatsapp: null,
  notificar_pago: 'no', created_at: '', updated_at: '',
} as unknown as Supplier
const credito = {
  id: 'C', supplier_id: 'P', origin: 'sobrepago', amount_crc: 40000, amount_usd: 0, currency: 'CRC',
  fecha_origen: '2026-11-01', motivo: 'm', referencia: 'TRF-PRUEBA', source_movement_id: null, document_id: null,
  created_by: null, created_at: '2026-11-01T12:00:00Z', client_op_id: null,
} as SupplierCredit
const turno11 = { id: 'T1', session_date: '2026-11-11', shift_type: 'Noche' } as unknown as CashSession

async function aplicarYLeerOrden(movements: CashMovement[], sessions: CashSession[]) {
  render(<CashPendientes movements={movements} sessions={sessions} suppliers={[proveedor]} credits={[credito]}
    applications={[]} onRefresh={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Aplicar crédito \(/ }))
  fireEvent.click(await screen.findByRole('button', { name: /^Aplicar \(/ }))
  await screen.findByRole('button', { name: /Descargar comprobante/ })
  return api.applySupplierCredit.mock.calls.map(c => [c[0].movement_id, c[0].amount])
}

beforeEach(() => { vi.clearAllMocks() })

describe('CashPendientes · FIFO del crédito con el día del movimiento', () => {
  it('con turno: usa el session_date del turno (11), no el día UTC de created_at (12)', async () => {
    // f-turno: turno del 11, creada 2026-11-12T03:00Z (= 11-nov 21:00 CR), sin «· fact».
    // f-fact: factura del 12, creada antes en UTC. Con el día UTC empatarían en el 12 y ganaría f-fact.
    const orden = await aplicarYLeerOrden([
      mov({ id: 'f-fact', created_at: '2026-11-12T01:00:00Z', description: 'Compra · fact 2026-11-12' }),
      mov({ id: 'f-turno', session_id: 'T1', created_at: '2026-11-12T03:00:00Z', description: 'Compra del turno' }),
    ], [turno11])
    expect(orden).toEqual([['f-turno', 30000], ['f-fact', 10000]])
  })
  it('a nivel día (sin turno): usa el día CR del registro, no el UTC (23:30 CR = 05:30 UTC del día siguiente)', async () => {
    const orden = await aplicarYLeerOrden([
      mov({ id: 'f-fact', created_at: '2026-11-12T04:00:00Z', description: 'Compra · fact 2026-11-12' }),
      mov({ id: 'f-noche', created_at: '2026-11-12T05:30:00Z', description: 'Compra de la noche' }),
    ], [])
    expect(orden).toEqual([['f-noche', 30000], ['f-fact', 10000]])
  })
})
