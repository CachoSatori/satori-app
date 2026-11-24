// @vitest-environment happy-dom
//
// R31 (23-nov, verificador independiente en Chrome real + React 19): la APERTURA y el CIERRE de la Caja Diaria no
// guardan montos ilegibles. Un cuadro type="number" con «120000-450», «0-450» o «-» entrega value === '' y marca
// validity.badInput; la pantalla lo guardaba como 0 sin aviso (la caja abría con ₡0; el cierre quedaba «contado ₡0»).
// Ahora: aviso que nombra el cuadro y no se abre ni se cierra nada. Vacío sigue siendo 0. Con montos válidos, lo que se
// guarda es igual que antes (pruebas de paridad al final).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { teclearNumero } from './teclearNumero.testutil'
import type { CashSession } from '../../shared/types/database'

const cashApi = vi.hoisted(() => ({
  createCashSession: vi.fn(async (m: { session_date: string }) => ({ id: 's-new', ...m })),
  closeCashSession: vi.fn(async (id: string, datos: Record<string, unknown>, por: string) => { void id; void datos; void por }),
}))
const prevApi = vi.hoisted(() => ({
  getPreviousCierre: vi.fn(async (fecha: string): Promise<Record<string, unknown> | null> => { void fecha; return null }),
}))
vi.mock('../../shared/api/cash', () => ({
  createCashMovement: vi.fn(),
  createCashSession: cashApi.createCashSession,
  closeCashSession: cashApi.closeCashSession,
  deleteCashMovement: vi.fn(),
  getPreviousCierre: prevApi.getPreviousCierre,
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
import { RELOJES_CR, conRelojCR } from '../../test/relojCR.testutil'

const { createCashSession, closeCashSession } = cashApi


// El cuadro se busca por el rótulo que ve el cajero (no por aria-label, que main no tiene): así la misma prueba corre
// contra main y muestra el antes.
const cuadro = (rotulo: string) =>
  screen.getAllByText(rotulo).map(el => el.closest('.tips-field')?.querySelector('input')).find(Boolean) as HTMLInputElement

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

// ── Apertura ────────────────────────────────────────────────────────────────────────────────────────────
async function renderApertura() {
  const onError = vi.fn()
  render(
    <CashTurno openSession={null} suppliers={[]} sessions={[]} sessionMovements={[]} allMovements={[]}
      onSessionOpen={vi.fn()} onSessionClose={vi.fn()} onMovAdded={vi.fn()} onError={onError} onRefresh={vi.fn()} />,
  )
  await screen.findByRole('option', { name: 'Caja Test' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Caja Test' } })
  return { onError }
}
const fondoCRC = () => cuadro('Caja Diaria — Proveedores (₡)')
const fondoUSD = () => cuadro('$ Dólares (efectivo)')
const abrir = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR APERTURA/i })) }) }

// R34: la apertura se guarda con `session_date = todayCR()`; corre con el reloj fijo a las 23:30 CR en las cuatro
// fechas de la matriz (a esa hora la fecha UTC ya es la de mañana).
describe.each(RELOJES_CR)('apertura con reloj fijo $hoy · $caso', reloj => {
  conRelojCR(reloj)

  describe('CashTurno · apertura — fondo ilegible no abre la caja (R31)', () => {
    it('₡ con valor + «-450» detrás («120000-450»): avisa nombrando el cuadro y NO abre', async () => {
      const { onError } = await renderApertura()
      teclearNumero(fondoCRC(), '120000')
      teclearNumero(fondoCRC(), '120000-450')
      await abrir()
      expect(createCashSession).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/«Caja Diaria — Proveedores \(₡\)».*no es un número/))
    })

    it('$ con «0-450» (el cuadro arranca en 0): avisa y NO abre', async () => {
      const { onError } = await renderApertura()
      teclearNumero(fondoUSD(), '0-450')
      await abrir()
      expect(createCashSession).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/«\$ Dólares \(efectivo\)».*no es un número/))
    })

    it('cuadro VACÍO + «-» desde la primera tecla (no dispara onChange): avisa y NO abre', async () => {
      const { onError } = await renderApertura()
      teclearNumero(fondoCRC(), '')       // borra el 0
      teclearNumero(fondoCRC(), '-')      // '' → '': solo onInput se entera
      await abrir()
      expect(createCashSession).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/«Caja Diaria — Proveedores \(₡\)».*no es un número/))
    })

    it('negativo legible («-450»): avisa y NO abre', async () => {
      const { onError } = await renderApertura()
      teclearNumero(fondoCRC(), '-450')
      await abrir()
      expect(createCashSession).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith('«Caja Diaria — Proveedores (₡)»: el monto no puede ser negativo.')
    })

    it('borrar el ilegible → vacío = 0: abre con ₡0', async () => {
      await renderApertura()
      teclearNumero(fondoCRC(), '')
      teclearNumero(fondoCRC(), '-')
      teclearNumero(fondoCRC(), '')       // '' → '' otra vez: la marca se va por onInput
      await abrir()
      await waitFor(() => expect(createCashSession).toHaveBeenCalledTimes(1))
      expect(createCashSession.mock.calls[0][0]).toMatchObject({ initial_suppliers_crc: 0, initial_cash_usd: 0 })
    })

    // Verificador del #337: el monto del cierre anterior llega DESPUÉS de que el cajero tecleó algo ilegible.
    // (24-nov) La precarga ya no pisa un cuadro tocado: el ilegible sigue a la vista, su marca sigue y la caja NO abre
    // (antes la precarga lo reemplazaba por el monto del cierre). El cuadro que NO se tocó sí se llena y queda legible.
    it('precarga del cierre anterior DESPUÉS de teclear algo ilegible: respeta el cuadro tocado (sigue ilegible, no abre)', async () => {
      let entregar: (c: Record<string, unknown>) => void = () => {}
      prevApi.getPreviousCierre.mockImplementationOnce(() => new Promise(res => { entregar = res }))
      const { onError } = await renderApertura()
      teclearNumero(fondoCRC(), '')
      teclearNumero(fondoCRC(), '-')
      await act(async () => { entregar({ session_date: '2026-06-30', sep_diaria_crc: 80000, sep_diaria_usd: 15 }) })
      expect(fondoCRC().value).toBe('')
      expect(fondoUSD().value).toBe('15')
      await abrir()
      expect(createCashSession).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/«Caja Diaria — Proveedores \(₡\)».*no es un número/))
      expect(onError).not.toHaveBeenCalledWith(expect.stringMatching(/«\$ Dólares \(efectivo\)».*no es un número/))
    })

    it('paridad: montos válidos se guardan igual que en main', async () => {
      await renderApertura()
      teclearNumero(fondoCRC(), '120000')
      teclearNumero(fondoUSD(), '35.5')
      await abrir()
      await waitFor(() => expect(createCashSession).toHaveBeenCalledTimes(1))
      expect(createCashSession.mock.calls[0][0]).toEqual({
        session_date: reloj.hoy, shift_type: expect.any(String), opened_by: 'u1', cajero_name: 'Caja Test',
        initial_cash_crc: 0, initial_cash_usd: 35.5, initial_suppliers_crc: 120000,
      })
    })
  })
})   // describe.each(RELOJES_CR) apertura

