// FASE B — Cola de escritura (outbox) persistente en IndexedDB.
// Toda mutación de Caja/Propinas que falle por red se encola con un client_op_id
// (UUID) y se reintenta al reconectar. El replay es idempotente server-side
// (migración 021: client_op_id UNIQUE → el duplicado rebota con 23505 y se
// descarta de la cola; tip_entries además usa upsert por (session_id,employee_id)).
// El núcleo opera sobre interfaces inyectables (store + executor) para poder
// testearlo con vitest sin navegador. Política completa en OFFLINE.md.

import { targetKey } from './ordenEscrituras'

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
  | 'retry'      // fallo transitorio (red, sesión, servidor caído) → frenar el flush, EN ORDEN
  | 'fatal'      // rechazo DEFINITIVO del servidor (regla, constraint, validación) → cola de rechazadas

/** Por qué se frenó el flush (para el aviso de «no se pudo sincronizar»). */
// 'lento': la op vence el tiempo con la red andando (p. ej. un trigger lento). No es «sin conexión».
export type RetryKind = 'red' | 'sesion' | 'servidor' | 'lento' | 'desconocido'

/** Resultado con detalle: el ejecutor real lo devuelve para que el motivo llegue a la pantalla. */
export interface ExecDetail {
  result: 'retry' | 'fatal'
  kind?: RetryKind            // solo retry
  reason: string              // texto corto para el personal; sin datos de la fila
  code?: string               // SQLSTATE / PGRSTxxx
  status?: number             // HTTP (0 = no hubo respuesta)
}
export type ExecOutcome = ExecResult | ExecDetail

export type OpExecutor = (op: OutboxOp) => Promise<ExecOutcome>
export type AuditLogger = (entry: { op: OutboxOp; reason: string; at: string }) => Promise<void>

/** Op que el servidor rechazó: queda en el aparato, VISIBLE, hasta que la gerencia la resuelva. */
export interface RejectedOp {
  client_op_id: string
  table: OutboxTable
  op: OutboxOpType
  payload: Record<string, unknown>
  created_at: string          // cuándo se registró en el aparato
  rejected_at: string         // cuándo la rechazó el servidor
  reason: string
  code?: string
  status?: number
  target?: string             // fila a la que apunta (ver targetKey)
  depends_on?: string         // client_op_id de la rechazada que la arrastró (cadena)
  incierta?: boolean          // no hubo rechazo explícito (la pasó la gerencia): puede que YA haya entrado
  orig_seq?: number           // seq original en la cola → orden de la cadena
}

export interface RejectedStore {
  add(r: RejectedOp): Promise<void>   // debe resolver recién con la escritura hecha
  all(): Promise<RejectedOp[]>
  remove(client_op_id: string): Promise<void>
  count(): Promise<number>
}

export interface FlushResult {
  applied: number; duplicates: number; fatals: number; stopped: boolean; remaining: number
  retryKind?: RetryKind; retryReason?: string
  stoppedAt?: string          // client_op_id de la op que frenó el flush (la primera de la cola)
}

function normalize(o: ExecOutcome): ExecDetail | 'ok' | 'duplicate' {
  if (o === 'ok' || o === 'duplicate') return o
  if (o === 'retry') return { result: 'retry', kind: 'desconocido', reason: 'reintento pendiente' }
  if (o === 'fatal') return { result: 'fatal', reason: 'el servidor rechazó la operación' }
  return o
}

/**
 * Replay en ORDEN estricto de creación (seq). 'retry' frena todo el flush para
 * preservar el orden (una edición nunca se aplica antes que su creación).
 * 'fatal' NO se borra en silencio (A01): primero se guarda en la cola de rechazadas
 * (visible en la app) y SOLO si esa escritura salió bien se saca de la cola. Si no se
 * pudo guardar, el flush se frena y la op queda donde estaba. Un fatal no frena lo que sigue.
 */
