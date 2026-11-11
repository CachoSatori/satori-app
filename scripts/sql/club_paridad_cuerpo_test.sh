#!/usr/bin/env bash
# (Grok 165, 10-nov) Pruebas SIN RED de cuerpo() de club_paridad.sh: normaliza «begin;»/«commit;» como con_antes
# (espacios y mayúsculas) y aborta (sale 3) si queda cualquier control de transacción. bash scripts/sql/club_paridad_cuerpo_test.sh
set -uo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
sed -n '/^cuerpo() {/,/^}/p' "$RAIZ/scripts/sql/club_paridad.sh" > "$T/cuerpo.sh"
fallas=0
caso() {   # caso NOMBRE CODIGO_ESPERADO contenido
  printf '%b' "$3" > "$T/in.sql"
  bash -c ". '$T/cuerpo.sh'; cuerpo '$T/in.sql' > '$T/out'" 2>/dev/null; local rc=$?
  if [ "$rc" = "$2" ]; then echo "ok   $1 (sale $rc)"; else echo "FALLA $1: salió $rc, esperaba $2"; fallas=$((fallas+1)); fi
}
caso 'begin;/commit; con espacios y mayúsculas → se sacan'     0 'BEGIN; \nselect 1;\n  Commit;\n'
caso 'begin y end de plpgsql (sin «;» de transacción) → quedan' 0 'create function f() returns void language plpgsql as $$ begin\n  begin\n  end;\nend $$;\n'
caso 'un commit en el medio («COMMIT ;») → aborta'             3 'begin;\nselect 1;\ncommit;\nselect 2;\n  COMMIT ;\n'
caso 'rollback; → aborta'                                       3 'begin;\nrollback;\n'
caso 'begin transaction; → aborta'                              3 'begin transaction;\nselect 1;\n'
caso 'end work; → aborta'                                       3 'select 1;\nend work;\n'
printf 'BEGIN; \nselect 1;\n  Commit;\n' > "$T/in.sql"
bash -c ". '$T/cuerpo.sh'; cuerpo '$T/in.sql'" > "$T/out"
if [ "$(cat "$T/out")" = 'select 1;' ]; then echo "ok   la salida es solo el cuerpo"; else echo "FALLA la salida: $(cat "$T/out")"; fallas=$((fallas+1)); fi
for f in scripts/sql/150_rollback.sql supabase/migrations/150_club_satori_esquema.sql supabase/migrations/151_club_catalogo_locales.sql; do
  caso "$f no aborta" 0 "$(sed 's/\\/\\\\/g' "$RAIZ/$f")\n"
done
echo "fallas: $fallas"; exit $fallas
