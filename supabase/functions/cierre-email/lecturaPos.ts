// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Lectura del PoS para el resumen de ventas del cierre (R18: ventas SOLO del PoS, nunca `ventas_dias`).
//
//  Se lee con service_role (opción B, firmada por el dueño 18-nov 05:49 CR): el que confirma el cierre es
//  el CAJERO, que no lee el PoS (regla 6), y no se abren permisos. Por eso esta lectura:
//    · corre SOLO después de que el cierre se releyó con el JWT del usuario (RLS = portón, index.ts) y
//      pasó la guarda de 36 h (resumen.ts);
//    · lee SOLO la ventana de UNA jornada (`ventanaRangoJornadas(dia, dia)`: un día antes y dos después,
//      para no partir lotes de caja), con las MISMAS columnas que devuelven las funciones de la 067
//      (`COLS_*_067`), sin medios de pago ni `clase_ingreso`;
//    · lee de `employees` SOLO el nombre de los logins destacados (máximo 2).
//  Con service_role `get_my_role()` es null y las funciones de la 067 devuelven 0 filas: por eso se leen
//  las tablas con los mismos filtros (estado 'C', local, ventana de `fecha_registra`), como
//  `monthly-report` (#245) y `ventas-dia-contador` (#276). Orden total y fijo (R06).
//  Testeable sin red: el cliente entra por parámetro.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Módulo generado (JS): la forma la fija la prueba de contrato.
import * as V from './ventasPos.gen.js'

const PAGINA = 1000
const TANDA_IDS = 200

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

/** Tickets cerrados y sus líneas de la ventana de UNA jornada. */
export async function leerVentanaJornada(sb: Cliente, dia: string, local: string): Promise<{ tickets: Fila[]; lineas: Fila[] }> {
  const v = V.ventanaRangoJornadas(dia, dia)
  const tickets = await leerTodo('pos_tickets', (a, b) => tabla(sb, 'pos_ndf_tickets')
    .select(V.COLS_TICKETS_067.join(','))
    .eq('local', local).eq('estado', 'C')
    .gte('fecha_registra', v.desde).lt('fecha_registra', v.hasta)
    .order('fecha_registra', { ascending: true }).order('id', { ascending: true })
    .range(a, b))
  const ids = tickets.map(t => String(t.id))
  const lineas: Fila[] = []
  for (let i = 0; i < ids.length; i += TANDA_IDS) {
    const tanda = ids.slice(i, i + TANDA_IDS)
    lineas.push(...await leerTodo('pos_lineas', (a, b) => tabla(sb, 'pos_ndf_ticket_lines')
      .select(V.COLS_LINEAS_067.join(','))
      .in('ticket_id', tanda)
      .order('ticket_id', { ascending: true }).order('id', { ascending: true })
      .range(a, b)))
  }
  return { tickets, lineas }
}

/** Nombre (employees.full_name) de los logins pedidos. Lo que no esté, no viene. */
export async function leerNombres(sb: Cliente, logins: string[]): Promise<Record<string, string>> {
  if (logins.length === 0) return {}
  const filas = await leerTodo('nombres', (a, b) => tabla(sb, 'employees')
    .select('pos_login,full_name')
    .in('pos_login', logins)
    .order('pos_login', { ascending: true })
    .range(a, b))
  const out: Record<string, string> = {}
  for (const f of filas) {
    const login = String(f.pos_login ?? '').trim(), nombre = String(f.full_name ?? '').trim()
    if (login && nombre && !out[login]) out[login] = nombre
  }
  return out
}

export { V as logica }
