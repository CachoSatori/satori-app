#!/usr/bin/env bash
# Vuelta atrás del ensayo v2 en STAGING (ref fijo). Deja staging como estaba antes del 08-nov 20:16 (-06:00):
#   1. PRIMERO el Edge `ingest-ndf` desde 4d3513a6… (la v12 de staging era ese Edge; el mismo plan que el rollback de prod);
#   2. DESPUÉS la 082 ORIGINAL (de e4678b3, md5 5db915c8…) y su fila del ledger, en UNA transacción, con precondición (la
#      fila tiene que estar en la v2, 292dd3aa…) y conteo de filas; la columna max_factura_vista se saca solo con
#      SACAR_COLUMNA=1 (puede quedar: el Edge viejo no la mira).
# Uso: bash scripts/puente/staging_volver_atras.sh [--seco]   (--seco: la parte SQL termina en ROLLBACK y no despliega)
# Token: el proxy (SUPABASE_ACCESS_TOKEN). CLI de Supabase en PATH o en SUPABASE_CLI.
set -euo pipefail
REF=hwiatgicyyqyezqwldia; SECO=${1:-}
RAIZ=$(git rev-parse --show-toplevel); T=$(mktemp -d); trap 'rm -rf -- "$T"' EXIT
git -C "$RAIZ" show e4678b395647d079863f8b7975c5935fd6cadcb5:supabase/migrations/082_pos_ndf_ingesta_transaccional.sql > "$T/082v1.sql"
[ "$(md5sum < "$T/082v1.sql" | cut -c1-32)" = 5db915c8a422519ce77050f1fb1b916a ] || { echo "082 original: md5 distinto"; exit 2; }
python3 -I - "$T/082v1.sql" "$T/volver.sql" "${SECO:+rollback}" "${SACAR_COLUMNA:-0}" <<'PY'
import re, sys
f = open(sys.argv[1]).read(); fin = 'rollback;' if sys.argv[3] == 'rollback' else 'commit;'
cuerpo = re.sub(r'(?im)^\s*(begin|commit)\s*;\s*$', '', f)
col = "alter table public.pos_ndf_cursor drop column if exists max_factura_vista;" if sys.argv[4] == '1' else ''
open(sys.argv[2], 'w').write(f"""begin;
set local lock_timeout = '5s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $p$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '082' and md5(statements[1]) = '292dd3aa8f7dfed676d10103870f5d21') <> 1 then
    raise exception 'precondición: la fila 082 de staging no está en la v2';
  end if;
end $p$;
{cuerpo}
{col}
do $p$ declare n int; begin
  update supabase_migrations.schema_migrations set statements = array[$m${f}$m$] where version = '082';
  get diagnostics n = row_count; if n <> 1 then raise exception 'se actualizaron % filas', n; end if;
  if (select md5(statements[1]) from supabase_migrations.schema_migrations where version = '082') <> '5db915c8a422519ce77050f1fb1b916a' then
    raise exception 'el ledger no quedó con la 082 original';
  end if;
  if (select prosrc like '%corte_retenido_por_r%' from pg_proc where proname = 'pos_ndf_ingestar') then raise exception 'la función sigue en v2'; end if;
end $p$;
{fin}
""")
PY
# 1) PRIMERO el Edge viejo (salvo en seco): con el Edge v2 y sin la función v2 no entra ninguna venta.
if [ -z "$SECO" ]; then
  git -C "$RAIZ" worktree add --detach "$T/v1" 4d3513a6df8e838dd5c0442b05a580e06ce9db9d >/dev/null
  ( cd "$T/v1" && "${SUPABASE_CLI:-supabase}" functions deploy ingest-ndf --no-verify-jwt --use-api --project-ref "$REF" )
  git -C "$RAIZ" worktree remove --force "$T/v1"
fi
# 2) DESPUÉS la 082 original y su fila del ledger (en seco: ROLLBACK)
R=$(jq -n --rawfile q "$T/volver.sql" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H 'Content-Type: application/json' --data-binary @-)
echo "SQL: $R" | head -c 300; echo
[ -n "$SECO" ] && echo "(seco: la transacción terminó en ROLLBACK; no se desplegó nada)"
