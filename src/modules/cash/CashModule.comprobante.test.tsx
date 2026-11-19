// @vitest-environment happy-dom
// (19-nov) Monta el CashModule REAL (con CashPendientes y los modales de crédito reales): tras aplicar un crédito o pagar,
// el padre refresca y el comprobante SIGUE a la vista (antes el spinner del refresco desmontaba Pendientes y se perdía),
// aunque ya no queden pendientes; un toque afuera no lo cierra, solo «Cerrar». La base es una simulación en memoria que
// imita a la RPC (aplica, y aprueba la factura si queda en 0). Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CashMovement, CreditApplication, Supplier, SupplierCredit } from '../../shared/types/database'
import { fi } from './cashUtils'

const db = vi.hoisted(() => ({
  movs: [] as CashMovement[],
  apps: [] as CreditApplication[],
  credits: [] as SupplierCredit[],
  sups: [] as Supplier[],
  lecturas: 0,
}))
const copia = <T,>(xs: T[]): T[] => xs.map(x => ({ ...x }))
// Las lecturas tardan como la red de verdad: con promesas instantáneas React junta «cargando» y «listo» en un solo
// render y el spinner nunca aparece, así que la prueba no vería el desmontaje que perdía el comprobante.
const red = () => new Promise(r => setTimeout(r, 25))

vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'Prueba' } }) }))
vi.mock('../../shared/hooks/useRealtimeRefetch', () => ({ useRealtimeRefetch: () => {} }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => async () => ({ ok: true }) }))
vi.mock('../../shared/api/jornadasConVentas', () => ({ getJornadasConVentas: async () => [] }))
vi.mock('../../shared/api/cash', () => ({
  getOpenCashSession: async () => null,
  getCashSessions: async () => [],
  getAllCashMovements: async () => { await red(); db.lecturas++; return copia(db.movs) },
  getSuppliers: async () => copia(db.sups),
  getSupplierCredits: async () => copia(db.credits),
  getCreditApplications: async () => copia(db.apps),
  getCierresDia: async () => [],
  updateMovementStatus: async (id: string, status: string) => {
    db.movs = db.movs.map(m => m.id === id ? { ...m, status } as CashMovement : m)
  },
  updateCashMovement: async () => {},
  sendPagoProveedorEmail: async () => {},
  createSupplierCredit: async () => 'c',
  applySupplierCredit: async (p: { credit_id: string; movement_id: string; amount: number }) => {
    db.apps = [...db.apps, {
      id: `a${db.apps.length}`, credit_id: p.credit_id, applied_to_movement_id: p.movement_id, amount_applied: p.amount,
      currency: 'CRC', applied_at: '2026-07-10T15:00:00Z', applied_by: null, client_op_id: null, reversed: false,
    }]
    const m = db.movs.find(x => x.id === p.movement_id)!
    const aplicado = db.apps.filter(a => !a.reversed && a.applied_to_movement_id === m.id).reduce((s, a) => s + a.amount_applied, 0)
    if (Number(m.amount_crc) - aplicado <= 0.001) db.movs = db.movs.map(x => x.id === m.id ? { ...x, status: 'aprobado' } as CashMovement : x)
    return 'app'
  },
}))
vi.mock('./CashTurno',       () => ({ default: () => <p>pantalla turno</p> }))
vi.mock('./CashCierre',      () => ({ default: () => <p>pantalla cierre</p> }))
vi.mock('./CashMovimientos', () => ({ default: () => <p>pantalla movimientos</p> }))
vi.mock('./CashProveedores', () => ({ default: () => <p>pantalla proveedores</p> }))
vi.mock('./CashResumen',     () => ({ default: () => <p>pantalla resumen</p> }))

import CashModule from './CashModule'

const fac = (id: string, crc: number, dia: number): CashMovement => ({
  id, session_id: null, status: 'pendiente', amount_crc: crc, amount_usd: 0,
  created_at: `2026-07-0${dia}T18:00:00Z`, description: `Factura ${id}`, subcategory: 'Compra', shift: null,
  supplier_name: 'Proveedor de prueba', supplier_id: 'SUP', employee_name: null, movement_type: 'egreso_mercaderia',
} as unknown as CashMovement)
const sup = { id: 'SUP', name: 'Proveedor de prueba', whatsapp: '80000000', notificar_pago: 'no', email: null, is_active: true } as unknown as Supplier
const cred = (monto: number): SupplierCredit => ({
  id: 'C', supplier_id: 'SUP', origin: 'sobrepago', amount_crc: monto, amount_usd: 0, currency: 'CRC',
  fecha_origen: '2026-07-01', motivo: 'm', referencia: 'TRF-PRUEBA', source_movement_id: null, document_id: null,
  created_by: null, created_at: '2026-07-01T12:00:00Z', client_op_id: null,
})

