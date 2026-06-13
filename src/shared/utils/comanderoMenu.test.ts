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

import { buildMenuTree, searchTiles } from './comanderoMenu'
import type { FamilyDef, CatMap } from './comanderoMenu'

const fams: FamilyDef[] = [
  { id: 'comida', label: 'Comida', icon: '🍱', sort_order: 1 },
  { id: 'bebida', label: 'Bebida', icon: '🍹', sort_order: 2 },
  { id: 'merch', label: 'Merch', icon: '🛍️', sort_order: 3 },
]
const catMap = new Map<string, CatMap>([
  ['SUSHI ROLLS', { family_id: 'comida', hidden_comandero: false, sort_order: 1 }],
  ['BEBIDAS', { family_id: 'bebida', hidden_comandero: false, sort_order: 1 }],
  ['TSHIRTS', { family_id: 'merch', hidden_comandero: false, sort_order: 1 }],
  ['A PAX', { family_id: 'interno', hidden_comandero: true, sort_order: 99 }],
])
const m3 = (tipo: string, station = 'cocina') => ({ tipo, subclasificacion: '', station })

describe('buildMenuTree — 3 niveles FAMILIA→categoría→tiles (mig 032)', () => {
  const meta = new Map([
    ['SATORI ROLL', m3('SUSHI ROLLS')],
    ['MOJITO', m3('BEBIDAS', 'barra')],
    ['REMERA NEGRA', m3('TSHIRTS')],
    ['SERVICIO PAX', m3('A PAX')],
  ])
  const prices = new Map([
    ['SATORI ROLL', { price_final_crc: 7500 }],
    ['MOJITO', { price_final_crc: 5800 }],
    ['REMERA NEGRA', { price_final_crc: 12000 }],
    ['SERVICIO PAX', { price_final_crc: 1000 }],
  ])
  it('familias en orden Comida→Bebida→Merch y A PAX oculto', () => {
    const { families, byFamily } = buildMenuTree(meta, prices, fams, catMap)
    expect(families.map(f => f.id)).toEqual(['comida', 'bebida', 'merch'])
    expect(byFamily.get('comida')).toEqual(['SUSHI ROLLS'])
    expect(byFamily.get('bebida')).toEqual(['BEBIDAS'])
    // A PAX no aparece en ninguna familia (hidden)
    expect([...byFamily.values()].flat()).not.toContain('A PAX')
  })
  it('categoría sin familia mapeada cae en "otros" al final', () => {
    const meta2 = new Map([['ALGO', m3('SIN MAPEO')]])
    const prices2 = new Map([['ALGO', { price_final_crc: 1000 }]])
    const { families } = buildMenuTree(meta2, prices2, fams, new Map())
    expect(families.map(f => f.id)).toEqual(['otros'])
  })
})

describe('searchTiles — búsqueda transversal (no incluye ocultos ni sin precio)', () => {
  const meta = new Map([
    ['SATORI ROLL', m3('SUSHI ROLLS')],
    ['SERVICIO PAX', m3('A PAX')],
    ['ROLL SIN PRECIO', m3('SUSHI ROLLS')],
  ])
  const prices = new Map([
    ['SATORI ROLL', { price_final_crc: 7500 }],
    ['SERVICIO PAX', { price_final_crc: 1000 }],
    ['ROLL SIN PRECIO', { price_final_crc: null }],
  ])
  it('encuentra por nombre, excluye ocultos y sin precio', () => {
    const r = searchTiles(meta, prices, catMap, 'roll')
    expect(r.map(t => t.nombre)).toEqual(['SATORI ROLL'])
  })
})
