// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Supplier } from '../../shared/types/database'

// EXTRA del lote quick-wins — buscador en vivo de Proveedores. NULL-SAFE desde el día uno:
// category/contact son NULLABLE en la base; el filtro no debe romper con fixture null.

vi.mock('../../shared/api/cash', () => ({
  upsertSupplier: vi.fn(),
  deactivateSupplier: vi.fn(),
}))
vi.mock('../../shared/api/documents', () => ({
  listLinkedDocs: vi.fn(async () => []),
  uploadImage: vi.fn(),
  createDocumentRow: vi.fn(),
  extractImage: vi.fn(),
}))
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'manager', full_name: 'M' } }),
}))
vi.mock('../../shared/ManagerOverride', () => ({ useManagerOverride: () => vi.fn(async () => ({ ok: true })) }))
vi.mock('../../shared/FacturaVerify', () => ({ default: () => null }))

import CashProveedores from './CashProveedores'

const sup = (over: Partial<Supplier>): Supplier => ({
  id: 'x', name: 'X', category: 'Otros', contact: '', moneda: 'CRC',
  ciclo_pago: 'Semanal', metodo_pago: 'Efectivo', cuenta_iban: '', aliases: null,
  is_active: true, email: null, whatsapp: null, notificar_pago: 'no',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

const suppliers = [
  sup({ id: 's1', name: 'Proveedor de prueba 1', category: 'Pescados y Mariscos', contact: '8000-0011' }),
  sup({ id: 's2', name: 'Proveedor de prueba 4',    category: 'Vegetales',           contact: 'Doña Ana' }),
  // Fila con category y contact NULL — el caso que no debe romper el filtro.
  sup({ id: 's3', name: 'Proveedor Sin Datos',   category: null as unknown as string, contact: null as unknown as string }),
]

const renderProv = () => render(
  <CashProveedores suppliers={suppliers} movements={[]} credits={[]} applications={[]} onRefresh={vi.fn()} />,
)

const buscar = (t: string) =>
  fireEvent.change(screen.getByPlaceholderText('Buscar proveedor...'), { target: { value: t } })

describe('CashProveedores · buscador null-safe', () => {
  it('filtra por nombre sin romper con filas de category/contact null', () => {
    renderProv()
    expect(() => buscar('prueba 1')).not.toThrow()
    expect(screen.getByText('Proveedor de prueba 1')).toBeTruthy()
    expect(screen.queryByText('Proveedor de prueba 4')).toBeNull()
    expect(screen.queryByText('Proveedor Sin Datos')).toBeNull()
  })

  it('filtra por categoría', () => {
    renderProv()
    buscar('vegetales')
    expect(screen.getByText('Proveedor de prueba 4')).toBeTruthy()
    expect(screen.queryByText('Proveedor de prueba 1')).toBeNull()
  })

  it('filtra por contacto', () => {
    renderProv()
    buscar('doña ana')
    expect(screen.getByText('Proveedor de prueba 4')).toBeTruthy()
    expect(screen.queryByText('Proveedor de prueba 1')).toBeNull()
  })

  it('la fila de campos null se puede buscar por su nombre, sin crash', () => {
    renderProv()
    expect(() => buscar('sin datos')).not.toThrow()
    expect(screen.getByText('Proveedor Sin Datos')).toBeTruthy()
  })

  it('estado vacío "Sin coincidencias" cuando nada matchea', () => {
    renderProv()
    buscar('zzz-no-existe')
    expect(screen.getByText('Sin coincidencias')).toBeTruthy()
    expect(screen.queryByText('Proveedor de prueba 1')).toBeNull()
  })
})
