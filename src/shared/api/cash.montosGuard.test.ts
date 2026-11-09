import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CashMovement } from '../types/database'

// Grok 107: el guard de montos corre ANTES de escribir y ANTES de encolar sin conexión. Un movimiento inválido no
// llega ni a la base ni a la cola (si llegara a la cola, el replay lo mandaría igual).
const H = vi.hoisted(() => ({ writes: 0, enqueued: 0, fila: { id: 'x' } as Record<string, unknown> }))
const { makeBuilder } = vi.hoisted(() => ({
  makeBuilder: () => {
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      insert: () => b, update: () => b, delete: () => b, select: () => b, eq: () => b, abortSignal: () => b,
      single: () => Promise.resolve({ data: H.fila, error: null }),
      then: (res: (v: { data: unknown; error: unknown }) => unknown) => { H.writes++; return Promise.resolve({ data: null, error: null }).then(res) },
    })
    return b
  },
}))
vi.mock('./supabase', () => ({ supabase: { from: () => makeBuilder() } }))
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn(async () => { H.enqueued++ }), pendingOps: vi.fn(async () => []) }))

import { createCashMovement, createDayMovement, updateCashMovement } from './cash'

const dia = { created_by: 'u1', description: 'x', method: 'Efectivo', caja_origen: 'Caja Fuerte' }
const turno = { ...dia, session_id: 's1', currency: 'CRC' as const, exchange_rate: null }
const offline = (v: boolean) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: !v }, configurable: true, writable: true })

beforeEach(() => { H.writes = 0; H.enqueued = 0; H.fila = { id: 'x' }; offline(false) })

describe('cash.ts — guard de montos (antes de escribir y antes de la cola)', () => {
  for (const sinRed of [false, true]) {
    const donde = sinRed ? 'sin conexión (no encola)' : 'con conexión (no escribe)'
    it(`egreso negativo: rechaza ${donde}`, async () => {
      offline(sinRed)
      await expect(createDayMovement({ ...dia, movement_type: 'egreso_operativo', amount_crc: -100 })).rejects.toThrow(/negativo/)
      await expect(createCashMovement({ ...turno, movement_type: 'egreso_operativo', amount_crc: -100, amount_usd: 0 })).rejects.toThrow(/negativo/)
      expect(H.writes + H.enqueued).toBe(0)
    })
    it(`NaN / infinito: rechaza ${donde}`, async () => {
      offline(sinRed)
      await expect(createDayMovement({ ...dia, movement_type: 'ingreso', amount_crc: Number.NaN })).rejects.toThrow(/válido/)
      await expect(createCashMovement({ ...turno, movement_type: 'ingreso', amount_crc: Infinity, amount_usd: 0 })).rejects.toThrow(/válido/)
      expect(H.writes + H.enqueued).toBe(0)
    })
  }

  it('ingreso con ₡ negativos y $ (vuelto): pasa (sin conexión, se encola)', async () => {
    offline(true)
    await createDayMovement({ ...dia, movement_type: 'ingreso', amount_crc: -1200, amount_usd: 40 })
    expect(H.enqueued).toBe(1)
  })

  it('update PARCIAL sin conexión (no se puede leer la fila): rechaza y no encola', async () => {
    offline(true)
    for (const u of [{ amount_crc: 100 }, { amount_usd: 5 }, { movement_type: 'ingreso' }, { movement_type: 'ingreso', amount_crc: 1 }]) {
      await expect(updateCashMovement('m1', u as Partial<CashMovement>)).rejects.toThrow(/movimiento completo/)
    }
    expect(H.enqueued).toBe(0)
  })

  it('update PARCIAL con conexión: lee la fila y valida el candidato completo', async () => {
    offline(false)
    H.fila = { movement_type: 'ingreso', amount_crc: -1200, amount_usd: 40 }   // ingreso con vuelto
    await expect(updateCashMovement('m1', { movement_type: 'egreso_operativo' } as Partial<CashMovement>)).rejects.toThrow(/negativo/)
    await expect(updateCashMovement('m1', { amount_usd: 0 } as Partial<CashMovement>)).rejects.toThrow(/vuelto/)
    expect(H.writes).toBe(0)
    await updateCashMovement('m1', { amount_crc: -1500 } as Partial<CashMovement>)   // sigue con dólares: pasa
    expect(H.writes).toBe(1)
  })

  it('update completo con un monto NaN o dólares negativos: no se encola', async () => {
    offline(true)
    await expect(updateCashMovement('m1', { movement_type: 'ingreso', amount_crc: Number.NaN, amount_usd: 0 } as Partial<CashMovement>)).rejects.toThrow(/válido/)
    await expect(updateCashMovement('m1', { movement_type: 'ingreso', amount_crc: 1, amount_usd: -1 } as Partial<CashMovement>)).rejects.toThrow(/dólares/)
    expect(H.enqueued).toBe(0)
  })

  it('update completo válido: se encola; update de otros campos: no pasa por el guard', async () => {
    offline(true)
    await updateCashMovement('m1', { movement_type: 'ingreso', amount_crc: -1200, amount_usd: 40 } as Partial<CashMovement>)
    await updateCashMovement('m1', { description: 'otra' } as Partial<CashMovement>)
    expect(H.enqueued).toBe(2)
  })

  it('update con tipo + montos: se valida el movimiento completo (ingreso con vuelto → egreso: rechaza)', async () => {
    offline(true)
    await expect(updateCashMovement('m1', { movement_type: 'egreso_operativo', amount_crc: -1200, amount_usd: 40 } as Partial<CashMovement>))
      .rejects.toThrow(/negativo/)
    expect(H.enqueued).toBe(0)
  })
})
