// @vitest-environment happy-dom
// Nada negativo (decisión del dueño, 20-nov-2026): con horas o montos negativos «Cerrar turno» queda
// deshabilitado con el motivo, y no se abre un turno con tipo de cambio 0 o negativo. Datos ficticios.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

type Entry = { id: string; employee_id: string; hours_worked: number; tip_amount_crc: number; tip_amount_usd: number; covered_role: string | null; points: null; payout_crc: null }
const state: { session: Record<string, unknown> | null; entries: Entry[] } = { session: null, entries: [] }

const api = vi.hoisted(() => ({
  updateSessionPools: vi.fn(async (_id: string, _p: Record<string, number>) => {}),
  upsertTipEntry: vi.fn(async (_e: Record<string, unknown>) => {}),
  closeTipSession: vi.fn(async () => {}),
  createTipSession: vi.fn(async () => ({ id: 'nuevo' })),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'p1', role: 'manager' } }) }))
vi.mock('../../shared/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: () => {} }))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 500) }))
vi.mock('../../shared/api/tips', () => ({
  getOpenTipSession: vi.fn(async () => state.session),
  getTipSessions: vi.fn(async () => []),
  getTipEntriesBySession: vi.fn(async () => state.entries),
  getActiveEmployees: vi.fn(async () => EMPS),
  getAllEmployees: vi.fn(async () => EMPS),
  getRoleTipPoints: vi.fn(async () => PTS),
  createTipSession: api.createTipSession, deleteTipSession: vi.fn(), deleteTipEntry: vi.fn(),
  upsertTipEntry: api.upsertTipEntry,
  updateSessionPools: api.updateSessionPools,
  savePayouts: vi.fn(async () => {}),
  closeTipSession: api.closeTipSession,
}))

const EMPS = [
  { id: 'e1', full_name: 'Sala Uno', role: 'salonero', is_active: true },
  { id: 'e2', full_name: 'Barra Uno', role: 'barman', is_active: true },
]
const PTS = [{ role: 'salonero', points: 10, recibe_propina: true }, { role: 'barman', points: 5, recibe_propina: true }]

import TipsModule from './TipsModule'

const sesion = () => ({
  id: 's1', session_date: '2026-11-16', shift_type: 'PM', status: 'open', exchange_rate: 500,
  pool_efectivo_crc: 20000, pool_efectivo_usd: 0, pool_barra_crc: 6000, pool_barra_electronico_crc: 0,
})
const entrada = (employee_id: string, hours_worked: number): Entry => ({
  id: `t-${employee_id}`, employee_id, hours_worked, tip_amount_crc: 0, tip_amount_usd: 0, covered_role: null, points: null, payout_crc: null,
})
const boton = () => screen.findByRole('button', { name: /Cerrar turno y guardar payouts/ }) as Promise<HTMLButtonElement>
const inputsDe = (nombre: string) =>
  [...(screen.getByText(nombre).closest('.tips-emp-row') as HTMLElement).querySelectorAll('input[type="number"]')] as HTMLInputElement[]

beforeEach(() => { vi.clearAllMocks(); window.confirm = vi.fn(() => true) })
afterEach(() => { cleanup() })

describe('TipsModule · cierre sin negativos', () => {
  it('horas negativas → «Las horas no pueden ser negativas», botón deshabilitado, no cierra; al corregir se habilita', async () => {
    state.session = sesion()
    state.entries = [entrada('e1', 6), entrada('e2', 8)]
    render(<TipsModule />)
    const b = await boton()
    expect(b.disabled).toBe(false)
    fireEvent.change(inputsDe('Sala Uno')[0], { target: { value: '-6' } })
    expect((await screen.findByTestId('aviso-negativos')).textContent).toBe('⚠ Las horas no pueden ser negativas: revisá a Sala Uno.')
    expect(b.disabled).toBe(true)
    fireEvent.click(b)
    expect(window.confirm).not.toHaveBeenCalled()
    expect(api.closeTipSession).not.toHaveBeenCalled()
    fireEvent.change(inputsDe('Sala Uno')[0], { target: { value: '6' } })
    await waitFor(() => expect(screen.queryByTestId('aviso-negativos')).toBeNull())
    expect(b.disabled).toBe(false)
  })

  it('propina ₡ negativa de una persona → aviso y botón deshabilitado', async () => {
    state.session = sesion()
    state.entries = [entrada('e1', 6), entrada('e2', 8)]
    render(<TipsModule />)
    const b = await boton()
    fireEvent.change(inputsDe('Sala Uno')[1], { target: { value: '-500' } })
    expect((await screen.findByTestId('aviso-negativos')).textContent).toBe('⚠ Los montos no pueden ser negativos: revisá la propina ₡ de Sala Uno.')
    expect(b.disabled).toBe(true)
  })

  it('pozo en efectivo negativo → aviso y botón deshabilitado', async () => {
    state.session = sesion()
    state.entries = [entrada('e1', 6), entrada('e2', 8)]
    render(<TipsModule />)
    const b = await boton()
    fireEvent.change(screen.getByDisplayValue('20000'), { target: { value: '-20000' } })
    expect((await screen.findByTestId('aviso-negativos')).textContent).toBe('⚠ Los montos no pueden ser negativos: revisá «💵 Efectivo ₡».')
    expect(b.disabled).toBe(true)
  })
})

describe('TipsModule · autoguardado del turno abierto sin negativos', () => {
  it('pozo negativo → no se autoguarda el pozo; al corregirlo, sí', async () => {
    state.session = sesion()
    state.entries = [entrada('e1', 6), entrada('e2', 8)]
    render(<TipsModule />)
    await boton()
    await new Promise(r => setTimeout(r, 900))           // deja pasar el autoguardado de la carga
    api.updateSessionPools.mockClear()
    fireEvent.change(screen.getByDisplayValue('20000'), { target: { value: '-20000' } })
    await new Promise(r => setTimeout(r, 1000))          // el autoguardado espera 800 ms
    expect(api.updateSessionPools).not.toHaveBeenCalled()
    fireEvent.change(screen.getByDisplayValue('-20000'), { target: { value: '15000' } })
    await waitFor(() => expect(api.updateSessionPools).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(api.updateSessionPools.mock.calls[0][1]).toMatchObject({ pool_efectivo_crc: 15000 })
  })

  it('propina negativa → esa fila no se autoguarda al salir del campo; las demás sí', async () => {
    state.session = sesion()
    state.entries = [entrada('e1', 6), entrada('e2', 8)]
    render(<TipsModule />)
    await boton()
    api.upsertTipEntry.mockClear()
    const propina = inputsDe('Sala Uno')[1]
    fireEvent.change(propina, { target: { value: '-500' } })
    fireEvent.blur(propina)
    const horasBarra = inputsDe('Barra Uno')[0]
    fireEvent.change(horasBarra, { target: { value: '7' } })
    fireEvent.blur(horasBarra)
    await waitFor(() => expect(api.upsertTipEntry).toHaveBeenCalledTimes(1))
    expect(api.upsertTipEntry.mock.calls[0][0]).toMatchObject({ employee_id: 'e2', hours_worked: 7 })
  })
})

describe('TipsModule · turno nuevo con tipo de cambio inválido', () => {
  it('tipo de cambio negativo → mensaje y no se crea el turno; con uno válido, sí', async () => {
    state.session = null
    state.entries = []
    render(<TipsModule />)
    fireEvent.click(await screen.findByRole('button', { name: /Cargar turno/ }))
    const tc = screen.getByDisplayValue('500')
    fireEvent.change(tc, { target: { value: '-500' } })
    fireEvent.click(screen.getByRole('button', { name: /Abrir turno/ }))
    expect(await screen.findByText('El tipo de cambio tiene que ser un número mayor que 0.')).toBeTruthy()
    expect(api.createTipSession).not.toHaveBeenCalled()
    fireEvent.change(tc, { target: { value: '510' } })
    fireEvent.click(screen.getByRole('button', { name: /Abrir turno/ }))
    await waitFor(() => expect(api.createTipSession).toHaveBeenCalledTimes(1))
    expect(api.createTipSession).toHaveBeenCalledWith(expect.objectContaining({ exchange_rate: 510 }))
  })
})
