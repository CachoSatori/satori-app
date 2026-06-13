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
  kind: 'table' | 'decor'          // decor = barra/macetero/estación/pared (no abre pedidos)
  width: number | null             // null = tamaño default por forma
  height: number | null
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

// Todos los productos del catálogo (para la grilla de precios en Admin)
export async function getAllProducts(): Promise<Array<{ nombre: string; tipo: string }>> {
  const { data, error } = await sb.from('product_map').select('nombre, tipo').order('tipo').order('nombre')
  fail(error)
  return (data ?? []) as Array<{ nombre: string; tipo: string }>
}

// ── F3: precio de venta (modelo fiscal CR) ────────────────────
import type { TaxType } from '../utils/posFiscal'

export interface PosPrice {
  product_name: string
  location_id: string
  price_final_crc: number | null   // IVA incluido; null = sin precio
  tax_type: TaxType
  is_demo: boolean
}

export async function getPrices(locationId: string): Promise<PosPrice[]> {
  const { data, error } = await sb.from('pos_prices').select('*').eq('location_id', locationId)
  fail(error)
  return (data ?? []) as PosPrice[]
}

/** Mapa producto → precio para el comandero (lookup O(1) al armar el pedido). */
export async function getPriceMap(locationId: string): Promise<Map<string, PosPrice>> {
  return new Map((await getPrices(locationId)).map(p => [p.product_name, p]))
}

export async function upsertPrice(p: { product_name: string; location_id: string; price_final_crc: number | null; tax_type: TaxType }): Promise<void> {
  const { error } = await sb.from('pos_prices').upsert({ ...p, is_demo: false, updated_at: new Date().toISOString() })
  fail(error)
}

// ── F3: config del KDS (orden de categorías + umbrales por curso) ──
export interface KdsSettings {
  location_id: string
  category_order: string[]
  course_thresholds: Record<string, number>   // segundos verde→rojo por curso
  subcategory_order: string[]                 // orden escalonado dentro de la comanda (refinamiento 06-12)
  postres_priority: boolean                   // postres destacados + arriba (no quedan al fondo en rush)
  postres_threshold: number                   // timer propio más corto (seg)
}

export async function getKdsSettings(locationId: string): Promise<KdsSettings> {
  const { data, error } = await sb.from('pos_kds_settings').select('*').eq('location_id', locationId).maybeSingle()
  fail(error)
  return (data as KdsSettings) ?? { location_id: locationId, category_order: [], course_thresholds: { bebida: 300, entrada: 600, principal: 900 }, subcategory_order: [], postres_priority: true, postres_threshold: 240 }
}

export async function saveKdsSettings(s: { location_id: string; category_order: string[]; course_thresholds: Record<string, number>; subcategory_order?: string[]; postres_priority?: boolean; postres_threshold?: number }): Promise<void> {
  const { error } = await sb.from('pos_kds_settings').upsert({ ...s, updated_at: new Date().toISOString() })
  fail(error)
}

// ── F2: pedidos del comandero ─────────────────────────────────
export type PosChannel = 'salon' | 'barra' | 'delivery'

export interface TransferTrace {
  at: string
  from_id: string | null
  from_name: string
  to_id: string
  to_name: string
}

