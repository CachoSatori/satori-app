// Editar un pago a proveedor YA guardado = reemplazo (hallazgo 252).
//
// Antes: se borraba el movimiento viejo (delete_movement_cascade) y DESPUÉS se creaba el nuevo. Si el alta fallaba,
// el pago quedaba solo como borrador en memoria: al recargar desaparecía y Caja Proveedores quedaba corrida.
//
// Ahora el orden es el inverso y nunca hay un hueco:
//   1. Se crea el nuevo con un id fijado por el cliente (id = client_op_id, UNIQUE en la base, mig 021). Un
//      reintento del MISMO cambio reusa ese id: si el primer intento sí entró, la base rebota el duplicado y se toma
//      como hecho; nunca hay un segundo alta.
//   2. Solo con el nuevo confirmado en la base se borra el viejo (misma RPC, nota y credenciales de siempre).
//   3. Si el nuevo quedó en la cola (sin señal) o el borrado falló, los dos existen un rato. El par {viejo, nuevo}
//      se anota en el aparato (localStorage, por turno) y, mientras el nuevo esté a la vista, el viejo NO se cuenta
//      (`aplicarReemplazos`). La pantalla avisa y ofrece «Terminar el cambio»; el cierre de la Caja Diaria se frena
//      hasta terminarlo.
//
// Sin React ni Supabase: se prueba con dependencias falsas (reemplazoPago.test.ts).

import type { CashMovement } from '../../shared/types/database'

export const NOTA_REEMPLAZO = 'Reemplazo por edición de pago a proveedor'

/** Par viejo → nuevo de un cambio de pago que todavía no terminó (el viejo sigue en la base). */
export interface ReemplazoPendiente {
  viejo: string   // id del movimiento que se reemplaza
  nuevo: string   // id (= client_op_id) del movimiento que lo reemplaza
  at:    number   // ms; para podar anotaciones viejas
}

export type ResultadoReemplazo =
  /** Nuevo en la base y viejo borrado. `nuevo` es null si el alta rebotó por duplicado (ya estaba): recargar. */
  | { estado: 'listo'; nuevo: CashMovement | null }
  /** El alta falló: no se tocó nada. El viejo sigue y cuenta. Reintentar con el MISMO id. */
  | { estado: 'sin_cambios'; error: string }
  /** El nuevo existe (en la base o en la cola) y el viejo todavía no se borró. `error` null = en cola sin señal. */
  | { estado: 'falta_borrar'; nuevo: CashMovement | null; reemplazo: ReemplazoPendiente; error: string | null }

export interface DepsReemplazo {
  /** Crea el movimiento nuevo con ESE id (createCashMovement con opts.id). */
  crear:       (id: string) => Promise<CashMovement>
  /** Borra el viejo por la cascada (deleteCashMovement con nota y credenciales). */
  borrarViejo: () => Promise<void>
  ahora?:      () => number
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'sin conexión'

/** El alta rebotó porque ese id/client_op_id ya está en la base (un intento anterior sí entró). */
export const esDuplicado = (e: unknown): boolean => /duplicate key|23505|already exists/i.test(mensaje(e))

export async function reemplazarPago(viejoId: string, nuevoId: string, deps: DepsReemplazo): Promise<ResultadoReemplazo> {
  let nuevo: CashMovement | null
  try {
    nuevo = await deps.crear(nuevoId)
  } catch (e) {
    if (!esDuplicado(e)) return { estado: 'sin_cambios', error: mensaje(e) }
    nuevo = null   // ya estaba en la base: el intento anterior entró
  }
  const reemplazo: ReemplazoPendiente = { viejo: viejoId, nuevo: nuevoId, at: (deps.ahora ?? Date.now)() }
  // En la cola (sin señal): el viejo NO se borra hasta que el nuevo esté en la base. Si la cola lo rechazara, el
  // viejo sigue vivo y vuelve a contar solo (aplicarReemplazos solo lo oculta mientras el nuevo está a la vista).
  if (nuevo?._pending) return { estado: 'falta_borrar', nuevo, reemplazo, error: null }
  try {
    await deps.borrarViejo()
    return { estado: 'listo', nuevo }
  } catch (e) {
    return { estado: 'falta_borrar', nuevo, reemplazo, error: mensaje(e) }
  }
}

/**
 * Quita de la lista los movimientos viejos de un cambio sin terminar, SOLO si su reemplazo está en la misma lista
 * (en la base o en la cola). Así nunca se cuenta doble y nunca se pierde: si el nuevo no está a la vista, el viejo
 * cuenta como siempre.
 */
export function aplicarReemplazos<M extends { id: string }>(movs: M[], reemplazos: ReemplazoPendiente[]): M[] {
  if (!reemplazos.length) return movs
  const ids = new Set(movs.map(m => m.id))
  const ocultar = new Set(reemplazos.filter(r => ids.has(r.nuevo) && ids.has(r.viejo)).map(r => r.viejo))
  return ocultar.size ? movs.filter(m => !ocultar.has(m.id)) : movs
}

/** Cambios sin terminar que importan ahora: el viejo y el nuevo están los dos a la vista. */
export function reemplazosAbiertos(movs: { id: string }[], reemplazos: ReemplazoPendiente[]): ReemplazoPendiente[] {
  const ids = new Set(movs.map(m => m.id))
  return reemplazos.filter(r => ids.has(r.viejo) && ids.has(r.nuevo))
}

/**
 * Anotaciones que siguen haciendo falta. Se suelta una cuando el viejo ya no está y el nuevo sí (terminado), o
 * cuando tiene más de 7 días. Con la lista vacía (cargando) no se suelta nada.
 */
export function podarReemplazos(movs: { id: string }[], reemplazos: ReemplazoPendiente[], ahora = Date.now()): ReemplazoPendiente[] {
  const SIETE_DIAS = 7 * 24 * 3600 * 1000
  const ids = new Set(movs.map(m => m.id))
  return reemplazos.filter(r => ahora - r.at < SIETE_DIAS && !(movs.length > 0 && !ids.has(r.viejo) && ids.has(r.nuevo)))
}

// ── Anotación en el aparato (por turno) ───────────────────────────────────────────────────────────────────────────
// localStorage puede faltar o tirar (modo privado, datos borrados): todo va en try/catch y sin él la pantalla
// funciona igual (el riesgo vuelve a ser el de contar doble tras recargar, nunca el de perder un pago).
export const claveReemplazos = (sessionId: string) => `satori:caja:reemplazos:${sessionId}`

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const almacen = (): Almacen | null => { try { return globalThis.localStorage ?? null } catch { return null } }

export function leerReemplazos(sessionId: string, st: Almacen | null = almacen()): ReemplazoPendiente[] {
  try {
    const raw = st?.getItem(claveReemplazos(sessionId))
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((r): r is ReemplazoPendiente =>
      !!r && typeof r.viejo === 'string' && typeof r.nuevo === 'string' && typeof r.at === 'number')
  } catch { return [] }
}

export function guardarReemplazos(sessionId: string, lista: ReemplazoPendiente[], st: Almacen | null = almacen()): void {
  try {
    if (lista.length) st?.setItem(claveReemplazos(sessionId), JSON.stringify(lista))
    else st?.removeItem(claveReemplazos(sessionId))
  } catch { /* sin almacenamiento: queda solo en memoria */ }
}

export const MSG_CIERRE_CON_REEMPLAZO =
  'Antes de cerrar, terminá el cambio de pago que quedó a medias (aviso rojo arriba, «Terminar el cambio»).'
