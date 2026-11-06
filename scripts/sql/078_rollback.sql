-- 078_rollback · deshace supabase/migrations/078_pos_prompax_agregado.sql
-- Solo borra la función (no hay datos ni columnas). NO toca el ledger: si se aplicó con su fila en
-- supabase_migrations.schema_migrations, borrarla a mano en la misma transacción.
begin;
drop function if exists public.pos_prompax_agregado(text, date, date);
commit;