export async function flushOutbox(
  store: OutboxStore, exec: OpExecutor, audit: AuditLogger, rejected: RejectedStore,
): Promise<FlushResult> {
  const res: FlushResult = { applied: 0, duplicates: 0, fatals: 0, stopped: false, remaining: 0 }
  // Filas bloqueadas: las que tienen algo en rechazadas. Una edición/borrado de una fila cuya creación
  // se rechazó NO se manda (respondería «ok» sin efecto): va a rechazadas como dependiente.
  const blocked = new Map<string, string>()   // target → client_op_id raíz de la cadena
  const enRechazadas = new Set<string>()      // ops que están en la cola Y en rechazadas (reintento a medias)
  try {
    for (const r of await rejected.all()) {
      enRechazadas.add(r.client_op_id)
      if (r.target && !blocked.has(r.target)) blocked.set(r.target, r.depends_on ?? r.client_op_id)
    }
  } catch {
    res.stopped = true; res.retryKind = 'desconocido'; res.retryReason = 'no se pudo leer las rechazadas del aparato'
    res.remaining = await store.count()
    return res
  }
  const ops = await store.all()
  for (const op of ops) {
    const key = targetKey(op)
    const root = key ? blocked.get(key) : undefined
    let r: ReturnType<typeof normalize>
    if (root && !enRechazadas.has(op.client_op_id)) {
      r = { result: 'fatal', reason: 'depende de una operación rechazada antes (misma fila): no se envió' }
    } else {
      try { r = normalize(await exec(op)) } catch {
        r = { result: 'retry', kind: 'desconocido', reason: 'error inesperado al enviar' }
      }
    }
    if (r === 'ok' || r === 'duplicate') {
      if (r === 'ok') res.applied++; else res.duplicates++
      // Venía de un «Reintentar» que quedó a medias: ya entró → sale de rechazadas.
      if (enRechazadas.has(op.client_op_id)) { try { await rejected.remove(op.client_op_id) } catch { /* queda visible: no se pierde */ } }
    } else if (r.result === 'retry') {
      res.stopped = true; res.retryKind = r.kind ?? 'desconocido'; res.retryReason = r.reason; res.stoppedAt = op.client_op_id
      break
    } else {
      const now = new Date().toISOString()
      const dependsOn = root && !enRechazadas.has(op.client_op_id) ? root : undefined
      try {
        await rejected.add(toRejected(op, now, r, dependsOn))
      } catch {
        // No se pudo dejar visible → NO se borra. Se frena y se reintenta después.
        res.stopped = true; res.retryKind = 'desconocido'; res.retryReason = 'no se pudo guardar el rechazo en el aparato'; res.stoppedAt = op.client_op_id
        break
      }
      if (key && !blocked.has(key)) blocked.set(key, op.client_op_id)
      res.fatals++
      try { await audit({ op, reason: `rechazo del servidor (${r.code ?? r.status ?? (dependsOn ? 'dependiente' : 's/c')}) — pasó a rechazadas`, at: now }) } catch { /* best-effort */ }
      // Sin datos de la fila en la consola: solo tabla, tipo, id de la op y código.
      console.error('[outbox] op rechazada → rechazadas:', op.table, op.op, op.client_op_id, r.code ?? r.status ?? (dependsOn ? 'dependiente' : ''))
    }
    await store.remove(op.seq!)
  }
  res.remaining = await store.count()
  return res
}

function toRejected(op: OutboxOp, now: string, d: ExecDetail, dependsOn?: string): RejectedOp {
  return {
    client_op_id: op.client_op_id, table: op.table, op: op.op, payload: op.payload,
    created_at: op.created_at, rejected_at: now, reason: d.reason, code: d.code, status: d.status,
    target: targetKey(op), depends_on: dependsOn, orig_seq: op.seq,
  }
}

