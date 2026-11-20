// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Período del reporte — qué rango se reporta, contra qué se compara y cómo se titula el correo.
//
//  Decisión del dueño (16-nov-2026): el envío del DÍA 15 manda la PRIMERA QUINCENA del mes en curso
//  (del 1 al 14, en hora CR) comparada con la misma quincena del mes anterior. El del DÍA 1 sigue
//  mandando el mes anterior completo, comparado con el mes previo.
//
//  Cómo lo distingue la Edge: por un parámetro EXPLÍCITO del body, `periodo: "mes" | "quincena"`
//  (sin parámetro = "mes", como hasta hoy). El cron del 15 (jobid 4) pasa a mandar
//  `{"periodo":"quincena"}`. No se decide por la fecha del día: el botón de Admin o una corrida a mano
//  un día 15 cambiarían de significado sin que nadie lo pida, y un re-intento el 16 volvería al mensual.
//
//  Todo puro (sin red ni reloj propio): `ahora` entra como parámetro, así se prueba.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { rangoMes, mesAnterior, mesActualCR, mesPorDefectoCR, type RangoMes } from './fechas.ts'

export type Periodo = 'mes' | 'quincena'

/** Último día (inclusive) de la primera quincena. Del 1 al 14 en todos los meses (febrero incluido). */
export const ULTIMO_DIA_QUINCENA = 14

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const CR_OFFSET_MS = 6 * 60 * 60 * 1000

/** Día del mes en Costa Rica (UTC-6 fijo) para un instante. */
export function diaActualCR(ahora: Date): number {
  return new Date(ahora.getTime() - CR_OFFSET_MS).getUTCDate()
}

/** Rango de la primera quincena: `YYYY-MM-01` … `YYYY-MM-14`. */
export function rangoQuincena(ym: string): RangoMes {
  rangoMes(ym) // valida el formato (tira si es inválido)
  return { desde: `${ym}-01`, hasta: `${ym}-${ULTIMO_DIA_QUINCENA}` }
}

/** ¿La 1.ª quincena de `ym` ya terminó en CR? (mes pasado, o mes en curso desde el día 15). */
export function quincenaCompleta(ym: string, ahora: Date): boolean {
  const actual = mesActualCR(ahora)
  if (ym < actual) return true
  return ym === actual && diaActualCR(ahora) > ULTIMO_DIA_QUINCENA
}

/** Quincena por defecto: la última 1.ª quincena completa en CR (el día 15 del cron = la del mes en curso). */
export function quincenaPorDefectoCR(ahora: Date): string {
  const actual = mesActualCR(ahora)
  return diaActualCR(ahora) > ULTIMO_DIA_QUINCENA ? actual : mesAnterior(actual)
}

/** Nombre del mes en minúscula + año: «noviembre de 2026». */
export function mesLargo(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MESES[Number(m) - 1]} de ${y}`
}

export interface PlanReporte {
  periodo: Periodo
  ym: string
  rango: RangoMes
  /** Mismo período del mes anterior (para «vs …»). */
  rangoComparado: RangoMes
  /** «Reporte mensual de octubre de 2026» · «Reporte 1.ª quincena de noviembre de 2026». */
  titulo: string
  /** Etiqueta corta para encabezado y pie: «octubre de 2026» · «1.ª quincena de noviembre de 2026». */
  etiqueta: string
  /** Texto de la fila de comparación: «vs mes anterior (septiembre)» · «vs 1.ª quincena de octubre». */
  comparacion: string
  asuntoVentas: string
  asuntoPropinas: string
}

export function planReporte(periodo: Periodo, ym: string): PlanReporte {
  const prev = mesAnterior(ym)
  const mesPrev = MESES[Number(prev.slice(5, 7)) - 1]
  const esQ = periodo === 'quincena'
  const etiqueta = esQ ? `1.ª quincena de ${mesLargo(ym)}` : mesLargo(ym)
  const titulo = esQ ? `Reporte 1.ª quincena de ${mesLargo(ym)}` : `Reporte mensual de ${mesLargo(ym)}`
  return {
    periodo,
    ym,
    rango: esQ ? rangoQuincena(ym) : rangoMes(ym),
    rangoComparado: esQ ? rangoQuincena(prev) : rangoMes(prev),
    titulo,
    etiqueta,
    comparacion: esQ ? `vs 1.ª quincena de ${mesPrev}` : `vs mes anterior (${mesPrev})`,
    asuntoVentas: `📈 Satori — Ventas · ${titulo}`,
    asuntoPropinas: `💰 Satori — Propinas · ${titulo}`,
  }
}

export type ResultadoPeriodo =
  | { ok: true; plan: PlanReporte }
  | { ok: false; code: 'periodo' | 'quincena_incompleta'; error: string }

/**
 * Elige el período a partir del body ya validado en `month` (`ym` = '' si no vino).
 * `periodo` ausente/nulo/vacío = 'mes' (comportamiento de siempre: cron del 1 y botón de Admin).
 */
export function elegirPeriodo(periodoBody: unknown, ym: string, ahora: Date): ResultadoPeriodo {
  const p = periodoBody === undefined || periodoBody === null || periodoBody === '' ? 'mes' : periodoBody
  if (p !== 'mes' && p !== 'quincena') return { ok: false, code: 'periodo', error: 'Período inválido (mes o quincena)' }
  if (p === 'mes') return { ok: true, plan: planReporte('mes', ym || mesPorDefectoCR(ahora)) }
  const q = ym || quincenaPorDefectoCR(ahora)
  if (!quincenaCompleta(q, ahora)) {
    return { ok: false, code: 'quincena_incompleta', error: 'La 1.ª quincena de ese mes todavía no terminó' }
  }
  return { ok: true, plan: planReporte('quincena', q) }
}
