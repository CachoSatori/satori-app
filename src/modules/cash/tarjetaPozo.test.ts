import { describe, it, expect } from 'vitest'
import type { CashMovement, CashSession } from '../../shared/types/database'
import { saldoTarjetaEfectivo } from './tarjetaPozo'
import { saldoCajaFuerte } from './cashUtils'
import { POZO_CORTE } from './cierrePozo'

let n = 0
function mov(p: Partial<CashMovement>): CashMovement {
  n += 1
  return {
    id: p.id ?? `m${n}`,
    session_id: p.session_id ?? null,
    created_by: 'u1',
    movement_type: p.movement_type ?? 'ingreso',
    amount_crc: p.amount_crc ?? 0,
    amount_usd: p.amount_usd ?? 0,
    currency: 'CRC',
    exchange_rate: 500,
    description: p.description ?? '',
    subcategory: p.subcategory ?? '',
    supplier_id: null,
    supplier_name: null,
    employee_name: null,
    method: p.method ?? 'Efectivo',
    shift: '',
    caja_origen: p.caja_origen ?? 'Caja Fuerte',
    status: p.status ?? 'aprobado',
    approved_by: null,
    approved_at: null,
    account_id: null,
    created_at: p.created_at ?? `${POZO_CORTE}T12:00:00+00:00`,
    updated_at: p.created_at ?? `${POZO_CORTE}T12:00:00+00:00`,
  } as CashMovement
}

const ses = (id: string, session_date: string): CashSession =>
  ({ id, session_date, status: 'closed' }) as CashSession

/** Un día claramente anterior al corte. */
const ANTES = '2026-01-15'
const apertura = mov({
  subcategory: 'Apertura pozo',
  description: `Apertura pozo ${POZO_CORTE}`,
  amount_crc: 744_575,
  amount_usd: 3_441,
})

describe('tarjeta — PRE-corte: el histórico no se toca', () => {
  const viejos = [
    mov({ movement_type: 'ingreso', caja_origen: 'Caja Fuerte', amount_crc: 500_000, created_at: `${ANTES}T12:00:00+00:00`, session_id: 's0' }),
    mov({ movement_type: 'egreso_mercaderia', caja_origen: 'Caja Proveedores', amount_crc: 40_000, created_at: `${ANTES}T12:00:00+00:00`, session_id: 's0' }),
  ]
  const sessions = [ses('s0', ANTES)]

  it('muestra exactamente saldoCajaFuerte, sin el pozo', () => {
    const t = saldoTarjetaEfectivo(viejos, sessions)
    expect(t.esPozo).toBe(false)
    expect(t.crc).toBe(saldoCajaFuerte(viejos).crc)
    // El pago desde Caja Proveedores NO resta en el modelo viejo — así era y así queda.
    expect(t.crc).toBe(500_000)
  })
})

describe('tarjeta — POST-corte: el pozo, la regla original recuperada', () => {
  const sessions = [ses('s1', POZO_CORTE)]

  it('arranca en la apertura y no arrastra el histórico previo', () => {
    const historia = mov({
      movement_type: 'ingreso', caja_origen: 'Caja Fuerte', amount_crc: 9_000_000,
      created_at: `${ANTES}T12:00:00+00:00`, session_id: 's0',
    })
    const t = saldoTarjetaEfectivo([historia, apertura], [...sessions, ses('s0', ANTES)])
    expect(t.esPozo).toBe(true)
    expect(t.desdeApertura).toBe(POZO_CORTE)
    expect(t.crc).toBe(744_575)
    expect(t.usd).toBe(3_441)
  })

  it('CRITERIO DE ÉXITO: un egreso en efectivo de ₡10.000 desde Caja Proveedores baja la tarjeta EXACTAMENTE ₡10.000', () => {
    const egreso = mov({
      movement_type: 'egreso_mercaderia', caja_origen: 'Caja Proveedores',
      amount_crc: 10_000, method: 'Efectivo', session_id: 's1',
    })
    const antes = saldoTarjetaEfectivo([apertura], sessions)
    const despues = saldoTarjetaEfectivo([apertura, egreso], sessions)
    expect(antes.crc - despues.crc).toBe(10_000)
  })

  it('un movimiento por Transferencia/Banco NO mueve la tarjeta', () => {
    const base = saldoTarjetaEfectivo([apertura], sessions)
    const porBanco = mov({
      movement_type: 'egreso_mercaderia', caja_origen: 'Banco',
      method: 'Transferencia', amount_crc: 250_000, session_id: 's1',
    })
    const transferencia = mov({
      movement_type: 'egreso_operativo', caja_origen: 'Caja Proveedores',
      method: 'Transferencia', amount_crc: 80_000, session_id: 's1',
    })
    expect(saldoTarjetaEfectivo([apertura, porBanco, transferencia], sessions).crc).toBe(base.crc)
  })

  it('un traspaso interno entre cajas físicas es neutro', () => {
    const traspaso = mov({
      movement_type: 'traspaso', caja_origen: 'Registradora',
      subcategory: 'Registradora → Caja Fuerte', amount_crc: 300_000, session_id: 's1',
    })
    expect(saldoTarjetaEfectivo([apertura, traspaso], sessions).crc).toBe(744_575)
  })

  it('la propina pagada resta, y resta UNA sola vez', () => {
    const propina = mov({
      movement_type: 'egreso_personal', caja_origen: 'Registradora',
      subcategory: 'Propinas por turno', amount_crc: 27_850, session_id: 's1',
    })
    expect(saldoTarjetaEfectivo([apertura, propina], sessions).crc).toBe(744_575 - 27_850)
  })

  it('la regla vieja y la nueva difieren justo en lo que el modelo viejo no veía', () => {
    // Éste es el bug que la dueña reportó: pagar del fondo no movía la tarjeta.
    const egresoFondo = mov({
      movement_type: 'egreso_mercaderia', caja_origen: 'Caja Proveedores',
      amount_crc: 10_000, session_id: 's1',
    })
    const movs = [apertura, egresoFondo]
    expect(saldoCajaFuerte(movs).crc).toBe(744_575)            // el viejo lo ignora
    expect(saldoTarjetaEfectivo(movs, sessions).crc).toBe(734_575) // el pozo sí lo ve
  })

  it('expone los traspasos sin dirección legible en vez de esconderlos', () => {
    const raro = mov({
      movement_type: 'traspaso', caja_origen: 'Registradora',
      subcategory: '', amount_crc: 6_180, session_id: 's1',
    })
    const t = saldoTarjetaEfectivo([apertura, raro], sessions)
    expect(t.crc).toBe(744_575)
    expect(t.indeterminados).toEqual({ cantidad: 1, crc: 6_180, usd: 0 })
  })

  it('sin apertura sembrada pero con movimientos post-corte, igual usa el pozo', () => {
    const hoy = mov({
      movement_type: 'egreso_operativo', caja_origen: 'Caja Proveedores',
      amount_crc: 5_000, session_id: 's1',
    })
    const t = saldoTarjetaEfectivo([hoy], sessions)
    expect(t.esPozo).toBe(true)
    expect(t.desdeApertura).toBeNull()
    expect(t.crc).toBe(-5_000)
  })
})
