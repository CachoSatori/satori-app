// getEmployeeByProfileId con un perfil que tiene DOS filas de empleado (caso real de prod: PECHE,
// manager activa + salonero inactiva). Antes `maybeSingle()` sobre dos filas tiraba error y Mi
// Rendimiento lo mostraba como «sin vínculo». Ahora pide la activa primero y UNA sola fila.
import { describe, it, expect, vi } from 'vitest'

const H = vi.hoisted(() => {
  const llamadas: { metodo: string; args: unknown[] }[] = []
  const filas = [
    { id: 'e-peche-activa', full_name: 'PECHE', is_active: true },
    { id: 'e-peche-vieja',  full_name: 'PECHE', is_active: false },
  ]
  const api: Record<string, (...a: unknown[]) => unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) {
    api[m] = (...args: unknown[]) => { llamadas.push({ metodo: m, args }); return api }
  }
  api.maybeSingle = () => {
    llamadas.push({ metodo: 'maybeSingle', args: [] })
    // Como PostgREST: con más de una fila, maybeSingle es un error; con limit(1), devuelve la primera.
    const lim = llamadas.find(l => l.metodo === 'limit')?.args[0] as number | undefined
    const orden = llamadas.find(l => l.metodo === 'order' && l.args[0] === 'is_active')
    const ordenadas = orden ? [...filas].sort((a, b) => Number(b.is_active) - Number(a.is_active)) : filas
    const r = lim ? ordenadas.slice(0, lim) : ordenadas
    return Promise.resolve(r.length > 1
      ? { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
      : { data: r[0] ?? null, error: null })
  }
  return { llamadas, cliente: { from: () => api } }
})

vi.mock('./supabase', () => ({ supabase: H.cliente }))

import { getEmployeeByProfileId } from './admin'

describe('getEmployeeByProfileId — perfil con dos filas de empleado', () => {
  it('devuelve la fila ACTIVA en vez de tirar error', async () => {
    const e = await getEmployeeByProfileId('p-peche')
    expect(e?.id).toBe('e-peche-activa')
  })

  it('pide activa primero y UNA sola fila', () => {
    expect(H.llamadas).toContainEqual({ metodo: 'eq', args: ['profile_id', 'p-peche'] })
    expect(H.llamadas).toContainEqual({ metodo: 'order', args: ['is_active', { ascending: false }] })
    expect(H.llamadas).toContainEqual({ metodo: 'limit', args: [1] })
  })
})
