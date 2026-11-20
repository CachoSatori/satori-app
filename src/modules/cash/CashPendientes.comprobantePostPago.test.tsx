// @vitest-environment happy-dom
//
// Bug/UX: al pagar la ÚLTIMA factura (o "Marcar todos pagados"), el grupo sale de Pendientes y ya no
// se puede emitir el comprobante. Fix: tras el pago exitoso, un result view "Comprobante de pago"
// (Descargar PNG + WhatsApp) armado desde un SNAPSHOT de lo pagado. Este test fija que el result view
// aparece tras pagar (con Descargar + WhatsApp) y que sólo se cierra con "Cerrar" — sin tocar la
// lógica de pago (updateMovementStatus se llama igual).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { CashMovement, Supplier } from '../../shared/types/database'

const { pagoSpy } = vi.hoisted(() => ({ pagoSpy: vi.fn() }))
vi.mock('../../shared/api/cash', () => ({
  updateMovementStatus: (...a: unknown[]) => pagoSpy(...a),
  updateCashMovement: vi.fn(async () => {}),
  sendPagoProveedorEmail: vi.fn(),
  createSupplierCredit: vi.fn(),
  applySupplierCredit: vi.fn(),
}))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))

import CashPendientes from './CashPendientes'

const mov = (o: Partial<CashMovement>): CashMovement => ({
  id: 'm', session_id: null, status: 'pendiente', amount_crc: 30000, amount_usd: 0,
  created_at: '2026-07-05T18:00:00Z', description: 'Factura 12', subcategory: 'Compra', shift: null,
  supplier_name: 'Proveedor de prueba 1', supplier_id: 'SUP', employee_name: null,
  ...o,
} as unknown as CashMovement)

const sup = (o: Partial<Supplier> = {}): Supplier => ({
  id: 'SUP', name: 'Proveedor de prueba 1', whatsapp: '80000090', notificar_pago: 'no', email: null,
  category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal', metodo_pago: 'Efectivo',
  cuenta_iban: '', aliases: null, is_active: true, created_at: '', updated_at: '',
  ...o,
} as unknown as Supplier)

describe('CashPendientes — comprobante POST-pago', () => {
  beforeEach(() => { pagoSpy.mockReset(); pagoSpy.mockResolvedValue(undefined) })

  it('tras "Marcar todos pagados" aparece el comprobante del pagado; sólo cierra con Cerrar', async () => {
    const onRefresh = vi.fn()
    render(<CashPendientes movements={[mov({ id: 'f1' })]} sessions={[]} suppliers={[sup()]} credits={[]} applications={[]} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: /Marcar todos pagados/ }))

    // El pago corre igual que siempre (no se tocó la lógica) y se refresca.
    const titulo = await screen.findByText(/Comprobante de pago ·/)
    expect(pagoSpy).toHaveBeenCalledWith('f1', 'aprobado')
    expect(onRefresh).toHaveBeenCalled()

    // El result view (scoped al modal — "Descargar comprobante"/"WhatsApp" también viven en el grupo).
    const modal = titulo.closest('.cd-modal') as HTMLElement
    const w = within(modal)
    expect(w.getByRole('button', { name: /Descargar comprobante/ })).toBeTruthy()
    expect(w.getByRole('button', { name: /WhatsApp/ })).toBeTruthy()   // el proveedor tiene número
    expect(w.getByText(/Total pagado/)).toBeTruthy()

    // Sólo cierra con "Cerrar".
    fireEvent.click(w.getByRole('button', { name: /^Cerrar$/ }))
    expect(screen.queryByText(/Comprobante de pago ·/)).toBeNull()
  })
})

// (19-nov, menores del #300) Pagar y «Aplicar crédito» esperan el refresco silencioso del padre (`refrescando`): hasta
// entonces la lista puede mostrar como pendiente algo que ya se pagó. Mutaciones que estas pruebas cazan:
//   · «Aplicar crédito» con `disabled={saving}` (sin `refrescando`) → cae la primera;
//   · quitar `|| ocupado` de la guarda de `pagar()` → cae la segunda (los botones están grises: la guarda es la 2.ª red);
//   · «Aplicar» del modal sin la prop `ocupado` → cae la tercera.
const credito = (o: Record<string, unknown> = {}) => ({
  id: 'C', supplier_id: 'SUP', origin: 'sobrepago', amount_crc: 50000, amount_usd: 0, currency: 'CRC',
  fecha_origen: '2026-07-01', motivo: 'm', referencia: 'r', source_movement_id: null, document_id: null,
  created_by: null, created_at: '2026-07-01T12:00:00Z', client_op_id: null, ...o,
}) as never

describe('CashPendientes — pagar y aplicar crédito esperan el refresco', () => {
  beforeEach(() => { pagoSpy.mockReset(); pagoSpy.mockResolvedValue(undefined) })
  const pantalla = (refrescando: boolean) => (
    <CashPendientes movements={[mov({ id: 'f1' })]} sessions={[]} suppliers={[sup()]} credits={[credito()]} applications={[]}
      onRefresh={vi.fn()} refrescando={refrescando} />
  )

  it('«Aplicar crédito» queda gris mientras corre el refresco y vuelve cuando termina (no depende solo de `saving`)', () => {
    const { rerender } = render(pantalla(true))
    expect((screen.getByRole('button', { name: /Aplicar crédito/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /✓ Pagado/ }) as HTMLButtonElement).disabled).toBe(true)
    rerender(pantalla(false))
    expect((screen.getByRole('button', { name: /Aplicar crédito/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('la guarda `ocupado` DENTRO de pagar(): con el refresco en curso, un clic que llegue igual no paga', () => {
    render(pantalla(true))
    const boton = screen.getByRole('button', { name: /✓ Pagado/ })
    // El botón gris no deja hacer clic: se invoca el onClick de React tal cual, como si el botón se hubiera habilitado por un desfase.
    const clave = Object.keys(boton).find(k => k.startsWith('__reactProps'))!
    ;(boton as unknown as Record<string, { onClick: () => void }>)[clave].onClick()
    expect(pagoSpy).not.toHaveBeenCalled()
  })

  it('control: sin refresco en curso, el mismo clic sí paga', async () => {
    render(pantalla(false))
    fireEvent.click(screen.getByRole('button', { name: /✓ Pagado/ }))
    await screen.findByText(/Comprobante de pago ·/)
    expect(pagoSpy).toHaveBeenCalledWith('f1', 'aprobado')
  })

  it('el «Aplicar» del modal de crédito queda gris mientras corre el refresco y vuelve cuando termina', async () => {
    const { rerender } = render(pantalla(false))
    fireEvent.click(screen.getByRole('button', { name: /Aplicar crédito/ }))
    const aplicar = await screen.findByRole('button', { name: /Aplicar \(/ }) as HTMLButtonElement
    expect(aplicar.disabled).toBe(false)
    rerender(pantalla(true))                         // arranca un refresco con el modal abierto
    expect((screen.getByRole('button', { name: /Aplicar \(/ }) as HTMLButtonElement).disabled).toBe(true)
    rerender(pantalla(false))
    expect((screen.getByRole('button', { name: /Aplicar \(/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
