import type { SupabaseClient } from '@supabase/supabase-js'

import { supabase } from './supabase'

// ╔══════════════════════════════════════════════════════════════════════════════════════╗
// ║ Lectura de las ventas del PoS "Nube de Fuego" (`pos_ndf_*`) — SOLO SELECT              ║
// ╚══════════════════════════════════════════════════════════════════════════════════════╝
//
// Las escribe el puente del PoS (Edge `ingest-ndf`, service-role). Desde la app son de SOLO
// LECTURA: la RLS de la mig 062 no tiene una sola policy de escritura, así que ni siquiera
// habría cómo. Acá no se calcula plata — los montos vienen ya resueltos de la ingesta.
//
// ── LA JORNADA NO ES EL DÍA CIVIL ──────────────────────────────────────────────────────────
// El corte es 07:00 → 07:00 hora de Costa Rica: lo que se factura a la 1 de la mañana pertenece
// al servicio de la noche anterior. En SQL la jornada de un ticket sería
//   ((fecha_registra at time zone 'America/Costa_Rica') - interval '7 hours')::date
// y acá se expresa como el rango equivalente sobre `fecha_registra` (timestamptz), que además
// usa el índice `pos_ndf_tickets (local, fecha_registra)` en vez de escanear la tabla.
//
// Costa Rica es UTC−6 FIJO (sin horario de verano): por eso el offset se escribe a mano y no
// se delega en la zona del navegador, que sería la del que mira la pantalla.

/** Offset de Costa Rica. Fijo, sin horario de verano. */
export const CR_OFFSET = '-06:00'

/** Hora a la que arranca y termina la jornada de servicio. */
export const HORA_CORTE_JORNADA = 7

/** `'2026-09-01'` → el rango `[inicio, fin)` de esa jornada, en instantes con zona. */
export function ventanaJornada(businessDate: string): { desde: string; hasta: string } {
  const [y, m, d] = businessDate.split('-').map(Number)
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  const hh = String(HORA_CORTE_JORNADA).padStart(2, '0')
  return {
    desde: `${businessDate}T${hh}:00:00${CR_OFFSET}`,
    hasta: `${siguiente}T${hh}:00:00${CR_OFFSET}`,
  }
}

/** El instante de un ticket → a qué jornada pertenece. Inversa de `ventanaJornada`. */
export function businessDateDe(fechaRegistra: string): string {
  const t = Date.parse(fechaRegistra)
  if (Number.isNaN(t)) return ''
  // A hora de pared CR y después se le restan las 7 h del corte.
  const cr = new Date(t - 6 * 3_600_000 - HORA_CORTE_JORNADA * 3_600_000)
  return cr.toISOString().slice(0, 10)
}

// ── Filas ──────────────────────────────────────────────────────────────────────────────────
// Escritas a mano a propósito: `supabase.gen.ts` se generó antes de las migs 062/063 y todavía
// no conoce estas tablas. Regenerarlo necesita acceso a la base; hasta entonces el cast del
// cliente (abajo) es el único punto sin tipar, y lo que sale de acá SÍ está tipado.

export interface TicketNdfRow {
  numero_factura:    string
  fecha_registra:    string
  /** Cuándo se COBRÓ la cuenta. Define el turno. Hoy viene NULL: el extractor no la trae. */
  fecha_cierra:      string | null
  canal:             string | null
  salonero_login:    string | null
  registrado_por:    string
  turno:             string | null
  con_servicio:      boolean
  servicio_crc:      number | null
  total_crc:         number | null
  valor_servido_crc: number | null
  iva_crc:           number | null
  regalia_crc:       number | null
  descuento_crc:     number | null
  clase_ingreso:     string | null
  pax:               number | null
  pax_nativo:        number | null
  pax_articulo:      number | null
  pax_alerta:        string | null
}

export interface LineaNdfRow {
  ticket_id:       string
  codigo_producto: string | null
  nombre:          string | null
  cantidad:        number | null
  monto:           number | null
  familia:         number | null
}

/** El id se pide para poder atar cada línea a su ticket. */
export interface TicketNdfConId extends TicketNdfRow { id: string }

const COLS_TICKET =
  'id, numero_factura, fecha_registra, fecha_cierra, canal, salonero_login, registrado_por, turno, ' +
  'con_servicio, servicio_crc, total_crc, valor_servido_crc, iva_crc, regalia_crc, ' +
  'descuento_crc, clase_ingreso, pax, pax_nativo, pax_articulo, pax_alerta'

