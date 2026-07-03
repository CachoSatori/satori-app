// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { CashSession, Supplier, CashMovement } from '../../shared/types/database'

// EDITAR un pago YA guardado = reemplazo (delete_movement_cascade + re-crear) → requiere la MISMA
// autorización de gerencia que el borrado. Antes este camino llamaba la cascada SIN credenciales y
// la RPC (mig 044) rechazaba al cajero con "No autorizado" sin haberle pedido nada. Invariantes:
//   1. Autorizado (modal ok con credenciales) → el borrado-reemplazo viaja CON las credenciales
//      (la RPC las re-valida server-side y audita al autorizante) y el pago se re-crea.
//   2. Rechazado/cancelado → NO se borra ni se re-crea nada (la edición no se guarda).
// Harness espejo de CashTurno.mercaderia.test.tsx.

const { createCashMovementSpy, deleteCashMovementSpy, requireManagerSpy } = vi.hoisted(() => ({
  createCashMovementSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-nuevo', _pending: false })),
  deleteCashMovementSpy: vi.fn(async () => undefined),
  requireManagerSpy: vi.fn(async () => ({ ok: true as boolean, managerEmail: undefined as string | undefined, managerPassword: undefined as string | undefined })),
}))

vi.mock('../../shared/api/cash', () => ({
  createCashMovement: createCashMovementSpy,
  createCashSession: vi.fn(),
  closeCashSession: vi.fn(),
  deleteCashMovement: deleteCashMovementSpy,
  getPreviousCierre: vi.fn(async () => null),
  discardCashSession: vi.fn(),
  upsertSupplier: vi.fn(),
  updateMiddayCheck: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'cajero', full_name: 'Caja Test' } }),
}))
vi.mock('../../shared/api/tips', () => ({
  getActiveEmployees: vi.fn(async () => []),
  getTipPayoutsSince: vi.fn(async () => []),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 500) }))
vi.mock('../../shared/api/facturas', () => ({
  uploadFacturaPhoto: vi.fn(async () => 'factura/path.jpg'),
  movementAttachments: vi.fn(() => []),
}))
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

// Pago a proveedor YA guardado (persistedId = m.id) → aparece en la lista con ✏️.
const existingPago = {
  id: 'mov-existing', movement_type: 'egreso_mercaderia', status: 'aprobado',
  caja_origen: 'Caja Proveedores', method: 'Efectivo',
  supplier_id: 'sup-1', supplier_name: 'Pescaderia Test',
  amount_crc: 15000, amount_usd: 0, description: 'pago previo',
  created_at: '2026-07-01T10:00:00Z',
} as unknown as CashMovement

const renderTurno = () => render(
  <CashTurno
    openSession={session}
    suppliers={[supplier]}
    sessions={[]}
    sessionMovements={[existingPago]}
    allMovements={[]}
    onSessionOpen={vi.fn()}
    onSessionClose={vi.fn()}
    onMovAdded={vi.fn()}
    onError={vi.fn()}
    onRefresh={vi.fn()}
  />,
)

const editarYGuardar = async () => {
  fireEvent.click(screen.getByTitle('Editar'))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '✓ Guardar cambios' }))
  })
}

describe('CashTurno — editar un pago guardado exige autorización de gerencia', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    createCashMovementSpy.mockClear()
    deleteCashMovementSpy.mockClear()
    requireManagerSpy.mockReset()
  })

  it('AUTORIZADA: el borrado-reemplazo viaja con las credenciales del modal y el pago se re-crea', async () => {
    requireManagerSpy.mockResolvedValue({ ok: true, managerEmail: 'boss@satori.cr', managerPassword: 'clave-boss' })
    renderTurno()
    await editarYGuardar()

    expect(requireManagerSpy).toHaveBeenCalledTimes(1)
    // La RPC re-valida el par server-side (mig 044) → las credenciales DEBEN viajar.
    expect(deleteCashMovementSpy).toHaveBeenCalledWith(
      'mov-existing', 'Reemplazo por edición de pago a proveedor', 'boss@satori.cr', 'clave-boss')
    expect(createCashMovementSpy).toHaveBeenCalledTimes(1)
  })

  it('RECHAZADA/cancelada: no se borra ni se re-crea nada (la edición no se guarda)', async () => {
    requireManagerSpy.mockResolvedValue({ ok: false, managerEmail: undefined, managerPassword: undefined })
    renderTurno()
    await editarYGuardar()

    expect(requireManagerSpy).toHaveBeenCalledTimes(1)
    expect(deleteCashMovementSpy).not.toHaveBeenCalled()
    expect(createCashMovementSpy).not.toHaveBeenCalled()
  })
})
