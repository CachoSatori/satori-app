import { describe, it, expect } from 'vitest'
import { propKey, propinaEgresoFields, propinasPorPagarDe, propinasPagadasEnFecha } from './propinaPago'
import type { CashMovement, CashSession } from '../../shared/types/database'
import type { TipPayoutSummary } from '../../shared/api/tips'

// propinaPago — la vía real COMPARTIDA (FIRMADO). Estos tests fijan:
//   1. La forma EXACTA del egreso (si cambia, las dos puertas divergen y el saldado se rompe).
//   2. El saldado: un movimiento (pagado O pendiente) saca el turno de la lista → pagar desde
//      el cierre salda el pendiente y no se puede duplicar (el botón desaparece).
//   3. propinasPagadasEnFecha: SOLO status aprobado, atribuido al día en que la plata salió
//      (fecha del turno pagador, o dateCR(created_at) a nivel día).

const tip = (over: Partial<TipPayoutSummary> = {}): TipPayoutSummary => ({
  session_id: 'tip-1', session_date: '2026-07-03', shift_type: 'AM', total_payout_crc: 12000, ...over,
})

const mov = (over: Partial<CashMovement>): CashMovement => ({
  id: 'm1', session_id: null, subcategory: 'Propinas por turno', status: 'aprobado',
  amount_crc: 12000, amount_usd: 0, movement_type: 'egreso_personal', caja_origen: 'Registradora',
  description: 'Propinas turno 2026-07-03 Mediodía', created_at: '2026-07-03T12:00:00Z',
  ...over,
} as CashMovement)

const sesion = (id: string, date: string): CashSession => ({ id, session_date: date } as CashSession)

describe('propinaPago — forma del egreso (idéntica en las dos puertas)', () => {
  it('propKey usa la convención de reconcilePropinaEgreso (fecha + turno legible)', () => {
    expect(propKey(tip())).toBe('Propinas turno 2026-07-03 Mediodía')
    expect(propKey(tip({ shift_type: 'PM' }))).toBe('Propinas turno 2026-07-03 Noche')
  })

  it('propinaEgresoFields produce EXACTAMENTE la forma histórica de pagarPropina', () => {
    expect(propinaEgresoFields(tip())).toEqual({
      movement_type: 'egreso_personal',
      amount_crc:    12000,
      amount_usd:    0,
      currency:      'CRC',
      description:   'Propinas turno 2026-07-03 Mediodía',
      subcategory:   'Propinas por turno',
      method:        'Efectivo',
      caja_origen:   'Registradora',
      shift:         'Mediodía',
    })
  })
})

describe('propinaPago — propinasPorPagarDe (saldado, sin duplicar)', () => {
  it('sin movimiento registrado → el turno aparece por pagar', () => {
    expect(propinasPorPagarDe([tip()], [])).toHaveLength(1)
  })

  it('PAGADO (aprobado) → saldado: desaparece de la lista (no se puede pagar dos veces)', () => {
    expect(propinasPorPagarDe([tip()], [mov({})])).toHaveLength(0)
  })

  it('dejado PENDIENTE → también saldado (se gestiona en Pendientes, no se re-ofrece)', () => {
    expect(propinasPorPagarDe([tip()], [mov({ status: 'pendiente' })])).toHaveLength(0)
  })

  it('movimiento rechazado NO salda; y el corte histórico excluye turnos viejos', () => {
    expect(propinasPorPagarDe([tip()], [mov({ status: 'rechazado' })])).toHaveLength(1)
    expect(propinasPorPagarDe([tip({ session_date: '2026-01-01' })], [])).toHaveLength(0)  // < PROPINAS_POR_PAGAR_DESDE
  })
})

describe('propinaPago — propinasPagadasEnFecha (lo que resta del cierre)', () => {
  const F = '2026-07-03'

  it('puerta Caja Diaria: movimiento con turno de HOY, aprobado → suma', () => {
    const ms = [mov({ session_id: 's-hoy' })]
    expect(propinasPagadasEnFecha(ms, [sesion('s-hoy', F)], F)).toBe(12000)
  })

  it('puerta cierre: movimiento a nivel día con created_at de HOY → suma', () => {
    expect(propinasPagadasEnFecha([mov({})], [], F)).toBe(12000)
  })

  it('PENDIENTE no suma nada — la plata sigue en la caja hasta pagarse', () => {
    expect(propinasPagadasEnFecha([mov({ status: 'pendiente' })], [], F)).toBe(0)
  })

  it('pagos de OTRO día no suman en esta fecha', () => {
    expect(propinasPagadasEnFecha([mov({ created_at: '2026-07-02T12:00:00Z' })], [], F)).toBe(0)
    const deTurnoAyer = [mov({ session_id: 's-ayer' })]
    expect(propinasPagadasEnFecha(deTurnoAyer, [sesion('s-ayer', '2026-07-02')], F)).toBe(0)
  })

  it('turno VIEJO pagado HOY desde el cierre (nivel día, created_at hoy) resta HOY — la plata sale hoy', () => {
    const viejoPagadoHoy = mov({ description: 'Propinas turno 2026-06-28 Noche', created_at: `${F}T12:00:00Z` })
    expect(propinasPagadasEnFecha([viejoPagadoHoy], [], F)).toBe(12000)
  })

  it('mixtas: suma solo las aprobadas del día', () => {
    const ms = [
      mov({ id: 'a', amount_crc: 10000 }),
      mov({ id: 'b', amount_crc: 7000, status: 'pendiente' }),
      mov({ id: 'c', amount_crc: 5000, description: 'Propinas turno 2026-07-03 Noche' }),
      mov({ id: 'd', amount_crc: 9999, subcategory: 'Otra cosa' }),
    ]
    expect(propinasPagadasEnFecha(ms, [], F)).toBe(15000)
  })
})
