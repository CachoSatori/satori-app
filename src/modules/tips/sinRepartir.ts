// Aviso de plata sin repartir (H1/H2 de `tipCalculations.prop.test.ts`). Decisión del dueño (20-nov-2026):
// la pantalla TIENE que avisar cuando queda plata del pozo que nadie cobra. Solo avisa: no bloquea nada.
//
// A diferencia de `guardasCierre.ts` (que mira las CONDICIONES de entrada), esta función mira la SALIDA del
// reparto: monto sin repartir = totalPool − Σ lo que cobra cada uno (el payout redondeado al colón, que es lo
// que se guarda). El sagrado `src/shared/utils/tipCalculations.ts` NO se toca.
//
// Motivos:
//   · barra_sin_horas  — H1: pozo de barra > 0 y la barra suma 0 horas (misma condición que el sagrado, negada).
//   · nadie_con_puntos — H2: pozo general > 0 y la suma de puntos es 0 (generalRate = 0).
//   · redondeo         — defensa: resto ≥ ₡1 por persona sin H1 ni H2. El redondeo por persona del sagrado
//                        (H3) deja como máximo ₡0,5 por persona: eso NO se avisa.

import { BAR_ROLES, formatCRC, type DraftLine, type HistoryCalc, type PoolTotals } from '../../shared/utils/tipCalculations'
import type { UserRole } from '../../shared/types/database'

export type MotivoSinRepartir = 'barra_sin_horas' | 'nadie_con_puntos' | 'redondeo'

export interface SinRepartir {
  /** Colones enteros que quedan sin repartir (totalPool − Σ cobrado, redondeado). */
  monto: number
  motivos: MotivoSinRepartir[]
  texto: string
}

/** Una persona que cobra en el reparto: rol EFECTIVO del turno, horas y lo que cobra (₡ enteros). */
export interface PersonaReparto {
  role: UserRole
  hours: number
  cobra: number
}

type Pozo = Pick<PoolTotals, 'generalPool' | 'barraPool' | 'totalPool' | 'totalPoints'>

const MOTIVO_TEXTO: Record<MotivoSinRepartir, string> = {
  barra_sin_horas: 'hay propina de barra y nadie de barra tiene horas',
  nadie_con_puntos: 'hay pozo para repartir y nadie del turno tiene puntos u horas',
  redondeo: 'el redondeo por persona dejó un resto',
}

export function textoSinRepartir(monto: number, motivos: MotivoSinRepartir[]): string {
  const motivo = motivos.map(m => MOTIVO_TEXTO[m]).join(' y ')
  return `Quedan ${formatCRC(monto)} sin repartir: ${motivo}. Revisá las horas o los puntos antes de guardar.`
}

/** Núcleo puro. `null` = no hay nada que avisar. */
export function calcSinRepartir(pozo: Pozo, personas: PersonaReparto[]): SinRepartir | null {
  const cobrado = personas.reduce((s, p) => s + (Number(p.cobra) || 0), 0)
  const resto = (Number(pozo.totalPool) || 0) - cobrado
  const monto = Math.round(resto)

  const motivos: MotivoSinRepartir[] = []
  const horasBarra = personas
    .filter(p => BAR_ROLES.includes(p.role))
    .reduce((s, p) => s + (Number(p.hours) || 0), 0)
  if ((Number(pozo.barraPool) || 0) > 0 && !(horasBarra > 0)) motivos.push('barra_sin_horas')
  if ((Number(pozo.generalPool) || 0) > 0 && !(Number(pozo.totalPoints) > 0)) motivos.push('nadie_con_puntos')

  if (motivos.length) {
    return monto >= 1 ? { monto, motivos, texto: textoSinRepartir(monto, motivos) } : null
  }
  // Sin H1 ni H2: solo redondeo. Menos de ₡1 por persona (H3) no se avisa.
  if (resto >= Math.max(1, personas.length)) {
    return { monto, motivos: ['redondeo'], texto: textoSinRepartir(monto, ['redondeo']) }
  }
  return null
}

/**
 * Desde la salida de `calcTurno` (cierre del turno y edición en «Historial»). Las líneas tienen que ser las
 * que devolvió calcTurno (rol EFECTIVO, con cobertura). Cobra = Math.round(take_home), lo que se guarda.
 */
export function sinRepartirTurno(r: { totals: PoolTotals; updatedLines: DraftLine[] }): SinRepartir | null {
  const personas = r.updatedLines
    .filter(l => l.active)
    .map(l => ({ role: l.role, hours: Number(l.hours) || 0, cobra: Math.round(l.take_home) }))
  return calcSinRepartir(r.totals, personas)
}

/** Desde la salida de `calcHistory` (turnos cerrados: «Quincenal»). */
export function sinRepartirHistoria(c: HistoryCalc): SinRepartir | null {
  return calcSinRepartir(c, c.rows.map(r => ({ role: r.role, hours: r.hours, cobra: r.payout_crc })))
}
