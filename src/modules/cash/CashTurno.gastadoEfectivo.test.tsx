// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { CashSession, Supplier, CashMovement } from '../../shared/types/database'
import { fi } from '../../shared/utils'

// Dos fixes de PANTALLA en la Caja Diaria. La matemática (`cajaDeberia`) NO cambia — lo que
// fallaba era lo que se MOSTRABA:
//
//   1. La tarjeta "Gastado efectivo" rotulaba "proveedores + otros egresos" pero mostraba solo
//      los proveedores. Caso real: decía ₡10.000 con una propina de ₡40.000 pagada desde la
//      caja, mientras Disponible decía bien ₡50.000 (100.000 − 10.000 − 40.000). Ahora la
//      tarjeta usa la MISMA suma que resta la verificación del cierre.
//   2. El "Resumen del Turno" listaba solo pagos a proveedores → el "Efectivo que debería
//      quedar" no se podía reconstruir línea por línea. Ahora también lista los otros egresos
//      en efectivo (p.ej. propinas pagadas desde la caja) con sus subtotales.
//
// Harness espejo de CashTurno.mercaderia.test.tsx / CashTurno.sinFoto.test.tsx — sin DB ni red.

vi.mock('../../shared/api/cash', () => ({
  createCashMovement: vi.fn(),
  createCashSession: vi.fn(),
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
  getActiveEmployees: vi.fn(async () => []),
  getTipPayoutsSince: vi.fn(async () => []),
}))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: vi.fn(async () => 500) }))
vi.mock('../../shared/api/facturas', () => ({
  uploadFacturaPhoto: vi.fn(),
  movementAttachments: vi.fn(() => []),
}))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('./deletionNote', () => ({ useDeletionNote: () => vi.fn(async () => 'nota') }))
vi.mock('../../shared/FacturaThumbs', () => ({ default: () => null }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import CashTurno from './CashTurno'

// Fondo de ₡100.000 — el del caso real reportado.
const session = {
  id: 's1', cajero_name: 'Caja Test', shift_type: 'Día', session_date: '2026-07-21',
  initial_suppliers_crc: 100000, initial_cash_usd: 0,
} as unknown as CashSession

const supplier = { id: 'sup-1', name: 'Pescaderia Test', is_active: true } as unknown as Supplier

// Pago a proveedor en efectivo — ₡10.000 (el número que la tarjeta mostraba sola).
const pagoProveedor = {
  id: 'mov-prov', movement_type: 'egreso_mercaderia', status: 'aprobado',
  caja_origen: 'Caja Proveedores', method: 'Efectivo',
  supplier_id: 'sup-1', supplier_name: 'Pescaderia Test',
  amount_crc: 10000, amount_usd: 0, description: 'pago previo',
  created_at: '2026-07-21T10:00:00Z',
} as unknown as CashMovement

// Propina pagada DESDE la caja — ₡40.000. Forma exacta de propinaEgresoFields:
// egreso_personal · Efectivo · Registradora · subcategory 'Propinas por turno'.
const propinaEgreso = {
  id: 'mov-prop', movement_type: 'egreso_personal', status: 'aprobado',
  caja_origen: 'Registradora', method: 'Efectivo',
  amount_crc: 40000, amount_usd: 0,
  subcategory: 'Propinas por turno', description: 'Propinas turno 2026-07-21 Noche',
  created_at: '2026-07-21T22:00:00Z',
} as unknown as CashMovement

const renderTurno = (sessionMovements: CashMovement[]) => render(
  <CashTurno
    openSession={session}
    suppliers={[supplier]}
    sessions={[]}
    sessionMovements={sessionMovements}
    allMovements={[]}
    onSessionOpen={vi.fn()}
    onSessionClose={vi.fn()}
    onMovAdded={vi.fn()}
    onError={vi.fn()}
    onRefresh={vi.fn()}
  />,
)

// Valor de una tarjeta superior, por su rótulo ("Gastado efectivo" / "Disponible").
const tarjeta = (label: string): string =>
  screen.getByText(label).parentElement?.querySelector('.cd-tc-val')?.textContent ?? ''

// Valor de una fila etiqueta/monto (cd-verif-row o cd-resumen-row) dentro de un contenedor.
const fila = (scope: HTMLElement, label: string | RegExp): string =>
  within(scope).getByText(label).parentElement?.querySelector('strong')?.textContent ?? ''

// Monto de una fila de detalle del resumen (cd-resumen-pago), por su etiqueta.
const filaPago = (scope: HTMLElement, label: string): string =>
  within(scope).getByText(label).closest('.cd-resumen-pago')?.lastElementChild?.textContent ?? ''

// Dígitos de un monto formateado, sin signo ni símbolo ("− ₡ 40.000" → 40000).
const monto = (s: string): number => Number(s.replace(/\D/g, ''))

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
})

