// @vitest-environment happy-dom
// (12-nov, el dueño) El caso real: una factura se cargó con foto, su movimiento se BORRÓ (17:01) y se recargó la
// misma foto (17:26). delete_movement_cascade deja el documento «procesado» sin vínculo (huérfano), y ese huérfano NO
// puede bloquear la recarga. Las consultas de duplicados son las REALES (findDuplicate, findDuplicateClave,
// findFacturaParecida) contra una tabla `documents` en memoria; solo se simulan la subida, la lectura de la IA y el sha.
// Se prueba en las tres pantallas: el asistente «Agregar», «➕ Agregar foto» y la Bandeja.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CashMovement, CashSession, Supplier } from '../../shared/types/database'
import { tablaDocs, vaciarDocs, borrarMovimiento } from '../../shared/api/documentosEnMemoria.testutil'

const CLAVE = '50612112600310100000000100001010000099001100000001'
const FACTURA = {
  tipo: 'factura', proveedor: 'Pescadería del Pacífico', proveedor_cedula: '3101000000', numero_documento: '00100001010000099001',
  moneda: 'CRC', fecha: '2026-11-13', total: 48500, confianza: 0.9, items: [], clave_fe: CLAVE,
}
const m = vi.hoisted(() => {
  let n = 0
  return {
    crearMov: vi.fn(async (x: Record<string, unknown>) => ({ ...x, id: `mov-${++n}`, _pending: false })),
    reiniciar: () => { n = 0 },
  }
})
vi.mock('../../shared/api/supabase', async () => ({ supabase: (await import('../../shared/api/documentosEnMemoria.testutil')).supabaseEnMemoria }))
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  return {
    ...actual,                                    // findDuplicate / findDuplicateClave / findFacturaParecida / createDocumentRow REALES
    sha256File: async () => 'sha-99001',          // siempre la misma foto
    uploadImage: async () => ({ path: 'docs/99001.jpg', sha: 'sha-99001' }),
    extractImageDetalle: async () => ({ documentos: [FACTURA], fallo: false }),
    extractImage: async () => [FACTURA],
    signedUrl: async () => null,
    listLinkedDocs: async () => [],
  }
})
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: async () => ({ blob: new Blob(['x']), filename: 'f.jpg' }) }))
vi.mock('../../shared/api/cash', () => ({
  createCashMovement: m.crearMov, upsertSupplier: vi.fn(), deactivateSupplier: vi.fn(), sendPagoProveedorEmail: vi.fn(),
  getSuppliers: async () => [], getAllCashMovements: async () => [], updateMovementStatus: vi.fn(), getOpenCashSession: async () => null,
  createDayMovement: vi.fn(),
}))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: async () => [] }))
vi.mock('../../shared/api/exchangeRate', () => ({ getCurrentRate: async () => 600 }))
vi.mock('../../shared/api/inventoryIngest', async (orig) => ({ ...(await orig<object>()), listDocsNeedingInventory: async () => [] }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'admin' } }) }))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => async () => true }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => <span>📷 factura</span> }))

import AgregarAsistente from './AgregarAsistente'
import { PagoFoto } from './CashProveedores'
import InboxModule from '../inbox/InboxModule'

const sup: Supplier = { id: 'p1', name: 'Pescadería del Pacífico', category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal',
  metodo_pago: 'Efectivo', cuenta_iban: '', aliases: null, is_active: true, email: null, whatsapp: null, notificar_pago: 'no',
  created_at: '2026-06-29T00:00:00Z', updated_at: '2026-06-29T00:00:00Z' }
const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession
const subirFoto = () => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement,
  { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })

beforeEach(() => { cleanup(); vaciarDocs(); m.reiniciar(); m.crearMov.mockClear() })

// ── Asistente «Agregar» ────────────────────────────────────────────────────────
async function cargarEnAsistente() {
  const onError = vi.fn<(msg: string) => void>()
  render(<AgregarAsistente openSession={session} suppliers={[sup]} role="cajero" createdBy="u1" tc={600}
    onCreated={vi.fn()} onClose={vi.fn()} onError={onError} />)
  subirFoto()
  return onError
}
const confirmar = () => screen.findByRole('button', { name: /Confirmar y registrar/ }) as Promise<HTMLButtonElement>

