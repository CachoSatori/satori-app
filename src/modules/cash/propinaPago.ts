/**
 * propinaPago — plomería COMPARTIDA del pago de propinas (FIRMADO: una sola vía, dos puertas).
 *
 * La vía real de pago de propinas es una sola: un movimiento egreso_personal 'Propinas por
 * turno' desde la Registradora, con description = propKey (la convención que ya usan
 * reconcilePropinaEgreso y el saldado del pendiente). Este módulo extrae esa forma para que
 * la usen las DOS puertas sin divergir:
 *   · Caja Diaria (CashTurno.pagarPropina) — movimiento con session_id del turno abierto.
 *   · Cierre del Día (CashCierre)          — movimiento a nivel día (createDayMovement).
 *
 * También viven acá los derivados PUROS que alimentan la matemática del cierre:
 *   · propinasPorPagarDe — qué turnos de propinas siguen sin registrar (mismo criterio que
 *     CashTurno: un movimiento con esa description, aprobado O pendiente, lo salda).
 *   · propinasPagadasEnFecha — cuánto se PAGÓ efectivamente (status aprobado) en una fecha,
 *     por movimientos reales del libro. Los PENDIENTES no suman: la plata sigue en la caja.
 *
 * GUARDRAIL: acá NO vive la fórmula de propinas (tipCalculations intocable) — solo el pago.
 */
import type { CashMovement, CashSession } from '../../shared/types/database'
import type { TipPayoutSummary } from '../../shared/api/tips'
import { shiftLabel, tipShiftToCaja, dateCR } from '../../shared/utils'
import { PROPINAS_POR_PAGAR_DESDE } from './cashUtils'

// Clave del movimiento de propinas (misma convención que reconcilePropinaEgreso).
export const propKey = (p: TipPayoutSummary) => `Propinas turno ${p.session_date} ${shiftLabel(p.shift_type)}`

// Forma EXACTA del egreso de propinas (la que CashTurno.pagarPropina creaba inline).
// El caller agrega session_id/created_by/status (y exchange_rate en la puerta de turno).
export function propinaEgresoFields(p: TipPayoutSummary) {
  return {
    movement_type: 'egreso_personal' as const,
    amount_crc:    p.total_payout_crc,
    amount_usd:    0,
    currency:      'CRC' as const,
    description:   propKey(p),
    subcategory:   'Propinas por turno',   // → finance.ts lo excluye del P&L (pass-through)
    method:        'Efectivo',
    caja_origen:   'Registradora',
    shift:         tipShiftToCaja(p.shift_type),
  }
}

// Turnos de propinas aún SIN registrar en Caja (ni pagados ni dejados pendientes) — mismo
// criterio que la sección "Propinas por pagar" de CashTurno: la description saldada (con
// cualquier status salvo rechazado) lo saca de la lista; el corte histórico aplica igual.
export function propinasPorPagarDe(payouts: TipPayoutSummary[], movements: CashMovement[]): TipPayoutSummary[] {
  const registradas = new Set(
    movements
      .filter(m => m.subcategory === 'Propinas por turno' && m.status !== 'rechazado')
      .map(m => m.description))
  return payouts.filter(p => p.session_date >= PROPINAS_POR_PAGAR_DESDE && !registradas.has(propKey(p)))
}

// Propinas efectivamente PAGADAS (status aprobado) cuya plata salió en `fecha`:
//   · movimiento con turno → la fecha del turno (puerta Caja Diaria);
//   · movimiento a nivel día → dateCR(created_at) (puerta cierre — createDayMovement backdatea
//     created_at a la fecha del cierre, así un turno VIEJO pagado hoy resta HOY, que es cuando
//     la plata sale físicamente).
// Los PENDIENTES no suman nada: la plata sigue en la caja hasta pagarse (flujo proveedor).
export function propinasPagadasEnFecha(movements: CashMovement[], sessions: CashSession[], fecha: string): number {
  const sesionFecha = new Map(sessions.map(s => [s.id, s.session_date]))
  return movements
    .filter(m => m.subcategory === 'Propinas por turno'
      && m.status === 'aprobado'
      && (sesionFecha.get(m.session_id ?? '') ?? dateCR(m.created_at)) === fecha)
    .reduce((s, m) => s + (m.amount_crc || 0), 0)
}
