// A01 (auditoría 16-nov): el outbox NUNCA pierde una op en silencio.
//  · clasificación por status/código de supabase-js (no solo por texto)
//  · sesión vencida → refresca y reintenta; si sigue → retry (la op queda en la cola)
//  · fatal → cola de rechazadas VISIBLE, no frena lo que sigue
//  · aviso de cola trabada tras STUCK_AFTER intentos
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../api/supabase', () => ({ supabase: {} }))

import {
  flushOutbox, supabaseExecutor, classifyServerError, nextStuck, isStuck, STUCK_AFTER,
  requeueRejected, resolveRejected, forceRejectHead, chainOf, puedePasarARechazadas, PENDIENTE_MISMA_FILA,
} from './outbox'
import type { OutboxOp, OutboxStore, RejectedOp, RejectedStore, FlushResult, StuckState } from './outbox'
import { supabase } from '../api/supabase'

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
function memRejected(): RejectedStore & { items: RejectedOp[] } {
  const items: RejectedOp[] = []
  return {
    items,
    add: async r => { const i = items.findIndex(x => x.client_op_id === r.client_op_id); if (i >= 0) items[i] = r; else items.push(r) },
    all: async () => [...items],
    remove: async id => { const i = items.findIndex(x => x.client_op_id === id); if (i >= 0) items.splice(i, 1) },
    count: async () => items.length,
  }
}
const op = (n: number, over: Partial<OutboxOp> = {}): OutboxOp => ({
  client_op_id: `op-${n}`, table: 'cash_movements', op: 'insert',
  payload: { id: `id-${n}`, amount_crc: 1000 * n }, created_at: new Date(Date.UTC(2026, 10, 16, 18, n)).toISOString(), ...over,
})
const noAudit = async () => { /* test */ }

// Builder encadenable de supabase-js que responde lo que le digamos ({ error, status }).
type Resp = { data?: unknown; error: unknown; status?: number }
function builder(next: () => Resp) {
  const b: Record<string, unknown> = {}
  for (const m of ['insert', 'upsert', 'update', 'delete', 'select', 'match', 'abortSignal']) b[m] = () => b
  b.maybeSingle = () => Promise.resolve({ data: null, error: null })
  b.then = (res: unknown, rej: unknown) => Promise.resolve().then(next).then(res as never, rej as never)
  return b
}
function wire(responses: Resp[], refresh: () => Promise<{ error: unknown }> = async () => ({ error: null })) {
  const calls = { writes: 0, refresh: 0 }
  const sb = supabase as unknown as Record<string, unknown>
  sb.from = () => builder(() => { const r = responses[Math.min(calls.writes, responses.length - 1)]; calls.writes++; return r })
  sb.auth = { refreshSession: () => { calls.refresh++; return refresh() } }
  return calls
}
const err = (status: number, code = '', message = 'x') => ({ error: { code, message, details: '', hint: '' }, status })

afterEach(() => {
  const sb = supabase as unknown as Record<string, unknown>
  delete sb.from; delete sb.auth
})

