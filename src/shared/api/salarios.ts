import { supabase } from './supabase'
import type {
  Employee,
  EmployeePayment,
  EmployeeWageRate,
  SalaryPeriod,
  WorkDay,
} from '../types/database'

// ── Salarios · U0b: el ciclo mínimo de pago ─────────────────────────────────────
// Cargar horas del período → ver el neto → bajar el archivo del banco → marcar pagado.
// Reusa TAL CUAL las tablas de la mig 056 (U0a): acá no nace ninguna tabla nueva.
//
// El pago NO ES CAJA: `employee_payments` es solo el registro de que se transfirió;
// no toca `cash_movements` ni genera movimiento.
//
// Las tablas de la mig 056 no están en `supabase.gen.ts` (no regeneramos el archivo,
// igual que con supplier_credits en cash.ts) → cast acotado del builder de PostgREST.
// El `.bind(supabase)` es obligatorio: asignar `supabase.from` a una const desestaca el
// método (pierde `this`) → "Cannot read properties of undefined (reading 'rest')". El
// `?.` es guarda de carga, porque varios tests mockean `./supabase` parcialmente.

type PgError = { message: string; code?: string } | null

interface Q extends PromiseLike<{ data: unknown; error: PgError }> {
  select(cols?: string): Q
  insert(rows: unknown): Q
  upsert(rows: unknown, opts?: { onConflict?: string }): Q
  update(patch: unknown): Q
  eq(col: string, value: unknown): Q
  gte(col: string, value: unknown): Q
  lte(col: string, value: unknown): Q
  order(col: string, opts?: { ascending?: boolean }): Q
  single(): Q
}

const fromAny = supabase.from?.bind(supabase) as unknown as (table: string) => Q

function fail(error: PgError, quePasaba: string): never {
  const msg = error?.message ?? 'error desconocido'
  // 42501 = la RLS dijo que no. El caso real es el contador intentando pagar.
  if (error?.code === '42501' || /row-level security/i.test(msg)) {
    throw new Error(`No tenés permiso para ${quePasaba}. El pago lo marcan solo el dueño o el gerente.`)
  }
  throw new Error(msg)
}

// ── Períodos ────────────────────────────────────────────────────────────────────

export async function getSalaryPeriods(): Promise<SalaryPeriod[]> {
  const { data, error } = await fromAny('salary_periods')
    .select('*')
    .order('fecha_ini', { ascending: false })
  if (error) fail(error, 'ver los períodos de pago')
  return (data ?? []) as SalaryPeriod[]
}

export async function createSalaryPeriod(p: {
  tipo:       'quincena' | 'adhoc'
  fecha_ini:  string
  fecha_fin:  string
  created_by: string
}): Promise<SalaryPeriod> {
  const { data, error } = await fromAny('salary_periods').insert(p).select('*').single()
  if (error) fail(error, 'crear un período de pago')
  return data as SalaryPeriod
}

// ── Horas ───────────────────────────────────────────────────────────────────────

// U0b carga el TOTAL del período a mano y lo guarda en UNA fila de `work_days` fechada
// el último día del período (`work_date = fecha_fin`, `source='manual'`). No inventa un
// reparto día por día que nadie contó. Cuando entre BioTime (F1d) las filas diarias
// reales conviven con esta: el total del período es la SUMA de todas, y lo editable a
// mano sigue siendo solo esta (ver `splitHorasPeriodo`).
export const LOCAL_DEFAULT = 'santa-teresa'

export async function getWorkDays(fechaIni: string, fechaFin: string): Promise<WorkDay[]> {
  const { data, error } = await fromAny('work_days')
    .select('*')
    .gte('work_date', fechaIni)
    .lte('work_date', fechaFin)
  if (error) fail(error, 'ver las horas del período')
  return (data ?? []) as WorkDay[]
}

export async function upsertWorkDay(w: {
  employee_id: string
  work_date:   string
  local:       string
  hours:       number
}): Promise<void> {
  const { error } = await fromAny('work_days').upsert(
    { ...w, source: 'manual' },
    { onConflict: 'employee_id,work_date,local' },
  )
  if (error) fail(error, 'guardar las horas')
}

// ── Tarifas ─────────────────────────────────────────────────────────────────────

// Todas las tarifas que YA regían a `fecha`. La vigente se resuelve en memoria
// (`tarifaVigente`): PostgREST no tiene `distinct on`.
export async function getWageRatesUpTo(fecha: string): Promise<EmployeeWageRate[]> {
  const { data, error } = await fromAny('employee_wage_rates')
    .select('*')
    .lte('efectivo_desde', fecha)
    .order('efectivo_desde', { ascending: false })
  if (error) fail(error, 'ver las tarifas')
  return (data ?? []) as EmployeeWageRate[]
}

// ── Nombre del beneficiario en el homebanking (mig 058) ─────────────────────────

