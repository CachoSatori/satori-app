// 3.5.2: las líneas de UN período (Salón en detalle, Regalías, 🖨 Reporte) salen del lector de siempre
// (`ventasDelRango`) con el `ProductMap` curado fusionado igual que el shell de Ventas, y solo del rango pedido.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DiasMap, ProductMap } from '../../shared/types/ventas'

const pi = (tipo: string, deFamilia = false) => ({ tipo, clasificacion: '', subclasificacion: '', multiplicador: 1, costo_unitario: 0, ...(deFamilia ? { tipoDeFamilia: true } : {}) })
const CURADO: ProductMap = { 'ROLL A': pi('cortesia'), 'SAKE B': pi('desconocido') }
const api = vi.hoisted(() => ({ getProductMap: vi.fn() }))
vi.mock('../../shared/api/ventas', () => api)
const fuente = vi.hoisted(() => ({ ventasDelRango: vi.fn() }))
vi.mock('./ventasFuente', () => fuente)

import { cargarLineasDeRangos, cargarLineasPeriodo, fechasDe, limpiarCacheLineas } from './lineasPeriodo'
import { fusionarProductMap } from './ventasUtils'

const dia = (n: number) => ({ fileName: `d${n}`, uploadedAt: 'x', saloneros: {} }) as unknown as DiasMap[string]
const FAM: ProductMap = { 'ROLL A': pi('comida', true), 'SAKE B': pi('bebida', true) }

beforeEach(() => {
  limpiarCacheLineas()
  api.getProductMap.mockReset().mockResolvedValue(CURADO)
  fuente.ventasDelRango.mockReset().mockImplementation(async (desde: string, hasta: string) => ({
    dias: Object.fromEntries(['2026-10-31', '2026-11-01', '2026-11-02'].filter(f => f >= desde && f <= hasta).map((f, i) => [f, dia(i)])),
    pm: FAM,
  }))
})

describe('cargarLineasPeriodo', () => {
  it('pide SOLO el rango y el local elegidos, y fusiona el curado como el shell (la cortesía a mano se respeta)', async () => {
    const r = await cargarLineasPeriodo('local-b', { desde: '2026-11-01', hasta: '2026-11-02' })
    expect(fuente.ventasDelRango).toHaveBeenCalledWith('2026-11-01', '2026-11-02', 'local-b')
    expect(Object.keys(r.dias).sort()).toEqual(['2026-11-01', '2026-11-02'])
    expect(r.pm).toEqual(fusionarProductMap(CURADO, FAM))
    expect(r.pm['ROLL A'].tipo).toBe('cortesia')   // curado: manda
    expect(r.pm['SAKE B'].tipo).toBe('bebida')     // «desconocido» no es curado: lo rellena la familia
  })

  it('el mismo período no se vuelve a pedir; otro local sí', async () => {
    await cargarLineasPeriodo('santa-teresa', { desde: '2026-11-01', hasta: '2026-11-01' })
    await cargarLineasPeriodo('santa-teresa', { desde: '2026-11-01', hasta: '2026-11-01' })
    expect(fuente.ventasDelRango).toHaveBeenCalledTimes(1)
    await cargarLineasPeriodo('nosara', { desde: '2026-11-01', hasta: '2026-11-01' })
    expect(fuente.ventasDelRango).toHaveBeenCalledTimes(2)
    expect(api.getProductMap).toHaveBeenCalledTimes(1)
  })

  it('si la lectura falla, la siguiente vuelve a pedir (no queda guardado el error)', async () => {
    fuente.ventasDelRango.mockRejectedValueOnce(new Error('red'))
    await expect(cargarLineasPeriodo('santa-teresa', { desde: '2026-11-01', hasta: '2026-11-01' })).rejects.toThrow('red')
    await cargarLineasPeriodo('santa-teresa', { desde: '2026-11-01', hasta: '2026-11-01' })
    expect(fuente.ventasDelRango).toHaveBeenCalledTimes(2)
  })
})

describe('cargarLineasDeRangos y fechasDe', () => {
  it('junta varios rangos en un solo DiasMap', async () => {
    const r = await cargarLineasDeRangos('santa-teresa', [{ desde: '2026-11-01', hasta: '2026-11-02' }, { desde: '2026-10-31', hasta: '2026-10-31' }])
    expect(Object.keys(r.dias).sort()).toEqual(['2026-10-31', '2026-11-01', '2026-11-02'])
    expect(fechasDe(r.dias, { desde: '2026-11-01', hasta: '2026-11-30' })).toEqual(['2026-11-01', '2026-11-02'])
  })
})
