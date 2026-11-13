// (13-nov) extractImageDetalle distingue «falló» de «no vio documentos»; findDuplicateClave y findFacturaParecida.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke, filas, from } = vi.hoisted(() => {
  const filas = { data: [] as unknown[], error: null as null | { message: string } }
  const consulta = () => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'neq', 'eq', 'ilike', 'order', 'limit']) q[m] = vi.fn(() => q)
    ;(q as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(filas).then(ok)
    return q
  }
  return { invoke: vi.fn(), filas, from: vi.fn(() => consulta()) }
})
vi.mock('./supabase', () => ({ supabase: { functions: { invoke }, from } }))
vi.mock('./cash', () => ({ createDayMovement: vi.fn() }))

import { extractImageDetalle, findDuplicateClave, findFacturaParecida, type DocExtract } from './documents'

beforeEach(() => { invoke.mockReset(); from.mockClear(); filas.data = []; filas.error = null })

describe('extractImageDetalle', () => {
  it('lectura bien con documentos → fallo false', async () => {
    invoke.mockResolvedValue({ data: { documentos: [{ tipo: 'factura' }] }, error: null })
    expect(await extractImageDetalle('p')).toEqual({ documentos: [{ tipo: 'factura' }], fallo: false })
  })
  it('lectura bien sin documentos → fallo false (la IA no vio una factura)', async () => {
    invoke.mockResolvedValue({ data: { documentos: [] }, error: null })
    expect(await extractImageDetalle('p')).toEqual({ documentos: [], fallo: false })
  })
  it('error de la función, excepción o respuesta rara → fallo true', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect((await extractImageDetalle('p')).fallo).toBe(true)
    invoke.mockRejectedValue(new Error('red'))
    expect((await extractImageDetalle('p')).fallo).toBe(true)
    invoke.mockResolvedValue({ data: { otra: 1 }, error: null })
    expect((await extractImageDetalle('p')).fallo).toBe(true)
  })
})

describe('findDuplicateClave y findFacturaParecida', () => {
  it('sin una clave FE de verdad no consulta', async () => {
    expect(await findDuplicateClave(null)).toBeNull()
    expect(await findDuplicateClave('123')).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
  it('clave FE ya cargada → devuelve el documento', async () => {
    filas.data = [{ id: 'd1', created_at: '2026-11-11T20:00:00Z' }]
    expect(await findDuplicateClave('5'.repeat(50))).toMatchObject({ id: 'd1' })
  })
  it('parecida: entre los candidatos por número, solo la de mismo proveedor y total', async () => {
    const ex = { proveedor: 'Distribuidora Ejemplo', numero_documento: '0354099', total: 25000, moneda: 'CRC' } as DocExtract
    filas.data = [
      { id: 'otro-total', created_at: 'x', raw_json: { ...ex, total: 999 } },
      { id: 'la-misma', created_at: 'y', raw_json: { ...ex, numero_documento: '354099' } },
    ]
    expect(await findFacturaParecida(ex)).toMatchObject({ id: 'la-misma' })
    expect(await findFacturaParecida({ ...ex, numero_documento: null })).toBeNull()
  })
})
