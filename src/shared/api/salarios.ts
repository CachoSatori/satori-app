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
/**
 * El detalle congelado de lo que se pagó. `salary_lines` (mig 056) es el snapshot del
 * cierre: guarda la TARIFA que se usó, no un puntero a ella. Si mañana le suben el
 * precio de la hora a alguien, la quincena ya pagada sigue diciendo con qué número se
 * calculó — sin esto, el contador no puede auditar un pago viejo.
 */
export interface LineaPagada {
  employee_id: string
  monto_neto:  number
  horas:       number
  hourly_rate: number
  fijo:        number
}

export async function markPeriodPaid(
  periodId: string,
  lineas: LineaPagada[],
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

  // Snapshot del cierre. Va DESPUÉS de los pagos y ANTES del estado, y su error NO
  // frena el pago: es auditoría, no plata. Si fallara, el pago ya está registrado y
  // frenar acá dejaría el período sin marcar (que es el defecto que ya arrastramos).
  const { error: errLineas } = await fromAny('salary_lines').insert(
    pagables.map(l => ({
      period_id:    periodId,
      employee_id:  l.employee_id,
      horas:        l.horas,
      pago_horas:   Math.round(l.horas * l.hourly_rate),
      salario_fijo: Math.round(l.fijo),
      total:        Math.round(l.monto_neto),
      snapshot: {
        hourly_rate_crc:  l.hourly_rate,
        fixed_salary_crc: l.fijo,
        horas:            l.horas,
        // De dónde salió la tarifa, para que dentro de un año se entienda el número.
        origen_tarifa:    'employees',
        calculado_at:     paidAt,
      },
    })),
  )
  if (errLineas) console.warn('No se pudo guardar el detalle del pago (salary_lines):', errLineas.message)

  const { error: errEstado } = await fromAny('salary_periods')
    .update({ estado: 'pagado', paid_by: paidBy, paid_at: paidAt })
    .eq('id', periodId)
  if (errEstado) fail(errEstado, 'marcar el período como pagado')

  return pagables.length
}

// ── Cálculo (puro) ──────────────────────────────────────────────────────────────

// ⚠️ DEUDA A RETIRAR (firmado por Ismael el 2026-08-24): `employee_wage_rates`,
// `tarifaVigente` y `getWageRatesUpTo` YA NO SE USAN. La única fuente de verdad de la
// tarifa es `employees.hourly_rate_crc` / `fixed_salary_crc` — que es lo que la pestaña
// Empleados/Tarifas escribe y lo que la dueña ve.
//
// Por qué se sacaron: el modelo de vigencia por fecha daba ₡0 en silencio. Las tarifas
// se cargaron el 2026-08-21 (todas con `efectivo_desde` = ese día) y el período que se
// estaba pagando era el 01→15/08: `getWageRatesUpTo('2026-08-15')` filtra
// `efectivo_desde <= fecha` → 0 filas → `tarifaVigente` = null → neto ₡0 para TODOS.
// No es que la tabla estuviera vacía (tenía 18 filas): es que ninguna regía en el
// período. Y nadie la escribe desde la app, así que el historial nunca se iba a poblar
// solo. Quedan acá sin llamadores hasta que se retire la tabla (eso toca esquema).
//
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
): { manual: number; otras: number; pisadas: number; total: number } {
  let manual = 0, otras = 0, pisadas = 0
  for (const w of workDays) {
    if (w.employee_id !== employeeId) continue
    const h = Number(w.hours) || 0
    if (w.work_date === fechaFin && w.local === local && w.source === 'manual') manual += h
    else {
      otras += h
      // La fila editable comparte PK con la jornada de `fechaFin`: si BioTime derivó ese
      // día, el upsert de la pantalla la REEMPLAZA. Esas horas están dentro de `otras`
      // pero NO van a sobrevivir, así que quien calcula cuánto guardar tiene que
      // descontarlas o termina restando dos veces (y pagando de menos).
      if (w.work_date === fechaFin && w.local === local) pisadas += h
    }
  }
  return { manual, otras, pisadas, total: manual + otras }
}

