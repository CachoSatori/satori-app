// @vitest-environment happy-dom
// (13-nov, prueba física del dueño, caso B) Caja → «Agregar» con la foto de una factura YA cargada: la app bloqueaba
// pero el aviso iba a onError → el banner de CashModule, que queda DETRÁS del overlay fijo del modal. La cajera veía la
// ventana de cargar foto «como si nada». Ahora el aviso va DENTRO del modal, arriba (bajo el título), en el paso de la
// foto, y se queda hasta que cargue otra foto o cierre. Ídem «➕ Agregar foto» (al lado del botón, como alerta).
//
// Mutaciones anotadas (cada una hace fallar al menos una prueba de este archivo):
//  M1. AgregarAsistente.onPhoto: volver a `onError(mensajeBloqueo(...))` (prop del padre) en lugar de `setAviso(...)`
//      → fallan 2 pruebas del asistente (el texto no está en el documento). Verificada (13-nov).
//  M2. Sacar el bloque `{aviso && …}` del render → mismas pruebas fallan.
//  M3. Post-pago: volver a `onCreated(mov); onClose()` sin la vista «listo» → falla «post-pago… queda en «listo»». Verificada (13-nov).
//  M4. PagoFoto: quitar role="alert" del error → falla la prueba de «Agregar foto». Verificada (13-nov).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import type { CashMovement, CashSession, Supplier } from '../../shared/types/database'

const m = vi.hoisted(() => ({
  crearMov: vi.fn(async (x: Record<string, unknown>) => ({ ...x, id: 'mov-1', _pending: false })),
  subir: vi.fn(async () => ({ path: 'docs/f.jpg', sha: 'sha-foto' })),
  leer: vi.fn(),
  crearDoc: vi.fn<(...a: unknown[]) => Promise<{ id: string }>>(async () => ({ id: 'doc1' })),
  dupFoto: vi.fn(async (): Promise<unknown> => null),
}))
vi.mock('../../shared/api/cash', () => ({ createCashMovement: m.crearMov, upsertSupplier: vi.fn() }))
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  return { ...actual, uploadImage: m.subir, extractImageDetalle: m.leer, createDocumentRow: m.crearDoc,
           sha256File: async () => 'sha-foto', findDuplicate: m.dupFoto,
           findDuplicateClave: async () => null, findFacturaParecida: async () => null, signedUrl: async () => null }
})
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: async () => ({ blob: new Blob(['x']), filename: 'f.jpg' }) }))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => <span>📷 factura</span> }))

import AgregarAsistente from './AgregarAsistente'
import { PagoFoto } from './CashProveedores'

const FACTURA = { tipo: 'factura', proveedor: 'Pescadería del Pacífico', numero_documento: '1001', moneda: 'CRC',
  fecha: '2026-11-12', total: 50000, confianza: 0.9, items: [], clave_fe: null }
const sup: Supplier = { id: 'p1', name: 'Pescadería del Pacífico', category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Efectivo', cuenta_iban: '', aliases: null, is_active: true, email: null, whatsapp: null, notificar_pago: 'no',
  created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z' }
const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession
const YA_CARGADA = /Esta foto ya fue cargada \(el 12-nov 17:32\)\. No se registró nada/
const subirFoto = () => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement,
  { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })

function abrir() {
  const p = { onCreated: vi.fn(), onClose: vi.fn(), onError: vi.fn() }
  render(<AgregarAsistente openSession={session} suppliers={[sup]} role="cajero" createdBy="u1" tc={600} {...p} />)
  return p
}

beforeEach(() => {
  cleanup()
  for (const f of Object.values(m)) f.mockClear()
  m.leer.mockResolvedValue({ documentos: [FACTURA], fallo: false })
  m.dupFoto.mockResolvedValue(null)
  m.crearDoc.mockReset(); m.crearDoc.mockImplementation(async () => ({ id: 'doc1' }))
})

