// ── El adaptador: `pos_ndf_*` → `DiasMap` (P1b) ────────────────────────────────────────────
//
// Arma el `DiasMap` de los días CERRADOS desde las ventas del PoS, con la MISMA forma que
// produce el import del .xls — el `DiaData` que ya consumen Hoy, Mix, Saloneros y compañía.
// Nadie aguas abajo tiene que enterarse de dónde salió el día.
//
// ── LO QUE ESTE ARCHIVO NO HACE ────────────────────────────────────────────────────────────
// · NO reimplementa agregadores: el día lo arma `armarDia`, el mismo que usa «En vivo». Si
//   algún día el neto o el mix cambian de definición, cambian en un solo lugar.
// · El DÍA del reporte es el día en Costa Rica de la FACTURA (`fecha_registra`), no la jornada
//   del lote de cierre. Es el corte del reporte del PoS («Ventas por Salón»): con el lote, una
//   caja que se cerró al día siguiente (corte de luz del 10-oct-2026) arrastraba facturas de un
//   día al otro. `shared/ndf/jornada.ts` NO se toca: el lote sigue mandando en «En vivo», en los
//   turnos y en las lentes de saloneros; solo dejó de decidir el día de Ventas/Contabilidad.
// · NO cambia de dónde lee `VentasModule` — eso es P2. Acá solo se ofrece la función.
// · NO toca `ventas_dias` ni `ventas_hist`: son OTRAS tablas, con su propia carga por xls.
//   Acá solo se DERIVA la misma forma desde el PoS, sin escribir nada en ningún lado.

import { getLineasDeTickets, getSaloneroNombres, getTicketsRango,
         type LineaNdfRow, type TicketNdfConId } from '../../shared/api/posNdf'
import { fechaCR } from '../../shared/ndf/jornada'
import type { DiaData, DiasMap, HistDay, HistMap, ProductMap } from '../../shared/types/ventas'
import { armarDia } from './ventasEnVivoDatos'
import { getDayStats } from './ventasUtils'
import { resumirAvisos, type AvisoCatalogo } from './netaVenta'

/** Un rango de JORNADAS, inclusivo de los dos lados. `YYYY-MM-DD`. */
export interface RangoJornadas {
  desde: string
  hasta: string
}

export const LOCAL_POR_DEFECTO = 'santa-teresa'

/**
 * Los días del PoS + el `ProductMap` que sale de la FAMILIA de cada línea.
 *
 * El `pm` viaja junto a los días porque `armarDia` YA lo construye mientras recorre las
 * líneas (`ventasEnVivoDatos.ts:207-212`) — antes se descartaba acá y las pantallas se
 * quedaban con el `product_map` curado a mano, que no conoce los nombres del PoS. Es la
 * clasificación que hace correcto al mix de «En vivo»; ahora también llega a las demás.
 */
export interface DiasDesdePos {
  dias: DiasMap
  /** Solo productos de `FAMILIAS_NETO`: comida y bebida. Merch, cortesías y pax no están. */
  pm:   ProductMap
}

/** `'2026-09-04' <= f <= '2026-09-06'`. Comparación de strings: `YYYY-MM-DD` ordena solo. */
function dentro(fecha: string | null, r: RangoJornadas): fecha is string {
  return fecha !== null && fecha >= r.desde && fecha <= r.hasta
}

/**
 * El día del reporte de un ticket: `(fecha_registra AT TIME ZONE 'America/Costa_Rica')::date`.
 * `null` si el instante no se puede leer (ese ticket no entra a ningún día).
 */
export function diaDeFactura(t: Pick<TicketNdfConId, 'fecha_registra'>): string | null {
  return fechaCR(t.fecha_registra)
}

/**
 * El corazón, PURO: tickets + líneas → `DiasMap`. Se prueba sin base de datos.
 *
 * Los tickets vienen del superset de `ventanaRangoJornadas` (un día antes, dos después), así
 * que hay de más: los que caen fuera de `[desde, hasta]` por su día de factura se descartan acá.
 */
