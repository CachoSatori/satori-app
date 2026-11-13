// (D12 = A) guardarAliasProveedor contra un cliente simulado. Mutaciones anotadas (verificadas el 13-nov):
//  P1. sin el chequeo de 0 filas → cae «RLS sin permiso…».
//  P2. sin re-leer de la base (usar lista vacía) → cae «ya estaba en la base…» y «conserva los que ya había».
import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  aliases: null as string[] | null,
  updFilas: 1,
  updError: null as { message: string } | null,
  updates: [] as unknown[],
}))
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { aliases: db.aliases }, error: null }) }) }),
      update: (v: unknown) => ({ eq: () => ({ select: async () => {
        db.updates.push(v)
        return db.updError ? { data: null, error: db.updError } : { data: Array.from({ length: db.updFilas }, () => ({ id: 'p1' })), error: null }
      } }) }),
    }),
  },
}))
import { guardarAliasProveedor } from './proveedorAlias'

beforeEach(() => { db.aliases = null; db.updFilas = 1; db.updError = null; db.updates = [] })

describe('guardarAliasProveedor', () => {
  it('agrega el alias conservando los que ya había', async () => {
    db.aliases = ['Legal Uno']
    await expect(guardarAliasProveedor('p1', 'Legal Dos')).resolves.toBe('agregado')
    expect(db.updates).toEqual([{ aliases: ['Legal Uno', 'Legal Dos'] }])
  })
  it('ya estaba en la base (por clave) → no actualiza', async () => {
    db.aliases = ['Legal Dos, S.A.']
    await expect(guardarAliasProveedor('p1', 'LEGAL DOS SA')).resolves.toBe('ya_estaba')
    expect(db.updates).toEqual([])
  })
  it('RLS sin permiso (0 filas) → error', async () => {
    db.updFilas = 0
    await expect(guardarAliasProveedor('p1', 'Legal Dos')).rejects.toThrow(/sin permiso/)
  })
  it('error del update → error', async () => {
    db.updError = { message: 'network' }
    await expect(guardarAliasProveedor('p1', 'Legal Dos')).rejects.toThrow('network')
  })
})
