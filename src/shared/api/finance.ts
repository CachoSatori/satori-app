import { supabase } from './supabase'

export interface FinanceAccount {
  id: string
  code: string | null
  name: string
  parent_id: string | null
  section: string | null      // 'income' | 'cogs' | 'expenses'
  sort: number
  is_leaf: boolean
}
export interface FinanceCell { account_id: string; year: number; month: number; amount: number }

export async function getFinanceAccounts(): Promise<FinanceAccount[]> {
  const { data, error } = await supabase
    .from('finance_accounts' as never)
    .select('*')
    .order('sort')
  if (error) throw new Error(error.message)
  return (data ?? []) as FinanceAccount[]
}

export async function getFinanceBudget(year: number): Promise<FinanceCell[]> {
  const { data, error } = await supabase
    .from('finance_budget' as never)
    .select('account_id, year, month, amount')
    .eq('year', year)
  if (error) throw new Error(error.message)
  return (data ?? []) as FinanceCell[]
}

export async function getFinanceActuals(year: number): Promise<FinanceCell[]> {
  // Suma de reales por cuenta/mes (puede haber varias filas por cuenta/mes)
  const { data, error } = await supabase
    .from('finance_actuals' as never)
    .select('account_id, year, month, amount')
    .eq('year', year)
  if (error) throw new Error(error.message)
  const agg: Record<string, FinanceCell> = {}
  for (const r of (data ?? []) as FinanceCell[]) {
    const k = `${r.account_id}|${r.month}`
    if (!agg[k]) agg[k] = { account_id: r.account_id, year, month: r.month, amount: 0 }
    agg[k].amount += Number(r.amount) || 0
  }
  return Object.values(agg)
}

export async function upsertActual(a: { account_id: string; year: number; month: number; amount: number; note?: string; source?: string }): Promise<void> {
  const { error } = await supabase
    .from('finance_actuals' as never)
    .insert({ ...a, source: a.source ?? 'manual' } as never)
  if (error) throw new Error(error.message)
}

// ── REAL automático desde datos vivos de la app (Fase 2C.3) ──────
// Mapea lo que YA registra Satori a las cuentas del P&L:
//   Ventas Salón/Delivery ← ventas_dias  ·  egresos de Caja → cuentas de gasto/COGS.
// Mapeo aproximado por tipo de movimiento (refinable con una tabla de mapeo después).
const CASH_TO_ACCOUNT: Record<string, string> = {
  egreso_mercaderia: 'a5200',          // Food Costs
  egreso_personal:   'a6200',          // Staff Wages
  egreso_operativo:  'a7120',          // Restaurant & Kitchen Supply (operativo, aprox.)
  egreso_socios:     'consumos_duenos',// Consumos Dueños
}

export async function getLiveActuals(year: number): Promise<FinanceCell[]> {
  const from = `${year}-01-01`, to = `${year}-12-31`
  const [ventasRes, cashRes] = await Promise.all([
    supabase.from('ventas_dias' as never)
      .select('session_date, data')
      .gte('session_date', from).lte('session_date', to),
    supabase.from('cash_movements' as never)
      .select('movement_type, amount_crc, status, created_at')
      .gte('created_at', `${from}T00:00:00Z`).lte('created_at', `${to}T23:59:59Z`),
  ])

  const cells: Record<string, FinanceCell> = {}
  const add = (account_id: string, month: number, amount: number) => {
    if (!amount) return
    const k = `${account_id}|${month}`
    if (!cells[k]) cells[k] = { account_id, year, month, amount: 0 }
    cells[k].amount += amount
  }

  // Ingresos: salón (saloneros no-cajero) + delivery (cajeros)
  for (const row of (ventasRes.data ?? []) as Array<{ session_date: string; data: { saloneros?: Record<string, { total?: number; delivery?: number; esCajero?: boolean }> } }>) {
    const month = Number(row.session_date.slice(5, 7))
    let salon = 0, delivery = 0
    for (const s of Object.values(row.data?.saloneros ?? {})) {
      if (s.esCajero) delivery += s.delivery ?? 0
      else salon += s.total ?? 0
    }
    add('ventas_salon', month, salon)
    add('ventas_delivery', month, delivery)
  }

  // Egresos de Caja → cuentas de gasto/COGS
  for (const m of (cashRes.data ?? []) as Array<{ movement_type: string; amount_crc: number; status: string; created_at: string }>) {
    if (m.status === 'rechazado') continue
    const acc = CASH_TO_ACCOUNT[m.movement_type]
    if (!acc) continue
    const month = Number(m.created_at.slice(5, 7))
    add(acc, month, Number(m.amount_crc) || 0)
  }

  return Object.values(cells)
}
