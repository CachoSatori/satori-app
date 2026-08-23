import { supabase } from './supabase'
import type {
  Employee,
  EmployeePayment,
  EmployeeWageRate,
  PunchException,
  SalaryPeriod,
  TimePunch,
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
  lt(col: string, value: unknown): Q
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


// ── BioTime F1d: derivación de horas (mig 059) ──────────────────────────────────
// El wrapper de la RPC + la bandeja de excepciones. La derivación es SERVIDOR: acá no
// se empareja nada, se pide y se lee el resultado. La RPC es SECURITY DEFINER porque
// `punch_exceptions` no tiene policy de insert (057) y `work_days` se reescribe entero.

type RpcInvoke = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PgError }>
// Mismo trap que en cash.ts: `.bind(supabase)` es obligatorio (sin él se pierde `this` y
// supabase-js revienta con "reading 'rest'"), y el `?.` es guarda de carga porque varios
// tests mockean `./supabase` parcialmente.
const rpcAny = supabase.rpc?.bind(supabase) as unknown as RpcInvoke

export interface DerivacionResumen {
  local:                string
  desde:                string
  hasta:                string
  marcas:               number
  dias:                 number
  dias_omitidos_manual: number
  horas:                number
  excepciones: { impar: number; turno_largo: number; solapado: number; sin_mapear: number }
}

/** Recalcula las horas de `[desde, hasta]` en un local. Idempotente: pisa solo lo `biotime`. */
export async function derivarWorkDays(
  desde: string,
  hasta: string,
  local: string = LOCAL_DEFAULT,
): Promise<DerivacionResumen> {
  const { data, error } = await rpcAny('derivar_work_days', {
    p_desde: desde, p_hasta: hasta, p_local: local,
  })
  if (error) fail(error, 'recalcular las horas del período')
  return data as DerivacionResumen
}

// Las lecturas de la bandeja son NULL-SAFE (devuelven [] ante error o permiso): una
// excepción de lectura acá no puede tumbar la pantalla de pago, que es la que mueve plata.
export async function getPunchExceptions(
  desde: string,
  hasta: string,
  local: string = LOCAL_DEFAULT,
): Promise<PunchException[]> {
  try {
    const { data, error } = await fromAny('punch_exceptions')
      .select('*')
      .eq('local', local)
      .gte('work_date', desde)
      .lte('work_date', hasta)
      .order('work_date', { ascending: true })
    return error ? [] : ((data ?? []) as PunchException[])
  } catch { return [] }
}

// Costa Rica es UTC−6 FIJO (no hay horario de verano), así que la jornada se puede
// acotar con offsets literales sin ninguna librería de zonas: la jornada D va de
// D+corte a (D+1)+corte, hora local. Mismo criterio que la mig 059.
export function jornadaBounds(
  workDate: string,
  corte: string = '05:00',
): { desde: string; hasta: string } {
  const hhmm = /^\d{2}:\d{2}/.test(corte) ? corte.slice(0, 5) : '05:00'
  const sig  = new Date(`${workDate}T12:00:00Z`)
  sig.setUTCDate(sig.getUTCDate() + 1)
  const siguiente = sig.toISOString().slice(0, 10)
  return {
    desde: `${workDate}T${hhmm}:00-06:00`,
    hasta: `${siguiente}T${hhmm}:00-06:00`,
  }
}

/** Las marcas CRUDAS de una jornada, para que la bandeja muestre el problema tal cual pasó. */
export async function getPunchesDeJornada(
  local: string,
  workDate: string,
  corte: string = '05:00',
): Promise<TimePunch[]> {
  const { desde, hasta } = jornadaBounds(workDate, corte)
  try {
    const { data, error } = await fromAny('time_punches')
      .select('*')
      .eq('local', local)
      .gte('punch_at', desde)
      .lt('punch_at', hasta)
      .order('punch_at', { ascending: true })
    return error ? [] : ((data ?? []) as TimePunch[])
  } catch { return [] }
}

/** Marca una excepción como resuelta. No la borra: queda el rastro (057). */
export async function resolvePunchException(id: string, userId: string): Promise<void> {
  const { error } = await fromAny('punch_exceptions')
    .update({ estado: 'resuelta', resuelto_by: userId, resuelto_at: new Date().toISOString() })
    .eq('id', id)
  if (error) fail(error, 'resolver la excepción')
}

