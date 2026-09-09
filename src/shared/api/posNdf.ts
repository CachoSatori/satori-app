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

/**
 * El rango de jornadas `[desde, hasta]` → la ventana de `fecha_registra` que hay que LEER.
 *
 * Es un SUPERSET a propósito, y por los dos lados:
 *
 * · +1 día al final — un lote de noche puede cerrar pasada la medianoche, así que la jornada
 *   `hasta` todavía tiene facturas al día siguiente. Sin este margen se perderían.
 *
 * · −1 día al principio — el que NO es obvio. La jornada de un lote es la fecha del PRIMER
 *   ticket del lote. Si el rango arranca justo después de que un turno cruzó la medianoche, y
 *   solo se leyera desde `desde`, se vería el pedazo de madrugada SIN su apertura: ese lote
 *   truncado calcularía su jornada como `desde` y se colaría en el día equivocado. Con el día
 *   de atrás, el lote entra completo, su jornada da el día anterior y el filtro lo descarta.
 *
 * Un margen de un día alcanza: un turno cierra a las horas, no a los días. Lo que sobra del
 * superset se descarta después por jornada, así que la ventana ancha no ensucia el resultado.
 */
export function ventanaRangoJornadas(desde: string, hasta: string): { desde: string; hasta: string } {
  const dia = (fecha: string, mas: number): string => {
    const [y, m, d] = fecha.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + mas)).toISOString().slice(0, 10)
  }
  return {
    desde: `${dia(desde, -1)}T00:00:00${CR_OFFSET}`,
    hasta: `${dia(hasta, 2)}T00:00:00${CR_OFFSET}`,
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
  /**
   * Cuándo cerró la caja el cajero. Junto con `cajero_login` forma el LOTE de cierre, que es
   * la unidad del turno y de la jornada (ver `shared/ndf/jornada.ts`).
   */
  fecha_cierra:      string | null
  /** `FAC_Facturas.Login`: el cajero que cobró. `111` mañana · `222` tarde. Define el turno. */
  cajero_login:      string | null
  canal:             string | null
  /**
   * Número de mesa del PoS. `null` en delivery y para llevar, que no tienen.
   *
   * Lo usa la lente de "mesa propia" para contar MESAS distintas y no confundirlas con
   * facturas: una mesa que pidió la cuenta en dos tandas son dos facturas y una sola mesa.
   */
  mesa:              string | null
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
  /**
   * El mesero que COMANDÓ esta línea (`FAC_FacturasDet.UsuarioRegistra`).
   *
   * Es lo que permite atribuir la venta por línea en vez de un mesero por ticket, y con eso las
   * facturas PARTIDAS (dos meseros en la misma factura). `null` en las 10 líneas del histórico
   * que el PoS no trae con usuario.
   */
  usuario_registra: string | null
}

/** El id se pide para poder atar cada línea a su ticket. */
export interface TicketNdfConId extends TicketNdfRow { id: string }

const COLS_TICKET =
  'id, numero_factura, fecha_registra, fecha_cierra, cajero_login, canal, mesa, salonero_login, registrado_por, turno, ' +
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

// ── Paginación: PostgREST corta en 1.000 filas SIN AVISAR ──────────────────────────────────
//
// Sin un `Range`, PostgREST devuelve su `max-rows` (1.000) y **no dice que hay más**: no hay
// error, no hay warning, no hay flag. La consulta parece haber traído todo. Es el mismo bug que
// ya se arregló en `getAllCashMovements` (`cash.paginado.test.ts`) y en `getAllVentasDias`
// (`ventas.limit.test.ts`), y acá pega fuerte: en staging hay **39.470 tickets y 221.639
// líneas**, así que un rango grande veía el 2,5% de los tickets y creía que ese era el día.
//
// El `.limit(n)` de las otras dos no alcanza acá: habría que adivinar un techo y volveríamos al
// mismo problema en cuanto la tabla lo pase. Se pagina con `.range()` hasta que no venga nada.
//
// ⚠️ EL ORDEN TIENE QUE SER TOTAL. `.range()` pagina por posición: si dos filas empatan en la
// clave de orden, el motor puede devolverlas en distinto orden en dos páginas distintas y la
// misma fila aparece dos veces (o ninguna). Por eso todas las consultas de acá desempatan por
// una columna ÚNICA (`id`), además de su orden natural.

/** Filas por viaje. Es el `max-rows` de PostgREST; pedir más no trae más. */
const TANDA_FILAS = 1000

