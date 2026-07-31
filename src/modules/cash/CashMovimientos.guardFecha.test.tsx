// @vitest-environment happy-dom
//
// Ítem 4 — guard de fecha en "Nuevo movimiento" (pestaña Movimientos):
//   · default HOY.
//   · FUTURO: bloqueado para TODOS.
//   · PASADO: bloqueado para cajero/salonero; permitido con confirmación para owner/manager/contador
//     (gate por ROL, Camino 1 — sin contraseña ni RPC); confirmación REFORZADA si el día ya tiene un
//     cierre COMPLETO sellado.
// Harness espejo de CashMovimientos.aprobarPropina.test.tsx — sin DB ni red.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'

const auth = vi.hoisted(() => ({ role: 'cajero' as string }))
const cashApi = vi.hoisted(() => ({
  createDayMovement: vi.fn(async (m: { fecha: string }) => m),
  getCierresDia: vi.fn(async () => [] as unknown[]),
}))
vi.mock('../../shared/api/cash', () => ({
  updateCashMovement: vi.fn(),
  deleteCashMovement: vi.fn(),
  createDayMovement: cashApi.createDayMovement,
  getCierresDia: cashApi.getCierresDia,
}))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/api/facturas', () => ({ movementAttachments: vi.fn((): string[] => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: auth.role, full_name: 'Test' } }),
}))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashMovimientos from './CashMovimientos'
import { todayCR } from '../../shared/utils'
const { createDayMovement, getCierresDia } = cashApi

const hoy = todayCR()
const PASADO = '2020-01-01'   // < hoy siempre
const FUTURO = '2999-12-31'   // > hoy siempre

// Renderiza como `role`, deja cargar los cierres del mount y abre el modal "Nuevo movimiento".
async function abrirModal(role: string, cierres: unknown[] = []) {
  auth.role = role
  getCierresDia.mockResolvedValue(cierres)
  render(<CashMovimientos movements={[]} sessions={[]} onRefresh={vi.fn()} />)
  await waitFor(() => expect(getCierresDia).toHaveBeenCalled())
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })   // aplica setCierres del mount
  fireEvent.click(screen.getByRole('button', { name: /Nuevo movimiento/ }))
}
const modalRoot = () => screen.getByText('Nuevo movimiento').closest('.cd-modal') as HTMLElement
const dateInput = () => screen.getByLabelText('Fecha del movimiento') as HTMLInputElement
const setMonto  = (v: string) => fireEvent.change(within(modalRoot()).getAllByRole('spinbutton')[0], { target: { value: v } })
const setFecha  = (v: string) => fireEvent.change(dateInput(), { target: { value: v } })
const registrar = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Registrar/ })) }) }

beforeEach(() => {
  vi.clearAllMocks()
  auth.role = 'cajero'
  getCierresDia.mockResolvedValue([])
  window.confirm = vi.fn(() => true)
})

describe('CashMovimientos · Nuevo movimiento — el input por rol', () => {
  it('cajero: input fijo en hoy (min = max = hoy) + mensaje de pedir encargado', async () => {
    await abrirModal('cajero')
    expect(dateInput().getAttribute('min')).toBe(hoy)
    expect(dateInput().getAttribute('max')).toBe(hoy)
    expect(screen.getByText(/Pedí a un encargado, dueño o contador/i)).toBeTruthy()
  })

  it('owner: input permite pasado (sin min, max = hoy) y sin mensaje de bloqueo', async () => {
    await abrirModal('owner')
    expect(dateInput().getAttribute('min')).toBeNull()
    expect(dateInput().getAttribute('max')).toBe(hoy)
    expect(screen.queryByText(/Pedí a un encargado/i)).toBeNull()
  })
})

describe('CashMovimientos · Nuevo movimiento — guard de fecha', () => {
  it('HOY (default): crea sin confirmación, incluso cajero', async () => {
    await abrirModal('cajero')
    setMonto('5000')
    await registrar()
    expect(window.confirm).not.toHaveBeenCalled()
    expect(createDayMovement).toHaveBeenCalledTimes(1)
    expect(createDayMovement.mock.calls[0][0].fecha).toBe(hoy)
  })

  it('FUTURO: bloqueado para TODOS (incluye owner)', async () => {
    await abrirModal('owner')
    setMonto('5000'); setFecha(FUTURO)
    await registrar()
    expect(createDayMovement).not.toHaveBeenCalled()
    expect(screen.getByText(/fecha futura/i)).toBeTruthy()
  })

  it('PASADO · cajero: bloqueado (no crea); ve el mensaje de pedir encargado/dueño/contador', async () => {
    await abrirModal('cajero')
    setMonto('5000'); setFecha(PASADO)
    await registrar()
    expect(createDayMovement).not.toHaveBeenCalled()
    // El texto aparece en el hint fijo del input Y en el error del guard → getAllByText.
    expect(screen.getAllByText(/Pedí a un encargado, dueño o contador/i).length).toBeGreaterThanOrEqual(1)
  })

  it('PASADO · salonero: también bloqueado', async () => {
    await abrirModal('salonero')
    setMonto('5000'); setFecha(PASADO)
    await registrar()
    expect(createDayMovement).not.toHaveBeenCalled()
  })

  it('PASADO · manager: permitido con confirmación normal → crea con esa fecha', async () => {
    await abrirModal('manager')
    setMonto('5000'); setFecha(PASADO)
    await registrar()
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/pasada/i))
    expect(createDayMovement).toHaveBeenCalledTimes(1)
    expect(createDayMovement.mock.calls[0][0].fecha).toBe(PASADO)
  })

  it('PASADO · contador: también habilitado (gate por rol)', async () => {
    await abrirModal('contador')
    setMonto('5000'); setFecha(PASADO)
    await registrar()
    expect(createDayMovement).toHaveBeenCalledTimes(1)
  })

  it('PASADO · owner cancela la confirmación → NO crea', async () => {
    window.confirm = vi.fn(() => false)
    await abrirModal('owner')
    setMonto('5000'); setFecha(PASADO)
    await registrar()
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(createDayMovement).not.toHaveBeenCalled()
  })

  it('PASADO en día con cierre COMPLETO: confirmación REFORZADA (día cerrado)', async () => {
    await abrirModal('owner', [{ session_date: PASADO, tipo: 'completo' }])
    setMonto('5000'); setFecha(PASADO)
    await registrar()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/ya está cerrado/i))
    expect(createDayMovement).toHaveBeenCalledTimes(1)
  })

  it('PASADO en día con cierre PARCIAL (no completo): confirmación normal, no reforzada', async () => {
    await abrirModal('owner', [{ session_date: PASADO, tipo: 'parcial_mediodia' }])
    setMonto('5000'); setFecha(PASADO)
    await registrar()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/pasada/i))
    expect(createDayMovement).toHaveBeenCalledTimes(1)
  })
})
