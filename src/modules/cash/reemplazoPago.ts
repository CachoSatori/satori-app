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
//   4. Ronda 2 (Menor 1 del verificador): la MISMA regla vale para todo Caja, no solo para la Caja Diaria. CashModule
//      (Movimientos, Proveedores, Pendientes, Resumen) y el Cierre del día leen las anotaciones de TODOS los turnos
//      del aparato (`leerTodosLosReemplazos`) y pasan sus movimientos por `aplicarReemplazos`. El Cierre del día
//      frena la Noche (Fase 2) mientras haya un cambio abierto (MSG_FASE2_CON_REEMPLAZO).
//   5. Ronda 2 (Menor 3): un cambio usa UN id toda su vida, aunque entre intentos cambie el monto. Si el alta rebota
//      por duplicado, se relee la fila por id y se compara con lo tecleado AHORA (`coincidePago`): igual → hecho y se
//      borra el viejo; distinto (el primer intento entró con otros datos) o sin poder releer → NO se borra el viejo,
//      el par se anota (se cuenta una vez) y se avisa con el monto que quedó (estado `distinto`). Un id nuevo nunca
//      se usa: si el primer intento llegara tarde a la base, habría tres pagos.
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
  /**
   * El alta rebotó por duplicado y la fila que ya está con ese id NO tiene lo tecleado ahora (un intento anterior
   * entró con otros datos), o no se pudo releer (`guardado` null). El viejo NO se borra; el par queda anotado.
   */
  | { estado: 'distinto'; guardado: CashMovement | null; reemplazo: ReemplazoPendiente }

export interface DepsReemplazo {
  /** Crea el movimiento nuevo con ESE id (createCashMovement con opts.id). */
  crear:       (id: string) => Promise<CashMovement>
  /** Borra el viejo por la cascada (deleteCashMovement con nota y credenciales). */
  borrarViejo: () => Promise<void>
  /** Tras un duplicado: relee la fila con ese id (getCashMovementById). null = no está a la vista. */
  releer:      (id: string) => Promise<CashMovement | null>
  /** ¿La fila ya guardada tiene los datos de ESTE intento? (coincidePago con lo tecleado ahora) */
  coincide:    (m: CashMovement) => boolean
  ahora?:      () => number
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'sin conexión'

/** El alta rebotó porque ese id/client_op_id ya está en la base (un intento anterior sí entró). */
export const esDuplicado = (e: unknown): boolean => /duplicate key|23505|already exists/i.test(mensaje(e))

export async function reemplazarPago(viejoId: string, nuevoId: string, deps: DepsReemplazo): Promise<ResultadoReemplazo> {
  let nuevo: CashMovement | null
  const reemplazo = (): ReemplazoPendiente => ({ viejo: viejoId, nuevo: nuevoId, at: (deps.ahora ?? Date.now)() })
  try {
    nuevo = await deps.crear(nuevoId)
  } catch (e) {
    if (!esDuplicado(e)) return { estado: 'sin_cambios', error: mensaje(e) }
    // Ya estaba en la base: un intento anterior entró. ¿Con los datos de ahora? Solo así se borra el viejo.
    let guardado: CashMovement | null
    try { guardado = await deps.releer(nuevoId) } catch { guardado = null }
    if (!guardado || !deps.coincide(guardado)) return { estado: 'distinto', guardado, reemplazo: reemplazo() }
    nuevo = null
  }
  // En la cola (sin señal): el viejo NO se borra hasta que el nuevo esté en la base. Si la cola lo rechazara, el
  // viejo sigue vivo y vuelve a contar solo (aplicarReemplazos solo lo oculta mientras el nuevo está a la vista).
  if (nuevo?._pending) return { estado: 'falta_borrar', nuevo, reemplazo: reemplazo(), error: null }
  try {
    await deps.borrarViejo()
    return { estado: 'listo', nuevo }
  } catch (e) {
    return { estado: 'falta_borrar', nuevo, reemplazo: reemplazo(), error: mensaje(e) }
  }
}

/** Los campos de plata y de a quién se pagó que lleva el alta de un cambio de pago. */
export interface DatosPago {
  amount_crc:    number
  amount_usd:    number
  supplier_id:   string | null
  method:        string
  caja_origen:   string
  description:   string
  attachments:   string[]
}

/** ¿La fila guardada tiene ESTOS datos? (monto ₡ y $, proveedor, método, caja, nota y fotos, sin importar el orden). */
export function coincidePago(m: Partial<CashMovement> & { attachments?: unknown }, d: DatosPago): boolean {
  const fotos = (x: unknown) => (Array.isArray(x) ? x.map(String) : []).slice().sort().join('|')
  return Number(m.amount_crc ?? 0) === Number(d.amount_crc)
    && Number(m.amount_usd ?? 0) === Number(d.amount_usd)
    && (m.supplier_id || null) === (d.supplier_id || null)
    && (m.method ?? '') === d.method
    && (m.caja_origen ?? '') === d.caja_origen
    && (m.description ?? '') === d.description
    && fotos(m.attachments) === fotos(d.attachments)
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
const PREFIJO_CLAVE = 'satori:caja:reemplazos:'
export const claveReemplazos = (sessionId: string) => `${PREFIJO_CLAVE}${sessionId}`
/** Evento del aparato: avisa a las otras pantallas de Caja que cambió una anotación (useReemplazosAparato). */
export const EVENTO_REEMPLAZOS = 'satori:caja:reemplazos'

type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type AlmacenListable = Pick<Storage, 'getItem' | 'key' | 'length'>
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
  try { globalThis.dispatchEvent?.(new Event(EVENTO_REEMPLAZOS)) } catch { /* sin eventos: se relee al renderizar */ }
}

/**
 * Las anotaciones de TODOS los turnos de este aparato (Movimientos, Proveedores, Pendientes, Resumen y el Cierre del
 * día no tienen un turno abierto propio). Mismo formato y mismo filtro de basura que `leerReemplazos`.
 */
export function leerTodosLosReemplazos(st: AlmacenListable | null = almacen() as AlmacenListable | null): ReemplazoPendiente[] {
  const out: ReemplazoPendiente[] = []
  try {
    if (!st) return out
    const claves: string[] = []
    for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k?.startsWith(PREFIJO_CLAVE)) claves.push(k) }
    for (const k of claves.sort()) out.push(...leerReemplazos(k.slice(PREFIJO_CLAVE.length), st as unknown as Almacen))
  } catch { /* almacenamiento que tira: sin anotaciones */ }
  return out
}