const montar = () => render(<MemoryRouter initialEntries={['/caja?vista=pendientes']}><CashModule /></MemoryRouter>)

// Aplica el crédito con el reparto FIFO que propone el modal y espera a que el padre termine de refrescar.
async function aplicarCredito() {
  fireEvent.click(await screen.findByRole('button', { name: /Aplicar crédito \(/ }))
  const lecturasAntes = db.lecturas
  fireEvent.click(await screen.findByRole('button', { name: /^Aplicar \(/ }))
  await waitFor(() => expect(db.lecturas).toBeGreaterThan(lecturasAntes))
}

beforeEach(() => {
  cleanup()
  db.movs = []; db.apps = []; db.credits = []; db.sups = [sup]; db.lecturas = 0
})

describe('CashModule real — el comprobante no se pierde con el refresco', () => {
  it('liquidación 2 saldadas + 1 parcial + 1 sin cubrir: sigue visible tras refrescar y el «queda por pagar» = lo que muestra Pendientes', async () => {
    db.movs = [fac('f1', 30000, 5), fac('f2', 20000, 6), fac('f3', 30000, 7), fac('f4', 25000, 8)]
    db.credits = [cred(70000)]
    montar()
    await aplicarCredito()

    // Pendientes ya refrescó con los datos nuevos (f3 con crédito y f4) …
    await waitFor(() => expect(screen.getByText(/2 facturas · 1 proveedor/)).toBeTruthy())
    // … y el comprobante SIGUE a la vista.
    const modal = screen.getByText(/^Comprobante · Proveedor de prueba/).closest('.cd-modal') as HTMLElement
    const filas = [...modal.querySelectorAll('[data-estado]')].map(e => e.getAttribute('data-estado'))
    expect(filas).toEqual(['saldada', 'saldada', 'parcial', 'sin_cubrir'])
    expect(within(modal).getByText(`parcial · queda ${fi(10000)}`)).toBeTruthy()
    expect(within(modal).getByText(`sin cubrir · queda ${fi(25000)}`)).toBeTruthy()
    expect(within(modal).getByText(/Queda por pagar/).textContent).toContain(fi(35000))
    // Mismas cifras que la pantalla: el total pendiente que muestra Pendientes después = lo que queda por pagar.
    expect(document.querySelector('.cd-pend-summary .cd-saldo-val')?.textContent).toBe(fi(35000))

    // Un toque afuera no lo cierra; «Cerrar» sí.
    fireEvent.click(modal.parentElement as HTMLElement)
    expect(screen.getByText(/^Comprobante · Proveedor de prueba/)).toBeTruthy()
    fireEvent.click(within(modal).getByRole('button', { name: /^Cerrar$/ }))
    expect(screen.queryByText(/^Comprobante · Proveedor de prueba/)).toBeNull()
  })

  it('el crédito salda TODO: la pantalla queda vacía y el comprobante sigue a la vista', async () => {
    db.movs = [fac('f1', 30000, 5), fac('f2', 20000, 6)]
    db.credits = [cred(80000)]
    montar()
    await aplicarCredito()
    await screen.findByText('Sin facturas pendientes')
    const modal = screen.getByText(/^Comprobante · Proveedor de prueba/).closest('.cd-modal') as HTMLElement
    expect(within(modal).getAllByText('saldada ✓')).toHaveLength(2)
    expect(within(modal).getByText(/Saldo restante/).textContent).toContain(fi(30000))
    expect(within(modal).getByRole('button', { name: /WhatsApp/ })).toBeTruthy()
  })

  it('pagar la última factura: la pantalla queda vacía y el comprobante de pago sigue a la vista', async () => {
    db.movs = [fac('f1', 30000, 5)]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Marcar todos pagados/ }))
    await screen.findByText('Sin facturas pendientes')
    const modal = screen.getByText(/Comprobante de pago ·/).closest('.cd-modal') as HTMLElement
    expect(within(modal).getByText(/Total pagado/).textContent).toContain(fi(30000))
    fireEvent.click(modal.parentElement as HTMLElement)          // afuera: no cierra
    expect(screen.getByText(/Comprobante de pago ·/)).toBeTruthy()
  })
})
