-- Rollback de la 090: las tablas nuevas de public vuelven a nacer con TODO para anon (como el 08-nov).
-- No toca ninguna tabla que ya exista.
begin;
alter default privileges for role postgres in schema public grant all on tables to anon;
delete from supabase_migrations.schema_migrations where version = '090';
commit;
