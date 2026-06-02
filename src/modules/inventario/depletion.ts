/**
 * depletion — motor de consumo de inventario por ventas (Fase 1.3)
 *
 * Dado las unidades vendidas por producto y las recetas (producto → ingredientes),
 * calcula cuánto baja de cada ingrediente. Lógica pura y testeable, sin side-effects.
 */
import type { Ingredient, Recipe, RecipeIngredient } from '../../shared/types/inventario'

export interface DepletionLine {
  ingredientId: string
  name:         string
  unit:         string
  deduct:       number      // cantidad total a descontar (en unidad del ingrediente)
  current:      number      // stock actual
  after:        number      // stock resultante
  unitMismatch: boolean     // alguna receta usó una unidad distinta a la del ingrediente
}

export interface DepletionResult {
  lines:           DepletionLine[]
  productsMatched: number     // productos vendidos que tenían receta
  unitsConsidered: number     // total de unidades vendidas con receta
  noRecipe:        Array<{ nombre: string; units: number }>  // vendidos sin receta (top)
}

const norm = (s: string) => s.toUpperCase().trim()

export function computeDepletion(
  unitsByProduct: Record<string, number>,
  recipes:        Recipe[],
  riByRecipe:     Record<string, RecipeIngredient[]>,
  ingredients:    Ingredient[],
): DepletionResult {
  const ingById   = new Map(ingredients.map(i => [i.id, i]))
  const recByName = new Map(recipes.map(r => [norm(r.product_name), r]))

  // ingredientId → { deduct, mismatch }
  const acc = new Map<string, { deduct: number; mismatch: boolean }>()
  let productsMatched = 0
  let unitsConsidered = 0
  const noRecipe: Array<{ nombre: string; units: number }> = []

  for (const [nombre, units] of Object.entries(unitsByProduct)) {
    if (!units || units <= 0) continue
    const recipe = recByName.get(norm(nombre))
    if (!recipe) { noRecipe.push({ nombre, units }); continue }
    const ris = riByRecipe[recipe.id] ?? []
    if (!ris.length) { noRecipe.push({ nombre, units }); continue }

    productsMatched++
    unitsConsidered += units
    const yield_ = recipe.yield_qty && recipe.yield_qty > 0 ? recipe.yield_qty : 1

    for (const ri of ris) {
      const ing = ingById.get(ri.ingredient_id)
      if (!ing) continue
      // consumo = cantidad receta × (1+merma) × unidades vendidas ÷ rendimiento
      const qty = ri.quantity * (1 + (ri.waste_factor ?? 0)) * (units / yield_)
      const prev = acc.get(ri.ingredient_id) ?? { deduct: 0, mismatch: false }
      prev.deduct += qty
      if (ri.unit && ing.unit && norm(ri.unit) !== norm(ing.unit)) prev.mismatch = true
      acc.set(ri.ingredient_id, prev)
    }
  }

  const lines: DepletionLine[] = [...acc.entries()].map(([ingredientId, v]) => {
    const ing = ingById.get(ingredientId)!
    const deduct = Math.round(v.deduct * 1000) / 1000   // 3 decimales
    return {
      ingredientId,
      name:    ing.name,
      unit:    ing.unit,
      deduct,
      current: ing.current_stock,
      after:   Math.round((ing.current_stock - deduct) * 1000) / 1000,
      unitMismatch: v.mismatch,
    }
  }).sort((a, b) => b.deduct - a.deduct)

  noRecipe.sort((a, b) => b.units - a.units)

  return { lines, productsMatched, unitsConsidered, noRecipe: noRecipe.slice(0, 12) }
}

/**
 * Extrae unidades vendidas por producto desde el JSON de un día de ventas.
 * Suma qty de prods[] de todos los saloneros/cajeros.
 */
export function unitsFromDiaData(
  data: { saloneros?: Record<string, { prods?: [string, number, number][] }> } | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of Object.values(data?.saloneros ?? {})) {
    for (const [name, qty] of (s.prods ?? [])) {
      const k = String(name)
      out[k] = (out[k] ?? 0) + (Number(qty) || 0)
    }
  }
  return out
}
