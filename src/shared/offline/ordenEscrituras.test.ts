import { describe, it, expect } from 'vitest'
import { debeEncolar, estadoFila, targetKey, cashKey, tipKey } from './ordenEscrituras'

const deps = (pend: Array<{ table: string; op: string; payload: Record<string, unknown> }>, rech: Array<{ target?: string }>) => ({
  pendientes: async () => pend, rechazadas: async () => rech,
})
const insM = { table: 'cash_movements', op: 'insert', payload: { id: 'M' } }

describe('A01 — orden entre la cola y las escrituras con red', () => {
  it('targetKey: caja por id, propinas por (turno, persona)', () => {
    expect(targetKey(insM)).toBe(cashKey('M'))
    expect(targetKey({ table: 'cash_movements', op: 'update', payload: { match: { id: 'M' }, updates: {} } })).toBe(cashKey('M'))
    expect(targetKey({ table: 'tip_entries', op: 'upsert', payload: { row: { session_id: 's', employee_id: 'e' } } })).toBe(tipKey('s', 'e'))
    expect(targetKey({ table: 'tip_entries', op: 'delete', payload: { match: { session_id: 's', employee_id: 'e' } } })).toBe(tipKey('s', 'e'))
  })
  it('con cualquier op pendiente, lo nuevo se encola', async () => {
    expect(await debeEncolar(deps([insM], []))).toBe(true)
    expect(await debeEncolar(deps([], []))).toBe(false)
  })
  it('con la fila en rechazadas, se encola; otra fila no', async () => {
    expect(await debeEncolar(deps([], [{ target: cashKey('M') }]), cashKey('M'))).toBe(true)
    expect(await debeEncolar(deps([], [{ target: cashKey('M') }]), cashKey('X'))).toBe(false)
  })
  it('sin IndexedDB no frena nada', async () => {
    const roto = { pendientes: async () => { throw new Error('x') }, rechazadas: async () => [] }
    expect(await debeEncolar(roto)).toBe(false)
  })
  it('estadoFila: pendiente / rechazada / nada', async () => {
    expect(await estadoFila(deps([insM], []), cashKey('M'))).toBe('pendiente')
    expect(await estadoFila(deps([], [{ target: cashKey('M') }]), cashKey('M'))).toBe('rechazada')
    expect(await estadoFila(deps([insM], []), cashKey('X'))).toBeNull()
  })
})

describe('verificador #234 — tope a las lecturas de IndexedDB', () => {
  const colgado = { pendientes: () => new Promise<never>(() => {}), rechazadas: () => new Promise<never>(() => {}) }
  it('si IndexedDB no responde: un ALTA nueva (sin fila) sigue directo', async () => {
    expect(await debeEncolar(colgado, undefined, 20)).toBe(false)
  })
  it('si IndexedDB no responde: una escritura sobre una fila existente va a la cola', async () => {
    expect(await debeEncolar(colgado, 'k', 20)).toBe(true)
  })
  it('si IndexedDB no responde: el estado de la fila es «desconocido» (el borrado se frena)', async () => {
    expect(await estadoFila(colgado, 'k', 20)).toBe('desconocido')
  })
  it('si responde a tiempo, decide igual que siempre', async () => {
    expect(await debeEncolar(deps([insM], []), undefined, 20)).toBe(true)
  })
})
