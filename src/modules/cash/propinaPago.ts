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
// MONTO (FIRMADO propinas-efectivo-electronico): el egreso es la porción ELECTRÓNICA
// (total_electronico_crc), no el reparto completo — el efectivo ya está en mano del equipo.
// La convención del movimiento NO cambia (propKey, subcategoría, caja_origen, método): solo el monto.
export function propinaEgresoFields(p: TipPayoutSummary) {
  return {
    movement_type: 'egreso_personal' as const,
    amount_crc:    p.total_electronico_crc,
    amount_usd:    0,
    currency:      'CRC' as const,
    description:   propKey(p),
    subcategory:   'Propinas por turno',   // → finance.ts lo excluye del P&L (pass-through)
    method:        'Efectivo',
    caja_origen:   'Registradora',
    shift:         tipShiftToCaja(p.shift_type),
  }
}

// Aprobación de una propina que quedó PENDIENTE: se salda por BANCO, venga de la puerta que
// venga (la pestaña Pendientes o el select de estado de Movimientos). UNA SOLA VÍA.
//
// POR QUÉ NO EN EFECTIVO — es el origen del "ajuste fantasma ≈ propinas":
// propinasPagadasEnFecha atribuye el pago a la fecha de la SESIÓN del movimiento, que es la del
// día en que la propina se dejó pendiente. Ese día ya está sellado, así que una aprobación en
// efectivo no resta en el "debería" de NINGÚN día y el cierre aparece con un faltante ≈ el monto
// de la propina. Saldándola por banco la plata no sale de la caja y el descuadre no existe.
//
// NO confundir con propinaEgresoFields ("Pagar ahora" = Efectivo/Registradora): ese SÍ saca
// efectivo, pero en el día correcto, así que resta donde tiene que restar.
export function aprobacionPropinaFields() {
  return {
    status:      'aprobado' as const,
    method:      'Transferencia',
    caja_origen: 'Banco',
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

// Propinas efectivamente PAGADAS EN EFECTIVO (status aprobado) cuya plata salió en `fecha`:
//   · movimiento con turno → la fecha del turno (puerta Caja Diaria);
//   · movimiento a nivel día → dateCR(created_at) (puerta cierre — createDayMovement backdatea
//     created_at a la fecha del cierre, así un turno VIEJO pagado hoy resta HOY, que es cuando
//     la plata sale físicamente).
// Los PENDIENTES no suman nada: la plata sigue en la caja hasta pagarse (flujo proveedor).
// Las pagadas por TRANSFERENCIA tampoco: una propina que se dejó pendiente y se saldó por banco
// (desde Pendientes) nunca sacó efectivo de la caja, así que no puede restar del cierre. El
// filtro es `!== 'Transferencia'` y no `=== 'Efectivo'` a propósito: las filas históricas sin
// method (o con otro medio en efectivo) siguen contando como hasta hoy.
export function propinasPagadasEnFecha(movements: CashMovement[], sessions: CashSession[], fecha: string): number {
  const sesionFecha = new Map(sessions.map(s => [s.id, s.session_date]))
  return movements
    .filter(m => m.subcategory === 'Propinas por turno'
      && m.status === 'aprobado'
      && m.method !== 'Transferencia'
      && (sesionFecha.get(m.session_id ?? '') ?? dateCR(m.created_at)) === fecha)
    .reduce((s, m) => s + (m.amount_crc || 0), 0)
}