/** La cadena de una rechazada: su raíz y todo lo de la misma fila, en el orden original. */
export function chainOf(all: RejectedOp[], client_op_id: string): RejectedOp[] {
  const r = all.find(x => x.client_op_id === client_op_id)
  if (!r) return []
  const root = r.depends_on ?? r.client_op_id
  const rootOp = all.find(x => x.client_op_id === root)
  const target = rootOp?.target ?? r.target
  return all
    .filter(x => x.client_op_id === root || x.depends_on === root || (target !== undefined && x.target === target))
    .sort((a, b) => (a.orig_seq !== undefined && b.orig_seq !== undefined && a.orig_seq !== b.orig_seq)
      ? a.orig_seq - b.orig_seq : a.created_at.localeCompare(b.created_at))
}

/**
 * La gerencia saca de la cola la PRIMERA op cuando traba todo (5xx o error fijo). No se borra: va a
 * rechazadas, y lo que dependa de ella (misma fila) la sigue en el próximo flush. Solo si la primera
 * sigue siendo la que vio la pantalla (expectedId).
 */
export async function forceRejectHead(
  store: OutboxStore, rejected: RejectedStore, audit: AuditLogger, expectedId: string, reason: string,
): Promise<boolean> {
  const head = (await store.all())[0]
  if (!head || head.client_op_id !== expectedId) return false
  const now = new Date().toISOString()
  // Sin rechazo explícito del servidor (timeout, 5xx): puede que YA haya entrado → «incierta».
  await rejected.add({ ...toRejected(head, now, { result: 'fatal', reason }), incierta: true })
  try { await audit({ op: head, reason: `pasada a rechazadas a mano: ${reason}`, at: now }) } catch { /* best-effort */ }
  await store.remove(head.seq!)
  return true
}

// ── Clasificación de errores del servidor (A01) ───────────────────────────────
export interface ServerError { status?: number; code?: string; message?: string; name?: string }

const NETWORK_ERR = /failed to fetch|networkerror|load failed|timeout de red|fetch failed|network request failed|se cortó la conexión|aborted|abortError/i
const JWT_ERR = /jwt|token.*expir|expired.*token|invalid.*token|not authenticated|no autenticad/i
// Códigos de PostgREST de autenticación (JWT vencido/ inválido / falta).
const PGRST_AUTH = new Set(['PGRST301', 'PGRST302', 'PGRST303'])
// Códigos de PostgREST de conexión / caché de esquema / pool (transitorios).
const PGRST_CONN = new Set(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])
// SQLSTATE transitorios: conexión (08), recursos (53), cancelación/caída (57), serialización/deadlock, solo-lectura (failover).
const SQL_TRANSIENT = /^(08|53|57)|^40001$|^40P01$|^25006$/

const ok = <T extends ExecDetail>(d: T) => d

/**
 * 'retry' para todo lo que puede salir bien más tarde sin que nadie toque la op: red, timeout,
 * sesión vencida (401 / JWT), 408, 425, 429, 5xx, conexión de PostgREST/Postgres.
 * 'fatal' SOLO para rechazos definitivos del servidor: el resto de los 4xx (regla de negocio,
 * constraint, validación, permiso de un usuario con sesión válida).
 * Lo que no se puede clasificar (sin status ni código) es 'retry': ante la duda, no se descarta.
 */
