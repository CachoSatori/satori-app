// @vitest-environment happy-dom
//
// Ítem 2 — el draft de monto del PAGO (CashTurno, modal de editar pago) no admite negativos:
// confirmPago rechaza antes de pedir autorización o tocar la plata. Harness espejo de CashTurno.editAuth.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { CashSession, Supplier, CashMovement } from '../../shared/types/database'

const { createCashMovementSpy, deleteCashMovementSpy, requireManagerSpy } = vi.hoisted(() => ({
  createCashMovementSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-nuevo' })),
  deleteCashMovementSpy: vi.fn(async () => undefined),
  requireManagerSpy: vi.fn(async () => ({ ok: true as boolean })),
}))
vi.mock('../../shared/api/cash', () => ({
  createCashMovement: createCashMovementSpy,
  createCashSession: vi.fn(), closeCashSession: vi.fn(),
  deleteCashMovement: deleteCashMovementSpy,
  getPreviousCierre: vi.fn(async () => null), discardCashSession: vi.fn(),
  upsertSupplier: vi.fn(), updateMiddayCheck: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'cajero', full_name: 'Caja Test' } }) }))
vi.mock('../../shared/api/tips', () => ({ getActiveEmployees: vi.fn(async () => []), getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 500) }))
vi.mock('../../shared/api/facturas', () => ({ uploadFacturaPhoto: vi.fn(async () => 'f.jpg'), movementAttachments: vi.fn(() => []) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => requireManagerSpy }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashTurno from './CashTurno'

const session = {
  id: 's1', cajero_name: 'Caja Test', shift_type: 'AM', session_date: '2026-07-01',
  initial_suppliers_crc: 0, initial_cash_usd: 0,
} as unknown as CashSession
const supplier = { id: 'sup-1', name: 'Pescaderia Test', is_active: true } as unknown as Supplier
const existingPago = {
  id: 'mov-existing', movement_type: 'egreso_mercaderia', status: 'aprobado',
  caja_origen: 'Caja Proveedores', method: 'Efectivo', supplier_id: 'sup-1', supplier_name: 'Pescaderia Test',
  amount_crc: 15000, amount_usd: 0, description: 'pago previo', created_at: '2026-07-01T10:00:00Z',
} as unknown as CashMovement

const renderTurno = () => {
  const onError = vi.fn()
  render(<CashTurno openSession={session} suppliers={[supplier]} sessions={[]} sessionMovements={[existingPago]}
    allMovements={[]} onSessionOpen={vi.fn()} onSessionClose={vi.fn()} onMovAdded={vi.fn()} onError={onError} onRefresh={vi.fn()} />)
  return { onError }
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
  createCashMovementSpy.mockClear(); deleteCashMovementSpy.mockClear()
  requireManagerSpy.mockReset(); requireManagerSpy.mockResolvedValue({ ok: true })
})

describe('CashTurno · draft de pago — monto negativo bloqueado (Ítem 2)', () => {
  it('draftCRC < 0: avisa y NO guarda (ni pide autorización ni toca la plata)', async () => {
    const { onError } = renderTurno()
    fireEvent.click(screen.getByTitle('Editar'))
    fireEvent.change(screen.getByLabelText('Monto ₡ del pago'), { target: { value: '-100' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '✓ Guardar cambios' })) })
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/no puede ser negativo/i))
    expect(requireManagerSpy).not.toHaveBeenCalled()   // el guard corta ANTES de la autorización
    expect(deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(createCashMovementSpy).not.toHaveBeenCalled()
  })
})
