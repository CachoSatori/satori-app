// PoS F1 — API de locales, catálogo de modificadores y salón (migración 022).
// Las tablas nuevas no están en los tipos generados todavía (se regeneran
// post-merge); este cliente laxo tipa por las interfaces de abajo.
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

const sb = supabase as unknown as SupabaseClient

export interface PosLocation {
  id: string
  name: string
  is_active: boolean
}

export interface ModifierGroupRow {
  id: string
  name: string
  required: boolean
  min_selections: number
  max_selections: number
  location_id: string
  is_active: boolean
}

export interface ModifierRow {
  id: string
  group_id: string
  name: string
  price_delta_crc: number
  sort_order: number
  is_active: boolean
}

export interface ProductGroupLink {
  product_name: string
  group_id: string
  sort_order: number
}

export interface SalonTable {
  id: string
  location_id: string
  name: string
  capacity: number
  shape: 'square' | 'round' | 'bar'
  pos_x: number
  pos_y: number
  is_active: boolean
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

// ── Locales ──────────────────────────────────────────────────
export async function getLocations(): Promise<PosLocation[]> {
  const { data, error } = await sb.from('locations').select('*').order('name')
  fail(error)
  return (data ?? []) as PosLocation[]
}

export async function upsertLocation(loc: { id: string; name: string; is_active?: boolean }): Promise<void> {
  const { error } = await sb.from('locations').upsert({ ...loc, updated_at: new Date().toISOString() })
  fail(error)
}

// ── Catálogo: grupos + modificadores + vínculos ──────────────
export async function getModifierGroups(locationId: string): Promise<ModifierGroupRow[]> {
  const { data, error } = await sb.from('modifier_groups').select('*').eq('location_id', locationId).order('name')
  fail(error)
  return (data ?? []) as ModifierGroupRow[]
}

export async function saveModifierGroup(g: Partial<ModifierGroupRow> & { name: string; location_id: string }): Promise<ModifierGroupRow> {
  const row = { ...g, updated_at: new Date().toISOString() }
  const { data, error } = await sb.from('modifier_groups').upsert(row).select().single()
  fail(error)
  return data as ModifierGroupRow
}

export async function getModifiers(groupIds: string[]): Promise<ModifierRow[]> {
  if (!groupIds.length) return []
  const { data, error } = await sb.from('modifiers').select('*').in('group_id', groupIds).order('sort_order')
  fail(error)
  return (data ?? []) as ModifierRow[]
}

export async function saveModifier(m: Partial<ModifierRow> & { group_id: string; name: string }): Promise<void> {
  const { error } = await sb.from('modifiers').upsert(m)
  fail(error)
}

export async function deleteModifier(id: string): Promise<void> {
  const { error } = await sb.from('modifiers').delete().eq('id', id)
  fail(error)
}

export async function getProductGroupLinks(): Promise<ProductGroupLink[]> {
  const { data, error } = await sb.from('product_modifier_groups').select('*')
  fail(error)
  return (data ?? []) as ProductGroupLink[]
}

export async function linkProductGroup(productName: string, groupId: string): Promise<void> {
  const { error } = await sb.from('product_modifier_groups').upsert({ product_name: productName, group_id: groupId })
  fail(error)
}

export async function unlinkProductGroup(productName: string, groupId: string): Promise<void> {
  const { error } = await sb.from('product_modifier_groups').delete().match({ product_name: productName, group_id: groupId })
  fail(error)
}

// ── Salón ────────────────────────────────────────────────────
export async function getSalonTables(locationId: string): Promise<SalonTable[]> {
  const { data, error } = await sb.from('salon_tables').select('*').eq('location_id', locationId).order('name')
  fail(error)
  return (data ?? []) as SalonTable[]
}

export async function saveSalonTable(t: Partial<SalonTable> & { location_id: string; name: string }): Promise<SalonTable> {
  const row = { ...t, updated_at: new Date().toISOString() }
  const { data, error } = await sb.from('salon_tables').upsert(row).select().single()
  fail(error)
  return data as SalonTable
}

export async function deactivateSalonTable(id: string): Promise<void> {
  const { error } = await sb.from('salon_tables').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id)
  fail(error)
}

