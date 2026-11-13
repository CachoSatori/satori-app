// (13-nov) extractImageDetalle distingue «falló» de «no vio documentos»; findDuplicateClave y findFacturaParecida.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke, filas, from } = vi.hoisted(() => {
  const filas = { data: [] as unknown[], error: null as null | { message: string } }
  const consulta = () => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'neq', 'eq', 'or', 'ilike', 'order', 'limit']) q[m] = vi.fn(() => q)
    ;(q as { then: unknown }).then = (ok: (v: unknown) => unknown) => Promise.resolve(filas).then(ok)
    return q
  }
  return { invoke: vi.fn(), filas, from: vi.fn(() => consulta()) }
})
vi.mock('./supabase', () => ({ supabase: { functions: { invoke }, from } }))
vi.mock('./cash', () => ({ createDayMovement: vi.fn() }))

import { extractImageDetalle, findDuplicate, findDuplicateClave, findFacturaParecida, type DocExtract } from './documents'

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
    filas.data = [{ id: 'd1', created_at: '2026-11-11T20:00:00Z', estado: 'procesado', linked_movement_id: 'mov-1' }]
    expect(await findDuplicateClave('5'.repeat(50))).toMatchObject({ id: 'd1' })
  })
  it('parecida: entre los candidatos por número, solo la de mismo proveedor y total', async () => {
    const ex = { proveedor: 'Distribuidora Ejemplo', numero_documento: '0354099', total: 25000, moneda: 'CRC' } as DocExtract
    filas.data = [
      { id: 'otro-total', created_at: 'x', estado: 'nuevo', raw_json: { ...ex, total: 999 } },
      { id: 'la-misma', created_at: 'y', estado: 'nuevo', raw_json: { ...ex, numero_documento: '354099' } },
    ]
    expect(await findFacturaParecida(ex)).toMatchObject({ id: 'la-misma' })
    expect(await findFacturaParecida({ ...ex, numero_documento: null })).toBeNull()
  })
})

describe('huérfanos y descartados no cuentan como duplicado (13-nov)', () => {
  const huerfano = { id: 'huerfano', created_at: '2026-11-13T23:01:00Z', estado: 'procesado', linked_movement_id: null }
  const vivo = { id: 'vivo', created_at: '2026-11-10T20:00:00Z', estado: 'procesado', linked_movement_id: 'mov-1' }
  const enBandeja = { id: 'en-bandeja', created_at: '2026-11-12T20:00:00Z', estado: 'nuevo', linked_movement_id: null }

  it('findDuplicate: el huérfano solo no bloquea; un «nuevo» de la Bandeja o un enlazado sí', async () => {
    filas.data = [huerfano]
    expect(await findDuplicate('sha', null)).toBeNull()
    filas.data = [enBandeja]
    expect(await findDuplicate('sha', null)).toMatchObject({ id: 'en-bandeja' })
    filas.data = [huerfano, vivo]   // el huérfano es más nuevo: no tapa al vigente
    expect(await findDuplicate('sha', null)).toMatchObject({ id: 'vivo' })
  })
  it('findDuplicateClave: igual', async () => {
    filas.data = [huerfano]
    expect(await findDuplicateClave('5'.repeat(50))).toBeNull()
    filas.data = [huerfano, vivo]
    expect(await findDuplicateClave('5'.repeat(50))).toMatchObject({ id: 'vivo' })
  })
  it('findFacturaParecida: un huérfano con el mismo número y total no avisa', async () => {
    const ex = { proveedor: 'Distribuidora Ejemplo', numero_documento: '99001', total: 48500, moneda: 'CRC' } as DocExtract
    filas.data = [{ ...huerfano, raw_json: ex }]
    expect(await findFacturaParecida(ex)).toBeNull()
    filas.data = [{ ...huerfano, raw_json: ex }, { ...vivo, raw_json: ex }]
    expect(await findFacturaParecida(ex)).toMatchObject({ id: 'vivo' })
  })
})

// (13-nov, verificación) «Falla cerrada»: si la consulta falla, las tres funciones LANZAN (antes findDuplicate dejaba pasar).
describe('consultas de duplicados con error → lanzan el aviso de conexión (13-nov)', () => {
  const MSG = 'No se pudo verificar si la factura ya está cargada. Revisá la conexión y reintentá.'
  const ex = { proveedor: 'Distribuidora Ejemplo', numero_documento: '99001', total: 48500, moneda: 'CRC' } as DocExtract
  it('error devuelto por la base', async () => {
    filas.error = { message: 'Failed to fetch' }
    await expect(findDuplicate('sha', null)).rejects.toThrow(MSG)
    await expect(findDuplicate('sha', '5'.repeat(50))).rejects.toThrow(MSG)
    await expect(findDuplicateClave('5'.repeat(50))).rejects.toThrow(MSG)
    await expect(findFacturaParecida(ex)).rejects.toThrow(MSG)
  })
  it('excepción de red', async () => {
    from.mockImplementationOnce(() => { throw new TypeError('Failed to fetch') })
    await expect(findDuplicate('sha', null)).rejects.toThrow(MSG)
  })
})
