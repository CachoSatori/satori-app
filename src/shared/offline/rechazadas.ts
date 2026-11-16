// Textos de la cola de rechazadas y del aviso de cola trabada (A01, 16-nov).
// Puro (sin React ni IndexedDB) para poder probar los textos exactos que ve el personal.
import type { RejectedOp, RetryKind, StuckState } from './outbox'
import { dateCR, horaCR, fi } from '../utils'

export function avisoRechazadas(n: number): string {
  return n === 1
    ? 'Hay 1 operación que el servidor rechazó: avisá al manager'
    : `Hay ${n} operaciones que el servidor rechazó: avisá al manager`
}

const MOTIVO_TRABA: Record<RetryKind, string> = {
  sesion: 'la sesión venció. Volvé a iniciar sesión (lo pendiente no se pierde)',
  red: 'no hay conexión estable con el servidor',
  servidor: 'el servidor no está respondiendo bien; se sigue reintentando',
  desconocido: 'error inesperado; se sigue reintentando. Avisá al manager',
}

export function avisoTrabada(s: StuckState): string {
  return `No se pudo sincronizar después de ${s.attempts} intentos: ${MOTIVO_TRABA[s.kind ?? 'desconocido']}. Lo pendiente sigue guardado en este aparato.`
}

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

export function motivoTexto(r: RejectedOp): string {
  const cod = [r.status ? `HTTP ${r.status}` : '', r.code ?? ''].filter(Boolean).join(' · ')
  return cod ? `${r.reason} (${cod})` : r.reason
}