describe('A01 — classifyServerError: cada clase de error', () => {
  const retry: Array<[string, Parameters<typeof classifyServerError>[0], string]> = [
    ['red (status 0 de supabase-js)', { status: 0, message: 'TypeError: Failed to fetch' }, 'red'],
    ['red por texto sin status', { message: 'NetworkError when attempting to fetch resource' }, 'red'],
    ['abort/timeout', { status: 0, message: 'AbortError: The user aborted a request.' }, 'red'],
    ['401 sesión vencida', { status: 401, code: 'PGRST301', message: 'JWT expired' }, 'sesion'],
    ['401 sin sesión (anon choca con RLS)', { status: 401, code: '42501', message: 'new row violates row-level security policy' }, 'sesion'],
    ['PGRST301 sin status', { code: 'PGRST301', message: 'JWT expired' }, 'sesion'],
    ['403 por JWT', { status: 403, message: 'invalid JWT' }, 'sesion'],
    ['408', { status: 408 }, 'red'],
    ['425', { status: 425 }, 'red'],
    ['429', { status: 429 }, 'servidor'],
    ['500', { status: 500, code: 'XX000' }, 'servidor'],
    ['502', { status: 502 }, 'servidor'],
    ['503 PGRST000 (sin conexión a la base)', { status: 503, code: 'PGRST000' }, 'servidor'],
    ['504 PGRST003 (pool)', { status: 504, code: 'PGRST003' }, 'servidor'],
    ['PGRST002 sin status', { code: 'PGRST002' }, 'servidor'],
    ['57014 statement timeout', { status: 400, code: '57014' }, 'servidor'],
    ['40001 serialización', { status: 400, code: '40001' }, 'servidor'],
    ['40P01 deadlock', { status: 400, code: '40P01' }, 'servidor'],
    ['08006 conexión', { code: '08006' }, 'servidor'],
    ['25006 solo lectura (failover)', { status: 400, code: '25006' }, 'servidor'],
    ['desconocido sin status ni código', { message: 'algo raro' }, 'desconocido'],
  ]
  for (const [name, e, kind] of retry) {
    it(`retry: ${name}`, () => {
      const r = classifyServerError(e)
      expect(r.result).toBe('retry')
      expect(r.kind).toBe(kind)
    })
  }
  const fatal: Array<[string, Parameters<typeof classifyServerError>[0]]> = [
    ['23514 check constraint (400)', { status: 400, code: '23514', message: 'violates check constraint' }],
    ['23503 FK (409)', { status: 409, code: '23503' }],
    ['23502 not null (400)', { status: 400, code: '23502' }],
    ['P0001 regla de negocio (400)', { status: 400, code: 'P0001', message: 'regla' }],
    ['22P02 formato (400)', { status: 400, code: '22P02' }],
    ['42501 RLS con sesión válida (403)', { status: 403, code: '42501', message: 'new row violates row-level security policy' }],
    ['PGRST204 columna inexistente (400)', { status: 400, code: 'PGRST204' }],
    ['404', { status: 404, code: '42P01' }],
  ]
  for (const [name, e] of fatal) {
    it(`fatal: ${name}`, () => {
      const r = classifyServerError(e)
      expect(r.result).toBe('fatal')
      expect(r.reason.length).toBeGreaterThan(0)
    })
  }
  it('sin red manda sobre cualquier código (offline=true → retry)', () => {
    expect(classifyServerError({ status: 400, code: '23514' }, true).result).toBe('retry')
  })
})

