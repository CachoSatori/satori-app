// @vitest-environment happy-dom
// Bloqueo del cierre (H1/H2): con pozo que nadie cobra, «Cerrar turno» queda deshabilitado con aviso
// arriba; el cierre normal queda igual (el botón cierra y guarda los payouts). Datos ficticios.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

type Entry = { id: string; employee_id: string; hours_worked: number; tip_amount_crc: number; tip_amount_usd: number; covered_role: string | null; points: null; payout_crc: null }
const state: { session: Record<string, unknown>; entries: Entry[] } = { session: {}, entries: [] }

const api = vi.hoisted(() => ({
  updateSessionPools: vi.fn(async () => {}),
  savePayouts: vi.fn(async () => {}),
  closeTipSession: vi.fn(async () => {}),
  upsertTipEntry: vi.fn(async () => {}),
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
  createTipSession: vi.fn(), deleteTipSession: vi.fn(), deleteTipEntry: vi.fn(),
  upsertTipEntry: api.upsertTipEntry,
  updateSessionPools: api.updateSessionPools,
  savePayouts: api.savePayouts,
  closeTipSession: api.closeTipSession,
}))

const EMPS = [
  { id: 'e1', full_name: 'Sala Uno', role: 'salonero', is_active: true },
  { id: 'e2', full_name: 'Barra Uno', role: 'barman', is_active: true },
  { id: 'e3', full_name: 'Sala Dos', role: 'salonero', is_active: true },
  { id: 'e4', full_name: 'Sala Tres', role: 'salonero', is_active: true },
]
const PTS = [{ role: 'salonero', points: 10, recibe_propina: true }, { role: 'barman', points: 5, recibe_propina: true }]

import TipsModule from './TipsModule'

const sesion = (pools: Partial<Record<string, number>>) => ({
  id: 's1', session_date: '2026-11-16', shift_type: 'PM', status: 'open', exchange_rate: 500,
  pool_efectivo_crc: 0, pool_efectivo_usd: 0, pool_barra_crc: 0, pool_barra_electronico_crc: 0, ...pools,
})
const entrada = (employee_id: string, hours_worked: number, covered_role: string | null = null): Entry => ({
  id: `t-${employee_id}`, employee_id, hours_worked, tip_amount_crc: 0, tip_amount_usd: 0, covered_role, points: null, payout_crc: null,
})
const boton = () => screen.findByRole('button', { name: /Cerrar turno y guardar payouts/ })

beforeEach(() => { vi.clearAllMocks(); window.confirm = vi.fn(() => true) })
afterEach(() => { cleanup() })

describe('TipsModule — bloqueo del cierre por pozo que nadie cobra', () => {
  it('flujo feliz: sin aviso, botón habilitado y el cierre guarda payouts como siempre', async () => {
    state.session = sesion({ pool_efectivo_crc: 20000, pool_barra_crc: 6000 })
    state.entries = [entrada('e1', 6), entrada('e2', 8)]
    render(<TipsModule />)
    const b = await boton()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('aviso-sin-repartir')).toBeNull()
    expect((b as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(b)
    await waitFor(() => expect(api.closeTipSession).toHaveBeenCalledWith('s1', 'p1'))
    expect(api.savePayouts).toHaveBeenCalledTimes(1)
  })

  it('H1: barra electrónico > 0 y la barra sin horas → aviso y botón deshabilitado, no cierra', async () => {
    state.session = sesion({ pool_efectivo_crc: 20000, pool_barra_electronico_crc: 7500 })
    state.entries = [entrada('e1', 6)]
    render(<TipsModule />)
    const b = await boton()
    const alerta = screen.getByRole('alert')
    expect(alerta.textContent).toContain('Nadie de barra tiene horas cargadas. Cargá las horas de barra')
    // Aviso del 20-nov arriba del botón: monto sin repartir (salida del reparto) y motivo.
    expect(screen.getByTestId('aviso-sin-repartir').textContent).toBe(
      '⚠ Quedan ₡7.500 sin repartir: hay propina de barra y nadie de barra tiene horas. Revisá las horas o los puntos antes de guardar.')
    expect((b as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(b)
    expect(window.confirm).not.toHaveBeenCalled()
    expect(api.closeTipSession).not.toHaveBeenCalled()
  })

  it('el aviso se va cuando se corrige: cargar horas a la barra lo oculta y habilita el botón', async () => {
    state.session = sesion({ pool_efectivo_crc: 20000, pool_barra_crc: 6000 })
    state.entries = [entrada('e1', 6), entrada('e2', 0)]
    render(<TipsModule />)
    const b = await boton()
    expect(screen.getByTestId('aviso-sin-repartir').textContent).toContain('Quedan ₡6.000 sin repartir')
    const filaBarra = screen.getByText('Barra Uno').closest('.tips-emp-row') as HTMLElement
    const horasBarra = filaBarra.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(horasBarra, { target: { value: '8' } })
    await waitFor(() => expect(screen.queryByTestId('aviso-sin-repartir')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    expect((b as HTMLButtonElement).disabled).toBe(false)
  })

  it('un solo monto en la caja roja: barra ₡10.000 y 3 saloneros con ₡100 → «Quedan ₡10.001» y la guarda sin cifra', async () => {
    // 3 × round(33,33) = ₡99 cobrados de ₡10.100 → quedan ₡10.001 (la guarda vieja decía «Hay ₡10.000»).
    state.session = sesion({ pool_efectivo_crc: 100, pool_barra_crc: 10000 })
    state.entries = [entrada('e1', 1), entrada('e3', 1), entrada('e4', 1)]
    render(<TipsModule />)
    await boton()
    const caja = screen.getByRole('alert').textContent ?? ''
    expect(caja).toContain('Quedan ₡10.001 sin repartir')
    expect(caja.match(/₡\s?[\d.]+/g)).toEqual(['₡10.001'])
  })

  it('H1 con cobertura: el barman cubrió sala → la barra queda sin horas → bloquea', async () => {
    state.session = sesion({ pool_barra_crc: 3000, pool_efectivo_crc: 1000 })
    state.entries = [entrada('e1', 6), entrada('e2', 8, 'salonero')]
    render(<TipsModule />)
    const b = await boton()
    expect(screen.getByRole('alert').textContent).toContain('Quedan ₡3.000 sin repartir: hay propina de barra')
    expect((b as HTMLButtonElement).disabled).toBe(true)
  })

  it('H2: pozo general > 0 y nadie con puntos → aviso y botón deshabilitado', async () => {
    state.session = sesion({ pool_efectivo_usd: 10 })
    state.entries = [entrada('e1', 0)]
    // e1 con 0 horas igual queda marcado (tiene entrada) → aparece el botón.
    render(<TipsModule />)
    const b = await boton()
    expect(screen.getByRole('alert').textContent).toContain('Nadie del turno tiene puntos. Revisá los roles o las horas antes de cerrar.')
    expect(screen.getByTestId('aviso-sin-repartir').textContent).toContain('Quedan ₡5.000 sin repartir: hay pozo para repartir y nadie del turno tiene puntos u horas.')
    expect((b as HTMLButtonElement).disabled).toBe(true)
  })
})
