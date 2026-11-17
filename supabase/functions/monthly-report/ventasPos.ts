// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Ventas del reporte DESDE EL PoS (decisión firmada del dueño, 16-nov-2026 22:20 CR): nunca más
//  `ventas_dias` (xls), que no tiene filas desde el 20-oct.
//
//  El armado del día NO se reescribe acá: `ventasPos.gen.js` es el PAQUETE de la misma lógica que
//  usa la app (`src/modules/ventas/ventasPosPuro.ts`, rama claude/ventas-desde-pos), generado con
//  `node scripts/edge/empaquetar-ventas-pos.mjs`. La paridad la cuidan las dos pruebas contra el
//  MISMO `__paridad__/esperado.json` (app: ventasPosPuro.paridad.test.ts; Edge: ventasPos.test.ts).
//
//  Lo único propio de la Edge es la LECTURA: con service_role, `get_my_role()` es null y las
//  funciones de la 067 devuelven 0 filas, así que se leen las tablas con los MISMOS filtros
//  (estado 'C', local, ventana de `fecha_registra` [desde, hasta)) y las MISMAS columnas.
//  Todo lo de este archivo es testeable sin red (el cliente entra por parámetro).
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Módulo generado (JS): la forma la fija la prueba de paridad.
import * as V from './ventasPos.gen.js'

export const LOCAL = 'santa-teresa'
const PAGINA = 1000
const TANDA_IDS = 200

export interface RangoDias { desde: string; hasta: string }
type Fila = Record<string, unknown>
type Error_ = { message?: string } | null | undefined
type Respuesta = { data: Fila[] | null; error: Error_ }
/** Lo que se usa de una consulta de supabase-js (encadenable y «await»-able). */
interface Consulta extends PromiseLike<Respuesta> {
  select(c: string): Consulta
  eq(c: string, v: unknown): Consulta
  gte(c: string, v: unknown): Consulta
  lt(c: string, v: unknown): Consulta
  in(c: string, v: unknown[]): Consulta
  not(c: string, op: string, v: unknown): Consulta
  order(c: string, o?: { ascending: boolean }): Consulta
  range(a: number, b: number): PromiseLike<Respuesta>
}
/** Cualquier cliente con `from` (el de supabase-js o uno falso en las pruebas). */
export type Cliente = { from: (t: string) => unknown }
const tabla = (sb: Cliente, t: string) => sb.from(t) as Consulta

function exigir(etapa: string, error: Error_): void {
  if (error) throw new Error(`lectura ${etapa}: ${error.message ?? 'error'}`)
}

/** Lee todo, de a `PAGINA` filas, con el orden total que le pase `consulta`. */
async function leerTodo(etapa: string, consulta: (desde: number, hasta: number) => PromiseLike<{ data: Fila[] | null; error: Error_ }>): Promise<Fila[]> {
  const out: Fila[] = []
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await consulta(i, i + PAGINA - 1)
    exigir(etapa, error)
    out.push(...(data ?? []))
    if (!data || data.length < PAGINA) return out
  }
}

/** Los tickets cerrados del local en la ventana (superset) del rango: lo que devuelve la 067. */
export async function leerTickets(sb: Cliente, rango: RangoDias, local = LOCAL): Promise<Fila[]> {
  const v = V.ventanaRangoJornadas(rango.desde, rango.hasta)
  return leerTodo('pos_tickets', (a, b) => tabla(sb, 'pos_ndf_tickets')
    .select(V.COLS_TICKETS_067.join(','))
    .eq('local', local).eq('estado', 'C')
    .gte('fecha_registra', v.desde).lt('fecha_registra', v.hasta)
    .order('fecha_registra', { ascending: true }).order('id', { ascending: true })
    .range(a, b))
}

