-- 205_preludio_local · SOLO con `205_pruebas.py --local` (Postgres 16 local armado con
-- `HASTA=203 bash scripts/sql/local_armar_base.sh`). Corre DENTRO de la transacción descartada de la batería, antes de
-- todo. En staging NO va: ahí ya es así.
-- Privilegios por defecto como Supabase: toda tabla y función nueva de public nace con permisos para anon y
-- authenticated (por eso la 205 los revoca; sin esto, las pruebas de permisos no muerden).
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
