import { describe, it, expect, vi } from 'vitest'
import { buildReviewLines, type InvLine } from './inventoryIngest'

// buildReviewLines es PURA, pero inventoryIngest importa el cliente supabase (createClient tira
// "Web Worker is not supported" en happy-dom). Mockeamos el leaf para que el import no lo instancie.
vi.mock('./supabase', () => ({ supabase: {} }))

// Factory con defaults razonables (una línea VÁLIDA: inventario + ingrediente). Se sobreescribe por caso.
const line = (over: Partial<InvLine> = {}): InvLine => ({
  codigo: null,
  descripcion: 'item',
  ingredient_id: 'ing-1',
  ingredient_unit: 'kg',
  unidad_factura: 'caja',
  factor_conversion: 1,
  cantidad: 1,
  precio_unitario: 100,
  es_inventario: true,
  ...over,
})

describe('buildReviewLines — filtrado', () => {
  it('excluye no-inventario (es_inventario=false) y sin ingrediente (ingredient_id=null); deja solo las válidas', () => {
    const out = buildReviewLines([
      line({ es_inventario: false, ingredient_id: 'ing-x' }),   // no-inventario → fuera
      line({ es_inventario: true, ingredient_id: null }),        // sin ingrediente → fuera
      line({ ingredient_id: 'ing-ok', descripcion: 'válida' }),  // válida → entra
    ])
    expect(out).toHaveLength(1)
    expect(out[0].ingredient_id).toBe('ing-ok')
    expect(out[0].notes).toBe('Factura · válida')
  })

  it('input vacío → []', () => {
    expect(buildReviewLines([])).toEqual([])
  })

  it('si TODO se filtra → []', () => {
    expect(buildReviewLines([
      line({ es_inventario: false }),
      line({ ingredient_id: null }),
    ])).toEqual([])
  })
})

describe('buildReviewLines — factor de conversión', () => {
  it('caja de 12 (factor 12), cantidad 2 → qty_delta=24; precio 1200 → unit_cost=100', () => {
    const [r] = buildReviewLines([line({ factor_conversion: 12, cantidad: 2, precio_unitario: 1200 })])
    expect(r.qty_delta).toBe(24)
    expect(r.unit_cost).toBe(100)
  })

  it('factor_conversion=0 → factor=1 → qty_delta=cantidad y unit_cost=precio_unitario', () => {
    const [r] = buildReviewLines([line({ factor_conversion: 0, cantidad: 5, precio_unitario: 300 })])
    expect(r.qty_delta).toBe(5)
    expect(r.unit_cost).toBe(300)
  })
})

describe('buildReviewLines — notes', () => {
  it('arma las notes desde la descripción con el prefijo "Factura · "', () => {
    const [r] = buildReviewLines([line({ descripcion: 'Camarón jumbo' })])
    expect(r.notes).toBe('Factura · Camarón jumbo')
  })

  it('trunca las notes a 200 chars cuando la descripción es muy larga', () => {
    const [r] = buildReviewLines([line({ descripcion: 'x'.repeat(300) })])
    expect(r.notes).toHaveLength(200)
    expect(r.notes.startsWith('Factura · xxx')).toBe(true)
  })
})

describe('buildReviewLines — múltiples líneas y campos de salida', () => {
  it('preserva el ORDEN y mapea cada campo de salida correctamente', () => {
    const out = buildReviewLines([
      line({ ingredient_id: 'ing-a', ingredient_unit: 'kg', factor_conversion: 2, cantidad: 3, precio_unitario: 400, descripcion: 'A' }),
      line({ ingredient_id: 'ing-b', ingredient_unit: 'L',  factor_conversion: 1, cantidad: 10, precio_unitario: 50, descripcion: 'B' }),
    ])
    expect(out).toEqual([
      { ingredient_id: 'ing-a', qty_delta: 6,  unit: 'kg', unit_cost: 200, notes: 'Factura · A' },
      { ingredient_id: 'ing-b', qty_delta: 10, unit: 'L',  unit_cost: 50,  notes: 'Factura · B' },
    ])
  })

  it('unit sale del ingredient_unit (unidad base), NO del unidad_factura', () => {
    const [r] = buildReviewLines([line({ ingredient_unit: 'g', unidad_factura: 'bolsa' })])
    expect(r.unit).toBe('g')
  })
})
