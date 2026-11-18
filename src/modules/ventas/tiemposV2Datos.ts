// ── Ventas v2 · «Tiempos»: la lectura — SOLO LECTURA ────────────────────────────────────────
//
// · Lo diario (días, personas, facturas de salón con su hora): `cargarLecturaDeRangos`, el mismo
//   camino del Resumen (función de la 190, con la 067 de respaldo) y la misma caché por tramo.
// · Horas de todos los canales, tiempo sentado y descartes: `pos_ventas_tiempos` (mig 192). Si la base todavía
//   no la tiene, `cargarTiempos` devuelve `null` y la pantalla usa lo de antes:
// · el turno por hora de TODOS los canales por `pos_prompax_agregado` (mig 080, ya en prod), en pedidos de
//   ≤ 366 días, y el mapa solo de salón.
// · Las mesas internas las marca `cargarLecturaDeRangos` (`pos_ventas_internas`, 192).
import { supabase } from '../../shared/api/supabase'
import { getPromPaxAgregado, type FilaPromPaxRpc } from '../../shared/api/posNdf'
import { esFuncionAusente, parsearTiempos, type SentadoRpc, type TiemposRpc } from './tiemposV2Rpc'
import type { Rango } from './periodos'
import { DIAS_POR_PEDIDO, partirTramo } from './resumenV2Datos'

export { cargarLecturaDeRangos, getLocalesVentas } from './resumenV2Datos'

const cache = new Map<string, Promise<FilaPromPaxRpc[]>>()

/** Para las pruebas. */
export function limpiarCacheTiempos(): void { cache.clear(); cacheT.clear(); tiemposAusente = false }

/** Las filas de la 080 (día × franja × salonero × canal) del rango, en pedidos de ≤ 366 días. */
export async function cargarTurnos(local: string, r: Rango): Promise<FilaPromPaxRpc[]> {
  const partes = await Promise.all(partirTramo(r, DIAS_POR_PEDIDO).map(t => {
    const k = `${local}|${t.desde}|${t.hasta}`
    let p = cache.get(k)
    if (!p) {
      p = getPromPaxAgregado(local, t.desde, t.hasta)
      p.catch(() => cache.delete(k))
      cache.set(k, p)
    }
    return p
  }))
  return partes.flat()
}

const cacheT = new Map<string, Promise<TiemposRpc>>()
let tiemposAusente = false
class SinFuncionTiempos extends Error {}

function leerTiempos(local: string, r: Rango): Promise<TiemposRpc> {
  const k = `${local}|${r.desde}|${r.hasta}`
  let p = cacheT.get(k)
  if (!p) {
    p = (async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>
      }).rpc('pos_ventas_tiempos', { p_local: local, p_desde: r.desde, p_hasta: r.hasta })
      if (error) {
        if (esFuncionAusente(error, 'pos_ventas_tiempos')) throw new SinFuncionTiempos(error.message)
        throw new Error(error.message)
      }
      return parsearTiempos(data)
    })()
    p.catch(() => cacheT.delete(k))
    cacheT.set(k, p)
  }
  return p
}

/**
 * Junta pedidos partidos: las horas se suman (no se pisan), los descartes también; del tiempo sentado se juntan
 * N y el promedio (ponderado), pero la MEDIANA no se puede juntar: con más de un pedido queda `NaN` («—»).
 */
export function juntarTiempos(partes: readonly TiemposRpc[]): TiemposRpc {
  if (partes.length === 1) return partes[0]
  const sent = new Map<string, SentadoRpc>()
  for (const p of partes) for (const s of p.sentados) {
    const e = sent.get(s.tamano)
    if (!e) { sent.set(s.tamano, { ...s, mediana: partes.length > 1 ? NaN : s.mediana }); continue }
    const n = e.n + s.n
    e.promedio = n > 0 ? (e.promedio * e.n + s.promedio * s.n) / n : 0
    e.n = n
  }
  const d = { sin_pedido: 0, internas: 0, sin_pax: 0, menos_de_5: 0, mas_de_240: 0 }
  for (const p of partes) for (const k of Object.keys(d) as (keyof typeof d)[]) d[k] += p.descartes[k]
  const orden = ['2', '4', '6', '7+']
  return {
    horas: partes.flatMap(p => p.horas),
    sentados: [...sent.values()].sort((a, b) => orden.indexOf(a.tamano) - orden.indexOf(b.tamano)),
    descartes: d,
  }
}

/** Horas, tiempo sentado y descartes del rango. `null` = la base no tiene la 192 (la pantalla usa lo de antes). */
export async function cargarTiempos(local: string, r: Rango): Promise<TiemposRpc | null> {
  if (tiemposAusente) return null
  try {
    return juntarTiempos(await Promise.all(partirTramo(r, DIAS_POR_PEDIDO).map(t => leerTiempos(local, t))))
  } catch (e) {
    if (!(e instanceof SinFuncionTiempos)) throw e
    tiemposAusente = true
    return null
  }
}
