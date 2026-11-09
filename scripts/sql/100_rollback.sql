-- 100_rollback · deshace supabase/migrations/100_club_catalogo_locales.sql
-- Saca la FK y el trigger del Club. NO borra public.locations ni sus filas: el catálogo es también de caja (091, 022) y
-- otras tablas pueden apuntarle. NO toca el ledger: si se corre, borrar la fila 100 de
-- supabase_migrations.schema_migrations en la misma transacción y sacar el .sql de main en la misma ventana.
begin;
alter table public.club_config drop constraint if exists club_config_location_fk;
drop trigger if exists club_config_catalogo_trg on public.club_config;
drop function if exists public.club_config_catalogo();
commit;
