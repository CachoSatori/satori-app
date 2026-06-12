import { describe, it, expect } from 'vitest'
import { buildMenu, categoryOf } from './comanderoMenu'

const meta = (tipo: string, sub: string, station = 'cocina') => ({ tipo, subclasificacion: sub, station })

describe('comanderoMenu — armado puro del grid (SPEC P0-b)', () => {
  it('solo entran productos con precio cargado', () => {
    const { categories, byCategory } = buildMenu(
      new Map([
        ['SATORI ROLL', meta('Comida', 'Rolls')],
        ['ROLL SIN PRECIO', meta('Comida', 'Rolls')],
      ]),
      new Map([
        ['SATORI ROLL', { price_final_crc: 7500 }],
        ['ROLL SIN PRECIO', { price_final_crc: null }],
      ]),
    )
    expect(categories).toEqual(['Rolls'])
    expect(byCategory.get('Rolls')!.map(t => t.nombre)).toEqual(['SATORI ROLL'])
  })

  it('categoría = subclasificación; cae a tipo y luego a Otros', () => {
    expect(categoryOf(meta('Comida', 'Nigiris'))).toBe('Nigiris')
    expect(categoryOf(meta('Bebida', ''))).toBe('Bebida')
    expect(categoryOf(meta('', '  '))).toBe('Otros')
  })

  it('categorías y tiles en alfabético es-CR; station viaja al tile', () => {
    const { categories, byCategory } = buildMenu(
      new Map([
        ['MOJITO', meta('Bebida', 'Cócteles', 'barra')],
        ['ÑOQUI', meta('Comida', 'Principales')],
        ['ATÚN ROLL', meta('Comida', 'Rolls')],
        ['AVOCADO ROLL', meta('Comida', 'Rolls')],
      ]),
      new Map([
        ['MOJITO', { price_final_crc: 4500 }],
        ['ÑOQUI', { price_final_crc: 8000 }],
        ['ATÚN ROLL', { price_final_crc: 6500 }],
        ['AVOCADO ROLL', { price_final_crc: 5500 }],
      ]),
    )
    expect(categories).toEqual(['Cócteles', 'Principales', 'Rolls'])
    expect(byCategory.get('Rolls')!.map(t => t.nombre)).toEqual(['ATÚN ROLL', 'AVOCADO ROLL'])
    expect(byCategory.get('Cócteles')![0].station).toBe('barra')
  })
})
