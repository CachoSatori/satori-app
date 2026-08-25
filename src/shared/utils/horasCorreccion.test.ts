import { describe, it, expect } from 'vitest'
import {
  horasEntreMarcas, esHoraReloj, motivoCorreccion, marcaUnicaDeImpar, HORAS_SOSPECHOSAS,
} from './horasCorreccion'

describe('horasEntreMarcas', () => {
  it('el caso normal: resta directa', () => {
    expect(horasEntreMarcas('09:00', '17:30')).toBe(8.5)
    expect(horasEntreMarcas('11:07', '19:22')).toBe(8.25)
  })

  it('redondea a 2 decimales', () => {
    // 11:07 → 17:00 = 353 min = 5.8833… h
    expect(horasEntreMarcas('11:07', '17:00')).toBe(5.88)
    // 08:00 → 12:20 = 260 min = 4.3333… h
    expect(horasEntreMarcas('08:00', '12:20')).toBe(4.33)
  })

  it('cruza medianoche: la salida "anterior" suma 24 h', () => {
    expect(horasEntreMarcas('18:00', '02:00')).toBe(8)
    expect(horasEntreMarcas('22:30', '00:15')).toBe(1.75)
    expect(horasEntreMarcas('23:59', '00:00')).toBe(0.02)   // 1 minuto
  })

  it('entrada == salida da 24 h (absurdo pero honesto: para eso está el aviso)', () => {
    expect(horasEntreMarcas('11:00', '11:00')).toBe(24)
    expect(horasEntreMarcas('11:00', '11:00')!).toBeGreaterThan(HORAS_SOSPECHOSAS)
  })

  it('formato inválido → null, nunca un número inventado', () => {
    expect(horasEntreMarcas('9:00', '17:00')).toBeNull()     // sin cero a la izquierda
    expect(horasEntreMarcas('24:00', '17:00')).toBeNull()    // hora fuera de rango
    expect(horasEntreMarcas('12:60', '17:00')).toBeNull()    // minuto fuera de rango
    expect(horasEntreMarcas('09:00', '')).toBeNull()
    expect(horasEntreMarcas('', '')).toBeNull()
    expect(horasEntreMarcas('09:00', '17:00:00')).toBeNull()
    expect(horasEntreMarcas('mediodía', '17:00')).toBeNull()
  })

  it('acepta los bordes del reloj', () => {
    expect(horasEntreMarcas('00:00', '23:59')).toBe(23.98)
    expect(esHoraReloj('00:00')).toBe(true)
    expect(esHoraReloj('23:59')).toBe(true)
    expect(esHoraReloj('24:00')).toBe(false)
    expect(esHoraReloj('7:30')).toBe(false)
  })
})

describe('motivoCorreccion', () => {
  it('deja escrito qué mitad puso el reloj y cuál la persona', () => {
    expect(motivoCorreccion('11:07', '19:00', 'in', '11:07'))
      .toBe('entró 11:07 → salió 19:00 (marca real: entrada 11:07, mitad completada a mano)')
    expect(motivoCorreccion('10:00', '18:42', 'out', '18:42'))
      .toBe('entró 10:00 → salió 18:42 (marca real: salida 18:42, mitad completada a mano)')
  })
})

describe('marcaUnicaDeImpar', () => {
  const base = {
    tipo: 'impar', employee_id: 'e1', work_date: '2026-08-03',
    detalle: { cuantas: 1, marcas: [{ id: 'p1', punch_at: '2026-08-03T17:07:00Z', punch_state: 'in' }] },
  }

  it('devuelve la marca cuando el impar tiene UNA sola', () => {
    expect(marcaUnicaDeImpar(base)).toEqual({
      id: 'p1', punch_at: '2026-08-03T17:07:00Z', punch_state: 'in',
    })
  })

  it('no aplica con más de una marca: ahí hace falta criterio, no una resta', () => {
    expect(marcaUnicaDeImpar({ ...base, detalle: { marcas: [
      { id: 'p1', punch_at: '2026-08-03T17:07:00Z', punch_state: 'in' },
      { id: 'p2', punch_at: '2026-08-03T22:00:00Z', punch_state: 'out' },
    ] } })).toBeNull()
  })

  it('no aplica a solapado, turno_largo ni sin_mapear', () => {
    for (const tipo of ['solapado', 'turno_largo', 'sin_mapear']) {
      expect(marcaUnicaDeImpar({ ...base, tipo })).toBeNull()
    }
  })

  it('no aplica sin empleado o sin jornada', () => {
    expect(marcaUnicaDeImpar({ ...base, employee_id: null })).toBeNull()
    expect(marcaUnicaDeImpar({ ...base, work_date: null })).toBeNull()
  })

  it('detalle vacío o corrupto no rompe: devuelve null', () => {
    expect(marcaUnicaDeImpar({ ...base, detalle: null })).toBeNull()
    expect(marcaUnicaDeImpar({ ...base, detalle: {} })).toBeNull()
    expect(marcaUnicaDeImpar({ ...base, detalle: { marcas: 'no-es-lista' } })).toBeNull()
    expect(marcaUnicaDeImpar({ ...base, detalle: { marcas: [{ id: 'p1' }] } })).toBeNull()
    expect(marcaUnicaDeImpar({ ...base, detalle: { marcas: [{ id: 'p1', punch_at: 'x', punch_state: 'raro' }] } })).toBeNull()
  })
})