export interface PosOrder {
  id: string
  location_id: string
  table_id: string | null
  table_name: string
  opened_by: string
  salonero_name: string
  current_salonero_id: string | null   // dueño VIGENTE tras transferencias (atribución de métricas)
  pax: number
  channel: PosChannel
  status: 'open' | 'closed' | 'cancelled'
  transfers: TransferTrace[]
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
  tax_type: 'iva13' | 'iva4' | 'iva2' | 'iva1' | 'exento'
  station: 'cocina' | 'barra' | 'ninguna'    // snapshot de la ficha: ruteo del KDS
  subcategory: string                        // snapshot: orden escalonado
  aplica_servicio: boolean                   // snapshot fiscal (servicio 10%)
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

export async function openOrder(p: { location_id: string; table_id: string | null; table_name: string; opened_by: string; salonero_name: string; pax: number; channel?: PosChannel }): Promise<PosOrder> {
  if (!Number.isInteger(p.pax) || p.pax < 1) throw new Error('Pax obligatorio: mínimo 1 — el 0 no existe')
  // current_salonero_id arranca = opened_by; las transferencias lo reasignan.
  const row = { ...p, channel: p.channel ?? 'salon', current_salonero_id: p.opened_by }
  const { data, error } = await sb.from('pos_orders').insert(row).select().single()
  fail(error)
  return data as PosOrder
}

/**
 * Transfiere una mesa abierta a otro salonero. Deja traza inmutable en el jsonb
 * `transfers` y reasigna `current_salonero_id` (las métricas siguen al receptor
 * desde este momento). `opened_by`/`salonero_name` quedan como histórico de apertura.
 */
export async function transferOrder(order: PosOrder, to: { id: string; name: string }, from: { id: string | null; name: string }): Promise<void> {
  if (to.id === (order.current_salonero_id ?? order.opened_by)) throw new Error('La mesa ya es de ese salonero')
  const trace: TransferTrace = { at: new Date().toISOString(), from_id: from.id, from_name: from.name, to_id: to.id, to_name: to.name }
  const { error } = await sb.from('pos_orders').update({
    current_salonero_id: to.id,
    salonero_name: to.name,            // el nombre visible pasa al receptor (la apertura vive en transfers)
    transfers: [...(order.transfers ?? []), trace],
    updated_at: new Date().toISOString(),
  }).eq('id', order.id)
  fail(error)
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

/** Marchar: manda a cocina los ítems pendientes del curso (o todos con course=null).
 *  Devuelve los ids marchados — el comandero los usa para la ventana de DESHACER. */
export async function marchar(orderId: string, course: PosOrderItem['course'] | null): Promise<string[]> {
  let qy = sb.from('pos_order_items')
    .update({ kitchen_status: 'marchado', marched_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('order_id', orderId).eq('kitchen_status', 'pendiente')
  if (course) qy = qy.eq('course', course)
  const { data, error } = await qy.select('id')
  fail(error)
  return ((data ?? []) as Array<{ id: string }>).map(r => r.id)
}

/** DESHACER marchar (ventana de gracia del comandero, SPEC C2): revierte a 'pendiente'
 *  SOLO ítems aún en 'marchado' — si cocina ya los bumpeó a 'listo', no se tocan.
 *  El KDS los saca solo (su query filtra marchado + refetch por realtime). */
export async function unmarchar(itemIds: string[]): Promise<void> {
  if (!itemIds.length) return
  const { error } = await sb.from('pos_order_items')
    .update({ kitchen_status: 'pendiente', marched_at: null, updated_at: new Date().toISOString() })
    .in('id', itemIds).eq('kitchen_status', 'marchado')
  fail(error)
}

/** Cancelar una mesa abierta POR ERROR (SPEC C1). Solo sin ítems: si hay pendientes se
 *  borran explícitamente antes; si hay marchados, esto no aplica (void = F3 con gerencia). */
export async function cancelEmptyOrder(orderId: string): Promise<void> {
  const { data, error } = await sb.from('pos_order_items').select('id').eq('order_id', orderId).limit(1)
  fail(error)
  if ((data ?? []).length > 0) throw new Error('La mesa tiene ítems — borralos antes de cancelarla')
  const { error: e2 } = await sb.from('pos_orders')
    .update({ status: 'cancelled', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', orderId).eq('status', 'open')
  fail(e2)
}

/** Traza liviana del pedido (pax editado, deshacer marchar…): append a notes — cero DDL (D3). */
export async function appendOrderNote(orderId: string, note: string): Promise<void> {
  const { data, error } = await sb.from('pos_orders').select('notes').eq('id', orderId).single()
  fail(error)
  const prev = ((data as { notes?: string } | null)?.notes ?? '').trim()
  const { error: e2 } = await sb.from('pos_orders')
    .update({ notes: (prev ? prev + '\n' : '') + note, updated_at: new Date().toISOString() })
    .eq('id', orderId)
  fail(e2)
}

// ── F3: KDS (pantalla de cocina) ──────────────────────────────
export interface KdsTicket {
  order: PosOrder
  items: PosOrderItem[]   // solo los enviados a cocina (marchado/listo), por curso
}

/**
 * Comandas vivas para el KDS: pedidos abiertos del local con ítems EN COCINA
 * (kitchen_status='marchado'). El bump los pasa a 'listo' → salen del KDS (la
 * comanda desaparece cuando todo está listo). Dos queries (orders + items): a
 * escala piloto es barato y evita los embebidos de PostgREST; refetch por realtime.
 */
export async function getKdsTickets(locationId: string): Promise<KdsTicket[]> {
  const orders = await getOpenOrders(locationId)
  if (!orders.length) return []
  const ids = orders.map(o => o.id)
  const { data, error } = await sb.from('pos_order_items').select('*')
    .in('order_id', ids).eq('kitchen_status', 'marchado').order('marched_at')
  fail(error)
  const items = (data ?? []) as PosOrderItem[]
  return orders
    .map(o => ({ order: o, items: items.filter(i => i.order_id === o.id) }))
    .filter(t => t.items.length > 0)
}

/** Bump desde el KDS: marca un ítem como listo (o lo regresa a marchado). */
export async function bumpItem(itemId: string, listo: boolean): Promise<void> {
  const { error } = await sb.from('pos_order_items')
    .update({ kitchen_status: listo ? 'listo' : 'marchado', updated_at: new Date().toISOString() }).eq('id', itemId)
  fail(error)
}

/** Bump de toda una comanda (todos los ítems marchados → listos). */
export async function bumpTicket(orderId: string): Promise<void> {
  const { error } = await sb.from('pos_order_items')
    .update({ kitchen_status: 'listo', updated_at: new Date().toISOString() })
    .eq('order_id', orderId).eq('kitchen_status', 'marchado')
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
  // Refinamiento 06-12: el producto elige QUÉ variantes del grupo aplican y puede
  // pisar el delta (product_modifier_options). Sin fila = habilitada con delta default.
  const opts = await getProductOptions(productName)
  const omap = new Map(opts.map(o => [o.modifier_id, o]))
  return ((groups ?? []) as ModifierGroupRow[]).map(g => ({
    ...g,
    modifiers: mods
      .filter(m => m.group_id === g.id && m.is_active && (omap.get(m.id)?.enabled ?? true))
      .map(m => {
        const ov = omap.get(m.id)?.price_delta_override_crc
        return ov === null || ov === undefined ? m : { ...m, price_delta_crc: ov }
      }),
  })).filter(g => g.modifiers.length > 0)
}

// ── Refinamiento: ficha de producto + opciones por producto ──
export interface PosProduct {
  nombre: string
  tipo: string
  clasificacion: string
  subclasificacion: string
  costo_unitario: number | null
  is_active: boolean
  station: 'cocina' | 'barra' | 'ninguna'
  aplica_servicio: boolean
  prep_time_min: number | null
  allergens: string
}

export async function getProductsFull(): Promise<PosProduct[]> {
  const { data, error } = await sb.from('product_map')
    .select('nombre, tipo, clasificacion, subclasificacion, costo_unitario, is_active, station, aplica_servicio, prep_time_min, allergens')
    .order('tipo').order('nombre')
  fail(error)
  return (data ?? []) as PosProduct[]
}

/** Crea un producto nuevo en el catálogo (el nombre es inmutable después: es la PK del histórico). */
export async function createProduct(p: { nombre: string; tipo: string; clasificacion?: string; subclasificacion?: string }): Promise<void> {
  const { error } = await sb.from('product_map').insert({
    nombre: p.nombre.trim().toUpperCase(), tipo: p.tipo, clasificacion: p.clasificacion ?? '', subclasificacion: p.subclasificacion ?? '',
  })
  fail(error)
}

export async function saveProductFicha(nombre: string, fields: Partial<Omit<PosProduct, 'nombre'>>): Promise<void> {
  const { error } = await sb.from('product_map').update({ ...fields, updated_at: new Date().toISOString() }).eq('nombre', nombre)
  fail(error)
}

export interface ProductModifierOption {
  product_name: string
  modifier_id: string
  enabled: boolean
  price_delta_override_crc: number | null
}

export async function getProductOptions(productName: string): Promise<ProductModifierOption[]> {
  const { data, error } = await sb.from('product_modifier_options').select('*').eq('product_name', productName)
  fail(error)
  return (data ?? []) as ProductModifierOption[]
}

export async function saveProductOption(o: ProductModifierOption): Promise<void> {
  const { error } = await sb.from('product_modifier_options').upsert(o)
  fail(error)
}

/** Meta liviana de productos para el comandero (snapshots de estación/subcat/servicio). */
export async function getProductMetaMap(): Promise<Map<string, { tipo: string; subclasificacion: string; station: string; aplica_servicio: boolean }>> {
  const { data, error } = await sb.from('product_map').select('nombre, tipo, subclasificacion, station, aplica_servicio').eq('is_active', true)
  fail(error)
  return new Map(((data ?? []) as Array<{ nombre: string; tipo: string; subclasificacion: string; station: string; aplica_servicio: boolean }>).map(r => [r.nombre, r]))
}

// ── F3: Cobro (mig 027) ───────────────────────────────────────
export interface PosPayment {
  id?: string
  order_id: string
  method: 'efectivo' | 'tarjeta' | 'transferencia'
  amount_crc: number
  currency: 'CRC' | 'USD'
  exchange_rate_used: number | null
  received_crc: number
  received_usd: number
  change_crc: number
  note?: string
  created_by: string | null
}

/**
 * Cobra y CIERRA la mesa en una sola operación (SPEC §2, decisión D1):
 *  1) registra el pago en pos_payments, 2) marca la orden closed.
 * El total ya viene calculado por computeTotals (no se recalcula acá). El cierre
 * de la mesa individual no depende de canCloseShift — ese gate es del cierre de
 * TURNO; cobrar una mesa es justamente cómo se vacía el salón.
 */
export async function cobrarOrden(payment: PosPayment, closedBy: string): Promise<void> {
  const { error: e1 } = await sb.from('pos_payments').insert({
    order_id:           payment.order_id,
    method:             payment.method,
    amount_crc:         payment.amount_crc,
    currency:           payment.currency,
    exchange_rate_used: payment.exchange_rate_used,
    received_crc:       payment.received_crc,
    received_usd:       payment.received_usd,
    change_crc:         payment.change_crc,
    note:               payment.note ?? '',
    created_by:         payment.created_by,
  })
  fail(e1)
  const { error: e2 } = await sb.from('pos_orders')
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: closedBy, updated_at: new Date().toISOString() })
    .eq('id', payment.order_id).eq('status', 'open')
  fail(e2)
}

export async function getOrderPayments(orderId: string): Promise<PosPayment[]> {
  const { data, error } = await sb.from('pos_payments').select('*').eq('order_id', orderId).order('created_at')
  fail(error)
  return (data ?? []) as PosPayment[]
}