export function classifyServerError(e: ServerError, offline = false): ExecDetail {
  const status = typeof e.status === 'number' ? e.status : undefined
  const code = e.code || undefined
  const msg = e.message ?? ''
  const base = { code, status }
  if (offline) return ok({ result: 'retry', kind: 'red', reason: 'sin conexión', ...base })
  if (code && PGRST_AUTH.has(code)) return ok({ result: 'retry', kind: 'sesion', reason: 'la sesión venció', ...base })
  if (status === 401) return ok({ result: 'retry', kind: 'sesion', reason: 'la sesión venció o no hay sesión', ...base })
  if (status === 403 && JWT_ERR.test(msg)) return ok({ result: 'retry', kind: 'sesion', reason: 'la sesión venció', ...base })
  if (code && PGRST_CONN.has(code)) return ok({ result: 'retry', kind: 'servidor', reason: 'el servidor no pudo conectarse a la base', ...base })
  if (code && SQL_TRANSIENT.test(code)) return ok({ result: 'retry', kind: 'servidor', reason: 'la base estaba ocupada o se reinició', ...base })
  if (status === 408) return ok({ result: 'retry', kind: 'lento', reason: 'el servidor tardó demasiado', ...base })
  if (status === 425) return ok({ result: 'retry', kind: 'red', reason: 'el servidor pidió reintentar', ...base })
  if (status === 429) return ok({ result: 'retry', kind: 'servidor', reason: 'demasiados pedidos al servidor', ...base })
  if (status !== undefined && status >= 500) return ok({ result: 'retry', kind: 'servidor', reason: 'el servidor falló', ...base })
  if (status === 0 || NETWORK_ERR.test(msg) || NETWORK_ERR.test(e.name ?? '')) return ok({ result: 'retry', kind: 'red', reason: 'falló la conexión', ...base })
  if (status !== undefined && status >= 400) {
    return ok({ result: 'fatal', reason: motivoRechazo(code, status), ...base })
  }
  return ok({ result: 'retry', kind: 'desconocido', reason: 'error sin respuesta clara del servidor', ...base })
}

/** Motivo legible para la gerencia (sin valores de la fila: solo el tipo de rechazo). */
export function motivoRechazo(code?: string, status?: number): string {
  switch (code) {
    case '42501': return 'sin permiso para esta operación (regla de acceso)'
    case '23503': return 'hace referencia a algo que ya no existe (por ejemplo, un turno o proveedor borrado)'
    case '23505': return 'ya existe un registro igual'
    case '23514': return 'un dato no cumple una regla de la base'
    case '23502': return 'falta un dato obligatorio'
    case 'P0001': return 'una regla del sistema la rechazó'
    case '22P02': case '22003': case '22007': case '22008': return 'un dato tiene formato inválido'
  }
  if (code?.startsWith('PGRST')) return 'el pedido no es válido para el servidor'
  if (status === 403) return 'sin permiso para esta operación'
  if (status === 409) return 'choca con datos que ya están en el servidor'
  return 'el servidor rechazó la operación'
}

/** Cuenta flushes frenados seguidos: a partir de STUCK_AFTER se avisa en pantalla. */
export const STUCK_AFTER = 5
export interface StuckState { attempts: number; kind?: RetryKind; reason?: string; head?: string }
export function nextStuck(prev: StuckState, r: FlushResult | null): StuckState {
  if (!r) return prev                                     // otra pestaña / reentrada: sin dato nuevo
  if (!r.stopped) return { attempts: 0 }
  // Cuenta intentos seguidos con la MISMA op primera; si cambió la primera, arranca de nuevo.
  const attempts = (prev.head !== undefined && prev.head === r.stoppedAt ? prev.attempts : 0) + 1
  return { attempts, kind: r.retryKind, reason: r.retryReason, head: r.stoppedAt }
}
/** «Pasar a rechazadas» solo cuando el freno es del servidor o desconocido (no red ni sesión). */
export const puedePasarARechazadas = (s: StuckState) =>
  isStuck(s) && s.head !== undefined && (s.kind === 'servidor' || s.kind === 'lento' || s.kind === 'desconocido')
export const isStuck = (s: StuckState) => s.attempts >= STUCK_AFTER

// ── Implementación browser (IndexedDB + supabase) ─────────────────────────────
import { idbGetAll, idbPut, idbDelete, idbCount, STORES, rejPut, rejDelete, rejGetAll, rejCount } from './idb'
import { supabase } from '../api/supabase'

export const idbOutboxStore: OutboxStore = {
  add: op => idbPut(STORES.outbox, op).then(() => undefined),
  all: () => idbGetAll<OutboxOp>(STORES.outbox).then(ops => ops.sort((a, b) => (a.seq! - b.seq!))),
  remove: seq => idbDelete(STORES.outbox, seq),
  count: () => idbCount(STORES.outbox),
}

