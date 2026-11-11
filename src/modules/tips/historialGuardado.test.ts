import { describe, expect, it } from 'vitest'
import type { HistoryCalc } from '../../shared/utils/tipCalculations'
import { avisoFaltantes, conPayoutsGuardados, esCalcGuardado } from './historialGuardado'

const fila = (employeeId: string, payout_crc: number) => ({
  employeeId, employeeName: employeeId.toUpperCase(), role: 'salonero' as const, coveredRole: null,
  hours: 8, propina_crc: 0, propina_usd: 0, pts_rol: 1, pts_val: 8, payout_crc,
})
const calc: HistoryCalc = {
  rows: [fila('a', 30000), fila('b', 30000)],   // recalculado SIN la persona c (no visible)
  generalPool: 60000, barraPool: 0, totalPool: 60000, totalPoints: 16, generalRate: 3750,
}
const entradas = [
  { employee_id: 'a', payout_crc: 25000 },
  { employee_id: 'b', payout_crc: 20000 },
  { employee_id: 'c', payout_crc: 15000 },     // hoy inactiva: cajero/contador no la ven
]

describe('conPayoutsGuardados', () => {
  it('cada fila muestra lo GUARDADO (lo que se pagó), no lo recalculado', () => {
    const r = conPayoutsGuardados(calc, entradas, [{ id: 'a' }, { id: 'b' }], 60000)
    expect(r.rows.map(x => x.payout_crc)).toEqual([25000, 20000])
  })
  it('el pozo es el guardado; sin guardado, el recalculado', () => {
    expect(conPayoutsGuardados(calc, entradas, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 61000).totalPool).toBe(61000)
    expect(conPayoutsGuardados(calc, entradas, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], null).totalPool).toBe(60000)
  })
  it('cuenta las personas que faltan en la vista y lo que se les pagó', () => {
    const r = conPayoutsGuardados(calc, entradas, [{ id: 'a' }, { id: 'b' }], 60000)
    expect(r.faltan).toEqual({ entradas: 1, payout: 15000 })
    expect(r.incompleto).toBe(true)
    expect(esCalcGuardado(r)).toBe(true)
    expect(avisoFaltantes(r.faltan, n => `₡${n}`)).toMatch(/1 persona que hoy está inactiva no aparece.*₡15000/)
  })
  it('sin faltantes: completo y sin aviso', () => {
    const r = conPayoutsGuardados(calc, entradas.slice(0, 2), [{ id: 'a' }, { id: 'b' }], 45000)
    expect(r.incompleto).toBe(false)
    expect(avisoFaltantes(r.faltan, String)).toBeNull()
  })
  it('un payout guardado vacío o roto deja el recalculado (no muestra NaN)', () => {
    const r = conPayoutsGuardados(calc, [{ employee_id: 'a', payout_crc: null }, { employee_id: 'b', payout_crc: Number.NaN }], [{ id: 'a' }, { id: 'b' }], 60000)
    expect(r.rows.map(x => x.payout_crc)).toEqual([30000, 30000])
  })
})
