import { describe, it, expect, vi, afterEach } from 'vitest'

// outbox.ts importa el cliente supabase (para el executor real), que exige las
// env vars VITE_SUPABASE_*. El núcleo testeado acá (flushOutbox) NO lo usa →
// se mockea para que `npx vitest run` pase sin variables de entorno ni .env.
vi.mock('../api/supabase', () => ({ supabase: {} }))

import { flushOutbox, supabaseExecutor } from './outbox'
import type { OutboxOp, OutboxStore, ExecResult } from './outbox'
import { supabase } from '../api/supabase'

// Store en memoria con el mismo contrato que el de IndexedDB (seq autoincremental)
function memStore(): OutboxStore & { ops: OutboxOp[] } {
  let seq = 0
  const ops: OutboxOp[] = []
  return {
    ops,
    add: async op => { ops.push({ ...op, seq: ++seq }) },
    all: async () => [...ops].sort((a, b) => a.seq! - b.seq!),
    remove: async s => { const i = ops.findIndex(o => o.seq === s); if (i >= 0) ops.splice(i, 1) },
    count: async () => ops.length,
  }
}

const op = (n: number, over: Partial<OutboxOp> = {}): OutboxOp => ({
  client_op_id: `op-${n}`, table: 'cash_movements', op: 'insert',
  payload: { id: `id-${n}` }, created_at: new Date(2026, 5, 11, 12, n).toISOString(), ...over,
})

const noAudit = async () => { /* test */ }

describe('outbox — replay ordenado e idempotente (FASE B)', () => {
  it('replaya en ORDEN estricto de creación (seq) y vacía la cola', async () => {
    const store = memStore()
    await store.add(op(1)); await store.add(op(2)); await store.add(op(3))
    const executed: string[] = []
    const res = await flushOutbox(store, async o => { executed.push(o.client_op_id); return 'ok' }, noAudit)
    expect(executed).toEqual(['op-1', 'op-2', 'op-3'])
    expect(res).toMatchObject({ applied: 3, remaining: 0, stopped: false })
  })

  it('idempotencia: el duplicado (23505) se descarta de la cola sin duplicar plata', async () => {
    const store = memStore()
    await store.add(op(1)); await store.add(op(2))
    const res = await flushOutbox(store, async o => (o.client_op_id === 'op-1' ? 'duplicate' : 'ok'), noAudit)
    expect(res).toMatchObject({ applied: 1, duplicates: 1, remaining: 0 })
  })

  it('fallo de RED frena el flush y PRESERVA el orden (nada se saltea)', async () => {
    const store = memStore()
    await store.add(op(1)); await store.add(op(2)); await store.add(op(3))
    const executed: string[] = []
    const res = await flushOutbox(store, async o => {
      executed.push(o.client_op_id)
      return o.client_op_id === 'op-2' ? 'retry' : 'ok'
    }, noAudit)
    expect(executed).toEqual(['op-1', 'op-2'])           // op-3 ni se intentó
    expect(res).toMatchObject({ applied: 1, stopped: true, remaining: 2 })
    const left = await store.all()
    expect(left.map(o => o.client_op_id)).toEqual(['op-2', 'op-3'])  // orden intacto
  })

  it('replay doble completo: la segunda pasada no aplica nada (cola ya vacía)', async () => {
    const store = memStore()
    await store.add(op(1))
    await flushOutbox(store, async () => 'ok', noAudit)
    const res2 = await flushOutbox(store, async () => 'ok', noAudit)
    expect(res2).toMatchObject({ applied: 0, remaining: 0 })
  })

  it('rechazo FATAL del servidor: descarta la op, audita y la cola sigue (no se traba)', async () => {
    const store = memStore()
    await store.add(op(1)); await store.add(op(2))
    const audited: string[] = []
    const res = await flushOutbox(store,
      async o => (o.client_op_id === 'op-1' ? 'fatal' : 'ok') as ExecResult,
      async e => { audited.push(e.op.client_op_id) })
    expect(res).toMatchObject({ applied: 1, fatals: 1, remaining: 0 })
    expect(audited).toEqual(['op-1'])
  })

  it('una edición encolada DESPUÉS de la creación se replaya después (caso del spec)', async () => {
    const store = memStore()
    await store.add(op(1, { op: 'insert', payload: { id: 'X', amount_crc: 1000 } }))
    await store.add(op(2, { op: 'update', payload: { match: { id: 'X' }, updates: { amount_crc: 2000 } } }))
    const order: string[] = []
    await flushOutbox(store, async o => { order.push(o.op); return 'ok' }, noAudit)
    expect(order).toEqual(['insert', 'update'])
  })
})

