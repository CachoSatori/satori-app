// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Fechas del reporte mensual — calendario puro, en hora de Costa Rica (UTC-6, sin horario de verano).
//
//  Bug que arregla (logs de prod del 01/10, 15/10, 01/11 y 15/11): el rango se armaba como
//  `${ym}-01` … `${ym}-31` para TODO mes. En meses de 30 días y en febrero, Postgres rechaza la fecha
//  («date/time field value out of range: "2026-09-31"») → PostgREST 400 → supabase-js NO tira, devuelve
//  `data: null` → el reporte creía que el mes no tenía datos:
//    · mes reportado de 30 días o febrero → «sin datos» → NO se manda ningún correo (200 OK, silencioso);
//    · mes ANTERIOR de 30 días o febrero → `prevNeta = 0` → el correo sale sin la línea «vs mes anterior».
//  Además el mes por defecto usaba `Date#setMonth(m - 1)`, que en un 29/30/31 desborda (31-mar → «31-feb»
//  → 3-mar) y devolvía el MES EN CURSO en vez del anterior (botón de Admin sin mes, esos días).
//
//  Todo acá es aritmética de enteros: no hay `Date#setMonth`, ni hora local de la máquina, ni
//  `toLocaleString` (que depende del ICU del runtime).
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Desfase fijo de Costa Rica respecto de UTC (no tiene horario de verano). */
const CR_OFFSET_MS = 6 * 60 * 60 * 1000

/** Rango de un mes: primer y último día, ambos inclusive, en `YYYY-MM-DD`. */
export interface RangoMes { desde: string; hasta: string }

const dos = (n: number) => String(n).padStart(2, '0')

/** Parsea `YYYY-MM` (mes 01–12). Tira si no es válido: los callers ya validaron. */
function partes(ym: string): { y: number; m: number } {
  const r = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym)
  if (!r) throw new Error(`mes inválido: ${ym}`)
  return { y: Number(r[1]), m: Number(r[2]) }
}

/** Cantidad de días del mes (febrero bisiesto incluido). `Date.UTC(y, m, 0)` = último día del mes `m` (1-12). */
export function diasDelMes(ym: string): number {
  const { y, m } = partes(ym)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Rango del mes completo: `YYYY-MM-01` … último día real (30, 31, 28 o 29). */
export function rangoMes(ym: string): RangoMes {
  return { desde: `${ym}-01`, hasta: `${ym}-${dos(diasDelMes(ym))}` }
}

/** Mes anterior a `ym` (enero → diciembre del año anterior). */
export function mesAnterior(ym: string): string {
  const { y, m } = partes(ym)
  return m === 1 ? `${y - 1}-12` : `${y}-${dos(m - 1)}`
}

/** Mes en curso en Costa Rica para un instante dado (`YYYY-MM`). */
export function mesActualCR(ahora: Date): string {
  const cr = new Date(ahora.getTime() - CR_OFFSET_MS)
  return `${cr.getUTCFullYear()}-${dos(cr.getUTCMonth() + 1)}`
}

/** Mes por defecto del reporte (cron del 1 y del 15, y botón de Admin sin mes): el mes ANTERIOR al mes en curso en CR. */
export function mesPorDefectoCR(ahora: Date): string {
  return mesAnterior(mesActualCR(ahora))
}