describe('A01 — executor real: sesión vencida, 5xx y rechazos', () => {
  it('401 → refresca la sesión y reintenta la MISMA op → ok', async () => {
    const calls = wire([err(401, 'PGRST301', 'JWT expired'), { error: null, status: 201 }])
    await expect(supabaseExecutor(op(1))).resolves.toBe('ok')
    expect(calls.refresh).toBe(1)
    expect(calls.writes).toBe(2)
  })

  it('401 y el refresh falla → retry «sesion», la op NO sale de la cola', async () => {
    wire([err(401, 'PGRST301', 'JWT expired')], async () => ({ error: { message: 'refresh token not found' } }))
    const store = memStore(); const rej = memRejected()
    await store.add(op(1)); await store.add(op(2))
    const res = await flushOutbox(store, supabaseExecutor, noAudit, rej)
    expect(res).toMatchObject({ stopped: true, fatals: 0, remaining: 2, retryKind: 'sesion' })
    expect(rej.items).toHaveLength(0)
  })

  it('401 que sigue 401 tras refrescar → retry (no fatal), un solo refresh', async () => {
    const calls = wire([err(401, 'PGRST301', 'JWT expired')])
    const r = await supabaseExecutor(op(1))
    expect(r).toMatchObject({ result: 'retry', kind: 'sesion' })
    expect(calls.refresh).toBe(1)
  })

  for (const [status, code] of [[500, ''], [502, ''], [503, 'PGRST000'], [429, ''], [408, ''], [0, '']] as const) {
    it(`${status}${code ? ' ' + code : ''} → la cola queda intacta (nada se borra)`, async () => {
      wire([err(status, code, status === 0 ? 'TypeError: Failed to fetch' : 'x')])
      const store = memStore(); const rej = memRejected()
      await store.add(op(1)); await store.add(op(2))
      const res = await flushOutbox(store, supabaseExecutor, noAudit, rej)
      expect(res).toMatchObject({ stopped: true, fatals: 0, applied: 0, remaining: 2 })
      expect(rej.items).toHaveLength(0)
    })
  }

  it('excepción inesperada (TypeError) dentro del executor → retry, no fatal', async () => {
    const sb = supabase as unknown as Record<string, unknown>
    sb.from = () => { throw new TypeError('x is not a function') }
    const r = await supabaseExecutor(op(1))
    expect(typeof r === 'object' && r.result).toBe('retry')
  })

  it('400 23514 → fatal: pasa a rechazadas con motivo y código, y la op siguiente SÍ se aplica', async () => {
    let n = 0
    const sb = supabase as unknown as Record<string, unknown>
    sb.from = () => builder(() => (n++ === 0 ? err(400, '23514', 'violates check constraint "monto"') : { error: null, status: 201 }))
    const store = memStore(); const rej = memRejected()
    await store.add(op(1)); await store.add(op(2))
    const res = await flushOutbox(store, supabaseExecutor, noAudit, rej)
    expect(res).toMatchObject({ applied: 1, fatals: 1, remaining: 0, stopped: false })
    expect(rej.items).toHaveLength(1)
    expect(rej.items[0]).toMatchObject({ client_op_id: 'op-1', code: '23514', status: 400, payload: { amount_crc: 1000 } })
    expect(rej.items[0].rejected_at).toBeTruthy()
  })

  it('idempotencia intacta: insert con 23505 → duplicate (se descarta, no va a rechazadas)', async () => {
    wire([err(409, '23505', 'duplicate key value violates unique constraint')])
    const store = memStore(); const rej = memRejected()
    await store.add(op(1))
    const res = await flushOutbox(store, supabaseExecutor, noAudit, rej)
    expect(res).toMatchObject({ duplicates: 1, fatals: 0, remaining: 0 })
    expect(rej.items).toHaveLength(0)
  })
})

describe('A01 — flushOutbox: orden, fatales y nada se borra sin quedar visible', () => {
  it('fatal en el medio: orden estricto 1-2-3, la 2 queda en rechazadas, la 3 se aplica', async () => {
    const store = memStore(); const rej = memRejected()
    await store.add(op(1)); await store.add(op(2)); await store.add(op(3))
    const executed: string[] = []
    const res = await flushOutbox(store, async o => {
      executed.push(o.client_op_id)
      return o.client_op_id === 'op-2' ? { result: 'fatal', reason: 'regla', code: 'P0001', status: 400 } : 'ok'
    }, noAudit, rej)
    expect(executed).toEqual(['op-1', 'op-2', 'op-3'])
    expect(res).toMatchObject({ applied: 2, fatals: 1, remaining: 0 })
    expect(rej.items.map(r => r.client_op_id)).toEqual(['op-2'])
  })

  it('si NO se puede guardar en rechazadas, la op NO se borra y el flush se frena', async () => {
    const store = memStore()
    const rej = memRejected()
    rej.add = async () => { throw new Error('QuotaExceeded') }
    await store.add(op(1)); await store.add(op(2))
    const executed: string[] = []
    const res = await flushOutbox(store, async o => { executed.push(o.client_op_id); return 'fatal' }, noAudit, rej)
    expect(res).toMatchObject({ stopped: true, fatals: 0, remaining: 2 })
    expect(executed).toEqual(['op-1'])
    expect(store.ops.map(o => o.client_op_id)).toEqual(['op-1', 'op-2'])
  })

  it('se guarda en rechazadas ANTES de sacarla de la cola', async () => {
    const store = memStore(); const rej = memRejected()
    await store.add(op(1))
    const seen: number[] = []
    const origRemove = store.remove
    store.remove = async s => { seen.push(rej.items.length); return origRemove(s) }
    await flushOutbox(store, async () => 'fatal', noAudit, rej)
    expect(seen).toEqual([1])   // al borrar de la cola, ya estaba en rechazadas
  })

  it('una auditoría que falla no frena ni pierde nada', async () => {
    const store = memStore(); const rej = memRejected()
    await store.add(op(1)); await store.add(op(2))
    const res = await flushOutbox(store, async o => (o.client_op_id === 'op-1' ? 'fatal' : 'ok'),
      async () => { throw new Error('audit caído') }, rej)
    expect(res).toMatchObject({ applied: 1, fatals: 1, remaining: 0 })
    expect(rej.items).toHaveLength(1)
  })
})

