// @vitest-environment happy-dom
// (D12 = A, 13-nov) El asistente aprende el nombre legal que lee la IA como alias del proveedor existente que eligió la
// cajera. Solo después de crear el movimiento; si guardar falla, el pago queda igual y no se muestra error.
//
// Mutaciones anotadas (verificadas el 13-nov: cada una tumba las pruebas indicadas; al deshacerla vuelven a verde):
//  A1. confirmar: guardar el alias ANTES de createCashMovement (mover el paso 3 arriba del paso 1) → cae «[orden]».
//  A2. aprenderAlias: sin try/catch (dejar subir el error) → cae «falla del guardado…».
//  A3. pickSupplier: guardar siempre el nombre (sin exigir que lo haya leído la IA) → cae «carga manual…».
//  A4. allSuppliers: sin los `aprendidos` locales → cae «varias facturas…» (la 2 no se reconoce).
//  A5. aprenderAlias: sin `puedeAprenderAlias(role)` → cae «rol sin permiso…».
//  A6. no borrar aliasLeido al editar el nombre Y guardar para el proveedor resuelto (no solo el elegido a mano)
//      → cae «nombre editado…».
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashSession, Supplier, UserRole } from '../../shared/types/database'
import type { DocExtract } from '../../shared/api/documents'

const m = vi.hoisted(() => ({
  crearMov: vi.fn(async (x: Record<string, unknown>) => ({ ...x, id: 'mov-1' })),
  guardar: vi.fn<(id: string, alias: string) => Promise<'agregado' | 'ya_estaba'>>(async () => 'agregado'),
  leer: vi.fn(async (): Promise<{ documentos: Partial<DocExtract>[]; fallo: boolean }> => ({ documentos: [], fallo: false })),
}))
vi.mock('../../shared/api/cash', () => ({ createCashMovement: m.crearMov, upsertSupplier: vi.fn() }))
vi.mock('../../shared/api/proveedorAlias', () => ({ guardarAliasProveedor: m.guardar }))
vi.mock('../../shared/api/documents', async (orig) => {
  const actual = await orig<typeof import('../../shared/api/documents')>()
  return { ...actual, uploadImage: async () => ({ path: 'docs/f.jpg', sha: 'sha1' }), extractImageDetalle: m.leer,
           createDocumentRow: async () => ({ id: 'doc1' }), sha256File: async () => 'sha-foto', findDuplicate: async () => null,
           findDuplicateClave: async () => null, findFacturaParecida: async () => null }
})
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: async () => ({ blob: new Blob(['x']), filename: 'f.jpg' }) }))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import AgregarAsistente from './AgregarAsistente'

const mkSup = (id: string, name: string, aliases: string[] | null = null): Supplier => ({
  id, name, category: null, contact: null, moneda: 'CRC', ciclo_pago: 'Semanal', metodo_pago: 'Efectivo', cuenta_iban: '',
  aliases, is_active: true, email: null, whatsapp: null, notificar_pago: 'no', created_at: '', updated_at: '',
})
const COMERCIAL = mkSup('p1', 'Comercial Ficticio')
const OTRO = mkSup('p2', 'Distribuidora Inventada')
const LEGAL = 'Exportadora Ficticia, S.A.'
const fac = (n: number, proveedor = LEGAL): Partial<DocExtract> => ({
  tipo: 'factura', proveedor, numero_documento: `00100001010000000${n}`, moneda: 'CRC', total: 10000 * n, confianza: 0.9, items: [],
})
const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession

function abrir(role: UserRole = 'cajero', suppliers: Supplier[] = [COMERCIAL, OTRO]) {
  const p = { onClose: vi.fn(), onCambio: vi.fn() }
  render(<AgregarAsistente openSession={session} suppliers={suppliers} role={role} createdBy="u1" tc={600}
    onCreated={vi.fn()} onClose={p.onClose} onProveedoresCambiaron={p.onCambio} />)
  return p
}
const subirFoto = () => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement,
  { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })
const elegir = (id: string) => fireEvent.change(screen.getByLabelText('Elegir proveedor existente'), { target: { value: id } })
const confirmar = async () => fireEvent.click(await screen.findByRole('button', { name: /Confirmar y registrar/ }))
const NOTA = `✓ Guardado: la próxima vez se reconoce «${LEGAL}» como Comercial Ficticio.`

beforeEach(() => {
  m.crearMov.mockClear(); m.guardar.mockReset(); m.guardar.mockResolvedValue('agregado')
  m.leer.mockReset(); m.leer.mockResolvedValue({ documentos: [fac(1)], fallo: false })
})