describe('huérfanos: borrar el movimiento → recargar la misma foto → se permite (13-nov)', () => {
  it('asistente «Agregar»: con el movimiento vivo bloquea; borrado, la misma foto vuelve a entrar sin avisos', async () => {
    // 1) Primera carga: queda el documento «procesado» enlazado a mov-1.
    let onError = await cargarEnAsistente()
    fireEvent.click(await confirmar())
    await waitFor(() => expect(tablaDocs).toHaveLength(1))
    expect(tablaDocs[0]).toMatchObject({ estado: 'procesado', linked_movement_id: 'mov-1', sha256: 'sha-99001' })
    cleanup()

    // 2) Control: con el movimiento vivo, la misma foto BLOQUEA.
    onError = await cargarEnAsistente()
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Esta foto ya fue cargada/)))
    cleanup()

    // 3) Se borra el movimiento (17:01) → el documento queda huérfano: «procesado», sin vínculo.
    borrarMovimiento('mov-1')
    expect(tablaDocs[0]).toMatchObject({ estado: 'procesado', linked_movement_id: null })

    // 4) Recarga de la misma foto (17:26): se permite, sin bloqueo por foto ni por clave FE ni aviso de «parecida».
    onError = await cargarEnAsistente()
    const btn = await confirmar()
    await waitFor(() => expect((screen.getByLabelText('Proveedor') as HTMLInputElement).value).toBe('Pescadería del Pacífico'))
    expect(onError).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Es otra' })).toBeNull()
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await waitFor(() => expect(tablaDocs).toHaveLength(2))
    expect(tablaDocs[1]).toMatchObject({ estado: 'procesado', linked_movement_id: 'mov-2', clave_fe: CLAVE })
  })

  it('asistente «Agregar»: un documento descartado tampoco bloquea', async () => {
    tablaDocs.push({ id: 'd0', created_at: '2026-11-13T23:00:00Z', image_path: 'x', sha256: 'sha-99001', estado: 'descartado',
      linked_movement_id: null, clave_fe: CLAVE, tipo: 'factura', raw_json: FACTURA, created_by: 'u1' })
    const onError = await cargarEnAsistente()
    expect((await confirmar()).disabled).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  it('asistente «Agregar»: un huérfano MÁS NUEVO no tapa a un documento vigente más viejo de la misma foto', async () => {
    const fila = { image_path: 'x', sha256: 'sha-99001', clave_fe: CLAVE, tipo: 'factura', raw_json: FACTURA, created_by: 'u1' }
    tablaDocs.push({ ...fila, id: 'vivo', created_at: '2026-11-10T20:00:00Z', estado: 'procesado', linked_movement_id: 'mov-vivo' })
    tablaDocs.push({ ...fila, id: 'huerfano', created_at: '2026-11-13T23:01:00Z', estado: 'procesado', linked_movement_id: null })
    const onError = await cargarEnAsistente()
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Esta foto ya fue cargada/)))
  })

  it('«➕ Agregar foto»: la foto del movimiento borrado se puede adjuntar al pago nuevo', async () => {
    const pago = (id: string) => ({ id } as CashMovement)
    // Primera vez: la foto queda enlazada a mov-viejo.
    let onAdded = vi.fn()
    render(<PagoFoto movement={pago('mov-viejo')} doc={null} createdBy="u1" onAdded={onAdded} onRefresh={vi.fn()} />)
    subirFoto()
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    cleanup()
    // Control: con mov-viejo vivo, adjuntarla a otro pago se bloquea.
    onAdded = vi.fn()
    render(<PagoFoto movement={pago('mov-nuevo')} doc={null} createdBy="u1" onAdded={onAdded} onRefresh={vi.fn()} />)
    subirFoto()
    await screen.findByText(/Esta foto ya fue cargada/)
    expect(onAdded).not.toHaveBeenCalled()
    cleanup()
    // Se borra mov-viejo → la misma foto se adjunta al pago nuevo.
    borrarMovimiento('mov-viejo')
    onAdded = vi.fn()
    render(<PagoFoto movement={pago('mov-nuevo')} doc={null} createdBy="u1" onAdded={onAdded} onRefresh={vi.fn()} />)
    subirFoto()
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(screen.queryByText(/ya fue cargada/)).toBeNull()
    expect(tablaDocs.filter(d => d.linked_movement_id === 'mov-nuevo')).toHaveLength(1)
  })

  it('Bandeja: con el movimiento vivo bloquea; borrado, la misma foto entra a la cola como «nuevo»', async () => {
    tablaDocs.push({ id: 'd0', created_at: '2026-11-13T22:00:00Z', image_path: 'x', sha256: 'sha-99001', estado: 'procesado',
      linked_movement_id: 'mov-viejo', clave_fe: CLAVE, tipo: 'factura', raw_json: FACTURA, created_by: 'u1' })
    const bandeja = () => render(<MemoryRouter><InboxModule /></MemoryRouter>)
    bandeja()
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull())
    subirFoto()
    await screen.findByText(/Esta foto ya fue cargada/)
    expect(tablaDocs).toHaveLength(1)
    cleanup()

    borrarMovimiento('mov-viejo')
    bandeja()
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull())
    subirFoto()
    await screen.findByText(/1 documento\(s\) detectado\(s\)/)
    expect(screen.queryByText(/ya fue cargada|ya estaba cargada|se parece/)).toBeNull()
    expect(tablaDocs).toHaveLength(2)
    expect(tablaDocs[1]).toMatchObject({ estado: 'nuevo', linked_movement_id: null, clave_fe: CLAVE })
  })
})

