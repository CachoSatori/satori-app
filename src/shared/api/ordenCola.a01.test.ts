// A01 (verificador #234, punto 3): con cola pendiente (o la fila en rechazadas), las escrituras con red
// de caja y propinas van DETRÁS de la cola; un borrado de un movimiento que no está en el servidor se frena.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  encolar: false,
  fila: null as null | 'pendiente' | 'rechazada' | 'desconocido',
  writes: [] as string[],
  keys: [] as Array<string | undefined>,
}))
const enqueue = vi.hoisted(() => vi.fn<(op: unknown, opts?: unknown) => Promise<void>>(async () => {}))

const { makeBuilder } = vi.hoisted(() => ({
  makeBuilder: () => {
    let op = ''
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      insert: () => { op = 'insert'; return b }, upsert: () => { op = 'upsert'; return b },
      update: () => { op = 'update'; return b }, delete: () => { op = 'delete'; return b },
      select: () => b, eq: () => b, abortSignal: () => b,
      single: () => { state.writes.push(op); return Promise.resolve({ data: { id: 'srv' }, error: null }) },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        state.writes.push(op); return Promise.resolve({ data: null, error: null }).then(res, rej)
      },
    })
    return b
  },
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: () => makeBuilder(),
    rpc: () => ({ abortSignal: () => { state.writes.push('rpc'); return Promise.resolve({ error: null }) } }),
  },
}))
vi.mock('../offline/outbox', () => ({ enqueue, pendingOps: vi.fn(async () => []) }))
vi.mock('../offline/ordenEscrituras', async () => {
  const real = await vi.importActual<typeof import('../offline/ordenEscrituras')>('../offline/ordenEscrituras')
  return {
    ...real,
    debeEncolarAhora: async (key?: string) => { state.keys.push(key); return state.encolar },
    estadoFilaAhora: async () => state.fila,
  }
})

import { createCashMovement, createDayMovement, updateCashMovement, deleteCashMovement } from './cash'
import { upsertTipEntry, deleteTipEntry } from './tips'
import { BORRAR_PENDIENTE, BORRAR_RECHAZADA, BORRAR_SIN_ORDEN, cashKey, tipKey } from '../offline/ordenEscrituras'
import type { CashMovement } from '../types/database'

const mov = {
  session_id: 's1', created_by: 'u1', movement_type: 'egreso' as never, amount_crc: 1000, amount_usd: 0,
  currency: 'CRC' as const, exchange_rate: null, description: 'ejemplo', method: 'Efectivo', caja_origen: 'Caja Proveedores',
}
const tip = { session_id: 't1', employee_id: 'e1', hours_worked: 4, tip_amount_crc: 100, tip_amount_usd: 0 }

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
  state.encolar = false; state.fila = null; state.writes.length = 0; state.keys.length = 0
  enqueue.mockClear()
})

describe('A01 — escrituras con red respetan la cola', () => {
  it('createCashMovement con cola pendiente → se encola (kick) y NO va directo al servidor', async () => {
    state.encolar = true
    const r = await createCashMovement(mov)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][1]).toEqual({ kick: true })
    expect(state.writes).toEqual([])
    expect((r as unknown as { _pending?: boolean })._pending).toBe(true)
  })
  it('createCashMovement sin cola → directo al servidor', async () => {
    await createCashMovement(mov)
    expect(enqueue).not.toHaveBeenCalled()
    expect(state.writes).toEqual(['insert'])
  })
  it('createDayMovement con cola pendiente → se encola', async () => {
    state.encolar = true
    await createDayMovement({ created_by: 'u1', amount_crc: 1000, description: 'x', method: 'Efectivo', caja_origen: 'Caja Fuerte', movement_type: 'ingreso' })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(state.writes).toEqual([])
  })
  it('updateCashMovement con la fila pendiente/rechazada → update encolado, mira la fila correcta', async () => {
    state.encolar = true
    await updateCashMovement('M', { amount_crc: 2000 } as Partial<CashMovement>)
    expect(state.keys).toContain(cashKey('M'))
    expect(enqueue.mock.calls[0][0]).toMatchObject({ op: 'update', payload: { match: { id: 'M' } } })
    expect(state.writes).toEqual([])
  })
  it('deleteCashMovement de un movimiento pendiente → se frena con aviso, sin RPC', async () => {
    state.fila = 'pendiente'
    await expect(deleteCashMovement('M', 'motivo')).rejects.toThrow(BORRAR_PENDIENTE)
    expect(state.writes).toEqual([])
  })
  it('deleteCashMovement de un movimiento rechazado → se frena con aviso, sin RPC', async () => {
    state.fila = 'rechazada'
    await expect(deleteCashMovement('M', 'motivo')).rejects.toThrow(BORRAR_RECHAZADA)
    expect(state.writes).toEqual([])
  })
  it('deleteCashMovement sin poder confirmar el orden (IndexedDB no respondió) → se frena, sin RPC', async () => {
    state.fila = 'desconocido'
    await expect(deleteCashMovement('M', 'motivo')).rejects.toThrow(BORRAR_SIN_ORDEN)
    expect(state.writes).toEqual([])
  })
  it('deleteCashMovement normal → RPC', async () => {
    await deleteCashMovement('M', 'motivo')
    expect(state.writes).toEqual(['rpc'])
  })
  it('upsertTipEntry con la fila bloqueada → se encola, mira (turno, persona)', async () => {
    state.encolar = true
    await upsertTipEntry(tip)
    expect(state.keys).toContain(tipKey('t1', 'e1'))
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(state.writes).toEqual([])
  })
  it('deleteTipEntry con la fila bloqueada → se encola', async () => {
    state.encolar = true
    await deleteTipEntry('t1', 'e1')
    expect(enqueue.mock.calls[0][0]).toMatchObject({ table: 'tip_entries', op: 'delete' })
    expect(state.writes).toEqual([])
  })
})
