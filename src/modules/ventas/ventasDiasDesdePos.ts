// ── El adaptador: `pos_ndf_*` → `DiasMap` (P1b) ────────────────────────────────────────────
//
// Arma el `DiasMap` de los días CERRADOS desde las ventas del PoS, con la MISMA forma que
// produce el import del .xls — el `DiaData` que ya consumen Hoy, Mix, Saloneros y compañía.
// Nadie aguas abajo tiene que enterarse de dónde salió el día.
//
// ── LO QUE ESTE ARCHIVO NO HACE ────────────────────────────────────────────────────────────
// · NO reimplementa agregadores: el día lo arma `armarDia`, el mismo que usa «En vivo». Si
//   algún día el neto o el mix cambian de definición, cambian en un solo lugar.
// · NO decide la jornada por su cuenta: la decide `shared/ndf/jornada.ts` (P1a), que también
//   usa «En vivo». Las dos pantallas no pueden discrepar porque leen la misma función.
// · NO cambia de dónde lee `VentasModule` — eso es P2. Acá solo se ofrece la función.
// · NO toca `ventas_dias` ni `ventas_hist`: son OTRAS tablas, con su propia carga por xls.
//   Acá solo se DERIVA la misma forma desde el PoS, sin escribir nada en ningún lado.

import { getLineasDeTickets, getSaloneroNombres, getTicketsRango,
         type LineaNdfRow, type TicketNdfConId } from '../../shared/api/posNdf'
import { agruparEnLotes } from '../../shared/ndf/jornada'
import type { DiaData, DiasMap, HistDay, HistMap, ProductMap } from '../../shared/types/ventas'
import { armarDia } from './ventasEnVivoDatos'
import { getDayStats } from './ventasUtils'

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
 * El corazón, PURO: tickets + líneas → `DiasMap`. Se prueba sin base de datos.
 *
 * Los tickets vienen del superset de `ventanaRangoJornadas`, así que hay de más: lotes que
 * abrieron antes de `desde` o después de `hasta` entran para poder calcular bien su jornada, y
 * se descartan acá. Es el orden correcto — la jornada de un ticket NO se puede saber sin ver
 * el resto de su lote, así que primero se agrupa y recién después se filtra.
 */
export function armarDiasMap(
  tickets: TicketNdfConId[],
  lineas: LineaNdfRow[],
  rango: RangoJornadas,
  opciones: { uploadedAt: string; nombres?: Record<string, string> },
): DiasDesdePos {
  // 1. Cada lote de cierre aporta su jornada; los tickets del lote la heredan enteros.
  const porJornada = new Map<string, TicketNdfConId[]>()
  for (const lote of agruparEnLotes(tickets)) {
    if (!dentro(lote.jornada, rango)) continue
    const lista = porJornada.get(lote.jornada)
    if (lista) lista.push(...lote.tickets)
    else porJornada.set(lote.jornada, [...lote.tickets])
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
  for (const [jornada, delDia] of [...porJornada.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const suyas = delDia.flatMap(t => lineasPorTicket.get(t.id) ?? [])
    const armado = armarDia(jornada, delDia, suyas, opciones.uploadedAt, opciones.nombres ?? {})
    dias[jornada] = armado.dia
    for (const [nombre, info] of Object.entries(armado.pm)) if (!pm[nombre]) pm[nombre] = info
  }
  return { dias, pm }
}

/**
 * El `DiasMap` de un rango de jornadas, leído del PoS.
 *
 * `rango` es inclusivo de los dos lados y va en JORNADAS, no en días civiles: la jornada de un
 * lote es la fecha en Costa Rica de su apertura, así que el turno que cierra a la 01:00 sigue
 * contando en el día que abrió (ver `shared/ndf/jornada.ts`).
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