export interface LineaConsolidado {
  employee:    Employee
  hourlyRate:  number    // employees.hourly_rate_crc — la única fuente de verdad
  sinTarifa:   boolean   // activo con horas y sin tarifa: no puede quedar en ₡0 callado
  horasManual: number
  horasOtras:  number
  horasPisadas: number   // horas de BioTime del último día, que el upsert manual reemplaza
  horas:       number
  pagoHoras:   number
  fijo:        number
  neto:        number       // calculado; la pantalla puede pisarlo a mano
  nombreBanco: string
}

// El neto de U0b: horas × tarifa del EMPLEADO + su salario fijo. NADA de 10% de servicio
// ni propinas — eso es F2 (consolidado), fuera de alcance acá.
export function netoDe(horas: number, emp: Pick<Employee, 'hourly_rate_crc' | 'fixed_salary_crc'>): number {
  return horas * (Number(emp.hourly_rate_crc) || 0) + (Number(emp.fixed_salary_crc) || 0)
}

/**
 * Un activo con horas cargadas y SIN tarifa (ni por hora ni fija) no puede quedar en ₡0
 * silencioso: eso es alguien que no cobra y nadie se entera. La pantalla lo destaca.
 */
export function sinTarifa(emp: Pick<Employee, 'hourly_rate_crc' | 'fixed_salary_crc'>): boolean {
  return (Number(emp.hourly_rate_crc) || 0) <= 0 && (Number(emp.fixed_salary_crc) || 0) <= 0
}

// El banco identifica al beneficiario por el NOMBRE: el alias del homebanking manda y
// `full_name` es solo el respaldo mientras no esté cargado.
export function nombreBanco(emp: Employee): string {
  return (emp.nombre_homebanking ?? '').trim() || emp.full_name
}

