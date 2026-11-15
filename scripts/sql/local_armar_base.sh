#!/usr/bin/env bash
# Arma una base Postgres 16 LOCAL nueva para las baterías SQL: shim de Supabase (local_shim_supabase.sql) + todas las
# migraciones del árbol, parcheando la deriva conocida (prod tiene objetos creados a mano antes del baseline).
# Solo pruebas locales: nunca staging ni prod. Las migraciones que no corren en Postgres local (pg_cron, MAINTAIN de
# PG17) se listan con «!!» y no frenan.
#
#   PGHOST=/tmp PGPORT=5499 PGUSER=pgv bash scripts/sql/local_armar_base.sh <base> [raiz-del-repo]
set -u
DB=${1:?nombre de la base}; RAIZ=${2:-$(cd "$(dirname "$0")/../.." && pwd)}
P="psql -X -d $DB -q -v ON_ERROR_STOP=1"
psql -X -d postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null
$P -f "$RAIZ/scripts/sql/local_shim_supabase.sql" >/dev/null 2>&1
for f in "$RAIZ"/supabase/migrations/*.sql; do
  b=$(basename "$f")
  case "$b" in
    038_*) $P -c "alter table public.cash_movements add column if not exists method text, add column if not exists caja_origen text" ;;
    069_*) $P -c "create policy cierre_write on public.cash_cierres_dia for all using (true); create policy inv_write_ri on public.recipe_ingredients for all using (true); create policy inv_write_recipes on public.recipes for all using (true);" 2>/dev/null ;;
    085_*) $P -c "create policy \"Solo owners crean/editan perfiles\" on public.profiles for all using (true);" 2>/dev/null ;;
  esac
  out=$($P -f "$f" 2>&1 | grep -E "ERROR" | head -2)
  [ -n "$out" ] && echo "!! $b: $out"
done
echo "armada $DB"
