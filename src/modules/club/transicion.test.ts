// (11-nov, modo transición) La medición por semana y el criterio para apagar la tarjeta vieja (decisión del dueño).
import { describe, it, expect } from 'vitest'
import { lunesCr, inicioDiaCr, rangoTransicion, semanasTransicion, estadoTransicion, type VisitaMedida } from './transicion'

const v = (fecha_visita: string, miembro_id: string, cupon: boolean): VisitaMedida => ({ fecha_visita, miembro_id, cupon_id: cupon ? `c-${fecha_visita}-${miembro_id}` : null })
const varias = (n: number, dia: string, cupon: boolean, m = 'm') => Array.from({ length: n }, (_, i) => v(`${dia}T18:00:00Z`, `${m}${i}`, cupon))

describe('semanas en hora de Costa Rica', () => {
  it('el lunes de la semana, con el borde de la medianoche de Costa Rica (06:00 UTC)', () => {
    expect(lunesCr('2026-11-11T20:00:00Z')).toBe('2026-11-09')     // miércoles 11
    expect(lunesCr('2026-11-16T05:59:00Z')).toBe('2026-11-09')     // domingo 15, 23:59 CR
    expect(lunesCr('2026-11-16T06:00:00Z')).toBe('2026-11-16')     // lunes 16, 00:00 CR
    expect(lunesCr('2026-11-09T06:00:00Z')).toBe('2026-11-09')
    expect(inicioDiaCr('2026-11-09')).toBe('2026-11-09T06:00:00.000Z')
  })
  it('el rango de lectura cubre las semanas pedidas, la de hoy incluida', () => {
    expect(rangoTransicion('2026-11-25T20:00:00Z', 5)).toEqual({ desde: '2026-10-26T06:00:00.000Z', hasta: '2026-11-30T06:00:00.000Z' })
  })
})

describe('cuentas por semana', () => {
  const ahora = '2026-11-25T20:00:00Z'   // miércoles; semana en curso desde el lunes 23
  const visitas = [
    ...varias(2, '2026-11-24', false), v('2026-11-24T19:00:00Z', 'a', true),                 // en curso: 2 viejas, 1 cupón
    ...varias(1, '2026-11-18', false, 'x'), ...varias(9, '2026-11-19', true, 'y'),           // semana del 16: 1 de 10 = 10 %
    v('2026-11-10T18:00:00Z', 'a', false), v('2026-11-11T18:00:00Z', 'a', true),             // semana del 9: «a» con las dos
    v('2026-11-12T18:00:00Z', 'b', false), v('2026-11-13T18:00:00Z', 'b', false),            //   «b» solo con tarjeta vieja
  ]
  const s = semanasTransicion(visitas, ahora, 4)
  it('la semana en curso va primero y no es «completa»', () => {
    expect(s.map(x => x.lunes)).toEqual(['2026-11-23', '2026-11-16', '2026-11-09', '2026-11-02'])
    expect(s[0]).toMatchObject({ enCurso: true, visitas: 3, viejas: 2, conCupon: 1 })
    expect(s[1]).toMatchObject({ enCurso: false, visitas: 10, viejas: 1, conCupon: 9, pctViejas: 10 })
  })
  it('anfitriones que ya usan su QR o link, y los que solo llegaron con tarjeta vieja', () => {
    expect(s[2]).toMatchObject({ visitas: 4, viejas: 3, conCupon: 1, pctViejas: 75, anfitrionesConCupon: 1, anfitrionesSoloVieja: 1 })
  })
  it('una semana sin visitas no tiene porcentaje', () => {
    expect(s[3]).toMatchObject({ visitas: 0, pctViejas: null })
  })
})

describe('criterio para apagar: menos del 15 % dos semanas completas seguidas', () => {
  const ahora = '2026-11-25T20:00:00Z'
  const semana = (lunesDia: string, viejas: number, cupon: number) => [...varias(viejas, lunesDia, false, 'v'), ...varias(cupon, lunesDia, true, 'c')]
  it('10 % y 14 % → se cumple', () => {
    const e = estadoTransicion(semanasTransicion([...semana('2026-11-17', 1, 9), ...semana('2026-11-10', 7, 43)], ahora))
    expect(e.listo).toBe(true); expect(e.texto).toContain('14 % y 10 %')
  })
  it('justo 15 % no alcanza (es «menos de»)', () => {
    expect(estadoTransicion(semanasTransicion([...semana('2026-11-17', 3, 17), ...semana('2026-11-10', 1, 9)], ahora)).listo).toBe(false)
  })
  it('una sola semana baja no alcanza', () => {
    expect(estadoTransicion(semanasTransicion([...semana('2026-11-17', 1, 9), ...semana('2026-11-10', 5, 5)], ahora)).listo).toBe(false)
  })
  it('la semana en curso no cuenta, aunque esté en 0 %', () => {
    const e = estadoTransicion(semanasTransicion([...semana('2026-11-24', 0, 20), ...semana('2026-11-17', 5, 5), ...semana('2026-11-10', 5, 5)], ahora))
    expect(e.listo).toBe(false)
  })
  it('sin dos semanas completas con visitas, no se decide', () => {
    const e = estadoTransicion(semanasTransicion(semana('2026-11-17', 0, 10), ahora))
    expect(e.listo).toBe(false); expect(e.texto).toMatch(/Todavía no hay 2 semanas completas/)
  })
})