/**
 * Override a mano de las horas de UNA jornada. Escribe `source='manual'`, que es
 * justamente lo que la mig 059 nunca pisa: a partir de acá el recálculo respeta el
 * número que puso la persona. El rastro (quién, cuándo, qué decía BioTime) va en `flags`.
 */
export async function overrideHorasDia(o: {
  employee_id:   string
  work_date:     string
  local:         string
  hours:         number
  userId:        string
  horas_biotime: number | null
  motivo?:       string
}): Promise<void> {
  const { error } = await fromAny('work_days').upsert(
    {
      employee_id: o.employee_id,
      work_date:   o.work_date,
      local:       o.local,
      hours:       Math.max(0, o.hours),
      source:      'manual',
      flags: {
        override: {
          by:            o.userId,
          at:            new Date().toISOString(),
          horas_biotime: o.horas_biotime,
          motivo:        o.motivo?.trim() || null,
        },
      },
    },
    { onConflict: 'employee_id,work_date,local' },
  )
  if (error) fail(error, 'corregir las horas del día')
}

// ── Agrupado de la bandeja (puro) ───────────────────────────────────────────────

export interface GrupoExcepciones {
  key:      string                 // employee_id, o `code:NN` cuando no hay empleado
  nombre:   string
  abiertas: number
  tipos:    Record<string, number>
  items:    PunchException[]
}

const TIPO_LABEL: Record<string, string> = {
  impar:       'sin par',
  turno_largo: 'turno largo',
  solapado:    'solapado',
  sin_mapear:  'sin mapear',
}

export function etiquetaTipo(tipo: string): string {
  return TIPO_LABEL[tipo] ?? tipo
}

/**
 * La bandeja se lee POR PERSONA, no por fila suelta: quien la mira quiere saber a quién
 * le falta cerrar el día. Las `sin_mapear` no tienen empleado, así que se agrupan por su
 * `emp_code` — son el caso más frecuente el primer día y no pueden quedar invisibles.
 */
export function agruparExcepciones(
  excepciones: PunchException[],
  employees: Employee[],
): GrupoExcepciones[] {
  const nombreDe = new Map(employees.map(e => [e.id, e.full_name]))
  const grupos = new Map<string, GrupoExcepciones>()

  for (const x of excepciones) {
    if (x.estado !== 'abierta') continue
    const key = x.employee_id ?? `code:${x.emp_code ?? '?'}`
    const nombre = x.employee_id
      ? (nombreDe.get(x.employee_id) ?? 'Empleado desconocido')
      : `Código ${x.emp_code ?? '?'} (sin empleado)`
    const g = grupos.get(key) ?? { key, nombre, abiertas: 0, tipos: {}, items: [] }
    g.abiertas += 1
    g.tipos[x.tipo] = (g.tipos[x.tipo] ?? 0) + 1
    g.items.push(x)
    grupos.set(key, g)
  }

  for (const g of grupos.values()) {
    g.items.sort((a, b) => (a.work_date ?? '').localeCompare(b.work_date ?? ''))
  }
  // Primero el que más pendientes tiene: es por donde conviene empezar a limpiar.
  return [...grupos.values()].sort((a, b) => b.abiertas - a.abiertas || a.nombre.localeCompare(b.nombre))
}

/**
 * Empleados del rango que tienen A LA VEZ una fila MANUAL y filas de BioTime. Es el único
 * lugar donde el total del período se puede contar DOS VECES: U0b carga el total de la
 * quincena en UNA fila manual fechada el último día, y `splitHorasPeriodo` suma manual +
 * biotime. Convivir en el mismo día es imposible (la PK es employee_id+fecha+local y la
 * derivación no pisa lo manual), así que el choque real es este: total manual arriba,
 * días derivados abajo. No se corrige solo — se avisa para que alguien decida.
 */
export function empleadosConHorasDobles(workDays: WorkDay[]): string[] {
  const manual  = new Set<string>()
  const biotime = new Set<string>()
  for (const w of workDays) {
    if ((Number(w.hours) || 0) <= 0) continue
    if (w.source === 'manual') manual.add(w.employee_id)
    else if (w.source === 'biotime') biotime.add(w.employee_id)
  }
  return [...manual].filter(id => biotime.has(id))
}
