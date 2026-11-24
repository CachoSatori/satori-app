import { describe, expect, it } from 'vitest'
import { errorDeLineas } from './invLineasIlegibles'
import { NONE, type EditLine } from './api/inventoryIngest'

const linea = (p: Partial<EditLine> = {}): EditLine => ({
  codigo: null, descripcion: 'Arroz ficticio', sel: 'ing-1', newName: '', newUnit: '', unidad: 'K',
  factor: 1, cantidad: 2, precio: 1500, ...p,
})

describe('errorDeLineas', () => {
  it('todo legible (incluso 0 y negativos de una nota de crédito) → null', () => {
    expect(errorDeLineas([linea(), linea({ cantidad: 0, precio: 0 }), linea({ cantidad: -1 })])).toBeNull()
  })
  it('ilegible (NaN) en cantidad, factor o precio → aviso que nombra cuadro y línea', () => {
    expect(errorDeLineas([linea({ cantidad: Number.NaN })])).toContain('«Cant. · Arroz ficticio»')
    expect(errorDeLineas([linea({ factor: Number.NaN })])).toContain('«Factor · Arroz ficticio»')
    expect(errorDeLineas([linea(), linea({ descripcion: 'Sal', precio: Number.NaN })])).toContain('«Precio · Sal»')
  })
  it('el factor de una línea «No es inventario» (cuadro apagado) no cuenta; cantidad y precio sí', () => {
    expect(errorDeLineas([linea({ sel: NONE, factor: Number.NaN })])).toBeNull()
    expect(errorDeLineas([linea({ sel: NONE, precio: Number.NaN })])).toContain('«Precio')
  })
})
