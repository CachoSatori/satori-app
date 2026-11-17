// Textos de la cola de rechazadas y del aviso de cola trabada (A01, 16-nov).
// Puro (sin React ni IndexedDB) para poder probar los textos exactos que ve el personal.
import type { RejectedOp, RetryKind, StuckState } from './outbox'
import { dateCR, horaCR, fi } from '../utils'

/**
 * n = total en la lista; sinConfirmar = las que no tuvieron un rechazo explícito (pasadas a mano y lo
 * que va con ellas). No se dice «rechazó» de algo que el servidor no rechazó.
 */
export function avisoRechazadas(n: number, sinConfirmar = 0): string {
  const m = Math.min(Math.max(sinConfirmar, 0), n)
  const r = n - m
  const ops = (k: number) => (k === 1 ? '1 operación' : `${k} operaciones`)
  if (m === 0) return `Hay ${ops(r)} que el servidor rechazó: avisá al manager`
  if (r === 0) return `Hay ${ops(m)} que el servidor no confirmó: avisá al manager`
  return `Hay ${ops(r)} que el servidor rechazó y ${m} que no confirmó: avisá al manager`
}

const MOTIVO_TRABA: Record<RetryKind, string> = {
  sesion: 'la sesión venció. Volvé a iniciar sesión (lo pendiente no se pierde)',
  red: 'no hay conexión estable con el servidor',
  servidor: 'el servidor no está respondiendo bien; se sigue reintentando',
  lento: 'el servidor tarda en responder esta operación; se sigue reintentando',
  desconocido: 'error inesperado; se sigue reintentando. Avisá al manager',
}

export const motivoTraba = (s: StuckState) => MOTIVO_TRABA[s.kind ?? 'desconocido']

export function avisoTrabada(s: StuckState): string {
  return `No se pudo sincronizar después de ${s.attempts} intentos: ${motivoTraba(s)}. Lo pendiente sigue guardado en este aparato.`
}

export const CONFIRMAR_PASAR =
  'La primera operación de la cola no entra y frena todo lo demás. ¿Pasarla a rechazadas? No se borra: queda en «Ver detalle», junto con lo que dependa de ella, y el resto de la cola sigue.'
export const CONFIRMAR_RESUELTA =
  '¿Ya cargaste o corregiste esto a mano? Se quita de la lista junto con lo que va con ella, y queda registrado en este aparato.'

/** «16/11 12:05» en hora de Costa Rica. */
export function cuandoCR(iso: string): string {
  const d = dateCR(iso)
  if (!d) return '—'
  const [, m, day] = d.split('-')
  return `${day}/${m} ${horaCR(iso)}`
}

const ACCION: Record<RejectedOp['op'], string> = { insert: 'nuevo', upsert: 'guardar', update: 'edición', delete: 'borrado' }

/** Qué era la operación, en palabras del local (monto y concepto si los tiene). */
export function queEra(r: RejectedOp): string {
  const p = r.payload ?? {}
  const fila = (r.op === 'upsert' ? (p.row as Record<string, unknown> | undefined)
    : r.op === 'update' ? (p.updates as Record<string, unknown> | undefined)
    : r.op === 'insert' ? p : undefined) ?? {}
  if (r.table === 'cash_movements') {
    const partes = [`Movimiento de caja · ${ACCION[r.op]}`]
    if (typeof fila.amount_crc === 'number') partes.push(fi(fila.amount_crc))
    if (typeof fila.description === 'string' && fila.description.trim()) partes.push(fila.description.trim())
    return partes.join(' · ')
  }
  const partes = [`Propinas del turno · ${ACCION[r.op]}`]
  if (typeof fila.tip_amount_crc === 'number') partes.push(`propina ${fi(fila.tip_amount_crc)}`)
  return partes.join(' · ')
}

/**
 * Qué se sabe de la operación. Nunca se afirma «no se guardó» sin un rechazo explícito del servidor:
 * una op que se pasó a mano (timeout, 5xx) puede haber entrado.
 */
export function estadoTexto(r: RejectedOp): string {
  if (r.incierta) return ESTADO_INCIERTA
  if (r.depends_on) return 'No se envió: va junto con la operación rechazada de la misma fila. Se reintenta o se resuelve todo junto, en orden.'
  return 'No quedó guardada: el servidor la rechazó.'
}
export const ESTADO_INCIERTA =
  'Estado desconocido: puede que ya haya entrado. Tocá «↻ Reintentar» antes de cargarla a mano (si ya estaba, no se duplica).'
export const CONFIRMAR_RESUELTA_INCIERTA =
  'Hay una operación en estado desconocido: puede que ya haya entrado. Tocá «↻ Reintentar» primero (si ya estaba, no se duplica). ¿Igual la marcás como resuelta?'

export function motivoTexto(r: RejectedOp): string {
  const cod = [r.status ? `HTTP ${r.status}` : '', r.code ?? ''].filter(Boolean).join(' · ')
  return cod ? `${r.reason} (${cod})` : r.reason
}

export const NO_SE_PUDO_PASAR = 'No se pudo pasar a rechazadas: la operación sigue en la cola, no se perdió nada. Probá de nuevo.'
