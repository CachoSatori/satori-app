// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import type { CashSession, Supplier } from '../../shared/types/database'

// F4.1 (unificación Bandeja↔Caja): el pago a proveedor cargado en Caja Diaria DEBE viajar con
// classification='mercaderia' + el snapshot suggested_* — así el trigger del server crea la tarea
// de Revisión de inventario (INV-1), igual que la Bandeja (InboxModule.MERCADERIA_CLASS).
// Test light: NO toca DB ni red — se mockea createCashMovement y se afirma con qué payload lo llama
// el camino del proveedor (modal "Agregar pago" → Confirmar pago → persistPago).

// El spy va en vi.hoisted porque vi.mock se hoistea sobre los imports.
const { createCashMovementSpy } = vi.hoisted(() => ({
  createCashMovementSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-1', _pending: false })),
}))

vi.mock('../../shared/api/cash', () => ({
  createCashMovement: createCashMovementSpy,
  createCashSession: vi.fn(),
  closeCashSession: vi.fn(),
  deleteCashMovement: vi.fn(),
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
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))

import CashTurno from './CashTurno'

const session = {
  id: 's1', cajero_name: 'Caja Test', shift_type: 'AM', session_date: '2026-06-29',
  initial_suppliers_crc: 0, initial_cash_usd: 0,
} as unknown as CashSession

const supplier = { id: 'sup-1', name: 'Pescaderia Test', is_active: true } as unknown as Supplier

describe('CashTurno — el pago a proveedor se clasifica como mercadería (F4.1)', () => {
  it('createCashMovement recibe classification=mercaderia + snapshot suggested_*', async () => {
    // Env de supabase para que cualquier import transitivo no tire (no se conecta a nada).
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')

    render(
      <CashTurno
        openSession={session}
        suppliers={[supplier]}
        sessions={[]}
        sessionMovements={[]}
        allMovements={[]}
        onSessionOpen={vi.fn()}
        onSessionClose={vi.fn()}
        onMovAdded={vi.fn()}
        onError={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )

    // Abrir el modal de pago a proveedor.
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar pago' }))

    // Buscar y elegir el proveedor (la opción del dropdown dispara onMouseDown).
    fireEvent.change(screen.getByPlaceholderText('Escribí para buscar proveedor…'), { target: { value: 'Pesca' } })
    fireEvent.mouseDown(screen.getByText('Pescaderia Test'))

    // Monto en colones.
    const colonesField = screen.getByText('Monto ₡ colones').closest('.tips-field') as HTMLElement
    fireEvent.change(within(colonesField).getByRole('spinbutton'), { target: { value: '15000' } })

    // Confirmar el pago → confirmPago → persistPago → createCashMovement.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '✓ Confirmar pago' }))
    })

    expect(createCashMovementSpy).toHaveBeenCalledTimes(1)
    const arg = createCashMovementSpy.mock.calls[0][0]
    expect(arg).toMatchObject({
      movement_type: 'egreso_mercaderia',
      classification: 'mercaderia',
      suggested_classification: 'mercaderia',
      suggested_confidence: 1,
    })

    vi.unstubAllEnvs()
  })
})
