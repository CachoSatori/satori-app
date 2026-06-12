import { describe, it, expect } from 'vitest'
import { computeItemPrice, validateGroupSelection, validateItemSelections } from './posPricing'
import type { PosModifierGroup } from './posPricing'

const licor: PosModifierGroup = {
  id: 'g1', name: 'Licor', required: true, min_selections: 1, max_selections: 1,
  modifiers: [
    { id: 'm1', name: 'Flor de Caña', price_delta_crc: 0 },
    { id: 'm2', name: 'Zacapa', price_delta_crc: 3000 },
  ],
}
const extras: PosModifierGroup = {
  id: 'g2', name: 'Extras', required: false, min_selections: 0, max_selections: 3,
  modifiers: [{ id: 'e1', name: 'Hierbabuena extra', price_delta_crc: 500 }],
}

describe('posPricing — caso de referencia: Mojito + Licor obligatorio', () => {
  it('precio base + delta 0 (Flor de Caña) = base', () => {
    expect(computeItemPrice(4500, [licor.modifiers[0]])).toBe(4500)
  })
  it('precio base + Zacapa suma el delta', () => {
    expect(computeItemPrice(4500, [licor.modifiers[1]])).toBe(7500)
  })
  it('deltas múltiples se acumulan', () => {
    expect(computeItemPrice(4500, [licor.modifiers[1], extras.modifiers[0]])).toBe(8000)
  })
  it('grupo OBLIGATORIO sin selección → bloquea con mensaje', () => {
    expect(validateGroupSelection(licor, 0)).toMatch(/obligatorio/)
  })
  it('grupo obligatorio con 1 selección → válido', () => {
    expect(validateGroupSelection(licor, 1)).toBeNull()
  })
  it('exceder max_selections → bloquea', () => {
    expect(validateGroupSelection(licor, 2)).toMatch(/máximo 1/)
  })
  it('grupo opcional con 0 → válido', () => {
    expect(validateGroupSelection(extras, 0)).toBeNull()
  })
  it('validación del ítem completo: falla el primer grupo inválido', () => {
    expect(validateItemSelections([licor, extras], { g2: 1 })).toMatch(/Licor/)
    expect(validateItemSelections([licor, extras], { g1: 1, g2: 2 })).toBeNull()
  })
  it('null-safety: base o deltas no numéricos cuentan como 0', () => {
    expect(computeItemPrice(NaN as unknown as number, [{ id: 'x', name: 'x', price_delta_crc: NaN as unknown as number }])).toBe(0)
  })
})