/**
 * Suelta la anotación de ESE pago viejo en todos los turnos del aparato (el cambio terminó, se descartó o se resolvió
 * solo). Avisa a las otras pantallas de Caja con el mismo evento.
 */
export function soltarReemplazo(viejo: string, st: (Almacen & AlmacenListable) | null = almacen() as (Almacen & AlmacenListable) | null): void {
  try {
    if (!st) return
    const claves: string[] = []
    for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k?.startsWith(PREFIJO_CLAVE)) claves.push(k) }
    for (const k of claves) {
      const sid = k.slice(PREFIJO_CLAVE.length)
      const antes = leerReemplazos(sid, st)
      const despues = antes.filter(r => r.viejo !== viejo)
      if (despues.length !== antes.length) {
        if (despues.length) st.setItem(k, JSON.stringify(despues)); else st.removeItem(k)
      }
    }
  } catch { /* almacenamiento que tira: queda como estaba */ }
  try { globalThis.dispatchEvent?.(new Event(EVENTO_REEMPLAZOS)) } catch { /* sin eventos */ }
}

// ── Ronda 3 (I1 del verificador): que un cambio a medias nunca trabe la Noche sin salida ─────────────────────────
// Antes, el único botón para terminarlo estaba en la Caja Diaria del turno abierto. Si OTRO aparato cerraba ese turno,
// en este aparato quedaba la anotación (sin vencer), el Cierre del día frenaba la Noche y el botón ya no estaba en
// ninguna pantalla. Ahora: (a) cada cambio abierto se revisa contra la BASE (no contra la lista cargada) y se suelta
// solo si el viejo ya no existe; (b) el aviso del Cierre del día trae «Terminar el cambio» (y «Descartar el cambio»
// si el nuevo no existe en la base); (c) el freno de la Noche mira solo los cambios de ESE día.

/**
 * Cómo está un cambio abierto en la base:
 *  - `resuelto`: el viejo ya no existe (otro aparato lo terminó o se borró) → la anotación se suelta sola.
 *  - `terminable`: están los dos y el nuevo está confirmado → «Terminar el cambio» (borra el viejo).
 *  - `en_cola`: el nuevo todavía está en la cola de este aparato → esperar a que se sincronice.
 *  - `sin_nuevo`: el viejo está y el nuevo NO existe en la base ni en la cola → «Descartar el cambio» (el viejo
 *    vuelve a contar, que es lo que de verdad hay en la base).
 *  - `desconocido`: no se pudo consultar (sin señal): se deja como está.
 */
export type EstadoCambio = 'resuelto' | 'terminable' | 'en_cola' | 'sin_nuevo' | 'desconocido'

export async function revisarCambioEnBase(
  r: ReemplazoPendiente,
  movs: { id: string; _pending?: boolean }[],
  releer: (id: string) => Promise<{ id: string } | null>,
): Promise<EstadoCambio> {
  try {
    if (!(await releer(r.viejo))) return 'resuelto'
    if (movs.some(m => m.id === r.nuevo && m._pending)) return 'en_cola'
    return (await releer(r.nuevo)) ? 'terminable' : 'sin_nuevo'
  } catch { return 'desconocido' }
}

/**
 * Los cambios abiertos que tocan el día `fecha` (por el turno del pago viejo o del nuevo). Una anotación de otro día
 * no frena el cierre de este. Si no se sabe el día de ninguno de los dos (turno no cargado), cuenta: mejor frenar.
 */
export function reemplazosDelDia(
  abiertos: ReemplazoPendiente[],
  movs: { id: string; session_id?: string | null }[],
  sessions: { id: string; session_date: string }[],
  fecha: string,
): ReemplazoPendiente[] {
  const diaDeSesion = new Map(sessions.map(s => [s.id, s.session_date]))
  const sesionDe = new Map(movs.map(m => [m.id, m.session_id ?? null]))
  const dia = (id: string) => { const s = sesionDe.get(id); return s ? diaDeSesion.get(s) ?? null : null }
  return abiertos.filter(r => {
    const dv = dia(r.viejo), dn = dia(r.nuevo)
    return (dv == null && dn == null) || dv === fecha || dn === fecha
  })
}

export const MSG_FASE2_CON_REEMPLAZO =
  'Antes de cerrar la Noche, terminá el cambio de pago que quedó a medias (aviso rojo arriba, «Terminar el cambio»).'

export const MSG_CIERRE_CON_REEMPLAZO =
  'Antes de cerrar, terminá el cambio de pago que quedó a medias (aviso rojo arriba, «Terminar el cambio»).'