/** Lo que devuelve una página de PostgREST, en lo mínimo que a este módulo le importa. */
type Pagina = PromiseLike<{ data: unknown; error: { message: string } | null }>

/**
 * Pide páginas y concatena, hasta que una vuelva con MENOS filas de las que se pidieron.
 *
 * "Menos de lo que pedí" = no hay más. Cuando el total es múltiplo exacto de `TANDA_FILAS`, la
 * última página vuelve vacía y cuesta un viaje de más; es el único caso.
 *
 * ⚠️ Esto asume que el servidor sirve las `TANDA_FILAS` completas. Vale porque el tope de
 * PostgREST acá está por arriba de 1.000: `getVentasHist`/`getAllVentasDias` piden
 * `.limit(5000)` y traen las 1.096 filas del histórico, que con un tope menor no pasaría. Si
 * algún día se baja `db_max_rows` por debajo de `TANDA_FILAS`, hay que bajar `TANDA_FILAS`
 * junto con él o esto vuelve a cortar callado.
 */
async function leerTodo<T>(pagina: (desde: number, hasta: number) => Pagina): Promise<T[]> {
  const out: T[] = []
  for (let desde = 0; ; desde += TANDA_FILAS) {
    const { data, error } = await pagina(desde, desde + TANDA_FILAS - 1)
    if (error) throw new Error(error.message)
    const filas = (data ?? []) as T[]
    out.push(...filas)
    if (filas.length < TANDA_FILAS) return out
  }
}

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
/**
 * Las facturas CERRADAS de un rango de JORNADAS, con el superset de `ventanaRangoJornadas`.
 *
 * Devuelve de más a propósito: el que llama agrupa por lote y se queda con las jornadas que
 * pedía. Filtrar acá por fecha sería imposible — la jornada de un ticket no se puede saber sin
 * ver el resto de su lote.
 *
 * `estado = 'C'` explícito: hoy la ingesta solo escribe cerradas, pero el CHECK de la 062
 * admite `X` y `R` para auditoría y un día podrían entrar.
 */
export async function getTicketsRango(
  local: string,
  rango: { desde: string; hasta: string },
): Promise<TicketNdfConId[]> {
  const v = ventanaRangoJornadas(rango.desde, rango.hasta)
  // Paginado: un mes de ventas pasa de 1.000 facturas y sin `.range()` se perdían en silencio.
  // El `id` desempata `fecha_registra` (dos facturas del mismo segundo son normales), que es lo
  // que hace que la paginación no repita ni saltee filas.
  return leerTodo<TicketNdfConId>((desde, hasta) => sb
    .from('pos_ndf_tickets')
    .select(COLS_TICKET)
    .eq('local', local)
    .eq('estado', 'C')
    .gte('fecha_registra', v.desde)
    .lt('fecha_registra', v.hasta)
    .order('fecha_registra', { ascending: true })
    .order('id', { ascending: true })
    .range(desde, hasta))
}

/**
 * Cuántos ids entran en un `IN (...)`. PostgREST los manda en la URL, así que una lista larga
 * (un mes de ventas son miles) la haría explotar por largo. Se pide por tandas y se concatena.
 */
const TANDA_IDS = 200

