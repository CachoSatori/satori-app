import { describe, it, expect } from 'vitest'

import { enOperacion, horaCR, intervaloMs, naiveCR, rangoLectura } from './ventana.ts'

// Costa Rica es UTC−6 fijo: 2026-09-01T20:00:00Z = 14:00 en Santa Teresa.
const T14_CR = new Date('2026-09-01T20:00:00Z')
const T04_CR = new Date('2026-09-02T10:00:00Z')   // 04:00 CR — madrugada
const T23_CR = new Date('2026-09-02T05:00:00Z')   // 23:00 CR — operación

describe('horaCR / naiveCR', () => {
  it('lee la hora de pared de Costa Rica, no la del runtime', () => {
    expect(horaCR(T14_CR)).toBe(14)
    expect(horaCR(T04_CR)).toBe(4)
    expect(horaCR(T23_CR)).toBe(23)
  })

  it('formatea como el datetime naive del PoS', () => {
    expect(naiveCR(T14_CR)).toBe('2026-09-01 14:00:00')
    expect(naiveCR(new Date('2026-09-02T05:59:00Z'))).toBe('2026-09-01 23:59:00')
  })

  it('la medianoche sale 00, no 24', () => {
    expect(naiveCR(new Date('2026-09-02T06:00:00Z'))).toBe('2026-09-02 00:00:00')
  })
})

describe('enOperacion', () => {
  const ventana = { inicio: 10, fin: 2 }   // abre 10:00, cierra 02:00 → cruza medianoche

  it('cubre el tramo que cruza la medianoche', () => {
    for (const h of [10, 14, 19, 23, 0, 1]) expect(enOperacion(h, ventana)).toBe(true)
    for (const h of [2, 5, 9]) expect(enOperacion(h, ventana)).toBe(false)
  })

  it('también funciona con una ventana que no cruza', () => {
    const dia = { inicio: 8, fin: 17 }
    expect(enOperacion(8, dia)).toBe(true)
    expect(enOperacion(17, dia)).toBe(false)
    expect(enOperacion(3, dia)).toBe(false)
  })
})

describe('intervaloMs', () => {
  const ritmo = { ventana: { inicio: 10, fin: 2 }, operacionMs: 75_000, madrugadaMs: 300_000 }

  it('pollea seguido en operación y espaciado de madrugada', () => {
    expect(intervaloMs(T14_CR, ritmo)).toBe(75_000)
    expect(intervaloMs(T23_CR, ritmo)).toBe(75_000)
    expect(intervaloMs(T04_CR, ritmo)).toBe(300_000)
  })
})

describe('rangoLectura', () => {
  it('mira hacia atrás la ventana y deja margen adelante por el reloj del PoS', () => {
    expect(rangoLectura(T14_CR, 36)).toEqual({
      desde: '2026-08-31 02:00:00',
      hasta: '2026-09-01 16:00:00',
    })
  })

  it('la ventana por defecto cubre un turno que cruza la medianoche', () => {
    const r = rangoLectura(new Date('2026-09-02T07:00:00Z'), 36)   // 01:00 CR
    expect(r.desde).toBe('2026-08-31 13:00:00')                    // alcanza el turno anterior
  })
})
