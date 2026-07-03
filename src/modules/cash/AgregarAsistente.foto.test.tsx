// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashSession, Supplier } from '../../shared/types/database'
import type { DocExtract } from '../../shared/api/documents'

// F4.3 (foto/IA en el asistente) — con foto, la IA PRECARGA campos editables (RN-2) y al confirmar se
// crea el movimiento Y el documento enlazado por linked_movement_id. Test light: createCashMovement y el
// pipeline (normalize/upload/extract/createDocumentRow) mockeados; classifyMovement + pagoMatrix REALES.

const { createSpy, uploadSpy, extractSpy, createDocSpy, normalizeSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-1', _pending: false })),
  uploadSpy: vi.fn(async () => ({ path: 'docs/factura.jpg', sha: 'sha123' })),
  extractSpy: vi.fn(async (): Promise<Partial<DocExtract>[]> => [{
    tipo: 'factura', proveedor: 'Pescadería del Pacífico', moneda: 'CRC', fecha: '2026-06-20',
    total: 50000, items: [{ descripcion: 'pescado', cantidad: 2 }, { descripcion: 'camarón', cantidad: 1 }],
  }]),
  createDocSpy: vi.fn(async () => ({ id: 'doc1' })),
  normalizeSpy: vi.fn(async () => ({ blob: new Blob(['x']), filename: 'factura.jpg' })),
}))

vi.mock('../../shared/api/cash', () => ({ createCashMovement: createSpy }))
// Pipeline mockeado, pero `cuadra` REAL (importActual) para ejercitar el cruce ítems↔total del cartel.
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  return { ...actual, uploadImage: uploadSpy, extractImage: extractSpy, createDocumentRow: createDocSpy }
})
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
  // Flujo guiado: estos tests ejercitan el FORM (precarga/lectura) → entran por "Carga manual";
  // la foto usa el mismo input, siempre montado. El flujo guiado se prueba en su propio archivo.
  fireEvent.click(screen.getByRole('button', { name: /Carga manual/ }))
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

describe('AgregarAsistente — cartel de calidad de lectura (confianza / cuadre)', () => {
  beforeEach(() => extractSpy.mockClear())

  it('alta confianza + ítems que cuadran → muestra % y "cuadran", sin aviso', async () => {
    extractSpy.mockResolvedValueOnce([{ tipo: 'factura', proveedor: 'Pescadería del Pacífico', moneda: 'CRC', fecha: '2026-06-20', total: 50000, confianza: 0.95, items: [{ descripcion: 'pescado', total: 50000 }] }])
    renderAsistente()
    takePhoto()
    await waitFor(() => expect(screen.getByText(/confianza 95%/)).toBeTruthy())
    expect(screen.getByText(/los ítems cuadran con el total/)).toBeTruthy()
    expect(screen.queryByText(/revisá bien los campos y los ítems/)).toBeNull()   // sin aviso de baja confianza
  })

  it('confianza baja (<0.5) → aviso prominente y NO bloquea el confirmar', async () => {
    extractSpy.mockResolvedValueOnce([{ tipo: 'factura', proveedor: 'Proveedor X', moneda: 'CRC', total: 10000, confianza: 0.3, items: [{ descripcion: 'algo', total: 10000 }] }])
    renderAsistente()
    takePhoto()
    await waitFor(() => expect(screen.getByText(/revisá bien los campos y los ítems/)).toBeTruthy())
    expect(screen.getByText(/confianza 30%/)).toBeTruthy()
    // No bloquea: confirmar sigue funcionando.
    confirmar()
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
  })

  it('requiere_revision=true → aviso prominente aunque la confianza sea alta', async () => {
    extractSpy.mockResolvedValueOnce([{ tipo: 'factura', proveedor: 'Y', moneda: 'CRC', total: 5000, confianza: 0.9, requiere_revision: true, items: [{ descripcion: 'a', total: 5000 }] }])
    renderAsistente()
    takePhoto()
    await waitFor(() => expect(screen.getByText(/revisá bien los campos y los ítems/)).toBeTruthy())
  })

  it('los ítems no suman el total (cuadra=false) → muestra el aviso de cuadre', async () => {
    extractSpy.mockResolvedValueOnce([{ tipo: 'factura', proveedor: 'Z', moneda: 'CRC', total: 100000, confianza: 0.9, items: [{ descripcion: 'a', total: 1000 }] }])
    renderAsistente()
    takePhoto()
    await waitFor(() => expect(screen.getByText(/no suman el total/)).toBeTruthy())
  })

  it('sin foto (camino manual) → el cartel de lectura NO aparece', () => {
    renderAsistente()
    expect(screen.queryByText(/Factura leída/)).toBeNull()
  })
})
