// @vitest-environment happy-dom
// Caso de la validación física del dueño (23-nov-2026, Propinas → Turno actual), tipeado como en el navegador:
// en los cuadros de propina, que traen «0», se escribe «-450» (₡ de una persona) y «-200» ($ de otra); el
// navegador deja «0-450» a la vista y su `value` es "" (inputNumeroComoChrome.testutil.ts). Antes eso se validaba
// y se guardaba como 0: al corregir solo «Efectivo $» el aviso desaparecía y «Cerrar turno» se habilitaba.
// Ahora lo que se ve es lo que se valida. Datos ficticios.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { imitarInputNumeroDeChrome, textoVisible } from './inputNumeroComoChrome.testutil'

type Entry = { id: string; employee_id: string; hours_worked: number; tip_amount_crc: number; tip_amount_usd: number; covered_role: string | null; points: null; payout_crc: null }
const state: { entries: Entry[] } = { entries: [] }

const api = vi.hoisted(() => ({
  updateSessionPools: vi.fn<(id: string, pools: Record<string, number>) => Promise<void>>(async () => {}),
  upsertTipEntry: vi.fn<(entrada: Record<string, unknown>) => Promise<void>>(async () => {}),
  closeTipSession: vi.fn(async () => {}),
  refetch: (() => {}) as () => void,
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'p1', role: 'owner' } }) }))
vi.mock('../../shared/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: (_c: string, _t: string[], cb: () => void) => { api.refetch = cb } }))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 500) }))
vi.mock('../../shared/api/tips', () => ({
  getOpenTipSession: vi.fn(async () => SESION),
  getTipSessions: vi.fn(async () => []),
  getTipEntriesBySession: vi.fn(async () => state.entries),
  getActiveEmployees: vi.fn(async () => EMPS),
  getAllEmployees: vi.fn(async () => EMPS),
  getRoleTipPoints: vi.fn(async () => PTS),
  createTipSession: vi.fn(), deleteTipSession: vi.fn(), deleteTipEntry: vi.fn(),
  upsertTipEntry: api.upsertTipEntry,
  updateSessionPools: api.updateSessionPools,
  savePayouts: vi.fn(async () => {}),
  closeTipSession: api.closeTipSession,
}))

const EMPS = [
  { id: 'e1', full_name: 'Ana Sala', role: 'salonero', is_active: true },
  { id: 'e2', full_name: 'Beto Sala', role: 'salonero', is_active: true },
  { id: 'e3', full_name: 'Barra Uno', role: 'barman', is_active: true },
]
const PTS = [{ role: 'salonero', points: 10, recibe_propina: true }, { role: 'barman', points: 5, recibe_propina: true }]
const SESION = {
  id: 's1', session_date: '2026-11-16', shift_type: 'PM', status: 'open', exchange_rate: 500,
  pool_efectivo_crc: 20000, pool_efectivo_usd: 0, pool_barra_crc: 6000, pool_barra_electronico_crc: 0,
}
const entrada = (employee_id: string, hours_worked: number): Entry => ({
  id: `t-${employee_id}`, employee_id, hours_worked, tip_amount_crc: 0, tip_amount_usd: 0, covered_role: null, points: null, payout_crc: null,
})

import TipsModule from './TipsModule'

// Inputs de una fila: [horas, electrónico ₡, electrónico $] (saloneros).
const inputsDe = (nombre: string) =>
  [...(screen.getByText(nombre).closest('.tips-emp-row') as HTMLElement).querySelectorAll('input[type="number"]')] as HTMLInputElement[]
const efectivoUSD = () => screen.getAllByPlaceholderText('0.00')[0] as HTMLInputElement
const aviso = () => screen.queryByTestId('aviso-negativos')?.textContent ?? null
const boton = () => screen.findByRole('button', { name: /Cerrar turno y guardar payouts/ }) as Promise<HTMLButtonElement>

let sacar: () => void
beforeAll(() => { sacar = imitarInputNumeroDeChrome() })
afterAll(() => sacar())
beforeEach(() => { vi.clearAllMocks(); window.confirm = vi.fn(() => true); state.entries = [entrada('e1', 6), entrada('e2', 6), entrada('e3', 8)] })
afterEach(() => { cleanup() })

describe('Turno actual · lo que se ve es lo que se valida (caso del dueño, 23-nov)', () => {
  it('-450 en ₡ de una persona, -200 en $ de otra, -500 en Efectivo $ → corregir solo Efectivo $ → sigue el aviso con el nombre y el botón deshabilitado', async () => {
    const u = userEvent.setup()
    render(<TipsModule />)
    const b = await boton()
    expect(b.disabled).toBe(false)

    const crcAna = inputsDe('Ana Sala')[1]
    const usdBeto = inputsDe('Beto Sala')[2]
    expect(textoVisible(crcAna)).toBe('0')                     // el cuadro trae «0»
    await u.type(crcAna, '-450')
    await u.type(usdBeto, '-200')
    await u.type(efectivoUSD(), '-500')
    expect(textoVisible(crcAna)).toBe('0-450')                 // lo que ve el encargado
    expect(textoVisible(usdBeto)).toBe('0-200')
    expect(aviso()).toBe('⚠ Los montos no pueden ser negativos: revisá «💵 Efectivo $».')
    expect(b.disabled).toBe(true)

    // Corrige SOLO «Efectivo $»: el aviso pasa a nombrar a la persona y el botón sigue deshabilitado.
    await u.clear(efectivoUSD())
    await u.type(efectivoUSD(), '500')
    await waitFor(() => expect(aviso()).toMatch(/propina ₡ de Ana Sala/))
    expect(textoVisible(crcAna)).toBe('0-450')
    expect(b.disabled).toBe(true)
    await u.click(b)
    expect(window.confirm).not.toHaveBeenCalled()
    expect(api.closeTipSession).not.toHaveBeenCalled()
    // Nunca se guardó en silencio un 0 en lugar de lo que se ve.
    expect(api.upsertTipEntry.mock.calls.map(c => c[0].employee_id)).not.toContain('e1')
    expect(api.upsertTipEntry.mock.calls.map(c => c[0].employee_id)).not.toContain('e2')

    // Corrige la de Ana: ahora nombra la $ de Beto.
    await u.clear(crcAna)
    await u.type(crcAna, '450')
    await waitFor(() => expect(aviso()).toMatch(/propina \$ de Beto Sala/))
    expect(b.disabled).toBe(true)

    // Corrige la de Beto: sin aviso, se habilita.
    await u.clear(usdBeto)
    await u.type(usdBeto, '2')
    await waitFor(() => expect(aviso()).toBeNull())
    expect(b.disabled).toBe(false)
  })

  it('-450 tipeado en un cuadro vacío (sin el «0») → el aviso de negativos nombra a la persona', async () => {
    const u = userEvent.setup()
    render(<TipsModule />)
    const b = await boton()
    const crcAna = inputsDe('Ana Sala')[1]
    await u.clear(crcAna)
    await u.type(crcAna, '-450')
    expect(textoVisible(crcAna)).toBe('-450')
    await waitFor(() => expect(aviso()).toBe('⚠ Los montos no pueden ser negativos: revisá la propina ₡ de Ana Sala.'))
    expect(b.disabled).toBe(true)
  })

  it('horas: «6-450» a la vista → aviso con el nombre y no se cierra (antes se repartía con 0 horas)', async () => {
    const u = userEvent.setup()
    render(<TipsModule />)
    const b = await boton()
    const horasAna = inputsDe('Ana Sala')[0]
    await u.type(horasAna, '-450')
    expect(textoVisible(horasAna)).toBe('6-450')
    await waitFor(() => expect(aviso()).toMatch(/horas de Ana Sala/))
    expect(b.disabled).toBe(true)
  })

  it('pozo con valor: «20000-» a la vista → aviso y no se autoguarda 0', async () => {
    const u = userEvent.setup()
    render(<TipsModule />)
    const b = await boton()
    await new Promise(r => setTimeout(r, 900))                // deja pasar el autoguardado de la carga
    api.updateSessionPools.mockClear()
    const efCRC = screen.getByDisplayValue('20000') as HTMLInputElement
    await u.type(efCRC, '-')
    expect(textoVisible(efCRC)).toBe('20000-')
    await waitFor(() => expect(aviso()).toMatch(/«💵 Efectivo ₡»/))
    expect(b.disabled).toBe(true)
    await new Promise(r => setTimeout(r, 1000))               // el autoguardado espera 800 ms
    expect(api.updateSessionPools).not.toHaveBeenCalled()
  })

  it('recarga por tiempo real con lo guardado en 0: el cuadro del pozo vuelve a mostrar lo que se valida (vacío)', async () => {
    const u = userEvent.setup()
    render(<TipsModule />)
    await boton()
    await u.type(efectivoUSD(), '5-')
    expect(textoVisible(efectivoUSD())).toBe('5-')
    await waitFor(() => expect(aviso()).toMatch(/«💵 Efectivo \$»/))
    await u.click(document.body)                              // sale del cuadro (el refetch espera a que no se escriba)
    await act(async () => { api.refetch() })
    await waitFor(() => expect(aviso()).toBeNull())
    expect(textoVisible(efectivoUSD())).toBe('')              // antes quedaba «5-» a la vista con el estado en ''
  })
})
