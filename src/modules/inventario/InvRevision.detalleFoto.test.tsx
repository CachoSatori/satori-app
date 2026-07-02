// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// T3-A parte 1 — la FOTO de la factura se ve en el modal de detalle de Revisión (para comparar la
// factura real contra los ítems leídos por la IA) y abre fullscreen al tocarla. Reusa FacturaThumbs
// REAL (no mockeado) con resolve=signedUrl (bucket 'documents'). Test light: sin DB ni red.

const H = vi.hoisted(() => {
  const task = {
    id: 't1', status: 'PENDIENTE', cash_movement_id: 'm1', document_id: 'doc1', supplier_id: null,
    entry_date: '2026-07-01', amount_crc: 50000, currency: 'CRC',
  }
  const doc = {
    id: 'doc1', image_path: 'docs/factura-1.jpg', linked_movement_id: 'm1', estado: 'procesado',
    raw_json: { items: [{ descripcion: 'pescado', cantidad: 2 }], total: 50000, proveedor: 'Pescadería del Mar' },
  }
  const movement = {
    id: 'm1', created_by: 'u-cajero', amount_crc: 50000, amount_usd: 0, currency: 'CRC',
    method: 'Efectivo', status: 'aprobado', caja_origen: 'Caja Proveedores',
    created_at: '2026-07-01T10:00:00Z', description: 'Pescado',
  }
  const responses: Record<string, { data: unknown; error: null }> = {
    inventory_review_task: { data: [task], error: null },
    documents: { data: [doc], error: null },                              // CON factura → se ve la foto
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
    signedUrlSpy: vi.fn(async () => 'https://signed.example/factura-1.jpg'),
  }
})

vi.mock('../../shared/api/supabase', () => ({ supabase: { from: (t: string) => H.makeBuilder(t), rpc: H.rpcSpy } }))
vi.mock('../../shared/api/documents', () => ({
  signedUrl: H.signedUrlSpy,
  uploadImage: vi.fn(),
  extractImage: vi.fn(),
  createDocumentRow: vi.fn(),
}))
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: vi.fn() }))
vi.mock('../../shared/api/cash', () => ({ getSuppliers: vi.fn(async () => []), updateMovementMetadata: vi.fn() }))
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
// OJO: FacturaThumbs NO se mockea — es justo lo que se está probando (thumb + lightbox).

import InvRevision from './InvRevision'

const openDetail = async () => {
  render(<InvRevision ingredients={[]} onRefresh={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('Revisar →')).toBeTruthy())
  fireEvent.click(screen.getByText('Revisar →'))
  await waitFor(() => expect(screen.getByText(/Factura adjunta/)).toBeTruthy())
}

describe('InvRevision — la foto de la factura en el detalle (T3-A parte 1)', () => {
  it('el detalle muestra el thumb de la factura (signedUrl del bucket documents)', async () => {
    await openDetail()
    // FacturaThumbs resuelve la URL vía el resolve inyectado (signedUrl de api/documents).
    await waitFor(() => expect(screen.getByAltText('Factura 1')).toBeTruthy())
    expect((screen.getByAltText('Factura 1') as HTMLImageElement).src).toBe('https://signed.example/factura-1.jpg')
    expect(H.signedUrlSpy).toHaveBeenCalledWith('docs/factura-1.jpg')
    // No es una tarea sin factura: el flujo de adjuntar no aparece.
    expect(screen.queryByRole('button', { name: /Adjuntar factura/ })).toBeNull()
  })

  it('tocar el thumb abre la foto fullscreen (lightbox) y ✕ la cierra', async () => {
    await openDetail()
    await waitFor(() => expect(screen.getByAltText('Factura 1')).toBeTruthy())

    fireEvent.click(screen.getByAltText('Factura 1'))
    // Lightbox abierto: el thumb + la imagen fullscreen (misma alt) conviven.
    await waitFor(() => expect(screen.getAllByAltText('Factura 1')).toHaveLength(2))

    fireEvent.click(screen.getByText('✕'))
    await waitFor(() => expect(screen.getAllByAltText('Factura 1')).toHaveLength(1))
  })
})
