import { describe, it, expect } from 'vitest'
import { parseExcluidos, esExcluidoCocina } from './cocinaExcluidos'

describe('cocinaExcluidos', () => {
  it('parsea la lista separada por comas, sin vacíos y en minúscula', () => {
    expect(parseExcluidos(' Ana , ,LUIS ')).toEqual(['ana', 'luis'])
    expect(parseExcluidos(undefined)).toEqual([])
    expect(parseExcluidos('')).toEqual([])
  })
  it('excluye si el nombre contiene un valor, sin distinguir mayúsculas (como antes)', () => {
    expect(esExcluidoCocina('ANA PÉREZ', ['ana'])).toBe(true)
    expect(esExcluidoCocina('Mariana', ['ana'])).toBe(true)
    expect(esExcluidoCocina('Luis', ['ana'])).toBe(false)
  })
  it('sin configuración no excluye a nadie', () => {
    expect(esExcluidoCocina('Ana', [])).toBe(false)
  })
})
