// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashSession, Supplier } from '../../shared/types/database'
import type { DocExtract } from '../../shared/api/documents'

// F4.3 (preview + resolución de proveedor). Test light: createCashMovement / upsertSupplier / pipeline
// mockeados; cuadra REAL (importActual); classifyMovement + matchSupplier REALES.

const { createSpy, upsertSpy, uploadSpy, extractSpy, createDocSpy, normalizeSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-1' })),
  upsertSpy: vi.fn(async (p: { name: string }) => ({
    id: 'sup-new', name: p.name, category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
    metodo_pago: 'Efectivo', cuenta_iban: '', aliases: null, is_active: true, created_at: '', updated_at: '',
  })),
  uploadSpy: vi.fn(async () => ({ path: 'docs/f.jpg', sha: 'sha1' })),
  extractSpy: vi.fn(async (): Promise<Partial<DocExtract>[]> => [{
    tipo: 'factura', proveedor: 'Pescadería del Pacífico', moneda: 'CRC', total: 50000, confianza: 0.9,
    items: [{ descripcion: 'pescado fresco', cantidad: 2, precio_unitario: 20000, total: 40000 }, { descripcion: 'camarón', cantidad: 1, precio_unitario: 10000, total: 10000 }],
  }]),
  createDocSpy: vi.fn(async () => ({ id: 'doc1' })),
  normalizeSpy: vi.fn(async () => ({ blob: new Blob(['x']), filename: 'f.jpg' })),
}))

vi.mock('../../shared/api/cash', () => ({ createCashMovement: createSpy, upsertSupplier: upsertSpy }))
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

function renderAsistente(suppliers: Supplier[] = [mkSupplier('Pescadería del Pacífico')]) {
  render(<AgregarAsistente openSession={session} suppliers={suppliers} role="cajero" createdBy="u1" tc={600}
    onCreated={vi.fn()} onClose={vi.fn()} onError={vi.fn()} />)
}
const takePhoto = () => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
const setProveedor = (v: string) => fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: v } })
const setMonto = (v: string) => fireEvent.change(screen.getByLabelText('Monto colones'), { target: { value: v } })
const confirmar = () => fireEvent.click(screen.getByRole('button', { name: /Confirmar y registrar/ }))

beforeEach(() => { createSpy.mockClear(); upsertSpy.mockClear(); extractSpy.mockClear() })

describe('AgregarAsistente — preview de ítems (read-only)', () => {
  it('tras leer la foto muestra la lista de ítems leídos', async () => {
    renderAsistente()
    takePhoto()
    await waitFor(() => expect(screen.getByText(/Ítems leídos por la IA \(2\)/)).toBeTruthy())
    expect(screen.getByText('pescado fresco')).toBeTruthy()
    expect(screen.getByText('camarón')).toBeTruthy()
    expect(screen.getByText(/El emparejamiento ítem↔ingrediente se hace en Revisión/)).toBeTruthy()
  })
})

describe('AgregarAsistente — resolución de proveedor', () => {
  it('MATCH: proveedor reconocido → "✓ reconocido" y el movimiento lleva ese supplier_id', async () => {
    renderAsistente()
    takePhoto()
    await waitFor(() => expect(screen.getByText(/Proveedor reconocido: Pescadería del Pacífico/)).toBeTruthy())
    confirmar()
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy.mock.calls[0][0]).toMatchObject({ supplier_id: 'Pescadería del Pacífico', classification: 'mercaderia' })
  })

  it('NO-MATCH: nombre desconocido → aviso; crear nuevo → el movimiento lleva el supplier_id del creado', async () => {
    renderAsistente()
    setProveedor('Carnes El Nuevo')
    setMonto('30000')
    await waitFor(() => expect(screen.getByText(/«Carnes El Nuevo» no existe en el sistema/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Crear «Carnes El Nuevo»/ }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledWith({ name: 'Carnes El Nuevo' }))
    await waitFor(() => expect(screen.getByText(/Proveedor reconocido: Carnes El Nuevo/)).toBeTruthy())
    confirmar()
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy.mock.calls[0][0]).toMatchObject({ supplier_id: 'sup-new', supplier_name: 'Carnes El Nuevo' })
  })

  it('NO-MATCH: elegir un existente del selector → toma su supplier_id (sin crear)', async () => {
    renderAsistente([mkSupplier('Pescadería del Pacífico')])
    setProveedor('Pescaderia Pacifico SA')   // parecido pero no exacto → desconocido
    setMonto('15000')
    await waitFor(() => expect(screen.getByLabelText('Elegir proveedor existente')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Elegir proveedor existente'), { target: { value: 'Pescadería del Pacífico' } })
    await waitFor(() => expect(screen.getByText(/Proveedor reconocido: Pescadería del Pacífico/)).toBeTruthy())
    confirmar()
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy.mock.calls[0][0]).toMatchObject({ supplier_id: 'Pescadería del Pacífico' })
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('OPERATIVA con proveedor reconocido también lleva supplier_id (agrupa por proveedor)', async () => {
    renderAsistente()
    setProveedor('Pescadería del Pacífico')
    setMonto('20000')
    fireEvent.click(screen.getByRole('button', { name: /Operativa/ }))   // el humano la marca operativa
    confirmar()
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy.mock.calls[0][0]).toMatchObject({ movement_type: 'egreso_operativo', classification: 'operativa', supplier_id: 'Pescadería del Pacífico' })
  })

  it('SIN proveedor (manual) → supplier_id null y no crea proveedores', async () => {
    renderAsistente()
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'pago de electricidad' } })
    setMonto('25000')
    confirmar()
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy.mock.calls[0][0]).toMatchObject({ supplier_id: null })
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})
