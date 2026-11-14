// @vitest-environment happy-dom
//
// Montos del cierre del día con céntimos (firma del dueño, 14-nov): los inputs de ₡ y $ del cierre
// (incluidas «Ventas PoS ₡») tenían step={100}, así que el navegador marcaba inválido 120000.50 o
// $12.34. Ahora usan step="any". Solo cambia el atributo: el monto viaja tal cual al guardar
// (N(v) = Number(v) || 0) y la matemática del cierre no se toca. El efectivo real del mediodía
// (ef_real_m_crc) ya se redondeaba al colón con Math.round antes de este cambio: se fija acá para
// que se vea que sigue igual.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashCierreDia } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  saveCierreParcial: vi.fn(async (payload: Record<string, unknown>) => ({ saved: payload })),
  getCierresDia:     vi.fn(async () => [] as unknown[]),
}))
vi.mock('../../shared/api/cash', () => ({
  ...api,
  getAllCashMovements: vi.fn(async () => []),
  getCashSessions:     vi.fn(async () => []),
  cerrarDiaCompleto:   vi.fn(async () => ({ cierre_id: 'c1', idempotente: false })),
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

const HOY = todayStr()
const parcial = {
  id: 'c1', session_date: HOY, manager: 'Dueña', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia

const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const setMonto = (el: HTMLInputElement, v: string) => fireEvent.change(el, { target: { value: v } })
/** Un monto con céntimos según el prefijo del campo (₡ o $). */
const conCentimos = (el: HTMLInputElement) =>
  el.parentElement?.querySelector('.pfx')?.textContent === '$' ? '12.34' : '120000.50'

function esperarValidos(inputs: HTMLInputElement[]) {
  expect(inputs.length).toBeGreaterThan(0)
  for (const el of inputs) {
    setMonto(el, conCentimos(el))
    expect(el.validity.stepMismatch, `stepMismatch con ${el.value}`).toBe(false)
    expect(el.checkValidity(), `checkValidity con ${el.value}`).toBe(true)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('Cierre del día — los montos aceptan céntimos', () => {
  it('Fase 1 (Mediodía): las ventas ₡/$ pasan checkValidity con céntimos', async () => {
    api.getCierresDia.mockResolvedValue([])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Confirmar cierre mediodía/)
    esperarValidos(montos())
  })

  it('Fase 1: el monto con céntimos se guarda tal cual (sin redondear a 100)', async () => {
    api.getCierresDia.mockResolvedValue([])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    const btn = await screen.findByText(/Confirmar cierre mediodía/)
    setMonto(montos()[0], '120000.50')
    fireEvent.click(btn)
    await waitFor(() => expect(api.saveCierreParcial).toHaveBeenCalledTimes(1))
    const p = api.saveCierreParcial.mock.calls[0][0]
    expect(p).toMatchObject({ vm_crc: 120000.5, vm_usd: 0 })
    // Comportamiento previo (no cambia con este PR): el efectivo real se redondea al colón.
    expect(Number.isInteger(p.ef_real_m_crc)).toBe(true)
  })

  it('Fase 2 (Noche): «Ventas PoS ₡», $, retiro y las seis separaciones pasan checkValidity con céntimos', async () => {
    api.getCierresDia.mockResolvedValue([parcial])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    // «Ventas PoS ₡» aparece también en el resumen de la Fase 1 sellada: se toma el que tiene input.
    const ventasPos = screen.getAllByText('Ventas PoS ₡')
      .map(l => l.parentElement!.querySelector<HTMLInputElement>('input'))
      .find(Boolean)
    expect(ventasPos).toBe(montos()[0])
    expect(montos()).toHaveLength(9)
    esperarValidos(montos())
  })
})
