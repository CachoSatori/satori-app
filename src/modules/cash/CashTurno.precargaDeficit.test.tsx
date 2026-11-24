// @vitest-environment happy-dom
//
// (24-nov) Dos cambios de la Caja Diaria, sin tocar la matemática:
//   1. APERTURA: la precarga del cierre anterior (getPreviousCierre) puede llegar DESPUÉS de que el cajero tecleó un
//      monto (red lenta). Antes lo pisaba y el cajero abría con un fondo que no escribió. Ahora solo llena los cuadros
//      que el cajero no tocó; un cuadro tocado y vuelto a vaciar sigue siendo del cajero.
//   2. TURNO: con «Disponible» en déficit aparece el aviso de que completar la caja con plata de Caja Fuerte no se
//      registra (pozo único). Sin déficit, no aparece.
// Datos ficticios. Harness espejo de CashTurno.aperturaCierreIlegible.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { teclearNumero } from './teclearNumero.testutil'
import type { CashSession, CashMovement } from '../../shared/types/database'

const cashApi = vi.hoisted(() => ({
  createCashSession: vi.fn(async (m: { session_date: string }) => ({ id: 's-new', ...m })),
}))
const prevApi = vi.hoisted(() => ({
  getPreviousCierre: vi.fn(async (fecha: string): Promise<Record<string, unknown> | null> => { void fecha; return null }),
}))
vi.mock('../../shared/api/cash', () => ({
  createCashMovement: vi.fn(),
  createCashSession: cashApi.createCashSession,
  closeCashSession: vi.fn(),
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

const { createCashSession } = cashApi

const cuadro = (rotulo: string) =>
  screen.getAllByText(rotulo).map(el => el.closest('.tips-field')?.querySelector('input')).find(Boolean) as HTMLInputElement
const fondoCRC = () => cuadro('Caja Diaria — Proveedores (₡)')
const fondoUSD = () => cuadro('$ Dólares (efectivo)')
const abrir = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR APERTURA/i })) }) }

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
})