describe('A01 — rechazadas: reintentar y resolver no pierden nada', () => {
  const rejected = (n: number): RejectedOp => ({ ...op(n), rejected_at: '2026-11-16T20:00:00.000Z', reason: 'sin permiso', code: '42501', status: 403 })

  it('reintentar: vuelve a la cola con el MISMO client_op_id y sale de rechazadas', async () => {
    const store = memStore(); const rej = memRejected()
    await rej.add(rejected(7))
    await expect(requeueRejected(rej, store, 'op-7')).resolves.toBe(1)
    expect(store.ops.map(o => o.client_op_id)).toEqual(['op-7'])
    expect(store.ops[0].payload).toEqual({ id: 'id-7', amount_crc: 7000 })
    expect(rej.items).toHaveLength(0)
  })

  it('reintentar: si no se pudo volver a encolar, sigue en rechazadas', async () => {
    const store = memStore(); const rej = memRejected()
    store.add = async () => { throw new Error('IDB caído') }
    await rej.add(rejected(7))
    await expect(requeueRejected(rej, store, 'op-7')).rejects.toThrow()
    expect(rej.items).toHaveLength(1)
  })

  it('resolver: queda auditada ANTES de salir de la lista; si la auditoría falla, no sale', async () => {
    const rej = memRejected()
    await rej.add(rejected(8))
    const audited: string[] = []
    await resolveRejected(rej, async e => { audited.push(e.op.client_op_id) }, 'op-8', 'u-ficticio')
    expect(audited).toEqual(['op-8'])
    expect(rej.items).toHaveLength(0)

    await rej.add(rejected(9))
    await expect(resolveRejected(rej, async () => { throw new Error('x') }, 'op-9', null)).rejects.toThrow()
    expect(rej.items).toHaveLength(1)
  })
})

describe('A01 — aviso de cola trabada', () => {
  const stopped = (kind: FlushResult['retryKind']): FlushResult => ({ applied: 0, duplicates: 0, fatals: 0, stopped: true, remaining: 1, retryKind: kind, retryReason: 'r', stoppedAt: 'op-1' })
  const clean: FlushResult = { applied: 1, duplicates: 0, fatals: 0, stopped: false, remaining: 0 }

  it(`avisa recién al intento ${STUCK_AFTER} seguido frenado, con el motivo`, () => {
    let s: StuckState = { attempts: 0 }
    for (let i = 1; i < STUCK_AFTER; i++) { s = nextStuck(s, stopped('sesion')); expect(isStuck(s)).toBe(false) }
    s = nextStuck(s, stopped('sesion'))
    expect(isStuck(s)).toBe(true)
    expect(s.kind).toBe('sesion')
  })
  it('un flush que drena resetea el contador', () => {
    let s: StuckState = { attempts: STUCK_AFTER + 2, kind: 'servidor' }
    s = nextStuck(s, clean)
    expect(s).toEqual({ attempts: 0 })
  })
  it('flush que no corrió (otra pestaña) no cambia nada', () => {
    const s: StuckState = { attempts: 3, kind: 'red' }
    expect(nextStuck(s, null)).toBe(s)
  })
})

