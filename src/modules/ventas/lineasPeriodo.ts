// ── Ventas v2 · 3.5.2: las líneas del PoS de UN período, con el lector de siempre ─────────────
//
// Lo que necesita líneas (precio por plato y por bebida, bebidas por persona, relación comida/bebida, los
// productos más vendidos, cortesías y consumo del personal) sigue saliendo del MISMO lector que usaban
// «Hoy» e «Histórico» (SPEC §12.3: «sin cambiar la cuenta»): `ventasDelRango` (el PoS → `DiasMap`) y el
// `ProductMap` curado fusionado con la familia del PoS (`fusionarProductMap`, igual que el shell de Ventas).
//
// Diferencia con antes, a propósito: se pide SOLO el período elegido en la barra y SOLO cuando hace falta
// («Salón en detalle» abierto, «Regalías», «🖨 Reporte»), en vez de bajar los 90 días o la historia entera
// al entrar. Solo lectura.
import { getProductMap } from '../../shared/api/ventas'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'
import type { Rango } from './periodos'
import { ventasDelRango } from './ventasFuente'
import { fusionarProductMap } from './ventasUtils'

export interface LineasPeriodo {
  dias: DiasMap
  /** Curado + familia del PoS (la misma fusión que el shell de Ventas). */
  pm:   ProductMap
}

const cache = new Map<string, Promise<LineasPeriodo>>()
let curado: Promise<ProductMap> | null = null

/** Para las pruebas. */
export function limpiarCacheLineas(): void { cache.clear(); curado = null }

function productMapCurado(): Promise<ProductMap> {
  if (!curado) {
    curado = getProductMap()
    curado.catch(() => { curado = null })
  }
  return curado
}

/** Las ventas del PoS de `r` (días CR de factura), del local, con el `ProductMap` fusionado. */
export function cargarLineasPeriodo(local: string, r: Rango): Promise<LineasPeriodo> {
  const k = `${local}|${r.desde}|${r.hasta}`
  let p = cache.get(k)
  if (!p) {
    p = Promise.all([ventasDelRango(r.desde, r.hasta, local), productMapCurado()])
      .then(([pos, cur]) => ({ dias: pos.dias, pm: fusionarProductMap(cur, pos.pm) }))
    p.catch(() => cache.delete(k))
    cache.set(k, p)
  }
  return p
}

/** Varios rangos (el mes, el anterior y el del año pasado del reporte): un solo `DiasMap`. */
export async function cargarLineasDeRangos(local: string, rangos: readonly Rango[]): Promise<LineasPeriodo> {
  const partes = await Promise.all(rangos.map(r => cargarLineasPeriodo(local, r)))
  const dias: DiasMap = {}
  const familia: ProductMap = {}
  for (const parte of partes) {
    Object.assign(dias, parte.dias)
    for (const [n, info] of Object.entries(parte.pm)) if (!familia[n]) familia[n] = info
  }
  return { dias, pm: familia }
}

/** Los días de `r` que tienen datos, en orden. */
export function fechasDe(dias: DiasMap, r: Rango): string[] {
  return Object.keys(dias).filter(f => f >= r.desde && f <= r.hasta).sort()
}
