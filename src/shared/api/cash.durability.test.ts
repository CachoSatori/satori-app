import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Durabilidad de escritura de caja: simula el SOCKET ZOMBI tras suspensión profunda.
// El builder de insert NUNCA settlea en NINGUNO de los dos intentos → withWriteTimeout aborta
// las dos veces. navigator.onLine MIENTE (=true), así que el viejo guard con isOffline() jamás
// encolaba y el pago se perdía. La invariante: toda escritura termina confirmada o EN EL OUTBOX,
// nunca colgada ni descartada en silencio. Acá afirmamos que termina en el outbox.

// Spy de enqueue inyectable: vi.mock se hoistea sobre los imports, por eso el spy va en vi.hoisted.
const { enqueueSpy } = vi.hoisted(() => ({
  enqueueSpy: vi.fn<(op: { table: string; op: string; client_op_id: string; payload: Record<string, unknown> }) => Promise<void>>(),
}))

// Builder encadenable que ADEMÁS es un thenable colgado: su `then` devuelve el mismo builder y
// NUNCA invoca los callbacks → la promesa jamás settlea (socket muerto). Así update/delete (que
// terminan en .abortSignal()) e insert (que termina en .single()) quedan esperando para siempre.
// Cubre insert().select().abortSignal().single().
type Hung = PromiseLike<never> & {
  insert: () => Hung; update: () => Hung; delete: () => Hung
  select: () => Hung; eq: () => Hung; abortSignal: () => Hung; single: () => Hung
}
const builder: Hung = {
  insert: () => builder,
  update: () => builder,
  delete: () => builder,
  select: () => builder,
  eq: () => builder,
  abortSignal: () => builder,
  single: () => builder,
  then: () => builder,   // zombi: no resuelve ni rechaza
}

vi.mock('./supabase', () => ({
  supabase: { from: () => builder },
}))

// Outbox mockeado: solo nos importa observar enqueue. pendingOps se incluye porque cash.ts lo importa.
vi.mock('../offline/outbox', () => ({
  enqueue: enqueueSpy,
  pendingOps: vi.fn(async () => []),
}))

describe('cash.ts — durabilidad de escritura (socket zombi: el pago termina en el outbox)', () => {
  beforeEach(() => {
    // Zombi: la red está "online" según el navegador aunque el socket esté muerto.
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
    enqueueSpy.mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'navigator')
  })

  it('registerCashMovement: ambos intentos vencen por timeout → RESUELVE con _pending y encola en el outbox (no se pierde)', async () => {
    const { createCashMovement } = await import('./cash')

    let resolved: { id: string; _pending?: boolean } | undefined
    const p = createCashMovement({
      session_id: 's1', created_by: 'u1', movement_type: 'egreso_mercaderia',
      amount_crc: 5000, amount_usd: 0, currency: 'CRC', exchange_rate: null,
      description: 'Pago proveedor', method: 'Efectivo', caja_origen: 'Caja Fuerte',
    }).then(r => { resolved = r as unknown as { id: string; _pending?: boolean } })

    // 1er intento (tope 15s) vence → reintento (tope 15s) vence. Avanzamos más allá de ambos.
    await vi.advanceTimersByTimeAsync(15_100)   // vence el 1er withWriteTimeout
    await vi.advanceTimersByTimeAsync(15_100)   // vence el reintento envuelto en withWriteTimeout
    await p

    // No tiró: el pago se salvó en el outbox.
    expect(resolved).toBeDefined()
    expect(resolved!._pending).toBe(true)

    // Encoló UNA vez, como insert de cash_movements, con el MISMO id/client_op_id que devolvió.
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    const op = enqueueSpy.mock.calls[0][0]
    expect(op.table).toBe('cash_movements')
    expect(op.op).toBe('insert')
    expect(op.client_op_id).toBe(resolved!.id)
    expect(op.payload.id).toBe(resolved!.id)
    expect(op.payload.client_op_id).toBe(resolved!.id)
  })

  it('createDayMovement: ambos intentos vencen por timeout → RESUELVE con el id y encola en el outbox', async () => {
    const { createDayMovement } = await import('./cash')

    let resolvedId: string | undefined
    const p = createDayMovement({
      created_by: 'u1', movement_type: 'egreso', amount_crc: 5000,
      description: 'Banco a Caja Fuerte', method: 'Efectivo', caja_origen: 'Caja Fuerte',
    }).then(r => { resolvedId = r })

    // 1er intento (tope 15s) vence → reintento (tope 15s) vence. Avanzamos más allá de ambos.
    await vi.advanceTimersByTimeAsync(15_100)   // vence el 1er withWriteTimeout
    await vi.advanceTimersByTimeAsync(15_100)   // vence el reintento envuelto en withWriteTimeout
    await p

    // No tiró y resolvió un id string: el movimiento de día se salvó en el outbox.
    expect(typeof resolvedId).toBe('string')
    expect(resolvedId).toBeTruthy()

    // Encoló UNA vez, como insert de cash_movements, con el MISMO id/client_op_id que devolvió.
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    const op = enqueueSpy.mock.calls[0][0]
    expect(op.table).toBe('cash_movements')
    expect(op.op).toBe('insert')
    expect(op.client_op_id).toBe(resolvedId)
    expect(op.payload.id).toBe(resolvedId)
    expect(op.payload.client_op_id).toBe(resolvedId)
  })

  it('createDayMovement: navigator offline → encola directo sin tocar la red', async () => {
    // El navegador SÍ sabe que no hay red (onLine=false) → encolar directo, sin intentar la 1ª op.
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true })
    const { createDayMovement } = await import('./cash')

    const id = await createDayMovement({
      created_by: 'u1', movement_type: 'egreso', amount_crc: 5000,
      description: 'Banco a Caja Fuerte', method: 'Efectivo', caja_origen: 'Caja Fuerte',
    })

    // Devolvió el id y encoló UNA vez como insert, sin tocar el builder de red.
    expect(typeof id).toBe('string')
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    const op = enqueueSpy.mock.calls[0][0]
    expect(op.table).toBe('cash_movements')
    expect(op.op).toBe('insert')
    expect(op.client_op_id).toBe(id)
    expect(op.payload.id).toBe(id)
  })
})
