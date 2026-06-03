import { supabase } from './supabase'
import type { Customer, CustomerInteraction } from '../types/crm'

// ── Customers ────────────────────────────────────────────────────

export async function getCustomers(limit = 500): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers' as never)
    .select('*')
    .eq('active', true)
    .order('last_seen', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as Customer[]
}

export async function findCustomerByPhone(phone: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers' as never)
    .select('*')
    .eq('phone', phone.trim())
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as Customer | null
}

export async function upsertCustomer(c: Partial<Customer> & { phone: string }): Promise<Customer> {
  const payload: Record<string, unknown> = { ...c, phone: c.phone.trim() }
  delete payload.created_at
  delete payload.updated_at
  const { data, error } = await supabase
    .from('customers' as never)
    .upsert(payload as never, { onConflict: 'phone' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Customer
}

export async function deactivateCustomer(id: string): Promise<void> {
  const { error } = await supabase
    .from('customers' as never)
    .update({ active: false } as never)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Interactions ─────────────────────────────────────────────────

export async function getInteractions(customerId: string): Promise<CustomerInteraction[]> {
  const { data, error } = await supabase
    .from('customer_interactions' as never)
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as CustomerInteraction[]
}

// Registra una interacción y actualiza agregados del cliente (puntos/visitas/gasto)
export async function addInteraction(
  i: Omit<CustomerInteraction, 'id' | 'created_at'>,
  customer: Customer,
): Promise<void> {
  const { error } = await supabase
    .from('customer_interactions' as never)
    .insert(i as never)
  if (error) throw new Error(error.message)

  // Actualizar agregados del cliente
  const isVisit = i.type === 'visita' || i.type === 'delivery' || i.type === 'reserva'
  const updates: Record<string, unknown> = {
    points:          Math.max(0, (customer.points ?? 0) + (i.points_earned ?? 0) - (i.points_spent ?? 0)),
    total_spent_crc: (customer.total_spent_crc ?? 0) + (i.amount_crc ?? 0),
    last_seen:       new Date().toISOString(),
  }
  if (isVisit) updates.total_visits = (customer.total_visits ?? 0) + 1

  const { error: uErr } = await supabase
    .from('customers' as never)
    .update(updates as never)
    .eq('id', customer.id)
  if (uErr) throw new Error(uErr.message)
}