export async function updateEmployeeHomebankingName(
  id: string,
  nombre: string | null,
): Promise<void> {
  const limpio = nombre?.trim()
  const { error } = await supabase
    .from('employees')
    .update({ nombre_homebanking: limpio ? limpio : null })   // '' no: null = "sin cargar"
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Pago ────────────────────────────────────────────────────────────────────────

export async function getPeriodPayments(periodId: string): Promise<EmployeePayment[]> {
  const { data, error } = await fromAny('employee_payments').select('*').eq('period_id', periodId)
  if (error) fail(error, 'ver los pagos del período')
  return (data ?? []) as EmployeePayment[]
}

// Registra UN pago por empleado con neto > 0 y pasa el período a `pagado`.
// Orden a propósito: primero los pagos, después el estado. Si la RLS frena al contador,
// frena en el insert y el período queda como estaba — nunca "pagado" sin pagos.
export async function markPeriodPaid(
  periodId: string,
  lineas: { employee_id: string; monto_neto: number }[],
  paidBy: string,
): Promise<number> {
  const pagables = lineas.filter(l => Math.round(l.monto_neto) > 0)
  if (pagables.length === 0) throw new Error('No hay ningún neto mayor a ₡0 para pagar.')

  // Guarda contra el doble pago: releemos el estado real, no el que tenga la pantalla.
  const { data: periodo, error: errPeriodo } = await fromAny('salary_periods')
    .select('estado')
    .eq('id', periodId)
    .single()
  if (errPeriodo) fail(errPeriodo, 'leer el período')
  if ((periodo as { estado?: string } | null)?.estado === 'pagado') {
    throw new Error('Este período ya está marcado como pagado.')
  }

  const paidAt = new Date().toISOString()
  const { error: errPagos } = await fromAny('employee_payments').insert(
    pagables.map(l => ({
      period_id:   periodId,
      employee_id: l.employee_id,
      monto_neto:  Math.round(l.monto_neto),
      metodo:      'transferencia',
      estado:      'registrado',
      paid_by:     paidBy,
      paid_at:     paidAt,
    })),
  )
  if (errPagos) fail(errPagos, 'registrar los pagos')

  const { error: errEstado } = await fromAny('salary_periods')
    .update({ estado: 'pagado', paid_by: paidBy, paid_at: paidAt })
    .eq('id', periodId)
  if (errEstado) fail(errEstado, 'marcar el período como pagado')

  return pagables.length
}

// ── Cálculo (puro) ──────────────────────────────────────────────────────────────

// Tarifa vigente = la de mayor `efectivo_desde` <= fecha. El unique (employee_id,
// efectivo_desde) de la mig 056 garantiza que no hay empate posible.
export function tarifaVigente(
  rates: EmployeeWageRate[],
  employeeId: string,
  fecha: string,
): EmployeeWageRate | null {
  return rates
    .filter(r => r.employee_id === employeeId && r.efectivo_desde <= fecha)
    .reduce<EmployeeWageRate | null>(
      (mejor, r) => (!mejor || r.efectivo_desde > mejor.efectivo_desde ? r : mejor),
      null,
    )
}

// Las horas del período partidas en dos: las que esta pantalla edita (la fila manual del
// último día) y todo el resto (mañana, BioTime). El total es la suma.
export function splitHorasPeriodo(
  workDays: WorkDay[],
  employeeId: string,
  fechaFin: string,
  local: string,
): { manual: number; otras: number; total: number } {
  let manual = 0, otras = 0
  for (const w of workDays) {
    if (w.employee_id !== employeeId) continue
    const h = Number(w.hours) || 0
    if (w.work_date === fechaFin && w.local === local && w.source === 'manual') manual += h
    else otras += h
  }
  return { manual, otras, total: manual + otras }
}

export interface LineaConsolidado {
  employee:    Employee
  rate:        EmployeeWageRate | null
  horasManual: number
  horasOtras:  number
  horas:       number
  pagoHoras:   number
  fijo:        number
  neto:        number       // calculado; la pantalla puede pisarlo a mano
  nombreBanco: string
}

// El neto de U0b: horas × tarifa vigente + salario fijo de esa misma tarifa. NADA de
// 10% de servicio ni propinas — eso es F2 (consolidado), fuera de alcance acá.
export function netoDe(horas: number, rate: EmployeeWageRate | null): number {
  if (!rate) return 0
  return horas * (Number(rate.hourly_rate_crc) || 0) + (Number(rate.fixed_salary_crc) || 0)
}

// El banco identifica al beneficiario por el NOMBRE: el alias del homebanking manda y
// `full_name` es solo el respaldo mientras no esté cargado.
export function nombreBanco(emp: Employee): string {
  return (emp.nombre_homebanking ?? '').trim() || emp.full_name
}

export function consolidarPeriodo(
  employees: Employee[],
  rates: EmployeeWageRate[],
  workDays: WorkDay[],
  period: Pick<SalaryPeriod, 'fecha_fin'>,
  local: string,
): LineaConsolidado[] {
  return employees.map(emp => {
    const rate  = tarifaVigente(rates, emp.id, period.fecha_fin)
    const split = splitHorasPeriodo(workDays, emp.id, period.fecha_fin, local)
    const pagoHoras = split.total * (Number(rate?.hourly_rate_crc) || 0)
    const fijo      = Number(rate?.fixed_salary_crc) || 0
    return {
      employee:    emp,
      rate,
      horasManual: split.manual,
      horasOtras:  split.otras,
      horas:       split.total,
      pagoHoras,
      fijo,
      neto:        pagoHoras + fijo,
      nombreBanco: nombreBanco(emp),
    }
  })
}