// ── Verificador #234: cadenas (creación → ediciones → borrado) ───────────────
// «Servidor» en memoria: insert crea la fila, update la pisa, delete la saca. Un update/delete de una
// fila que no existe responde «ok» sin efecto, igual que PostgREST (0 filas).
function fakeServer(rejectIds: Set<string>) {
  const rows = new Map<string, Record<string, unknown>>()
  const executed: string[] = []
  const exec = async (o: OutboxOp) => {
    executed.push(o.client_op_id)
    if (rejectIds.has(o.client_op_id)) return { result: 'fatal' as const, reason: 'regla', code: 'P0001', status: 400 }
    const p = o.payload as Record<string, unknown>
    if (o.op === 'insert') { rows.set(p.id as string, { ...p }); return 'ok' as const }
    const id = (p.match as { id: string }).id
    if (o.op === 'update') { const r = rows.get(id); if (r) Object.assign(r, p.updates as object); return 'ok' as const }
    rows.delete(id); return 'ok' as const
  }
  return { rows, executed, exec }
}
const ins = (n: number, id: string, amount: number) => op(n, { client_op_id: `ins-${n}`, payload: { id, amount_crc: amount } })
const upd = (n: number, id: string, amount: number) => op(n, { client_op_id: `upd-${n}`, op: 'update', payload: { match: { id }, updates: { amount_crc: amount } } })
const del = (n: number, id: string) => op(n, { client_op_id: `del-${n}`, op: 'delete', payload: { match: { id } } })

