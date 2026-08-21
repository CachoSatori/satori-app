import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { IngestPunch } from './fetchPunches.js'

// ── Estado local: hasta qué `biotime_id` se confirmó ────────────────────────────
// Vive en la PC del local (no en el repo). Si se pierde, el agente arranca de 0 y
// reingesta el histórico: el `(local, biotime_id)` de la base hace que eso NO duplique.

export interface BridgeState {
  /** `last_id` por local. Un archivo por PC, pero la forma soporta ver los dos. */
  lastIds: Record<string, number>
}

const VACIO: BridgeState = { lastIds: {} }

export function readState(file: string): BridgeState {
  try {
    const crudo: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof crudo !== 'object' || crudo === null) return { ...VACIO }
    const ids = (crudo as { lastIds?: unknown }).lastIds
    if (typeof ids !== 'object' || ids === null) return { ...VACIO }
    const limpio: Record<string, number> = {}
    for (const [k, v] of Object.entries(ids as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) limpio[k] = v
    }
    return { lastIds: limpio }
  } catch {
    // Sin archivo (primer arranque) o archivo ilegible → arrancamos de cero. Reingestar
    // es inocuo; inventar un `last_id` alto se saltearía marcas para siempre.
    return { ...VACIO }
  }
}

export function getLastId(state: BridgeState, local: string): number {
  return state.lastIds[local] ?? 0
}

/** Escritura atómica: si se corta la luz a mitad, el archivo viejo queda entero. */
export function writeState(file: string, state: BridgeState): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

/**
 * El `last_id` que corresponde DESPUÉS de confirmar un lote: el mayor id efectivamente
 * empujado. Nunca se adivina hacia adelante — si un lote no se confirmó, su id no entra.
 */
export function advanceLastId(actual: number, punches: IngestPunch[]): number {
  let mayor = actual
  for (const p of punches) if (p.biotime_id > mayor) mayor = p.biotime_id
  return mayor
}

export function setLastId(state: BridgeState, local: string, lastId: number): BridgeState {
  return { lastIds: { ...state.lastIds, [local]: lastId } }
}
