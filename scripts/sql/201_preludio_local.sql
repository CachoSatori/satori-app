-- 201_preludio_local · SOLO con `201_pruebas.py --local` (Postgres 16 armado con
-- `HASTA=200 bash scripts/sql/local_armar_base.sh <base>`: trae la 199, no la 201). Corre DENTRO de la transacción
-- descartada, antes de todo. En staging NO va.
-- Privilegios por defecto como Supabase: toda tabla y función nueva de public nace con permisos para anon y
-- authenticated (por eso la 201 los revoca; sin esto, las pruebas de permisos no muerden).
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
