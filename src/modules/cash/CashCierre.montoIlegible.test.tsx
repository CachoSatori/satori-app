// @vitest-environment happy-dom
//
// R31 (23-nov): el Cierre del día no guarda montos ilegibles. MontoInput solo usaba onChange y N() = Number(v) || 0
// volvía 0 lo que el cuadro entregaba como '' (texto que no es número: «1500000-», «120000-450», «-»). Un retiro
// «1500000-» se cerraba como ₡0 sin aviso. Ahora cada cuadro marca validity.badInput (onChange Y onInput) y la Fase 1,
// «Revisar resumen» y el cierre de la Fase 2 avisan con el nombre del cuadro sin guardar nada. Vacío sigue siendo 0.
// Los inputs se buscan por posición (como las otras pruebas del cierre) para que la misma prueba corra contra main.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { CashCierreDia, CashSession } from '../../shared/types/database'

const api = vi.hoisted(() => ({
  getCierresDia:     vi.fn(async () => [] as unknown[]),
  getCashSessions:   vi.fn(async () => [] as unknown[]),
  saveCierreParcial: vi.fn(async (payload: Record<string, unknown>) => { void payload; return {} }),
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

const HOY = todayStr()
const parcial = {
  id: 'c1', session_date: HOY, manager: 'Dueña', tipo: 'parcial_mediodia',
  vm_crc: 0, vm_usd: 0, propinas_m_crc: 0, otros_m_crc: 0, ef_real_m_crc: 0,
  vn_crc: 0, vn_usd: 0, propinas_n_crc: 0, otros_n_crc: 0, ef_real_n_crc: 0,
  sep_diaria_crc: 0, sep_diaria_usd: 0, sep_registradora_crc: 0, sep_registradora_usd: 0,
  remanente_crc: 0, remanente_usd: 0, diferencia_crc: 0, ajuste_tipo: '', ajuste_motivo: '',
  notas: '', tipo_cambio: 600, created_at: `${HOY}T14:00:00Z`, updated_at: `${HOY}T14:00:00Z`,
} as CashCierreDia
const turnoCerrado = { id: 's1', session_date: HOY, status: 'closed', shift_type: 'Día', cajero_name: 'Caja Test' } as CashSession

const FLOTANTE = /^-?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/
/** Escribe como el navegador: ilegible → value '' + badInput; UN evento `input` (con '' → '' React no corre onChange). */
function escribir(input: HTMLElement, texto: string) {
  const legible = texto === '' || FLOTANTE.test(texto)
  Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: !legible, valid: legible }) })
  fireEvent.input(input, { target: { value: legible ? texto : '' } })
}
// Fase 1: [0]=ventas ₡ · [1]=$. Fase 2: [0]=ventas noche ₡ · [1]=$ · [2]=retiro · [3..8]=separaciones
// (Caja Diaria mañana 3/4 · Registradora 5/6 · Remanente CF 7/8).
const montos = () => Array.from(document.querySelectorAll<HTMLInputElement>('.cierre-monto input'))
const error = () => document.querySelector('.cierre-hint.red span')?.textContent ?? ''