export function consolidarPeriodo(
  employees: Employee[],
  workDays: WorkDay[],
  period: Pick<SalaryPeriod, 'fecha_fin'>,
  local: string,
): LineaConsolidado[] {
  return employees.map(emp => {
    const split      = splitHorasPeriodo(workDays, emp.id, period.fecha_fin, local)
    const hourlyRate = Number(emp.hourly_rate_crc) || 0
    const fijo       = Number(emp.fixed_salary_crc) || 0
    const pagoHoras  = split.total * hourlyRate
    return {
      employee:    emp,
      hourlyRate,
      // Solo es un problema si además tiene horas: sin horas y sin tarifa es alguien
      // que simplemente no trabajó en el período.
      sinTarifa:   sinTarifa(emp) && split.total > 0,
      horasManual: split.manual,
      horasOtras:  split.otras,
      horasPisadas: split.pisadas,
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

/**
 * Horas que se le acreditan a CADA TRAMO SIN CERRAR de una jornada (A8): la marca que
 * quedó sin su otra mitad porque alguien se olvidó de fichar. Se cuenta por tramo y no
 * por día justamente para no perder el tramo que SÍ está bien marcado — el turno cortado
 * con la tarde sin salida vale la mañana medida + 3 h, no solo la mañana.
 *
 * Es un DEFAULT CORREGIBLE, no una medición: la 059 deja el desglose en `flags`
 * (`horas_pares` / `tramos_sin_cerrar` / `horas_default`) para que el contador vea
 * "X h reales + Y h default", y quien tenga el dato real lo pisa desde la bandeja.
 * Política firmada por Ismael el 2026-08-23 — el número vive acá y en `v_default_h` de
 * la 059, y un test los ata leyendo el .sql.
 */
export const HORAS_DEFAULT_IMPAR = 3

export interface DerivacionResumen {
  local:                string
  desde:                string
  hasta:                string
  marcas:               number
  dias:                 number
  dias_incompletos:     number
  tramos_sin_cerrar:    number
  horas_default:        number
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

/**
 * Las excepciones del período en TODOS los locales. La pantalla de pago usa esta y no la
 * filtrada: el neto de la quincena suma las horas de cualquier local (el pay run es
 * global), así que mirar un solo local dejaría el aviso ciego justo donde sale la plata.
 */
export async function getPunchExceptionsTodosLosLocales(
  desde: string,
  hasta: string,
): Promise<PunchException[]> {
  try {
    const { data, error } = await fromAny('punch_exceptions')
      .select('*')
      .gte('work_date', desde)
      .lte('work_date', hasta)
      .order('work_date', { ascending: true })
    return error ? [] : ((data ?? []) as PunchException[])
  } catch { return [] }
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

/**
 * Qué marcas de la jornada corresponden al caso, con respaldo. La marca cruda puede no
 * tener `employee_id` resuelto (el ingest lo deja null si el `emp_code` no estaba mapeado
 * cuando entró), así que filtrar solo por `employee_id` dejaba el renglón VACÍO —
 * indistinguible de "no hubo marcas". Se prueban tres criterios en orden y, si ninguno da,
 * se muestran TODAS las de la jornada: ver de más es infinitamente mejor que ver nada
 * cuando lo que se está mirando es por qué a alguien no le cuadran las horas.
 */
export function marcasDelCaso(
  marcas: TimePunch[],
  x: Pick<PunchException, 'employee_id' | 'emp_code'>,
): { lista: TimePunch[]; ampliado: boolean } {
  if (marcas.length === 0) return { lista: [], ampliado: false }
  if (x.employee_id) {
    const porEmpleado = marcas.filter(m => m.employee_id === x.employee_id)
    if (porEmpleado.length > 0) return { lista: porEmpleado, ampliado: false }
  }
  if (x.emp_code) {
    const porCodigo = marcas.filter(m => m.emp_code === x.emp_code)
    if (porCodigo.length > 0) return { lista: porCodigo, ampliado: false }
  }
  return { lista: marcas, ampliado: true }
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
 * Empleados que corren riesgo de que se les pague la quincena DOS VECES.
 *
 * El riesgo real es UNO solo: U0b carga el total del período en una fila manual fechada
 * el ÚLTIMO día (`work_date === fechaFin`) y `splitHorasPeriodo` la SUMA a todo lo
 * derivado. Cualquier otra fila manual es un override de la bandeja, que por la PK
 * (employee_id, work_date, local) REEMPLAZÓ la jornada de BioTime de ese día: ahí no hay
 * nada duplicado, y marcarlo frenaría justo el flujo que la app recomienda para arreglar
 * los fichajes (y enseñaría a tildar la casilla sin mirar).
 *
 * NO se filtra por local a propósito: `splitHorasPeriodo` suma TODAS las filas del
 * empleado en el rango sin mirar el local (el pay run es global), así que vigilar un
 * solo local dejaría ciego al guard justo donde la plata sí se suma.
 */
export function empleadosConHorasDobles(workDays: WorkDay[], fechaFin: string): string[] {
  const totalDelPeriodo = new Set<string>()
  const derivadas       = new Set<string>()
  for (const w of workDays) {
    if ((Number(w.hours) || 0) <= 0) continue
    if (w.source === 'manual') {
      // Una fila manual del último día puede ser DOS cosas distintas, y confundirlas
      // frena nóminas sanas: el TOTAL del período que carga U0b (`upsertWorkDay`, sin
      // flags), o una CORRECCIÓN puntual de esa jornada hecha desde la bandeja
      // (`overrideHorasDia`, que deja `flags.override`). La corrección REEMPLAZÓ la fila
      // de BioTime de ese día —misma PK— así que no duplica nada. El discriminante es
      // `flags.override`: sin él, quien corrige el último día queda marcado para siempre
      // y aprende a tildar la casilla sin mirar.
      const esOverride = !!(w.flags as { override?: unknown } | null)?.override
      if (w.work_date === fechaFin && !esOverride) totalDelPeriodo.add(w.employee_id)
    } else if (w.source === 'biotime') {
      derivadas.add(w.employee_id)
    }
  }
  return [...totalDelPeriodo].filter(id => derivadas.has(id))
}


// ── Lo que el contador necesita ver (puro) ──────────────────────────────────────

export interface ResumenImpares {
  employee_id:     string
  dias:            number   // jornadas derivadas de BioTime
  diasIncompletos: number   // ...con al menos un tramo sin cerrar
  tramos:          number   // tramos sin cerrar en total
  horasMedidas:    number   // las que sí midió el reloj (Σ pares)
  horasDefault:    number   // las que puso la regla (tramos × HORAS_DEFAULT_IMPAR)
}

/**
 * Por empleado: cuántas jornadas quedaron incompletas, cuántos tramos sin cerrar suman y
 * cuántas horas de esas NO las midió el reloj. Es el dato que el contador tiene que ver
 * ANTES de pagar (A8: "X h reales + Y h default"), y el mismo que la Fase 2 va a
 * necesitar para el comprobante individual.
 *
 * Se lee de `work_days.flags` (lo escribe la mig 059), no de `punch_exceptions`: las
 * excepciones se resuelven y desaparecen de la bandeja, pero el origen de las horas queda
 * pegado a la jornada para siempre — y resolver una excepción no cambia un colón de lo
 * que se paga.
 *
 * Los días MIXTOS (un par bien marcado + un tramo abierto) cuentan en las dos columnas:
 * sus horas medidas van a `horasMedidas` y sus 3 h a `horasDefault`. Sumarlas a ciegas
 * sería volver a esconder justo lo que A8 quiere exhibir.
 */
export function resumenImpares(workDays: WorkDay[], local?: string): Map<string, ResumenImpares> {
  const out = new Map<string, ResumenImpares>()
  for (const w of workDays) {
    if (w.source !== 'biotime') continue
    if (local && w.local !== local) continue
    const f = (w.flags ?? {}) as Record<string, unknown>
    const r = out.get(w.employee_id) ?? {
      employee_id: w.employee_id, dias: 0, diasIncompletos: 0, tramos: 0,
      horasMedidas: 0, horasDefault: 0,
    }
    const tramos  = Number(f.tramos_sin_cerrar) || 0
    const hDef    = Number(f.horas_default) || 0
    // `horas_pares` puede faltar en filas viejas: el resto de las horas es lo medido.
    const hMedida = f.horas_pares != null ? Number(f.horas_pares) || 0
                                          : Math.max(0, (Number(w.hours) || 0) - hDef)
    r.dias += 1
    if (tramos > 0) r.diasIncompletos += 1
    r.tramos       += tramos
    r.horasDefault += hDef
    r.horasMedidas += hMedida
    out.set(w.employee_id, r)
  }
  return out
}

/**
 * Empleados INACTIVOS que igual tienen horas cargadas en el período.
 *
 * La nómina se arma con `employees.filter(is_active)`. Si alguien trabajó media quincena
 * y lo desactivan antes de cerrarla, sus horas quedan cargadas y visibles en la pestaña
 * Horas, pero su línea no existe en la de Pago: no entra al total, no entra al archivo
 * del banco, y el semáforo tampoco lo cuenta porque `idsQueSePagan` lo filtra a propósito
 * (para que no frene la nómina de los demás). El resultado es el peor de los silencios:
 * alguien no cobra y el único que se entera es él, cuando reclama.
 *
 * Esto NO los mete a la nómina: irse a mitad de quincena puede ser legítimo y la decisión
 * de pagarle o no es del dueño. Solo deja de callarlos.
 *
 * `local` es opcional y por defecto NO se filtra: `splitHorasPeriodo` suma las horas de
 * TODOS los locales (el pay run es global), así que mirar uno solo dejaría ciego el aviso
 * justo donde la plata también se cuenta.
 */
export function inactivosConHoras(
  employees: Employee[],
  workDays: WorkDay[],
  period: Pick<SalaryPeriod, 'fecha_ini' | 'fecha_fin'>,
  local?: string,
): string[] {
  const inactivos = new Set(employees.filter(e => !e.is_active).map(e => e.id))
  if (inactivos.size === 0) return []

  const conHoras = new Set<string>()
  for (const w of workDays) {
    if (!inactivos.has(w.employee_id)) continue
    if ((Number(w.hours) || 0) <= 0) continue
    if (local && w.local !== local) continue
    if (w.work_date < period.fecha_ini || w.work_date > period.fecha_fin) continue
    conHoras.add(w.employee_id)
  }
  // En el orden del maestro, para que el cartel sea estable entre renders.
  return employees.filter(e => conHoras.has(e.id)).map(e => e.id)
}

// ── Semáforo del pago (puro) ────────────────────────────────────────────────────

export interface SemaforoPago {
  fichajeDias:     number     // JORNADAS con fichaje incompleto: avisan, no frenan
  sinMapearDias:   number     // (código, jornada) con marcas de alguien que no está en el maestro
  sinMapearMarcas: number     // ...y cuántas marcas suman
  diasIncompletos: number     // jornadas de esta nómina con algún tramo sin cerrar
  tramos:          number     // tramos sin cerrar (cada uno vale HORAS_DEFAULT_IMPAR)
  horasDefault:    number     // las horas que puso la regla, no el reloj
  dobles:          string[]   // employee_ids con total del período a mano Y días derivados
}

const clave = (x: PunchException) => `${x.employee_id ?? x.emp_code ?? '?'}|${x.work_date ?? '?'}`

/**
 * Qué tan seguro es pagar este período. La distinción es deliberada:
 *
 * · fichaje (impar/solapado/turno_largo) — el día YA tiene un valor: horas medidas, o el
 *   default de 3 h. Bloquear por esto dejaría la quincena sin pagar por un olvido de
 *   alguien que igual trabajó. Avisa y nada más. Se cuentan JORNADAS, no filas: una
 *   jornada `in,in` genera DOS excepciones (solapado + impar) y sigue siendo un día.
 * · sin_mapear — hay marcas de una persona que no está en el maestro: puede que ALGUIEN
 *   NO ESTÉ COBRANDO. No se puede arreglar solo desde acá (falta darla de alta), así que
 *   se pide confirmación explícita en vez de frenar la nómina de todos los demás.
 * · horas default — salen de `work_days.flags`, NO de las excepciones. Una excepción se
 *   resuelve y desaparece de la bandeja, pero las horas puestas por la regla siguen
 *   cobrándose: si el aviso colgara del estado de la excepción, limpiar la bandeja
 *   apagaría la señal sin cambiar un solo colón de lo que se paga.
 * · dobles — el único riesgo de pagar DE MÁS. Frena el pago hasta que alguien lo mire.
 *
 * `idsQueSePagan` acota todo a la nómina real: un inactivo con horas viejas no puede
 * frenar el pago de los demás, porque su línea ni siquiera existe en la pantalla.
 */
export function semaforoPago(
  excepciones: PunchException[],
  workDays: WorkDay[],
  fechaFin: string,
  idsQueSePagan?: string[],
): SemaforoPago {
  const nomina   = idsQueSePagan ? new Set(idsQueSePagan) : null
  const cuenta   = (id: string | null) => !nomina || (id != null && nomina.has(id))
  const abiertas = excepciones.filter(x => x.estado === 'abierta')

  const fichaje = new Set<string>()
  const sinMap  = new Set<string>()
  let sinMapMarcas = 0
  for (const x of abiertas) {
    if (x.tipo === 'sin_mapear') {
      // Sin empleado resuelto no hay a quién acotarlo: siempre cuenta.
      sinMap.add(clave(x))
      sinMapMarcas += Number((x.detalle as { cuantas?: unknown } | null)?.cuantas) || 1
    } else if (cuenta(x.employee_id)) {
      fichaje.add(clave(x))
    }
  }

  let diasIncompletos = 0, tramos = 0, horasDefault = 0
  for (const r of resumenImpares(workDays).values()) {
    if (!cuenta(r.employee_id)) continue
    diasIncompletos += r.diasIncompletos
    tramos          += r.tramos
    horasDefault    += r.horasDefault
  }

  return {
    fichajeDias:     fichaje.size,
    sinMapearDias:   sinMap.size,
    sinMapearMarcas: sinMapMarcas,
    diasIncompletos,
    tramos,
    horasDefault,
    dobles: empleadosConHorasDobles(workDays, fechaFin).filter(id => cuenta(id)),
  }
}
