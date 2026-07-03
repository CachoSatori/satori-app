// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { CashSession, Supplier } from '../../shared/types/database'

// Flujo guiado del "➕ Agregar" (decisión de la dueña): el modal abre con DOS opciones — foto
// (protagonista) y carga manual — y el formulario completo recién se revela después. Invariantes:
//   1. Al abrir NO hay formulario: solo las dos opciones, con la foto como botón principal.
//   2. Cancelar la cámara (tap en foto sin sacar foto → no hay change) deja las dos opciones.
//   3. Foto sacada → el form se revela CON la precarga de la IA (flujo de confirmación actual).
//   4. Manual → form completo como hoy, sin foto; el foco arranca en el primer campo (Proveedor).
//   5. "← Volver" limpia el borrador sin crear nada y regresa a las opciones.

const { createSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(async (m: Record<string, unknown>) => ({ ...m, id: 'mov-1', _pending: false })),
}))

vi.mock('../../shared/api/cash', () => ({ createCashMovement: createSpy, upsertSupplier: vi.fn() }))
vi.mock('../../shared/api/finance', () => ({ getFinanceAccounts: vi.fn(async () => []) }))
vi.mock('../../shared/api/documents', () => ({
  uploadImage: vi.fn(async () => ({ path: 'docs/f.jpg', sha: 'sha1' })),
  extractImage: vi.fn(async () => [{
    tipo: 'factura', proveedor: 'Pescadería del Pacífico', moneda: 'CRC', total: 50000,
    fecha: '2026-07-01', confianza: 0.9, items: [],
  }]),
  createDocumentRow: vi.fn(async () => ({ id: 'doc1' })),
  cuadra: vi.fn(() => true),
}))
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: vi.fn(async () => ({ blob: new Blob(['x']), filename: 'f.jpg' })) }))
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

import AgregarAsistente from './AgregarAsistente'

const session = { id: 's1', shift_type: 'AM' } as unknown as CashSession
const suppliers: Supplier[] = []

const renderAsistente = () => render(
  <AgregarAsistente openSession={session} suppliers={suppliers} role="cajero" createdBy="u1" tc={600}
    onCreated={vi.fn()} onClose={vi.fn()} onError={vi.fn()} />,
)

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement
const takePhoto = () => fireEvent.change(fileInput(), { target: { files: [new File(['d'], 'f.jpg', { type: 'image/jpeg' })] } })

describe('AgregarAsistente — flujo guiado (dos opciones → reveal)', () => {
  it('al abrir muestra SOLO las dos opciones, foto protagonista — sin formulario', () => {
    renderAsistente()
    const foto = screen.getByRole('button', { name: /Sacar foto de la factura/ })
    expect(foto.className).toContain('cd-btn-green')           // protagonista (verde/destacado)
    expect(screen.getByRole('button', { name: /Carga manual/ })).toBeTruthy()
    // Nada del form todavía:
    expect(screen.queryByLabelText('Descripción')).toBeNull()
    expect(screen.queryByLabelText('Monto colones')).toBeNull()
    expect(screen.queryByRole('button', { name: /Confirmar y registrar/ })).toBeNull()
  })

  it('cancelar la cámara (tap sin foto → sin change) deja las dos opciones, no un form vacío', () => {
    renderAsistente()
    fireEvent.click(screen.getByRole('button', { name: /Sacar foto de la factura/ }))
    // El click dispara el input de cámara; al cancelar no hay evento change → nada cambia.
    expect(screen.getByRole('button', { name: /Sacar foto de la factura/ })).toBeTruthy()
    expect(screen.queryByLabelText('Monto colones')).toBeNull()
  })

  it('foto sacada → se revela el form con la precarga de la IA (confirmación actual)', async () => {
    renderAsistente()
    takePhoto()
    await waitFor(() => expect((screen.getByLabelText('Proveedor') as HTMLInputElement).value).toBe('Pescadería del Pacífico'))
    expect((screen.getByLabelText('Monto colones') as HTMLInputElement).value).toBe('50000')
    expect(screen.getByRole('button', { name: /Confirmar y registrar/ })).toBeTruthy()
    expect(screen.getByText(/Factura leída/)).toBeTruthy()
  })

  it('carga manual → form completo sin foto; el foco arranca en Proveedor (primer campo del orden)', () => {
    renderAsistente()
    fireEvent.click(screen.getByRole('button', { name: /Carga manual/ }))
    expect(screen.getByLabelText('Descripción')).toBeTruthy()
    expect(screen.getByLabelText('Monto colones')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Confirmar y registrar/ })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Proveedor'))
  })

  it('← Volver limpia el borrador sin crear nada y regresa a las dos opciones', () => {
    renderAsistente()
    fireEvent.click(screen.getByRole('button', { name: /Carga manual/ }))
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'algo a medias' } })
    fireEvent.change(screen.getByLabelText('Monto colones'), { target: { value: '12345' } })

    fireEvent.click(screen.getByRole('button', { name: /Volver/ }))
    expect(createSpy).not.toHaveBeenCalled()                           // no se creó nada
    expect(screen.getByRole('button', { name: /Sacar foto de la factura/ })).toBeTruthy()

    // Re-entrar en manual: el borrador quedó limpio.
    fireEvent.click(screen.getByRole('button', { name: /Carga manual/ }))
    expect((screen.getByLabelText('Descripción') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Monto colones') as HTMLInputElement).value).toBe('')
  })
})