export function armarDiasMap(
  tickets: TicketNdfConId[],
  lineas: LineaNdfRow[],
  rango: RangoJornadas,
  opciones: { uploadedAt: string; nombres?: Record<string, string>; avisar?: (msg: string) => void },
): DiasDesdePos {
  // 1. Cada factura va al día CR de su `fecha_registra` (ver el encabezado).
  const porJornada = new Map<string, TicketNdfConId[]>()
  for (const t of tickets) {
    const dia = diaDeFactura(t)
    if (!dentro(dia, rango)) continue
    const lista = porJornada.get(dia)
    if (lista) lista.push(t)
    else porJornada.set(dia, [t])
  }

  // 2. Las líneas, indexadas una sola vez para no barrer el array por cada día.
  const lineasPorTicket = new Map<string, LineaNdfRow[]>()
  for (const l of lineas) {
    const lista = lineasPorTicket.get(l.ticket_id)
    if (lista) lista.push(l)
    else lineasPorTicket.set(l.ticket_id, [l])
  }

  // 3. Un `DiaData` por jornada, con el MISMO armador que «En vivo». El `pm` por familia que
  //    ese armador ya calcula se acumula en vez de tirarse: un producto vale lo mismo en
  //    cualquier jornada, así que el primer día que lo vea define su tipo.
  const dias: DiasMap = {}
  const pm: ProductMap = {}
  const avisos: AvisoCatalogo[] = []
  for (const [jornada, delDia] of [...porJornada.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const suyas = delDia.flatMap(t => lineasPorTicket.get(t.id) ?? [])
    const armado = armarDia(jornada, delDia, suyas, opciones.uploadedAt, opciones.nombres ?? {})
    dias[jornada] = armado.dia
    avisos.push(...armado.avisosCatalogo)
    for (const [nombre, info] of Object.entries(armado.pm)) if (!pm[nombre]) pm[nombre] = info
  }
  // Huecos de catálogo: la plata YA cuenta en la neta; el aviso es para ir a corregir el PoS.
  if (avisos.length > 0) {
    (opciones.avisar ?? console.warn)(
      `[ventas] neta ${rango.desde}→${rango.hasta}: líneas con plata fuera del catálogo — ${resumirAvisos(avisos)}`)
  }
  return { dias, pm }
}

/**
 * El `DiasMap` de un rango de días, leído del PoS.
 *
 * `rango` es inclusivo de los dos lados y va en días de FACTURA (fecha CR de `fecha_registra`),
 * el mismo corte que el reporte del PoS: la factura de las 00:30 es del día siguiente.
 */
export async function getDiasMapDesdePos(
  rango: RangoJornadas,
  local: string = LOCAL_POR_DEFECTO,
): Promise<DiasDesdePos> {
  const tickets = await getTicketsRango(local, rango)
  if (tickets.length === 0) return { dias: {}, pm: {} }

  const lineas  = await getLineasDeTickets(tickets.map(t => t.id))
  const nombres = await getSaloneroNombres()

  // `uploadedAt` es la marca de "cuándo se armó esta vista", como el `uploadedAt` del .xls.
  // La jornada más nueva del rango sirve de sello estable: dos llamadas iguales dan lo mismo.
  return armarDiasMap(tickets, lineas, rango, { uploadedAt: rango.hasta, nombres })
}


// ── El histórico: `pos_ndf_*` → `HistMap` (P1c) ─────────────────────────────────────────────
//
// `HistDay` es el RESUMEN por día que hoy sale de `ventas_hist` (1096 días, 2023-2025) y que
// consumen Histórico, Mix, Análisis, Contabilidad, Calendario, ReporteMensual y Metas por el
// prop `hist`. Acá se deriva la MISMA forma desde el PoS.
//
// La clave de que esto no invente nada: `getDayStats` —la función que ya usa toda la app para
// resumir un `DiaData`— devuelve EXACTAMENTE los ocho números de `HistDay`. Así que la
// proyección es un re-shape, no un cálculo: se le sacan `fecha` y `saloneroNames`, se le pone
// `source`, y listo. Si mañana cambia la definición de `ventaBruta` o de `promPax`, cambia en
// `getDayStats` y estas dos vistas se mueven juntas.
//
// ⚠️ `promPax` es `salon / pax`, NO `ventaNeta / pax`. Es la definición que ya tiene la app y
// se respeta tal cual: acá no se corrige nada, se proyecta.

/**
 * `source` SIEMPRE `'hist'`.
 *
 * No es un valor elegido a ojo: en `HistDay` el campo es el literal `'hist'` (no una unión),
 * y ningún consumidor lo ramifica —se buscó: nadie hace `if (d.source === …)` sobre un
 * `HistDay`—. Inventar un `'pos'` rompería el tipo y no le serviría a nadie. Que el día venga
 * del PoS o del xls se sabe por de dónde se pidió el `HistMap`, no por dentro de la fila.
 */
const SOURCE_HIST = 'hist' as const

/** Un `DiaData` → su `HistDay`. Puro re-shape de `getDayStats`. */
export function aHistDay(dia: DiaData): HistDay {
  const s = getDayStats(dia)
  return {
    ventaBruta: s.ventaBruta,
    ventaNeta:  s.ventaNeta,
    iva:        s.iva,
    serv:       s.serv,
    salon:      s.salon,
    delivery:   s.delivery,
    pax:        s.pax,
    promPax:    s.promPax,
    source:     SOURCE_HIST,
  }
}

/** Un `DiasMap` → su `HistMap`, jornada por jornada. PURO: se prueba sin base de datos. */
export function aHistMap(dias: DiasMap): HistMap {
  const hist: HistMap = {}
  for (const [jornada, dia] of Object.entries(dias)) hist[jornada] = aHistDay(dia)
  return hist
}

/**
 * El `HistMap` de un rango de jornadas, leído del PoS.
 *
 * Se apoya en `getDiasMapDesdePos` (P1b) en vez de volver a leer la base con otro criterio:
 * una sola lectura, la MISMA jornada por lote de cierre, el mismo local, y el histórico sale
 * de proyectar lo mismo que ya se armó. Que las dos vistas no puedan discrepar es el punto.
 */
export async function getHistDesdePos(
  rango: RangoJornadas,
  local: string = LOCAL_POR_DEFECTO,
): Promise<HistMap> {
  return aHistMap((await getDiasMapDesdePos(rango, local)).dias)
}