export const idbRejectedStore: RejectedStore = {
  add: r => rejPut(r),
  all: () => rejGetAll<RejectedOp>().then(rs => rs.sort((a, b) => a.created_at.localeCompare(b.created_at))),
  remove: id => rejDelete(id),
  count: () => rejCount(),
}

const idbAudit: AuditLogger = entry => idbPut(STORES.audit, entry).then(() => undefined)

const isOfflineNow = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** Error de supabase-js ({ error, status }) o excepción → forma común para clasificar. */
function toServerError(error: unknown, status?: number): ServerError {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; name?: unknown; status?: unknown }
  return {
    status: typeof status === 'number' ? status : (typeof e.status === 'number' ? e.status : undefined),
    code: typeof e.code === 'string' ? e.code : undefined,
    message: typeof e.message === 'string' ? e.message : (error instanceof Error ? error.message : String(error ?? '')),
    name: typeof e.name === 'string' ? e.name : undefined,
  }
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

type Resp = { error: unknown; status?: number }

/**
 * ¿Hay camino al servidor? Pide el /auth/v1/health de Supabase (liviano, sin tocar la base) con un
 * tope corto. Cualquier respuesta HTTP = hay red; si no responde, no hay. Objeto mutable para pruebas.
 */
export const salud = {
  ping: async (ms = 4000): Promise<boolean> => {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
    if (!url || typeof fetch === 'undefined') return false
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    try {
      await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string }, signal: ctrl.signal, cache: 'no-store',
      })
      return true
    } catch { return false } finally { clearTimeout(t) }
  },
}

/** Un timeout es «lento» SOLO si hay red de verdad (wifi conectado sin internet = «red»). */
async function tipoDeTimeout(): Promise<RetryKind> {
  if (isOfflineNow()) return 'red'
  return (await salud.ping()) ? 'lento' : 'red'
}

/** UNA pasada de la op contra Supabase. Devuelve 'ok' / 'duplicate' / detalle clasificado. */
async function runOnce(op: OutboxOp): Promise<ExecOutcome> {
  const judge = ({ error, status }: Resp): ExecOutcome =>
    error ? classifyServerError(toServerError(error, status), isOfflineNow()) : 'ok'
  try {
    if (op.op === 'insert') {
      const r = await withWriteTimeout(signal =>
        supabase.from(op.table).insert(op.payload as never).abortSignal(signal))
      if (r.error && (r.error as { code?: string }).code === '23505') return 'duplicate'   // client_op_id/id UNIQUE → ya aplicada
      return judge(r)
    }
    if (op.op === 'upsert') {
      const { onConflict, row } = op.payload as { onConflict: string; row: Record<string, unknown> }
      return judge(await withWriteTimeout(signal =>
        supabase.from(op.table).upsert(row as never, { onConflict }).abortSignal(signal)))
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
      return judge(await withWriteTimeout(signal =>
        supabase.from(op.table).update(updates as never).match(match).abortSignal(signal)))
    }
    // delete — si la fila ya no existe, el delete es no-op y eso es éxito
    const { match } = op.payload as { match: Record<string, string> }
    return judge(await withWriteTimeout(signal =>
      supabase.from(op.table).delete().match(match).abortSignal(signal)))
  } catch (e) {
    if ((e as { isTimeout?: boolean })?.isTimeout === true)   // timeout → retry, NUNCA fatal
      return { result: 'retry', kind: await tipoDeTimeout(), reason: 'el servidor tardó demasiado' }
    return classifyServerError(toServerError(e), isOfflineNow())
  }
}

/**
 * Ejecutor real contra Supabase, con auditoría LWW en updates (ver OFFLINE.md).
 * Sesión vencida (A01): refresca la sesión UNA vez y reintenta la op (idempotente por
 * client_op_id). Si sigue vencida, 'retry' de tipo 'sesion': la op queda en la cola y
 * drena al volver a entrar (SIGNED_IN).
 */
