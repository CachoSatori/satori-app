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

// ── REAL automático desde datos vivos de la app (Fase 2C.3 v2) ───
// Mapea lo que YA registra Satori a las cuentas del P&L:
//   Ventas Salón/Delivery ← ventas_dias  ·  egresos de Caja → cuentas del P&L por SUBCATEGORÍA.
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Subcategoría de Caja → cuenta del P&L. Devuelve null para EXCLUIR (ej. propinas pass-through).
function mapCashToAccount(type: string, subcat: string): string | null {
  const s = norm(subcat)
  // Propinas por tarjeta/SINPE: el cliente las pagó y se entregan al staff → NO es gasto del P&L
  if (/\btips?\b|propina/.test(s)) return null
  // Por palabra clave de subcategoría (lo que calza claro)
  if (/music|musico/.test(s))                 return 'a7500'                    // Música y entretenimiento
  if (/\bgas\b/.test(s))                       return 'a7780'                    // Gas
  if (/agua|water/.test(s))                    return 'a7760'                    // Agua
  if (/electric|\bluz\b|power/.test(s))        return 'a7770'                    // Electricidad
  if (/internet|telefon/.test(s))              return 'a7750'                    // Teléfono/Internet
  if (/segurid|extintor|\bpest\b|nova/.test(s))return 'a7200'                    // Seguridad/Pest
  if (/mantenim|repair/.test(s))               return 'repairs_and_maintenance'  // Mantenimiento
  if (/libreria|papeler|oficina|encomien|envio|stationery/.test(s)) return 'a7890' // Oficina/Librería
  if (/limpiez|cleaning/.test(s))              return 'a7130'                    // Limpieza
  if (/decora/.test(s))                        return 'a7140'                    // Decoración
  if (/empaque|desechab/.test(s))              return 'a7121'                    // Empaques/Desechables
  if (/vajilla|glassware|\bchina\b/.test(s))   return 'a7110'                    // Vajilla
  if (/aguinaldo/.test(s))                     return 'aguinaldos'
  if (/\bccss\b/.test(s))                       return 'a6600'
  if (/\bins\b|riesgo/.test(s))                 return 'a6610'
  if (/alquiler|rent/.test(s))                 return 'a8100'                    // Alquiler
  if (/impuesto/.test(s))                      return 'impuestos_municipales'
  if (/legal|abogad/.test(s))                  return 'legal_and_professional_fees'
  if (/maquinaria|herramient|\bequipo\b/.test(s)) return 'maquinaria_y_equipo'
  if (/banco|bank|comision/.test(s))           return 'bank_charges'
  if (/publicid|advertis|promo|marketing/.test(s)) return 'a7300'
  if (/licor/.test(s))                         return 'a5330'                    // Licor
  if (/cerveza|beer/.test(s))                  return 'a5340'                    // Cerveza
  if (/vino|wine/.test(s))                     return 'a5350'                    // Vino
  if (/gaseosa|soda|jugo|cafe|bebida/.test(s)) return 'a5321'                    // Soft drinks
  if (/adelanto|salario|planilla|sueldo|\bstaff\b/.test(s)) return 'a6200'       // Salarios
  // Fallback por tipo de movimiento
  switch (type) {
    case 'egreso_mercaderia': return 'a5200'           // Food Costs
    case 'egreso_operativo':  return 'a7120'           // Insumos operativos (catch-all)
    case 'egreso_personal':   return 'a6200'           // Staff Wages
    case 'egreso_socios':     return 'consumos_duenos' // Consumos Dueños
    default:                  return null
  }
}

export async function getLiveActuals(year: number): Promise<FinanceCell[]> {
  const from = `${year}-01-01`, to = `${year}-12-31`
  const [ventasRes, cashRes] = await Promise.all([
    supabase.from('ventas_dias' as never)
      .select('session_date, data')
      .gte('session_date', from).lte('session_date', to),
    supabase.from('cash_movements' as never)
      .select('movement_type, subcategory, amount_crc, status, created_at')
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

  // Egresos de Caja → cuentas del P&L por subcategoría (mapeo fino)
  for (const m of (cashRes.data ?? []) as Array<{ movement_type: string; subcategory: string; amount_crc: number; status: string; created_at: string }>) {
    if (m.status === 'rechazado') continue
    if (!String(m.movement_type).startsWith('egreso')) continue
    const acc = mapCashToAccount(m.movement_type, m.subcategory)
    if (!acc) continue   // null = excluido (propinas pass-through)
    const month = Number(m.created_at.slice(5, 7))
    add(acc, month, Number(m.amount_crc) || 0)
  }

  return Object.values(cells)
}