describe('CashTurno — la tarjeta "Gastado efectivo" suma también los otros egresos', () => {
  it('caso real: ₡10.000 a proveedor + ₡40.000 de propina → la tarjeta dice ₡50.000, no ₡10.000', () => {
    renderTurno([pagoProveedor, propinaEgreso])

    // Antes del fix acá salía fi(10000): la propina no entraba pese al rótulo.
    expect(tarjeta('Gastado efectivo')).toBe(fi(50000))
    // Disponible ya estaba bien y NO se toca: 100.000 − 10.000 − 40.000.
    expect(tarjeta('Disponible')).toBe(fi(50000))
  })

  it('gastado + disponible = fondo del turno (el invariante de la tarjeta se mantiene)', () => {
    renderTurno([pagoProveedor, propinaEgreso])
    // fondo 100.000 · gastado = 10.000 proveedor + 40.000 propina
    expect(monto(tarjeta('Gastado efectivo'))).toBe(50000)
    expect(monto(tarjeta('Gastado efectivo')) + monto(tarjeta('Disponible'))).toBe(100000)
  })

  it('05/11: el cierre de turno ya no pide efectivo ni muestra «debería / Cuadra»', () => {
    const { container } = renderTurno([pagoProveedor, propinaEgreso])
    expect(container.querySelector('.cd-verificacion')).toBeNull()
    expect(screen.queryByText('Efectivo al cierre ₡')).toBeNull()
    expect(screen.queryByText('Efectivo al cierre $')).toBeNull()
    expect(screen.queryByText(/Debería quedar en la Caja Diaria/)).toBeNull()
    expect(screen.queryByText(/Cuadra correctamente/)).toBeNull()
    expect(screen.getByText(/El efectivo se cuenta en el/)).toBeTruthy()
  })

  it('«Disponible»: texto nuevo y sin aviso de déficit aunque dé negativo', () => {
    const propinaGrande = { ...propinaEgreso, amount_crc: 133800 } as CashMovement
    renderTurno([{ ...pagoProveedor, amount_crc: 86000 } as CashMovement, propinaGrande])
    expect(screen.getByText('Fondo menos pagos del día (no incluye reposiciones)')).toBeTruthy()
    expect(screen.queryByText(/déficit en caja/)).toBeNull()
    expect(screen.queryByText(/restante en caja/)).toBeNull()
  })

  it('sin otros egresos la tarjeta sigue mostrando solo los proveedores (sin regresión)', () => {
    renderTurno([pagoProveedor])
    expect(tarjeta('Gastado efectivo')).toBe(fi(10000))
    expect(tarjeta('Disponible')).toBe(fi(90000))
  })

  it('un egreso PENDIENTE no se cuenta como gastado — esa plata sigue en la caja', () => {
    renderTurno([pagoProveedor, { ...propinaEgreso, status: 'pendiente' } as CashMovement])
    expect(tarjeta('Gastado efectivo')).toBe(fi(10000))
    expect(tarjeta('Disponible')).toBe(fi(90000))
  })
})

describe('CashTurno — el "Resumen del Turno" reconstruye el efectivo línea por línea', () => {
  const abrirResumen = (movs: CashMovement[]): HTMLElement => {
    renderTurno(movs)
    fireEvent.click(screen.getByRole('button', { name: /VER RESUMEN Y CONFIRMAR CIERRE/ }))
    return document.querySelector('.cd-modal') as HTMLElement
  }

  it('lista la propina pagada desde la caja, no solo los pagos a proveedores', () => {
    const modal = abrirResumen([pagoProveedor, propinaEgreso])

    // El pago a proveedor ya se listaba…
    expect(monto(filaPago(modal, 'Pescaderia Test'))).toBe(10000)
    // …y ahora también el otro egreso en efectivo, que antes desaparecía del desglose.
    expect(monto(filaPago(modal, 'Propinas por turno'))).toBe(40000)
  })

  it('el desglose sigue (asignado, proveedores, otros) pero SIN la línea «debería» ni «Cuadra / Dif» (05/11)', () => {
    const modal = abrirResumen([pagoProveedor, propinaEgreso])

    expect(monto(fila(modal, 'Total asignado'))).toBe(100000)
    expect(monto(fila(modal, '− Pagos a proveedores (efectivo)'))).toBe(10000)
    expect(monto(fila(modal, '− Otros egresos (efectivo)'))).toBe(40000)
    expect(within(modal).queryByText(/Efectivo que debería quedar/)).toBeNull()
    expect(within(modal).queryByText(/Cuadra|Dif:/)).toBeNull()
  })

  it('sin otros egresos no aparece el subtotal vacío (el desglose no cambia)', () => {
    const modal = abrirResumen([pagoProveedor])
    expect(within(modal).queryByText('− Otros egresos (efectivo)')).toBeNull()
    expect(within(modal).queryByText(/Efectivo que debería quedar/)).toBeNull()
  })
})

describe('CashTurno — cierre sin efectivo (05/11)', () => {
  it('al confirmar, closeCashSession recibe final_cash_crc/usd = null', async () => {
    const api = await import('../../shared/api/cash')
    const close = vi.mocked(api.closeCashSession)
    close.mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
    renderTurno([pagoProveedor])
    fireEvent.click(screen.getByRole('button', { name: /VER RESUMEN Y CONFIRMAR CIERRE/ }))
    const modal = document.querySelector('.cd-modal') as HTMLElement
    fireEvent.click(within(modal).getByRole('button', { name: /CERRAR/i }))
    await vi.waitFor(() => expect(close).toHaveBeenCalled())
    expect(close.mock.calls[0][1]).toMatchObject({ final_cash_crc: null, final_cash_usd: null })
  })
})
