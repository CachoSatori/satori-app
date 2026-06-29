// FASE B — Cola de escritura (outbox) persistente en IndexedDB.
// Toda mutación de Caja/Propinas que falle por red se encola con un client_op_id
// (UUID) y se reintenta al reconectar. El replay es idempotente server-side
// (migración 021: client_op_id UNIQUE → el duplicado rebota con 23505 y se
// descarta de la cola; tip_entries además usa upsert por (session_id,employee_id)).
// El núcleo opera sobre interfaces inyectables (store + executor) para poder
// testearlo con vitest sin navegador. Política completa en OFFLINE.md.

export type OutboxTable = 'cash_movements' | 'tip_entries'
export type OutboxOpType = 'insert' | 'upsert' | 'update' | 'delete'

export interface OutboxOp {
  seq?: number                 // autoincremental del store → define el ORDEN de replay
  client_op_id: string
  table: OutboxTable
  op: OutboxOpType
  /** insert/upsert: la fila completa · update: { match, updates } · delete: { match } */
  payload: Record<string, unknown>
  created_at: string           // ISO — para la auditoría LWW del replay
}

export interface OutboxStore {
  add(op: OutboxOp): Promise<void>
  all(): Promise<OutboxOp[]>   // ordenadas por seq ascendente
  remove(seq: number): Promise<void>
  count(): Promise<number>
}

/** Resultado de ejecutar UNA op contra el servidor. */
export type ExecResult =
  | 'ok'         // aplicada
  | 'duplicate'  // ya estaba (client_op_id UNIQUE rebotó) → descartar de la cola
  | 'retry'      // fallo de red → frenar el flush (se reintenta después, EN ORDEN)
  | 'fatal'      // rechazo del servidor (RLS, FK, datos) → descartar + auditar

export type OpExecutor = (op: OutboxOp) => Promise<ExecResult>
export type AuditLogger = (entry: { op: OutboxOp; reason: string; at: string }) => Promise<void>

export interface FlushResult { applied: number; duplicates: number; fatals: number; stopped: boolean; remaining: number }

/**
 * Replay en ORDEN estricto de creación (seq). 'retry' frena todo el flush para
 * preservar el orden (una edición nunca se aplica antes que su creación).
 * 'fatal' se descarta y se audita: dejarlo trabaría la cola para siempre.
 */
export async function flushOutbox(store: OutboxStore, exec: OpExecutor, audit: AuditLogger): Promise<FlushResult> {
  const res: FlushResult = { applied: 0, duplicates: 0, fatals: 0, stopped: false, remaining: 0 }
  const ops = await store.all()
  for (const op of ops) {
    let r: ExecResult
    try { r = await exec(op) } catch { r = 'retry' }
    if (r === 'retry') { res.stopped = true; break }
    if (r === 'ok') res.applied++
    else if (r === 'duplicate') res.duplicates++
    else {
      res.fatals++
      await audit({ op, reason: 'rechazo del servidor en replay (fatal) — descartada de la cola', at: new Date().toISOString() })
      console.error('[outbox] op descartada por rechazo del servidor:', op.table, op.op, op.client_op_id)
    }
    await store.remove(op.seq!)
  }
  res.remaining = await store.count()
  return res
}

// ── Implementación browser (IndexedDB + supabase) ─────────────────────────────
import { idbGetAll, idbPut, idbDelete, idbCount, STORES } from './idb'
import { supabase } from '../api/supabase'

export const idbOutboxStore: OutboxStore = {
  add: op => idbPut(STORES.outbox, op).then(() => undefined),
  all: () => idbGetAll<OutboxOp>(STORES.outbox).then(ops => ops.sort((a, b) => (a.seq! - b.seq!))),
  remove: seq => idbDelete(STORES.outbox, seq),
  count: () => idbCount(STORES.outbox),
}

const idbAudit: AuditLogger = entry => idbPut(STORES.audit, entry).then(() => undefined)

const NETWORK_ERR = /failed to fetch|networkerror|load failed|timeout de red|fetch failed/i
function classifyError(e: unknown): 'retry' | 'fatal' {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'retry'
  const msg = e instanceof Error ? e.message : String(e)
  return NETWORK_ERR.test(msg) ? 'retry' : 'fatal'
}

// Mismo cinturón que cash.ts: si una escritura del flush se cuelga sobre un socket TCP
// zombi (tras suspensión profunda), abort() cierra el socket (RST/FIN) → lo saca del pool
// → el próximo intento abre una conexión fresca. El error queda marcado isTimeout para que
// el ejecutor lo trate como 'retry' (NUNCA fatal: fatal borra la op = pago perdido).
const WRITE_TIMEOUT_MS = 15000
function withWriteTimeout<T>(run: (signal: AbortSignal) => PromiseLike<T>, ms = WRITE_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  return Promise.race([
    Promise.resolve(run(controller.signal)),
    new Promise<T>((_, reject) => setTimeout(() => {
      controller.abort()  // cierra el socket zombi → lo saca del pool
      const err = new Error('Outbox flush: la operación tardó demasiado.')
      ;(err as { isTimeout?: boolean }).isTimeout = true
      reject(err)
    }, ms)),
  ])
}

