// ── La capa de I/O de las dos lentes (Parte B, paso 4) ─────────────────────────────────────
//
// Lee del PoS y llama al módulo puro. Acá NO se calcula plata: todo el cálculo vive en
// `saloneroLentes.ts`, que se prueba sin base de datos. Lo único que hace este archivo es
// traer las filas y quedarse con las jornadas pedidas.
//
// SOLO LECTURA. Las tres funciones que usa son SELECT; no hay ni una escritura.

import {
  getLineasDeTickets, getSaloneroNombres, getTicketsRango,
  type LineaNdfRow, type TicketNdfConId,
} from '../../shared/api/posNdf'
import { agruparEnLotes } from '../../shared/ndf/jornada'
import { calcularLentes, type LentesSaloneros } from './saloneroLentes'
import { LOCAL_POR_DEFECTO, type RangoJornadas } from './ventasDiasDesdePos'

export type { RangoJornadas }
export { LOCAL_POR_DEFECTO }

export interface LentesConNombres {
  lentes:  LentesSaloneros
  /** `pos_login → full_name` de `employees` (roster completo, incluidos los inactivos). */
  nombres: Record<string, string>
  /** Cuántas facturas quedaron dentro del rango de jornadas, después de descartar el superset. */
  tickets: number
}

/**
 * Se queda con los tickets cuyo LOTE cae en el rango de jornadas.
 *
 * `getTicketsRango` trae de más a propósito (ver `ventanaRangoJornadas`): lotes que abrieron
 * antes de `desde` o cerraron después de `hasta` entran para poder calcularles bien la jornada.
 * Primero se agrupa y RECIÉN DESPUÉS se filtra — la jornada de una factura no se puede saber
 * sin ver el resto de su lote.
 */
export function filtrarPorJornada(
  tickets: readonly TicketNdfConId[],
  rango: RangoJornadas,
): TicketNdfConId[] {
  const out: TicketNdfConId[] = []
  for (const lote of agruparEnLotes(tickets)) {
    if (lote.jornada !== null && lote.jornada >= rango.desde && lote.jornada <= rango.hasta) {
      out.push(...lote.tickets)
    }
  }
  return out
}

/** El corazón, PURO: tickets del superset + líneas → las dos lentes del rango. */
export function armarLentes(
  tickets: readonly TicketNdfConId[],
  lineas: readonly LineaNdfRow[],
  rango: RangoJornadas,
): { lentes: LentesSaloneros; tickets: number } {
  const delRango = filtrarPorJornada(tickets, rango)
  // Las líneas van enteras a propósito: `calcularLentes` recorre las FACTURAS y busca las líneas
  // de cada una, así que las de los tickets que quedaron afuera del rango no se visitan nunca.
  // Filtrarlas acá sería recorrer el arreglo entero para nada.
  return { lentes: calcularLentes(delRango, lineas), tickets: delRango.length }
}

/**
 * Las dos lentes de un rango de JORNADAS, leídas del PoS.
 *
 * El rango es inclusivo de los dos lados y va en jornadas, no en días civiles: el turno que
 * cierra a la 01:00 sigue contando en el día que abrió (ver `shared/ndf/jornada.ts`).
 */
export async function getLentesDesdePos(
  rango: RangoJornadas,
  local: string = LOCAL_POR_DEFECTO,
): Promise<LentesConNombres> {
  const tickets = await getTicketsRango(local, rango)
  if (tickets.length === 0) {
    return { ...armarLentes([], [], rango), nombres: {} }
  }
  const [lineas, nombres] = await Promise.all([
    getLineasDeTickets(tickets.map(t => t.id)),
    getSaloneroNombres(),
  ])
  return { ...armarLentes(tickets, lineas, rango), nombres }
}