export const supabaseExecutor: OpExecutor = async op => {
  if (isOfflineNow()) return { result: 'retry', kind: 'red', reason: 'sin conexión' }
  const first = await runOnce(op)
  if (typeof first === 'string' || first.result !== 'retry' || first.kind !== 'sesion') return first
  try {
    const { error } = await withWriteTimeout(() => supabase.auth.refreshSession())
    if (error) return first
  } catch { return first }
  return runOnce(op)
}

// ── API pública para la app ───────────────────────────────────────────────────

function notifyPending() {
  idbCount(STORES.outbox).then(n =>
    window.dispatchEvent(new CustomEvent('satori:outbox-pending', { detail: { count: n } }))
  ).catch(() => { /* sin IDB no hay cola */ })
}

export async function enqueue(op: Omit<OutboxOp, 'seq'>, opts?: { kick?: boolean }): Promise<void> {
  await idbOutboxStore.add(op as OutboxOp)
  notifyPending()
  console.warn(`[outbox] op encolada${opts?.kick ? ' (detrás de la cola)' : ' (sin red)'}: ${op.table} ${op.op} ${op.client_op_id}`)
  // Con red, encolada para no adelantarse a la cola (A01): que drene ya, sin esperar el backoff.
  if (opts?.kick) { retryDelay = 5_000; window.setTimeout(() => { autoFlush() }, 0) }
}

export const pendingCount = () => idbCount(STORES.outbox)

// ── Rechazadas: lo ve el personal y lo resuelve la gerencia (A01) ─────────────
/** Cuántas NO tuvieron un rechazo explícito: las inciertas y lo que va con ellas (no se sabe si entraron). */
export function contarSinConfirmar(rs: RejectedOp[]): number {
  const inciertas = new Set(rs.filter(r => r.incierta).map(r => r.client_op_id))
  return rs.filter(r => r.incierta || (r.depends_on !== undefined && inciertas.has(r.depends_on))).length
}

function notifyRejected() {
  idbRejectedStore.all().then(rs =>
    window.dispatchEvent(new CustomEvent('satori:outbox-rejected', { detail: { count: rs.length, sinConfirmar: contarSinConfirmar(rs) } }))
  ).catch(() => { /* sin IDB */ })
}

export const rejectedOps = () => idbRejectedStore.all()
export const rejectedCount = () => idbRejectedStore.count()

export const PENDIENTE_MISMA_FILA = 'Todavía hay operaciones de esta misma fila en la cola: sincronizá primero y después reintentá.'

/**
 * Vuelve a mandar una rechazada CON SU CADENA (creación → ediciones → borrado), en el orden original.
 * Primero vuelven a la cola, recién después salen de rechazadas: nunca quedan en ningún lado. Mismo
 * client_op_id → si ya estaba aplicada, rebota como duplicado (no duplica plata). Si en la cola hay
 * algo de la misma fila, no hace nada (se adelantaría o atrasaría).
 */
export async function requeueRejected(rej: RejectedStore, outbox: OutboxStore, client_op_id: string): Promise<number> {
  const chain = chainOf(await rej.all(), client_op_id)
  if (!chain.length) return 0
  const targets = new Set(chain.map(c => c.target).filter((t): t is string => !!t))
  if ((await outbox.all()).some(o => { const k = targetKey(o); return k !== undefined && targets.has(k) })) {
    throw new Error(PENDIENTE_MISMA_FILA)
  }
  for (const r of chain) {
    await outbox.add({ client_op_id: r.client_op_id, table: r.table, op: r.op, payload: r.payload, created_at: r.created_at })
  }
  for (const r of chain) await rej.remove(r.client_op_id)
  return chain.length
}

/** La gerencia la resolvió a mano: TODA la cadena queda en la auditoría del aparato y sale de la lista. */
export async function resolveRejected(rej: RejectedStore, audit: AuditLogger, client_op_id: string, byUserId: string | null): Promise<number> {
  const chain = chainOf(await rej.all(), client_op_id)
  for (const r of chain) {
    await audit({
      op: { client_op_id: r.client_op_id, table: r.table, op: r.op, payload: r.payload, created_at: r.created_at },
      reason: `rechazada resuelta a mano por ${byUserId ?? 's/usuario'} (motivo original: ${r.code ?? r.status ?? 's/c'} ${r.reason})`,
      at: new Date().toISOString(),
    })
  }
  for (const r of chain) await rej.remove(r.client_op_id)
  return chain.length
}

