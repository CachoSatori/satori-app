// @vitest-environment happy-dom
// (19-nov) Proveedores: reenviar por WhatsApp o PNG el comprobante de un crédito (Saldo a favor, armado desde
// credit_applications sin reversadas; solo lo que tocó el crédito, decisión del dueño) y el de un pago (Historial de pagos, por factura). Solo comparte: no escribe nada.
// Fechas en hora CR. Datos ficticios.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { CashMovement, CreditApplication, Supplier, SupplierCredit } from '../../shared/types/database'
import { fi } from './cashUtils'
import { comprobanteTexto, type ComprobanteData } from './comprobante'

const spy = vi.hoisted(() => ({ compartir: vi.fn(), descargar: vi.fn(), escribir: vi.fn() }))
vi.mock('./comprobante', async orig => ({
  ...(await orig<typeof import('./comprobante')>()),
  compartirComprobanteWhatsApp: spy.compartir,
  descargarComprobantePNG: spy.descargar,
}))
vi.mock('../../shared/api/cash', () => ({ upsertSupplier: spy.escribir, deactivateSupplier: spy.escribir, sendPagoProveedorEmail: spy.escribir }))
vi.mock('../../shared/api/documents', () => ({ listLinkedDocs: vi.fn(async () => []) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'M' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => null }))

import CashProveedores from './CashProveedores'

const sup = { id: 'S', name: 'Proveedor de prueba', category: 'Otros', contact: '', moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Efectivo', cuenta_iban: '', aliases: null, is_active: true, email: null, whatsapp: '80000000',
  notificar_pago: 'no', created_at: '', updated_at: '' } as unknown as Supplier
const pago = (o: Partial<CashMovement>): CashMovement => ({
  id: 'f1', session_id: null, supplier_id: 'S', movement_type: 'egreso_mercaderia', status: 'aprobado', method: 'Transferencia',
  amount_crc: 30000, amount_usd: 0, created_at: '2026-07-06T05:30:00Z', description: 'Factura A', subcategory: 'Compra', ...o,
} as unknown as CashMovement)
const cred: SupplierCredit = { id: 'C', supplier_id: 'S', origin: 'sobrepago', amount_crc: 50000, amount_usd: 0, currency: 'CRC',
  fecha_origen: '2026-07-01', motivo: 'm', referencia: 'TRF-PRUEBA', source_movement_id: null, document_id: null,
  created_by: null, created_at: '2026-07-01T12:00:00Z', client_op_id: null }
const app = (o: Partial<CreditApplication>): CreditApplication => ({ id: 'a', credit_id: 'C', applied_to_movement_id: 'f1',
  amount_applied: 30000, currency: 'CRC', applied_at: '2026-07-10T15:00:00Z', applied_by: null, client_op_id: null, reversed: false, ...o })

const movs = [pago({ id: 'f1' }), pago({ id: 'f2', amount_crc: 40000, created_at: '2026-07-07T18:00:00Z', description: 'Factura B', status: 'pendiente' })]
const apps = [app({ id: 'a1' }), app({ id: 'a2', applied_to_movement_id: 'f2', amount_applied: 15000 }), app({ id: 'a3', applied_to_movement_id: 'f2', amount_applied: 5000, reversed: true })]

const ultimo = (): ComprobanteData => spy.compartir.mock.calls.at(-1)![0] as ComprobanteData

beforeEach(() => {
  cleanup(); spy.compartir.mockReset(); spy.descargar.mockReset(); spy.escribir.mockReset()
  render(<CashProveedores suppliers={[sup]} movements={movs} credits={[cred]} applications={apps} onRefresh={vi.fn()} />)
})

describe('Proveedores — reenviar comprobantes', () => {
  it('Saldo a favor: reenvía solo las facturas que tocó el crédito (sin la reversada), sin «Queda por pagar»', () => {
    fireEvent.click(screen.getByRole('button', { name: /Saldo a favor \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar el comprobante del crédito por WhatsApp' }))
    expect(spy.compartir).toHaveBeenCalledTimes(1)
    expect(spy.compartir.mock.calls[0][1]).toBe('80000000')
    const t = comprobanteTexto(ultimo())
    expect(t).toContain('— Crédito aplicado el 2026-07-10\n')
    expect(t).toContain(`• 2026-07-05  ${fi(30000)}  Factura A\n    (saldada ✓)`)                    // fecha CR, no la UTC (06)
    expect(t).toContain(`• 2026-07-07  ${fi(15000)}  Factura B\n    (parcial · queda ${fi(25000)})`)
    expect(t).toContain(`Total: ${fi(45000)}`)
    expect(t).toContain('Para el saldo pendiente de hoy, consulte con nosotros.')
    expect(t).not.toMatch(/queda por pagar|sin cubrir/i)
    // Lo que ya se veía no cambia de cifras: saldo / monto del crédito.
    expect(screen.getByTitle('saldo / monto original').textContent).toBe(`${fi(5000)} / ${fi(50000)}`)
    fireEvent.click(screen.getByRole('button', { name: 'Descargar el comprobante del crédito (PNG)' }))
    expect(spy.descargar).toHaveBeenCalledTimes(1)
    expect(spy.escribir).not.toHaveBeenCalled()
  })

  it('Historial de pagos: solo los pagados tienen reenvío; arma el comprobante de esa factura con el desglose del crédito', () => {
    fireEvent.click(screen.getByRole('button', { name: /Historial pagos \(2\)/ }))
    const botones = screen.getAllByRole('button', { name: 'Reenviar el comprobante del pago por WhatsApp' })
    expect(botones).toHaveLength(1)                                   // f2 está pendiente: sin reenvío
    expect(screen.getByText('2026-07-05')).toBeTruthy()              // fecha CR del pago (05:30 UTC del 06 = 23:30 CR del 05)
    fireEvent.click(botones[0])
    const d = ultimo()
    // El crédito la cubrió entera: no es «Comprobante de pago … ₡0» ni «TOTAL A PAGAR».
    expect(d.tituloTexto).toBe('Saldada con crédito a favor')
    expect(d.totalLabel).toBe('SALDADA CON CRÉDITO A FAVOR')
    expect(d.lineas).toHaveLength(1)
    expect(d.lineas[0].monto).toBe(fi(30000))
    expect(d.lineas[0].subnotaTexto).toBe(`facturado ${fi(30000)} − crédito ${fi(30000)}`)
    expect(comprobanteTexto(d)).toContain(`Saldada con crédito a favor: ${fi(30000)}`)
    expect(spy.escribir).not.toHaveBeenCalled()
  })
})
