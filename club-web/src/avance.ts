// Mig 168 · «Mi Club»: avance de los primeros 90 días (el alta cuenta como la 1.ª visita). Módulo puro: recibe lo que
// devuelve /api/portal/:token/avance ({ avance }) y arma los textos; main.ts lo pinta. Sin avance válido, null (no se
// muestra nada y no se rompe el portal: la base sin la 168 responde error y el portal sigue igual).
import type { TEXTOS } from './i18n'

export interface Avance {
  visita: number; de: number; ganada: boolean
  /** último día CR para llegar (mientras corre) */
  hasta?: string | null
  /** último día CR para usar la ganada */
  vence_en?: string | null
}
type T = (typeof TEXTOS)['es']

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/

/** Lee la respuesta de la API; cualquier cosa rara → null. */
export function leerAvance(x: unknown): Avance | null {
  const a = (x && typeof x === 'object' ? (x as { avance?: unknown }).avance : null) as Partial<Avance> | null | undefined
  if (!a || typeof a !== 'object') return null
  const de = Number(a.de), visita = Number(a.visita)
  if (!Number.isInteger(de) || de < 2 || de > 10 || !Number.isInteger(visita) || visita < 1 || visita > de) return null
  if (a.ganada === true) return RE_DIA.test(String(a.vence_en ?? '')) ? { visita: de, de, ganada: true, vence_en: a.vence_en } : null
  return RE_DIA.test(String(a.hasta ?? '')) ? { visita, de, ganada: false, hasta: a.hasta } : null
}

export interface TextosAvance { titulo: string; principal: string; detalle: string; visita: number; de: number; ganada: boolean }

/** `dia` formatea un 'YYYY-MM-DD' (día de Costa Rica) para mostrarlo. */
export function textosAvance(a: Avance, t: T, dia: (d: string) => string): TextosAvance {
  if (a.ganada) {
    return { titulo: t.avance_titulo, principal: t.avance_ganada, detalle: t.avance_ganada_txt(dia(a.vence_en as string)),
             visita: a.de, de: a.de, ganada: true }
  }
  return { titulo: t.avance_titulo, principal: t.avance_visita(a.visita, a.de), detalle: t.avance_txt(a.de, dia(a.hasta as string)),
           visita: a.visita, de: a.de, ganada: false }
}
