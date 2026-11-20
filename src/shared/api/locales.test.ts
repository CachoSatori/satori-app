// Mig 195: lectura y escritura del correo base por local (supabase mockeado). Correos ficticios (@ejemplo.com).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const q = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), order: vi.fn(), resultado: { data: [] as unknown, error: null as unknown } }))
vi.mock('./supabase', () => ({ supabase: { from: q.from } }))
vi.mock('./club', () => ({ localActual: () => 'nosara' }))

import { getAliasDelLocal, guardarCorreoBase } from './locales'

beforeEach(() => {
  Object.values(q).forEach(f => typeof f === 'function' && f.mockReset())
  const cadena = { update: q.update, eq: q.eq, select: q.select, order: q.order, then: (ok: (r: unknown) => unknown) => Promise.resolve(q.resultado).then(ok) }
  for (const f of [q.from, q.update, q.eq, q.select, q.order]) f.mockReturnValue(cadena)
  q.resultado = { data: [{ id: 'santa-teresa' }], error: null }
})

describe('guardarCorreoBase', () => {
  it('manda el valor recortado al local pedido y devuelve lo guardado', async () => {
    await expect(guardarCorreoBase('santa-teresa', '  a@ejemplo.com ')).resolves.toBe('a@ejemplo.com')
    expect(q.from).toHaveBeenCalledWith('locations')
    expect(q.update.mock.calls[0][0]).toMatchObject({ correo_base: 'a@ejemplo.com' })
    expect(q.eq).toHaveBeenCalledWith('id', 'santa-teresa')
  })
  it('vacío = borrar (null)', async () => {
    await expect(guardarCorreoBase('santa-teresa', '')).resolves.toBeNull()
    expect(q.update.mock.calls[0][0]).toMatchObject({ correo_base: null })
  })
  it('inválido: no llega a la base', async () => {
    await expect(guardarCorreoBase('santa-teresa', 'a+b@ejemplo.com')).rejects.toThrow(/«\+»/)
    expect(q.from).not.toHaveBeenCalled()
  })
  it('0 filas (la RLS no deja escribir y no da error) → error claro', async () => {
    q.resultado = { data: [], error: null }
    await expect(guardarCorreoBase('santa-teresa', 'a@ejemplo.com')).rejects.toThrow(/solo el owner/)
  })
  it('el check de la base (23514) → mensaje de formato', async () => {
    q.resultado = { data: null, error: { code: '23514', message: 'violates check constraint' } }
    await expect(guardarCorreoBase('santa-teresa', 'a@ejemplo.com')).rejects.toThrow(/formato/)
  })
})

describe('getAliasDelLocal', () => {
  it('usa el local elegido en la app y arma su alias', async () => {
    q.resultado = { data: [
      { id: 'nosara', name: 'Local Ficticio B', is_active: true, correo_base: 'b@ejemplo.com' },
      { id: 'santa-teresa', name: 'Local Ficticio A', is_active: true, correo_base: 'a@ejemplo.com' },
    ], error: null }
    await expect(getAliasDelLocal()).resolves.toEqual({ local: 'Local Ficticio B', alias: 'b+nombre@ejemplo.com' })
    expect(q.select).toHaveBeenCalledWith('id, name, is_active, correo_base')
  })
  it('el local sin correo base → alias null (la pantalla pide cargarlo)', async () => {
    q.resultado = { data: [{ id: 'nosara', name: 'Local Ficticio B', is_active: true, correo_base: null }], error: null }
    await expect(getAliasDelLocal()).resolves.toEqual({ local: 'Local Ficticio B', alias: null })
  })
  it('error de lectura → rechaza (la pantalla dice que no pudo leer)', async () => {
    q.resultado = { data: null, error: { message: 'column locations.correo_base does not exist' } }
    await expect(getAliasDelLocal()).rejects.toThrow(/correo_base/)
  })
})
