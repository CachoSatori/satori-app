-- ============================================================
-- RLS: el cajero puede OPERAR caja y propinas (no solo owner/manager)
-- ============================================================
-- Antes la escritura de cash_sessions/cash_movements/suppliers/tip_sessions/
-- tip_entries era solo owner/manager → el cajero (cuenta de la compu principal)
-- no podía registrar pagos, abrir/cerrar turnos de propinas, agregar proveedores
-- ni borrar (de ahí el "pide credenciales pero no se borra").
-- Ahora el cajero tiene escritura operativa (INSERT/UPDATE/DELETE) en esas tablas.
-- El control de borrado lo da el override de gerencia a nivel UI (ManagerOverride):
-- al eliminar pide credenciales de owner/manager.
-- La lectura ya estaba abierta a esos roles.

DROP POLICY IF EXISTS "Cajero puede cerrar su turno" ON public.cash_sessions;
DROP POLICY IF EXISTS "Managers y owners gestionan caja" ON public.cash_sessions;
DROP POLICY IF EXISTS "Managers y owners crean movimientos" ON public.cash_movements;
DROP POLICY IF EXISTS "Owners gestionan proveedores" ON public.suppliers;
DROP POLICY IF EXISTS "Managers y owners crean sesiones" ON public.tip_sessions;
DROP POLICY IF EXISTS "Managers y owners editan sesiones" ON public.tip_sessions;
DROP POLICY IF EXISTS "Managers y owners gestionan entradas" ON public.tip_entries;
CREATE POLICY cash_sessions_op_write ON public.cash_sessions FOR ALL TO authenticated USING (get_my_role() IN ('owner','manager','cajero')) WITH CHECK (get_my_role() IN ('owner','manager','cajero'));
CREATE POLICY cash_movements_op_write ON public.cash_movements FOR ALL TO authenticated USING (get_my_role() IN ('owner','manager','cajero')) WITH CHECK (get_my_role() IN ('owner','manager','cajero'));
CREATE POLICY suppliers_op_write ON public.suppliers FOR ALL TO authenticated USING (get_my_role() IN ('owner','manager','cajero')) WITH CHECK (get_my_role() IN ('owner','manager','cajero'));
CREATE POLICY tip_sessions_op_write ON public.tip_sessions FOR ALL TO authenticated USING (get_my_role() IN ('owner','manager','cajero')) WITH CHECK (get_my_role() IN ('owner','manager','cajero'));
CREATE POLICY tip_entries_op_write ON public.tip_entries FOR ALL TO authenticated USING (get_my_role() IN ('owner','manager','cajero')) WITH CHECK (get_my_role() IN ('owner','manager','cajero'));
