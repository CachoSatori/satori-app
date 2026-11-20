// ─────────────────────────────────────────────────────────────────────────────────────────
//  Lectura del PoS para el detalle por día (R18: ventas SOLO del PoS, nunca `ventas_dias`).
//
//  Misma lectura que `monthly-report/ventasPos.ts` (PR #245, prod v23): con service_role,
//  `get_my_role()` es null y las funciones de la 067 devuelven 0 filas, así que se leen las tablas con
//  los MISMOS filtros (estado 'C', local, ventana de `fecha_registra` [desde, hasta) de las jornadas CR)
//  y las MISMAS columnas (`COLS_*_067`). El día lo arma el paquete (`armarDiasMap`, la lógica de la app).
//
//  Diferencia a propósito: NO se lee `employees`. Los nombres solo rotulan los buckets de cada mesero; los
//  totales del día no cambian (lo prueba `contrato.test.ts`). Menos datos personales en la función.
//  Testeable sin red: el cliente entra por parámetro. Orden total y fijo en cada lectura (R06).
// ─────────────────────────────────────────────────────────────────────────────────────────
// Módulo generado (JS): la forma la fija la prueba de contrato.
import * as V from './ventasPos.gen.js'

const PAGINA = 1000
const TANDA_IDS = 200
const EN_PARALELO = 4

export interface RangoDias { desde: string; hasta: string }
type Fila = Record<string, unknown>
type Error_ = { message?: string } | null | undefined
type Respuesta = { data: Fila[] | null; error: Error_ }
interface Consulta extends PromiseLike<Respuesta> {
  select(c: string): Consulta
  eq(c: string, v: unknown): Consulta
  gte(c: string, v: unknown): Consulta
  lt(c: string, v: unknown): Consulta
  in(c: string, v: unknown[]): Consulta
  order(c: string, o?: { ascending: boolean }): Consulta
  range(a: number, b: number): PromiseLike<Respuesta>
}
export type Cliente = { from: (t: string) => unknown }
const tabla = (sb: Cliente, t: string) => sb.from(t) as Consulta

function exigir(etapa: string, error: Error_): void {
  if (error) throw new Error(`lectura ${etapa}: ${error.message ?? 'error'}`)
}

async function leerTodo(etapa: string, consulta: (a: number, b: number) => PromiseLike<Respuesta>): Promise<Fila[]> {
  const out: Fila[] = []
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await consulta(i, i + PAGINA - 1)
    exigir(etapa, error)
    out.push(...(data ?? []))
    if (!data || data.length < PAGINA) return out
  }
}

export async function leerTickets(sb: Cliente, rango: RangoDias, local: string): Promise<Fila[]> {
  const v = V.ventanaRangoJornadas(rango.desde, rango.hasta)
  return leerTodo('pos_tickets', (a, b) => tabla(sb, 'pos_ndf_tickets')
    .select(V.COLS_TICKETS_067.join(','))
    .eq('local', local).eq('estado', 'C')
    .gte('fecha_registra', v.desde).lt('fecha_registra', v.hasta)
    .order('fecha_registra', { ascending: true }).order('id', { ascending: true })
    .range(a, b))
}

export async function leerLineas(sb: Cliente, ids: string[]): Promise<Fila[]> {
  const tandas: string[][] = []
  for (let i = 0; i < ids.length; i += TANDA_IDS) tandas.push(ids.slice(i, i + TANDA_IDS))
  const leer = (tanda: string[]) => leerTodo('pos_lineas', (a, b) => tabla(sb, 'pos_ndf_ticket_lines')
    .select(V.COLS_LINEAS_067.join(','))
    .in('ticket_id', tanda)
    .order('ticket_id', { ascending: true }).order('id', { ascending: true })
    .range(a, b))
  const out: Fila[] = []
  for (let i = 0; i < tandas.length; i += EN_PARALELO) {
    for (const filas of await Promise.all(tandas.slice(i, i + EN_PARALELO).map(leer))) out.push(...filas)
  }
  return out
}

/** El `DiasMap` del rango (jornadas CR), del PoS, con el MISMO armado que la app. Avisos de catálogo al log, sin números largos. */
export async function diasDelPos(sb: Cliente, rango: RangoDias, local: string): Promise<Record<string, unknown>> {
  const tickets = await leerTickets(sb, rango, local)
  if (tickets.length === 0) return {}
  const lineas = await leerLineas(sb, tickets.map(t => String(t.id)))
  const { dias } = V.armarDiasMap(tickets, lineas, rango, {
    uploadedAt: rango.hasta, nombres: {}, avisar: (m: string) => console.warn(m.replace(/\d{4,}/g, '#')),
  }) as { dias: Record<string, unknown> }
  return dias
}

export { V as logica }