// ── Durabilidad del flush: socket TCP zombi → timeout+abort → retry (no pierde plata) ──
const WRITE_TIMEOUT_MS = 15000

// Builder de Supabase encadenable: terminales (then/maybeSingle) NUNCA resuelven → simula
// el fetch colgado sobre el socket zombi tras suspensión.
function hangingBuilder() {
  const never = new Promise<never>(() => { /* nunca settlea */ })
  const b: Record<string, unknown> = {}
  for (const m of ['insert', 'upsert', 'update', 'delete', 'select', 'match', 'abortSignal']) b[m] = () => b
  b.maybeSingle = () => never
  b.then = (res: unknown, rej: unknown) => never.then(res as never, rej as never)
  return b
}
// Builder que responde OK ({ error: null }) — la red "se recuperó".
function okBuilder() {
  const ok = Promise.resolve({ data: null, error: null })
  const b: Record<string, unknown> = {}
  for (const m of ['insert', 'upsert', 'update', 'delete', 'select', 'match', 'abortSignal']) b[m] = () => b
  b.maybeSingle = () => ok
  b.then = (res: unknown, rej: unknown) => ok.then(res as never, rej as never)
  return b
}

describe('outbox — durabilidad del flush (socket zombi: timeout → retry, nunca fatal)', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete (supabase as Record<string, unknown>).from
  })

  it('insert que NUNCA resuelve: al cumplirse WRITE_TIMEOUT_MS el executor devuelve "retry" (no se cuelga)', async () => {
    vi.useFakeTimers()
    ;(supabase as Record<string, unknown>).from = () => hangingBuilder()
    const result = supabaseExecutor(op(1))
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS)
    await expect(result).resolves.toBe('retry')
  })

  it('GUARDARRAÍL: el timeout es "retry" y NUNCA "fatal" → la op NO se elimina de la cola (plata a salvo)', async () => {
    const store = memStore()
    await store.add(op(1)); await store.add(op(2))
    vi.useFakeTimers()
    ;(supabase as Record<string, unknown>).from = () => hangingBuilder()
    const flush = flushOutbox(store, supabaseExecutor, noAudit)
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS)
    const res = await flush
    expect(res.stopped).toBe(true)        // frenó el flush, preservando el orden
    expect(res.fatals).toBe(0)            // NUNCA fatal (fatal borraría la op = pago perdido)
    expect(res.applied).toBe(0)
    expect(await store.count()).toBe(2)   // nada se borró de la cola
  })

  it('tras recuperar (Supabase responde ok), un segundo flush drena la cola entera', async () => {
    const store = memStore()
    await store.add(op(1)); await store.add(op(2))
    // 1ª pasada: la red está zombi → todo se cuelga → retry, nada se drena
    vi.useFakeTimers()
    ;(supabase as Record<string, unknown>).from = () => hangingBuilder()
    const flush1 = flushOutbox(store, supabaseExecutor, noAudit)
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS)
    await flush1
    expect(await store.count()).toBe(2)
    vi.useRealTimers()
    // recuperado: Supabase responde ok → la cola se vacía en orden
    ;(supabase as Record<string, unknown>).from = () => okBuilder()
    const res2 = await flushOutbox(store, supabaseExecutor, noAudit)
    expect(res2).toMatchObject({ applied: 2, remaining: 0, stopped: false })
    expect(await store.count()).toBe(0)
  })
})
