// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { CashMovement } from '../../shared/types/database'
import { POZO_CORTE } from './cierrePozo'

// Ítem 1a (UI): el <select> de "Tipo" de la FILA no ofrece 'traspaso' como destino de conversión
// (un traspaso necesita dirección legible 'A → B', que ese select no captura). Se conserva la opción
// SOLO si la fila YA es traspaso, para que se muestre bien. El <select> de FILTRO de arriba SÍ tiene
// Traspaso (no se toca).

vi.mock('../../shared/api/cash', () => ({
  updateCashMovement: vi.fn(), deleteCashMovement: vi.fn(), getCierresDia: vi.fn(async () => []), createDayMovement: vi.fn(),
}))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/api/facturas', () => ({ movementAttachments: vi.fn(() => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'owner', full_name: 'Dueño' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashMovimientos from './CashMovimientos'

let n = 0
const mov = (p: Partial<CashMovement>): CashMovement => {
  n += 1
  return {
    id: p.id ?? `m${n}`, session_id: null, created_by: 'u1',
    movement_type: p.movement_type ?? 'ingreso',
    amount_crc: p.amount_crc ?? 1000, amount_usd: 0, currency: 'CRC', exchange_rate: 500,
    description: p.description ?? 'x', subcategory: p.subcategory ?? '',
    supplier_id: null, supplier_name: null, employee_name: null,
    method: 'Efectivo', shift: '', caja_origen: p.caja_origen ?? 'Caja Fuerte',
    status: 'aprobado', approved_by: null, approved_at: null, account_id: null,
    created_at: `${POZO_CORTE}T12:00:00+00:00`, updated_at: `${POZO_CORTE}T12:00:00+00:00`,
  } as CashMovement
}

// El <select> de "Tipo" de la fila es el ÚNICO combobox cuyo value es el movement_type del movimiento.
const rowTypeSelect = (value: string) => {
  const s = screen.getAllByRole('combobox').find(el => (el as HTMLSelectElement).value === value)
  if (!s) throw new Error(`no encontré el select de tipo con value=${value}`)
  return s
}
const optionValues = (sel: HTMLElement) =>
  within(sel).queryAllByRole('option').map(o => o.getAttribute('value'))

describe('CashMovimientos — el select inline de Tipo no ofrece traspaso (ítem 1a)', () => {
  it('una fila NO-traspaso: el select ofrece los tipos pero NO "traspaso"', () => {
    render(<CashMovimientos movements={[mov({ movement_type: 'ingreso' })]} sessions={[]} onRefresh={vi.fn()} />)
    const sel = rowTypeSelect('ingreso')
    const vals = optionValues(sel)
    expect(vals).toContain('ingreso')
    expect(vals).not.toContain('traspaso')
  })

  it('una fila que YA es traspaso: conserva la opción "traspaso" para mostrarse bien', () => {
    render(<CashMovimientos movements={[mov({ movement_type: 'traspaso', subcategory: 'Caja Fuerte → Banco' })]} sessions={[]} onRefresh={vi.fn()} />)
    const sel = rowTypeSelect('traspaso')
    expect(optionValues(sel)).toContain('traspaso')
  })
})
