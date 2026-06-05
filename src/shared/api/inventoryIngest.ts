import { supabase } from './supabase'
import type { Supplier } from '../types/database'
import type { DocumentRow } from './documents'

// Facturas/proformas ya procesadas (gasto creado) que todavía no tienen su
// inventario ingresado. El encargado las procesa cuando quiere (batch).
export async function listDocsNeedingInventory(): Promise<DocumentRow[]> {
  const { data: docs } = await supabase.from('documents')
    .select('*').in('tipo', ['factura', 'proforma'])
    .order('created_at', { ascending: false }).limit(80)
  const rows = (docs ?? []) as DocumentRow[]
  // Solo facturas con el gasto ya creado (procesado) y con ítems para ingresar.
  const candidates = rows.filter(d => d.estado === 'procesado' && (d.raw_json?.items?.length ?? 0) > 0)
  if (!candidates.length) return []
  const { data: inv } = await supabase.from('inventory_movements')
    .select('document_id').in('document_id', candidates.map(d => d.id))
  const done = new Set((inv as { document_id: string }[] | null ?? []).map(r => r.document_id))
  return candidates.filter(d => !done.has(d.id))
}

export interface SupplierItemMap {
  id: string
  supplier_id: string | null
  codigo: string | null
  descripcion_factura: string | null
  ingredient_id: string | null
  es_inventario: boolean
  unidad_factura: string | null
  factor_conversion: number
}

export interface IngredientPrice {
  id: string
  ingredient_id: string
  supplier_id: string | null
  fecha: string | null
  precio_unitario: number
  unidad: string | null
  document_id: string | null
  created_at: string
}

// Línea de inventario lista para commitear (resuelta por el humano).
export interface InvLine {
  codigo: string | null
  descripcion: string
  ingredient_id: string | null   // null si "no es inventario"
  ingredient_unit: string         // unidad base del ingrediente
  unidad_factura: string
  factor_conversion: number       // unidades base por 1 unidad de factura
  cantidad: number                // cantidad en unidades de factura
  precio_unitario: number         // precio por unidad de factura
  es_inventario: boolean
}

// ── Mapeo aprendido ──────────────────────────────────────────
export async function getSupplierItemMap(supplierId: string): Promise<SupplierItemMap[]> {
  const { data, error } = await supabase.from('supplier_item_map')
    .select('*').eq('supplier_id', supplierId)
  if (error) throw new Error(error.message)
  return (data ?? []) as SupplierItemMap[]
}

async function upsertSupplierItemMap(m: Omit<SupplierItemMap, 'id'>): Promise<void> {
  // Match manual por (supplier, codigo) o (supplier, descripción) — los índices
  // únicos son parciales, así que resolvemos a mano.
  const hasCode = !!(m.codigo && m.codigo.trim())
  let q = supabase.from('supplier_item_map').select('id').eq('supplier_id', m.supplier_id)
  q = hasCode ? q.eq('codigo', m.codigo) : q.ilike('descripcion_factura', (m.descripcion_factura || ''))
  const { data } = await q.limit(1)
  const existing = (data as { id: string }[] | null)?.[0]
  const payload = { ...m, updated_at: new Date().toISOString() }
  if (existing) {
    await supabase.from('supplier_item_map').update(payload).eq('id', existing.id)
  } else {
    await supabase.from('supplier_item_map').insert(payload)
  }
}

// ── Proveedor / ingrediente al vuelo ─────────────────────────
export async function findOrCreateSupplier(name: string, suppliers: Supplier[]): Promise<string | null> {
  const n = name.trim().toLowerCase()
  if (!n) return null
  const found = suppliers.find(s => s.name.toLowerCase() === n
    || (s.aliases ?? []).some(a => a.toLowerCase() === n))
  if (found) return found.id
  const { data, error } = await supabase.from('suppliers')
    .insert({ name: name.trim(), is_active: true }).select('id').single()
  if (error) return null
  return (data as { id: string }).id
}

export async function createIngredient(name: string, unit: string, supplier?: string): Promise<string> {
  const { data, error } = await supabase.from('ingredients')
    .insert({ name: name.trim(), unit, current_stock: 0, min_stock: 0, cost_per_unit: 0, supplier: supplier ?? null })
    .select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

// ── Idempotencia ─────────────────────────────────────────────
export async function hasInventoryForDocument(documentId: string): Promise<boolean> {
  const { count } = await supabase.from('inventory_movements')
    .select('id', { count: 'exact', head: true }).eq('document_id', documentId)
  return (count ?? 0) > 0
}

// ── Historial de precios ─────────────────────────────────────
export async function getIngredientPrices(ingredientId: string): Promise<IngredientPrice[]> {
  const { data, error } = await supabase.from('ingredient_prices')
    .select('*').eq('ingredient_id', ingredientId).order('fecha', { ascending: false }).limit(24)
  if (error) throw new Error(error.message)
  return (data ?? []) as IngredientPrice[]
}

// ── Commit del inventario de una factura ─────────────────────
export async function commitInventoryForDocument(params: {
  documentId: string
  cashMovementId: string | null
  supplierId: string | null
  fecha: string | null
  createdBy: string
  lines: InvLine[]
}): Promise<{ ingresados: number }> {
  if (await hasInventoryForDocument(params.documentId)) return { ingresados: 0 }
  let ingresados = 0
  for (const l of params.lines) {
    // Aprender el mapeo (incluso "no es inventario", para no volver a preguntar)
    if (params.supplierId) {
      await upsertSupplierItemMap({
        supplier_id: params.supplierId, codigo: l.codigo, descripcion_factura: l.descripcion,
        ingredient_id: l.es_inventario ? l.ingredient_id : null, es_inventario: l.es_inventario,
        unidad_factura: l.unidad_factura, factor_conversion: l.factor_conversion || 1,
      })
    }
    if (!l.es_inventario || !l.ingredient_id) continue
    const factor = l.factor_conversion || 1
    const qtyBase = l.cantidad * factor
    const costBase = factor ? l.precio_unitario / factor : l.precio_unitario
    // Entrada de stock (el trigger suma a current_stock)
    await supabase.from('inventory_movements').insert({
      ingredient_id: l.ingredient_id, movement_type: 'purchase', qty_delta: qtyBase,
      unit: l.ingredient_unit, unit_cost: costBase, reference_id: params.fecha,
      notes: `Factura · ${l.descripcion}`.slice(0, 200), created_by: params.createdBy,
      document_id: params.documentId, cash_movement_id: params.cashMovementId,
    })
    // Costo actualizado al de esta compra (en unidad base)
    await supabase.from('ingredients').update({ cost_per_unit: costBase, updated_at: new Date().toISOString() }).eq('id', l.ingredient_id)
    // Historial de precio
    await supabase.from('ingredient_prices').insert({
      ingredient_id: l.ingredient_id, supplier_id: params.supplierId, fecha: params.fecha,
      precio_unitario: costBase, unidad: l.ingredient_unit, document_id: params.documentId,
    })
    ingresados++
  }
  return { ingresados }
}
