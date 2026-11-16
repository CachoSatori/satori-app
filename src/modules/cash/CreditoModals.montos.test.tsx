// @vitest-environment happy-dom
//
// Hallazgos 225/226 (auditoría externa, 15-nov): los montos de Saldo a favor se leen con parseMonto. Antes
// replace(/[^\d.]/g, '') convertía «12,345» en 12345 y «12.345» en 12,345 sin avisar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Supplier, CashMovement, SupplierCredit } from '../../shared/types/database'

const { applySpy, createSpy } = vi.hoisted(() => ({ applySpy: vi.fn(), createSpy: vi.fn() }))
vi.mock('../../shared/api/cash', () => ({ createSupplierCredit: createSpy, applySupplierCredit: applySpy }))

import { AplicarCreditoModal, RegistrarCreditoModal } from './CreditoModals'
import { MSG_MONTO_NEGATIVO, msgMontoDecimales } from './montos'

const supplier = { id: 'S', name: 'Proveedor X' } as unknown as Supplier
const credit = (o: Partial<SupplierCredit> = {}): SupplierCredit => ({
  id: 'C', supplier_id: 'S', origin: 'sobrepago', amount_crc: 50000, amount_usd: 0, currency: 'CRC',
  fecha_origen: '2026-07-01', motivo: 'm', referencia: 'r', source_movement_id: null, document_id: null,
  created_by: null, created_at: '2026-07-01T12:00:00Z', client_op_id: null, ...o,
})
const fac = (o: Partial<CashMovement>): CashMovement => ({
  id: 'F', supplier_id: 'S', status: 'pendiente', amount_crc: 30000, amount_usd: 0,
  created_at: '2026-07-05T12:00:00Z', description: '', subcategory: '', ...o,
} as unknown as CashMovement)

function llenarRegistrar(monto: string) {
  render(<RegistrarCreditoModal supplier={supplier} movements={[]} onDone={vi.fn()} onClose={vi.fn()} />)
  const [montoInput] = screen.getAllByPlaceholderText('0')
  fireEvent.change(montoInput, { target: { value: monto } })
  fireEvent.change(screen.getByPlaceholderText(/pagué de más/), { target: { value: 'motivo' } })
  fireEvent.change(screen.getByPlaceholderText(/TRF-/), { target: { value: 'REF-1' } })
  return screen.getByRole('button', { name: /Registrar saldo a favor/ }) as HTMLButtonElement
}

describe('RegistrarCreditoModal — monto ₡', () => {
  beforeEach(() => { createSpy.mockReset(); createSpy.mockResolvedValue('c-id') })

  it('«12345,50» (coma) guarda 12345.5', async () => {
    fireEvent.click(llenarRegistrar('12345,50'))
    await vi.waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
    expect(createSpy.mock.calls[0][0]).toMatchObject({ amount_crc: 12345.5 })
  })
  it('«12345.50» (punto) guarda 12345.5', async () => {
    fireEvent.click(llenarRegistrar('12345.50'))
    await vi.waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
    expect(createSpy.mock.calls[0][0]).toMatchObject({ amount_crc: 12345.5 })
  })
  it('«₡ 1250,50» pegado con símbolo y espacio guarda 1250.5', async () => {
    fireEvent.click(llenarRegistrar('₡ 1250,50'))
    await vi.waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
    expect(createSpy.mock.calls[0][0]).toMatchObject({ amount_crc: 1250.5 })
  })
  it('«12,345» NO se guarda como 12345: avisa y bloquea', () => {
    const btn = llenarRegistrar('12,345')
    expect(btn.disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe(msgMontoDecimales(2))
    fireEvent.click(btn)
    expect(createSpy).not.toHaveBeenCalled()
  })
  it('«12.345» NO se guarda como 12,345: avisa y bloquea', () => {
    expect(llenarRegistrar('12.345').disabled).toBe(true)
    expect(createSpy).not.toHaveBeenCalled()
  })
  it('negativo: avisa (antes se borraba el «-» y quedaba positivo)', () => {
    expect(llenarRegistrar('-500').disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe(MSG_MONTO_NEGATIVO)
  })
  it('vacío: no guarda (monto > 0 obligatorio)', async () => {
    fireEvent.click(llenarRegistrar(''))
    expect(await screen.findByText('El monto ₡ debe ser > 0')).toBeTruthy()
    expect(createSpy).not.toHaveBeenCalled()
  })
})

describe('AplicarCreditoModal — montos por factura', () => {
  beforeEach(() => { applySpy.mockReset(); applySpy.mockResolvedValue('app-id') })
  const abrir = () => {
    render(<AplicarCreditoModal supplier={supplier} credits={[credit()]} applications={[]}
      pendientes={[fac({ id: 'f1', amount_crc: 30000 })]} onDone={vi.fn()} onClose={vi.fn()} />)
    return screen.getByRole('textbox') as HTMLInputElement
  }

  it('«12345,50» aplica 12345.5 (antes la coma se borraba → 1234550)', async () => {
    fireEvent.change(abrir(), { target: { value: '12345,50' } })
    fireEvent.click(screen.getByRole('button', { name: /Aplicar \(/ }))
    await vi.waitFor(() => expect(applySpy).toHaveBeenCalledTimes(1))
    expect(applySpy.mock.calls[0][0]).toMatchObject({ movement_id: 'f1', amount: 12345.5 })
  })
  it('«12.345» bloquea Aplicar con aviso (antes aplicaba ₡12,35)', () => {
    fireEvent.change(abrir(), { target: { value: '12.345' } })
    const btn = screen.getByRole('button', { name: /Aplicar \(/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe(msgMontoDecimales(2))
    fireEvent.click(btn)
    expect(applySpy).not.toHaveBeenCalled()
  })
  it('negativo bloquea Aplicar', () => {
    fireEvent.change(abrir(), { target: { value: '-100' } })
    expect((screen.getByRole('button', { name: /Aplicar \(/ }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('el reparto FIFO precargado con céntimos se lee bien (2 decimales)', () => {
    render(<AplicarCreditoModal supplier={supplier} credits={[credit({ amount_crc: 100.3 })]} applications={[]}
      pendientes={[fac({ id: 'a', amount_crc: 0.1 }), fac({ id: 'b', amount_crc: 500, created_at: '2026-07-06T12:00:00Z' })]}
      onDone={vi.fn()} onClose={vi.fn()} />)
    const [a, b] = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(a.value).toBe('0.1')
    expect(b.value).toBe('100.2')
    expect((screen.getByRole('button', { name: /Aplicar \(/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