/**
 * El cliente tipado con `Database` todavía no conoce `pos_ndf_*` (ver arriba), así que acá se
 * lo toma con su tipo genérico. Es el ÚNICO punto sin el esquema generado, está en el borde de
 * I/O, y lo que sale de estas funciones vuelve a estar tipado con las interfaces de arriba.
 *
 * El arreglo de fondo es regenerar `supabase.gen.ts` con las migs 062/063 ya aplicadas — hace
 * falta acceso a la base, así que se hace del lado de Ismael.
 */
const sb = supabase as unknown as SupabaseClient

/** Las facturas de UNA jornada de un local, en orden cronológico. */
export async function getTicketsJornada(local: string, businessDate: string): Promise<TicketNdfConId[]> {
  const { desde, hasta } = ventanaJornada(businessDate)
  const { data, error } = await sb
    .from('pos_ndf_tickets')
    .select(COLS_TICKET)
    .eq('local', local)
    .gte('fecha_registra', desde)
    .lt('fecha_registra', hasta)
    .order('fecha_registra', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as TicketNdfConId[]
}

/** El detalle de esas facturas. Sin tickets no se hace la consulta. */
export async function getLineasDeTickets(ticketIds: string[]): Promise<LineaNdfRow[]> {
  if (ticketIds.length === 0) return []
  const { data, error } = await sb
    .from('pos_ndf_ticket_lines')
    .select('ticket_id, codigo_producto, nombre, cantidad, monto, familia')
    .in('ticket_id', ticketIds)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as LineaNdfRow[]
}

/**
 * El NETO de varias jornadas de una sola consulta, para la comparativa.
 *
 * Se pide el rango completo (de la jornada más vieja a la más nueva) y se reparte por jornada
 * acá: son cinco fechas sueltas y traer cinco rangos serían cinco viajes.
 */
export async function getNetoPorJornada(
  local: string,
  businessDates: string[],
): Promise<Record<string, number>> {
  if (businessDates.length === 0) return {}
  const ordenadas = [...businessDates].sort()
  const { desde } = ventanaJornada(ordenadas[0])
  const { hasta } = ventanaJornada(ordenadas[ordenadas.length - 1])

  const { data, error } = await sb
    .from('pos_ndf_tickets')
    .select('fecha_registra, valor_servido_crc')
    .eq('local', local)
    .gte('fecha_registra', desde)
    .lt('fecha_registra', hasta)
    .order('fecha_registra', { ascending: true })
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as { fecha_registra: string; valor_servido_crc: number | null }[]
  const out: Record<string, number> = {}
  for (const f of businessDates) out[f] = 0
  for (const r of filas) {
    const j = businessDateDe(r.fecha_registra)
    if (j in out) out[j] += Number(r.valor_servido_crc ?? 0)
  }
  return out
}

// ── Mesas abiertas (snapshot del PoS, "ahora") ─────────────────────────────────────────────

export interface MesaAbiertaRow {
  clave:          string
  numero_factura: string | null
  id_pedido:      string | null
  mesa:           string | null
  salonero_login: string | null
  canal:          string | null
  pax:            number | null
  pax_alerta:     string | null
  updated_at:     string
}

/**
 * Lo que está abierto AHORA en el local. No lleva filtro de fecha porque no es historial: el
 * agente pisa la tabla entera en cada poll y borra la mesa que se cerró. Por eso solo tiene
 * sentido mirarla cuando se está viendo el día en curso.
 */
export async function getMesasAbiertas(local: string): Promise<MesaAbiertaRow[]> {
  const { data, error } = await sb
    .from('pos_ndf_open')
    .select('clave, numero_factura, id_pedido, mesa, salonero_login, canal, pax, pax_alerta, updated_at')
    .eq('local', local)
    .order('updated_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as MesaAbiertaRow[]
}

// ── Saloneros: el login del PoS → la persona ───────────────────────────────────────────────

/**
 * `employees.pos_login` → `full_name`. Es el puente que convierte un «026» en «MAXO», el mismo
 * rol que cumple `biotime_emp_code` para el reloj.
 *
 * `pos_login` la agregó la mig 062 y todavía no está en `supabase.gen.ts`, así que va por el
 * mismo cliente destipado que las tablas `pos_ndf_*`. Un login sin cargar en Empleados NO se
 * inventa: la pantalla lo muestra con el número y marcado «sin asignar».
 */
export async function getSaloneroNombres(): Promise<Record<string, string>> {
  const { data, error } = await sb
    .from('employees')
    .select('pos_login, full_name')
    .not('pos_login', 'is', null)
  if (error) throw new Error(error.message)
  const out: Record<string, string> = {}
  for (const e of (data ?? []) as unknown as { pos_login: string | null; full_name: string | null }[]) {
    const login = (e.pos_login ?? '').trim()
    const nombre = (e.full_name ?? '').trim()
    if (login && nombre) out[login] = nombre
  }
  return out
}
