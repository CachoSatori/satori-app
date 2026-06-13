// Propina PoS → pool del turno (P1). Funciones PURAS de suma/atribución — NO tocan
// tipCalculations (el reparto sigue igual); solo agregan las propinas capturadas en el
// cobro al total del pool. Testeadas en posTips.test.ts.

export interface PosTipRow {
  tip_crc: number
  tip_currency?: 'CRC' | 'USD'
  salonero_id?: string | null   // current_salonero_id del pedido (atribución)
}

export interface PosTipSummary {
  total_crc: number                       // suma de todas las propinas del PoS (en ₡)
  total_usd_crc: number                   // de las anteriores, las que entraron en $ (ya en ₡)
  por_salonero: Record<string, number>    // atribución: salonero_id → ₡
}

/** Suma idempotente (es una función de los datos, no acumula) de las propinas del PoS. */
export function sumPosTips(rows: PosTipRow[]): PosTipSummary {
  let total = 0, usd = 0
  const por: Record<string, number> = {}
  for (const r of rows ?? []) {
    const t = Math.round(Number(r.tip_crc) || 0)
    if (t <= 0) continue
    total += t
    if (r.tip_currency === 'USD') usd += t
    const k = r.salonero_id ?? 'sin-asignar'
    por[k] = (por[k] ?? 0) + t
  }
  return { total_crc: total, total_usd_crc: usd, por_salonero: por }
}

/** Pool EFECTIVO del turno = lo ingresado a mano (frasco) + lo capturado en el PoS.
 *  Conservador (DECISIÓN-PRODUCTO): TODO va al mismo pool, con el PoS etiquetado aparte
 *  (pool_pos_crc). NO cambia el reparto: solo cambia el TOTAL que el reparto recibe. */
export function efectivoPoolConPos(manualCrc: number, poolPosCrc: number): number {
  return Math.round((Number(manualCrc) || 0) + (Number(poolPosCrc) || 0))
}
