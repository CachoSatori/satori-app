// ── Ventas v2 · «Tiempos»: la lectura — SOLO LECTURA ────────────────────────────────────────
//
// · Lo diario (días, personas, facturas de salón con su hora): `cargarLecturaDeRangos`, el mismo
//   camino del Resumen (función de la 190, con la 067 de respaldo) y la misma caché por tramo.
// · El turno por hora de TODOS los canales: `pos_prompax_agregado` (mig 080, ya en prod), en pedidos
//   de ≤ 366 días. Sin funciones ni migraciones nuevas.
import { getPromPaxAgregado, type FilaPromPaxRpc } from '../../shared/api/posNdf'
import type { Rango } from './periodos'
import { DIAS_POR_PEDIDO, partirTramo } from './resumenV2Datos'

export { cargarLecturaDeRangos, getLocalesVentas } from './resumenV2Datos'

const cache = new Map<string, Promise<FilaPromPaxRpc[]>>()

/** Para las pruebas. */
export function limpiarCacheTiempos(): void { cache.clear() }

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
