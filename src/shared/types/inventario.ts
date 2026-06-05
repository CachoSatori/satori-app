// ── Inventario types ─────────────────────────────────────────────

export interface Ingredient {
  id:            string
  name:          string
  unit:          string        // kg, g, L, ml, unidad, caja, etc.
  current_stock: number
  min_stock:     number
  cost_per_unit: number        // cost per unit in CRC
  supplier:      string
  category:      string        // proteínas, vegetales, lácteos, bebidas, etc.
  notes:         string
  updated_at:    string
  created_at:    string
}

export interface Recipe {
  id:           string
  product_name: string         // FK to product_map.nombre
  yield_qty:    number
  yield_unit:   string
  notes:        string
  created_at:   string
  updated_at:   string
}

export interface RecipeIngredient {
  id:            string
  recipe_id:     string
  ingredient_id: string
  quantity:      number
  unit:          string
  waste_factor:  number        // 0.05 = 5% waste
  // Joined fields (from query)
  ingredient?:   Ingredient
}

export interface InventoryMovement {
  id:            string
  ingredient_id: string
  movement_type: 'purchase' | 'waste' | 'count_adjustment' | 'sale_deduction' | 'transfer'
  qty_delta:     number        // positive = entry, negative = exit
  unit:          string
  unit_cost:     number | null
  reference_id:  string
  notes:         string
  created_by:    string
  created_at:    string
  document_id?:      string | null   // traza a la factura escaneada (Fase 2D-C)
  cash_movement_id?: string | null   // traza al gasto
  // Joined
  ingredient?:   Ingredient
}

export const INGREDIENT_CATEGORIES = [
  'Proteínas', 'Mariscos / Pescados', 'Arroces / Granos',
  'Vegetales / Verduras', 'Frutas', 'Lácteos / Huevos',
  'Salsas / Condimentos', 'Aceites / Vinagres',
  'Bebidas / Licores', 'Panadería / Pastas',
  'Congelados', 'Limpieza / Descartables', 'Otro',
]

export const INGREDIENT_UNITS = [
  'kg', 'g', 'L', 'ml', 'unidad', 'caja', 'bolsa', 'paquete',
  'litro', 'botella', 'lata', 'sobre', 'porción',
]

export const MOVEMENT_LABELS: Record<InventoryMovement['movement_type'], string> = {
  purchase:          '📦 Compra',
  waste:             '🗑 Merma/Desperdicio',
  count_adjustment:  '📋 Ajuste de conteo',
  sale_deduction:    '🍽 Deducción por venta',
  transfer:          '↔ Transferencia',
}
