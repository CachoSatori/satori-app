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
