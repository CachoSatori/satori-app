import { describe, it, expect, vi } from 'vitest'

// outbox.ts importa el cliente supabase (para el executor real), que exige las
// env vars VITE_SUPABASE_*. El núcleo testeado acá (flushOutbox) NO lo usa →
// se mockea para que `npx vitest run` pase sin variables de entorno ni .env.
vi.mock('../api/supabase', () => ({ supabase: {} }))

import { flushOutbox } from './outbox'
import type { OutboxOp, OutboxStore, ExecResult } from './outbox'

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
