// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// F4.3b + T3-A — adjuntar factura a una tarea de Revisión SIN factura. Test light (sin DB ni red):
// mockeamos supabase y el pipeline. Desde T3-A el flujo es normalize→upload→extract→CONFIRMACIÓN
// (proveedor/total leídos vs los del pago) y createDocumentRow (enlazado por linked_movement_id,
// estado='procesado') SOLO corre si el contador confirma. Cancelar no crea nada. Nunca se toca el
// cash_movement.
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
    extractSpy: vi.fn(async () => [{ tipo: 'factura', proveedor: 'Pescadería del Mar', moneda: 'CRC', total: 50000, items: [{ descripcion: 'pescado', cantidad: 2 }] }]),
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
    // T3-A2: sin factura NO hay panel lateral ni layout ancho — el modal queda como hoy.
    expect(screen.queryByAltText('Factura (panel)')).toBeNull()
    expect(document.querySelector('.cd-modal.invrev-has-foto')).toBeNull()
  })

  it('sacar la foto muestra la CONFIRMACIÓN (proveedor/total leídos vs el pago) sin crear el doc todavía', async () => {
    await openDetail()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['data'], 'factura.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText('¿Esta factura corresponde a este pago?')).toBeTruthy())
    expect(normalizeSpy).toHaveBeenCalledWith(file)
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(extractSpy).toHaveBeenCalledWith('docs/factura.jpg')
    expect(createDocSpy).not.toHaveBeenCalled()        // el doc NO se crea hasta confirmar

    // Lo leído por la IA vs lo que dice el pago, lado a lado.
    expect(screen.getByText('Pescadería del Mar')).toBeTruthy()          // proveedor leído
    expect(screen.getByText(/Proveedor del pago/)).toBeTruthy()
    // total leído (= monto → sin ⚠). Matcher por función (el separador de miles de es-CR es un
    // espacio no separable) + tag: el <strong> es el de la confirmación (la tarjeta de la lista
    // muestra el mismo monto en un div).
    expect(screen.getAllByText(t => t.replace(/\s/g, '') === '₡50000').some(el => el.tagName === 'STRONG')).toBe(true)
    expect(screen.getByText(/Monto del pago/)).toBeTruthy()
    expect(screen.queryByText(/no coincide con el monto del pago/)).toBeNull()
  })

  it('CONFIRMAR crea el documento enlazado al movimiento (mismos args que F4.3b)', async () => {
    await openDetail()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['data'], 'factura.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /Confirmar y adjuntar/ })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Confirmar y adjuntar/ }))
    await waitFor(() => expect(createDocSpy).toHaveBeenCalledTimes(1))

    // createDocumentRow(path, sha, ex, createdBy, linkedMovementId, estado)
    const args = createDocSpy.mock.calls[0] as unknown[]
    expect(args[0]).toBe('docs/factura.jpg')           // path
    expect(args[1]).toBe('sha123')                     // sha (de uploadImage)
    expect((args[2] as { proveedor?: string })?.proveedor).toBe('Pescadería del Mar')   // lo extraído viaja al doc
    expect(args[3]).toBe('u-contador')                 // lo registra el contador que adjunta
    expect(args[4]).toBe('m1')                         // linked_movement_id = cash_movement_id de la tarea
    expect(args[5]).toBe('procesado')                  // no entra a la cola de la Bandeja
  })

  it('CANCELAR no crea nada y deja volver a sacar la foto', async () => {
    await openDetail()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['data'], 'factura.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(createDocSpy).not.toHaveBeenCalled()        // no se creó nada
    // El botón de adjuntar vuelve → puede sacar otra foto.
    await waitFor(() => expect(screen.getByRole('button', { name: /Adjuntar factura/ })).toBeTruthy())
    expect(screen.queryByText('¿Esta factura corresponde a este pago?')).toBeNull()
  })

  it('si el total leído difiere del pago (>2%/₡50) la confirmación muestra el aviso de descuadre', async () => {
    extractSpy.mockResolvedValueOnce([{ tipo: 'factura', proveedor: 'Otro Prov', moneda: 'CRC', total: 80000, items: [] }])
    await openDetail()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['data'], 'factura.jpg', { type: 'image/jpeg' })] } })

    await waitFor(() => expect(screen.getByText('¿Esta factura corresponde a este pago?')).toBeTruthy())
    expect(screen.getByText(/no coincide con el monto del pago/)).toBeTruthy()   // ⚠ descuadre (80k vs 50k)
    expect(createDocSpy).not.toHaveBeenCalled()
  })

  it('adjuntar NO toca el cash_movement ni antes ni después de confirmar (no metadata, no RPC)', async () => {
    await openDetail()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /Confirmar y adjuntar/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Confirmar y adjuntar/ }))

    await waitFor(() => expect(createDocSpy).toHaveBeenCalledTimes(1))
    expect(updateMovementMetadataSpy).not.toHaveBeenCalled()
    expect(rpcSpy).not.toHaveBeenCalled()              // ni complete_inventory_review ni discard
  })
})