describe('Asistente — aprende el nombre leído como alias (D12)', () => {
  it('[orden] elegir existente para un nombre no reconocido → guarda el alias UNA vez, después del pago, y lo dice', async () => {
    const p = abrir()
    subirFoto()
    await screen.findByText(new RegExp(`«${LEGAL}» no existe en el sistema`))
    elegir('p1')
    await screen.findByText(/Proveedor reconocido: Comercial Ficticio/)
    await confirmar()
    await waitFor(() => expect(screen.getByTestId('nota-alias').textContent).toBe(NOTA))
    expect(m.crearMov).toHaveBeenCalledTimes(1)
    expect(m.crearMov.mock.calls[0][0]).toMatchObject({ supplier_id: 'p1' })
    expect(m.guardar).toHaveBeenCalledTimes(1)
    expect(m.guardar).toHaveBeenCalledWith('p1', LEGAL)
    expect(m.crearMov.mock.invocationCallOrder[0]).toBeLessThan(m.guardar.mock.invocationCallOrder[0])
    expect(p.onCambio).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('aviso-asistente')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(p.onClose).toHaveBeenCalled()
  })

  it('también con el botón «¿Quisiste decir?»', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1, 'Comercial Ficticio Ltda')], fallo: false })
    abrir()
    subirFoto()
    await screen.findByText(/¿Quisiste decir\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Comercial Ficticio' }))
    await confirmar()
    await waitFor(() => expect(m.guardar).toHaveBeenCalledWith('p1', 'Comercial Ficticio Ltda'))
  })

  it('falla del guardado (red/permisos) → el pago queda igual, sin aviso de error y se cierra como siempre', async () => {
    m.guardar.mockRejectedValue(new Error('permission denied'))
    const p = abrir()
    subirFoto()
    await screen.findByText(/no existe en el sistema/)
    elegir('p1')
    await confirmar()
    await waitFor(() => expect(p.onClose).toHaveBeenCalled())
    expect(m.crearMov).toHaveBeenCalledTimes(1)
    expect(m.crearMov.mock.calls[0][0]).toMatchObject({ supplier_id: 'p1' })
    expect(screen.queryByTestId('aviso-asistente')).toBeNull()
    expect(screen.queryByTestId('nota-alias')).toBeNull()
    expect(p.onCambio).not.toHaveBeenCalled()
  })

  it('alias que ya estaba en la base («ya_estaba») → no se anuncia ni recarga', async () => {
    m.guardar.mockResolvedValue('ya_estaba')
    const p = abrir()
    subirFoto()
    await screen.findByText(/no existe en el sistema/)
    elegir('p1')
    await confirmar()
    await waitFor(() => expect(p.onClose).toHaveBeenCalled())
    expect(m.guardar).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('nota-alias')).toBeNull()
    expect(p.onCambio).not.toHaveBeenCalled()
  })

  it('carga manual (nombre escrito, sin foto) → no aprende alias', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /Carga manual/ }))
    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: LEGAL } })
    fireEvent.change(screen.getByLabelText('Monto colones'), { target: { value: '5000' } })
    elegir('p1')
    await confirmar()
    await waitFor(() => expect(m.crearMov).toHaveBeenCalledTimes(1))
    expect(m.guardar).not.toHaveBeenCalled()
  })

  it('nombre editado a mano después de elegir → no aprende alias', async () => {
    abrir()
    subirFoto()
    await screen.findByText(/no existe en el sistema/)
    elegir('p1')
    await screen.findByText(/Proveedor reconocido: Comercial Ficticio/)
    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Comercial Ficticio.' } })   // sigue reconocido (misma clave)
    await confirmar()
    await waitFor(() => expect(m.crearMov).toHaveBeenCalledTimes(1))
    expect(m.guardar).not.toHaveBeenCalled()
  })

  it('rol sin permiso de UPDATE en suppliers (contador) → no intenta guardar', async () => {
    abrir('contador')
    subirFoto()
    await screen.findByText(/no existe en el sistema/)
    elegir('p1')
    await confirmar()
    await waitFor(() => expect(m.crearMov).toHaveBeenCalledTimes(1))
    expect(m.guardar).not.toHaveBeenCalled()
  })

  it('varias facturas del mismo proveedor legal en una foto → la 2 se reconoce sola y el alias se guarda una sola vez', async () => {
    m.leer.mockResolvedValue({ documentos: [fac(1), fac(2, 'EXPORTADORA FICTICIA S. A.')], fallo: false })
    abrir()
    subirFoto()
    await screen.findByText(/no existe en el sistema/)
    elegir('p1')
    await confirmar()
    await waitFor(() => expect(screen.getByTestId('varias-progreso').textContent).toMatch(/2 de 2/))
    expect(await screen.findByText(/Proveedor reconocido: Comercial Ficticio/)).toBeTruthy()
    expect(screen.queryByText(/no existe en el sistema/)).toBeNull()
    expect(screen.getByTestId('nota-alias').textContent).toBe(NOTA)
    await confirmar()
    await waitFor(() => expect(m.crearMov).toHaveBeenCalledTimes(2))
    expect(m.crearMov.mock.calls[1][0]).toMatchObject({ supplier_id: 'p1' })
    expect(m.guardar).toHaveBeenCalledTimes(1)
  })
})
