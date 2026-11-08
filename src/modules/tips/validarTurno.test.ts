import { describe, expect, it } from 'vitest'
import { validarTurno, type DatosTurno, type LineaTurno } from './validarTurno'

const base = (over: Partial<DatosTurno> = {}): DatosTurno => ({
  lineas: [
    { nombre: 'EMPLEADO A', activa: true, hours: 8, propina_crc: 5000, propina_usd: 0 },
    { nombre: 'EMPLEADO B', activa: true, hours: 6, propina_crc: '', propina_usd: '' },
    { nombre: 'EMPLEADO C', activa: false, hours: -3 },   // inactiva: no se valida
  ],
  efectivoCRC: 60000, efectivoUSD: '', barraCRC: '', barraElecCRC: '', exchangeRate: 510,
  totalPool: 65000, totalPoints: 140, ...over,
})

/** El turno base con un campo de una línea cambiado. */
const conLinea = (i: number, cambio: Partial<LineaTurno>, over: Partial<DatosTurno> = {}): DatosTurno => {
  const d = base(over)
  return { ...d, lineas: d.lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)) }
}

describe('validarTurno', () => {
  it('un turno normal pasa', () => { expect(validarTurno(base())).toBeNull() })

  it('horas negativas → frena, con el nombre', () => {
    expect(validarTurno(conLinea(1, { hours: -2 }))).toMatch(/EMPLEADO B: las horas no pueden ser negativas/)
  })

  it('números no finitos (NaN/Infinity) → frena', () => {
    expect(validarTurno(base({ efectivoCRC: Number.NaN }))).toMatch(/no es un número válido/)
    expect(validarTurno(conLinea(0, { propina_crc: Infinity }))).toMatch(/EMPLEADO A: la propina ₡ no es un número válido/)
    expect(validarTurno(base({ totalPool: Number.NaN }))).toMatch(/no dio un número válido/)
  })

  it('montos negativos del pozo → frena', () => {
    expect(validarTurno(base({ barraCRC: -5000 }))).toMatch(/Barra efectivo: no puede ser negativo/)
  })

  it('dólares sin tipo de cambio válido → frena; sin dólares, el TC no importa', () => {
    expect(validarTurno(base({ efectivoUSD: 20, exchangeRate: 0 }))).toMatch(/tipo de cambio/)
    expect(validarTurno(base({ efectivoUSD: 20, exchangeRate: undefined }))).toMatch(/tipo de cambio/)
    expect(validarTurno(conLinea(0, { propina_usd: 5 }, { exchangeRate: Number.NaN }))).toMatch(/tipo de cambio/)
    expect(validarTurno(base({ exchangeRate: 0 }))).toBeNull()
  })

  it('pozo > 0 con 0 puntos en total (el caso del 11-jun) → frena', () => {
    expect(validarTurno(base({ totalPool: 8900, totalPoints: 0 }))).toMatch(/nadie suma puntos/)
    expect(validarTurno(base({ totalPool: 0, totalPoints: 0 }))).toBeNull()
  })
})
