import { supabase } from './supabase'
import type { TipSession, TipEntry, Employee, RoleTipPoints } from '../types/database'

// ── Sesiones ────────────────────────────────────────────────

export async function getTipSessions(): Promise<TipSession[]> {
  const { data, error } = await supabase
    .from('tip_sessions')
    .select('*')
    .order('session_date', { ascending: false })
    .limit(30)
  if (error) throw new Error(error.message)
  return data as TipSession[]
}

export async function getOpenTipSession(): Promise<TipSession | null> {
  const { data, error } = await supabase
    .from('tip_sessions')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as TipSession | null
}

export async function createTipSession(
  sessionDate: string,
  exchangeRate: number,
  openedBy: string,
  notes?: string
): Promise<TipSession> {
  const payload = {
    session_date: sessionDate,
    exchange_rate: exchangeRate,
    opened_by: openedBy,
    status: 'open',
    notes: notes ?? null,
  }
  const { data, error } = await supabase
    .from('tip_sessions')
    .insert(payload as never)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as TipSession
}

export async function closeTipSession(sessionId: string, closedBy: string): Promise<void> {
  const { error } = await supabase
    .from('tip_sessions')
    .update({ status: 'closed', closed_by: closedBy } as never)
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

// ── Entradas de propinas ────────────────────────────────────

export async function getTipEntriesBySession(sessionId: string): Promise<TipEntry[]> {
  const { data, error } = await supabase
    .from('tip_entries')
    .select('*')
    .eq('session_id', sessionId)
  if (error) throw new Error(error.message)
  return data as TipEntry[]
}

export async function upsertTipEntry(entry: {
  session_id: string
  employee_id: string
  hours_worked: number
  tip_amount_crc: number
  tip_amount_usd: number
}): Promise<TipEntry> {
  const { data, error } = await supabase
    .from('tip_entries')
    .upsert(entry as never, { onConflict: 'session_id,employee_id' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as TipEntry
}

export async function deleteTipEntry(sessionId: string, employeeId: string): Promise<void> {
  const { error } = await supabase
    .from('tip_entries')
    .delete()
    .eq('session_id', sessionId)
    .eq('employee_id', employeeId)
  if (error) throw new Error(error.message)
}

export async function savePayouts(
  entries: Array<{ id: string; points: number; payout_crc: number }>
): Promise<void> {
  for (const entry of entries) {
    const { error } = await supabase
      .from('tip_entries')
      .update({ points: entry.points, payout_crc: entry.payout_crc } as never)
      .eq('id', entry.id)
    if (error) throw new Error(error.message)
  }
}

// ── Empleados ───────────────────────────────────────────────

export async function getActiveEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('is_active', true)
    .order('full_name')
  if (error) throw new Error(error.message)
  return data as Employee[]
}

export async function createEmployee(employee: { full_name: string; role: string }): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .insert(employee as never)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Employee
}

export async function deactivateEmployee(id: string): Promise<void> {
  const { error } = await supabase
    .from('employees')
    .update({ is_active: false } as never)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Puntos por rol ──────────────────────────────────────────

export async function getRoleTipPoints(): Promise<RoleTipPoints[]> {
  const { data, error } = await supabase
    .from('role_tip_points')
    .select('*')
  if (error) throw new Error(error.message)
  return data as RoleTipPoints[]
}
