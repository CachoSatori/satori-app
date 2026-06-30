// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashSession, Supplier } from '../../shared/types/database'

// F4.3 (foto/IA en el asistente) — con foto, la IA PRECARGA campos editables (RN-2) y al confirmar se
// crea el movimiento Y el documento enlazado por linked_movement_id. Test light: createCashMovement y el
// pipeline (normalize/upload/extract/createDocumentRow) mockeados; classifyMovement + pagoMatrix REALES.

const { createSpy, uploadSpy, extractSpy, createDocSpy, normalizeSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-1', _pending: false })),
  uploadSpy: vi.fn(async () => ({ path: 'docs/factura.jpg', sha: 'sha123' })),
  extractSpy: vi.fn(async () => [{
    tipo: 'factura', proveedor: 'Pescadería del Pacífico', moneda: 'CRC', fecha: '2026-06-20',
    total: 50000, items: [{ descripcion: 'pescado', cantidad: 2 }, { descripcion: 'camarón', cantidad: 1 }],
  }]),
  createDocSpy: vi.fn(async () => ({ id: 'doc1' })),
  normalizeSpy: vi.fn(async () => ({ blob: new Blob(['x']), filename: 'factura.jpg' })),
}))

vi.mock('../../shared/api/cash', () => ({ createCashMovement: createSpy }))
vi.mock('../../shared/api/documents', () => ({ uploadImage: uploadSpy, extractImage: extractSpy, createDocumentRow: createDocSpy }))
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: normalizeSpy }))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import AgregarAsistente from './AgregarAsistente'

const mkSupplier = (name: string): Supplier => ({
  id: name, name, category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Efectivo', cuenta_iban: '', aliases: null, is_active: true,
  created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z',
})

const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession
const suppliers: Supplier[] = [mkSupplier('Pescadería del Pacífico')]

function renderAsistente() {
  render(
    <AgregarAsistente openSession={session} suppliers={suppliers} role="cajero" createdBy="u1" tc={600}
      onCreated={vi.fn()} onClose={vi.fn()} onError={vi.fn()} />,
  )
}
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement
const takePhoto = () => fireEvent.change(fileInput(), { target: { files: [new File(['d'], 'factura.jpg', { type: 'image/jpeg' })] } })
const confirmar = () => fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar/ }))

beforeEach(() => { createSpy.mockClear(); uploadSpy.mockClear(); extractSpy.mockClear(); createDocSpy.mockClear(); normalizeSpy.mockClear() })

describe('AgregarAsistente — foto/IA', () => {
  it('precarga los campos desde lo extraído por la IA (editables)', async () => {
    renderAsistente()
    takePhoto()
    await waitFor(() => expect(extractSpy).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByLabelText('Proveedor') as HTMLInputElement).value).toBe('Pescadería del Pacífico'))
    expect((screen.getByLabelText('Monto colones') as HTMLInputElement).value).toBe('50000')
    expect((screen.getByLabelText('Fecha de factura') as HTMLInputElement).value).toBe('2026-06-20')
    // El pipeline corrió en orden: normalize → upload → extract.
    expect(normalizeSpy).toHaveBeenCalled()
    expect(uploadSpy).toHaveBeenCalled()
  })

  it('al confirmar crea el movimiento (mercadería) Y el documento enlazado por linked_movement_id', async () => {
    renderAsistente()
    takePhoto()
    await waitFor(() => expect((screen.getByLabelText('Proveedor') as HTMLInputElement).value).toBe('Pescadería del Pacífico'))
    confirmar()

    await waitFor(() => expect(createDocSpy).toHaveBeenCalledTimes(1))
    // Movimiento: proveedor reconocido → mercadería, con el monto leído.
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy.mock.calls[0][0]).toMatchObject({
      movement_type: 'egreso_mercaderia', classification: 'mercaderia', amount_crc: 50000,
    })
    // Documento: createDocumentRow(path, sha, extraído, createdBy, linked_movement_id = mov.id, 'procesado')
    const args = createDocSpy.mock.calls[0] as unknown[]
    expect(args[0]).toBe('docs/factura.jpg')   // path
    expect(args[1]).toBe('sha123')             // sha
    expect(args[3]).toBe('u1')                 // createdBy
    expect(args[4]).toBe('mov-1')              // linked_movement_id = id del movimiento recién creado
    expect(args[5]).toBe('procesado')
  })

  it('RN-2: lo precargado es editable — al confirmar manda el valor EDITADO, no el del OCR', async () => {
    renderAsistente()
    takePhoto()
    await waitFor(() => expect((screen.getByLabelText('Monto colones') as HTMLInputElement).value).toBe('50000'))
    // El humano corrige el monto.
    fireEvent.change(screen.getByLabelText('Monto colones'), { target: { value: '99000' } })
    confirmar()
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy.mock.calls[0][0]).toMatchObject({ amount_crc: 99000 })
  })

  it('camino MANUAL (sin foto) sigue igual: crea el movimiento y NO crea documento', async () => {
    renderAsistente()
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'pago de electricidad' } })
    fireEvent.change(screen.getByLabelText('Monto colones'), { target: { value: '25000' } })
    confirmar()
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy.mock.calls[0][0]).toMatchObject({ classification: 'operativa' })
    expect(createDocSpy).not.toHaveBeenCalled()
    expect(uploadSpy).not.toHaveBeenCalled()
  })
})
