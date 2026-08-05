import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CashMovement } from '../types/database'

// Guard de dirección de traspaso (ítem 1a): en el BORDE de escritura, un movement_type='traspaso'
// DEBE tener subcategory que parsee 'A → B' (parseTraspaso). Se prueba en createDayMovement (valida
// su input) y updateCashMovement (valida el ESTADO RESULTANTE, leyendo la fila si hace falta). El
// traspaso del SISTEMA ('Caja Fuerte → Banco') pasa. Sagrado tipCalculations/cashUtils no se toca.

// Estado del mock: fila "actual" para el read del guard + registro de escrituras.
const state = vi.hoisted(() => ({
  currentRow: null as null | { movement_type: string | null; subcategory: string | null },
  writes: [] as { op: string }[],
}))

// Builder encadenable. Terminal de LECTURA = `.single()` → devuelve state.currentRow. Terminal de
// ESCRITURA = thenable (`.then`) → resuelve {error:null} y registra el op. Cada from() es fresco.
const { makeBuilder } = vi.hoisted(() => ({
  makeBuilder: () => {
    let op = ''
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      insert: () => { op = 'insert'; return b },
      update: () => { op = 'update'; return b },
      delete: () => { op = 'delete'; return b },
      select: () => { if (!op) op = 'select'; return b },
      eq: () => b,
      abortSignal: () => b,
      single: () => Promise.resolve({ data: state.currentRow, error: null }),
      then: (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) => {
        state.writes.push({ op })
        return Promise.resolve({ data: null, error: null }).then(res, rej)
      },
    })
    return b
  },
}))

vi.mock('./supabase', () => ({ supabase: { from: () => makeBuilder() } }))
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn(async () => {}), pendingOps: vi.fn(async () => []) }))

import { createDayMovement, updateCashMovement, TRASPASO_SIN_DIRECCION } from './cash'

const baseCreate = {
  created_by: 'u1', amount_crc: 1000, description: 'x', method: 'Efectivo', caja_origen: 'Caja Fuerte',
}
const upd = (o: Record<string, unknown>) => o as unknown as Partial<CashMovement>

describe('cash.ts — guard de dirección de traspaso (ítem 1a)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
    state.currentRow = null
    state.writes.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers() })

  // ── createDayMovement ──
  it('RECHAZA crear un traspaso sin dirección (subcategory sin flecha) y NO escribe', async () => {
    await expect(createDayMovement({ ...baseCreate, movement_type: 'traspaso', subcategory: 'Otro traspaso' }))
      .rejects.toThrow(TRASPASO_SIN_DIRECCION)
    expect(state.writes).toHaveLength(0)
  })
  it('RECHAZA crear un traspaso sin subcategory (undefined)', async () => {
    await expect(createDayMovement({ ...baseCreate, movement_type: 'traspaso' }))
      .rejects.toThrow(TRASPASO_SIN_DIRECCION)
  })
  it('ACEPTA crear un traspaso con dirección legible', async () => {
    await expect(createDayMovement({ ...baseCreate, movement_type: 'traspaso', subcategory: 'Banco → Caja Fuerte' }))
      .resolves.toEqual(expect.any(String))
    expect(state.writes.some(w => w.op === 'insert')).toBe(true)
  })
  it('ACEPTA el traspaso del SISTEMA (Caja Fuerte → Banco)', async () => {
    await expect(createDayMovement({ ...baseCreate, movement_type: 'traspaso', subcategory: 'Caja Fuerte → Banco' }))
      .resolves.toEqual(expect.any(String))
  })
  it('ACEPTA un no-traspaso sin importar la subcategory', async () => {
    await expect(createDayMovement({ ...baseCreate, movement_type: 'ingreso', subcategory: 'lo que sea' }))
      .resolves.toEqual(expect.any(String))
  })

  // ── updateCashMovement ──
  it('RECHAZA convertir a traspaso indeterminado (tipo+sub en el update) y NO escribe', async () => {
    await expect(updateCashMovement('id1', upd({ movement_type: 'traspaso', subcategory: '' })))
      .rejects.toThrow(TRASPASO_SIN_DIRECCION)
    expect(state.writes).toHaveLength(0)
  })
  it('ACEPTA convertir a traspaso con dirección legible (Caja Fuerte → Banco)', async () => {
    await expect(updateCashMovement('id1', upd({ movement_type: 'traspaso', subcategory: 'Caja Fuerte → Banco' })))
      .resolves.toBeUndefined()
    expect(state.writes.some(w => w.op === 'update')).toBe(true)
  })
  it('NO valida cuando el update no toca tipo ni subcategoría (aunque la fila sea un traspaso roto)', async () => {
    state.currentRow = { movement_type: 'traspaso', subcategory: '' } // si validara, tiraría
    await expect(updateCashMovement('id1', upd({ status: 'aprobado' }))).resolves.toBeUndefined()
  })
  it('LEE la fila actual cuando el update trae solo subcategory: rechaza si la fila ES traspaso', async () => {
    state.currentRow = { movement_type: 'traspaso', subcategory: 'Caja Fuerte → Banco' }
    await expect(updateCashMovement('id1', upd({ subcategory: 'Otro traspaso' })))
      .rejects.toThrow(TRASPASO_SIN_DIRECCION)
  })
  it('con solo subcategory NO rechaza si la fila NO es traspaso', async () => {
    state.currentRow = { movement_type: 'ingreso', subcategory: 'x' }
    await expect(updateCashMovement('id1', upd({ subcategory: 'cualquier cosa' }))).resolves.toBeUndefined()
  })
  it('con solo tipo=traspaso LEE la fila para la subcategory y acepta si es legible', async () => {
    state.currentRow = { movement_type: 'ingreso', subcategory: 'Caja Fuerte → Banco' }
    await expect(updateCashMovement('id1', upd({ movement_type: 'traspaso' }))).resolves.toBeUndefined()
  })
})
