// Jornadas con ventas cerradas en el PoS, para la alerta de días sin cierre (solo lectura).
// Usa el mismo camino que el módulo Ventas: `pos_ventas_tickets_rango` (mig 067) y la jornada
// del LOTE de cierre (`agruparEnLotes`), no la fecha suelta de la factura (la de las 00:30 es
// de la jornada anterior). Sin acceso al PoS devuelve [] (como el RLS): la alerta sigue con
// las otras señales.
import { getTicketsRango } from './posNdf'
import { agruparEnLotes } from '../ndf/jornada'
import { LOCAL_POR_DEFECTO } from '../../modules/ventas/ventasDiasDesdePos'

export async function getJornadasConVentas(desde: string, hasta: string, local: string = LOCAL_POR_DEFECTO): Promise<string[]> {
  if (hasta < desde) return []
  const tickets = await getTicketsRango(local, { desde, hasta })
  const jornadas = new Set<string>()
  for (const lote of agruparEnLotes(tickets)) {
    if (lote.jornada && lote.jornada >= desde && lote.jornada <= hasta && lote.tickets.length > 0) jornadas.add(lote.jornada)
  }
  return [...jornadas].sort()
}
