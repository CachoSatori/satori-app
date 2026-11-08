-- Rollback de la 088 (PROP-AUD-01). Se pierde la marca: hay que volver a cargarla si se reaplica.
-- OJO: con la columna borrada, TipCocina trata a todos como receptores (no hay texto fijo de respaldo).
begin;
alter table public.employees drop column if exists recibe_reparto_cocina;
delete from supabase_migrations.schema_migrations where version = '088';
commit;
