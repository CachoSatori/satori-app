// @vitest-environment happy-dom
// (13-nov, decisiones del dueño) Asistente «Agregar»: varios documentos en una foto, duplicados y lectura fallida.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashSession, Supplier } from '../../shared/types/database'
import type { DocExtract } from '../../shared/api/documents'

const CLAVE = '5'.repeat(50)
const doc = (over: Partial<DocExtract> = {}): Partial<DocExtract> => ({
  tipo: 'factura', proveedor: 'Pescadería del Pacífico', numero_documento: '1001', moneda: 'CRC', fecha: '2026-11-12',
  total: 50000, confianza: 0.9, items: [], clave_fe: null, ...over,
})
const m = vi.hoisted(() => ({
  createSpy: vi.fn(async (x: Record<string, unknown>) => ({ ...x, id: 'mov-1', _pending: false })),
  uploadSpy: vi.fn<(...a: unknown[]) => Promise<{ path: string; sha: string }>>(async () => ({ path: 'docs/f.jpg', sha: 'sha-foto' })),
  leer: vi.fn(),
  createDocSpy: vi.fn<(...a: unknown[]) => Promise<{ id: string }>>(async () => ({ id: 'doc1' })),
  dupFoto: vi.fn(async (): Promise<unknown> => null),
  dupClave: vi.fn(async (): Promise<unknown> => null),
  parecida: vi.fn(async (): Promise<unknown> => null),
}))
vi.mock('../../shared/api/cash', () => ({ createCashMovement: m.createSpy, upsertSupplier: vi.fn() }))
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  return { ...actual, uploadImage: m.uploadSpy, extractImageDetalle: m.leer, createDocumentRow: m.createDocSpy,
           sha256File: async () => 'sha-foto', findDuplicate: m.dupFoto, findDuplicateClave: m.dupClave, findFacturaParecida: m.parecida }
})
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: async () => ({ blob: new Blob(['x']), filename: 'f.jpg' }) }))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import AgregarAsistente from './AgregarAsistente'

const sup: Supplier = { id: 'p1', name: 'Pescadería del Pacífico', category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Efectivo', cuenta_iban: '', aliases: null, is_active: true, email: null, whatsapp: null, notificar_pago: 'no',
  created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z' }
const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession
let onError: ReturnType<typeof vi.fn<(msg: string) => void>>

function abrirYSacarFoto() {
  onError = vi.fn<(msg: string) => void>()
  render(<AgregarAsistente openSession={session} suppliers={[sup]} role="cajero" createdBy="u1" tc={600}
    onCreated={vi.fn()} onClose={vi.fn()} onError={onError} />)
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
}
const confirmarBtn = () => screen.getByRole('button', { name: /Confirmar y registrar/ }) as HTMLButtonElement

beforeEach(() => {
  for (const f of Object.values(m)) f.mockClear()
  m.leer.mockResolvedValue({ documentos: [doc()], fallo: false })
  m.dupFoto.mockResolvedValue(null); m.dupClave.mockResolvedValue(null); m.parecida.mockResolvedValue(null)
})

describe('asistente «Agregar» — fotos (13-nov)', () => {
  it('un documento → igual que hoy: precarga, sin avisos; al confirmar, un solo documento enlazado', async () => {
    abrirYSacarFoto()
    await waitFor(() => expect((screen.getByLabelText('Proveedor') as HTMLInputElement).value).toBe('Pescadería del Pacífico'))
    expect(screen.queryByText(/documentos: el primero/)).toBeNull()
    fireEvent.click(confirmarBtn())
    await waitFor(() => expect(m.createDocSpy).toHaveBeenCalledTimes(1))
    expect(m.createDocSpy.mock.calls[0]).toEqual(['docs/f.jpg', 'sha-foto', expect.objectContaining({ numero_documento: '1001' }), 'u1', 'mov-1', 'procesado'])
  })

  it('varios documentos → aviso; al confirmar: el primero enlazado y los otros 2 a la Bandeja («nuevo», sin enlazar)', async () => {
    m.leer.mockResolvedValue({ documentos: [doc(), doc({ numero_documento: '2002', total: 1000 }), doc({ numero_documento: '3003', total: 2000 })], fallo: false })
    abrirYSacarFoto()
    await screen.findByText(/Esta foto tiene 3 documentos: el primero está acá; los otros 2 quedan en la Bandeja/)
    fireEvent.click(confirmarBtn())
    await waitFor(() => expect(m.createDocSpy).toHaveBeenCalledTimes(3))
    expect(m.createDocSpy.mock.calls[0][4]).toBe('mov-1')
    for (const c of m.createDocSpy.mock.calls.slice(1)) expect(c).toHaveLength(4)   // sin movimiento ni estado → «nuevo» en la Bandeja
    expect(m.createDocSpy.mock.calls.slice(1).map(c => (c[2] as unknown as DocExtract).numero_documento)).toEqual(['2002', '3003'])
    expect(m.createSpy).toHaveBeenCalledTimes(1)   // UN movimiento: los otros se confirman en la Bandeja
  })

  it('misma foto ya cargada → BLOQUEA: no sube, no lee, no abre el formulario', async () => {
    m.dupFoto.mockResolvedValue({ id: 'x', created_at: '2026-11-12T23:32:00Z' })
    abrirYSacarFoto()
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Esta foto ya fue cargada \(el 12-nov 17:32\)/)))
    expect(m.uploadSpy).not.toHaveBeenCalled()
    expect(m.leer).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()
  })

  it('misma clave FE (otra foto) → BLOQUEA: no abre el formulario ni crea nada', async () => {
    m.leer.mockResolvedValue({ documentos: [doc({ clave_fe: CLAVE }), doc({ numero_documento: '2002' })], fallo: false })
    m.dupClave.mockResolvedValue({ id: 'x', created_at: '2026-11-11T20:00:00Z' })
    abrirYSacarFoto()
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/misma clave FE\) ya fue cargada/)))
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()
    expect(m.createDocSpy).not.toHaveBeenCalled()
    expect(m.createSpy).not.toHaveBeenCalled()
  })

  it('mismo proveedor + número + total → aviso; «Confirmar» bloqueado hasta tocar «Es otra»', async () => {
    m.parecida.mockResolvedValue({ id: 'x', created_at: '2026-11-10T20:00:00Z' })
    abrirYSacarFoto()
    await screen.findByText(/Ya hay una factura de este proveedor con el número 1001/)
    expect(confirmarBtn().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Es otra' }))
    await waitFor(() => expect(confirmarBtn().disabled).toBe(false))
    fireEvent.click(confirmarBtn())
    await waitFor(() => expect(m.createSpy).toHaveBeenCalledTimes(1))
  })

  it('lectura fallida → aviso «falló la lectura»; sin documentos (lectura bien) → «no encontró una factura»; la foto se enlaza igual', async () => {
    m.leer.mockResolvedValue({ documentos: [], fallo: true })
    abrirYSacarFoto()
    await screen.findByText(/No se pudo leer la factura \(falló la lectura\)/)
    document.body.innerHTML = ''
    m.leer.mockResolvedValue({ documentos: [], fallo: false })
    abrirYSacarFoto()
    await screen.findByText(/La IA no encontró una factura en la foto/)
  })
})
