import { describe, it, expect, vi } from 'vitest'
import { propKey, propinaEgresoFields, propinasPorPagarDe, propinasPagadasEnFecha } from './propinaPago'
import type { CashMovement, CashSession } from '../../shared/types/database'
import { totalElectronicoCrc, summarizeTipPayouts, type TipPayoutSummary } from '../../shared/api/tips'

// Importar VALORES de shared/api/tips arrastra el cliente de supabase (exige env vars) → sin este
// mock, la suite revienta en clon fresco/CI: "Faltan variables de entorno de Supabase". Mismo
// patrón que CashTurno.editAuth.test.tsx. Estos tests solo usan funciones puras (no tocan la red).
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))

// propinaPago — la vía real COMPARTIDA (FIRMADO). Estos tests fijan:
//   1. La forma EXACTA del egreso (si cambia, las dos puertas divergen y el saldado se rompe).
//   2. El saldado: un movimiento (pagado O pendiente) saca el turno de la lista → pagar desde
//      el cierre salda el pendiente y no se puede duplicar (el botón desaparece).
//   3. propinasPagadasEnFecha: SOLO status aprobado, atribuido al día en que la plata salió
//      (fecha del turno pagador, o dateCR(created_at) a nivel día).

// total_payout_crc (reparto completo) ≠ total_electronico_crc (la cuenta por pagar) a propósito:
// así los tests distinguen que el egreso usa el ELECTRÓNICO, no el reparto completo.
const tip = (over: Partial<TipPayoutSummary> = {}): TipPayoutSummary => ({
  session_id: 'tip-1', session_date: '2026-07-03', shift_type: 'AM',
  total_payout_crc: 20000, total_electronico_crc: 12000, ...over,
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

  it('propinaEgresoFields: forma histórica, pero amount_crc = ELECTRÓNICO (no el reparto completo)', () => {
    expect(propinaEgresoFields(tip())).toEqual({
      movement_type: 'egreso_personal',
      amount_crc:    12000,   // total_electronico_crc, NO total_payout_crc (20000)
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

  // ── Propina pendiente saldada por BANCO desde Pendientes ──────────────────────────────
  // No sacó efectivo de la caja (el turno ya había cerrado), así que no puede restar del
  // efectivo esperado del cierre. "Pagar ahora" sigue siendo efectivo y sigue restando.
  it('(a) pagada por TRANSFERENCIA → NO resta del efectivo esperado', () => {
    expect(propinasPagadasEnFecha([mov({ method: 'Transferencia', caja_origen: 'Banco' })], [], F)).toBe(0)
  })

  it('(b) pagada en EFECTIVO → sigue restando igual que hoy', () => {
    expect(propinasPagadasEnFecha([mov({ method: 'Efectivo' })], [], F)).toBe(12000)
  })

  it('backward-compatible: filas históricas SIN method siguen restando', () => {
    expect(propinasPagadasEnFecha([mov({})], [], F)).toBe(12000)
  })

  it('mixtas efectivo + banco: solo el efectivo resta', () => {
    const ms = [
      mov({ id: 'ef',    amount_crc: 10000, method: 'Efectivo' }),
      mov({ id: 'banco', amount_crc: 25000, method: 'Transferencia', caja_origen: 'Banco' }),
    ]
    expect(propinasPagadasEnFecha(ms, [], F)).toBe(10000)
  })

  it('la pagada por banco SIGUE saldando el turno (no reaparece en "Propinas por pagar")', () => {
    const porBanco = mov({ method: 'Transferencia', caja_origen: 'Banco' })
    expect(propinasPorPagarDe([tip()], [porBanco])).toHaveLength(0)
  })
})

// ── El payable = SOLO lo electrónico (FIRMADO propinas-efectivo-electronico) ──────────────
// La cuenta por pagar se genera solo por la porción electrónica; el efectivo se lo queda el
// equipo y NUNCA genera pendiente. Estas pruebas fijan la fórmula pura y el filtro de la lista.

const entry = (crc: number, usd = 0) => ({ tip_amount_crc: crc, tip_amount_usd: usd })

describe('totalElectronicoCrc — fórmula pura del payable', () => {
  it('turno SOLO EFECTIVO → 0 payable (sin electrónico individual ni barra electrónica)', () => {
    expect(totalElectronicoCrc([entry(0), entry(0)], 640, 0)).toBe(0)
  })

  it('turno MIXTO → Σ electrónico exacto: ₡ + $×TC + barra electrónica', () => {
    // 8.000 + 4.000 (₡) + (10 + 5)$ × 600 = 12.000 + 9.000 = 21.000, + 3.000 barra elec = 24.000
    const entries = [entry(8000, 10), entry(4000, 5)]
    expect(totalElectronicoCrc(entries, 600, 3000)).toBe(24000)
  })

  it('barra ef + elec → SOLO la electrónica cuenta (la efectiva ni se pasa a esta fórmula)', () => {
    // Solo se le pasa la barra ELECTRÓNICA (7.000). La barra EFECTIVO (p.ej. 5.000) no entra acá.
    expect(totalElectronicoCrc([entry(0)], 640, 7000)).toBe(7000)
  })

  it('tolera nulls en las entries', () => {
    expect(totalElectronicoCrc([{ tip_amount_crc: null, tip_amount_usd: null }], 640, 0)).toBe(0)
  })
})

describe('summarizeTipPayouts — arma la lista y filtra por electrónico > 0', () => {
  const row = (over: Partial<Parameters<typeof summarizeTipPayouts>[0][number]> = {}) => ({
    id: 's1', session_date: '2026-07-03', shift_type: 'PM', exchange_rate: 600,
    pool_barra_electronico_crc: 0,
    tip_entries: [{ payout_crc: 50000, tip_amount_crc: 0, tip_amount_usd: 0 }],
    ...over,
  })

  it('turno SOLO EFECTIVO (payout > 0 pero electrónico 0) → FUERA de la lista', () => {
    // payout_crc 50.000 (repartido del efectivo) pero total_electronico_crc 0 → excluido.
    expect(summarizeTipPayouts([row()])).toHaveLength(0)
  })

  it('turno MIXTO → dentro, con payout completo Y electrónico exacto', () => {
    const [r] = summarizeTipPayouts([row({
      tip_entries: [
        { payout_crc: 40000, tip_amount_crc: 8000, tip_amount_usd: 10 },
        { payout_crc: 20000, tip_amount_crc: 4000, tip_amount_usd: 0 },
      ],
      pool_barra_electronico_crc: 3000,
    })])
    expect(r.total_payout_crc).toBe(60000)                 // reparto completo, para display
    expect(r.total_electronico_crc).toBe(8000 + 4000 + 10 * 600 + 3000)  // = 21.000
  })

  it('barra ef + elec: solo la barra electrónica llega al payable (la efectiva no está en la fila)', () => {
    const [r] = summarizeTipPayouts([row({
      tip_entries: [{ payout_crc: 80000, tip_amount_crc: 0, tip_amount_usd: 0 }],
      pool_barra_electronico_crc: 9000,
    })])
    expect(r.total_electronico_crc).toBe(9000)
  })
})