// Productos del catálogo existente (para vincular grupos) — búsqueda liviana
export async function searchProducts(term: string, limit = 15): Promise<Array<{ nombre: string; tipo: string }>> {
  const { data, error } = await sb.from('product_map').select('nombre, tipo').ilike('nombre', `%${term}%`).limit(limit)
  fail(error)
  return (data ?? []) as Array<{ nombre: string; tipo: string }>
}

// ── F2: pedidos del comandero ─────────────────────────────────
export interface PosOrder {
  id: string
  location_id: string
  table_id: string | null
  table_name: string
  opened_by: string
  salonero_name: string
  pax: number
  status: 'open' | 'closed' | 'cancelled'
  created_at: string
}

export interface PosOrderItem {
  id: string
  order_id: string
  product_name: string
  qty: number
  base_price_crc: number
  modifiers: Array<{ id: string; name: string; price_delta_crc: number }>
  price_crc: number
  seat: number
  course: 'bebida' | 'entrada' | 'principal'
  kitchen_status: 'pendiente' | 'marchado' | 'listo' | 'entregado'
  marched_at: string | null
  created_at: string
}

export async function getOpenOrders(locationId: string): Promise<PosOrder[]> {
  const { data, error } = await sb.from('pos_orders').select('*')
    .eq('location_id', locationId).eq('status', 'open').order('created_at')
  fail(error)
  return (data ?? []) as PosOrder[]
}

export async function openOrder(p: { location_id: string; table_id: string | null; table_name: string; opened_by: string; salonero_name: string; pax: number }): Promise<PosOrder> {
  if (!Number.isInteger(p.pax) || p.pax < 1) throw new Error('Pax obligatorio: mínimo 1 — el 0 no existe')
  const { data, error } = await sb.from('pos_orders').insert(p).select().single()
  fail(error)
  return data as PosOrder
}

export async function updateOrderPax(orderId: string, pax: number): Promise<void> {
  if (!Number.isInteger(pax) || pax < 1) throw new Error('Pax obligatorio: mínimo 1 — el 0 no existe')
  const { error } = await sb.from('pos_orders').update({ pax, updated_at: new Date().toISOString() }).eq('id', orderId)
  fail(error)
}

export async function getOrderItems(orderId: string): Promise<PosOrderItem[]> {
  const { data, error } = await sb.from('pos_order_items').select('*').eq('order_id', orderId).order('created_at')
  fail(error)
  return (data ?? []) as PosOrderItem[]
}

export async function addOrderItem(item: Omit<PosOrderItem, 'id' | 'kitchen_status' | 'marched_at' | 'created_at'>): Promise<void> {
  const { error } = await sb.from('pos_order_items').insert(item)
  fail(error)
}

export async function updateItemCourse(itemId: string, course: PosOrderItem['course']): Promise<void> {
  const { error } = await sb.from('pos_order_items').update({ course, updated_at: new Date().toISOString() }).eq('id', itemId)
  fail(error)
}

export async function deleteOrderItem(itemId: string): Promise<void> {
  const { error } = await sb.from('pos_order_items').delete().eq('id', itemId).eq('kitchen_status', 'pendiente')
  fail(error)
}

/** Marchar: manda a cocina los ítems pendientes del curso (o todos con course=null). */
export async function marchar(orderId: string, course: PosOrderItem['course'] | null): Promise<void> {
  let qy = sb.from('pos_order_items')
    .update({ kitchen_status: 'marchado', marched_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('order_id', orderId).eq('kitchen_status', 'pendiente')
  if (course) qy = qy.eq('course', course)
  const { error } = await qy
  fail(error)
}

/** Grupos de modificadores de un producto, listos para el comandero. */
export async function getProductGroups(productName: string): Promise<Array<ModifierGroupRow & { modifiers: ModifierRow[] }>> {
  const { data: links, error: e1 } = await sb.from('product_modifier_groups').select('group_id').eq('product_name', productName)
  fail(e1)
  const ids = ((links ?? []) as Array<{ group_id: string }>).map(l => l.group_id)
  if (!ids.length) return []
  const { data: groups, error: e2 } = await sb.from('modifier_groups').select('*').in('id', ids).eq('is_active', true)
  fail(e2)
  const mods = await getModifiers(ids)
  return ((groups ?? []) as ModifierGroupRow[]).map(g => ({ ...g, modifiers: mods.filter(m => m.group_id === g.id && m.is_active) }))
}
