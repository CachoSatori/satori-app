import { supabase } from './supabase'
import type { CashSession, CashMovement, Supplier, MovementType } from '../types/database'

// ── Sesiones ────────────────────────────────────────────────

export async function getOpenCashSession(): Promise<CashSession | null> {
  const { data, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as CashSession | null
}

export async function getCashSessions(limit = 60): Promise<CashSession[]> {
  const { data, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data as CashSession[]
}

export async function createCashSession(params: {
  session_date: string
  shift_type: string
  opened_by: string
  cajero_name: string
  initial_cash_crc: number
  initial_cash_usd: number
  initial_suppliers_crc?: number
  notes?: string
}): Promise<CashSession> {
  const { data, error } = await supabase
    .from('cash_sessions')
    .insert({
      session_date:          params.session_date,
      shift_type:            params.shift_type,
      opened_by:             params.opened_by,
      cajero_name:           params.cajero_name,
      status:                'open',
      initial_cash_crc:      params.initial_cash_crc,
      initial_cash_usd:      params.initial_cash_usd,
      initial_service_crc:   params.initial_cash_crc,         // mirror to legacy field
      initial_suppliers_crc: params.initial_suppliers_crc ?? 0,
      notes:                 params.notes ?? null,
    } as never)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as CashSession
}

export async function closeCashSession(
  sessionId: string,
  finalData: {
    final_cash_crc: number
    final_cash_usd: number
    final_safe_crc?: number
    final_bank_crc?: number
    notes?: string
  },
  closedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('cash_sessions')
    .update({
      status:         'closed',
      closed_by:      closedBy,
      final_cash_crc: finalData.final_cash_crc,
      final_cash_usd: finalData.final_cash_usd,
      final_safe_crc: finalData.final_safe_crc ?? null,
      final_bank_crc: finalData.final_bank_crc ?? null,
      ...(finalData.notes ? { notes: finalData.notes } : {}),
    } as never)
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

// ── Movimientos ─────────────────────────────────────────────

export async function getCashMovements(sessionId: string): Promise<CashMovement[]> {
  const { data, error } = await supabase
    .from('cash_movements')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data as CashMovement[]
}

// PERF FIX: filter by date range instead of hard limit
export async function getAllCashMovements(days = 90): Promise<CashMovement[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('cash_movements')
    .select('*')
    .gte('created_at', sinceStr + 'T00:00:00Z')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as CashMovement[]
}

export async function createCashMovement(movement: {
  session_id: string
  created_by: string
  movement_type: MovementType
  amount_crc: number
  amount_usd: number
  currency: 'CRC' | 'USD'
  exchange_rate: number | null
  description: string
  subcategory?: string
  supplier_id?: string | null
  supplier_name?: string
  employee_name?: string
  method: string
  shift?: string
  caja_origen: string
}): Promise<CashMovement> {
  const { data, error } = await supabase
    .from('cash_movements')
    .insert({
      ...movement,
      subcategory:   movement.subcategory   ?? '',
      supplier_id:   movement.supplier_id   ?? null,
      supplier_name: movement.supplier_name ?? '',
      employee_name: movement.employee_name ?? '',
      shift:         movement.shift         ?? '',
      status:        movement.method === 'Transferencia' ? 'pendiente' : 'aprobado',
    } as never)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as CashMovement
}

export async function updateCashMovement(
  id: string,
  updates: Partial<CashMovement>,
): Promise<void> {
  const { error } = await supabase
    .from('cash_movements')
    .update(updates as never)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateMovementStatus(id: string, status: 'aprobado' | 'pendiente' | 'rechazado'): Promise<void> {
  const { error } = await supabase
    .from('cash_movements')
    .update({ status } as never)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteCashMovement(id: string): Promise<void> {
  const { error } = await supabase
    .from('cash_movements')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Proveedores ─────────────────────────────────────────────

export async function getSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return data as Supplier[]
}

export async function upsertSupplier(params: {
  id?: string
  name: string
  category?: string
  contact?: string
  moneda?: string
  ciclo_pago?: string
  metodo_pago?: string
  cuenta_iban?: string
}): Promise<Supplier> {
  const payload: Record<string, unknown> = {
    name:        params.name,
    category:    params.category    ?? null,
    contact:     params.contact     ?? null,
    moneda:      params.moneda      ?? 'CRC',
    ciclo_pago:  params.ciclo_pago  ?? 'Semanal',
    metodo_pago: params.metodo_pago ?? 'Efectivo',
    cuenta_iban: params.cuenta_iban ?? '',
    is_active:   true,
  }
  if (params.id) payload.id = params.id

  const { data, error } = params.id
    ? await supabase.from('suppliers').update(payload as never).eq('id', params.id).select().single()
    : await supabase.from('suppliers').insert(payload as never).select().single()
  if (error) throw new Error(error.message)
  return data as Supplier
}

export async function deactivateSupplier(id: string): Promise<void> {
  const { error } = await supabase
    .from('suppliers')
    .update({ is_active: false } as never)
    .eq('id', id)
  if (error) throw new Error(error.message)
}
