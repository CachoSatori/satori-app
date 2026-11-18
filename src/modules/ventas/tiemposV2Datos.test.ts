// Ventas v2 · 2.3 — la lectura del turno (080): pedidos de ≤ 366 días, caché por tramo y sin caché de fallas.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../../shared/api/supabase', () => ({ supabase: {} }))
vi.mock('../../shared/api/posNdf', () => ({ getPromPaxAgregado: (...a: unknown[]) => rpc(...a) }))
vi.mock('./resumenV2Datos', async () => {
  const real = await vi.importActual<typeof import('./resumenV2Datos')>('./resumenV2Datos')
  return { DIAS_POR_PEDIDO: real.DIAS_POR_PEDIDO, partirTramo: real.partirTramo, cargarLecturaDeRangos: vi.fn(), getLocalesVentas: vi.fn() }
})

import { cargarTurnos, limpiarCacheTiempos } from './tiemposV2Datos'

beforeEach(() => { rpc.mockReset(); limpiarCacheTiempos() })

describe('cargarTurnos', () => {
  it('un año y medio va en dos pedidos (la 080 acepta hasta 731 días) y junta las filas', async () => {
    rpc.mockImplementation(async (_l: string, desde: string) => [{ dia: desde }])
    const filas = await cargarTurnos('santa-teresa', { desde: '2025-01-01', hasta: '2026-06-30' })
    expect(rpc.mock.calls.map(c => [c[1], c[2]])).toEqual([['2025-01-01', '2026-01-01'], ['2026-01-02', '2026-06-30']])
    expect(filas).toHaveLength(2)
  })

  it('lo leído queda en caché; una falla no', async () => {
    rpc.mockRejectedValueOnce(new Error('caída')).mockResolvedValue([])
    await expect(cargarTurnos('santa-teresa', { desde: '2026-10-01', hasta: '2026-10-31' })).rejects.toThrow('caída')
    await cargarTurnos('santa-teresa', { desde: '2026-10-01', hasta: '2026-10-31' })
    await cargarTurnos('santa-teresa', { desde: '2026-10-01', hasta: '2026-10-31' })
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
