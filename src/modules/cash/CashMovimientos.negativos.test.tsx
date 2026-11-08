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

describe('CashMovimientos · edición inline — vuelto en colones de un ingreso con dólares (08-nov)', () => {
  it('ingreso con $ y ₡ negativos (vuelto): SÍ updatea', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'venta en dólares', movement_type: 'ingreso', amount_crc: -1200, amount_usd: 40 })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const fila = screen.getByDisplayValue('venta en dólares').closest('tr') as HTMLElement
    const crc = within(fila).getAllByRole('spinbutton')[0]
    fireEvent.change(crc, { target: { value: '-1500' } })
    await act(async () => { fireEvent.blur(crc) })
    expect(window.alert).not.toHaveBeenCalled()
    expect(updateCashMovement).toHaveBeenCalledWith('m1', { amount_crc: -1500 })
  })

  it('ingreso SIN dólares y ₡ negativos: avisa y NO updatea', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'ingreso sin dólares', movement_type: 'ingreso', amount_crc: 1000, amount_usd: 0 })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const fila = screen.getByDisplayValue('ingreso sin dólares').closest('tr') as HTMLElement
    const crc = within(fila).getAllByRole('spinbutton')[0]
    fireEvent.change(crc, { target: { value: '-100' } })
    await act(async () => { fireEvent.blur(crc) })
    expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/vuelto/))
    expect(updateCashMovement).not.toHaveBeenCalled()
  })

  it('ingreso con ₡ negativos: llevar los $ a 0 deja un negativo sin vuelto → avisa y NO updatea', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'vuelto sin dólares', movement_type: 'ingreso', amount_crc: -1200, amount_usd: 40 })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const fila = screen.getByDisplayValue('vuelto sin dólares').closest('tr') as HTMLElement
    const usd = within(fila).getAllByRole('spinbutton')[1]
    fireEvent.change(usd, { target: { value: '0' } })
    await act(async () => { fireEvent.blur(usd) })
    expect(window.alert).toHaveBeenCalled()
    expect(updateCashMovement).not.toHaveBeenCalled()
  })

  it('egreso con ₡ negativos: sigue bloqueado', async () => {
    render(<CashMovimientos movements={[mkMov({ description: 'egreso con dólares', amount_crc: 1000, amount_usd: 10 })]} sessions={[]} onRefresh={vi.fn()} />)
    await flush()
    const fila = screen.getByDisplayValue('egreso con dólares').closest('tr') as HTMLElement
    const crc = within(fila).getAllByRole('spinbutton')[0]
    fireEvent.change(crc, { target: { value: '-100' } })
    await act(async () => { fireEvent.blur(crc) })
    expect(updateCashMovement).not.toHaveBeenCalled()
  })
})
