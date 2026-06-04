-- ============================================================
-- RLS Ventas / exchange / product_map: lectura abierta, escritura restringida
-- ============================================================
-- Antes: policies `<tabla>_auth` (FOR ALL TO authenticated USING true) permitían
-- que CUALQUIER empleado logueado (cajero, salonero…) escribiera/borrara datos de
-- ventas, metas, mapa de productos y tipo de cambio por API.
--
-- Ahora, para cada tabla:
--   - SELECT: abierto a todos los autenticados (las lecturas las necesitan varios
--     roles: exchange_rates en Caja/Propinas, ventas_dias/metas en HomePage, etc.).
--   - INSERT/UPDATE/DELETE: solo owner/manager/contador (los únicos roles que ya
--     llegan a los flujos de escritura — Ventas/Admin/Inventario están gateados).
--
-- Seguro: no rompe ninguna lectura; solo bloquea escrituras de roles que igual no
-- tienen UI para escribir estas tablas.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exchange_rates','product_map','ventas_comps','ventas_dias','ventas_hist','ventas_metas']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_auth ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (true);', t, t);
    EXECUTE format($f$CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated
        USING (public.get_my_role() IN ('owner','manager','contador'))
        WITH CHECK (public.get_my_role() IN ('owner','manager','contador'));$f$, t, t);
  END LOOP;
END $$;