beforeEach(() => {
  vi.clearAllMocks()
  api.getCashSessions.mockResolvedValue([turnoCerrado])
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

describe('Cierre del día · Fase 1 — ventas ilegibles no se sellan (R31)', () => {
  const preparar = async () => {
    api.getCierresDia.mockResolvedValue([])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    return await screen.findByText(/Confirmar cierre mediodía/)
  }

  it('₡ con valor + «-450» detrás y $ cargados: avisa nombrando el cuadro y NO sella ₡0', async () => {
    const btn = await preparar()
    escribir(montos()[1], '40')
    escribir(montos()[0], '120000')
    escribir(montos()[0], '120000-450')
    await act(async () => { fireEvent.click(btn) })
    expect(api.saveCierreParcial).not.toHaveBeenCalled()
    expect(error()).toMatch(/«Ventas mediodía ₡».*no es un número/)
  })

  it('paridad: montos válidos se sellan igual que en main', async () => {
    const btn = await preparar()
    escribir(montos()[0], '120000.5')
    escribir(montos()[1], '40')
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => expect(api.saveCierreParcial).toHaveBeenCalledTimes(1))
    expect(api.saveCierreParcial.mock.calls[0][0]).toMatchObject({ vm_crc: 120000.5, vm_usd: 40, ef_real_m_crc: Math.round(120000.5 - 40 * 600) })
  })
})

describe('Cierre del día · Fase 2 — retiro y conteo ilegibles no cierran (R31)', () => {
  const preparar = async () => {
    api.getCierresDia.mockResolvedValue([parcial])
    render(<CashCierre onRefresh={vi.fn()} openSession={null} />)
    await screen.findByText(/Revisar resumen y cerrar el día/)
    fireEvent.click(screen.getByRole('button', { name: 'Sin novedades' }))   // resumen del día (obligatorio)
  }
  const revisar = () => fireEvent.click(screen.getByText(/Revisar resumen y cerrar el día/))
  const confirmar = async () => { await act(async () => { fireEvent.click(screen.getByText(/CONFIRMAR CIERRE DEL DÍA/)) }) }
  // Lo que haría el encargado: revisar y, si se abre el resumen, confirmar. En main el resumen se abre y el cierre se
  // guarda con el cuadro ilegible en 0; con el arreglo el resumen no se abre.
  const revisarYConfirmar = async () => {
    revisar()
    const confirmarBtn = screen.queryByText(/CONFIRMAR CIERRE DEL DÍA/)
    if (confirmarBtn) await act(async () => { fireEvent.click(confirmarBtn) })
  }

  it('retiro «1500000-» (cuadro vacío + texto ilegible): «Revisar resumen» avisa y no hay cierre con retiro ₡0', async () => {
    await preparar()
    escribir(montos()[0], '100000')
    escribir(montos()[2], '1500000-')
    escribir(montos()[7], '100000')
    await revisarYConfirmar()
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
    expect(error()).toMatch(/«Retiro dueños → banco ₡».*no es un número/)
    expect(screen.getByText(/No es un número/)).toBeTruthy()
  })

  it('resumen abierto y DESPUÉS «-» en una separación vacía: «Confirmar» avisa y NO cierra', async () => {
    await preparar()
    escribir(montos()[0], '100000')
    escribir(montos()[7], '100000')
    revisar()
    escribir(montos()[3], '-')            // Caja Diaria mañana ₡, vacío + «-»: solo onInput
    await confirmar()
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
    expect(error()).toMatch(/«Caja Diaria mañana ₡».*no es un número/)
  })

  it('ventas de noche con valor + «-450» detrás: avisa y NO cierra', async () => {
    await preparar()
    escribir(montos()[0], '100000')
    escribir(montos()[0], '100000-450')
    escribir(montos()[1], '20')
    escribir(montos()[7], '100000')
    await revisarYConfirmar()
    expect(api.cerrarDiaCompleto).not.toHaveBeenCalled()
    expect(error()).toMatch(/«Ventas noche ₡».*no es un número/)
  })

  it('borrar el ilegible → vacío = 0: cierra con retiro ₡0', async () => {
    await preparar()
    escribir(montos()[0], '100000')
    escribir(montos()[2], '1500000-')
    escribir(montos()[2], '')             // '' → '': la marca se va por onInput
    escribir(montos()[7], '100000')
    expect(screen.queryByText(/No es un número/)).toBeNull()
    revisar()
    await confirmar()
    await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
    expect(api.cerrarDiaCompleto.mock.calls[0][0]).toMatchObject({ retiro_crc: 0, cierre: { otros_n_crc: 0, remanente_crc: 100000 } })
  })

  it('paridad: montos válidos se cierran igual que en main', async () => {
    await preparar()
    escribir(montos()[0], '2000000')
    escribir(montos()[2], '1500000')
    escribir(montos()[3], '60000')
    escribir(montos()[7], '440000')
    escribir(montos()[8], '0')
    revisar()
    await confirmar()
    await waitFor(() => expect(api.cerrarDiaCompleto).toHaveBeenCalledTimes(1))
    expect(api.cerrarDiaCompleto.mock.calls[0][0]).toMatchObject({
      retiro_crc: 1500000,
      cierre: { vn_crc: 2000000, vn_usd: 0, otros_n_crc: 1500000, sep_diaria_crc: 60000, remanente_crc: 440000, diferencia_crc: 0 },
    })
  })
})