/** Las líneas de esos tickets, por tandas de ids (URL corta) y paginadas. */
export async function leerLineas(sb: Cliente, ids: string[]): Promise<Fila[]> {
  const out: Fila[] = []
  for (let i = 0; i < ids.length; i += TANDA_IDS) {
    const tanda = ids.slice(i, i + TANDA_IDS)
    out.push(...await leerTodo('pos_lineas', (a, b) => tabla(sb, 'pos_ndf_ticket_lines')
      .select(V.COLS_LINEAS_067.join(','))
      .in('ticket_id', tanda)
      .order('ticket_id', { ascending: true }).order('id', { ascending: true })
      .range(a, b)))
  }
  return out
}

/** `pos_login → nombre` de `employees`: la primera capa de nombres, igual que la app. */
export async function leerNombres(sb: Cliente): Promise<Record<string, string>> {
  const { data, error } = await tabla(sb, 'employees').select('pos_login, full_name').not('pos_login', 'is', null)
  exigir('nombres', error)
  const out: Record<string, string> = {}
  for (const e of (data ?? []) as Array<{ pos_login: string | null; full_name: string | null }>) {
    const login = (e.pos_login ?? '').trim(), nombre = (e.full_name ?? '').trim()
    if (login && nombre) out[login] = nombre
  }
  return out
}

export interface Bucket {
  esCajero?: boolean; total?: number; delivery?: number; salon?: number; pax?: number
  iCom?: number; iBeb?: number; prods?: [string, number, number][]
}
export type DiaData = { saloneros: Record<string, Bucket> }
export interface DiasDelPos { dias: Record<string, DiaData>; pm: Record<string, { tipo: string }> }

/** El `DiasMap` del rango, del PoS, con el MISMO armado que la app. Los avisos de catálogo, al log. */
export async function diasDelPos(sb: Cliente, rango: RangoDias, local = LOCAL): Promise<DiasDelPos> {
  const tickets = await leerTickets(sb, rango, local)
  if (tickets.length === 0) return { dias: {}, pm: {} }
  const lineas = await leerLineas(sb, tickets.map(t => String(t.id)))
  const nombres = await leerNombres(sb)
  return V.armarDiasMap(tickets, lineas, rango, {
    uploadedAt: rango.hasta, nombres, avisar: (m: string) => console.warn(m.replace(/\d{4,}/g, '#')),
  }) as DiasDelPos
}

// ── Lo que el correo necesita, PURO ─────────────────────────────────────────────────────────

export interface TotalesMes {
  total: number; salon: number; caj: number; delivery: number; iva: number; serv: number; pax: number
  diasVentas: number
}

/**
 * Totales del período con `getDayStats` (la suma del módulo Ventas). El correo separa el salón en
 * «Salón» (meseros) y «Caja / Para llevar»: `salon` = meseros sin su delivery; `caj` = el resto
 * del salón (ventas de salón cobradas con login de caja). salon + caj + delivery = total.
 */
export function totalesDelPeriodo(dias: Record<string, DiaData>): TotalesMes {
  const t: TotalesMes = { total: 0, salon: 0, caj: 0, delivery: 0, iva: 0, serv: 0, pax: 0, diasVentas: 0 }
  for (const dia of Object.values(dias)) {
    const s = V.getDayStats(dia)
    let salonMeseros = 0
    for (const b of Object.values(dia.saloneros ?? {})) {
      if (!b.esCajero) salonMeseros += (b.total ?? 0) - (b.delivery ?? 0)
    }
    t.total += s.ventaNeta; t.iva += s.iva; t.serv += s.serv; t.delivery += s.delivery; t.pax += s.pax
    t.salon += salonMeseros; t.caj += s.salon - salonMeseros
    if (s.ventaNeta > 0) t.diasVentas++
  }
  return t
}

/** Neta del período (para «vs período anterior»). */
export function netaDelPeriodo(dias: Record<string, DiaData>): number {
  let n = 0
  for (const dia of Object.values(dias)) n += V.getDayStats(dia).ventaNeta
  return n
}

/** El tipo de cada producto: el curado (`product_map`) manda; si no, la familia del PoS. */
export function tipoDeProductos(curado: Record<string, { tipo: string }>, pm: Record<string, { tipo: string }>): Record<string, { tipo: string }> {
  return V.fusionarProductMap(curado, pm)
}

export { V as ventasPos }
