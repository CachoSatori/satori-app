import { supabase } from './supabase'
import type { Ingredient, Recipe, RecipeIngredient, InventoryMovement } from '../types/inventario'
import { computeDepletion, unitsFromOrderItems, cogsFromDepletion, lowStockCrossings } from '../../modules/inventario/depletion'

// ── Ingredients ──────────────────────────────────────────────────

export async function getIngredients(): Promise<Ingredient[]> {
  const { data, error } = await supabase
    .from('ingredients')
    .select('*')
    .order('category')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as Ingredient[]
}

export async function upsertIngredient(ing: Partial<Ingredient> & { name: string }): Promise<void> {
  const { error } = await supabase
    .from('ingredients')
    .upsert({ ...ing, updated_at: new Date().toISOString() }, { onConflict: 'name' })
  if (error) throw new Error(error.message)
}

export async function deleteIngredient(id: string): Promise<void> {
  const { error } = await supabase
    .from('ingredients')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Recipes ──────────────────────────────────────────────────────

export async function getRecipes(): Promise<Recipe[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .order('product_name')
  if (error) throw new Error(error.message)
  return (data ?? []) as Recipe[]
}

export async function upsertRecipe(recipe: Partial<Recipe> & { product_name: string }): Promise<Recipe> {
  const { data, error } = await supabase
    .from('recipes')
    .upsert({ ...recipe, updated_at: new Date().toISOString() }, { onConflict: 'product_name' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Recipe
}

export async function getRecipeIngredients(recipeId: string): Promise<RecipeIngredient[]> {
  const { data, error } = await supabase
    .from('recipe_ingredients')
    .select('*, ingredient:ingredients(*)')
    .eq('recipe_id', recipeId)
    .order('ingredient_id')
  if (error) throw new Error(error.message)
  return (data ?? []) as RecipeIngredient[]
}

export async function upsertRecipeIngredient(ri: Omit<RecipeIngredient, 'id' | 'ingredient'>): Promise<void> {
  const { error } = await supabase
    .from('recipe_ingredients')
    .upsert(ri, { onConflict: 'recipe_id,ingredient_id' })
  if (error) throw new Error(error.message)
}

export async function deleteRecipeIngredient(id: string): Promise<void> {
  const { error } = await supabase
    .from('recipe_ingredients')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Inventory Movements ──────────────────────────────────────────

export async function getMovements(limit = 100): Promise<InventoryMovement[]> {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('*, ingredient:ingredients(name, unit)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as InventoryMovement[]
}

export async function addMovement(mov: Omit<InventoryMovement, 'id' | 'created_at' | 'ingredient'>): Promise<void> {
  const { error } = await supabase
    .from('inventory_movements')
    .insert(mov)
  if (error) throw new Error(error.message)
  // Trigger in DB auto-updates current_stock
}

// ¿Ya se procesó el consumo por venta de una fecha? (idempotencia)
export async function countDeductionsForRef(reference_id: string): Promise<number> {
  const { count, error } = await supabase
    .from('inventory_movements')
    .select('id', { count: 'exact', head: true })
    .eq('movement_type', 'sale_deduction')
    .eq('reference_id', reference_id)
  if (error) throw new Error(error.message)
  return count ?? 0
}

// Todos los ingredientes de todas las recetas en una sola llamada (para el motor de consumo)
export async function getAllRecipeIngredients(): Promise<RecipeIngredient[]> {
  const { data, error } = await supabase
    .from('recipe_ingredients')
    .select('*')
  if (error) throw new Error(error.message)
  return (data ?? []) as RecipeIngredient[]
}

// Bulk: set absolute stock level (count_adjustment = new - current)
export async function setStockLevel(ingredientId: string, newLevel: number, currentLevel: number, unit: string, by: string): Promise<void> {
  const delta = newLevel - currentLevel
  if (delta === 0) return
  await addMovement({
    ingredient_id: ingredientId,
    movement_type: 'count_adjustment',
    qty_delta:     delta,
    unit,
    unit_cost:     null,
    reference_id:  new Date().toISOString().slice(0, 10),
    notes:         `Ajuste manual a ${newLevel} ${unit}`,
    created_by:    by,
  })
}

// ── Inventario Activo F1: depleción por venta al cerrar un pedido del PoS ──────
export interface OrderDepletionResult {
  applied: boolean                  // ¿se registraron movimientos en esta llamada?
  alreadyDone: boolean              // ya se había deplecionado este pedido (idempotente)
  movements: number                 // # de ingredientes descontados
  cogs_crc: number                  // COGS real del pedido (Σ deducción × costo)
  noRecipe: Array<{ nombre: string; units: number }>   // vendidos SIN receta (no descuentan)
  lowStock: Array<{ ingredientId: string; name: string; after: number; min: number }>
}

/**
 * Descuenta inventario por la venta de UN pedido del PoS, según las recetas.
 * IDEMPOTENTE: usa reference_id = order.id; si ya hay movimientos 'sale_deduction'
 * de ese pedido, no vuelve a descontar (countDeductionsForRef). Productos SIN receta
 * NO descuentan y se reportan en `noRecipe`. Escribe el COGS real en pos_orders.cogs_crc.
 * Best-effort desde el cobro: si falla, el cobro YA quedó hecho (no se revierte).
 */
export async function depleteOrderInventory(
  order: { id: string },
  items: Array<{ product_name: string; qty: number; kitchen_status?: string }>,
  by: string,
): Promise<OrderDepletionResult> {
  // Idempotencia: ¿ya se deplecionó este pedido?
  const already = await countDeductionsForRef(order.id)
  if (already > 0) {
    return { applied: false, alreadyDone: true, movements: 0, cogs_crc: 0, noRecipe: [], lowStock: [] }
  }

  const [recipes, allRis, ingredients] = await Promise.all([
    getRecipes(), getAllRecipeIngredients(), getIngredients(),
  ])
  const riByRecipe: Record<string, RecipeIngredient[]> = {}
  for (const ri of allRis) (riByRecipe[ri.recipe_id] ??= []).push(ri)

  const result = computeDepletion(unitsFromOrderItems(items), recipes, riByRecipe, ingredients)

  const costById = new Map(ingredients.map(i => [i.id, i.cost_per_unit]))
  const minById  = new Map(ingredients.map(i => [i.id, i.min_stock]))
  const cogs = cogsFromDepletion(result.lines, costById)
  const lowStock = lowStockCrossings(result.lines, minById)

  // Registrar un movimiento de salida por ingrediente (el trigger baja current_stock).
  for (const l of result.lines) {
    if (l.deduct <= 0) continue
    await addMovement({
      ingredient_id: l.ingredientId,
      movement_type: 'sale_deduction',
      qty_delta:     -l.deduct,                  // salida = negativo
      unit:          l.unit,
      unit_cost:     costById.get(l.ingredientId) ?? null,
      reference_id:  order.id,                    // idempotencia por pedido
      notes:         `Venta PoS · pedido ${order.id.slice(0, 8)}`,
      created_by:    by,
    })
  }

  // COGS real del pedido (solo si hubo recetas que descontaron)
  if (result.lines.length > 0) {
    const { error } = await supabase.from('pos_orders').update({ cogs_crc: cogs }).eq('id', order.id)
    if (error) throw new Error(error.message)
  }

  return {
    applied: result.lines.length > 0,
    alreadyDone: false,
    movements: result.lines.length,
    cogs_crc: cogs,
    noRecipe: result.noRecipe,
    lowStock,
  }
}
