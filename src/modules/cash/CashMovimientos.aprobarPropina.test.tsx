// @vitest-environment happy-dom
//
// La SEGUNDA puerta de aprobación de propinas: el select de estado por fila en Movimientos.
// La pestaña Pendientes ya saldaba las propinas por banco, pero acá se aprobaban en EFECTIVO y
// eso reabría el "ajuste fantasma ≈ propinas": propinasPagadasEnFecha atribuye el pago a la
// fecha de la SESIÓN del movimiento (el día en que se dejó pendiente, ya sellado), así que la
// salida no resta en el "debería" de ningún día y el cierre queda con un faltante.
// Regla del dueño: una propina pendiente que se salda, se salda por BANCO, desde cualquier puerta.
//
// Harness espejo de CashMovimientos.buscarNull.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { CashMovement } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  updateCashMovement: vi.fn(async (id: string, updates: Record<string, unknown>) => ({ id, updates })),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
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
const { updateCashMovement } = api

const hoy = new Date().toISOString().slice(0, 10)

const mov = (over: Partial<CashMovement>) => ({
  id: 'm-base', session_id: null, created_by: 'u1', movement_type: 'egreso_operativo',
  amount_crc: 1000, amount_usd: 0, currency: 'CRC', exchange_rate: null,
  description: 'gasto', subcategory: '', supplier_id: null,
  supplier_name: '', employee_name: '', method: 'Efectivo', shift: '',
  caja_origen: 'Caja Fuerte', status: 'pendiente', approved_by: null, approved_at: null,
  account_id: null, created_at: `${hoy}T12:00:00Z`, updated_at: `${hoy}T12:00:00Z`,
  ...over,
} as unknown as CashMovement)

// La propina que dispara el bug: quedó pendiente con la sesión de SU día (ya cerrado).
const propinaPendiente = mov({
  id: 'prop-1', movement_type: 'egreso_personal', subcategory: 'Propinas por turno',
  description: 'Propinas turno 2026-07-19 Noche', caja_origen: 'Registradora',
  session_id: 'ses-vieja', amount_crc: 30000,
})
const proveedorPendiente = mov({
  id: 'prov-1', description: 'Factura 12', supplier_name: 'Pescados del Pacífico', amount_crc: 50000,
})

const renderMovs = (movements: CashMovement[]) => render(
  <CashMovimientos movements={movements} sessions={[]} onRefresh={vi.fn()} />,
)

// La descripción se edita en un <input> (uncontrolled, commit en blur) → se ubica la fila por el
// VALOR del input, no por texto. Dentro de la fila hay varios selects; el de ESTADO es el que
// tiene la opción "Pendiente".
const selectDeEstado = (descripcionDeLaFila: string) => {
  const fila = screen.getByDisplayValue(descripcionDeLaFila).closest('tr')!
  return within(fila).getAllByRole('combobox')
    .find(s => within(s).queryByRole('option', { name: 'Pendiente' }))!
}
const cambiarEstado = (descripcionDeLaFila: string, a: 'Pagado' | 'Pendiente') =>
  fireEvent.change(selectDeEstado(descripcionDeLaFila), { target: { value: a } })

beforeEach(() => vi.clearAllMocks())

describe('CashMovimientos · aprobar una propina pendiente desde el select de estado', () => {
  it('propina → se salda por BANCO (los 3 campos), no solo el status', async () => {
    renderMovs([propinaPendiente, proveedorPendiente])

    cambiarEstado('Propinas turno 2026-07-19 Noche', 'Pagado')

    await waitFor(() => expect(updateCashMovement).toHaveBeenCalledTimes(1))
    expect(updateCashMovement.mock.calls[0][0]).toBe('prop-1')
    expect(updateCashMovement.mock.calls[0][1]).toEqual({
      status: 'aprobado', method: 'Transferencia', caja_origen: 'Banco',
    })
  })

  it('proveedor → sigue siendo solo el status, sin tocar método ni caja', async () => {
    renderMovs([propinaPendiente, proveedorPendiente])

    cambiarEstado('Factura 12', 'Pagado')

    await waitFor(() => expect(updateCashMovement).toHaveBeenCalledTimes(1))
    expect(updateCashMovement.mock.calls[0][0]).toBe('prov-1')
    expect(updateCashMovement.mock.calls[0][1]).toEqual({ status: 'aprobado' })
  })

  it('volver una propina a PENDIENTE no arrastra método ni caja — solo el status', async () => {
    const propinaAprobada = mov({
      ...propinaPendiente, status: 'aprobado',
    } as Partial<CashMovement>)
    renderMovs([propinaAprobada])

    cambiarEstado('Propinas turno 2026-07-19 Noche', 'Pendiente')

    await waitFor(() => expect(updateCashMovement).toHaveBeenCalledTimes(1))
    expect(updateCashMovement.mock.calls[0][1]).toEqual({ status: 'pendiente' })
  })
})
