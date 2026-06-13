-- 037: Inventario Activo F1 — COGS real por pedido del PoS. ADITIVA.
-- El inventario (ingredients/recipes/recipe_ingredients/inventory_movements) y el
-- trigger update_ingredient_stock YA EXISTEN. Esto NO los recrea: solo agrega un campo
-- para persistir el costo de mercadería (COGS) calculado por receta al cerrar el pedido.
-- La depleción se registra como inventory_movements 'sale_deduction' con
-- reference_id = pos_orders.id (idempotente: countDeductionsForRef).

alter table public.pos_orders add column if not exists cogs_crc numeric(12,2);

comment on column public.pos_orders.cogs_crc is
  'COGS real del pedido = Σ (deducción de inventario por receta × costo_unitario del ingrediente). Lo escribe la depleción al cerrar el cobro (Inventario Activo F1). NULL = pedido sin depleción aplicada (p.ej. productos sin receta).';
