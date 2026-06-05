import { supabase } from './supabase'
import type { Ingredient, Recipe, RecipeIngredient, InventoryMovement } from '../types/inventario'

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
