// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { CashSession, Supplier, CashMovement } from '../../shared/types/database'

// F4.1 (unificación Bandeja↔Caja): el pago a proveedor cargado en Caja Diaria DEBE viajar con
// classification='mercaderia' + el snapshot suggested_* — así el trigger del server crea la tarea
// de Revisión de inventario (INV-1), igual que la Bandeja (InboxModule.MERCADERIA_CLASS).
// Test light: NO toca DB ni red — se mockea createCashMovement y se afirma con qué payload lo llama.
// El ALTA por botón se retiró en F4.3c (ahora es por el asistente "➕ Agregar"); persistPago sobrevive
// para la EDICIÓN y el cierre, así que ejercitamos la vía de edición (✏️ → Guardar cambios → persistPago).

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
// CashTurno importa AgregarAsistente → finance/classifyMovement → cliente supabase real (createClient
// tira "Web Worker is not supported" en happy-dom). Mockeamos el leaf para que el import no instancie
// el cliente; este test no ejercita el asistente. Espejo de AgregarAsistente.test.tsx.
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashTurno from './CashTurno'

const session = {
  id: 's1', cajero_name: 'Caja Test', shift_type: 'AM', session_date: '2026-06-29',
  initial_suppliers_crc: 0, initial_cash_usd: 0,
} as unknown as CashSession

const supplier = { id: 'sup-1', name: 'Pescaderia Test', is_active: true } as unknown as Supplier

// Pago a proveedor YA registrado (egreso_mercaderia en Caja Proveedores) → aparece en la lista con ✏️.
const existingPago = {
  id: 'mov-existing', movement_type: 'egreso_mercaderia', status: 'aprobado',
  caja_origen: 'Caja Proveedores', method: 'Efectivo',
  supplier_id: 'sup-1', supplier_name: 'Pescaderia Test',
  amount_crc: 15000, amount_usd: 0, description: 'pago previo',
  created_at: '2026-06-29T10:00:00Z',
} as unknown as CashMovement

describe('CashTurno — el pago a proveedor se clasifica como mercadería (F4.1)', () => {
  it('editar un pago → persistPago llama createCashMovement con classification=mercaderia + snapshot', async () => {
    // Env de supabase para que cualquier import transitivo no tire (no se conecta a nada).
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')

    render(
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

    // Editar el pago existente (✏️) → abre el modal precargado en modo edición.
    fireEvent.click(screen.getByTitle('Editar'))

    // El proveedor y el monto vienen precargados → Guardar cambios → confirmPago → persistPago.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '✓ Guardar cambios' }))
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
