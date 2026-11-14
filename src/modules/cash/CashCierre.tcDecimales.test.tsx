// @vitest-environment happy-dom
//
// TC del cierre del día con decimales (decisión del dueño, 14-nov): el campo «TC ₡/$» tenía step={5}
// y el navegador marcaba inválido un TC como 503.45. Ahora step="any" (mismo patrón que #175) y hasta
// 2 decimales: el valor viaja tal cual a la base y a la conversión $ → ₡. Más de 2 decimales frena el
// cierre con un mensaje (cash_movements.exchange_rate es numeric(10,2) y lo redondearía en silencio).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashCierreDia, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  saveCierreParcial: vi.fn(async (payload: Record<string, unknown>) => ({ saved: payload })),
  getCierresDia:     vi.fn(async () => [] as unknown[]),
  getCashSessions:   vi.fn(async () => [] as unknown[]),
  cerrarDiaCompleto: vi.fn(async (payload: Record<string, unknown>) => { void payload; return { cierre_id: 'c1', idempotente: false } }),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
  getAllCashMovements: vi.fn(async () => []),
  deshacerCierreDia:   vi.fn(async () => {}),
  discardDiaCompleto:  vi.fn(async () => {}),
  previewDiaCompleto:  vi.fn(async () => ({ fecha: '', borrar: [], ajenas: [] })),
  createDayMovement:   vi.fn(async () => ({})),
  sendCierreEmail:     vi.fn(async () => {}),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 600) }))
vi.mock('../../shared/api/tips', () => ({ getTipPayoutsSince: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Dueña' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashCierre from './CashCierre'
import { todayStr } from './cashUtils'
import { errorTipoCambio } from './tipoCambio'

const HOY = todayStr()
const parcialCon = (tc: number) => ({
  id: 'c1', session_date: HOY, manager: 'Dueña', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: tc, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia)
const turnoCerrado = { id: 's1', session_date: HOY, status: 'closed', shift_type: 'Día', cajero_name: 'Ana' } as CashSession

const inputTC = () => screen.getByText('TC ₡/$').nextElementSibling as HTMLInputElement
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const cambiar = (el: HTMLInputElement, v: string) => fireEvent.change(el, { target: { value: v } })

beforeEach(() => {
  vi.clearAllMocks()
  api.getCierresDia.mockResolvedValue([])
  api.getCashSessions.mockResolvedValue([])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('errorTipoCambio', () => {
  it('acepta enteros y hasta 2 decimales; frena 0, negativos, NaN y 3 decimales', () => {
    expect(errorTipoCambio(640)).toBeNull()
    expect(errorTipoCambio(503.4)).toBeNull()
    expect(errorTipoCambio(503.45)).toBeNull()
    expect(errorTipoCambio(503.456)).toMatch(/hasta 2 decimales/)
    expect(errorTipoCambio(0)).toMatch(/mayor que 0/)
    expect(errorTipoCambio(-5)).toMatch(/mayor que 0/)
    expect(errorTipoCambio(Number.NaN)).toMatch(/mayor que 0/)
  })
})

describe('Cierre del día — TC con decimales', () => {
  it('el campo «TC ₡/$» acepta 503.45 (antes step=5 lo marcaba inválido)', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Confirmar cierre mediodía/)
    await waitFor(() => expect(inputTC().value).toBe('600'))
    cambiar(inputTC(), '503.45')
    expect(inputTC().validity.stepMismatch).toBe(false)
    expect(inputTC().checkValidity()).toBe(true)
    expect(inputTC().getAttribute('inputmode')).toBe('decimal')
  })

  it('Fase 1: 503.45 se guarda como 503.45 y convierte los dólares con ese TC', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Confirmar cierre mediodía/)
    await waitFor(() => expect(inputTC().value).toBe('600'))
    cambiar(inputTC(), '503.45')
    cambiar(montos()[0], '200000')
    cambiar(montos()[1], '100')
    // Etiqueta del campo en dólares: $100 × 503.45 = ₡50 345 (es-CR separa miles con espacio fino)
    expect(screen.getByText(/Dólares físicos \$ → ₡50\s345$/)).toBeTruthy()
    fireEvent.click(btn)
    await waitFor(() => expect(api.saveCierreParcial).toHaveBeenCalledTimes(1))
    const p = api.saveCierreParcial.mock.calls[0][0]
    expect(p.tipo_cambio).toBe(503.45)
    // Efectivo real = 200000 − 100 × 503.45 = 149655 (con el TC viejo de 600 daría 140000)
    expect(p.ef_real_m_crc).toBe(149655)
  })

  it('Fase 1: un TC con 3 decimales NO se redondea en silencio: frena con mensaje y no guarda', async () => {
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Confirmar cierre mediodía/)
    await waitFor(() => expect(inputTC().value).toBe('600'))
    cambiar(inputTC(), '503.456')
    cambiar(montos()[0], '200000')
    fireEvent.click(btn)
    expect(await screen.findByText(/admite hasta 2 decimales/)).toBeTruthy()
    expect(api.saveCierreParcial).not.toHaveBeenCalled()
  })

  it('Fase 2: el TC sellado 503.45 llega a la RPC (exchange_rate y tipo_cambio) y al efectivo real de noche', async () => {
    api.getCierresDia.mockResolvedValue([parcialCon(503.45)])
    api.getCashSessions.mockResolvedValue([turnoCerrado])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    await waitFor(() => expect(inputTC().value).toBe('503.45'))
    expect(inputTC().disabled).toBe(true)
    cambiar(montos()[0], '100000')   // Ventas noche ₡
    cambiar(montos()[1], '10')       // $10 × 503.45 = ₡5.034,50
    cambiar(montos()[7], '94966')    // remanente CF ₡
    cambiar(montos()[8], '10')       // remanente CF $
    fireEvent.click(screen.getByText(/Revisar resumen y cerrar el día/))
    expect(await screen.findByText(/TC ₡503,45/)).toBeTruthy()
    fireEvent.click(await screen.findByText(/CONFIRMAR CIERRE DEL DÍA/))
    await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
    const p = api.cerrarDiaCompleto.mock.calls[0][0] as { exchange_rate: number; cierre: Record<string, unknown> }
    expect(p.exchange_rate).toBe(503.45)
    expect(p.cierre.tipo_cambio).toBe(503.45)
    // 100000 − 10 × 503.45 = 94965.5 → al colón (Math.round, sin cambio de este PR) = 94966
    expect(p.cierre.ef_real_n_crc).toBe(94966)
  })
})
