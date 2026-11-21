import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CashMovement } from '../types/database'

// Borde de escritura de caja (20-nov, rehace lo útil del #73): createCashMovement, createDayMovement y
// updateCashMovement validan los montos (validarMovimiento) ANTES de escribir y ANTES de encolar sin conexión.
// Un inválido se rechaza con el mismo mensaje que la pantalla y NO llega ni al servidor ni a la cola.
// Montos de ejemplo, ficticios.

const state = vi.hoisted(() => ({
  fila: null as null | Record<string, unknown>,
  writes: [] as string[],
  reads: 0,
}))
const enqueue = vi.hoisted(() => vi.fn<(op: unknown, opts?: unknown) => Promise<void>>(async () => {}))

const { makeBuilder } = vi.hoisted(() => ({
  makeBuilder: () => {
    let op = ''
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      insert: () => { op = 'insert'; return b },
      update: () => { op = 'update'; return b },
      select: () => { if (!op) op = 'select'; return b },
      eq: () => b,
      abortSignal: () => b,
      single: () => {
        if (op === 'select') { state.reads++; return Promise.resolve({ data: state.fila, error: state.fila ? null : { message: 'no rows' } }) }
        state.writes.push(op); return Promise.resolve({ data: { id: 'srv' }, error: null })
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        state.writes.push(op); return Promise.resolve({ data: null, error: null }).then(res, rej)
      },
    })
    return b
  },
}))

vi.mock('./supabase', () => ({ supabase: { from: () => makeBuilder() } }))
vi.mock('../offline/outbox', () => ({ enqueue, pendingOps: vi.fn(async () => []) }))
vi.mock('../offline/ordenEscrituras', async () => {
  const real = await vi.importActual<typeof import('../offline/ordenEscrituras')>('../offline/ordenEscrituras')
  return { ...real, debeEncolarAhora: async () => false, estadoFilaAhora: async () => null }
})

import { createCashMovement, createDayMovement, updateCashMovement, MONTO_SIN_BASE } from './cash'
import {
  MSG_MONTO_CERO, MSG_MONTO_INVALIDO, MSG_MONTO_NEGATIVO, MSG_VUELTO_SOLO_INGRESO,
} from '../../modules/cash/validarMovimiento'

const setOnline = (onLine: boolean) =>
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true, writable: true })

const turno = (crc: unknown, usd: unknown, movement_type = 'egreso_operativo') => ({
  session_id: 's1', created_by: 'u1', movement_type: movement_type as never, amount_crc: crc as number, amount_usd: usd as number,
  currency: 'CRC' as const, exchange_rate: null, description: 'ejemplo', method: 'Efectivo', caja_origen: 'Caja Proveedores',
})
const dia = (crc: unknown, usd?: unknown, movement_type = 'egreso_operativo') => ({
  created_by: 'u1', movement_type, amount_crc: crc as number, amount_usd: usd as number | undefined,
  description: 'ejemplo', method: 'Efectivo', caja_origen: 'Caja Fuerte',
})
const upd = (o: Record<string, unknown>) => o as unknown as Partial<CashMovement>
const vuelto = { movement_type: 'ingreso' as const, amount_crc: -5000, amount_usd: 100 }

const nadaSalio = () => {
  expect(state.writes).toEqual([])
  expect(enqueue).not.toHaveBeenCalled()
}

beforeEach(() => {
  setOnline(true)
  state.fila = null; state.writes.length = 0; state.reads = 0
  enqueue.mockClear()
})

const INVALIDOS: [string, unknown, unknown, string][] = [
  ['vacío', '', '', MSG_MONTO_CERO],
  ['cero', 0, 0, MSG_MONTO_CERO],
  ['no numérico (NaN)', Number.NaN, 0, MSG_MONTO_INVALIDO],
  ['no numérico (texto)', 'abc', 0, MSG_MONTO_INVALIDO],
  ['negativo', -100, 0, MSG_MONTO_NEGATIVO],
]

