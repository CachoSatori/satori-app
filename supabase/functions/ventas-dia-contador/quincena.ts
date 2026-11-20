// ─────────────────────────────────────────────────────────────────────────────────────────
//  Quincena CERRADA del correo al contador — calendario puro, en hora de Costa Rica (UTC-6, sin
//  horario de verano). Nada de `setMonth`, hora local de la máquina ni `toLocaleString` (R05, R10).
//
//    · El cron corre el 1 y el 16 a las 07:00 CR.
//    · El 16 (o cualquier día 16–31): la 1.ª quincena del mes en curso, del 1 al 15.
//    · El 1 (o cualquier día 1–15): la 2.ª quincena del mes ANTERIOR, del 16 al último día real
//      (28, 29, 30 o 31).
//  Una corrida manual puede pedir una quincena puntual: «YYYY-MM-1» o «YYYY-MM-2», que no puede ser
//  una quincena que todavía no cerró (en hora CR).
// ─────────────────────────────────────────────────────────────────────────────────────────

const CR_OFFSET_MS = 6 * 60 * 60 * 1000
const dos = (n: number) => String(n).padStart(2, '0')
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre']

export interface Quincena {
  /** `YYYY-MM-1` o `YYYY-MM-2`. */
  clave: string
  ym: string
  numero: 1 | 2
  /** Primer y último día, inclusive, `YYYY-MM-DD`. */
  desde: string
  hasta: string
  /** Todos los días del rango, en orden. */
  fechas: string[]
  /** «1–15 de noviembre de 2026». */
  etiqueta: string
}

/** Días reales del mes (`m` 1–12). */
export function diasDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Fecha y día del mes en Costa Rica para un instante. */
export function hoyCR(ahora: Date): { y: number; m: number; d: number } {
  const cr = new Date(ahora.getTime() - CR_OFFSET_MS)
  return { y: cr.getUTCFullYear(), m: cr.getUTCMonth() + 1, d: cr.getUTCDate() }
}

export function armarQuincena(y: number, m: number, numero: 1 | 2): Quincena {
  const ym = `${y}-${dos(m)}`
  const ini = numero === 1 ? 1 : 16
  const fin = numero === 1 ? 15 : diasDelMes(y, m)
  const fechas: string[] = []
  for (let d = ini; d <= fin; d++) fechas.push(`${ym}-${dos(d)}`)
  return {
    clave: `${ym}-${numero}`, ym, numero,
    desde: fechas[0], hasta: fechas[fechas.length - 1], fechas,
    etiqueta: `${ini}–${fin} de ${MESES[m - 1]} de ${y}`,
  }
}

/** La última quincena cerrada en hora CR. */
export function quincenaCerrada(ahora: Date): Quincena {
  const { y, m, d } = hoyCR(ahora)
  if (d >= 16) return armarQuincena(y, m, 1)
  return m === 1 ? armarQuincena(y - 1, 12, 2) : armarQuincena(y, m - 1, 2)
}

export type Eleccion = { ok: true; q: Quincena } | { ok: false; code: string; error: string }

/**
 * Sin valor: la última cerrada. Con valor: `YYYY-MM-1|2`, desde 2024-01 y ya cerrada en hora CR
 * (no es posterior a la última cerrada).
 */
export function elegirQuincena(valor: unknown, ahora: Date): Eleccion {
  const ultima = quincenaCerrada(ahora)
  if (valor === undefined || valor === null || valor === '') return { ok: true, q: ultima }
  const r = typeof valor === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])-([12])$/.exec(valor) : null
  if (!r) return { ok: false, code: 'quincena', error: 'Quincena inválida (YYYY-MM-1 o YYYY-MM-2)' }
  const q = armarQuincena(Number(r[1]), Number(r[2]), Number(r[3]) as 1 | 2)
  if (q.ym < '2024-01') return { ok: false, code: 'quincena', error: 'Quincena anterior a 2024' }
  if (q.desde > ultima.desde) return { ok: false, code: 'quincena_abierta', error: 'Esa quincena todavía no cerró' }
  return { ok: true, q }
}
