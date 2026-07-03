import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// discardDiaCompleto (borrar el día) debe enrutar el borrado de CADA cash_movement por la RPC
// delete_movement_cascade (mig 039) — NUNCA con un `.delete()` plano sobre cash_movements, que
// dejaría accounting_entries huérfanos (source_id a un movimiento inexistente, sin reversa) e
// inventory_review_task colgadas, sin auditoría. El cierre (cash_cierres_dia) y las sesiones
// (cash_sessions) SÍ van por `.delete()` crudo (no tocan el libro), pero SOLO después de los
// movimientos. Este test fija ambos invariantes: ruta por RPC + orden.

const calls: string[] = []
const rpcArgs: Array<Record<string, unknown>> = []

const { rpcSpy } = vi.hoisted(() => ({ rpcSpy: vi.fn() }))

// thenable que soporta .abortSignal() (lo exige deleteCashMovement vía withWriteTimeout)
const rpcBuilder = {
  abortSignal: () => rpcBuilder,
  then: (res: (v: { error: null }) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(res, rej),
}

// Builder de `.from(table)`: encadena select/delete/filtros, soporta .abortSignal() y es thenable.
// Devuelve ids de movimientos en los SELECT; si alguien intenta `.delete()` sobre cash_movements,
// REVIENTA (es justo el bug que esto previene).
function makeBuilder(table: string) {
  const state = { op: 'select' as 'select' | 'delete', filter: '' as '' | 'in' | 'is' }
  const builder = {
    select: () => builder,
    delete: () => { state.op = 'delete'; return builder },
    eq: () => builder,
    in: () => { state.filter = 'in'; return builder },
    is: () => { state.filter = 'is'; return builder },
    gte: () => builder,
    lt: () => builder,
    abortSignal: () => builder,
    then(res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) {
      if (table === 'cash_movements' && state.op === 'delete') {
        throw new Error('discardDiaCompleto NO debe borrar cash_movements con .delete() plano: va por la RPC')
      }
      let data: unknown = null
      if (table === 'cash_sessions' && state.op === 'select') data = [{ id: 'sess-1' }]
      else if (table === 'cash_movements' && state.op === 'select') {
        // step 1 (.in session_id) → movimientos de turno; step 2 (.is null) → nivel día
        data = state.filter === 'in' ? [{ id: 'turn-mov-1' }, { id: 'turn-mov-2' }] : [{ id: 'day-mov-1' }]
      }
      calls.push(`${table}.${state.op}`)
      return Promise.resolve({ data, error: null }).then(res, rej)
    },
  }
  return builder
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: rpcSpy,
  },
}))
vi.mock('../offline/outbox', () => ({ enqueue: vi.fn(), pendingOps: vi.fn(async () => []) }))

describe('cash.ts — discardDiaCompleto enruta por delete_movement_cascade (no .delete() crudo)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
    calls.length = 0
    rpcArgs.length = 0
    rpcSpy.mockReset()
    rpcSpy.mockImplementation((fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${fn}`)
      rpcArgs.push(args)
      return rpcBuilder
    })
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'navigator')
  })

  it('borra CADA movimiento (turno + nivel-día) por la RPC, con la nota del día', async () => {
    const { discardDiaCompleto } = await import('./cash')
    await discardDiaCompleto('2026-06-20')

    const rpcCalls = calls.filter(c => c === 'rpc:delete_movement_cascade')
    expect(rpcCalls).toHaveLength(3)
    expect(rpcArgs).toEqual([
      { p_movement_id: 'turn-mov-1', p_note: 'Borrado de día completo 2026-06-20' },
      { p_movement_id: 'turn-mov-2', p_note: 'Borrado de día completo 2026-06-20' },
      { p_movement_id: 'day-mov-1', p_note: 'Borrado de día completo 2026-06-20' },
    ])
  })

  it('respeta el orden: todos los movimientos (RPC) ANTES de borrar cierre y sesiones', async () => {
    const { discardDiaCompleto } = await import('./cash')
    await discardDiaCompleto('2026-06-20')

    const lastRpc = calls.lastIndexOf('rpc:delete_movement_cascade')
    const cierreDelete = calls.indexOf('cash_cierres_dia.delete')
    const sessionsDelete = calls.indexOf('cash_sessions.delete')
    expect(lastRpc).toBeGreaterThanOrEqual(0)
    expect(cierreDelete).toBeGreaterThan(lastRpc)          // cierre después de los movimientos
    expect(sessionsDelete).toBeGreaterThan(cierreDelete)   // sesiones (paso 4) después del cierre (paso 3)
  })

  it('pasa las credenciales de gerencia a la RPC cuando vienen (cajero)', async () => {
    const { discardDiaCompleto } = await import('./cash')
    await discardDiaCompleto('2026-06-20', 'jefe@satori.cr', 'secreta')
    expect(rpcArgs[0]).toEqual({
      p_movement_id: 'turn-mov-1',
      p_note: 'Borrado de día completo 2026-06-20',
      p_manager_email: 'jefe@satori.cr',
      p_manager_password: 'secreta',
    })
  })
})