/** Corre con el MISMO lock que el flush: nunca se mezcla con un replay a medio camino. */
async function conLockDeCola<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('satori-outbox-flush', fn)
  return fn()
}

export async function requeueRejectedNow(client_op_id: string): Promise<void> {
  try { await conLockDeCola(() => requeueRejected(idbRejectedStore, idbOutboxStore, client_op_id)) } finally { notifyRejected(); notifyPending() }
  retryDelay = 5_000; autoFlush()
}
export async function resolveRejectedNow(client_op_id: string, byUserId: string | null): Promise<void> {
  try { await conLockDeCola(() => resolveRejected(idbRejectedStore, idbAudit, client_op_id, byUserId)) } finally { notifyRejected() }
}
export async function forceRejectHeadNow(expectedId: string, attempts: number, motivo: string): Promise<boolean> {
  let ok: boolean
  try {
    ok = await conLockDeCola(() => forceRejectHead(idbOutboxStore, idbRejectedStore, idbAudit, expectedId,
      `la gerencia la pasó a rechazadas tras ${attempts} intentos (${motivo})`))
  } finally { notifyRejected(); notifyPending() }
  if (ok) { stuck = { attempts: 0 }; window.dispatchEvent(new CustomEvent('satori:outbox-stuck', { detail: stuck })); retryDelay = 5_000; autoFlush() }
  return ok
}

// ── Cola trabada: aviso tras STUCK_AFTER intentos seguidos frenados ──────────
let stuck: StuckState = { attempts: 0 }
export const getStuck = () => stuck
function trackStuck(r: FlushResult | null) {
  const next = nextStuck(stuck, r)
  if (next.attempts === stuck.attempts && next.kind === stuck.kind && next.head === stuck.head) return
  stuck = next
  window.dispatchEvent(new CustomEvent('satori:outbox-stuck', { detail: stuck }))
}

/** Set de client_op_id pendientes + sus ops, para proyectar en las lecturas (badges). */
export const pendingOps = () => idbOutboxStore.all()

let flushing = false
/** Flush protegido contra multi-pestaña (navigator.locks) y reentradas. */
export async function flushNow(): Promise<FlushResult | null> {
  if (flushing) return null
  flushing = true
  let result: FlushResult | null = null
  try {
    result = await flushLocked()
    return result
  } finally {
    flushing = false
    notifyPending()
    notifyRejected()
    trackStuck(result)
  }
}

async function flushLocked(): Promise<FlushResult | null> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return await navigator.locks.request('satori-outbox-flush', { ifAvailable: true }, async lock => {
      if (!lock) return null   // otra pestaña está sincronizando — no duplicar replay
      return await flushOutbox(idbOutboxStore, supabaseExecutor, idbAudit, idbRejectedStore)
    })
  }
  return await flushOutbox(idbOutboxStore, supabaseExecutor, idbAudit, idbRejectedStore)
}

// Reintento automático: al volver la red + heartbeat con backoff mientras haya cola.
let retryDelay = 5_000
let retryTimer: number | undefined
async function autoFlush() {
  const n = await pendingCount().catch(() => 0)
  if (n === 0) { retryDelay = 5_000; trackStuck({ applied: 0, duplicates: 0, fatals: 0, stopped: false, remaining: 0 }); return }
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
  notifyRejected()
  // Hook de inspección SOLO en staging: permite simular/verificar la cola desde
  // la consola del navegador (lo usa el plan de prueba de OFFLINE.md).
  if (import.meta.env.VITE_APP_ENV === 'staging') {
    ;(window as unknown as Record<string, unknown>).__satoriOutbox = { enqueue, flushNow, pendingOps, pendingCount, rejectedOps }
  }
}
