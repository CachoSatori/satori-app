// Auditoría r5: findDuplicate no arma filtros de PostgREST con texto; valida sha y clave_fe.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const H = vi.hoisted(() => ({ llamadas: [] as string[][], filas: {} as Record<string, unknown[]> }))
vi.mock('./supabase', () => {
  const q = (llamada: string[]) => {
    const api = {
      select: (c: string) => { llamada.push(`select(${c})`); return api },
      neq: (c: string, v: string) => { llamada.push(`neq(${c},${v})`); return api },
      eq: (c: string, v: string) => { llamada.push(`eq(${c},${v})`); return api },
      or: (f: string) => { llamada.push(`or(${f})`); return api },
      limit: () => Promise.resolve({ data: H.filas[llamada.find(x => x.startsWith('eq('))!] ?? [] }),
    }
    return api
  }
  return { supabase: { from: (t: string) => { const l = [`from(${t})`]; H.llamadas.push(l); return q(l) } } }
})
vi.mock('./cash', () => ({ createDayMovement: vi.fn() }))

import { findDuplicate, RE_CLAVE_FE } from './documents'

const SHA = 'a'.repeat(64)
const CLAVE = '5'.repeat(50)

beforeEach(() => { H.llamadas = []; H.filas = {} })

describe('findDuplicate', () => {
  it('nunca usa .or ni interpola texto en un filtro', async () => {
    await findDuplicate(SHA, CLAVE)
    expect(H.llamadas.flat().some(x => x.startsWith('or('))).toBe(false)
    expect(H.llamadas.map(l => l.find(x => x.startsWith('eq(')))).toEqual([`eq(sha256,${SHA})`, `eq(clave_fe,${CLAVE})`])
  })

  it('si encuentra por sha no busca por clave', async () => {
    H.filas[`eq(sha256,${SHA})`] = [{ id: 'd1' }]
    expect(await findDuplicate(SHA, CLAVE)).toEqual({ id: 'd1' })
    expect(H.llamadas).toHaveLength(1)
  })

  it('una clave que no son 50 dígitos no se busca (ni la inyección «1,estado.eq.x»)', async () => {
    for (const mala of ['1,estado.eq.x', `${CLAVE})`, '5'.repeat(49), '5'.repeat(51), `${'5'.repeat(49)}a`]) {
      H.llamadas = []
      expect(await findDuplicate(SHA, mala)).toBeNull()
      expect(H.llamadas.map(l => l.find(x => x.startsWith('eq(')))).toEqual([`eq(sha256,${SHA})`])
    }
  })

  it('un sha que no es SHA-256 no se busca', async () => {
    expect(await findDuplicate('x,clave_fe.eq.1', null)).toBeNull()
    expect(H.llamadas).toHaveLength(0)
  })

  it('RE_CLAVE_FE', () => {
    expect(RE_CLAVE_FE.test(CLAVE)).toBe(true)
    expect(RE_CLAVE_FE.test(` ${CLAVE}`)).toBe(false)
  })
})
