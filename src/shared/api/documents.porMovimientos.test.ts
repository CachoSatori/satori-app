// (26-nov, #370) listDocsForMovements: el mapa de facturas de Movimientos tiene que estar COMPLETO para los
// movimientos cargados. `listLinkedDocs` corta en 500 y en prod hay más documentos enlazados: un movimiento cuya
// factura quedaba afuera del tope figuraba «Sin factura» (y el atajo «Efectivo sin factura» lo mostraba).
// La base falsa aplica de verdad eq / in / not-is-null / order / limit sobre un set de 752 documentos.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Doc = { id: string; estado: string; linked_movement_id: string | null; created_at: string }
const base = vi.hoisted(() => ({
  docs: [] as Doc[],
  falla: null as null | ((filtroIn: string[] | null) => boolean),
  consultas: [] as { inIds: string[] | null; limite: number | null }[],
}))

vi.mock('./supabase', () => {
  const from = () => {
    let filas = [...base.docs]
    let inIds: string[] | null = null
    let limite: number | null = null
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: keyof Doc, v: unknown) => { filas = filas.filter(f => f[c] === v); return q },
      in: (c: keyof Doc, vs: string[]) => { inIds = vs; filas = filas.filter(f => vs.includes(f[c] as string)); return q },
      not: (c: keyof Doc, op: string, v: unknown) => { if (op === 'is' && v === null) filas = filas.filter(f => f[c] !== null); return q },
      order: (c: keyof Doc, o: { ascending: boolean }) => {
        filas.sort((a, b) => (o.ascending ? 1 : -1) * String(a[c]).localeCompare(String(b[c]))); return q
      },
      limit: (n: number) => { limite = n; filas = filas.slice(0, n); return q },
      then: (ok: (v: unknown) => unknown) => {
        base.consultas.push({ inIds, limite })
        const error = base.falla?.(inIds) ? { message: 'falló la tanda' } : null
        return Promise.resolve(error ? { data: null, error } : { data: filas, error: null }).then(ok)
      },
    }
    return q
  }
  return { supabase: { from } }
})
vi.mock('./cash', () => ({ createDayMovement: vi.fn() }))

import { listDocsForMovements, TANDA_IDS_DOCS, TOPE_FILAS_TANDA } from './documents'

// 752 movimientos, cada uno con su factura; m-0000 tiene la factura MÁS VIEJA (la que el tope de 500 dejaba afuera).
const N = 752
const movId = (i: number) => `m-${String(i).padStart(4, '0')}`
const armar = () => {
  base.docs = Array.from({ length: N }, (_, i) => ({
    id: `d-${i}`, estado: 'procesado', linked_movement_id: movId(i),
    created_at: new Date(Date.UTC(2026, 5, 1) + i * 3_600_000).toISOString(),
  }))
}
const todos = () => Array.from({ length: N }, (_, i) => movId(i))

beforeEach(() => { armar(); base.falla = null; base.consultas = [] })

describe('listDocsForMovements', () => {
  it('con más de 500 enlazadas, la factura más vieja (afuera del tope antiguo) aparece', async () => {
    const docs = await listDocsForMovements(todos())
    const enlazados = new Set(docs.map(d => d.linked_movement_id))
    expect(enlazados.size).toBe(N)
    expect(enlazados.has('m-0000')).toBe(true)
  })

  it('consulta por ids en tandas de ≤200', async () => {
    await listDocsForMovements(todos())
    expect(base.consultas.length).toBe(Math.ceil(N / TANDA_IDS_DOCS))
    expect(base.consultas.every(c => c.inIds !== null && c.inIds.length <= TANDA_IDS_DOCS)).toBe(true)
  })

  it('solo trae documentos procesados de esos movimientos', async () => {
    base.docs.push({ id: 'd-desc', estado: 'descartado', linked_movement_id: 'm-0001', created_at: '2026-12-01T00:00:00Z' })
    base.docs.push({ id: 'd-otro', estado: 'procesado', linked_movement_id: 'm-ajeno', created_at: '2026-12-01T00:00:00Z' })
    const docs = await listDocsForMovements(['m-0001'])
    expect(docs.map(d => d.id)).toEqual(['d-1'])
  })

  it('sin movimientos no consulta', async () => {
    expect(await listDocsForMovements([])).toEqual([])
    expect(base.consultas.length).toBe(0)
  })

  it('si UNA tanda falla, falla todo (nunca una lista parcial)', async () => {
    base.falla = ids => !!ids?.includes('m-0400')
    await expect(listDocsForMovements(todos())).rejects.toThrow()
  })

  it('una tanda que vuelve llena hasta el tope de filas se trata como incompleta', async () => {
    base.docs = Array.from({ length: TOPE_FILAS_TANDA + 5 }, (_, i) => ({
      id: `x-${i}`, estado: 'procesado', linked_movement_id: 'm-0000', created_at: new Date(Date.UTC(2026, 0, 1) + i).toISOString(),
    }))
    await expect(listDocsForMovements(['m-0000'])).rejects.toThrow(/incompleta/)
  })
})
