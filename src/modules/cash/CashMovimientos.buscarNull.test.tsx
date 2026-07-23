// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CashMovement } from '../../shared/types/database'

// HOTFIX buscador — en la BASE supplier_name/employee_name son NULLABLE (supabase.gen.ts) y hay
// movimientos viejos con null; getCashMovements castea la fila cruda (`data as CashMovement[]`),
// así que el null llega intacto al componente. El filtro llamaba .toLowerCase() directo sobre esos
// campos → tipear en "Buscar..." tiraba la pantalla al ErrorBoundary en prod. Harness espejo de
// CashTurno.sinFoto.test.tsx.

vi.mock('../../shared/api/cash', () => ({
  updateCashMovement: vi.fn(),
  deleteCashMovement: vi.fn(),
  getCierresDia: vi.fn(async () => []),
  createDayMovement: vi.fn(),
}))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/api/facturas', () => ({ movementAttachments: vi.fn((): string[] => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Manager Test' } }),
}))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashMovimientos from './CashMovimientos'
import { todayCR } from '../../shared/utils'

// FECHA DEL FIXTURE EN HORA DE COSTA RICA, no UTC.
// El filtro de Movimientos acota con `todayCR()`; un `new Date().toISOString()` da la fecha UTC,
// que entre las 18:00 y la medianoche de CR ya es EL DÍA SIGUIENTE. El movimiento quedaba
// fechado mañana, el filtro lo dejaba fuera y estos tests fallaban solo de noche — un flake
// que no probaba nada del código.
const hoy = todayCR()

const mov = (over: Partial<CashMovement>) => ({
  id: 'm-base', session_id: null, created_by: 'u1', movement_type: 'egreso_operativo',
  amount_crc: 1000, amount_usd: 0, currency: 'CRC', exchange_rate: null,
  description: 'gasto', subcategory: '', supplier_id: null,
  supplier_name: '', employee_name: '', method: 'Efectivo', shift: '',
  caja_origen: 'Caja Fuerte', status: 'aprobado', approved_by: null, approved_at: null,
  account_id: null, created_at: `${hoy}T12:00:00Z`, updated_at: `${hoy}T12:00:00Z`,
  ...over,
} as unknown as CashMovement)

// El movimiento que revienta hoy en prod: ambos nombres en NULL (fila vieja de la base).
const movNull = mov({
  id: 'm-null', description: 'Compra sin proveedor',
  supplier_name: null, employee_name: null,
})
const movConNombre = mov({ id: 'm-prov', description: 'Pescado', supplier_name: 'Pescaderia Test' })

const renderMovs = (movements: CashMovement[]) => render(
  <CashMovimientos movements={movements} sessions={[]} onRefresh={vi.fn()} />,
)

const buscar = (texto: string) =>
  fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: texto } })

describe('CashMovimientos · buscador con supplier_name/employee_name NULL', () => {
  it('no revienta al tipear con un movimiento de nombres null, y filtra por descripción', () => {
    renderMovs([movNull, movConNombre])
    // El crash de prod era acá: .toLowerCase() sobre null al tipear.
    expect(() => buscar('compra')).not.toThrow()
    expect(screen.getByText('Compra sin proveedor')).toBeTruthy()
    expect(screen.queryByText('Pescado')).toBeNull()
  })

  it('sigue filtrando por nombre de proveedor con filas de nombres null presentes', () => {
    renderMovs([movNull, movConNombre])
    buscar('pescaderia')
    expect(screen.getByText('Pescado')).toBeTruthy()
    expect(screen.queryByText('Compra sin proveedor')).toBeNull()
  })

  it('la fila de nombres null se excluye si no matchea, sin romper el filtro', () => {
    renderMovs([movNull, movConNombre])
    buscar('zzzz-no-existe')
    expect(screen.queryByText('Compra sin proveedor')).toBeNull()
    expect(screen.queryByText('Pescado')).toBeNull()
  })
})
