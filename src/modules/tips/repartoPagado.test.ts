// Lo pagado manda (decisión del dueño, 20-nov-2026): Historial, Quincenal y Estadísticas muestran el payout y el
// pozo GUARDADOS, no el recálculo. Datos ficticios.
import { describe, expect, it } from 'vitest'
import type { UserRole } from '../../shared/types/database'
import { calcHistory, formatCRC } from '../../shared/utils/tipCalculations'
import { avisosPagado, esRepartoPagado, repartoPagado, sumarFaltantes, type EntradaGuardada } from './repartoPagado'
import { sinRepartirHistoria } from './sinRepartir'

const PUNTOS = [{ role: 'salonero' as UserRole, points: 10 }, { role: 'barman' as UserRole, points: 5 }]
const emp = (id: string, role: UserRole = 'salonero') => ({ id, full_name: `Persona ${id.toUpperCase()}`, role })
const ent = (employee_id: string, payout_crc: number | null, hours_worked = 8, points: number | null = 80, covered_role: UserRole | null = null): EntradaGuardada =>
  ({ employee_id, hours_worked, tip_amount_crc: 0, tip_amount_usd: 0, points, payout_crc, covered_role })
const SES = { pool_efectivo_crc: 60000, pool_efectivo_usd: 0, pool_barra_crc: 0, pool_barra_electronico_crc: 0, exchange_rate: 500, pool_total_crc: 60000 }
// Recalculado: 3 × ₡20.000. Pagado en su momento (puntos de rol de entonces): 25.000 / 20.000 / 15.000.
const PAGADO = [ent('a', 25000), ent('b', 20000), ent('c', 15000)]

describe('repartoPagado · cada fila muestra lo que se pagó', () => {
  it('vista completa (owner): montos guardados, no el recálculo', () => {
    const r = repartoPagado(SES, PAGADO, [emp('a'), emp('b'), emp('c')], PUNTOS)
    expect(r.rows.map(x => x.payout_crc)).toEqual([25000, 20000, 15000])
    expect(r.rows.every(x => !x.sinDato)).toBe(true)
    expect(r.incompleto).toBe(false)
    expect(r.totalPool).toBe(60000)
    expect(r.sinRepartir).toBeNull()
    expect(esRepartoPagado(r)).toBe(true)
  })

  it('vista del cajero/contador (sin la persona inactiva c): el resto ve lo pagado y c queda en «ocultos»', () => {
    const r = repartoPagado(SES, PAGADO, [emp('a'), emp('b')], PUNTOS)
    // El recálculo sin c les daría ₡30.000 a cada uno: ese era el bug.
    expect(calcHistory(PAGADO, [emp('a'), emp('b')], PUNTOS, SES).rows.map(x => x.payout_crc)).toEqual([30000, 30000])
    expect(r.rows.map(x => x.payout_crc)).toEqual([25000, 20000])
    expect(r.ocultos).toEqual({ entradas: 1, pagado: 15000, sinDato: 0 })
    expect(r.incompleto).toBe(true)
    expect(r.totalPool).toBe(60000)
    expect(r.totalPoints).toBe(240)               // puntos guardados de las 3 entradas
    // Lo pagado a c cuenta como cobrado: el pozo cuadra, no hay «sin repartir».
    expect(r.sinRepartir).toBeNull()
  })

  it('el pozo es el guardado aunque el recálculo dé otro número', () => {
    const r = repartoPagado({ ...SES, pool_total_crc: 61000 }, PAGADO, [emp('a'), emp('b'), emp('c')], PUNTOS)
    expect(r.totalPool).toBe(61000)
    expect(r.pozoSinDato).toBe(false)
  })

  it('los puntos de cada fila son los guardados', () => {
    const r = repartoPagado(SES, [ent('a', 30000, 8, 96), ent('b', 30000, 8, 24)], [emp('a'), emp('b')], PUNTOS)
    expect(r.rows.map(x => x.pts_val)).toEqual([96, 24])
  })
})

