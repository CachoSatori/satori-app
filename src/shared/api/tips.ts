import { supabase } from './supabase'
import type { TipSession, TipEntry, Employee, RoleTipPoints } from '../types/database'

// ── Sesiones ────────────────────────────────────────────────

export async function getTipSessions(): Promise<TipSession[]> {
  // limit alto: cubre años de turnos (138+ históricos y creciendo). Antes era 60,
  // por eso al filtrar meses viejos no aparecían datos.
  const { data, error } = await supabase
    .from('tip_sessions')
    .select('*')
    .order('session_date', { ascending: false })
    .limit(3000)
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

export async function createTipSession(params: {
  session_date: string
  shift_type: 'AM' | 'PM'
  exchange_rate: number
  opened_by: string
  notes?: string
}): Promise<TipSession> {
  const { data, error } = await supabase
    .from('tip_sessions')
    .insert({
      session_date:      params.session_date,
      shift_type:        params.shift_type,
      exchange_rate:     params.exchange_rate,
      opened_by:         params.opened_by,
      status:            'open',
      pool_efectivo_crc: 0,
      pool_efectivo_usd: 0,
      pool_barra_crc:    0,
      notes:             params.notes ?? null,
    } as never)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as TipSession
}

export async function updateSessionPools(
  sessionId: string,
  pools: { pool_efectivo_crc: number; pool_efectivo_usd: number; pool_barra_crc: number }
): Promise<void> {
  const { error } = await supabase
    .from('tip_sessions')
    .update(pools as never)
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

export async function closeTipSession(sessionId: string, closedBy: string): Promise<void> {
  const { error } = await supabase
    .from('tip_sessions')
    .update({ status: 'closed', closed_by: closedBy } as never)
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

// Guardar notas de la sesión (p.ej. motivo de diferencia de pool al cerrar)
export async function updateTipSessionNotes(sessionId: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from('tip_sessions')
    .update({ notes } as never)
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

// Reopen a closed session for editing
export async function reopenTipSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('tip_sessions')
    .update({ status: 'open', closed_by: null } as never)
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
}

// Eliminar una sesión completa (entradas + sesión)
export async function deleteTipSession(sessionId: string): Promise<void> {
  await supabase.from('tip_entries').delete().eq('session_id', sessionId)
  const { error } = await supabase.from('tip_sessions').delete().eq('id', sessionId)
  if (error) throw new Error(error.message)
}

// ── Entradas ────────────────────────────────────────────────

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
  covered_role?: string | null
}): Promise<TipEntry> {
  const { data, error } = await supabase
    .from('tip_entries')
    .upsert({ ...entry, covered_role: entry.covered_role ?? null } as never, { onConflict: 'session_id,employee_id' })
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
  if (!entries.length) return
  // FIX (prod): estas entradas YA existen — se crean con su session_id al
  // togglear/editar la línea. Acá sólo se actualizan points/payout_crc del
  // reparto del pool.
  //
  // Antes era upsert(onConflict:'id'): Postgres evalúa las restricciones
  // NOT NULL sobre la tupla de INSERT propuesta ANTES de resolver el conflicto,
  // así que omitir session_id (NOT NULL, sin default) reventaba con
  // "null value in column session_id violates not-null constraint" AUNQUE la
  // fila ya existiera. UPDATE por id evita el INSERT y, por tanto, la violación.
  const results = await Promise.all(
    entries.map(e =>
      supabase
        .from('tip_entries')
        .update({ points: e.points, payout_crc: e.payout_crc } as never)
        .eq('id', e.id),
    ),
  )
  const failed = results.find(r => r.error)
  if (failed?.error) throw new Error(failed.error.message)
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

// Todos los empleados (activos e inactivos). Para Historial / Estadísticas /
// Quincenal: ahí siempre tienen que aparecer todos los del período aunque ya
// no estén activos.
export async function getAllEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('full_name')
  if (error) throw new Error(error.message)
  return data as Employee[]
}

// ── Puntos por rol ──────────────────────────────────────────

export async function getRoleTipPoints(): Promise<RoleTipPoints[]> {
  const { data, error } = await supabase
    .from('role_tip_points')
    .select('*')
  if (error) throw new Error(error.message)
  return data as RoleTipPoints[]
}

// ── Historial de asistencia (horas por turno, todos los empleados) ──

export interface AttendanceRow {
  session_date:  string
  shift_type:    string
  employee_id:   string
  hours_worked:  number
  payout_crc:    number | null
  points:        number | null
}

export async function getAttendanceHistory(months = 3): Promise<AttendanceRow[]> {
  // Calculate date limit
  const since = new Date()
  since.setMonth(since.getMonth() - months)
  const sinceStr = since.toISOString().slice(0, 10)

  // BUG-2 FIX: filter by session_date (CR timezone) not entry created_at (UTC)
  // Join through tip_sessions to get session_date correctly
  const { data, error } = await supabase
    .from('tip_sessions')
    .select(`
      id,
      session_date,
      shift_type,
      tip_entries (
        employee_id,
        hours_worked,
        payout_crc,
        points
      )
    `)
    .eq('status', 'closed')
    .gte('session_date', sinceStr)
    .order('session_date', { ascending: false })
    .limit(2000)
  if (error) throw new Error(error.message)

  // Flatten sessions → entries
  const rows: AttendanceRow[] = []
  for (const session of (data ?? []) as unknown as Array<{
    id: string; session_date: string; shift_type: string
    tip_entries: Array<{ employee_id: string; hours_worked: number; payout_crc: number | null; points: number | null }>
  }>) {
    for (const entry of session.tip_entries ?? []) {
      rows.push({
        session_date: session.session_date,
        shift_type:   session.shift_type,
        employee_id:  entry.employee_id,
        hours_worked: entry.hours_worked,
        payout_crc:   entry.payout_crc,
        points:       entry.points,
      })
    }
  }
  return rows.sort((a, b) => b.session_date.localeCompare(a.session_date))
}