describe.each([true, false])('altas con conexión = %s', online => {
  beforeEach(() => setOnline(online))

  it.each(INVALIDOS)('createCashMovement %s → rechaza y no escribe ni encola', async (_n, crc, usd, msg) => {
    await expect(createCashMovement(turno(crc, usd))).rejects.toThrow(msg)
    nadaSalio()
  })
  it.each(INVALIDOS)('createDayMovement %s → rechaza y no escribe ni encola', async (_n, crc, usd, msg) => {
    await expect(createDayMovement(dia(crc, usd))).rejects.toThrow(msg)
    nadaSalio()
  })
  it('createDayMovement sin amount_usd y con ₡ válido → pasa', async () => {
    await expect(createDayMovement(dia(1000))).resolves.toEqual(expect.any(String))
    expect(online ? state.writes : enqueue.mock.calls).toHaveLength(1)
  })
  it('createCashMovement válido → escribe (con red) o encola (sin red)', async () => {
    await createCashMovement(turno(1000, 0))
    if (online) { expect(state.writes).toEqual(['insert']); expect(enqueue).not.toHaveBeenCalled() }
    else { expect(enqueue).toHaveBeenCalledTimes(1); expect(state.writes).toEqual([]) }
  })
})

describe('updateCashMovement — valida el movimiento completo que quedaría', () => {
  it('sin conexión: vuelto pasado a egreso → rechaza y NO encola', async () => {
    setOnline(false)
    await expect(updateCashMovement('m1', upd({ movement_type: 'egreso_operativo' }), vuelto))
      .rejects.toThrow(MSG_VUELTO_SOLO_INGRESO)
    nadaSalio()
  })
  it('sin conexión: editar un vuelto válido (₡ −5000 → −4000) → se encola', async () => {
    setOnline(false)
    await expect(updateCashMovement('m1', upd({ amount_crc: -4000 }), vuelto)).resolves.toBeUndefined()
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][0]).toMatchObject({ op: 'update', payload: { match: { id: 'm1' }, updates: { amount_crc: -4000 } } })
  })
  it('sin conexión: el único monto en cero → rechaza y NO encola', async () => {
    setOnline(false)
    await expect(updateCashMovement('m1', upd({ amount_crc: 0 }), { movement_type: 'egreso_operativo', amount_crc: 5000, amount_usd: 0 }))
      .rejects.toThrow(MSG_MONTO_CERO)
    nadaSalio()
  })
  it('sin conexión y sin la fila de la pantalla: cambio parcial → rechaza (no se pudo validar) y NO encola', async () => {
    setOnline(false)
    await expect(updateCashMovement('m1', upd({ amount_crc: 3000 }))).rejects.toThrow(MONTO_SIN_BASE)
    expect(state.reads).toBe(0)   // sin red no se intenta leer (se colgaría hasta el timeout)
    nadaSalio()
  })
  it('sin conexión y sin fila, pero con los tres campos → valida con eso', async () => {
    setOnline(false)
    await expect(updateCashMovement('m1', upd({ movement_type: 'egreso_operativo', amount_crc: -1, amount_usd: 0 })))
      .rejects.toThrow(MSG_VUELTO_SOLO_INGRESO)
    nadaSalio()
    await expect(updateCashMovement('m1', upd({ movement_type: 'egreso_operativo', amount_crc: 1, amount_usd: 0 })))
      .resolves.toBeUndefined()
    expect(enqueue).toHaveBeenCalledTimes(1)
  })
  it('con conexión y sin la fila de la pantalla: lee la fila de la base y rechaza el egreso negativo', async () => {
    state.fila = { ...vuelto }
    await expect(updateCashMovement('m1', upd({ movement_type: 'egreso_mercaderia' }))).rejects.toThrow(MSG_VUELTO_SOLO_INGRESO)
    expect(state.reads).toBe(1)
    nadaSalio()
  })
  it('con conexión y la fila no aparece → rechaza, no escribe', async () => {
    state.fila = null
    await expect(updateCashMovement('m1', upd({ amount_usd: 10 }))).rejects.toThrow(MONTO_SIN_BASE)
    nadaSalio()
  })
  it('un update que no toca tipo ni montos no se valida ni lee la fila (estado, método…)', async () => {
    setOnline(false)
    await expect(updateCashMovement('m1', upd({ status: 'aprobado', method: 'Transferencia' }))).resolves.toBeUndefined()
    expect(state.reads).toBe(0)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })
})