/** Apertura con la precarga retenida: devuelve `entregar` para soltarla cuando la prueba quiera (red lenta). */
async function aperturaConPrecargaTardia() {
  let entregar: (c: Record<string, unknown>) => void = () => {}
  prevApi.getPreviousCierre.mockImplementationOnce(() => new Promise(res => { entregar = res }))
  const onError = vi.fn()
  render(
    <CashTurno openSession={null} suppliers={[]} sessions={[]} sessionMovements={[]} allMovements={[]}
      onSessionOpen={vi.fn()} onSessionClose={vi.fn()} onMovAdded={vi.fn()} onError={onError} onRefresh={vi.fn()} />,
  )
  await screen.findByRole('option', { name: 'Caja Test' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Caja Test' } })
  const soltar = async () => {
    await act(async () => { entregar({ session_date: '2026-06-30', sep_diaria_crc: 80000, sep_diaria_usd: 15 }) })
  }
  return { onError, soltar }
}

describe('CashTurno · apertura — la precarga tardía no pisa lo que tecleó el cajero', () => {
  it('₡ tecleado antes de la precarga: queda lo tecleado; el $ (no tocado) se llena con la precarga', async () => {
    const { soltar } = await aperturaConPrecargaTardia()
    teclearNumero(fondoCRC(), '95000')
    await soltar()
    expect(fondoCRC().value).toBe('95000')
    expect(fondoUSD().value).toBe('15')
    // El aviso del cierre anterior sigue a la vista y, como el monto difiere, se pide confirmar.
    expect(screen.getByText(/asignó a Caja Proveedores/)).toBeTruthy()
    const confirmar = vi.fn(() => true)
    Object.defineProperty(window, 'confirm', { value: confirmar, configurable: true, writable: true })
    await abrir()
    expect(confirmar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(createCashSession).toHaveBeenCalledTimes(1))
    expect(createCashSession.mock.calls[0][0]).toMatchObject({ initial_suppliers_crc: 95000, initial_cash_usd: 15 })
  })

  it('$ tecleado antes de la precarga: queda lo tecleado; el ₡ (no tocado) se llena con la precarga', async () => {
    const { soltar } = await aperturaConPrecargaTardia()
    teclearNumero(fondoUSD(), '40')
    await soltar()
    expect(fondoUSD().value).toBe('40')
    expect(fondoCRC().value).toBe('80000')
    await abrir()
    await waitFor(() => expect(createCashSession).toHaveBeenCalledTimes(1))
    expect(createCashSession.mock.calls[0][0]).toMatchObject({ initial_suppliers_crc: 80000, initial_cash_usd: 40 })
  })

  it('cuadro tocado y vuelto a vaciar sigue siendo del cajero: la precarga no lo rellena', async () => {
    const { soltar } = await aperturaConPrecargaTardia()
    teclearNumero(fondoCRC(), '95000')
    teclearNumero(fondoCRC(), '')
    await soltar()
    expect(fondoCRC().value).toBe('')
    expect(fondoUSD().value).toBe('15')
  })

  it('sin tocar nada: la precarga llena los dos cuadros (como antes)', async () => {
    const { soltar } = await aperturaConPrecargaTardia()
    await soltar()
    expect(fondoCRC().value).toBe('80000')
    expect(fondoUSD().value).toBe('15')
    await abrir()
    await waitFor(() => expect(createCashSession).toHaveBeenCalledTimes(1))
    expect(createCashSession.mock.calls[0][0]).toMatchObject({ initial_suppliers_crc: 80000, initial_cash_usd: 15 })
  })
})

// ── Aviso de déficit ─────────────────────────────────────────────────────────────────────────────────────
const session = {
  id: 's1', cajero_name: 'Caja Test', shift_type: 'AM', session_date: '2026-07-01', status: 'open',
  initial_suppliers_crc: 50000, initial_cash_usd: 0,
} as unknown as CashSession

const pago = (monto: number) => ({
  id: `mov-${monto}`, movement_type: 'egreso_mercaderia', status: 'aprobado',
  caja_origen: 'Caja Proveedores', method: 'Efectivo', supplier_id: 'sup-1', supplier_name: 'Proveedor Ficticio',
  amount_crc: monto, amount_usd: 0, description: 'pago de prueba', created_at: '2026-07-01T10:00:00Z',
} as unknown as CashMovement)

const renderTurno = (movs: CashMovement[]) => render(
  <CashTurno openSession={session} suppliers={[]} sessions={[session]} sessionMovements={movs} allMovements={[]}
    onSessionOpen={vi.fn()} onSessionClose={vi.fn()} onMovAdded={vi.fn()} onError={vi.fn()} onRefresh={vi.fn()} />,
)
const TEXTO_DEFICIT = 'Si lo completaste con plata de Caja Fuerte, no registres nada: cerrá con lo que hay en la caja.'

describe('CashTurno · aviso de déficit (pozo único)', () => {
  it('con déficit (₡50.000 de fondo, ₡70.000 pagados): aparece el aviso con el texto exacto', () => {
    renderTurno([pago(70000)])
    expect(screen.getByText('⚠ déficit en caja')).toBeTruthy()
    const aviso = screen.getByText('Déficit en caja.').closest('.est-aviso') as HTMLElement
    expect(aviso).toBeTruthy()
    expect(aviso.className).toContain('atencion')
    expect(aviso.textContent).toContain(TEXTO_DEFICIT)
  })

  it('sin déficit (pagado < fondo): no aparece', () => {
    renderTurno([pago(20000)])
    expect(screen.getByText('restante en caja')).toBeTruthy()
    expect(screen.queryByText(/Si lo completaste con plata de Caja Fuerte/)).toBeNull()
  })

  it('justo en cero (pagado = fondo): no es déficit, no aparece', () => {
    renderTurno([pago(50000)])
    expect(screen.queryByText(/Si lo completaste con plata de Caja Fuerte/)).toBeNull()
  })
})