// (12-nov, el dueño) Un «nuevo» de la Bandeja SIGUE bloqueando, pero el aviso dice qué hacer: confirmarla ahí.
describe('un documento «nuevo» de la Bandeja bloquea con el aviso «confirmala ahí» (12-nov)', () => {
  const enBandeja = (over: Partial<(typeof tablaDocs)[number]> = {}) => tablaDocs.push({ id: 'en-bandeja',
    created_at: '2026-11-12T20:00:00Z', image_path: 'x', sha256: 'sha-99001', estado: 'nuevo', linked_movement_id: null,
    clave_fe: CLAVE, tipo: 'factura', raw_json: FACTURA, created_by: 'u1', ...over })
  const AVISO = 'Esta foto ya está en la Bandeja esperando confirmación (cargada el 12-nov 14:00). No se registró nada: confirmala ahí.'

  it('asistente, misma foto → «ya está en la Bandeja… confirmala ahí»; no crea nada', async () => {
    enBandeja()
    const onError = await cargarEnAsistente()
    await waitFor(() => expect(onError).toHaveBeenCalledWith(AVISO))
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()
    expect(tablaDocs).toHaveLength(1)
    expect(m.crearMov).not.toHaveBeenCalled()
  })

  it('asistente, otra foto con la misma clave FE → el mismo aviso, para la factura', async () => {
    enBandeja({ sha256: 'otra-foto' })
    const onError = await cargarEnAsistente()
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(
      /^Esta factura \(misma clave FE\) ya está en la Bandeja esperando confirmación \(cargada el 12-nov 14:00\)\. No se registró nada: confirmala ahí\.$/)))
  })

  it('«➕ Agregar foto» → el mismo aviso; no enlaza', async () => {
    enBandeja()
    const onAdded = vi.fn()
    render(<PagoFoto movement={{ id: 'mov-x' } as CashMovement} doc={null} createdBy="u1" onAdded={onAdded} onRefresh={vi.fn()} />)
    subirFoto()
    await screen.findByText(AVISO)
    expect(onAdded).not.toHaveBeenCalled()
    expect(tablaDocs).toHaveLength(1)
  })

  it('«➕ Agregar foto», otra foto con la misma clave FE → el aviso de la factura', async () => {
    enBandeja({ sha256: 'otra-foto' })
    render(<PagoFoto movement={{ id: 'mov-x' } as CashMovement} doc={null} createdBy="u1" onAdded={vi.fn()} onRefresh={vi.fn()} />)
    subirFoto()
    await screen.findByText(/^Esta factura \(misma clave FE\) ya está en la Bandeja esperando confirmación.*confirmala ahí\.$/)
    expect(tablaDocs).toHaveLength(1)
  })

  it('Bandeja → «ya está en esta Bandeja… confirmala en la lista»', async () => {
    enBandeja()
    render(<MemoryRouter><InboxModule /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull())
    subirFoto()
    await screen.findByText(/Esta foto ya está en esta Bandeja esperando confirmación \(cargada el 12-nov 14:00\)\. No se registró nada: confirmala en la lista\./)
    expect(tablaDocs).toHaveLength(1)
  })

  it('Bandeja, otra foto con la misma clave FE → el aviso de la factura', async () => {
    enBandeja({ sha256: 'otra-foto' })
    render(<MemoryRouter><InboxModule /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull())
    subirFoto()
    await screen.findByText(/Esta factura \(misma clave FE\) ya está en esta Bandeja esperando confirmación.*confirmala en la lista\./)
    expect(tablaDocs).toHaveLength(1)
  })
})
