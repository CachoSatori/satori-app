// @vitest-environment happy-dom
//
// Ítem 4 — guard de fecha en la APERTURA de Caja Diaria: el turno se abre SIEMPRE con la fecha de
// HOY. Ni pasado ni futuro, para nadie (los turnos no se backdatean). El input queda fijo en hoy
// (min=max) y handleApertura revalida `apFecha === todayStr()` antes de crear la sesión.
// Harness espejo de CashTurno.gastadoEfectivo.test.tsx — sin DB ni red.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { todayCR } from '../../shared/utils'

const cashApi = vi.hoisted(() => ({
  createCashSession: vi.fn(async (m: { session_date: string }) => ({ id: 's-new', ...m })),
}))
vi.mock('../../shared/api/cash', () => ({
  createCashMovement: vi.fn(),
  createCashSession: cashApi.createCashSession,
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
  getActiveEmployees: vi.fn(async () => [{ id: 'e1', full_name: 'Caja Test' }]),
  getTipPayoutsSince: vi.fn(async () => []),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 500) }))
vi.mock('../../shared/api/facturas', () => ({ uploadFacturaPhoto: vi.fn(), movementAttachments: vi.fn(() => []) }))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashTurno from './CashTurno'
const { createCashSession } = cashApi

const hoy = todayCR()
const PASADO = '2020-01-01'   // < hoy siempre
const FUTURO = '2999-12-31'   // > hoy siempre

function renderApertura() {
  const onError = vi.fn()
  const onSessionOpen = vi.fn()
  render(
    <CashTurno
      openSession={null} suppliers={[]} sessions={[]} sessionMovements={[]} allMovements={[]}
      onSessionOpen={onSessionOpen} onSessionClose={vi.fn()} onMovAdded={vi.fn()} onError={onError} onRefresh={vi.fn()}
    />,
  )
  return { onError, onSessionOpen }
}
const fechaInput = () => screen.getByLabelText('Fecha de apertura')
const abrir = () => fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR APERTURA/i }))

beforeEach(() => vi.clearAllMocks())

describe('CashTurno · apertura fija en HOY (Ítem 4)', () => {
  it('el input de fecha queda acotado a hoy (min = max = hoy)', () => {
    renderApertura()
    expect(fechaInput().getAttribute('min')).toBe(hoy)
    expect(fechaInput().getAttribute('max')).toBe(hoy)
  })

  it('fecha PASADA → no abre el turno y avisa', () => {
    const { onError } = renderApertura()
    fireEvent.change(fechaInput(), { target: { value: PASADO } })
    abrir()
    expect(createCashSession).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/HOY/))
  })

  it('fecha FUTURA → no abre el turno y avisa', () => {
    const { onError } = renderApertura()
    fireEvent.change(fechaInput(), { target: { value: FUTURO } })
    abrir()
    expect(createCashSession).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/HOY/))
  })

  it('fecha HOY → abre el turno con session_date = hoy', async () => {
    renderApertura()
    fireEvent.change(fechaInput(), { target: { value: hoy } })
    abrir()
    await waitFor(() => expect(createCashSession).toHaveBeenCalledTimes(1))
    expect(createCashSession.mock.calls[0][0].session_date).toBe(hoy)
  })
})