// ── Cierre del turno ────────────────────────────────────────────────────────────────────────────────────
const session = {
  id: 's1', cajero_name: 'Caja Test', shift_type: 'AM', session_date: '2026-07-01', status: 'open',
  initial_suppliers_crc: 100000, initial_cash_usd: 0,
} as unknown as CashSession

function renderCierre() {
  const onError = vi.fn()
  const onSessionClose = vi.fn()
  render(
    <CashTurno openSession={session} suppliers={[]} sessions={[session]} sessionMovements={[]} allMovements={[]}
      onSessionOpen={vi.fn()} onSessionClose={onSessionClose} onMovAdded={vi.fn()} onError={onError} onRefresh={vi.fn()} />,
  )
  return { onError, onSessionClose }
}
const contadoCRC = () => cuadro('Efectivo al cierre ₡')
const contadoUSD = () => cuadro('Efectivo al cierre $')
const verResumen = () => fireEvent.click(screen.getByRole('button', { name: /VER RESUMEN Y CONFIRMAR CIERRE/ }))
const confirmarCierre = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Confirmar y cerrar turno/ })) })
}

describe('CashTurno · cierre del turno — efectivo contado ilegible no cierra (R31)', () => {
  it('₡ con valor + «-450» detrás: «Ver resumen» avisa y no abre el resumen; se ve que no es un número', async () => {
    const { onError } = renderCierre()
    teclearNumero(contadoCRC(), '100000')
    teclearNumero(contadoCRC(), '100000-450')
    expect(screen.getByText(/El efectivo contado no es un número/)).toBeTruthy()
    verResumen()
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/«Efectivo al cierre ₡».*no es un número/))
    expect(screen.queryByRole('button', { name: /Confirmar y cerrar turno/ })).toBeNull()
    expect(closeCashSession).not.toHaveBeenCalled()
  })

  it('resumen abierto con un monto válido y DESPUÉS «-» en el $ vacío: «Confirmar» avisa y NO cierra', async () => {
    const { onError, onSessionClose } = renderCierre()
    teclearNumero(contadoCRC(), '100000')
    verResumen()
    teclearNumero(contadoUSD(), '')
    teclearNumero(contadoUSD(), '-')      // cuadro vacío + «-»: solo onInput
    await confirmarCierre()
    expect(closeCashSession).not.toHaveBeenCalled()
    expect(onSessionClose).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/«Efectivo al cierre \$».*no es un número/))
  })

  it('borrar el ilegible → vacío = 0: cierra con $0', async () => {
    renderCierre()
    teclearNumero(contadoCRC(), '100000')
    teclearNumero(contadoUSD(), '')
    teclearNumero(contadoUSD(), '-')
    teclearNumero(contadoUSD(), '')
    expect(screen.queryByText(/El efectivo contado no es un número/)).toBeNull()
    verResumen()
    await confirmarCierre()
    await waitFor(() => expect(closeCashSession).toHaveBeenCalledTimes(1))
    expect(closeCashSession.mock.calls[0][1]).toMatchObject({ final_cash_crc: 100000, final_cash_usd: 0 })
  })

  it('paridad: montos válidos se guardan igual que en main', async () => {
    const { onSessionClose } = renderCierre()
    teclearNumero(contadoCRC(), '99500.5')
    teclearNumero(contadoUSD(), '12')
    verResumen()
    await confirmarCierre()
    await waitFor(() => expect(onSessionClose).toHaveBeenCalled())
    expect(closeCashSession.mock.calls[0]).toEqual([
      's1',
      { final_cash_crc: 99500.5, final_cash_usd: 12, final_safe_crc: 0, final_bank_crc: 0, notes: undefined },
      'u1',
    ])
  })
})
