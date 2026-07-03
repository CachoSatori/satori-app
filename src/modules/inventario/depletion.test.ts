import { describe, it, expect } from 'vitest'
import {
  computeDepletion, unitsFromOrderItems, cogsFromDepletion, lowStockCrossings,
} from './depletion'
import type { Ingredient, Recipe, RecipeIngredient } from '../../shared/types/inventario'

const ing = (id: string, over: Partial<Ingredient> = {}): Ingredient => ({
  id, name: id, unit: 'g', current_stock: 1000, min_stock: 0, cost_per_unit: 1,
  supplier: '', category: '', notes: '', updated_at: '', created_at: '', ...over,
})
const rec = (id: string, product_name: string, yield_qty = 1): Recipe => ({
  id, product_name, yield_qty, yield_unit: 'u', notes: '', created_at: '', updated_at: '',
})
const ri = (recipe_id: string, ingredient_id: string, quantity: number, waste = 0): RecipeIngredient => ({
  id: `${recipe_id}-${ingredient_id}`, recipe_id, ingredient_id, quantity, unit: 'g', waste_factor: waste,
})

describe('unitsFromOrderItems — unidades vendidas por producto del pedido PoS', () => {
  it('suma qty por nombre e ignora ítems anulados', () => {
    const u = unitsFromOrderItems([
      { product_name: 'ROLL CALIFORNIA', qty: 2 },
      { product_name: 'ROLL CALIFORNIA', qty: 1 },
      { product_name: 'EDAMAME', qty: 3 },
      { product_name: 'EDAMAME', qty: 5, kitchen_status: 'anulado' },  // no consume
    ])
    expect(u).toEqual({ 'ROLL CALIFORNIA': 3, 'EDAMAME': 3 })
  })
})

describe('computeDepletion sobre un pedido — descuento por receta + sin receta', () => {
  const ingredients = [ing('arroz', { unit: 'g', cost_per_unit: 2 }), ing('alga', { unit: 'u', cost_per_unit: 50 })]
  const recipes = [rec('r1', 'ROLL CALIFORNIA')]
  const riByRecipe = { r1: [ri('r1', 'arroz', 100), ri('r1', 'alga', 1)] }

  it('2 rolls → descuenta 200g arroz y 2 algas; producto sin receta cae en noRecipe', () => {
    const units = unitsFromOrderItems([
      { product_name: 'ROLL CALIFORNIA', qty: 2 },
      { product_name: 'COCA COLA', qty: 1 },   // sin receta
    ])
    const r = computeDepletion(units, recipes, riByRecipe, ingredients)
    const arroz = r.lines.find(l => l.ingredientId === 'arroz')!
    const alga = r.lines.find(l => l.ingredientId === 'alga')!
    expect(arroz.deduct).toBe(200)
    expect(alga.deduct).toBe(2)
    expect(r.noRecipe).toEqual([{ nombre: 'COCA COLA', units: 1 }])
  })

  it('re-llamar con los mismos datos da el MISMO descuento (función pura, no acumula)', () => {
    const units = { 'ROLL CALIFORNIA': 2 }
    const a = computeDepletion(units, recipes, riByRecipe, ingredients)
    const b = computeDepletion(units, recipes, riByRecipe, ingredients)
    expect(a.lines.map(l => l.deduct)).toEqual(b.lines.map(l => l.deduct))
  })
})

describe('cogsFromDepletion — COGS real = Σ deducción × costo', () => {
  it('200g arroz @2 + 2 algas @50 = 400 + 100 = 500', () => {
    const lines = [
      { ingredientId: 'arroz', name: 'arroz', unit: 'g', deduct: 200, current: 1000, after: 800, unitMismatch: false },
      { ingredientId: 'alga', name: 'alga', unit: 'u', deduct: 2, current: 10, after: 8, unitMismatch: false },
    ]
    const cost = new Map([['arroz', 2], ['alga', 50]])
    expect(cogsFromDepletion(lines, cost)).toBe(500)
  })
})

describe('lowStockCrossings — alerta de bajo stock tras la venta', () => {
  it('marca el ingrediente que queda en/bajo su mínimo', () => {
    const lines = [
      { ingredientId: 'arroz', name: 'arroz', unit: 'g', deduct: 200, current: 250, after: 50, unitMismatch: false },
      { ingredientId: 'alga', name: 'alga', unit: 'u', deduct: 2, current: 100, after: 98, unitMismatch: false },
    ]
    const min = new Map([['arroz', 100], ['alga', 10]])   // arroz queda en 50 ≤ 100 → alerta
    expect(lowStockCrossings(lines, min)).toEqual([{ ingredientId: 'arroz', name: 'arroz', after: 50, min: 100 }])
  })
})
