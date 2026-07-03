// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import type { CashSession, Supplier, CashMovement } from '../../shared/types/database'

// T3-B — nota "⚠ sin foto" en la lista de "Pagos a proveedores" del día: un pago de mercadería
// GUARDADO sin factura enlazada (documents.linked_movement_id, mismo mecanismo que CashMovimientos
// vía listLinkedDocs) y sin fotos adjuntas muestra la nota para control del manager. Con factura
// enlazada (o con fotos adjuntas del propio pago) NO se muestra. Solo lectura — cero writes.
// Harness espejo de CashTurno.mercaderia.test.tsx.

const { listLinkedDocsSpy, movementAttachmentsSpy } = vi.hoisted(() => ({
  listLinkedDocsSpy: vi.fn(async (): Promise<{ linked_movement_id: string | null }[]> => []),
  movementAttachmentsSpy: vi.fn((): string[] => []),
}))

vi.mock('../../shared/api/cash', () => ({
  createCashMovement: vi.fn(),
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
  movementAttachments: movementAttachmentsSpy,
}))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: listLinkedDocsSpy }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashTurno from './CashTurno'

const session = {
  id: 's1', cajero_name: 'Caja Test', shift_type: 'AM', session_date: '2026-07-02',
  initial_suppliers_crc: 0, initial_cash_usd: 0,
} as unknown as CashSession

const supplier = { id: 'sup-1', name: 'Pescaderia Test', is_active: true } as unknown as Supplier

// Pago a proveedor GUARDADO (egreso_mercaderia → persistedId = m.id) — el caso de la nota.
const existingPago = {
  id: 'mov-existing', movement_type: 'egreso_mercaderia', status: 'aprobado',
  caja_origen: 'Caja Proveedores', method: 'Efectivo',
  supplier_id: 'sup-1', supplier_name: 'Pescaderia Test',
  amount_crc: 15000, amount_usd: 0, description: 'pago previo',
  created_at: '2026-07-02T10:00:00Z',
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

describe('CashTurno — nota "⚠ sin foto" en pagos de mercadería (T3-B)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    listLinkedDocsSpy.mockClear()
    listLinkedDocsSpy.mockResolvedValue([])
    movementAttachmentsSpy.mockReturnValue([])
  })

  it('pago guardado SIN factura enlazada ni fotos adjuntas → muestra "⚠ sin foto"', async () => {
    renderTurno()
    await waitFor(() => expect(screen.getByText(/⚠ sin foto/)).toBeTruthy())
    expect(listLinkedDocsSpy).toHaveBeenCalledTimes(1)   // el mecanismo espejado: una consulta al montar
  })

  it('pago CON factura enlazada (linked_movement_id) → no muestra la nota', async () => {
    listLinkedDocsSpy.mockResolvedValue([{ linked_movement_id: 'mov-existing' }])
    renderTurno()
    await waitFor(() => expect(screen.getByText('Pescaderia Test')).toBeTruthy())
    // Flush explícito: que docsLoaded ya esté seteado antes de afirmar la AUSENCIA de la nota
    // (sin esto la aserción podría pasar en falso, con la carga de docs todavía en vuelo).
    await act(async () => { await Promise.resolve() })
    expect(listLinkedDocsSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/⚠ sin foto/)).toBeNull()
  })

  it('pago con fotos adjuntas propias (attachments) → no muestra la nota', async () => {
    movementAttachmentsSpy.mockReturnValue(['facturas/foto1.jpg'])
    renderTurno()
    await waitFor(() => expect(screen.getByText('Pescaderia Test')).toBeTruthy())
    await act(async () => { await Promise.resolve() })   // docsLoaded seteado (ver test anterior)
    expect(screen.queryByText(/⚠ sin foto/)).toBeNull()
  })
})
