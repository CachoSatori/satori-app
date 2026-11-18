// ── Ventas v2 · «Resumen»: la lectura del PoS ──────────────────────────────────────────────────
//
// SOLO LECTURA, por las funciones de la 067 (`pos_ventas_tickets_rango`, `pos_ventas_lineas`), las
// mismas que arman Contabilidad (regla 6 de ESTADO). No lee `ventas_dias` ni `ventas_hist`.
//
// Se lee UNA vez lo que piden el período, las tres bases y «ayer» (la alerta), cada uno estirado
// hacia atrás lo que necesita el estimador de personas (`rangoDeLecturaParaEstimar`), con los
// tramos que se tocan juntados en uno. Lo leído queda en memoria por local y tramo: cambiar de base
// o volver a un período ya visto no vuelve a la base.
//
// ⚠️ Un período largo (año a la fecha, temporada) son decenas de miles de líneas y tarda segundos.
// Bajarlo a ≤ 3 pedidos necesita una función agregada nueva en la base (migración): queda como
// decisión del dueño en el PR de la fase 2.1, no se hace acá.

import { supabase } from '../../shared/api/supabase'
import { getLineasDeTickets, getSaloneroNombres, getTicketsRango,
  type LineaNdfRow, type TicketVentaRow } from '../../shared/api/posNdf'
import { rangoDeLecturaParaEstimar } from './indicadores'
import { sumarDias, type PeriodoV2, type Rango } from './periodos'
import { armarLectura, type Lectura } from './resumenV2'
import { PRIMERA_JORNADA_POS } from './ventasFuente'

/** Los rangos que hay que leer para un período: él, sus tres bases y ayer, estirados y juntados. */
export function tramosDeLectura(p: PeriodoV2): Rango[] {
  const pedidos: Rango[] = [{ desde: p.desde, hasta: p.hasta }, { desde: p.N, hasta: p.N }]
  for (const b of Object.values(p.bases)) if (b) pedidos.push({ desde: b.desde, hasta: b.hasta })
  const estirados = pedidos
    .map(rangoDeLecturaParaEstimar)
    .map(r => ({ desde: r.desde < PRIMERA_JORNADA_POS ? PRIMERA_JORNADA_POS : r.desde, hasta: r.hasta }))
    .filter(r => r.desde <= r.hasta)
    .sort((a, b) => a.desde.localeCompare(b.desde))
  const out: Rango[] = []
  for (const r of estirados) {
    const ult = out[out.length - 1]
    if (ult && r.desde <= sumarDias(ult.hasta, 1)) { if (r.hasta > ult.hasta) ult.hasta = r.hasta }
    else out.push({ ...r })
  }
  return out
}

const cache = new Map<string, Promise<{ tickets: TicketVentaRow[]; lineas: LineaNdfRow[] }>>()

/** Para las pruebas. */
export function limpiarCacheResumen(): void { cache.clear() }

function leerTramo(local: string, r: Rango) {
  const k = `${local}|${r.desde}|${r.hasta}`
  let p = cache.get(k)
  if (!p) {
    p = (async () => {
      const tickets = await getTicketsRango(local, r)
      const lineas = tickets.length > 0 ? await getLineasDeTickets(tickets.map(t => t.id)) : []
      return { tickets, lineas }
    })()
    p.catch(() => cache.delete(k))
    cache.set(k, p)
  }
  return p
}

/**
 * Junta los tramos sin repetir: los tramos traen un superset (un día antes, dos después), así que una
 * factura puede venir en dos. Sus líneas se toman UNA vez, del primer tramo que la trajo.
 */
export function juntarPartes(
  partes: readonly { tickets: readonly TicketVentaRow[]; lineas: readonly LineaNdfRow[] }[],
): [TicketVentaRow[], LineaNdfRow[]] {
  const tickets = new Map<string, TicketVentaRow>()
  const lineas: LineaNdfRow[] = []
  for (const parte of partes) {
    const nuevos = new Set<string>()
    for (const t of parte.tickets) if (!tickets.has(t.id)) { tickets.set(t.id, t); nuevos.add(t.id) }
    for (const l of parte.lineas) if (nuevos.has(l.ticket_id)) lineas.push(l)
  }
  return [[...tickets.values()], lineas]
}

/** Todo lo que el Resumen necesita para un período, sin facturas repetidas entre tramos. */
export async function cargarLecturaResumen(local: string, p: PeriodoV2): Promise<Lectura> {
  const [partes, nombres] = await Promise.all([
    Promise.all(tramosDeLectura(p).map(r => leerTramo(local, r))),
    getSaloneroNombres().catch(() => ({} as Record<string, string>)),
  ])
  return armarLectura(...juntarPartes(partes), nombres)
}

export interface LocalVentas { id: string; nombre: string }

/**
 * Los locales que el usuario puede elegir en la barra: los activos de `locations`; el manager,
 * solo los suyos (`mis_locales`, mig 091). Es comodidad de pantalla, no un permiso: lo que cada
 * rol puede leer lo deciden las funciones de la base.
 */
export async function getLocalesVentas(rol: string): Promise<LocalVentas[]> {
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: boolean) => PromiseLike<{ data: unknown; error: { message: string } | null }> } }
  }).from('locations').select('id, name').eq('is_active', true)
  if (error) throw new Error(error.message)
  let locales = ((data ?? []) as { id: string; name: string }[]).map(l => ({ id: l.id, nombre: l.name }))
  if (rol === 'manager') {
    const r = await (supabase as unknown as { rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: unknown }> }).rpc('mis_locales', {})
    const mios = new Set(Array.isArray(r.data) ? (r.data as string[]) : [])
    locales = locales.filter(l => mios.has(l.id))
  }
  return locales.sort((a, b) => a.id.localeCompare(b.id))
}
