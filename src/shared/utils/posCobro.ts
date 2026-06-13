// PoS F3 — matemática del COBRO (toca plata: 100% pura y testeada, SPEC §2).
// computeTotals (posFiscal.ts) NO se toca: el total ya viene calibrado de ahí; acá
// solo se calcula vuelto y conversión de moneda sobre ese total.

/** Redondeo a colón entero (CR no usa céntimos en efectivo). */
export const roundCrc = (n: number): number => Math.round(Number(n) || 0)
/** Redondeo a 2 decimales para dólares. */
export const roundUsd = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

/** Convierte colones → dólares a un TC ₡/$ dado (2 decimales). */
export function convertirCrcAUsd(crc: number, tc: number): number {
  const t = Number(tc) || 0
  if (t <= 0) return 0
  return roundUsd((Number(crc) || 0) / t)
}

/** Convierte dólares → colones a un TC ₡/$ dado (colón entero). */
export function convertirUsdACrc(usd: number, tc: number): number {
  const t = Number(tc) || 0
  return roundCrc((Number(usd) || 0) * t)
}

export interface Vuelto {
  /** vuelto a entregar en ₡ (0 si lo recibido no alcanza). */
  vuelto_crc: number
  /** lo que aún falta cobrar en ₡ (0 si alcanza o sobra). */
  falta_crc: number
  /** ¿lo recibido cubre el total? */
  alcanza: boolean
}

/** Vuelto de un pago en EFECTIVO ₡ sobre un total en ₡. Nunca negativo:
 *  si no alcanza, vuelto=0 y falta>0. */
export function calcularVuelto(totalCrc: number, recibidoCrc: number): Vuelto {
  const total = roundCrc(totalCrc)
  const recibido = roundCrc(recibidoCrc)
  const diff = recibido - total
  return diff >= 0
    ? { vuelto_crc: diff, falta_crc: 0, alcanza: true }
    : { vuelto_crc: 0, falta_crc: -diff, alcanza: false }
}

/** Escenario turista: el cliente paga un total en ₡ con efectivo en DÓLARES.
 *  Convierte lo recibido a ₡ al TC dado y calcula el vuelto en ₡ (no en $:
 *  la caja entrega colones, que es lo que tiene). */
export function vueltoPagoUsd(totalCrc: number, recibidoUsd: number, tc: number): Vuelto & { recibido_crc: number } {
  const recibido_crc = convertirUsdACrc(recibidoUsd, tc)
  return { recibido_crc, ...calcularVuelto(totalCrc, recibido_crc) }
}
