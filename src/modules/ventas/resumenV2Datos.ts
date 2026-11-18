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
// Camino rápido (mig 190, firma del dueño 18-nov 10:36): `pos_ventas_resumen` devuelve por tramo
// los días ya sumados, las facturas de salón y los lotes de caja, sin bajar las líneas. Un pedido
// por tramo (≤ 366 días cada uno) en vez de decenas. Si la función todavía no existe en la base
// (antes del pase a prod), se cae a la lectura de siempre por la 067, que da lo mismo.

import { supabase } from '../../shared/api/supabase'
import { getLineasDeTickets, getSaloneroNombres, getTicketsRango,
  type LineaNdfRow, type TicketVentaRow } from '../../shared/api/posNdf'
import { rangoDeLecturaParaEstimar } from './indicadores'
import { sumarDias, type PeriodoV2, type Rango } from './periodos'
import { armarLectura, armarLecturaAgregada, type Lectura } from './resumenV2'
import { parsearResumenAgregado, type ParteAgregada } from './resumenV2Agregado'
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
export function limpiarCacheResumen(): void { cache.clear(); cacheAgregado.clear(); funcionAusente = false }

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

// ── Camino rápido: la función de la 190 ────────────────────────────────────────────────────

/** Días por pedido a `pos_ventas_resumen` (la función acepta hasta 731). */
export const DIAS_POR_PEDIDO = 366

/**
 * Un tramo largo en pedidos de ≤ `DIAS_POR_PEDIDO` días. Partir no cambia nada: cada pedido trae su
 * ventana estirada (un día antes, dos después), así que entre todos ven las mismas facturas y los
 * mismos lotes que el tramo entero, y los días no se pisan.
 */
export function partirTramo(r: Rango, max = DIAS_POR_PEDIDO): Rango[] {
  const out: Rango[] = []
  for (let desde = r.desde; desde <= r.hasta;) {
    const tope = sumarDias(desde, max - 1)
    const hasta = tope < r.hasta ? tope : r.hasta
    out.push({ desde, hasta })
    desde = sumarDias(hasta, 1)
  }
  return out
}

/** ¿El error es «la función no existe» (base sin la 190)? Solo ahí se cae al camino de filas. */
export function esFuncionInexistente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false
  return e.code === 'PGRST202' || e.code === '42883'
    || /pos_ventas_resumen/.test(e.message ?? '') && /(not find|does not exist|no existe)/i.test(e.message ?? '')
}

/** Marca de «no está la función» para no volver a probar en cada período. */
export class SinFuncionResumen extends Error {}

const cacheAgregado = new Map<string, Promise<ParteAgregada>>()
let funcionAusente = false

function leerTramoAgregado(local: string, r: Rango): Promise<ParteAgregada> {
  const k = `${local}|${r.desde}|${r.hasta}`
  let p = cacheAgregado.get(k)
  if (!p) {
    p = (async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>
      }).rpc('pos_ventas_resumen', { p_local: local, p_desde: r.desde, p_hasta: r.hasta })
      if (error) {
        if (esFuncionInexistente(error)) throw new SinFuncionResumen(error.message)
        throw new Error(error.message)
      }
      return parsearResumenAgregado(data)
    })()
    p.catch(() => cacheAgregado.delete(k))
    cacheAgregado.set(k, p)
  }
  return p
}

/** Todo lo que el Resumen necesita para un período, sin facturas repetidas entre tramos. */
export async function cargarLecturaResumen(local: string, p: PeriodoV2): Promise<Lectura> {
  return leerTramos(local, tramosDeLectura(p))
}

/**
 * Un solo rango (la meta del mes: el mes hasta ayer y las 8 semanas de los pesos), estirado como los
 * del período. Mismo camino y misma memoria que el Resumen.
 */
export async function cargarLecturaRango(local: string, r: Rango): Promise<Lectura> {
  const e = rangoDeLecturaParaEstimar(r)
  const desde = e.desde < PRIMERA_JORNADA_POS ? PRIMERA_JORNADA_POS : e.desde
  return leerTramos(local, desde <= e.hasta ? [{ desde, hasta: e.hasta }] : [])
}

async function leerTramos(local: string, tramos: Rango[]): Promise<Lectura> {
  const nombres = getSaloneroNombres().catch(() => ({} as Record<string, string>))
  if (!funcionAusente) {
    try {
      const partes = await Promise.all(tramos.flatMap(r => partirTramo(r)).map(r => leerTramoAgregado(local, r)))
      return armarLecturaAgregada(partes, await nombres)
    } catch (e) {
      if (!(e instanceof SinFuncionResumen)) throw e
      funcionAusente = true
    }
  }
  const partes = await Promise.all(tramos.map(r => leerTramo(local, r)))
  return armarLectura(...juntarPartes(partes), await nombres)
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
