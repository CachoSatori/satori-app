import { supabase } from './supabase'
import type {
  Employee,
  EmployeePayment,
  EmployeeWageRate,
  PunchException,
  SalaryPeriod,
  SalaryPeriodEstado,
  TimePunch,
  UserRole,
  WorkDay,
} from '../types/database'
import { horasEntreMarcas, marcaUnicaDeImpar } from '../utils/horasCorreccion'
import { ROLE_LABELS } from '../constants'

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
  upsert(rows: unknown, opts?: { onConflict?: string; ignoreDuplicates?: boolean }): Q
  update(patch: unknown): Q
  eq(col: string, value: unknown): Q
  gte(col: string, value: unknown): Q
  lte(col: string, value: unknown): Q
  lt(col: string, value: unknown): Q
  order(col: string, opts?: { ascending?: boolean }): Q
  single(): Q
}

const fromAny = supabase.from?.bind(supabase) as unknown as (table: string) => Q

// La pista por defecto es la del PAGO porque es el rebote real de la RLS (mig 056 §7.4:
// el contador arma la nómina pero no paga). Las transiciones de estado la pisan: cerrar y
// reabrir SÍ los puede el contador, y decirle lo contrario lo manda a buscar un permiso
// que ya tiene.
function fail(
  error: PgError,
  quePasaba: string,
  pista = 'El pago lo marcan solo el dueño o el gerente.',
): never {
  const msg = error?.message ?? 'error desconocido'
  // 42501 = la RLS dijo que no. El caso real es el contador intentando pagar.
  if (error?.code === '42501' || /row-level security/i.test(msg)) {
    throw new Error(`No tenés permiso para ${quePasaba}. ${pista}`.trim())
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

// ── Ciclo de estados del período ────────────────────────────────────────────────
//
// abierto → en_revision → cerrado → pagado, y la vuelta atrás SOLO por reapertura con
// motivo. Es control, no plata: acá no se calcula ni se mueve un colón, se decide QUÉ SE
// PUEDE TOCAR y CUÁNDO.
//
// Las tres reglas que sostienen el ciclo:
//   1. Sin saltos. `abierto → pagado` no existe: pagar exige haber cerrado.
//   2. No se cierra ni se paga con fichajes sin resolver (ver `motivoBloqueoExcepciones`).
//   3. `cerrado` y `pagado` CONGELAN horas y tarifas. La única salida es reabrir, y
//      reabrir deja rastro (`reopened_by/at/motivo`, mig 056).
//
// El esquema ya estaba: el CHECK del estado y las columnas de reapertura viven en la
// mig 056. Este bloque NO agrega ni una migración.

/** Cómo se lee cada estado en pantalla y en los mensajes de error. */
export const ESTADO_LABEL: Record<SalaryPeriodEstado, string> = {
  abierto:     'abierto',
  en_revision: 'en revisión',
  cerrado:     'cerrado',
  pagado:      'pagado',
}

/**
 * Transiciones válidas. La tabla es la definición: si un salto no está acá, no pasa.
 * `en_revision` es el único destino "hacia atrás", y llegar ahí desde `cerrado`/`pagado`
 * es una REAPERTURA — que exige motivo (`reabrirPeriodo`).
 */
export const TRANSICIONES: Record<SalaryPeriodEstado, SalaryPeriodEstado[]> = {
  abierto:     ['en_revision', 'cerrado'],
  en_revision: ['cerrado'],
  cerrado:     ['en_revision', 'pagado'],
  pagado:      ['en_revision'],
}

export function puedeTransicionar(desde: SalaryPeriodEstado, hacia: SalaryPeriodEstado): boolean {
  return TRANSICIONES[desde]?.includes(hacia) ?? false
}

/** Un período congelado no acepta cambios de horas ni de tarifas hasta que se reabra. */
export function estaCongelado(estado: SalaryPeriodEstado): boolean {
  return estado === 'cerrado' || estado === 'pagado'
}

/**
 * Cuántos fichajes sin resolver FRENAN el período. Son dos, y los dos se arreglan desde la
 * pestaña Horas por caminos distintos:
 *   · `fichajeDias`   → resolver la excepción en la bandeja.
 *   · `sinMapearDias` → asignarle el código al empleado y recalcular.
 *
 * Dos cosas quedan afuera A PROPÓSITO:
 *   · `diasIncompletos` — las horas puestas por la regla de las 3 h. Son un DEFAULT
 *     corregible, no un error: el día ya vale algo y bloquear la quincena por un olvido
 *     dejaría sin cobrar a alguien que sí trabajó. A8 pide paso consciente, no bloqueo →
 *     se avisa fuerte (`avisoHorasDefault`) y se deja seguir.
 *   · `dobles` — tiene su propio destrabe explícito en la pantalla de pago (revisar y
 *     confirmar), y meterlo acá lo dejaría sin salida.
 */
export function excepcionesSinResolver(s: SemaforoPago): number {
  return s.fichajeDias + s.sinMapearDias
}

/** El mensaje de por qué no se puede avanzar, o `null` si sí se puede. */
export function motivoBloqueoExcepciones(s: SemaforoPago, accion: string): string | null {
  const n = excepcionesSinResolver(s)
  if (n === 0) return null
  const detalle = [
    s.fichajeDias   > 0 ? `${s.fichajeDias} jornada(s) con fichaje incompleto en la bandeja` : null,
    s.sinMapearDias > 0 ? `${s.sinMapearDias} jornada(s) con marcas de alguien que no está en el maestro` : null,
  ].filter(Boolean).join(' · ')
  return `Hay ${n} fichaje(s) sin resolver — resolvelos en Horas antes de ${accion}. ${detalle}.`
}

/**
 * A8 · paso consciente: el aviso de las horas que NO midió el reloj. No frena — quien
 * cierra o paga tiene que verlo y decir que sí.
 *
 * Sale de `work_days.flags` (lo escribe la mig 059), NO del estado de la excepción: una
 * excepción se resuelve y desaparece de la bandeja, pero las 3 h siguen cobrándose. Si el
 * aviso colgara de la excepción, limpiar la bandeja lo apagaría sin cambiar un colón.
 */
export function avisoHorasDefault(s: SemaforoPago, accion: string): string | null {
  if (s.diasIncompletos === 0) return null
  return (
    `${s.diasIncompletos} jornada(s) con horas puestas por la regla: ${s.tramos} tramo(s) sin ` +
    `cerrar = ${s.horasDefault.toFixed(0)} h que no midió el reloj (${HORAS_DEFAULT_IMPAR} h por ` +
    'tramo). Los tramos bien marcados de esos días sí cuentan sus horas reales.\n\n' +
    `Se puede ${accion} igual — corregilas una por una en la pestaña Horas si podés.`
  )
}

async function leerPeriodo(periodId: string): Promise<SalaryPeriod> {
  const { data, error } = await fromAny('salary_periods')
    .select('*')
    .eq('id', periodId)
    .single()
  if (error) fail(error, 'leer el período')
  const p = data as SalaryPeriod | null
  if (!p) throw new Error('El período no existe.')
  return p
}

// Los ids de la nómina real, para acotar el semáforo igual que lo hace la pantalla: un
// inactivo con horas viejas no puede frenar el cierre de los demás. Si la lectura falla o
// vuelve vacía se devuelve `[]` y el llamador cuenta TODO (fail-closed): quedarse ciego
// no puede ser lo que destrabe un cierre.
async function idsDeLaNomina(): Promise<string[]> {
  try {
    const { data, error } = await fromAny('employees').select('id,is_active').eq('is_active', true)
    if (error) return []
    return ((data ?? []) as { id: string }[]).map(e => e.id)
  } catch { return [] }
}

/**
 * El semáforo del período leído de la BASE, no de la pantalla. Es a propósito: entre que
 * alguien abrió la pestaña y apretó "Cerrar" pueden haber entrado marcas nuevas.
 */
export async function semaforoDelPeriodo(
  p: Pick<SalaryPeriod, 'fecha_ini' | 'fecha_fin'>,
): Promise<SemaforoPago> {
  const [wd, exc, nomina] = await Promise.all([
    getWorkDays(p.fecha_ini, p.fecha_fin),
    getPunchExceptionsTodosLosLocales(p.fecha_ini, p.fecha_fin),
    idsDeLaNomina(),
  ])
  return semaforoPago(exc, wd, p.fecha_fin, nomina.length > 0 ? nomina : undefined)
}

async function exigirSinExcepciones(
  p: Pick<SalaryPeriod, 'fecha_ini' | 'fecha_fin'>,
  accion: string,
): Promise<void> {
  const motivo = motivoBloqueoExcepciones(await semaforoDelPeriodo(p), accion)
  if (motivo) throw new Error(motivo)
}

// Qué se escribe además del estado. El `userId` no es decorativo: es la mitad del rastro
// (la otra es la fecha). Pasar a revisión un período ABIERTO no tiene columna propia en la
// mig 056 y no la inventamos acá — agregar una es esquema, y el esquema lo firma Ismael.
function patchDe(hacia: SalaryPeriodEstado, userId: string, motivo?: string): Record<string, unknown> {
  const at = new Date().toISOString()
  if (hacia === 'cerrado') return { estado: 'cerrado', closed_by: userId, closed_at: at }
  if (hacia === 'en_revision') {
    return motivo != null
      ? { estado: 'en_revision', reopened_by: userId, reopened_at: at, reopen_motivo: motivo }
      : { estado: 'en_revision' }
  }
  return { estado: hacia }
}

const PISTA_ESTADO = 'Cerrar y reabrir lo pueden el dueño, el gerente y el contador.'

async function moverEstado(
  periodId: string,
  hacia: SalaryPeriodEstado,
  userId: string,
  motivo?: string,
): Promise<SalaryPeriod> {
  const p = await leerPeriodo(periodId)
  if (p.estado === hacia) throw new Error(`El período ya está ${ESTADO_LABEL[hacia]}.`)
  if (!puedeTransicionar(p.estado, hacia)) {
    throw new Error(
      `No se puede pasar un período de ${ESTADO_LABEL[p.estado]} a ${ESTADO_LABEL[hacia]}.`,
    )
  }
  // Reapertura = volver atrás desde un período congelado, y va SIEMPRE con motivo. Las
  // dos mitades importan: sin la primera, `reabrirPeriodo` "reabriría" un período abierto;
  // sin la segunda, `setPeriodoEnRevision` descongelaría uno cerrado por la puerta de al
  // lado, sin dejar rastro — que es exactamente lo que la reapertura auditada evita.
  if (motivo != null && !estaCongelado(p.estado)) {
    throw new Error(`Solo se reabre un período cerrado o pagado (este está ${ESTADO_LABEL[p.estado]}).`)
  }
  if (motivo == null && estaCongelado(p.estado)) {
    throw new Error(
      `El período está ${ESTADO_LABEL[p.estado]}: para volver a tocarlo hay que reabrirlo con un motivo.`,
    )
  }
  if (hacia === 'cerrado') await exigirSinExcepciones(p, 'cerrar')

  const { data, error } = await fromAny('salary_periods')
    .update(patchDe(hacia, userId, motivo))
    .eq('id', periodId)
    .select('*')
    .single()
  if (error) fail(error, `pasar el período a ${ESTADO_LABEL[hacia]}`, PISTA_ESTADO)
  return data as SalaryPeriod
}

/** `abierto → en_revision`: la nómina está armada y alguien la está mirando. */
export async function setPeriodoEnRevision(periodId: string, userId: string): Promise<SalaryPeriod> {
  return moverEstado(periodId, 'en_revision', userId)
}

/**
 * `abierto`/`en_revision` → `cerrado`. Congela horas y tarifas del período.
 * Rebota si quedan fichajes sin resolver: cerrar con marcas abiertas es congelar un
 * número que todavía no es el correcto.
 */
export async function cerrarPeriodo(periodId: string, userId: string): Promise<SalaryPeriod> {
  return moverEstado(periodId, 'cerrado', userId)
}

/**
 * `cerrado`/`pagado` → `en_revision`, con motivo OBLIGATORIO. Es la única forma de volver
 * a tocar las horas o las tarifas de un período congelado, y queda registrado quién lo
 * hizo, cuándo y por qué (mig 056: `reopened_by` / `reopened_at` / `reopen_motivo`).
 *
 * Reabrir un período PAGADO no borra ni toca los pagos ya registrados: `employee_payments`
 * y `salary_lines` son append-only y siguen siendo la evidencia de lo que se transfirió.
 */
export async function reabrirPeriodo(
  periodId: string,
  userId: string,
  motivo: string,
): Promise<SalaryPeriod> {
  const m = (motivo ?? '').trim()
  if (!m) throw new Error('La reapertura necesita un motivo: queda registrado en el período.')
  return moverEstado(periodId, 'en_revision', userId, m)
}

// ── Congelado: qué NO se puede editar mientras el período está cerrado ──────────

/**
 * El período que cubre esa fecha y está congelado, si lo hay.
 *
 * La lectura es null-safe a propósito (mismo criterio que la bandeja de excepciones): si
 * la consulta falla, la pantalla de Horas tiene que seguir funcionando. El congelado es
 * una guarda de proceso, no el candado de la plata — el candado del pago es
 * `markPeriodPaid`, que relee el estado del período antes de escribir nada.
 */
export async function periodoCongeladoEnRango(
  desde: string,
  hasta: string,
): Promise<SalaryPeriod | null> {
  try {
    // Solapamiento clásico: el período empieza antes de que termine el rango y termina
    // después de que empieza. Con desde === hasta es "el período que cubre ese día".
    const { data, error } = await fromAny('salary_periods')
      .select('*')
      .lte('fecha_ini', hasta)
      .gte('fecha_fin', desde)
    if (error) return null
    return ((data ?? []) as SalaryPeriod[]).find(p => estaCongelado(p.estado)) ?? null
  } catch { return null }
}

export async function periodoCongeladoEn(workDate: string): Promise<SalaryPeriod | null> {
  return periodoCongeladoEnRango(workDate, workDate)
}

async function exigirHorasEditables(desde: string, hasta = desde): Promise<void> {
  const p = await periodoCongeladoEnRango(desde, hasta)
  if (!p) return
  throw new Error(
    `El período ${p.fecha_ini} → ${p.fecha_fin} está ${ESTADO_LABEL[p.estado]}: sus horas están ` +
    'congeladas. Reabrilo con motivo desde Pago del período para poder corregirlas.',
  )
}

/**
 * El período CERRADO que todavía no se pagó, si lo hay.
 *
 * Es el único que una tarifa nueva podría alterar por atrás: su neto se sigue calculando
 * en vivo (`horas × tarifa del empleado`) hasta que se paga. Un período ya PAGADO no
 * corre riesgo — `salary_lines` congeló la tarifa con la que se calculó cada línea (mig
 * 056), así que cambiar la tarifa hoy no le mueve un colón a lo que ya se transfirió.
 */
export async function periodoCerradoSinPagar(): Promise<SalaryPeriod | null> {
  try {
    const { data, error } = await fromAny('salary_periods')
      .select('*')
      .eq('estado', 'cerrado')
      .order('fecha_ini', { ascending: false })
    if (error) return null
    return ((data ?? []) as SalaryPeriod[])[0] ?? null
  } catch { return null }
}

/**
 * Guarda de la edición de tarifas. La tarifa vive en `employees` y NO tiene fecha: cambiarla
 * mientras hay un período cerrado sin pagar le cambia el neto por atrás, que es exactamente
 * lo que "cerrado" promete que no pasa. Se llama desde la pestaña Empleados / Tarifas.
 */
export async function exigirTarifasEditables(): Promise<void> {
  const p = await periodoCerradoSinPagar()
  if (!p) return
  throw new Error(
    `El período ${p.fecha_ini} → ${p.fecha_fin} está cerrado y todavía no se pagó: cambiar una ` +
    'tarifa ahora le cambiaría el neto. Pagalo, o reabrilo con motivo desde Pago del período, ' +
    'antes de tocar las tarifas.',
  )
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
  await exigirHorasEditables(w.work_date)
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
  /** Lo que se transfiere = total de horas + 10% de servicio. El MISMO número que la grilla. */
  monto_neto:  number
  horas:       number
  hourly_rate: number
  fijo:        number
  /**
   * La parte del neto que salió del 10% de SERVICIO (no es propina, no es IVA). Opcional
   * con default 0 para no romper a un llamador viejo. Va a `salary_lines.aporte_servicio`,
   * columna que la mig 056 YA declaró — no hace falta migración nueva.
   */
  servicio?:   number
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
    .select('estado, fecha_ini, fecha_fin')
    .eq('id', periodId)
    .single()
  if (errPeriodo) fail(errPeriodo, 'leer el período')
  const fila = periodo as Pick<SalaryPeriod, 'estado' | 'fecha_ini' | 'fecha_fin'> | null
  if (fila?.estado === 'pagado') {
    throw new Error('Este período ya está marcado como pagado.')
  }
  // Sin saltos: se paga lo que se cerró. Pagar un período abierto sería transferir contra
  // un número que todavía se está moviendo.
  if (fila?.estado !== 'cerrado') {
    throw new Error(
      `Solo se paga un período cerrado (este está ${ESTADO_LABEL[fila?.estado as SalaryPeriodEstado] ?? 'sin estado'}). ` +
      'Cerralo antes de pagar.',
    )
  }
  // Misma guarda que el cierre, releída de la base: entre cerrar y pagar pueden haber
  // entrado marcas nuevas, y lo que se transfiere no puede salir de horas sin resolver.
  await exigirSinExcepciones(fila, 'pagar')

  const paidAt = new Date().toISOString()
  // UPSERT y no insert: el guard de arriba relee el mismo campo que escribe el ÚLTIMO paso
  // de esta función, así que no puede ver un intento anterior que murió en el medio. El
  // candado real es el unique (period_id, employee_id) de la mig 060; el `do nothing` es lo
  // que hace que el reintento CONVERJA en vez de rebotar — sin él, el 23505 mataría la
  // función antes del update y el período quedaría imposible de marcar pagado, con la
  // transferencia ya hecha. `do nothing` y no `do update`: la fila vieja es la evidencia de
  // cuánto se transfirió de verdad y no se pisa (corregir un pago es otro flujo: reapertura).
  const { error: errPagos } = await fromAny('employee_payments').upsert(
    pagables.map(l => ({
      period_id:   periodId,
      employee_id: l.employee_id,
      monto_neto:  Math.round(l.monto_neto),
      metodo:      'transferencia',
      estado:      'registrado',
      paid_by:     paidBy,
      paid_at:     paidAt,
    })),
    { onConflict: 'period_id,employee_id', ignoreDuplicates: true },
  )
  if (errPagos) fail(errPagos, 'registrar los pagos')

  // Snapshot del cierre. Va DESPUÉS de los pagos y ANTES del estado, y su error NO
  // frena el pago: es auditoría, no plata. Si fallara, el pago ya está registrado y
  // frenar acá dejaría el período sin marcar (que es el defecto que ya arrastramos).
  const { error: errLineas } = await fromAny('salary_lines').upsert(
    pagables.map(l => ({
      period_id:    periodId,
      employee_id:  l.employee_id,
      horas:        l.horas,
      pago_horas:   Math.round(l.horas * l.hourly_rate),
      // El 10% de SERVICIO repartido. La columna existe desde la mig 056 y estaba en 0:
      // ahora guarda de verdad cuánto del total salió del servicio, que es lo que permite
      // auditar un pago viejo sin tener que rehacer el reparto del día.
      aporte_servicio: Math.round(Number(l.servicio) || 0),
      salario_fijo: Math.round(l.fijo),
      total:        Math.round(l.monto_neto),
      snapshot: {
        hourly_rate_crc:  l.hourly_rate,
        fixed_salary_crc: l.fijo,
        horas:            l.horas,
        // El servicio también en el snapshot: el reparto depende de las horas de TODO el
        // equipo ese día, así que sin dejarlo escrito no se puede recalcular después.
        aporte_servicio_crc: Math.round(Number(l.servicio) || 0),
        origen_servicio:     'ventas_dias (10% de salón/barra)',
        // De dónde salió la tarifa, para que dentro de un año se entienda el número.
        origen_tarifa:    'employees',
        calculado_at:     paidAt,
      },
    })),
    // Espeja el unique de employee_payments (mig 060): reintentar no duplica el snapshot.
    { onConflict: 'period_id,employee_id', ignoreDuplicates: true },
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
  neto:        number       // el SALARIO calculado (horas × tarifa + fijo); la pantalla puede pisarlo a mano
  // Σ de las cuotas diarias del 10% de SERVICIO. NO es IVA y NO es propina: es el cargo
  // de salón/barra que se reparte al equipo y SÍ se transfiere junto con las horas.
  servicio:    number
  // Lo que sale por el banco = horas + 10% de servicio. Es la única cifra que el Excel
  // del homebanking y `markPeriodPaid` pueden usar: si la pantalla dijera una y el
  // archivo otra, alguien cobraría distinto de lo que se le mostró.
  aPagar:      number
  // Σ de lo que esta persona cobró de propinas en el período. INFORMATIVO: no entra a
  // `aPagar`, no entra al archivo del banco y no viaja a `markPeriodPaid`. Se pagan por
  // su propio camino (efectivo / Caja) y sumarlas acá sería pagarlas dos veces.
  propinasPeriodo: number
  ingresoTotal:    number   // horas + 10% de servicio + propinas — lo que ganó en el período
  nombreBanco: string
}

/**
 * Lo que SALE POR EL BANCO = total de horas + 10% de servicio. El servicio se transfiere
 * con las horas (no es efectivo); las propinas NO entran acá.
 *
 * Existe como función y no como suma suelta para que la grilla, el Excel del homebanking
 * y `markPeriodPaid` usen LA MISMA fórmula. La pantalla y el banco no pueden decir
 * cosas distintas: la pantalla es la promesa de lo que la persona va a cobrar.
 */
export function aPagarDe(neto: number, servicio: number): number {
  return (Number(neto) || 0) + (Number(servicio) || 0)
}

/**
 * Lo que la persona GANÓ en el período = horas + 10% de servicio + propinas. Informativo:
 * las propinas ya se cobraron en efectivo por su propio camino.
 *
 * `servicio` va con default 0 a propósito: un llamador que todavía no lee el servicio del
 * día sigue dando el mismo número que antes, en vez de romperse. Existe como función y no
 * como suma suelta para que la pantalla (que puede pisar el neto a mano) y el consolidado
 * usen LA MISMA fórmula: si el ingreso total se calculara aparte, un neto editado dejaría
 * los dos números contando historias distintas.
 */
export function ingresoTotalDe(neto: number, propinas: number, servicio = 0): number {
  return aPagarDe(neto, servicio) + (Number(propinas) || 0)
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

// `propinas` y `servicio` son OPCIONALES: sin ellos cada línea queda en 0 y el consolidado
// se comporta exactamente como antes de mostrarlos. Es lo que hace que estos agregados no
// puedan romper una pantalla que todavía no los carga — y, en el caso del servicio, lo que
// deja que la grilla muestre "—" en vez de inventar un monto cuando el dato no está.
export function consolidarPeriodo(
  employees: Employee[],
  workDays: WorkDay[],
  period: Pick<SalaryPeriod, 'fecha_fin'>,
  local: string,
  propinas?: Map<string, number>,
  servicio?: Map<string, number>,
): LineaConsolidado[] {
  return employees.map(emp => {
    const split      = splitHorasPeriodo(workDays, emp.id, period.fecha_fin, local)
    const hourlyRate = Number(emp.hourly_rate_crc) || 0
    const fijo       = Number(emp.fixed_salary_crc) || 0
    const pagoHoras  = split.total * hourlyRate
    const neto       = pagoHoras + fijo
    const propina    = Number(propinas?.get(emp.id)) || 0
    const serv       = Number(servicio?.get(emp.id)) || 0
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
      neto,
      servicio:    serv,
      aPagar:      aPagarDe(neto, serv),
      propinasPeriodo: propina,
      ingresoTotal:    ingresoTotalDe(neto, propina, serv),
      nombreBanco: nombreBanco(emp),
    }
  })
}


// ── 10% de SERVICIO · el reparto (SALARIOS, no propinas) ────────────────────────
//
// TRES CONCEPTOS QUE NO SE MEZCLAN. La confusión entre ellos es la que hace que alguien
// cobre de menos o que el fisco cobre de más, así que quedan escritos donde se calculan:
//
//   · IVA 13%          → IMPUESTO. Vive en la factura (`utils/posFiscal`). NO se reparte,
//                        NO se le paga a nadie y NO aparece en la nómina. La columna del
//                        10% NUNCA se llama "IVA" ni "impuesto de ventas".
//   · 10% de SERVICIO  → cargo de salón/barra (delivery NO lo cobra). Se REPARTE al equipo
//                        y sale POR TRANSFERENCIA junto con las horas. Es lo que calcula
//                        este bloque.
//   · PROPINA / pozo   → módulo Propinas (`utils/tipCalculations`). Hoy solo efectivo.
//                        NO va al banco.
//
// Por qué el reparto vive ACÁ y no en `tipCalculations`: ese archivo es el POZO de
// propinas. Meter el servicio ahí sería justamente borrar la línea de arriba — y el
// servicio se transfiere, así que un error de encuadre se paga en plata.
//
// De dónde sale el pool: `ventas_dias` (lo que el módulo Ventas ya carga del POS). Se LEE,
// no se escribe. `posFiscal` tampoco se toca: ahí vive la fórmula que arma el servicio en
// la factura, y este bloque solo consume el resultado que quedó guardado por día.

/**
 * Default del flag `employees.participa_servicio`: **true** (mig 055 lo declara
 * `not null default true`). La lectura usa `?? true` porque el tipo lo tiene opcional —
 * hay fixtures y filas casteadas a mano que no lo traen— y porque el default de la base
 * y el de la app tienen que decir lo MISMO: si acá dijera false, alguien dejaría de
 * cobrar servicio por un dato que en la base dice que sí lo cobra.
 *
 * El valor real por persona lo firma quien corresponde desde Empleados / Tarifas.
 */
export const PARTICIPA_SERVICIO_DEFAULT = true

export function participaServicio(emp: Pick<Employee, 'participa_servicio'>): boolean {
  return emp.participa_servicio ?? PARTICIPA_SERVICIO_DEFAULT
}

/**
 * DEPARTAMENTO y PUESTO a partir del rol.
 *
 * HUECO DE ESQUEMA CONOCIDO: `employees` no tiene columnas `departamento` ni `puesto`
 * — solo `role`, el enum `user_role` que ya usa toda la app. El SPEC-UI v3 pide los dos
 * campos por separado. Se parten en la UI a partir del rol en vez de meter una migración
 * para esto: el dato que hoy existe alcanza para agrupar (Salón / Cocina / Barra) y para
 * nombrar el puesto, y una columna nueva sin nadie que la cargue solo agrega un campo
 * vacío. Cuando haya puestos que el enum no distingue (bacha, limpieza), va con su DDL
 * aditivo propio.
 */
export type Departamento = 'Salón' | 'Cocina' | 'Barra' | 'Administración'

const DEPARTAMENTO_DE: Record<string, Departamento> = {
  salonero: 'Salón',
  runner:   'Salón',
  barman:   'Barra',
  barback:  'Barra',
  cocina:   'Cocina',
  cajero:   'Administración',
  manager:  'Administración',
  owner:    'Administración',
  contador: 'Administración',
}

export function departamentoDe(role: UserRole): Departamento {
  return DEPARTAMENTO_DE[role] ?? 'Administración'
}

/** El puesto es la etiqueta del rol: hoy es el único dato de puesto que hay. */
export function puestoDe(role: UserRole): string {
  return ROLE_LABELS[role] ?? role
}

/**
 * El tipo de regla de horario de una persona, deducido de lo que tiene cargado.
 * `employees` guarda UNA entrada y UNA salida habituales (mig 061), así que:
 *   · las dos cargadas  → regla ÚNICA (entra/sale fijos);
 *   · ninguna cargada   → FLEXIBLE (sin hora techo: cada impar se propone en blanco).
 * El tipo CORTADO (dos bloques el mismo día) necesita cuatro horas y hoy no hay dónde
 * guardarlas — ver el DDL aditivo propuesto en el reporte. Se ofrece en la ficha
 * mostrando qué falta, no como un campo que dice guardar y no guarda.
 */
export type TipoRegla = 'unico' | 'cortado' | 'flexible'

export function tipoReglaDe(
  emp: Pick<Employee, 'hora_entrada_habitual' | 'hora_salida_habitual'>,
): TipoRegla {
  const e = horaHabitualHHMM(emp.hora_entrada_habitual)
  const sl = horaHabitualHHMM(emp.hora_salida_habitual)
  return e && sl ? 'unico' : 'flexible'
}

/**
 * El default de `participa_servicio` PARA UN ALTA, según el puesto. Salón y barra
 * cobran el 10% de servicio; cocina no.
 *
 * SOLO se usa al CREAR. Cambiarle el flag a alguien que ya existe es decidir quién cobra
 * el 10% de esta quincena —plata— y eso lo firma quien corresponde desde Empleados /
 * Tarifas, de a una persona. Esta función no toca a nadie que ya esté en el maestro.
 */
export function participaPorRolDefault(role: UserRole): boolean {
  return role === 'cocina' ? false : PARTICIPA_SERVICIO_DEFAULT
}

/**
 * Los empleados de cocina que HOY cobran el 10% de servicio. No los cambia: los LISTA,
 * para que quien firma los apague de a uno si corresponde. Un `participa` de cocina en
 * `Sí` puede ser correcto (un cocinero que sí entra al reparto por acuerdo) — por eso es
 * una lista para revisar, no una corrección automática.
 */
export function cocinaConServicio(employees: Employee[]): Employee[] {
  return employees.filter(e => e.is_active && e.role === 'cocina' && participaServicio(e))
}

/**
 * ¿Corresponde derivar las horas solo por abrir la pantalla?
 *
 * Sí cuando el período está VIVO (abierto / en revisión) y NO tiene ni una hora cargada
 * en ese local: sin horas no hay nada que mirar ni que pagar, y hacer que la pantalla
 * arranque vacía obliga a adivinar que existe un botón "Recalcular".
 *
 * NO cuando:
 *   · el período está CERRADO o PAGADO — congelado; derivar ahí lo descongelaría de
 *     hecho, sin que nadie lo reabra con motivo;
 *   · YA hay horas — auto-derivar entonces sería pisar trabajo hecho sin que lo pidan.
 *     Para forzar un recálculo está el botón, que es explícito y deja resumen.
 *
 * Ojo: aun cuando esta función dice que sí, `derivarWorkDays` REESCRIBE solo lo que vino
 * de BioTime; las horas cargadas a mano las respeta (`dias_omitidos_manual`).
 */
export function debeAutoDerivar(
  estado: SalaryPeriodEstado,
  workDays: Array<Pick<WorkDay, 'local'>>,
  local: string,
): boolean {
  if (estaCongelado(estado)) return false
  return !workDays.some(w => w.local === local)
}

/**
 * Deriva las horas del período si corresponde (ver `debeAutoDerivar`). Devuelve el
 * resumen cuando derivó y `null` cuando no había nada que hacer.
 *
 * NULL-SAFE por diseño: si la derivación falla (permiso, RPC caída), devuelve `null` en
 * vez de tirar. Es una comodidad al abrir la pantalla, no una operación que el usuario
 * pidió: no puede tumbar Horas ni Pago. El botón "Recalcular" sigue reportando su error.
 */
export async function autoDerivarSiVacio(
  period: Pick<SalaryPeriod, 'fecha_ini' | 'fecha_fin' | 'estado'>,
  workDays: Array<Pick<WorkDay, 'local'>>,
  local: string = LOCAL_DEFAULT,
): Promise<DerivacionResumen | null> {
  if (!debeAutoDerivar(period.estado, workDays, local)) return null
  try {
    return await derivarWorkDays(period.fecha_ini, period.fecha_fin, local)
  } catch {
    return null
  }
}

/** Un código de BioTime que fichó pero no es de nadie del maestro. */
export interface CodigoSinMapear {
  code:   string
  dias:   number
  marcas: number
}

/**
 * Los códigos de BioTime que fichan y NO tienen empleado. Son horas que alguien
 * trabajó y que hoy no se le pagan a nadie: tienen que estar A LA VISTA, no escondidas
 * en el conteo de excepciones. Solo LISTA — el mapeo código→persona lo firma quien
 * corresponde desde Empleados / Tarifas.
 */
export function codigosSinMapear(excs: PunchException[]): CodigoSinMapear[] {
  const acc = new Map<string, { dias: Set<string>; marcas: number }>()
  for (const x of excs) {
    if (x.tipo !== 'sin_mapear' || x.estado !== 'abierta') continue
    const code = (x.emp_code ?? '').trim()
    if (!code) continue
    const e = acc.get(code) ?? { dias: new Set<string>(), marcas: 0 }
    if (x.work_date) e.dias.add(x.work_date)
    // Mismo criterio que el semáforo (`sinMapearMarcas`): la RPC deja el conteo en
    // `detalle.cuantas`; sin ese dato, la fila vale por una marca.
    e.marcas += Number((x.detalle as { cuantas?: unknown } | null)?.cuantas) || 1
    acc.set(code, e)
  }
  return [...acc.entries()]
    .map(([code, e]) => ({ code, dias: e.dias.size, marcas: e.marcas }))
    .sort((a, b) => a.code.localeCompare(b.code, 'es'))
}

/**
 * Los días de calendario del período, inclusive. UTC a propósito: son fechas
 * (`YYYY-MM-DD`), no instantes — con hora local, el `+1 día` repite o se come un día
 * cuando el runtime cambia de huso. El tope de 400 es una red contra una fecha mal
 * cargada, no un límite de negocio: una quincena tiene 15.
 */
export function diasDelPeriodo(fechaIni: string, fechaFin: string): string[] {
  const out: string[] = []
  if (!fechaIni || !fechaFin || fechaFin < fechaIni) return out
  const d   = new Date(`${fechaIni}T00:00:00Z`)
  const fin = new Date(`${fechaFin}T00:00:00Z`)
  if (isNaN(d.getTime()) || isNaN(fin.getTime())) return out
  while (d <= fin && out.length < 400) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/**
 * El reparto de UN día. Fórmula:
 *
 *     denom = Σ horas de ese día de quien participa
 *     denom = 0  →  cuota = 0 para todos (NO se divide por cero: el pool queda sin repartir)
 *     denom > 0  →  cuota = pool / denom × horas_de_la_persona
 *
 * Quien tiene `participa = false` no llega acá: ni cobra servicio ni entra al denominador
 * (si entrara, achicaría la cuota de los demás sin cobrar él).
 */
export function repartoServicioDia(
  pool: number,
  horas: Array<{ employeeId: string; horas: number }>,
): Map<string, number> {
  const out = new Map<string, number>()
  const p = Number(pool) || 0
  const denom = horas.reduce((sum, h) => sum + (Number(h.horas) || 0), 0)
  if (p <= 0 || denom <= 0) return out
  for (const h of horas) {
    const hs = Number(h.horas) || 0
    if (hs <= 0) continue
    out.set(h.employeeId, (out.get(h.employeeId) ?? 0) + (p / denom) * hs)
  }
  return out
}

export interface ServicioPeriodo {
  /** employee_id → Σ de sus cuotas diarias. Es la columna "10% serv." de la quincena. */
  porEmpleado: Map<string, number>
  /** Σ de lo que efectivamente se repartió. */
  totalRepartido: number
  /**
   * Σ de los pools de días que cobraron servicio y NO tenían horas de nadie que participe.
   * Esa plata existe y no la cobró nadie: se muestra en vez de desaparecer en un ₡0.
   */
  totalSinRepartir: number
  /**
   * Días del período SIN fila en `ventas_dias`. No es "ese día no hubo servicio": es
   * "no se sabe". Se listan para que el que arma la nómina cargue las ventas o acepte
   * el faltante a sabiendas.
   */
  diasSinVentas: string[]
}

/**
 * El 10% de servicio del período, día por día. `servicioPorDia` viene de
 * `getServicioPorDia` y `dias` de `diasDelPeriodo`.
 *
 * El local NO entra en el denominador a propósito: `ventas_dias` guarda UN pool por día
 * para el negocio entero (no está abierto por local), así que dividirlo entre las horas
 * de un solo local repartiría plata de todos entre una parte del equipo. Si algún día el
 * pool se abre por local, el denominador se abre con él — y no antes.
 */
export function servicioDelPeriodo(
  workDays: WorkDay[],
  servicioPorDia: Map<string, number>,
  participa: (employeeId: string) => boolean,
  dias: string[],
): ServicioPeriodo {
  const porEmpleado = new Map<string, number>()
  let totalRepartido   = 0
  let totalSinRepartir = 0
  const diasSinVentas: string[] = []

  // Horas por día, SOLO de quien participa. Se suman los locales del mismo día: una
  // persona puede tener horas en dos locales y su cuota sale de las horas que trabajó.
  const horasPorDia = new Map<string, Map<string, number>>()
  for (const w of workDays) {
    if (!participa(w.employee_id)) continue
    const h = Number(w.hours) || 0
    if (h <= 0) continue
    const delDia = horasPorDia.get(w.work_date) ?? new Map<string, number>()
    delDia.set(w.employee_id, (delDia.get(w.employee_id) ?? 0) + h)
    horasPorDia.set(w.work_date, delDia)
  }

  for (const fecha of dias) {
    if (!servicioPorDia.has(fecha)) { diasSinVentas.push(fecha); continue }
    const pool = Number(servicioPorDia.get(fecha)) || 0
    if (pool <= 0) continue
    const delDia = horasPorDia.get(fecha)
    const filas  = delDia ? [...delDia].map(([employeeId, horas]) => ({ employeeId, horas })) : []
    const cuotas = repartoServicioDia(pool, filas)
    if (cuotas.size === 0) { totalSinRepartir += pool; continue }
    for (const [id, monto] of cuotas) {
      porEmpleado.set(id, (porEmpleado.get(id) ?? 0) + monto)
      totalRepartido += monto
    }
  }

  return { porEmpleado, totalRepartido, totalSinRepartir, diasSinVentas }
}

/**
 * El servicio de UN día a partir de la fila cruda de `ventas_dias`. El JSONB es el
 * `DiaData` del módulo Ventas: un mapa de personas (saloneros y cajeros, disjuntos) y
 * cada una trae el servicio que cobró ese día. Se suma igual que lo hace el reporte de
 * contabilidad.
 *
 * El monto YA viene solo de salón/barra: el POS no cobra servicio en delivery, así que no
 * hay nada que descontar acá. Y no lleva IVA (`SERVICE_CONFIG.taxed = false`).
 *
 * Tolerante a propósito (`unknown` → 0): la fila es JSON de otro módulo y un día raro no
 * puede tumbar la pantalla que paga.
 */
export function servicioDeDiaData(data: unknown): number {
  const d = data as { saloneros?: Record<string, { serv?: number } | null> } | null
  const saloneros = d?.saloneros
  if (!saloneros || typeof saloneros !== 'object') return 0
  let serv = 0
  for (const persona of Object.values(saloneros)) serv += Number(persona?.serv) || 0
  return serv
}

/**
 * `fecha → 10% de servicio cobrado ese día`, leído de `ventas_dias`. SOLO LECTURA: esta
 * función no escribe una fila de ventas ni toca `posFiscal`.
 *
 * Una fecha AUSENTE del mapa es "no hay ventas cargadas ese día", que no es lo mismo que
 * ₡0 — por eso el `Map` no se rellena con ceros: quien lo consume distingue los dos casos.
 */
export async function getServicioPorDia(
  fechaIni: string,
  fechaFin: string,
): Promise<Map<string, number>> {
  const { data, error } = await fromAny('ventas_dias')
    .select('session_date, data')
    .gte('session_date', fechaIni)
    .lte('session_date', fechaFin)
  if (error) fail(error, 'ver el servicio del período', 'Las ventas del día las carga el módulo Ventas.')
  const out = new Map<string, number>()
  for (const row of ((data ?? []) as Array<{ session_date: string; data: unknown }>)) {
    out.set(row.session_date, servicioDeDiaData(row.data))
  }
  return out
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
  // El recálculo REESCRIBE las horas del rango del lado del servidor: es la misma puerta
  // que `upsertWorkDay`, con otra cerradura. Sin esta guarda, "recalcular" descongelaría
  // un período cerrado sin que nadie lo reabra.
  await exigirHorasEditables(desde, hasta)
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
  await exigirHorasEditables(o.work_date)
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

// ── Salarios · Capa 3: la regla de hora habitual del empleado (mig 061) ─────────
//
// Capa 2 dejó de pedir horas estimadas: las saca de la RESTA entre dos marcas de reloj.
// Lo que seguía siendo repetitivo es la otra mitad — quien marca una sola vez deja el
// mismo hueco cada quincena, y para la mayoría la hora que falta es siempre la misma.
// Guardarla en la ficha convierte esa corrección repetida en un dato del empleado.
//
// Dos límites que no se mueven:
//   · La regla NO inventa jornadas. Solo alcanza al `impar` de UNA marca, donde el reloj
//     ya probó que la persona estuvo. Un día SIN ninguna marca es una AUSENCIA, y
//     rellenarlo sería inventar horas — o sea plata. `marcaUnicaDeImpar` es lo que lo
//     garantiza: devuelve null para todo lo demás, y acá eso significa "no se toca".
//   · La regla NO escribe sola. Es un pre-relleno editable; lo que persiste sigue siendo
//     un override `manual` con su motivo, igual que en Capa 2.

export interface EmpleadoConRegla {
  hora_entrada_habitual?: string | null
  hora_salida_habitual?:  string | null
}

// Una columna `time` vuelve como "08:00:00" y el input del navegador da "08:00". Se
// aceptan las dos y se normaliza a "HH:MM", que es lo único que `horasEntreMarcas` come.
const HORA_TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/

/** "08:00:00" → "08:00". `null` si no hay regla cargada o el valor no es una hora de reloj. */
export function horaHabitualHHMM(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  const m = HORA_TIME.exec(v.trim())
  return m ? `${m[1]}:${m[2]}` : null
}

/**
 * La hora habitual de la mitad que FALTA, según de qué lado quedó la marca real:
 * si la marca real es la entrada falta la salida, y al revés. `null` = este empleado no
 * tiene cargada ESA hora → el impar sigue yendo a corrección manual.
 */
export function horaHabitualFaltante(
  emp: EmpleadoConRegla | null | undefined,
  ladoReal: 'in' | 'out',
): string | null {
  if (!emp) return null
  return horaHabitualHHMM(ladoReal === 'in' ? emp.hora_salida_habitual : emp.hora_entrada_habitual)
}

/** Hora local de Costa Rica (UTC−6 FIJO, sin horario de verano) de un instante ISO. */
export function hhmmCR(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const cr = new Date(d.getTime() - 6 * 3600_000)
  return `${String(cr.getUTCHours()).padStart(2, '0')}:${String(cr.getUTCMinutes()).padStart(2, '0')}`
}

export const MOTIVO_REGLA = 'regla del empleado (hora habitual)'

/**
 * El rastro que queda en `work_days.flags.override.motivo` cuando la mitad la puso la
 * regla y NO una persona mirando el caso. Se distingue a propósito del motivo de Capa 2
 * ("completada a mano"): dentro de seis meses el contador tiene que poder separar lo que
 * alguien revisó uno por uno de lo que se aplicó en lote.
 */
export function motivoRegla(
  entrada: string,
  salida: string,
  ladoReal: 'in' | 'out',
  horaReal: string,
): string {
  const etiqueta = ladoReal === 'in' ? 'entrada' : 'salida'
  return `entró ${entrada} → salió ${salida} (marca real: ${etiqueta} ${horaReal}, mitad completada por ${MOTIVO_REGLA})`
}

export interface ImparConRegla {
  x:        PunchException
  lado:     'in' | 'out'   // de qué lado quedó la marca REAL
  horaReal: string
  habitual: string         // la mitad que pone la regla
  entrada:  string
  salida:   string
  horas:    number
}

/**
 * De una lista de excepciones, las que la regla del empleado PUEDE completar, ya con las
 * horas resueltas por resta. Puro: no lee ni escribe nada.
 *
 * Queda afuera, en este orden y a propósito:
 *   · todo lo que no sea `impar` de UNA marca —incluido el día sin ninguna marca, que es
 *     una ausencia— porque `marcaUnicaDeImpar` devuelve null;
 *   · el empleado sin la hora habitual DEL LADO que falta (tiene entrada pero le falta la
 *     salida, o ninguna de las dos): ese impar se corrige a mano, como siempre;
 *   · lo que no dé una resta válida.
 *
 * `ladoDe` deja que la pantalla imponga el lado que el usuario ya volteó a mano: lo que se
 * aplica es lo que está viendo, no lo que dijo BioTime.
 */
export function imparesConRegla(
  items: PunchException[],
  emp: EmpleadoConRegla | null | undefined,
  ladoDe: (x: PunchException, porDefecto: 'in' | 'out') => 'in' | 'out' = (_x, d) => d,
): ImparConRegla[] {
  const out: ImparConRegla[] = []
  for (const x of items) {
    if (x.estado !== 'abierta') continue
    const marca = marcaUnicaDeImpar(x)
    if (!marca) continue
    const lado     = ladoDe(x, marca.punch_state)
    const habitual = horaHabitualFaltante(emp, lado)
    if (!habitual) continue
    const horaReal = hhmmCR(marca.punch_at)
    const entrada  = lado === 'in' ? horaReal : habitual
    const salida   = lado === 'in' ? habitual : horaReal
    const horas    = horasEntreMarcas(entrada, salida)
    if (horas == null) continue
    out.push({ x, lado, horaReal, habitual, entrada, salida, horas })
  }
  return out
}

/**
 * Guarda (o borra) la regla del empleado. Por su propia función, igual que el alias del
 * homebanking: el payload de `updateEmployeePayroll` es un contrato cerrado (mig 055) y no
 * se ensancha. Vacío → null: "sin regla" es un estado legítimo y explícito, '' no.
 */
export async function updateEmployeeHorasHabituales(
  id: string,
  entrada: string | null,
  salida: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('employees')
    .update({
      hora_entrada_habitual: horaHabitualHHMM(entrada),
      hora_salida_habitual:  horaHabitualHHMM(salida),
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
