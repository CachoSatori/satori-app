-- ============================================================================
-- 077_sops_pdf_storage.sql — PDF de los SoP y libros en el bucket `documents`
-- ----------------------------------------------------------------------------
-- Rutas (bucket privado `documents`, mig 016):
--   sops/2026-11/<código>.pdf            → PDF de cada SoP          (todos los logueados)
--   sops/libros/libro-empleado.pdf       → Libro del empleado       (todos los logueados)
--   sops/libros/franquicia/<archivo>.pdf → Libro de franquicia      (solo owner y manager)
--
-- Hoy `documents_storage_rw` (016) da TODO el bucket a owner/manager/contador/cajero.
-- Esta migración NO la toca; agrega:
--   1. sops_storage_read (PERMISSIVE, SELECT): cualquier usuario logueado lee `sops/*`,
--      así saloneros, barman, etc. pueden abrir los PDF con una signed URL.
--   2. sops_franquicia_solo_gerencia (RESTRICTIVE, ALL): todo lo que esté bajo
--      `sops/libros/franquicia/` exige owner o manager, para cualquier operación.
--      Al ser RESTRICTIVE se suma (AND) a las demás policies: le quita el libro de
--      franquicia a cajero y contador sin cambiar nada más de lo que ya pueden hacer.
-- La escritura de `sops/*` sigue siendo la de 016 (owner/manager/contador/cajero) y la
-- carga real la hace scripts/sync_sops/subir_pdfs.ts con service_role.
-- Idempotente.
-- ============================================================================

begin;

drop policy if exists sops_storage_read on storage.objects;
create policy sops_storage_read on storage.objects
  as permissive
  for select
  to authenticated
  using (bucket_id = 'documents' and name like 'sops/%');

drop policy if exists sops_franquicia_solo_gerencia on storage.objects;
create policy sops_franquicia_solo_gerencia on storage.objects
  as restrictive
  for all
  to authenticated
  using (
    not (bucket_id = 'documents' and name like 'sops/libros/franquicia/%')
    or public.get_my_role() in ('owner', 'manager')
  )
  with check (
    not (bucket_id = 'documents' and name like 'sops/libros/franquicia/%')
    or public.get_my_role() in ('owner', 'manager')
  );

commit;
