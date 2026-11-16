// A01 (verificador, 16-nov): orden entre la cola y las escrituras con red.
// Sin dependencias del cliente de Supabase ni de outbox.ts: lo usan cash.ts y tips.ts, cuyas pruebas
// mockean '../offline/outbox'. Sin IndexedDB (Node, pruebas) todo devuelve «no hay cola».
import { idbCount, idbGetAll, STORES, rejGetAll } from './idb'

type OpLike = { table: string; op: string; payload: Record<string, unknown> }

/**
 * Fila a la que apunta una op: el ancla para encadenar ediciones/borrados a su creación.
 *  · cash_movements: el id del movimiento (insert: payload.id = client_op_id; update/delete: match.id)
 *  · tip_entries: (session_id, employee_id) — la clave del upsert
 */
export function targetKey(o: OpLike): string | undefined {
  const p = o.payload ?? {}
  if (o.table === 'cash_movements') {
    const id = o.op === 'insert' ? p.id : (p.match as Record<string, unknown> | undefined)?.id
    return typeof id === 'string' && id ? `cash_movements:${id}` : undefined
  }
  if (o.table === 'tip_entries') {
    const r = (o.op === 'upsert' ? p.row : p.match) as Record<string, unknown> | undefined
    return r && r.session_id && r.employee_id ? `tip_entries:${r.session_id}|${r.employee_id}` : undefined
  }
  return undefined
}

export const cashKey = (id: string) => `cash_movements:${id}`
export const tipKey = (sessionId: string, employeeId: string) => `tip_entries:${sessionId}|${employeeId}`

export interface OrdenDeps {
  pendientes: () => Promise<OpLike[]>
  rechazadas: () => Promise<Array<{ target?: string }>>
}

/**
 * ¿Una escritura con red tiene que ir a la cola para no adelantarse? Sí si hay CUALQUIER op pendiente
 * (orden global de la cola) o si la fila tiene algo en rechazadas. Si no se puede leer el aparato,
 * no hay cola que respetar → false.
 */
// Tope a las lecturas del aparato: un IndexedDB colgado no puede trabar una escritura con red.
// Si vence, se sigue directo (el comportamiento de antes de A01).
export const LECTURA_IDB_MS = 1500
const VENCIO = Symbol('vencio')
function conTope<T>(p: Promise<T>, ms: number): Promise<T | typeof VENCIO> {
  let t: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<typeof VENCIO>(res => { t = setTimeout(() => res(VENCIO), ms) }),
  ])
}

/**
 * Si el tope vence no se sabe si hay cola: un ALTA nueva (sin fila objetivo) sigue directo; una
 * escritura sobre una fila que ya existe (edición, propinas por turno/persona) va a la cola, porque
 * directa podría adelantarse a su creación y tocar 0 filas diciendo «ok».
 */
export async function debeEncolar(deps: OrdenDeps, key?: string, ms = LECTURA_IDB_MS): Promise<boolean> {
  try {
    const r = await conTope((async () => {
      if ((await deps.pendientes()).length > 0) return true
      return !!key && (await deps.rechazadas()).some(r => r.target === key)
    })(), ms)
    if (r === VENCIO) return !!key
    return r === true
  } catch { /* sin IndexedDB */ }
  return false
}

/** Estado de una fila en el aparato: para frenar un borrado online que sería un no-op silencioso. */
/** 'desconocido' = venció el tope: no se puede confirmar el orden (el borrado se frena). */
export async function estadoFila(deps: OrdenDeps, key: string, ms = LECTURA_IDB_MS): Promise<'pendiente' | 'rechazada' | 'desconocido' | null> {
  try {
    const r = await conTope((async () => {
      if ((await deps.pendientes()).some(o => targetKey(o) === key)) return 'pendiente' as const
      if ((await deps.rechazadas()).some(r => r.target === key)) return 'rechazada' as const
      return null
    })(), ms)
    return r === VENCIO ? 'desconocido' : r
  } catch { /* sin IndexedDB */ }
  return null
}

const idbDeps: OrdenDeps = {
  pendientes: () => idbCount(STORES.outbox).then(n => n > 0 ? idbGetAll<OpLike>(STORES.outbox) : []),
  rechazadas: () => rejGetAll<{ target?: string }>(),
}
export const debeEncolarAhora = (key?: string) => debeEncolar(idbDeps, key)
export const estadoFilaAhora = (key: string) => estadoFila(idbDeps, key)

export const BORRAR_PENDIENTE = 'Este movimiento todavía no se sincronizó. Esperá a que se sincronice (o tocá «⟳ Sincronizar ahora») y después borralo.'
export const BORRAR_SIN_ORDEN = 'No se pudo confirmar el orden: probá de nuevo en un momento.'
export const BORRAR_RECHAZADA = 'El servidor rechazó este movimiento y no está guardado. Resolvelo desde el aviso rojo, en «Ver detalle».'
