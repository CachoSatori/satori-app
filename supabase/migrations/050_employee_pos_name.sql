-- 050_employee_pos_name.sql
-- Reconciliación repo↔base: documenta la columna employees.pos_name.
--
-- pos_name = nombre EXACTO del empleado tal como aparece en el XLS de ventas/POS
-- (la clave de dias.saloneros). Se usa para atar el empleado a sus datos de venta
-- (Mi Rendimiento y VentasICP). Se setea en Admin desde un dropdown de nombres reales.
--
-- CONTEXTO: la columna ya existe VIVA en staging (y en prod), agregada FUERA DE BANDA
-- sin migración en el repo. Esta migración NO crea nada nuevo: solo la registra en el
-- ledger para que "el repo mande". Es IDEMPOTENTE (add ... if not exists) → no-op donde
-- la columna ya existe; cero cambio de datos.
--
-- RLS: ninguna nueva. Hereda las policies de employees (lectura del propio empleado,
-- escritura de owner desde Admin).

alter table public.employees
  add column if not exists pos_name text;

comment on column public.employees.pos_name is
  'Nombre exacto del empleado en el XLS de ventas/POS (clave de dias.saloneros). null = sin vincular.';