describe('verificador #234 — ops dependientes de una rechazada', () => {
  it('insert rechazado + borrado del cajero: el borrado NO se manda (va a rechazadas como dependiente)', async () => {
    const store = memStore(); const rej = memRejected()
    const srv = fakeServer(new Set(['ins-1']))
    await store.add(ins(1, 'M', 5000)); await store.add(del(2, 'M')); await store.add(ins(3, 'N', 100))
    const res = await flushOutbox(store, srv.exec, noAudit, rej)
    expect(srv.executed).toEqual(['ins-1', 'ins-3'])           // del-2 ni se intentó
    expect(res).toMatchObject({ applied: 1, fatals: 2, remaining: 0 })
    expect(rej.items.find(r => r.client_op_id === 'del-2')).toMatchObject({ depends_on: 'ins-1', target: 'cash_movements:M' })
    expect(srv.rows.has('N')).toBe(true)                        // otra fila no se frena
  })

  it('…y «Reintentar» manda la CADENA en orden: el movimiento borrado NO reaparece', async () => {
    const store = memStore(); const rej = memRejected()
    const blocked = new Set(['ins-1'])
    const srv = fakeServer(blocked)
    await store.add(ins(1, 'M', 5000)); await store.add(del(2, 'M'))
    await flushOutbox(store, srv.exec, noAudit, rej)
    blocked.clear()                                              // ahora el servidor lo acepta
    await expect(requeueRejected(rej, store, 'del-2')).resolves.toBe(2)   // desde cualquier eslabón
    expect(store.ops.map(o => o.client_op_id)).toEqual(['ins-1', 'del-2'])
    expect(rej.items).toHaveLength(0)
    await flushOutbox(store, srv.exec, noAudit, rej)
    expect(srv.rows.has('M')).toBe(false)
  })

  it('…con edición: «Reintentar» deja el monto NUEVO', async () => {
    const store = memStore(); const rej = memRejected()
    const blocked = new Set(['ins-1'])
    const srv = fakeServer(blocked)
    await store.add(ins(1, 'M', 5000)); await store.add(upd(2, 'M', 7000))
    await flushOutbox(store, srv.exec, noAudit, rej)
    expect(srv.rows.has('M')).toBe(false)
    blocked.clear()
    await requeueRejected(rej, store, 'ins-1')
    await flushOutbox(store, srv.exec, noAudit, rej)
    expect(srv.rows.get('M')?.amount_crc).toBe(7000)
  })

  it('una op de la misma fila encolada DESPUÉS (otro flush) también queda en la cadena', async () => {
    const store = memStore(); const rej = memRejected()
    const srv = fakeServer(new Set(['ins-1']))
    await store.add(ins(1, 'M', 5000))
    await flushOutbox(store, srv.exec, noAudit, rej)
    await store.add(upd(2, 'M', 9000))
    await flushOutbox(store, srv.exec, noAudit, rej)
    expect(srv.executed).toEqual(['ins-1'])
    expect(chainOf(rej.items, 'ins-1').map(r => r.client_op_id)).toEqual(['ins-1', 'upd-2'])
  })

  it('«Ya lo resolví» sobre cualquier eslabón resuelve la cadena entera (auditada)', async () => {
    const store = memStore(); const rej = memRejected()
    const srv = fakeServer(new Set(['ins-1']))
    await store.add(ins(1, 'M', 5000)); await store.add(upd(2, 'M', 7000)); await store.add(del(3, 'M'))
    await flushOutbox(store, srv.exec, noAudit, rej)
    const audited: string[] = []
    await expect(resolveRejected(rej, async e => { audited.push(e.op.client_op_id) }, 'upd-2', 'u')).resolves.toBe(3)
    expect(audited).toEqual(['ins-1', 'upd-2', 'del-3'])
    expect(rej.items).toHaveLength(0)
  })

  it('«Reintentar» no hace nada si en la cola hay algo de la misma fila', async () => {
    const store = memStore(); const rej = memRejected()
    await rej.add({ ...ins(1, 'M', 5000), rejected_at: 'x', reason: 'r', target: 'cash_movements:M', orig_seq: 1 })
    await store.add(upd(2, 'M', 7000))
    await expect(requeueRejected(rej, store, 'ins-1')).rejects.toThrow(PENDIENTE_MISMA_FILA)
    expect(rej.items).toHaveLength(1)
    expect(store.ops.map(o => o.client_op_id)).toEqual(['upd-2'])
  })

  it('reintento a medias (la op está en la cola Y en rechazadas): se manda y al entrar sale de rechazadas', async () => {
    const store = memStore(); const rej = memRejected()
    const srv = fakeServer(new Set())
    await rej.add({ ...ins(1, 'M', 5000), rejected_at: 'x', reason: 'r', target: 'cash_movements:M', orig_seq: 1 })
    await store.add(ins(1, 'M', 5000))
    const res = await flushOutbox(store, srv.exec, noAudit, rej)
    expect(res).toMatchObject({ applied: 1, fatals: 0 })
    expect(rej.items).toHaveLength(0)
  })

  it('tip_entries: un delete de la misma persona/turno después de un upsert rechazado también se encadena', async () => {
    const store = memStore(); const rej = memRejected()
    const row = { session_id: 's', employee_id: 'e' }
    await store.add(op(1, { client_op_id: 'tu-1', table: 'tip_entries', op: 'upsert', payload: { onConflict: 'session_id,employee_id', row } }))
    await store.add(op(2, { client_op_id: 'td-2', table: 'tip_entries', op: 'delete', payload: { match: row } }))
    const executed: string[] = []
    await flushOutbox(store, async o => { executed.push(o.client_op_id); return 'fatal' }, noAudit, rej)
    expect(executed).toEqual(['tu-1'])
    expect(rej.items.find(r => r.client_op_id === 'td-2')?.depends_on).toBe('tu-1')
  })
})