export async function getLineasDeTickets(ticketIds: string[]): Promise<LineaNdfRow[]> {
  if (ticketIds.length === 0) return []
  const out: LineaNdfRow[] = []
  for (let i = 0; i < ticketIds.length; i += TANDA_IDS) {
    const tanda = ticketIds.slice(i, i + TANDA_IDS)
    // DOS cortes distintos, por dos motivos distintos:
    //   · `TANDA_IDS` parte la lista de ids porque van en la URL y una lista larga la revienta.
    //   · `leerTodo` pagina las FILAS de cada tanda, porque 200 facturas son ~1.100 líneas
    //     (5,6 por factura en staging) y una sola tanda ya pasa el corte de PostgREST.
    // Sin lo segundo, cada tanda perdía sus líneas de más — callado.
    out.push(...await leerTodo<LineaNdfRow>((desde, hasta) => sb
      .from('pos_ndf_ticket_lines')
      .select('ticket_id, codigo_producto, nombre, cantidad, monto, familia, usuario_registra')
      .in('ticket_id', tanda)
      // `id` es la PK de la 062: orden TOTAL, que es lo que `.range()` necesita para no repetir
      // ni saltear. `ticket_id` primero solo para que las líneas de una factura salgan juntas.
      .order('ticket_id', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)))
  }
  return out
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

  // Paginado por el mismo motivo: un rango de varias jornadas pasa las 1.000 facturas y sin
  // esto el neto salía corto — con la pinta de un día flojo, no de una lectura incompleta.
  // El `id` va en el select SOLO para poder desempatar el orden; no se usa para nada más.
  const filas = await leerTodo<{ fecha_registra: string; valor_servido_crc: number | null }>(
    (d, h) => sb
      .from('pos_ndf_tickets')
      .select('id, fecha_registra, valor_servido_crc')
      .eq('local', local)
      .gte('fecha_registra', desde)
      .lt('fecha_registra', hasta)
      .order('fecha_registra', { ascending: true })
      .order('id', { ascending: true })
      .range(d, h))
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
 * mismo cliente destipado que las tablas `pos_ndf_*`.
 *
 * Esta es la **primera capa** de la resolución, no la única: es el mapeo que mantiene el
 * negocio y por eso manda. Lo que esta consulta no encuentre lo resuelve `nombreSalonero`
 * contra el roster `SALONEROS_CONOCIDOS`, y recién si tampoco está ahí el login sale marcado
 * «sin asignar». Un nombre NUNCA se inventa.
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

// ── Frescura del feed: ¿el agente sigue vivo? ──────────────────────────────────────────────

/**
 * Cuándo fue el último poll del agente contra el PoS (`pos_ndf_cursor.last_poll_at`).
 *
 * ⚠️ ES EL ÚNICO LATIDO QUE HAY. `pos_ndf_open.updated_at` NO sirve para esto: pese al nombre,
 * no es la frescura del snapshot sino la hora en que se ABRIÓ el pedido (el agente lo copia de
 * `FAC_Pedidos.FechaRegistra`, ver `pos-bridge/consultaAgente.ts`). El upsert lo reescribe en
 * cada poll, pero siempre con el MISMO valor, así que mirarlo no dice nada sobre si el agente
 * respira.
 *
 * Sin este dato «En vivo» puede mentir en silencio: si el agente se cae, `pos_ndf_open` conserva
 * el último snapshot para siempre y las mesas fantasma se siguen pintando como si fueran de ahora.
 *
 * `null` = todavía no hay fila de cursor para el local (el agente nunca corrió acá).
 */
export async function getUltimoPollPoS(local: string): Promise<string | null> {
  const { data, error } = await sb
    .from('pos_ndf_cursor')
    .select('last_poll_at')
    .eq('local', local)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return ((data ?? null) as { last_poll_at: string | null } | null)?.last_poll_at ?? null
}

// ── La llave de exclusión Hoy ↔ En vivo ────────────────────────────────────────────────────

/**
 * Los `numero_pedido` de las facturas YA CERRADAS de la jornada.
 *
 * Es la llave que evita el doble conteo: `pos_ndf_open.id_pedido` y
 * `pos_ndf_tickets.numero_pedido` salen los dos del mismo `FAC_Pedidos.NumeroPedido`, así que
 * una mesa que ya se cobró se reconoce por ahí y se saca del panel de abiertas.
 *
 * Hace falta porque el snapshot de abiertas no se limpia al instante: la Edge borra las claves
 * que no vinieron en el lote, y entre poll y poll pasan ~75 s. En esa ventana la misma mesa está
 * en las dos tablas.
 *
 * Va en su PROPIA consulta angosta en vez de sumar la columna a `COLS_TICKET`: ese SELECT lo
 * comparten las pestañas que leen meses de historia, y este campo solo lo necesita «En vivo».
 * Menos payload y, sobre todo, el camino de la plata no se toca.
 */
export async function getPedidosCerradosJornada(
  local: string,
  businessDate: string,
): Promise<Set<string>> {
  const { desde, hasta } = ventanaJornada(businessDate)
  const { data, error } = await sb
    .from('pos_ndf_tickets')
    .select('numero_pedido')
    .eq('local', local)
    .not('numero_pedido', 'is', null)
    .gte('fecha_registra', desde)
    .lt('fecha_registra', hasta)
  if (error) throw new Error(error.message)
  const out = new Set<string>()
  for (const r of (data ?? []) as unknown as { numero_pedido: string | null }[]) {
    const v = (r.numero_pedido ?? '').trim()
    if (v !== '') out.add(v)
  }
  return out
}
