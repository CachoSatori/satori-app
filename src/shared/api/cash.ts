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

export async function getCashSessions(limit = 3000): Promise<CashSession[]> {
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
export async function getAllCashMovements(days = 1000): Promise<CashMovement[]> {
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

// Reconciliar el egreso de caja de propinas cuando se EDITA un turno cerrado.
// Al cerrar propinas se crea un movimiento (subcategory 'Propinas por turno',
// description 'Propinas turno {fecha} {turno}') por el payout total. Si luego se
// edita ese turno y cambia el total, actualizamos el monto del egreso para que la
// caja siga cuadrando. Si no existe (el turno se cerró sin caja abierta), no hace
// nada. Solo toca el más reciente que coincida.
export async function reconcilePropinaEgreso(description: string, newTotalCRC: number): Promise<void> {
  const { data, error } = await supabase
    .from('cash_movements')
    .select('id, amount_crc')
    .eq('subcategory', 'Propinas por turno')
    .eq('description', description)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return
  const mov = (data as { id: string; amount_crc: number }[] | null)?.[0]
  if (!mov || mov.amount_crc === newTotalCRC) return
  await supabase.from('cash_movements').update({ amount_crc: newTotalCRC } as never).eq('id', mov.id)
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

// ── Cierres del día (2 fases) ─────────────────────────────────
import type { CashCierreDia } from '../types/database'

export async function getCierresDia(date?: string): Promise<CashCierreDia[]> {
  let q = supabase.from('cash_cierres_dia' as never).select('*').order('created_at', { ascending: false })
  if (date) q = q.eq('session_date', date)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as CashCierreDia[]
}

// Último cierre COMPLETO anterior a una fecha — para el carryover de la
// caja de proveedores (sep_diaria) a la apertura del día siguiente.
export async function getPreviousCierre(beforeDate: string): Promise<CashCierreDia | null> {
  const { data, error } = await supabase
    .from('cash_cierres_dia' as never)
    .select('*')
    .eq('tipo', 'completo')
    .lt('session_date', beforeDate)
    .order('session_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return (data as CashCierreDia | null) ?? null
}

export async function saveCierreParcial(cierre: Omit<CashCierreDia,'id'|'created_at'|'updated_at'>): Promise<CashCierreDia> {
  const { data, error } = await supabase
    .from('cash_cierres_dia' as never)
    .insert({ ...cierre, updated_at: new Date().toISOString() } as never)
    .select().single()
  if (error) throw new Error(error.message)
  return data as CashCierreDia
}

export async function updateCierreCompleto(id: string, updates: Partial<CashCierreDia>): Promise<void> {
  const { error } = await supabase
    .from('cash_cierres_dia' as never)
    .update({ ...updates, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
  if (error) throw new Error(error.message)
}
