// @vitest-environment happy-dom
// (13-nov, decisiones del dueño) «➕ Agregar foto» de Caja/Proveedores: normaliza, bloquea duplicados, enlaza igual con
// aviso si la lectura falla, y manda los demás documentos de la foto a la Bandeja.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashMovement } from '../../shared/types/database'

const CLAVE = '5'.repeat(50)
const m = vi.hoisted(() => ({
  normalize: vi.fn(async () => ({ blob: new Blob(['n']), filename: 'n.jpg' })),
  upload: vi.fn(async () => ({ path: 'docs/n.jpg', sha: 'sha-n' })),
  leer: vi.fn(),
  crear: vi.fn(async () => ({ id: 'doc-nuevo' })),
  dupFoto: vi.fn(async (): Promise<unknown> => null),
  dupClave: vi.fn(async (): Promise<unknown> => null),
  parecida: vi.fn(async (): Promise<unknown> => null),
}))
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  return { ...actual, uploadImage: m.upload, extractImageDetalle: m.leer, createDocumentRow: m.crear, sha256File: async () => 'sha-n',
           findDuplicate: m.dupFoto, findDuplicateClave: m.dupClave, findFacturaParecida: m.parecida, listLinkedDocs: vi.fn(async () => []) }
})
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: m.normalize }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/cash', () => ({ upsertSupplier: vi.fn(), deactivateSupplier: vi.fn(), sendPagoProveedorEmail: vi.fn() }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => <span>📷 factura</span> }))

import { PagoFoto } from './CashProveedores'

const mov = { id: 'mov-9' } as CashMovement
let onAdded: ReturnType<typeof vi.fn>
function subir() {
  onAdded = vi.fn()
  const r = render(<PagoFoto movement={mov} doc={null} createdBy="u1" onAdded={onAdded} onRefresh={vi.fn()} />)
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
  return r
}
beforeEach(() => {
  for (const f of Object.values(m)) f.mockClear()
  m.leer.mockResolvedValue({ documentos: [{ tipo: 'factura', numero_documento: '1', total: 10, items: [] }], fallo: false })
  m.dupFoto.mockResolvedValue(null); m.dupClave.mockResolvedValue(null); m.parecida.mockResolvedValue(null)
})

describe('Caja/Proveedores — «➕ Agregar foto» (13-nov)', () => {
  it('normaliza la foto como la Bandeja y la enlaza al pago', async () => {
    subir()
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith({ id: 'doc-nuevo' }))
    expect(m.normalize).toHaveBeenCalled()
    expect(m.upload.mock.calls[0][1]).toBe('n.jpg')   // sube la normalizada, no el archivo original
    expect(m.crear.mock.calls[0].slice(3)).toEqual(['u1', 'mov-9', 'procesado'])
  })

  it('lectura fallida → la foto se enlaza IGUAL y avisa que no pasa sola a Inventario', async () => {
    m.leer.mockResolvedValue({ documentos: [], fallo: true })
    const { rerender } = subir()
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(m.crear.mock.calls[0][2]).toBeNull()
    // el padre pasa el doc nuevo → se ve la factura y, al lado, el aviso
    rerender(<PagoFoto movement={mov} doc={{ id: 'doc-nuevo' } as never} createdBy="u1" onAdded={onAdded} onRefresh={vi.fn()} />)
    expect(document.body.textContent).toMatch(/📷 factura/)
    expect(document.body.textContent).toMatch(/no se pudo leer \(falló la lectura\)/)
  })

  it('misma foto o misma clave FE → BLOQUEA: no enlaza nada', async () => {
    m.dupFoto.mockResolvedValue({ id: 'x', created_at: '2026-11-12T23:32:00Z' })
    subir()
    await screen.findByText(/Esta foto ya fue cargada/)
    expect(m.crear).not.toHaveBeenCalled()
    document.body.innerHTML = ''
    m.dupFoto.mockResolvedValue(null)
    m.leer.mockResolvedValue({ documentos: [{ tipo: 'factura', clave_fe: CLAVE, items: [] }], fallo: false })
    m.dupClave.mockResolvedValue({ id: 'y', created_at: '2026-11-11T20:00:00Z' })
    subir()
    await screen.findByText(/misma clave FE\) ya fue cargada/)
    expect(m.crear).not.toHaveBeenCalled()
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('varios documentos → el primero enlazado, los demás a la Bandeja («nuevo», sin enlazar)', async () => {
    m.leer.mockResolvedValue({ documentos: [{ tipo: 'factura', numero_documento: '1', items: [] }, { tipo: 'factura', numero_documento: '2', items: [] }], fallo: false })
    subir()
    await waitFor(() => expect(m.crear).toHaveBeenCalledTimes(2))
    expect(m.crear.mock.calls[0][4]).toBe('mov-9')
    expect(m.crear.mock.calls[1]).toHaveLength(4)
  })
})
