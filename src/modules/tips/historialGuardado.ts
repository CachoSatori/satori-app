// ── Historial de propinas: lo GUARDADO manda (arreglo fuera de sagrados, 08-nov) ──────────────
//
// Módulo PURO. Historial y Quincenal reconstruían el reparto con calcHistory (sagrado, no se toca)
// a partir de los empleados que el usuario puede leer. Dos problemas medidos en prod:
//   · cajero y contador solo leen empleados ACTIVOS (RLS): en 259 turnos con gente hoy inactiva,
//     calcHistory descartaba esas entradas y les mostraba un reparto distinto del pagado;
//   · en 9 turnos de ene–feb lo recalculado no coincide con lo que se pagó en su momento.
// Acá no se recalcula nada: cada fila muestra el `payout_crc` GUARDADO (lo que se pagó), el pozo es
// el `pool_total_crc` guardado, y si faltan empleados en la vista se avisa con cuántos y cuánto.

import type { HistoryCalc } from '../../shared/utils/tipCalculations'

export interface EntradaGuardada {
  employee_id: string
  payout_crc:  number | null
}

export interface Faltantes {
  /** Entradas del turno cuyo empleado no está en la lista que ve este usuario. */
  entradas: number
  /** Lo que se les pagó (payout_crc guardado), en colones. */
  payout:   number
}

export interface CalcGuardado extends HistoryCalc {
  faltan: Faltantes
  /** true = la vista está incompleta: ₡/pto, puntos y el desglose de barra recalculados no valen. */
  incompleto: boolean
}

export function conPayoutsGuardados(
  calc: HistoryCalc,
  entradas: readonly EntradaGuardada[],
  empleadosVisibles: readonly { id: string }[],
  poolTotalGuardado: number | null | undefined,
): CalcGuardado {
  const guardado = new Map(entradas.map(e => [e.employee_id, e.payout_crc]))
  const visibles = new Set(empleadosVisibles.map(e => e.id))
  const faltan: Faltantes = { entradas: 0, payout: 0 }
  for (const e of entradas) {
    if (!visibles.has(e.employee_id)) {
      faltan.entradas += 1
      faltan.payout += Math.round(Number(e.payout_crc) || 0)
    }
  }
  const rows = calc.rows.map(r => {
    const p = guardado.get(r.employeeId)
    return p === null || p === undefined || !Number.isFinite(Number(p)) ? r : { ...r, payout_crc: Math.round(Number(p)) }
  })
  return {
    ...calc,
    rows,
    totalPool: poolTotalGuardado ?? calc.totalPool,
    faltan,
    incompleto: faltan.entradas > 0,
  }
}

/** El aviso para la pantalla, o null si no falta nadie. */
export function avisoFaltantes(f: Faltantes, fmt: (n: number) => string): string | null {
  if (f.entradas === 0) return null
  const quien = f.entradas === 1 ? '1 persona que hoy está inactiva no aparece' : `${f.entradas} personas que hoy están inactivas no aparecen`
  return `${quien} en esta vista (no tenés permiso para ver empleados inactivos). ` +
    `Lo que se les pagó (${fmt(f.payout)}) sí está en el pozo. Los montos de cada fila son los que se pagaron.`
}

export function esCalcGuardado(c: HistoryCalc | null | undefined): c is CalcGuardado {
  return !!c && 'faltan' in c
}
