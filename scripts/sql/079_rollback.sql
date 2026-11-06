-- 079_rollback.sql — SOLO EMERGENCIA. Devuelve sops_read y sops_storage_read a como
-- estaban antes de la 079 (vuelve a dejar leer a usuarios inactivos con sesión vigente).
-- ⚠️ Si se corre, en el mismo momento hay que quitar supabase/migrations/079_sops_lectura_activos.sql
-- de main (si no, Branching la vuelve a aplicar en el próximo push). Verificar el project-ref antes.
begin;
alter policy sops_read on public.sops
  using (true);
alter policy sops_storage_read on storage.objects
  using (bucket_id = 'documents' and name like 'sops/%');
delete from supabase_migrations.schema_migrations where version = '079';
commit;
