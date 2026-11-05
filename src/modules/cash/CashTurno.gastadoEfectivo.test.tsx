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

  it('la tarjeta usa la MISMA suma que resta la verificación del cierre (gastado + disponible = asignado)', () => {
    const { container } = renderTurno([pagoProveedor, propinaEgreso])

    const verif = container.querySelector('.cd-verificacion') as HTMLElement
    const asignado = monto(fila(verif, 'Fondo inicial'))
    const restados = monto(fila(verif, '− Pagos a proveedores (efectivo)'))
                   + monto(fila(verif, '− Otros egresos efectivo'))

    // El invariante del fix: la tarjeta ES lo que el cierre resta, ni más ni menos.
    expect(monto(tarjeta('Gastado efectivo'))).toBe(restados)
    expect(monto(tarjeta('Gastado efectivo')) + monto(tarjeta('Disponible'))).toBe(asignado)
    expect(monto(fila(verif, 'Debería quedar en la Caja Diaria'))).toBe(asignado - restados)
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

  it('los subtotales cierran contra el "Efectivo que debería quedar"', () => {
    const modal = abrirResumen([pagoProveedor, propinaEgreso])

    const asignado  = monto(fila(modal, 'Total asignado'))
    const proveedor = monto(fila(modal, '− Pagos a proveedores (efectivo)'))
    const otros     = monto(fila(modal, '− Otros egresos (efectivo)'))
    const deberia   = monto(fila(modal, 'Efectivo que debería quedar (Caja Diaria)'))

    expect(asignado).toBe(100000)
    expect(proveedor).toBe(10000)
    expect(otros).toBe(40000)
    // Lo que el modal promete: el "debería" se reconstruye con las filas que muestra.
    expect(asignado - proveedor - otros).toBe(deberia)
    expect(deberia).toBe(50000)
  })

  it('sin otros egresos no aparece el subtotal vacío (el desglose no cambia)', () => {
    const modal = abrirResumen([pagoProveedor])

    expect(within(modal).queryByText('− Otros egresos (efectivo)')).toBeNull()
    expect(monto(fila(modal, 'Efectivo que debería quedar (Caja Diaria)'))).toBe(90000)
  })
})
