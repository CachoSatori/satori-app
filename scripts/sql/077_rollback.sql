-- 077_rollback.sql — SOLO EMERGENCIA. Quita las policies de Storage de los PDF de SoP.
-- Después de esto los PDF de sops/* vuelven a ser legibles solo por owner/manager/contador/
-- cajero (policy 016) y el libro de franquicia vuelve a quedar a la vista de cajero y contador.
-- No borra archivos. Verificar el project-ref antes de ejecutar.
begin;
drop policy if exists sops_franquicia_solo_gerencia on storage.objects;
drop policy if exists sops_storage_read on storage.objects;
delete from supabase_migrations.schema_migrations where version = '077';
commit;
