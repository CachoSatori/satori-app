#!/usr/bin/env bash
# CLUB-AUD-44/45: dos POST simultáneos del mismo local y la misma factura. SOLO STAGING (ref fijo).
#   «viejo»: el flujo de antes (borrar + insertar líneas en llamadas sueltas) → líneas duplicadas.
#   «nuevo»: pos_ndf_ingestar (una transacción + lock por local, mig 082) → sin duplicados.
# Factura sintética 990961 (santa-teresa); se borra al empezar y al terminar. Token: el proxy (SUPABASE_ACCESS_TOKEN).
set -euo pipefail
REF=hwiatgicyyqyezqwldia
DIR="$(cd "$(dirname "$0")" && pwd)"; TMP="$(mktemp -d)"
sql() { jq -n --arg q "$1" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
          -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H 'Content-Type: application/json' --data-binary @-; }
LIMPIAR="delete from pos_ndf_tickets where local = 'santa-teresa' and numero_factura = '990961';"
trap 'sql "$LIMPIAR" >/dev/null; rm -rf "$TMP"' EXIT
T=$(jq -c .t "$DIR/lote.json"); L=$(jq -c .l "$DIR/lote.json")
CONTAR="select count(*) as lineas from pos_ndf_ticket_lines l join pos_ndf_tickets t on t.id = l.ticket_id where t.local = 'santa-teresa' and t.numero_factura = '990961';"

# viejo: ticket ya existe; cada sesión borra y vuelve a insertar sus 3 líneas, en sentencias sueltas
sql "$LIMPIAR select public.pos_ndf_ingestar('santa-teresa', '$T'::jsonb, '[]'::jsonb, null, null);" > /dev/null
VIEJO="begin;
delete from pos_ndf_ticket_lines where ticket_id = (select id from pos_ndf_tickets where local = 'santa-teresa' and numero_factura = '990961');
insert into pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select (select id from pos_ndf_tickets where local = 'santa-teresa' and numero_factura = '990961'), x->>'codigo_producto', x->>'nombre',
       (x->>'cantidad')::numeric, (x->>'monto')::numeric, (x->>'familia')::int from jsonb_array_elements('$L'::jsonb) x;
select pg_sleep(SUEÑO);
commit;"
sql "${VIEJO/SUEÑO/3}" > "$TMP/v1" & sleep 1.5; sql "${VIEJO/SUEÑO/0}" > "$TMP/v2" & wait
V=$(sql "$CONTAR" | jq -r '.[0].lineas')

# nuevo: las dos sesiones llaman a pos_ndf_ingestar con el mismo lote
sql "$LIMPIAR" > /dev/null
sql "begin; select public.pos_ndf_ingestar('santa-teresa', '$T'::jsonb, '$L'::jsonb, null, null); select pg_sleep(3); commit;" > "$TMP/n1" &
sleep 1.5; sql "select public.pos_ndf_ingestar('santa-teresa', '$T'::jsonb, '$L'::jsonb, null, null) as r;" > "$TMP/n2" & wait
N=$(sql "$CONTAR" | jq -r '.[0].lineas')
jq -nc --arg v "$V" --arg n "$N" '{caso:"44/45 dos POST simultáneos de la misma factura (3 líneas)", viejo_lineas:($v|tonumber), nuevo_lineas:($n|tonumber), ok:(($n|tonumber) == 3)}'
