#!/usr/bin/env bash
# Corre la batería de la 189 en un Postgres LOCAL (nunca staging ni prod): base nueva + shim de pg_cron, pg_net,
# Vault y el ledger, imitando su API (cron.schedule por nombre, cron.unschedule, cron.job; net.http_post con
# timeout_milliseconds; vault.decrypted_secrets). Arma 189_pruebas.sql llenando los marcadores y la corre.
# Con MUTAR=1 corre además las mutaciones de la migración: cada una tiene que hacer caer la batería.
#
#   PGHOST=/tmp PGPORT=5499 bash scripts/sql/189_pruebas.sh
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
DB=${DB:-t189}
MIG="$RAIZ/supabase/migrations/189_cron_ventas_dia_contador.sql"

shim() { cat <<'SQL'
create schema cron;
create table cron.job (jobid bigserial primary key, schedule text not null, command text not null,
  nodename text default 'localhost', nodeport int default 5432, database text default current_database(),
  username text default current_user, active boolean default true, jobname text unique);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $f$
declare v bigint;
begin  -- como pg_cron 1.6: con el mismo nombre, actualiza
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command, active = true
  returning jobid into v;
  return v;
end $f$;
create function cron.unschedule(job_name text) returns boolean language plpgsql as $f$
begin
  delete from cron.job where jobname = job_name;
  if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
  return true;
end $f$;
create schema net;
create table public._llamadas (n serial, url text, body jsonb, headers jsonb, timeout_milliseconds int);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
  timeout_milliseconds int default 5000) returns bigint language sql as $f$
  insert into public._llamadas (url, body, headers, timeout_milliseconds) values (url, body, headers, timeout_milliseconds) returning n::bigint;
$f$;
create schema vault;
create view vault.decrypted_secrets as select 'service_role_key'::text as name, 'valor-ficticio-de-prueba'::text as decrypted_secret;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
SQL
}

armar() {  # $1 = cuerpo de la migración (posiblemente mutado)
  python3 - "$1" "$RAIZ" <<'PY'
import sys, re
cuerpo, raiz = sys.argv[1], sys.argv[2]
local = cuerpo.replace("extname = 'pg_cron'", "extname = 'plpgsql'").replace("extname = 'pg_net'", "extname = 'plpgsql'")
assert local != cuerpo, 'ANCLA: no encontré el chequeo de extensiones'
rb = open(f'{raiz}/scripts/sql/189_rollback.sql').read()
rb = re.sub(r'^\s*begin;\s*$', '', rb, flags=re.M); rb = re.sub(r'^\s*commit;\s*$', '', rb, flags=re.M)
t = open(f'{raiz}/scripts/sql/189_pruebas.sql').read()
for m in ('-- @@189@@', '-- @@189ORIG@@', '-- @@189R@@'):
    assert m in t, m
t = t.replace('-- @@189ORIG@@', cuerpo).replace('-- @@189@@', local).replace('-- @@189R@@', rb)
print(t)
PY
}

correr() {  # $1 = cuerpo; devuelve el código de psql
  psql -X -d postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null
  shim | psql -X -d "$DB" -q -v ON_ERROR_STOP=1 >/dev/null
  armar "$1" | psql -X -d "$DB" -q -v ON_ERROR_STOP=1 2>&1
}

ORIG=$(cat "$MIG")
echo "== batería"
correr "$ORIG" | grep -E "RESUMEN|FALLA|ERROR" || true
correr "$ORIG" >/dev/null 2>&1 || { echo "BATERÍA CAÍDA"; exit 1; }

if [ "${MUTAR:-0}" = 1 ]; then
  echo "== mutaciones (cada una tiene que caer)"
  mal=0
  while IFS='|' read -r nombre de a; do
    [ -z "$nombre" ] && continue
    mut=$(python3 -c 'import sys; c,d,a=sys.argv[1:]; assert c.count(d)==1, d; print(c.replace(d,a))' "$ORIG" "$de" "$a")
    if correr "$mut" >/dev/null 2>&1; then echo "  NO CAYÓ: $nombre"; mal=1
    else echo "  cae: $nombre ($(correr "$mut" 2>&1 | grep -c 'FALLA ') casos)"; fi
  done <<'MUTS'
horario 07:00 UTC en vez de 13:00|'0 13 1,16 * *'|'0 7 1,16 * *'
solo el día 1|'0 13 1,16 * *'|'0 13 1 * *'
otro secreto del Vault|where name = 'service_role_key'|where name = 'service_role'
llama a monthly-report|/functions/v1/ventas-dia-contador|/functions/v1/monthly-report
sin local en el body|'{"local":"santa-teresa"}'::jsonb|'{}'::jsonb
timeout por defecto (5 s)|, timeout_milliseconds := 120000|
sin pg_cron igual programa|     or not exists (select 1 from pg_extension where extname = 'pg_net') then|     and false then
MUTS
  [ $mal = 0 ] || exit 1
fi
psql -X -d postgres -qc "drop database if exists $DB" >/dev/null
echo "OK"
