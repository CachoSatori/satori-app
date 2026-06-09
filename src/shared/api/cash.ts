import { supabase } from './supabase'
import type { CashSession, CashMovement, Supplier, MovementType } from '../types/database'
import type { Database } from '../types/supabase.gen'

type Tables = Database['public']['Tables']

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
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as CashSession
}

// Check de proveedores a mediodía: registra el "visto" (quién + cuándo) SIN cerrar la
// caja. Columnas de la mig. 018 — el cast vía unknown evita el error de tipos hasta que
// se regeneren los tipos; si la migración no corrió aún, el update falla y se avisa arriba.
export async function updateMiddayCheck(sessionId: string, profileId: string): Promise<void> {
  const { error } = await supabase
    .from('cash_sessions')
    .update({ midday_check_by: profileId, midday_check_at: new Date().toISOString() } as unknown as Tables['cash_sessions']['Update'])
    .eq('id', sessionId)
  if (error) throw new Error(error.message)
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
    })
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
  account_id?: string | null
  status?: 'aprobado' | 'pendiente' | 'rechazado'   // override; por defecto se deriva del método
}): Promise<CashMovement> {
  const { data, error } = await supabase
    .from('cash_movements')
    .insert({
      ...movement,   // la clave `status` de abajo pisa el status del spread
      subcategory:   movement.subcategory   ?? '',
      supplier_id:   movement.supplier_id   ?? null,
      supplier_name: movement.supplier_name ?? '',
      employee_name: movement.employee_name ?? '',
      shift:         movement.shift         ?? '',
      account_id:    movement.account_id    ?? null,
      status:        movement.status ?? (movement.method === 'Transferencia' ? 'pendiente' : 'aprobado'),
    })
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
    .update(updates)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function updateMovementStatus(id: string, status: 'aprobado' | 'pendiente' | 'rechazado'): Promise<void> {
  const { error } = await supabase
    .from('cash_movements')
    .update({ status })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// Inserta un movimiento a nivel día (sin turno) — para movimientos manuales
// administrativos: Banco→Caja Fuerte, retiros, gastos sin foto, etc.
export async function createDayMovement(m: {
  created_by: string
  movement_type: string
  amount_crc: number
  amount_usd?: number
  description: string
  subcategory?: string
  supplier_name?: string
  method: string
  caja_origen: string
  status?: 'aprobado' | 'pendiente'
  account_id?: string | null
  fecha?: string | null
}): Promise<string> {
  const ts = m.fecha ? `${m.fecha}T12:00:00Z` : new Date().toISOString()
  const { data, error } = await supabase.from('cash_movements').insert({
    session_id: null, created_by: m.created_by, movement_type: m.movement_type,
    amount_crc: m.amount_crc, amount_usd: m.amount_usd ?? 0, currency: 'CRC',
    description: m.description, subcategory: m.subcategory ?? '', supplier_name: m.supplier_name ?? '',
    method: m.method, caja_origen: m.caja_origen, status: m.status ?? 'aprobado',
    account_id: m.account_id ?? null, created_at: ts, updated_at: ts,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

export async function deleteCashMovement(id: string): Promise<void> {
  const { error } = await supabase
    .from('cash_movements')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// Descartar un turno (apertura por error, fecha equivocada): borra sus
// movimientos y la sesión. Empezás de cero.
export async function discardCashSession(sessionId: string): Promise<void> {
  await supabase.from('cash_movements').delete().eq('session_id', sessionId)
  const { error } = await supabase.from('cash_sessions').delete().eq('id', sessionId)
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
  await supabase.from('cash_movements').update({ amount_crc: newTotalCRC }).eq('id', mov.id)
}

// Registra (idempotente) las ventas en EFECTIVO de un Cierre del día como
// movimientos de ingreso a nivel día (session_id null). Borra los previos del
// mismo día antes de re-crear, así re-cerrar el día no duplica el ledger.
// Sólo efectivo: las ventas con tarjeta vienen del XLS de ventas, no del cierre.
export async function recordCierreSales(params: {
  session_date:  string
  created_by:    string
  exchange_rate: number
  mediodia: { crc: number; usd: number }
  noche:    { crc: number; usd: number }
}): Promise<void> {
  // Limpiar ventas-de-cierre previas de este día (idempotencia).
  await supabase
    .from('cash_movements')
    .delete()
    .eq('subcategory', 'Ventas cierre')
    .like('description', `%${params.session_date}`)

  const rows = [
    { turno: 'Mediodía', ...params.mediodia },
    { turno: 'Noche',    ...params.noche },
  ].filter(r => r.crc !== 0 || r.usd !== 0)
  if (rows.length === 0) return

  const { error } = await supabase.from('cash_movements').insert(
    rows.map(r => ({
      session_id:    null,
      created_by:    params.created_by,
      movement_type: 'ingreso',
      amount_crc:    r.crc,
      amount_usd:    r.usd,
      currency:      'CRC',
      exchange_rate: params.exchange_rate,
      description:   `Ventas efectivo ${r.turno} ${params.session_date}`,
      subcategory:   'Ventas cierre',
      supplier_id:   null,
      supplier_name: '',
      employee_name: '',
      shift:         r.turno,
      caja_origen:   'Caja Fuerte',   // las ventas en efectivo entran a la Caja Fuerte (+saldo)
      method:        'Efectivo',
      status:        'aprobado',
    })),
  )
  if (error) throw new Error(error.message)
}

// Registra (idempotente) el retiro de dueños a banco de un Cierre del día.
// NO es un gasto: es un TRASPASO de efectivo de Caja Fuerte al Banco (para luego
// pagar transferencias/servicios). Por eso movement_type='traspaso' y queda
// FUERA del P&L (getLiveActuals solo procesa egreso*). Borra el previo del
// mismo día antes de re-crear.
export async function recordCierreRetiro(params: {
  session_date:  string
  created_by:    string
  exchange_rate: number
  amount_crc:    number
}): Promise<void> {
  const desc = `Retiro dueños a banco ${params.session_date}`
  await supabase.from('cash_movements').delete().eq('description', desc)
  if (!params.amount_crc) return
  const { error } = await supabase.from('cash_movements').insert({
    session_id:    null,
    created_by:    params.created_by,
    movement_type: 'traspaso',
    amount_crc:    params.amount_crc,
    amount_usd:    0,
    currency:      'CRC',
    exchange_rate: params.exchange_rate,
    description:   desc,
    subcategory:   'Caja Fuerte → Banco',
    supplier_id:   null,
    supplier_name: '',
    employee_name: '',
    shift:         '',
    caja_origen:   'Caja Fuerte',   // sale de la Caja Fuerte (traspaso al Banco) → descuenta el saldo
    method:        'Transferencia',
    status:        'aprobado',
  })
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
    ? await supabase.from('suppliers').update(payload as unknown as Tables['suppliers']['Update']).eq('id', params.id).select().single()
    : await supabase.from('suppliers').insert(payload as unknown as Tables['suppliers']['Insert']).select().single()
  if (error) throw new Error(error.message)
  return data as Supplier
}

export async function deactivateSupplier(id: string): Promise<void> {
  const { error } = await supabase
    .from('suppliers')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Cierres del día (2 fases) ─────────────────────────────────
import type { CashCierreDia } from '../types/database'

export async function getCierresDia(date?: string): Promise<CashCierreDia[]> {
  let q = supabase.from('cash_cierres_dia').select('*').order('created_at', { ascending: false })
  if (date) q = q.eq('session_date', date)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as CashCierreDia[]
}

// Último cierre COMPLETO anterior a una fecha — para el carryover de la
// caja de proveedores (sep_diaria) a la apertura del día siguiente.
export async function getPreviousCierre(beforeDate: string): Promise<CashCierreDia | null> {
  const { data, error } = await supabase
    .from('cash_cierres_dia')
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
    .from('cash_cierres_dia')
    .insert({ ...cierre, updated_at: new Date().toISOString() })
    .select().single()
  if (error) throw new Error(error.message)
  return data as CashCierreDia
}

// Deshacer el cierre del día (error de fecha / empezar de nuevo): borra los
// cierres de esa fecha y los movimientos que generó (ventas del cierre + retiro).
export async function discardCierreDia(date: string): Promise<void> {
  await supabase.from('cash_movements').delete().eq('subcategory', 'Ventas cierre').like('description', `%${date}`)
  await supabase.from('cash_movements').delete().eq('description', `Retiro dueños a banco ${date}`)
  const { error } = await supabase.from('cash_cierres_dia').delete().eq('session_date', date)
  if (error) throw new Error(error.message)
}

// Reset COMPLETO de un día (recargar de cero SIN duplicar): borra el cierre + TODOS los
// movimientos del día (los de los turnos de esa fecha + los a nivel día) + los turnos de
// caja de esa fecha. NO toca propinas (tip_sessions / tip_entries). Acción destructiva
// explícita (la dispara el usuario con confirmación + autorización de gerencia).
export async function discardDiaCompleto(date: string): Promise<void> {
  // 1) Movimientos ligados a turnos de esa fecha
  const { data: sess } = await supabase.from('cash_sessions').select('id').eq('session_date', date)
  const ids = ((sess ?? []) as { id: string }[]).map(s => s.id)
  if (ids.length) {
    const { error } = await supabase.from('cash_movements').delete().in('session_id', ids)
    if (error) throw new Error(error.message)
  }
  // 2) Movimientos a nivel día (sin turno) de esa fecha — rango horario de Costa Rica (UTC-6)
  const next = new Date(date + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1)
  const nextStr = next.toISOString().slice(0, 10)
  const { error: e2 } = await supabase.from('cash_movements').delete()
    .is('session_id', null)
    .gte('created_at', `${date}T06:00:00Z`).lt('created_at', `${nextStr}T06:00:00Z`)
  if (e2) throw new Error(e2.message)
  // 3) Cierre del día
  await supabase.from('cash_cierres_dia').delete().eq('session_date', date)
  // 4) Turnos de caja de esa fecha
  const { error: e4 } = await supabase.from('cash_sessions').delete().eq('session_date', date)
  if (e4) throw new Error(e4.message)
}

export async function updateCierreCompleto(id: string, updates: Partial<CashCierreDia>): Promise<void> {
  const { error } = await supabase
    .from('cash_cierres_dia')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
