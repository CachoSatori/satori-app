import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Borrado con cascada de inventario (mig 039, RPC delete_movement_cascade).
// Invariante 1: ONLINE → el borrado enruta por la RPC con el id + la nota; NUNCA por .from().delete()
//   (un delete plano dejaría el inventario huérfano por el ON DELETE SET NULL de mig 017).
// Invariante 2: OFFLINE → BLOQUEA con error claro y NO encola (un borrado parcial sin cascada
//   reintroduce el bug; es una corrección de integridad, no una escritura operativa encolable).

const { rpcSpy, enqueueSpy } = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  enqueueSpy: vi.fn(),
}))

// Builder de rpc: thenable que resuelve { error: null } y soporta .abortSignal() (lo exige
// deleteCashMovement para que withWriteTimeout pueda cancelar el fetch colgado).
const okBuilder = {
  abortSignal: () => okBuilder,
  then: (res: (v: { error: null }) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(res, rej),
}

vi.mock('./supabase', () => ({
  supabase: {
    // Si el borrado tocara .from(), es un bug: debe ir por la RPC.
    from: () => { throw new Error('deleteCashMovement NO debe usar .from(): el borrado va por la RPC') },
    rpc: rpcSpy,
  },
}))

vi.mock('../offline/outbox', () => ({
  enqueue: enqueueSpy,
  pendingOps: vi.fn(async () => []),
}))

describe('cash.ts — deleteCashMovement con cascada (mig 039 RPC delete_movement_cascade)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
    rpcSpy.mockReset()
    rpcSpy.mockReturnValue(okBuilder)
    enqueueSpy.mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'navigator')
  })

  it('ONLINE: enruta por delete_movement_cascade con { p_movement_id, p_note }, sin encolar', async () => {
    const { deleteCashMovement } = await import('./cash')
    await deleteCashMovement('mov-1', 'Factura cargada doble')

    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy).toHaveBeenCalledWith('delete_movement_cascade', { p_movement_id: 'mov-1', p_note: 'Factura cargada doble' })
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('OFFLINE: BLOQUEA con error claro y NO encola (no deja un borrado parcial sin cascada)', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true })
    const { deleteCashMovement } = await import('./cash')

    await expect(deleteCashMovement('mov-1', 'motivo')).rejects.toThrow(/conexión/i)
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(enqueueSpy).not.toHaveBeenCalled()
  })
})
