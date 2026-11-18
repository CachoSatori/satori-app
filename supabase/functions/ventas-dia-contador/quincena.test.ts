// Quincena cerrada del correo al contador: 1.ª / 2.ª, meses de 28–31 días, enero → diciembre del año
// anterior, y el reloj DE NOCHE en CR (23:30 CR = 05:30 UTC del día siguiente; R10).
import { describe, it, expect } from 'vitest'
import { armarQuincena, diasDelMes, elegirQuincena, hoyCR, quincenaCerrada } from './quincena.ts'

const utc = (s: string) => new Date(s)

describe('quincenaCerrada', () => {
  it('día 16, 07:00 CR (13:00 UTC, el cron): 1.ª quincena del mes, del 1 al 15', () => {
    const q = quincenaCerrada(utc('2026-11-16T13:00:00Z'))
    expect([q.clave, q.desde, q.hasta, q.fechas.length]).toEqual(['2026-11-1', '2026-11-01', '2026-11-15', 15])
    expect(q.etiqueta).toBe('1–15 de noviembre de 2026')
  })
  it('día 1, 07:00 CR: 2.ª quincena del mes ANTERIOR, del 16 al último día real', () => {
    const q = quincenaCerrada(utc('2026-12-01T13:00:00Z'))
    expect([q.clave, q.desde, q.hasta, q.fechas.length]).toEqual(['2026-11-2', '2026-11-16', '2026-11-30', 15])
  })
  it('meses de 28, 29, 30 y 31 días', () => {
    expect(quincenaCerrada(utc('2027-03-01T13:00:00Z')).hasta).toBe('2027-02-28')   // 28 → 13 días
    expect(quincenaCerrada(utc('2027-03-01T13:00:00Z')).fechas.length).toBe(13)
    expect(quincenaCerrada(utc('2028-03-01T13:00:00Z')).hasta).toBe('2028-02-29')   // bisiesto → 14
    expect(quincenaCerrada(utc('2028-03-01T13:00:00Z')).fechas.length).toBe(14)
    expect(quincenaCerrada(utc('2026-10-01T13:00:00Z')).hasta).toBe('2026-09-30')   // 30 → 15
    expect(quincenaCerrada(utc('2026-11-01T13:00:00Z')).hasta).toBe('2026-10-31')   // 31 → 16
    expect(quincenaCerrada(utc('2026-11-01T13:00:00Z')).fechas.length).toBe(16)
  })
  it('el 1 de enero: 2.ª quincena de diciembre del año anterior', () => {
    expect(quincenaCerrada(utc('2027-01-01T13:00:00Z')).clave).toBe('2026-12-2')
    expect(quincenaCerrada(utc('2027-01-01T13:00:00Z')).hasta).toBe('2026-12-31')
  })
  it('de noche en CR manda la fecha de CR, no la UTC', () => {
    // 2026-12-01 05:30 UTC = 30-nov 23:30 CR → todavía no cerró la 2.ª de noviembre: la última cerrada es la 1.ª.
    expect(quincenaCerrada(utc('2026-12-01T05:30:00Z')).clave).toBe('2026-11-1')
    // 2026-11-16 05:30 UTC = 15-nov 23:30 CR → la última cerrada es la 2.ª de octubre.
    expect(quincenaCerrada(utc('2026-11-16T05:30:00Z')).clave).toBe('2026-10-2')
    expect(hoyCR(utc('2026-11-16T05:30:00Z'))).toEqual({ y: 2026, m: 11, d: 15 })
  })
  it('las fechas del rango son consecutivas y empiezan en 01 o 16', () => {
    for (const [y, m] of [[2026, 2], [2028, 2], [2026, 4], [2026, 12]] as const) {
      expect(diasDelMes(y, m)).toBe(new Date(Date.UTC(y, m, 0)).getUTCDate())
      const q1 = armarQuincena(y, m, 1), q2 = armarQuincena(y, m, 2)
      expect(q1.fechas[0].endsWith('-01') && q2.fechas[0].endsWith('-16')).toBe(true)
      expect(q1.fechas.length + q2.fechas.length).toBe(diasDelMes(y, m))
    }
  })
})

describe('elegirQuincena', () => {
  const ahora = utc('2026-11-17T20:00:00Z')
  it('sin valor: la última cerrada', () => {
    const e = elegirQuincena(undefined, ahora)
    expect(e.ok && e.q.clave).toBe('2026-11-1')
  })
  it('una quincena pasada se puede pedir', () => {
    const e = elegirQuincena('2026-10-2', ahora)
    expect(e.ok && [e.q.desde, e.q.hasta]).toEqual(['2026-10-16', '2026-10-31'])
  })
  it('rechaza formato inválido, antes de 2024 y la quincena que todavía no cerró', () => {
    for (const v of ['2026-11', '2026-13-1', '2026-11-3', 'x', 202611, true]) expect(elegirQuincena(v, ahora).ok).toBe(false)
    expect(elegirQuincena('2023-12-2', ahora).ok).toBe(false)
    const abierta = elegirQuincena('2026-11-2', ahora)
    expect(abierta.ok).toBe(false)
    expect(!abierta.ok && abierta.code).toBe('quincena_abierta')
  })
})
