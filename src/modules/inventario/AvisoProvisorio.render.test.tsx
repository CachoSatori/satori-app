// @vitest-environment happy-dom
// Fase 0 (decisión P4 del dueño, 27-nov; spec compras/stock/costos §11 y §12.2): las pantallas que muestran un stock
// sin base real llevan la etiqueta «Provisorio · no usar para decidir» y la línea de debajo, sin ocultar nada.
// Render real de cada pantalla (Stock con su pedido sugerido, Consumo y el detalle de la Revisión). Datos ficticios.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Ingredient } from '../../shared/types/inventario'
import type { Profile } from '../../shared/types/database'

const H = vi.hoisted(() => {
  const task = { id: 't1', status: 'PENDIENTE', cash_movement_id: 'm1', document_id: 'doc1', supplier_id: null,
    entry_date: '2026-07-01', amount_crc: 1000, currency: 'CRC' }
  const doc = { id: 'doc1', image_path: 'docs/factura-ficticia.jpg', linked_movement_id: 'm1', estado: 'procesado',
    raw_json: { items: [{ descripcion: 'Producto A', cantidad: 1, unidad: 'K' }], total: 1000, proveedor: 'Proveedor de prueba 1' } }
  const movement = { id: 'm1', created_by: 'u-1', amount_crc: 1000, amount_usd: 0, currency: 'CRC', method: 'Efectivo',
    status: 'aprobado', caja_origen: 'Caja Proveedores', created_at: '2026-07-01T10:00:00Z', description: 'Compra ficticia' }
  const responses: Record<string, { data: unknown; error: null }> = {
    inventory_review_task: { data: [task], error: null }, documents: { data: [doc], error: null },
    cash_movements: { data: [movement], error: null }, profiles: { data: [{ id: 'u-1', full_name: 'Usuario Ficticio' }], error: null },
  }
  const makeBuilder = (t: string) => {
    const result = responses[t] ?? { data: [], error: null }
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, in: () => b, order: () => b, update: () => b, single: () => b,
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko),
    }
    return b
  }
  return { makeBuilder }
})

vi.mock('../../shared/api/supabase', () => ({ supabase: { from: (t: string) => H.makeBuilder(t), rpc: vi.fn(async () => ({ error: null })) } }))
vi.mock('../../shared/api/documents', () => ({ signedUrl: vi.fn(async () => null), uploadImage: vi.fn(), extractImage: vi.fn(), createDocumentRow: vi.fn() }))
vi.mock('../../shared/utils/imageNormalize', () => ({ normalizeInvoiceImage: vi.fn() }))
vi.mock('../../shared/api/cash', () => ({ getSuppliers: vi.fn(async () => []), updateMovementMetadata: vi.fn(async () => {}) }))
vi.mock('../../shared/hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u-1', full_name: 'Usuario Ficticio', role: 'manager' } }) }))
vi.mock('../../shared/api/inventoryIngest', async orig => {
  const real = await orig<typeof import('../../shared/api/inventoryIngest')>()
  return { ...real, getSupplierItemMap: vi.fn(async () => []), learnSupplierMappings: vi.fn(async () => {}) }
})
vi.mock('../../shared/api/inventario', () => ({
  getRecipes: vi.fn(async () => []), getAllRecipeIngredients: vi.fn(async () => []),
  countDeductionsForRef: vi.fn(async () => 0), addMovement: vi.fn(async () => {}),
}))
vi.mock('../ventas/ventasFuente', () => ({ ventasDelRango: vi.fn(async () => []) }))

import InvDashboard from './InvDashboard'
import InvConsumo from './InvConsumo'
import InvRevision from './InvRevision'
import { PROVISORIO_TITULO, PROVISORIO_DETALLE } from './AvisoProvisorio'

const ING = [{
  id: 'i1', name: 'Producto A', unit: 'kg', current_stock: 1, min_stock: 2, cost_per_unit: 100, supplier: 'Proveedor de prueba 1',
  category: 'secos', notes: '', updated_at: '2026-01-01', created_at: '2026-01-01',
}] as unknown as Ingredient[]

afterEach(() => { cleanup() })

function etiquetas() {
  const notas = screen.queryAllByRole('note', { name: PROVISORIO_TITULO })
  for (const n of notas) {
    expect(within(n).getByText(`⚠ ${PROVISORIO_TITULO}`)).toBeTruthy()
    expect(within(n).getByText(PROVISORIO_DETALLE)).toBeTruthy()
  }
  return notas
}

describe('Fase 0 · etiqueta «provisorio» en las pantallas de stock sin base (P4)', () => {
  it('textos exactos de la decisión', () => {
    expect(PROVISORIO_TITULO).toBe('Provisorio · no usar para decidir')
    expect(PROVISORIO_DETALLE).toBe('Los números de stock se rehacen desde cero con las facturas electrónicas y los conteos.')
  })

  it('📊 Stock: etiqueta arriba y otra en el pedido sugerido; los números siguen a la vista', () => {
    render(<InvDashboard ingredients={ING} movements={[]} onRefresh={vi.fn()} />)
    const notas = etiquetas()
    expect(notas).toHaveLength(2)
    // La primera va antes de los números (KPI); la segunda, justo debajo del título del pedido sugerido.
    const kpi = screen.getByText('Valor total en stock')
    expect(notas[0].compareDocumentPosition(kpi) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const pedido = screen.getByText('🛒 Orden de compra sugerida')
    expect(pedido.nextElementSibling).toBe(notas[1])
    // Sin ocultar nada: sigue el pedido con su botón y el stock por categoría.
    expect(screen.getByRole('button', { name: /Copiar pedido/ })).toBeTruthy()
    expect(screen.getByText('Stock por categoría')).toBeTruthy()
  })

  it('🍽 Consumo: etiqueta visible al entrar, con el botón de calcular intacto', () => {
    render(<InvConsumo ingredients={ING} onRefresh={vi.fn()} profile={{ id: 'u-1', role: 'manager' } as unknown as Profile} />)
    expect(etiquetas()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Calcular consumo' })).toBeTruthy()
  })

  it('🧾 Revisión: el detalle que dice «entra al stock» lleva la etiqueta', async () => {
    const u = userEvent.setup()
    render(<InvRevision ingredients={ING} onRefresh={vi.fn()} />)
    await u.click(await screen.findByText('Revisar →'))
    const texto = await screen.findByText(/Al completar entra al stock/)
    const notas = etiquetas()
    expect(notas).toHaveLength(1)
    expect(texto.nextElementSibling).toBe(notas[0])
  })
})
