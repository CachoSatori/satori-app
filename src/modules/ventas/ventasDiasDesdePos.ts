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
// · NO toca `ventas_dias` ni el histórico (`getHistDesdePos` es P1c).

import { getLineasDeTickets, getSaloneroNombres, getTicketsRango,
         type LineaNdfRow, type TicketNdfConId } from '../../shared/api/posNdf'
import { agruparEnLotes } from '../../shared/ndf/jornada'
import type { DiasMap } from '../../shared/types/ventas'
import { armarDia } from './ventasEnVivoDatos'

/** Un rango de JORNADAS, inclusivo de los dos lados. `YYYY-MM-DD`. */
export interface RangoJornadas {
  desde: string
  hasta: string
}

export const LOCAL_POR_DEFECTO = 'santa-teresa'

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
): DiasMap {
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

  // 3. Un `DiaData` por jornada, con el MISMO armador que «En vivo».
  const dias: DiasMap = {}
  for (const [jornada, delDia] of [...porJornada.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const suyas = delDia.flatMap(t => lineasPorTicket.get(t.id) ?? [])
    dias[jornada] = armarDia(jornada, delDia, suyas, opciones.uploadedAt, opciones.nombres ?? {}).dia
  }
  return dias
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
): Promise<DiasMap> {
  const tickets = await getTicketsRango(local, rango)
  if (tickets.length === 0) return {}

  const lineas  = await getLineasDeTickets(tickets.map(t => t.id))
  const nombres = await getSaloneroNombres()

  // `uploadedAt` es la marca de "cuándo se armó esta vista", como el `uploadedAt` del .xls.
  // La jornada más nueva del rango sirve de sello estable: dos llamadas iguales dan lo mismo.
  return armarDiasMap(tickets, lineas, rango, { uploadedAt: rango.hasta, nombres })
}
