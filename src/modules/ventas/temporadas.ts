// ── Temporadas de Santa Teresa (SPEC Prom/PAX §4) — la ÚNICA fuente de verdad ─────────────
//
// Módulo PURO: sin I/O, sin reloj, sin zona horaria. Trabaja con días `YYYY-MM-DD` (el día CR
// de la factura, el mismo de Ventas) y compara strings, así que no hay corrimientos por huso.
//
// Tramos firmados por Ismael (30/10), fijos en código en v1 (la tabla editable por local es v2):
//   · `alta`        15-dic → 30-abr. Cruza el año y PERTENECE AL AÑO EN QUE TERMINA:
//                   «Alta 2026» = 15 dic 2025 – 30 abr 2026.
//   · `baja-may`     1-may → 31-may
//   · `media`        1-jun → 31-ago
//   · `baja-sepdic`  1-sep → 14-dic
// Las comparaciones son tramo contra tramo: la baja de mayo no se compara con la de sep–dic.

export type TramoId = 'alta' | 'baja-may' | 'media' | 'baja-sepdic'

/** Un tramo concreto de un año. `desde`/`hasta` incluidos, `YYYY-MM-DD`. */
export interface Tramo {
  id:    TramoId
  /** El año del tramo. Para la alta, el año en que TERMINA. */
  anio:  number
  desde: string
  hasta: string
}

/** Orden dentro del año calendario en que termina cada tramo. */
export const TRAMOS: readonly TramoId[] = ['alta', 'baja-may', 'media', 'baja-sepdic']

const NOMBRE: Record<TramoId, string> = {
  'alta':        'Alta',
  'baja-may':    'Baja de mayo',
  'media':       'Media',
  'baja-sepdic': 'Baja sep–dic',
}

const MES_CORTO = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const pad = (n: number) => String(n).padStart(2, '0')
const fecha = (a: number, m: number, d: number) => `${a}-${pad(m)}-${pad(d)}`

/** El rango real de un tramo en un año. */
export function rangoDeTramo(id: TramoId, anio: number): Tramo {
  switch (id) {
    case 'alta':        return { id, anio, desde: fecha(anio - 1, 12, 15), hasta: fecha(anio, 4, 30) }
    case 'baja-may':    return { id, anio, desde: fecha(anio, 5, 1),       hasta: fecha(anio, 5, 31) }
    case 'media':       return { id, anio, desde: fecha(anio, 6, 1),       hasta: fecha(anio, 8, 31) }
    case 'baja-sepdic': return { id, anio, desde: fecha(anio, 9, 1),       hasta: fecha(anio, 12, 14) }
  }
}

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/

/** El tramo al que pertenece un día. Tira si el día no es `YYYY-MM-DD`. */
export function tramoDe(dia: string): Tramo {
  const m = RE_DIA.exec(dia)
  if (!m) throw new Error(`Día inválido: ${dia}`)
  const anio = Number(m[1])
  const md = `${m[2]}-${m[3]}`
  if (md >= '12-15') return rangoDeTramo('alta', anio + 1)
  if (md <= '04-30') return rangoDeTramo('alta', anio)
  if (md <= '05-31') return rangoDeTramo('baja-may', anio)
  if (md <= '08-31') return rangoDeTramo('media', anio)
  return rangoDeTramo('baja-sepdic', anio)
}

/** El mismo tramo del año anterior (la comparación «mismo tramo de temporada del año anterior»). */
export function tramoDelAnioAnterior(t: Pick<Tramo, 'id' | 'anio'>): Tramo {
  return rangoDeTramo(t.id, t.anio - 1)
}

/** `'2025-12-15'` → `'15 dic 2025'`. */
export function diaLegible(dia: string): string {
  const m = RE_DIA.exec(dia)
  if (!m) return dia
  return `${Number(m[3])} ${MES_CORTO[Number(m[2])]} ${m[1]}`
}

/** «Alta 2026: 15 dic 2025 – 30 abr 2026». El selector muestra siempre el rango real. */
export function etiquetaTramo(t: Tramo): string {
  return `${NOMBRE[t.id]} ${t.anio}: ${diaLegible(t.desde)} – ${diaLegible(t.hasta)}`
}
