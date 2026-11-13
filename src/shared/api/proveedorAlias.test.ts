// (D12 = A) guardarAliasProveedor contra un cliente simulado. Mutaciones anotadas (verificadas el 13-nov):
//  P1. sin el chequeo de 0 filas → cae «RLS sin permiso…».
//  P2. sin re-leer de la base (usar lista vacía) → cae «ya estaba en la base…» y «conserva los que ya había».
// (mig 153) Camino RPC. Mutaciones anotadas (verificadas el 13-nov):
//  R1. sin la RPC (siempre el UPDATE) → caen 3: «usa la RPC…», «RPC false…» y «otro error de la RPC…».
//  R2. sin el respaldo (cualquier error de la RPC tira) → caen los 4 casos de «respaldo sin la 153».
//  R3. respaldo ante CUALQUIER error (no solo inexistente) → cae «otro error de la RPC → tira, sin UPDATE».
//  R4. `data === true` → `data !== undefined` (false cuenta como agregado) → cae «RPC false…».
import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  aliases: null as string[] | null,
  updFilas: 1,
  updError: null as { message: string } | null,
  updates: [] as unknown[],
  rpcRes: { data: null as unknown, error: null as { message: string; code?: string } | null },
  rpcCalls: [] as { fn: string; args: unknown }[],
}))
vi.mock('./supabase', () => ({
  supabase: {
    rpc(fn: string, args: unknown) {
      db.rpcCalls.push({ fn, args })
      return Promise.resolve(db.rpcRes)
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { aliases: db.aliases }, error: null }) }) }),
      update: (v: unknown) => ({ eq: () => ({ select: async () => {
        db.updates.push(v)
        return db.updError ? { data: null, error: db.updError } : { data: Array.from({ length: db.updFilas }, () => ({ id: 'p1' })), error: null }
      } }) }),
    }),
  },
}))
import { guardarAliasProveedor, esFuncionInexistente } from './proveedorAlias'

const SIN_153 = { message: 'Could not find the function public.proveedor_agregar_alias(p_alias, p_supplier_id) in the schema cache', code: 'PGRST202' }

beforeEach(() => {
  db.aliases = null; db.updFilas = 1; db.updError = null; db.updates = []
  db.rpcRes = { data: true, error: null }; db.rpcCalls = []
})

describe('guardarAliasProveedor — RPC atómica (mig 153)', () => {
  it('usa la RPC con los parámetros de la 153 y no hace UPDATE', async () => {
    await expect(guardarAliasProveedor('p1', 'Legal Dos')).resolves.toBe('agregado')
    expect(db.rpcCalls).toEqual([{ fn: 'proveedor_agregar_alias', args: { p_supplier_id: 'p1', p_alias: 'Legal Dos' } }])
    expect(db.updates).toEqual([])
  })
  it('RPC false (ya estaba / inactivo / sin permiso) → ya_estaba, sin UPDATE', async () => {
    db.rpcRes = { data: false, error: null }
    await expect(guardarAliasProveedor('p1', 'Legal Dos')).resolves.toBe('ya_estaba')
    expect(db.updates).toEqual([])
  })
  it('otro error de la RPC (p. ej. alias corto, 22023) → tira, sin UPDATE', async () => {
    db.rpcRes = { data: null, error: { message: 'ALIAS_CORTO: …', code: '22023' } }
    await expect(guardarAliasProveedor('p1', 'S.A.')).rejects.toThrow('ALIAS_CORTO')
    expect(db.updates).toEqual([])
  })
})

describe('guardarAliasProveedor — respaldo sin la 153 (función inexistente)', () => {
  beforeEach(() => { db.rpcRes = { data: null, error: SIN_153 } })
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

describe('esFuncionInexistente', () => {
  it('reconoce PGRST202, 42883 y el mensaje de PostgREST; no otros errores', () => {
    expect(esFuncionInexistente(SIN_153)).toBe(true)
    expect(esFuncionInexistente({ message: 'function x does not exist', code: '42883' })).toBe(true)
    expect(esFuncionInexistente({ message: 'Could not find the function public.f in the schema cache' })).toBe(true)
    expect(esFuncionInexistente({ message: 'permission denied for function', code: '42501' })).toBe(false)
    expect(esFuncionInexistente({ message: 'Failed to fetch' })).toBe(false)
    expect(esFuncionInexistente(null)).toBe(false)
  })
})