/** Ejecutor real contra Supabase, con auditoría LWW en updates (ver OFFLINE.md). */
export const supabaseExecutor: OpExecutor = async op => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'retry'
  try {
    if (op.op === 'insert') {
      const { error } = await withWriteTimeout(signal =>
        supabase.from(op.table).insert(op.payload as never).abortSignal(signal))
      if (!error) return 'ok'
      if (error.code === '23505') return 'duplicate'   // client_op_id/id UNIQUE → ya aplicada
      return classifyError(new Error(error.message))
    }
    if (op.op === 'upsert') {
      const { onConflict, row } = op.payload as { onConflict: string; row: Record<string, unknown> }
      const { error } = await withWriteTimeout(signal =>
        supabase.from(op.table).upsert(row as never, { onConflict }).abortSignal(signal))
      return error ? classifyError(new Error(error.message)) : 'ok'
    }
    if (op.op === 'update') {
      const { match, updates } = op.payload as { match: Record<string, string>; updates: Record<string, unknown> }
      // Auditoría LWW: si otro dispositivo tocó la fila DESPUÉS de esta op local,
      // se aplica igual (last-write-wins) pero queda warning + registro de auditoría.
      const { data: cur } = await withWriteTimeout(signal =>
        supabase.from(op.table).select('updated_at').match(match).abortSignal(signal).maybeSingle())
      const serverTs = (cur as { updated_at?: string } | null)?.updated_at
      if (serverTs && serverTs > op.created_at) {
        console.warn(`[outbox] CONFLICTO LWW en ${op.table}: el servidor tenía una versión más nueva (${serverTs}) que la op local (${op.created_at}). Se aplica igual (last-write-wins).`, match)
        await idbAudit({ op, reason: `conflicto LWW: server updated_at=${serverTs} > local`, at: new Date().toISOString() })
      }
      const { error } = await withWriteTimeout(signal =>
        supabase.from(op.table).update(updates as never).match(match).abortSignal(signal))
      return error ? classifyError(new Error(error.message)) : 'ok'
    }
    // delete — si la fila ya no existe, el delete es no-op y eso es éxito
    const { match } = op.payload as { match: Record<string, string> }
    const { error } = await withWriteTimeout(signal =>
      supabase.from(op.table).delete().match(match).abortSignal(signal))
    return error ? classifyError(new Error(error.message)) : 'ok'
  } catch (e) {
    if ((e as { isTimeout?: boolean })?.isTimeout === true) return 'retry'  // timeout → retry, NUNCA fatal
    return classifyError(e)
  }
}

// ── API pública para la app ───────────────────────────────────────────────────

function notifyPending() {
  idbCount(STORES.outbox).then(n =>
    window.dispatchEvent(new CustomEvent('satori:outbox-pending', { detail: { count: n } }))
  ).catch(() => { /* sin IDB no hay cola */ })
}

export async function enqueue(op: Omit<OutboxOp, 'seq'>): Promise<void> {
  await idbOutboxStore.add(op as OutboxOp)
  notifyPending()
  console.warn(`[outbox] op encolada (sin red): ${op.table} ${op.op} ${op.client_op_id}`)
}

export const pendingCount = () => idbCount(STORES.outbox)

/** Set de client_op_id pendientes + sus ops, para proyectar en las lecturas (badges). */
export const pendingOps = () => idbOutboxStore.all()

let flushing = false
/** Flush protegido contra multi-pestaña (navigator.locks) y reentradas. */
export async function flushNow(): Promise<FlushResult | null> {
  if (flushing) return null
  flushing = true
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request('satori-outbox-flush', { ifAvailable: true }, async lock => {
        if (!lock) return null   // otra pestaña está sincronizando — no duplicar replay
        return await flushOutbox(idbOutboxStore, supabaseExecutor, idbAudit)
      })
    }
    return await flushOutbox(idbOutboxStore, supabaseExecutor, idbAudit)
  } finally {
    flushing = false
    notifyPending()
  }
}

// Reintento automático: al volver la red + heartbeat con backoff mientras haya cola.
let retryDelay = 5_000
let retryTimer: number | undefined
async function autoFlush() {
  const n = await pendingCount().catch(() => 0)
  if (n === 0) { retryDelay = 5_000; return }
  const r = await flushNow()
  if (r && r.remaining === 0) { retryDelay = 5_000; return }
  retryDelay = Math.min(retryDelay * 2, 60_000)
  window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(autoFlush, retryDelay)
}

/**
 * Qué eventos de auth deben drenar la cola. A propósito SOLO `SIGNED_IN`:
 * `TOKEN_REFRESHED` pega cada hora + en cada resume (flush en bucle), `INITIAL_SESSION`
 * ya lo cubre el `autoFlush()` de arranque, y `SIGNED_OUT` no debe drenar. Exportado para
 * testear el gateo sin tocar el cliente de auth.
 */
export function shouldFlushOnAuthEvent(event: string): boolean {
  return event === 'SIGNED_IN'
}

let outboxWired = false
export function initOutbox() {
  if (outboxWired) return            // idempotente: no duplicar listeners (online/auth)
  outboxWired = true
  window.addEventListener('online', () => { retryDelay = 5_000; autoFlush() })
  // Cierra el Hallazgo B: tras un re-login (p.ej. el escape del auth-recovery) la cola
  // podía no drenar hasta un evento `online` o un reinicio. Mismo patrón EXACTO que el
  // handler de `online` (resetear backoff + autoFlush, NO flushNow directo). Supabase
  // admite múltiples onAuthStateChange; este NO interfiere con el global de supabase.ts.
  supabase.auth.onAuthStateChange((event) => {
    if (shouldFlushOnAuthEvent(event)) { retryDelay = 5_000; autoFlush() }
  })
  // arranque: si quedó cola de una sesión anterior (la app se cerró offline), reintentar
  autoFlush()
  notifyPending()
  // Hook de inspección SOLO en staging: permite simular/verificar la cola desde
  // la consola del navegador (lo usa el plan de prueba de OFFLINE.md).
  if (import.meta.env.VITE_APP_ENV === 'staging') {
    ;(window as unknown as Record<string, unknown>).__satoriOutbox = { enqueue, flushNow, pendingOps, pendingCount }
  }
}
