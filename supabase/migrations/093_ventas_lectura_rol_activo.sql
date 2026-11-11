-- ╔══════════════════════════════════════════════════════════════════════════════════════╗
-- ║ 093 — Grok 126 (auditoría de la 085): las lecturas de ventas exigen cuenta activa.      ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ SIN FIRMA. No se mergea ni se aplica en prod sin la firma del dueño. Orden en prod: 085 → 089 → 090 → 091 → 092 → 093.
--
-- Hallazgo: las policies `<tabla>_read` de la 011 son `FOR SELECT TO authenticated USING (true)`. Una cuenta INACTIVA
-- que conserva su sesión sigue leyendo ventas_dias, ventas_hist, ventas_metas, ventas_comps y product_map. Es el mismo
-- hueco que cerró la 085 en employees / propinas / exchange_rates (y la 079 en sops).
--
-- Qué hace: 5 `alter policy … using ((select public.get_my_role()) is not null)`. Desde la 069, get_my_role() da null
-- para una cuenta inactiva. El `(select …)` hace que se evalúe una vez por consulta y no por fila.
-- Qué NO toca: las policies `<tabla>_write` (FOR ALL, owner/manager/contador), exchange_rates (ya la cubrió la 085),
-- los datos, las columnas, anon (sigue sin permiso). Los usuarios activos ven exactamente lo mismo.
--
-- Pruebas: scripts/sql/093_pruebas.sh (solo staging, transacciones descartadas). Rollback: scripts/sql/093_rollback.sql.

begin;
alter policy ventas_dias_read  on public.ventas_dias  using ((select public.get_my_role()) is not null);
alter policy ventas_hist_read  on public.ventas_hist  using ((select public.get_my_role()) is not null);
alter policy ventas_metas_read on public.ventas_metas using ((select public.get_my_role()) is not null);
alter policy ventas_comps_read on public.ventas_comps using ((select public.get_my_role()) is not null);
alter policy product_map_read  on public.product_map  using ((select public.get_my_role()) is not null);
commit;
