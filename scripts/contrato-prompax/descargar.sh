#!/bin/bash
# Test de contrato del RPC 080 (pos_prompax_agregado) contra netaVenta.ts — baja los datos.
#
#   scripts/contrato-prompax/descargar.sh <REF> <DIR> [desde] [hasta]
#
# Baja por la Management API (SOLO LECTURA) las facturas y líneas crudas del rango y la salida del
# RPC, y deja tres JSON en <DIR>. Después:
#   PROMPAX_CONTRATO_DIR=<DIR> npx vitest run src/modules/ventas/ventasPromPaxContrato.test.ts
#
# · STAGING (la función existe): se llama al RPC como un owner activo simulado, dentro de una
#   transacción que termina en rollback. Hace falta OWNER_ID (uuid de un owner activo).
# · PROD (la función NO existe hasta la firma): se corre el MISMO cuerpo de la migración como un
#   SELECT de solo lectura (se extrae del .sql, no se reescribe), así el contrato vale para prod.
#
# Credencial: SUPABASE_ACCESS_TOKEN (token personal de la Management API). El script no lo imprime
# ni lo escribe en ningún archivo; solo lo pasa en el header de cada pedido.
set -euo pipefail
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "Falta SUPABASE_ACCESS_TOKEN (token de la Management API de Supabase). Exportalo en la terminal y volvé a correr." >&2
  exit 2
fi
if [ $# -lt 2 ]; then
  echo "Uso: $0 <REF> <DIR> [desde] [hasta]" >&2
  exit 2
fi
REF=$1; DIR=$2; DESDE=${3:-2026-10-01}; HASTA=${4:-2026-10-31}
case $REF in
  yiczgdtirrkdvohdquzf) echo "REF=$REF (PROD, solo lectura)" >&2;;
  hwiatgicyyqyezqwldia) echo "REF=$REF (STAGING)" >&2;;
  *) echo "ref desconocido: $REF" >&2; exit 1;;
esac
mkdir -p "$DIR"
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
MIG="$RAIZ/supabase/migrations/080_pos_prompax_agregado.sql"

q() { # $1 = sql, $2 = read_only (true|false)
  jq -n --arg q "$1" --argjson ro "$2" '{query:$q, read_only:$ro}' \
  | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" -d @-
}

RANGO="tk.local = 'santa-teresa' and tk.estado = 'C'
  and tk.fecha_registra >= ('$DESDE'::date::timestamp at time zone 'America/Costa_Rica')
  and tk.fecha_registra <  (('$HASTA'::date + 1)::timestamp at time zone 'America/Costa_Rica')"

q "select tk.id, tk.canal, tk.salonero_login, tk.valor_servido_crc, tk.fecha_registra, tk.pax, tk.pax_articulo
   from public.pos_ndf_tickets tk where $RANGO" true > "$DIR/tickets.json"
q "select ln.ticket_id, ln.familia, ln.monto, ln.codigo_producto
   from public.pos_ndf_ticket_lines ln join public.pos_ndf_tickets tk on tk.id = ln.ticket_id where $RANGO" true > "$DIR/lineas.json"

if [ "$REF" = hwiatgicyyqyezqwldia ]; then
  : "${OWNER_ID:?OWNER_ID = uuid de un owner activo de staging}"
  q "begin;
     set local role authenticated;
     select set_config('request.jwt.claims', '{\"sub\":\"$OWNER_ID\",\"role\":\"authenticated\"}', true);
     select public.pos_prompax_agregado('santa-teresa', '$DESDE', '$HASTA') as filas;
     rollback;" false > "$DIR/rpc.json"
else
  CUERPO=$(awk '/^  with t as \($/{f=1} /^    into v_out$/{next} /^  return v_out;$/{f=0} f' "$MIG" \
    | sed -e "s/p_local/'santa-teresa'/g" -e "s/p_desde/'$DESDE'::date/g" -e "s/p_hasta/'$HASTA'::date/g")
  q "$CUERPO" true > "$DIR/rpc.json"
fi
for f in tickets lineas rpc; do
  jq -e 'type == "array"' "$DIR/$f.json" > /dev/null || { echo "falló $f:"; head -c 400 "$DIR/$f.json"; exit 1; }
done
echo "tickets $(jq length "$DIR/tickets.json") · líneas $(jq length "$DIR/lineas.json") · filas RPC $(jq '.[0] | to_entries[0].value | length' "$DIR/rpc.json")" >&2