describe('verificador #234 — «Pasar a rechazadas» la primera de una cola trabada', () => {
  it('saca la primera (sin borrar) y sus dependientes la siguen; lo demás se aplica', async () => {
    const store = memStore(); const rej = memRejected()
    const srv = fakeServer(new Set())
    await store.add(ins(1, 'M', 5000)); await store.add(upd(2, 'M', 7000)); await store.add(ins(3, 'N', 100))
    await expect(forceRejectHead(store, rej, noAudit, 'ins-1', 'tras 5 intentos')).resolves.toBe(true)
    expect(rej.items.map(r => r.client_op_id)).toEqual(['ins-1'])
    expect(rej.items[0].payload).toEqual({ id: 'M', amount_crc: 5000 })
    await flushOutbox(store, srv.exec, noAudit, rej)
    expect(srv.executed).toEqual(['ins-3'])
    expect(rej.items.map(r => r.client_op_id)).toEqual(['ins-1', 'upd-2'])
  })
  it('si la primera ya no es la que vio la pantalla, no toca nada', async () => {
    const store = memStore(); const rej = memRejected()
    await store.add(ins(1, 'M', 5000))
    await expect(forceRejectHead(store, rej, noAudit, 'otra', 'x')).resolves.toBe(false)
    expect(store.ops).toHaveLength(1); expect(rej.items).toHaveLength(0)
  })
  it('si no se pudo guardar en rechazadas, la op sigue en la cola', async () => {
    const store = memStore(); const rej = memRejected()
    rej.add = async () => { throw new Error('IDB') }
    await store.add(ins(1, 'M', 5000))
    await expect(forceRejectHead(store, rej, noAudit, 'ins-1', 'x')).rejects.toThrow()
    expect(store.ops).toHaveLength(1)
  })
  it('el contador es por la MISMA primera op: si cambia, arranca de nuevo', () => {
    const fr = (head: string, kind: 'servidor' | 'red' = 'servidor'): FlushResult =>
      ({ applied: 0, duplicates: 0, fatals: 0, stopped: true, remaining: 1, retryKind: kind, retryReason: 'r', stoppedAt: head })
    let s: StuckState = { attempts: 0 }
    for (let i = 0; i < STUCK_AFTER; i++) s = nextStuck(s, fr('a'))
    expect(puedePasarARechazadas(s)).toBe(true)
    s = nextStuck(s, fr('b'))
    expect(s).toMatchObject({ attempts: 1, head: 'b' })
    expect(puedePasarARechazadas(s)).toBe(false)
  })
  it('el botón no se ofrece si el freno es de red o de sesión', () => {
    expect(puedePasarARechazadas({ attempts: 9, kind: 'red', head: 'a' })).toBe(false)
    expect(puedePasarARechazadas({ attempts: 9, kind: 'sesion', head: 'a' })).toBe(false)
    expect(puedePasarARechazadas({ attempts: 9, kind: 'desconocido', head: 'a' })).toBe(true)
  })
})

describe('verificador #234 — un executor que LANZA', () => {
  it('flushOutbox lo trata como retry: frena y no borra nada', async () => {
    const store = memStore(); const rej = memRejected()
    await store.add(op(1)); await store.add(op(2))
    const res = await flushOutbox(store, async () => { throw new Error('boom') }, noAudit, rej)
    expect(res).toMatchObject({ stopped: true, fatals: 0, remaining: 2, stoppedAt: 'op-1' })
    expect(rej.items).toHaveLength(0)
  })
  it('si no se pueden leer las rechazadas, no se manda nada', async () => {
    const store = memStore(); const rej = memRejected()
    rej.all = async () => { throw new Error('IDB') }
    await store.add(op(1))
    let called = false
    const res = await flushOutbox(store, async () => { called = true; return 'ok' }, noAudit, rej)
    expect(called).toBe(false)
    expect(res).toMatchObject({ stopped: true, remaining: 1 })
  })
})
