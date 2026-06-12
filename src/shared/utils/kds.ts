// KDS (F3) — helpers puros del timer y el orden de categorías. Sin IO, testeados.

export type KdsColor = 'verde' | 'ambar' | 'rojo'

/**
 * Color del timer por comanda: verde mientras está holgada, ámbar al acercarse
 * al umbral, rojo al alcanzarlo o pasarlo. Umbral configurable por curso (seg).
 */
export function timerColor(elapsedSec: number, thresholdSec: number): KdsColor {
  const t = Number(thresholdSec) || 0
  const e = Number(elapsedSec) || 0
  if (t <= 0) return 'verde'
  if (e >= t) return 'rojo'
  if (e >= t * 0.66) return 'ambar'
  return 'verde'
}

/** "m:ss" a partir de segundos (para el reloj de cada comanda). */
export function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Ordena ítems por categoría según el orden configurado en Admin (category_order
 * = lista de product_map.tipo). `tipoOf` resuelve el tipo de cada ítem. Las
 * categorías fuera de la lista van al final, en orden alfabético estable.
 */
export function sortByCategory<T>(items: T[], categoryOrder: string[], tipoOf: (it: T) => string): T[] {
  const rank = new Map(categoryOrder.map((c, i) => [c, i]))
  const idx = (t: string) => (rank.has(t) ? rank.get(t)! : categoryOrder.length)
  return [...items].sort((a, b) => {
    const ta = tipoOf(a) || '', tb = tipoOf(b) || ''
    const d = idx(ta) - idx(tb)
    return d !== 0 ? d : ta.localeCompare(tb)
  })
}
