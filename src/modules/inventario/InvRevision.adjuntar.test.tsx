// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// F4.3b — adjuntar factura a una tarea de Revisión SIN factura. Test light (sin DB ni red): mockeamos
// supabase y el pipeline, y afirmamos que "Adjuntar" llama a normalize→upload→extract→createDocumentRow
// (enlazado por linked_movement_id, estado='procesado') y que NO toca el cash_movement.
//
// Todo el andamiaje del mock va en vi.hoisted: vi.mock se eleva sobre los imports y no puede tocar
// variables de módulo no-elevadas.

const H = vi.hoisted(() => {
  const task = {
    id: 't1', status: 'PENDIENTE', cash_movement_id: 'm1', document_id: null, supplier_id: null,
    entry_date: '2026-06-29', amount_crc: 50000, currency: 'CRC',
  }
  const movement = {
    id: 'm1', created_by: 'u-cajero', amount_crc: 50000, amount_usd: 0, currency: 'CRC',
    method: 'Efectivo', status: 'aprobado', caja_origen: 'Caja Proveedores',
    created_at: '2026-06-29T10:00:00Z', description: 'Pescado',
  }
  const responses: Record<string, { data: unknown; error: null }> = {
    inventory_review_task: { data: [task], error: null },
    documents: { data: [], error: null },                                 // SIN factura → rama !doc
    cash_movements: { data: [movement], error: null },
    profiles: { data: [{ id: 'u-cajero', full_name: 'Caja Uno' }], error: null },
  }
  const makeBuilder = (tableName: string) => {
    const result = responses[tableName] ?? { data: [], error: null }
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, in: () => b, order: () => b, update: () => b, single: () => b,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
    }
    return b
  }
  return {
    makeBuilder,
    rpcSpy: vi.fn(async () => ({ error: null })),
    uploadSpy: vi.fn(async () => ({ path: 'docs/factura.jpg', sha: 'sha123' })),
    extractSpy: vi.fn(async () => [{ tipo: 'factura', moneda: 'CRC', total: 50000, items: [{ descripcion: 'pescado', cantidad: 2 }] }]),
    createDocSpy: vi.fn(async () => ({ id: 'doc1', raw_json: { items: [{ descripcion: 'pescado' }], total: 50000 }, linked_movement_id: 'm1' })),
    normalizeSpy: vi.fn(async () => ({ blob: new Blob(['x']), filename: 'factura.jpg' })),
    updateMovementMetadataSpy: vi.fn(async () => {}),
  }
})
const { uploadSpy, extractSpy, createDocSpy, normalizeSpy, updateMovementMetadataSpy, rpcSpy } = H

vi.mock('../../shared/api/supabase', () => ({ supabase: { from: (t: string) => H.makeBuilder(t), rpc: H.rpcSpy } }))
vi.mock('../../shared/api/documents', () => ({
  signedUrl: vi.fn(async () => null),
  uploadImage: H.uploadSpy,
  extractImage: H.extractSpy,
  createDocumentRow: H.createDocSpy,
}))
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: H.normalizeSpy }))
vi.mock('../../shared/api/cash', () => ({ getSuppliers: vi.fn(async () => []), updateMovementMetadata: H.updateMovementMetadataSpy }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u-contador', full_name: 'Conta Dora', role: 'contador' } }) }))
vi.mock('../../shared/api/inventoryIngest', () => ({
  getSupplierItemMap: vi.fn(async () => []),
  resolveLine: vi.fn(() => ({})),
  resolveEditLines: vi.fn(async () => []),
  buildReviewLines: vi.fn(() => []),
  learnSupplierMappings: vi.fn(async () => {}),
  NONE: '__none__', NEW: '__new__',
}))
vi.mock('../../shared/InvLineTable', () => ({ default: () => null }))

import InvRevision from './InvRevision'

const openDetail = async () => {
  render(<InvRevision ingredients={[]} onRefresh={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('Revisar →')).toBeTruthy())
  fireEvent.click(screen.getByText('Revisar →'))
  await waitFor(() => expect(screen.getByRole('button', { name: /Adjuntar factura/ })).toBeTruthy())
}

beforeEach(() => { uploadSpy.mockClear(); extractSpy.mockClear(); createDocSpy.mockClear(); normalizeSpy.mockClear(); updateMovementMetadataSpy.mockClear() })

describe('InvRevision — adjuntar factura (F4.3b)', () => {
  it('una tarea SIN factura ofrece "Adjuntar factura" y muestra quién registró el pago', async () => {
    await openDetail()
    expect(screen.getByText(/Registrado por/)).toBeTruthy()
    expect(screen.getByText('Caja Uno')).toBeTruthy()          // created_by resuelto a nombre
    expect(screen.getByRole('button', { name: /Descartar/ })).toBeTruthy()   // Descartar sigue disponible
  })

  it('adjuntar dispara el pipeline normalize→upload→extract→createDocumentRow enlazado al movimiento', async () => {
    await openDetail()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['data'], 'factura.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(createDocSpy).toHaveBeenCalledTimes(1))
    expect(normalizeSpy).toHaveBeenCalledWith(file)
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(extractSpy).toHaveBeenCalledWith('docs/factura.jpg')

    // createDocumentRow(path, sha, ex, createdBy, linkedMovementId, estado)
    const args = createDocSpy.mock.calls[0] as unknown[]
    expect(args[0]).toBe('docs/factura.jpg')           // path
    expect(args[1]).toBe('sha123')                     // sha (de uploadImage)
    expect(args[3]).toBe('u-contador')                 // lo registra el contador que adjunta
    expect(args[4]).toBe('m1')                         // linked_movement_id = cash_movement_id de la tarea
    expect(args[5]).toBe('procesado')                  // no entra a la cola de la Bandeja
  })

  it('adjuntar NO toca el cash_movement (no llama a updateMovementMetadata ni RPC sobre el pago)', async () => {
    await openDetail()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })

    await waitFor(() => expect(createDocSpy).toHaveBeenCalledTimes(1))
    expect(updateMovementMetadataSpy).not.toHaveBeenCalled()
    expect(rpcSpy).not.toHaveBeenCalled()              // ni complete_inventory_review ni discard
  })
})
