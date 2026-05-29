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

export async function getCashSessions(): Promise<CashSession[]> {
  const { data, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .order('session_date', { ascending: false })
    .limit(60)
  if (error) throw new Error(error.message)
  return data as CashSession[]
}

export async function createCashSession(params: {
  session_date: string
  opened_by: string
  initial_service_crc: number
  initial_suppliers_crc: number
  notes?: string
}): Promise<CashSession> {
  const { data, error } = await supabase
    .from('cash_sessions')
    .insert({
      session_date:          params.session_date,
      opened_by:             params.opened_by,
      status:                'open',
      initial_service_crc:   params.initial_service_crc,
      initial_suppliers_crc: params.initial_suppliers_crc,
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
    final_service_crc: number
    final_suppliers_crc: number
    final_safe_crc: number
    final_bank_crc: number
    notes?: string
  },
  closedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('cash_sessions')
    .update({
      status:              'closed',
      closed_by:           closedBy,
      final_service_crc:   finalData.final_service_crc,
      final_suppliers_crc: finalData.final_suppliers_crc,
      final_safe_crc:      finalData.final_safe_crc,
      final_bank_crc:      finalData.final_bank_crc,
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

export async function createCashMovement(movement: {
  session_id: string
  created_by: string
  movement_type: MovementType
  amount_crc: number
  currency: 'CRC' | 'USD'
  exchange_rate: number | null
  description: string
  supplier_id?: string | null
}): Promise<CashMovement> {
  const { data, error } = await supabase
    .from('cash_movements')
    .insert({
      ...movement,
      supplier_id: movement.supplier_id ?? null,
      status:      'aprobado',
    } as never)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as CashMovement
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

export async function createSupplier(params: {
  name: string
  category?: string
  contact?: string
}): Promise<Supplier> {
  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      name:     params.name,
      category: params.category ?? null,
      contact:  params.contact ?? null,
      is_active: true,
    } as never)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Supplier
}
