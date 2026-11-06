-- 076_rollback.sql — SOLO EMERGENCIA. Quita las columnas de la 076 (code, area, doc_type,
-- version, employee_book, pdf_path) de public.sops.
-- ⚠️ Pierde esas columnas. Correrlo SOLO después de revertir el sync (las 20 filas viejas
-- activas otra vez y las 27 con código inactivas) y de quitar pdf_path; antes, respaldar
-- public.sops. Verificar el project-ref antes de ejecutar.
begin;
drop index if exists public.sops_code_key;
alter table public.sops drop constraint if exists sops_doc_type_check;
alter table public.sops
  drop column if exists pdf_path,
  drop column if exists employee_book,
  drop column if exists version,
  drop column if exists doc_type,
  drop column if exists area,
  drop column if exists code;
delete from supabase_migrations.schema_migrations where version = '076';
commit;
