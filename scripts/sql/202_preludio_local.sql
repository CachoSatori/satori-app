-- 202_preludio_local · SOLO con `202_pruebas.py --local` (Postgres 16 vacío armado con scripts/sql/local_armar_base.sh).
-- Corre DENTRO de la transacción descartada de la batería, antes de todo. En staging NO va: ahí esto ya existe.
-- Privilegios por defecto como Supabase: toda función nueva de public nace ejecutable por anon y authenticated. Sin
-- esto, la prueba de que la 202 se la saca a anon (caso 11) no muerde.
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
