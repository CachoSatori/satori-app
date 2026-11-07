-- ============================================================================
-- 079_sops_lectura_activos.sql — lectura de SoP solo para usuarios activos
-- ----------------------------------------------------------------------------
-- Antes, dos policies de lectura de SoP no miraban `is_active`, así que un usuario
-- INACTIVO con la sesión todavía vigente podía leer:
--   · sops_read (mig 010, public.sops): USING (true) → todas las filas de sops;
--   · sops_storage_read (mig 077, storage.objects): los PDF de documents/sops/*
--     (salvo el libro de franquicia, que ya exigía owner/manager vía get_my_role()).
-- Ahora las dos exigen `public.get_my_role() is not null`. get_my_role() devuelve
-- NULL para cuentas inactivas o sin perfil (mig 069).
-- No cambia nada más: sops_write, sops_franquicia_solo_gerencia,
-- documents_storage_rw y el resto de las policies quedan igual.
-- ALTER POLICY conserva nombre, comando, roles y tipo (permissive) de cada una.
-- Idempotente. Rollback: scripts/sql/079_rollback.sql.
-- ============================================================================

begin;

alter policy sops_read on public.sops
  using (public.get_my_role() is not null);

alter policy sops_storage_read on storage.objects
  using (bucket_id = 'documents' and name like 'sops/%' and public.get_my_role() is not null);

commit;
