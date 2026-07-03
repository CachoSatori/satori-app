import { describe, it, expect } from 'vitest'
import { targetDimensions, MAX_LONG_SIDE } from './imageNormalize'

// Solo el cálculo PURO de dimensiones: createImageBitmap/canvas no corren en happy-dom, así que la
// conversión real se valida físicamente (capturar una factura desde el teléfono).

describe('targetDimensions', () => {
  it('no agranda si la imagen ya es más chica que el máximo', () => {
    expect(targetDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('deja igual si el lado largo es exactamente el máximo', () => {
    expect(targetDimensions(MAX_LONG_SIDE, 1000)).toEqual({ width: MAX_LONG_SIDE, height: 1000 })
  })

  it('escala por el ancho cuando es apaisada (lado largo = ancho)', () => {
    // 4000×3000 → escala 1568/4000 → 1568×1176
    expect(targetDimensions(4000, 3000)).toEqual({ width: 1568, height: 1176 })
  })

  it('escala por el alto cuando es vertical (lado largo = alto)', () => {
    // 3000×4000 (foto típica de teléfono en vertical) → 1176×1568
    expect(targetDimensions(3000, 4000)).toEqual({ width: 1176, height: 1568 })
  })

  it('respeta un máximo custom', () => {
    expect(targetDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 })
  })

  it('redondea a entero', () => {
    const { width, height } = targetDimensions(4001, 3001)
    expect(Number.isInteger(width)).toBe(true)
    expect(Number.isInteger(height)).toBe(true)
  })

  it('no rompe con dimensiones 0 (imagen inválida)', () => {
    expect(targetDimensions(0, 0)).toEqual({ width: 0, height: 0 })
  })
})