describe('caso B (13-nov): el aviso de bloqueo se ve DENTRO del modal del asistente', () => {
  it('foto ya cargada → el aviso está en el modal, arriba (bajo el título), en el paso de la foto; no se registra nada', async () => {
    m.dupFoto.mockResolvedValue({ id: 'x', estado: 'procesado', created_at: '2026-11-12T23:32:00Z' })
    const p = abrir()
    subirFoto()
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toMatch(YA_CARGADA)
    const modal = document.querySelector('.cd-modal') as HTMLElement
    expect(modal.contains(alerta)).toBe(true)
    // arriba: es lo primero después del título (sin scroll en el celular)
    expect(alerta.previousElementSibling?.className).toBe('cd-modal-title')
    // sigue en el paso de la foto: las dos opciones a la vista, sin formulario
    expect(within(modal).getByRole('button', { name: /Sacar foto de la factura/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()
    expect(p.onError).not.toHaveBeenCalled()   // ya no va al banner de detrás
    expect(m.subir).not.toHaveBeenCalled()
    expect(m.crearMov).not.toHaveBeenCalled()
  })

  it('el aviso se queda (no se borra en el mismo render) y se va al cargar otra foto', async () => {
    m.dupFoto.mockResolvedValueOnce({ id: 'x', estado: 'procesado', created_at: '2026-11-12T23:32:00Z' })
    abrir()
    subirFoto()
    await screen.findByText(YA_CARGADA)
    await new Promise(r => setTimeout(r, 20))
    expect(screen.getByText(YA_CARGADA)).toBeTruthy()
    subirFoto()   // otra foto, no repetida
    await screen.findByRole('button', { name: /Confirmar y registrar/ })
    expect(screen.queryByText(YA_CARGADA)).toBeNull()
  })

  it('«no se pudo verificar» también se ve dentro del modal', async () => {
    m.dupFoto.mockRejectedValue(new Error('No se pudo verificar si la factura ya está cargada. Revisá la conexión y reintentá.'))
    abrir()
    subirFoto()
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toMatch(/No se pudo verificar/)
    expect(alerta.closest('.cd-modal')).not.toBeNull()
  })

  it('post-pago (falla el enlace): el pago se registra y el modal queda en «listo» con el aviso hasta «Cerrar»', async () => {
    m.crearDoc.mockRejectedValue(new Error('red'))
    const p = abrir()
    subirFoto()
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar y registrar/ }))
    const alerta = await screen.findByText(/El pago se registró, pero la factura no se enlazó/)
    expect(alerta.closest('.cd-modal')).not.toBeNull()
    expect(p.onCreated).toHaveBeenCalledTimes(1)
    expect(p.onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()   // no se puede pagar dos veces
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(p.onClose).toHaveBeenCalledTimes(1)
    expect(m.crearMov).toHaveBeenCalledTimes(1)
  })

  it('sin aviso post-pago: igual que antes (onCreated + onClose)', async () => {
    const p = abrir()
    subirFoto()
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar y registrar/ }))
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1))
    expect(p.onCreated).toHaveBeenCalledTimes(1)
  })
})

describe('caso B (13-nov): «➕ Agregar foto»', () => {
  it('foto ya cargada → alerta al lado del botón; no enlaza', async () => {
    m.dupFoto.mockResolvedValue({ id: 'x', estado: 'procesado', created_at: '2026-11-12T23:32:00Z' })
    const onAdded = vi.fn()
    const { container } = render(<PagoFoto movement={{ id: 'mov-x' } as CashMovement} doc={null} createdBy="u1" onAdded={onAdded} onRefresh={vi.fn()} />)
    subirFoto()
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toMatch(YA_CARGADA)
    expect(container.contains(alerta)).toBe(true)
    expect(within(container).getByText('➕ Agregar foto')).toBeTruthy()   // sigue en el paso de la foto
    expect(onAdded).not.toHaveBeenCalled()
    expect(m.subir).not.toHaveBeenCalled()
  })
})
