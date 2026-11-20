// Guardas del cierre de propinas: pozo que nadie puede cobrar (H1/H2, PR #259).
//
// Decisión del dueño (17-nov-2026): si al cerrar (o al guardar una edición en «Historial») queda
// plata del pozo que el reparto no le asigna a nadie, la pantalla NO deja cerrar y muestra un aviso.
//
// El reparto vive en el sagrado `src/shared/utils/tipCalculations.ts` (calcTurno) y NO se toca:
//   · H1 (l.110): el pozo de barra se reparte solo si la barra tiene horas > 0, pero igual suma en
//     totalPool (l.120) → con barra > 0 y 0 horas de barra, ese monto no lo cobra nadie.
//   · H2 (l.100): con 0 puntos la tasa es 0 → el pozo general no lo cobra nadie.
// Estas funciones son puras y reciben EXACTAMENTE los mismos datos que se le pasan a calcTurno
// (líneas con el rol EFECTIVO —cubierto si hubo cobertura— y los mismos montos), así la guarda ve
// lo mismo que el reparto. El pozo general se toma del propio calcTurno para que coincida al peso.

import { calcTurno, BAR_ROLES, formatCRC, type DraftLine } from '../../shared/utils/tipCalculations'

// `detalle` = el mismo aviso SIN cifra: se muestra cuando arriba ya está «Quedan ₡X sin repartir» (sinRepartir.ts),
// para que la caja roja tenga un solo monto (ese, que es la salida real del reparto).
export type AvisoCierre =
  | { tipo: 'barra_sin_horas'; monto: number; texto: string; detalle: string }
  | { tipo: 'general_sin_puntos'; monto: number; texto: string; detalle: string }

export const DETALLE_BARRA_SIN_HORAS =
  'Nadie de barra tiene horas cargadas. Cargá las horas de barra; si nadie de barra trabajó, avisá al owner.'
export const DETALLE_GENERAL_SIN_PUNTOS =
  'Nadie del turno tiene puntos. Revisá los roles o las horas antes de cerrar.'

export function textoBarraSinHoras(monto: number): string {
  return `Hay ${formatCRC(monto)} de propina de barra y nadie de barra tiene horas cargadas. ` +
    'Cargá las horas de barra; si nadie de barra trabajó, avisá al owner.'
}

export function textoGeneralSinPuntos(monto: number): string {
  return `Hay ${formatCRC(monto)} para repartir y nadie del turno tiene puntos. ` +
    'Revisá los roles o las horas antes de cerrar.'
}

/**
 * Devuelve los avisos que bloquean el cierre (lista vacía = se puede cerrar, sin cambios).
 *
 * @param lines   las MISMAS líneas que van a calcTurno: `role` = rol efectivo del turno.
 * @param pool_barra_crc  barra efectivo + barra electrónico (lo mismo que recibe calcTurno).
 */
export function avisosCierrePropinas(
  lines: DraftLine[],
  pool_efectivo_crc: number,
  pool_efectivo_usd: number,
  pool_barra_crc: number,
  exchange_rate: number,
): AvisoCierre[] {
  const avisos: AvisoCierre[] = []

  // H1 — barra: misma condición que el sagrado usa para repartir (l.109–110), negada.
  const barra = Number(pool_barra_crc) || 0
  const horasBarra = lines
    .filter(l => l.active && BAR_ROLES.includes(l.role))
    .reduce((s, l) => s + (Number(l.hours) || 0), 0)
  if (barra > 0 && !(horasBarra > 0)) {
    avisos.push({ tipo: 'barra_sin_horas', monto: barra, texto: textoBarraSinHoras(barra), detalle: DETALLE_BARRA_SIN_HORAS })
  }

  // H2 — general: el pozo y los puntos salen del propio calcTurno (no se recalculan aparte).
  const { totals } = calcTurno(lines, pool_efectivo_crc, pool_efectivo_usd, 0, exchange_rate)
  if (totals.generalPool > 0 && !(totals.totalPoints > 0)) {
    avisos.push({ tipo: 'general_sin_puntos', monto: totals.generalPool, texto: textoGeneralSinPuntos(totals.generalPool), detalle: DETALLE_GENERAL_SIN_PUNTOS })
  }

  return avisos
}
