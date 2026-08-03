// @vitest-environment happy-dom
//
// Ítem 2 — la CARGA MANUAL no admite montos negativos, en los dos puntos de CashMovimientos:
//   · modal "Nuevo movimiento" (nmCRC/nmUSD) → no crea, avisa.
//   · edición inline de la tabla (amount_crc/amount_usd on blur) → no updatea, avisa y revierte (onRefresh).
// Harness espejo de CashMovimientos.aprobarPropina.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import type { CashMovement } from '../../shared/types/database'

const cashApi = vi.hoisted(() => ({
  updateCashMovement: vi.fn(async () => ({})),
  createDayMovement: vi.fn(async (m: { fecha?: string }) => m),
  getCierresDia: vi.fn(async () => [] as unknown[]),
}))
vi.mock('../../shared/api/cash', () => ({
  updateCashMovement: cashApi.updateCashMovement,
  deleteCashMovement: vi.fn(),
  createDayMovement: cashApi.createDayMovement,
  getCierresDia: cashApi.getCierresDia,
}))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/api/facturas', () => ({ movementAttachments: vi.fn((): string[] => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'M' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashMovimientos from './CashMovimientos'
import { todayCR } from '../../shared/utils'
const { updateCashMovement, createDayMovement, getCierresDia } = cashApi

const hoy = todayCR()
const mkMov = (over: Partial<CashMovement>): CashMovement => ({
  id: 'm1', session_id: null, created_by: 'u1', movement_type: 'egreso_operativo',
  amount_crc: 5000, amount_usd: 0, currency: 'CRC', exchange_rate: null,
  description: 'gasto suelto', subcategory: '', supplier_id: null, supplier_name: '', employee_name: '',
  method: 'Efectivo', shift: '', caja_origen: 'Caja Fuerte', status: 'aprobado', approved_by: null,
  approved_at: null, account_id: null, created_at: `${hoy}T12:00:00Z`, updated_at: `${hoy}T12:00:00Z`, ...over,
} as unknown as CashMovement)

const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

beforeEach(() => { vi.clearAllMocks(); getCierresDia.mockResolvedValue([]); window.alert = vi.fn() })

describe('CashMovimientos · Nuevo movimiento — monto negativo (Ítem 2)', () => {
  it('₡ negativo: no crea y avisa', async () => {
    render(<CashMovimientos movements={[]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /Nuevo movimiento/ }))
    const modal = screen.getByText('Nuevo movimiento').closest('.cd-modal') as HTMLElement
    fireEvent.change(within(modal).getAllByRole('spinbutton')[0], { target: { value: '-100' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Registrar/ })) })
    expect(createDayMovement).not.toHaveBeenCalled()
    expect(screen.getByText(/no puede ser negativo/i)).toBeTruthy()
  })
})

describe('CashMovimientos · edición inline — monto negativo (Ítem 2)', () => {
  it('blur de amount_crc a < 0: avisa, revierte (onRefresh) y NO updatea', async () => {
    const onRefresh = vi.fn()
    render(<CashMovimientos movements={[mkMov({ description: 'gasto editable' })]} sessions={[]} onRefresh={onRefresh} />)
    await flush()
    const fila = screen.getByDisplayValue('gasto editable').closest('tr') as HTMLElement
    const crc = within(fila).getAllByRole('spinbutton')[0]
    fireEvent.change(crc, { target: { value: '-100' } })
    await act(async () => { fireEvent.blur(crc) })
    expect(window.alert).toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalled()
    expect(updateCashMovement).not.toHaveBeenCalled()
  })

  it('blur de amount_crc a un valor válido (≥ 0): sí updatea', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'gasto ok' })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const fila = screen.getByDisplayValue('gasto ok').closest('tr') as HTMLElement
    const crc = within(fila).getAllByRole('spinbutton')[0]
    fireEvent.change(crc, { target: { value: '7000' } })
    await act(async () => { fireEvent.blur(crc) })
    expect(window.alert).not.toHaveBeenCalled()
    expect(updateCashMovement).toHaveBeenCalledWith('m1', { amount_crc: 7000 })
  })
})
