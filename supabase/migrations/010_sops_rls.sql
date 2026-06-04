-- ============================================================
-- RLS de SOPs: lectura para todos, escritura solo owner/manager
-- ============================================================
-- Antes: policy `sops_all` (FOR ALL TO authenticated USING true) permitía que
-- CUALQUIER empleado logueado modificara/borrara SOPs por API (la UI lo ocultaba
-- a no-managers, pero la base no lo impedía). Ahora:
--   - Todos los autenticados pueden LEER (el cajero/encargado necesitan los SOPs).
--   - Solo owner/manager pueden crear/editar/borrar.

DROP POLICY IF EXISTS sops_all ON public.sops;

CREATE POLICY sops_read ON public.sops
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY sops_write ON public.sops
  FOR ALL TO authenticated
  USING      (public.get_my_role() IN ('owner', 'manager'))
  WITH CHECK (public.get_my_role() IN ('owner', 'manager'));

-- NOTA (pendiente de revisión con el dueño): las tablas exchange_rates,
-- product_map y ventas_dias/ventas_hist/ventas_comps/ventas_metas todavía tienen
-- policy `ALL ... USING true`. Endurecerlas requiere definir read/write por rol
-- con cuidado (p.ej. exchange_rates DEBE seguir siendo legible por todos porque
-- Caja y Propinas la usan para convertir USD). No se tocó aquí a propósito.
