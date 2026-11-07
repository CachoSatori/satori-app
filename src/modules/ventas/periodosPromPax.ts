// ── Períodos y comparaciones de «Prom/PAX explicado» (SPEC §3) ─────────────────────────────
//
// Módulo PURO. Días `YYYY-MM-DD` (día CR de la factura), las dos puntas incluidas. La aritmética
// de fechas va en UTC a propósito: acá no hay instantes, solo días de calendario.

import { rangoDeTramo, tramoDelAnioAnterior, type TramoId } from './temporadas'

export interface Rango {
  desde: string
  hasta: string
}

export type TipoPeriodo = 'rango' | 'mes' | 'semana' | 'temporada'

export interface Periodo extends Rango {
  tipo:   TipoPeriodo
  /** Solo para `temporada`: qué tramo y de qué año (la alta = el año en que termina). */
  tramo?: { id: TramoId; anio: number }
}

export type ModoComparacion = 'anterior' | 'anio-anterior' | 'tramo-anio-anterior'

const DIA_MS = 86_400_000
const aMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
const aDia = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** `d` + `n` días. */
export function sumarDias(d: string, n: number): string {
  return aDia(aMs(d) + n * DIA_MS)
}

/** Días de [desde, hasta], las dos puntas incluidas. */
export function largoEnDias(r: Rango): number {
  return Math.round((aMs(r.hasta) - aMs(r.desde)) / DIA_MS) + 1
}

/** 0 = lunes … 6 = domingo. */
export function diaSemana(d: string): number {
  return (new Date(aMs(d)).getUTCDay() + 6) % 7
}

export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** El lunes de la semana ISO de `d`. */
export function lunesDe(d: string): string {
  return sumarDias(d, -diaSemana(d))
}

/** Un mes calendario. */
export function periodoMes(anio: number, mes: number): Periodo {
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const sig = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, '0')}-01`
  return { tipo: 'mes', desde, hasta: sumarDias(sig, -1) }
}

/** La semana ISO (lun–dom) que contiene `d`. */
export function periodoSemana(d: string): Periodo {
  const desde = lunesDe(d)
  return { tipo: 'semana', desde, hasta: sumarDias(desde, 6) }
}

/** Un tramo de temporada de un año dado. */
export function periodoTemporada(id: TramoId, anio: number): Periodo {
  const t = rangoDeTramo(id, anio)
  return { tipo: 'temporada', desde: t.desde, hasta: t.hasta, tramo: { id, anio } }
}

/** Rango libre. Tira si las puntas vienen al revés. */
export function periodoRango(desde: string, hasta: string): Periodo {
  if (desde > hasta) throw new Error(`Rango al revés: ${desde} > ${hasta}`)
  return { tipo: 'rango', desde, hasta }
}

/** El mismo día del año anterior. El 29-feb pasa al 28-feb. */
export function mismoDiaAnioAnterior(d: string): string {
  const [a, m, dd] = d.split('-')
  const anio = Number(a) - 1
  if (m === '02' && dd === '29') return `${anio}-02-28`
  return `${anio}-${m}-${dd}`
}

/**
 * El período contra el que se compara.
 * · `anterior`: el de igual largo que termina el día antes de `p.desde`.
 * · `anio-anterior`: el mismo período un año antes. Una semana ISO va a la de 52 semanas antes
 *   (364 días: mismo día de semana); el resto, mismo día de calendario.
 * · `tramo-anio-anterior`: solo para temporada, el mismo tramo del año anterior.
 */
export function periodoDeComparacion(p: Periodo, modo: ModoComparacion): Periodo {
  if (modo === 'anterior') {
    const hasta = sumarDias(p.desde, -1)
    return { tipo: p.tipo === 'temporada' ? 'rango' : p.tipo, desde: sumarDias(hasta, -(largoEnDias(p) - 1)), hasta }
  }
  if (modo === 'tramo-anio-anterior') {
    if (!p.tramo) throw new Error('«Mismo tramo del año anterior» solo vale para una temporada')
    const t = tramoDelAnioAnterior(p.tramo)
    return { tipo: 'temporada', desde: t.desde, hasta: t.hasta, tramo: { id: t.id, anio: t.anio } }
  }
  if (p.tipo === 'semana') return { tipo: 'semana', desde: sumarDias(p.desde, -364), hasta: sumarDias(p.hasta, -364) }
  if (p.tipo === 'mes') {
    const [a, m] = p.desde.split('-').map(Number)
    return periodoMes(a - 1, m)
  }
  if (p.tipo === 'temporada' && p.tramo) return periodoDeComparacion(p, 'tramo-anio-anterior')
  return { tipo: 'rango', desde: mismoDiaAnioAnterior(p.desde), hasta: mismoDiaAnioAnterior(p.hasta) }
}

/** El rango que cubre los dos períodos (para pedir los datos en una sola llamada si están cerca). */
export function cubrir(a: Rango, b: Rango): Rango {
  return { desde: a.desde < b.desde ? a.desde : b.desde, hasta: a.hasta > b.hasta ? a.hasta : b.hasta }
}