describe('repartoPagado · sin dato guardado: no se inventa', () => {
  it('payout en null → la fila queda «sin dato» con 0, nunca el recalculado', () => {
    const r = repartoPagado(SES, [ent('a', 25000), ent('b', null), ent('c', 15000)], [emp('a'), emp('b'), emp('c')], PUNTOS)
    expect(r.rows.map(x => [x.payout_crc, x.sinDato])).toEqual([[25000, false], [0, true], [15000, false]])
    expect(r.sinDato).toBe(1)
  })

  it('payout roto (NaN) también es «sin dato»', () => {
    const r = repartoPagado(SES, [ent('a', Number.NaN)], [emp('a')], PUNTOS)
    expect(r.rows[0]).toMatchObject({ payout_crc: 0, sinDato: true })
  })

  it('pozo sin guardar → se marca y se usa el que sale de los montos del turno', () => {
    const r = repartoPagado({ ...SES, pool_total_crc: null }, PAGADO, [emp('a'), emp('b'), emp('c')], PUNTOS)
    expect(r.pozoSinDato).toBe(true)
    expect(r.totalPool).toBe(60000)
  })

  it('una persona oculta sin payout cuenta en ocultos.sinDato y en sinDato', () => {
    const r = repartoPagado(SES, [ent('a', 25000), ent('c', null)], [emp('a')], PUNTOS)
    expect(r.ocultos).toEqual({ entradas: 1, pagado: 0, sinDato: 1 })
    expect(r.sinDato).toBe(1)
  })
})

describe('repartoPagado · aviso «sin repartir» (#320) sobre lo pagado', () => {
  const SES_BARRA = { ...SES, pool_efectivo_crc: 10000, pool_barra_crc: 4000, pool_total_crc: 14000 }

  it('pozo de barra que nadie cobró (guardado): aviso con monto y motivo', () => {
    // Solo sala con horas: se pagaron ₡10.000 de ₡14.000.
    const r = repartoPagado(SES_BARRA, [ent('a', 10000, 6, 60), ent('b', 0, 0, 0)], [emp('a'), emp('b', 'barman')], PUNTOS)
    expect(r.sinRepartir).toMatchObject({ monto: 4000, motivos: ['barra_sin_horas'] })
  })

  it('lo pagado a una persona oculta NO se cuenta como «sin repartir»', () => {
    const r = repartoPagado(SES_BARRA, [ent('a', 10000, 6, 60), ent('x', 4000, 8, 40, 'barman')], [emp('a')], PUNTOS)
    expect(r.incompleto).toBe(true)
    expect(r.sinRepartir).toBeNull()
  })

  it('turno sin lo guardado y con todos a la vista: el aviso sale del reparto reconstruido (como el #320)', () => {
    const entradas = [ent('a', null, 6, null)]
    const r = repartoPagado({ ...SES_BARRA, pool_total_crc: null }, entradas, [emp('a'), emp('b', 'barman')], PUNTOS)
    const esperado = sinRepartirHistoria(calcHistory(entradas, [emp('a'), emp('b', 'barman')], PUNTOS,
      { ...SES_BARRA, pool_barra_crc: 4000 }))
    expect(esperado).toMatchObject({ monto: 4000 })
    expect(r.sinRepartir).toEqual(esperado)
  })

  it('sin lo guardado y con personas ocultas: no se avisa (no se puede saber sin inventar)', () => {
    const r = repartoPagado(SES_BARRA, [ent('a', null, 6, null), ent('x', null)], [emp('a')], PUNTOS)
    expect(r.sinRepartir).toBeNull()
  })
})

describe('avisosPagado / sumarFaltantes', () => {
  it('suma varios turnos y arma los avisos en palabras', () => {
    const t1 = repartoPagado(SES, PAGADO, [emp('a'), emp('b')], PUNTOS)
    const t2 = repartoPagado({ ...SES, pool_total_crc: null }, [ent('a', null), ent('c', 7000)], [emp('a')], PUNTOS)
    const f = sumarFaltantes([t1, t2, undefined])
    expect(f).toEqual({ ocultos: { entradas: 2, pagado: 22000, sinDato: 0 }, sinDato: 1, turnosPozoSinDato: 1 })
    const avisos = avisosPagado(f, formatCRC)
    expect(avisos).toHaveLength(3)
    expect(avisos[0]).toMatch(/^2 pagos a personas que hoy están inactivas no muestran el nombre .*Se les pagó ₡22\.000 y está incluido en el pozo/)
    expect(avisos[1]).toBe('1 monto no tiene dato guardado de lo que se pagó: aparece como «sin dato guardado» y no se recalcula.')
    expect(avisos[2]).toMatch(/^1 turno no tiene guardado el total del pozo/)
  })

  it('sin faltantes no hay aviso', () => {
    expect(avisosPagado(sumarFaltantes([repartoPagado(SES, PAGADO, [emp('a'), emp('b'), emp('c')], PUNTOS)]), formatCRC)).toEqual([])
  })
})
