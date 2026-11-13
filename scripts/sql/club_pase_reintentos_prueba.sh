#!/usr/bin/env bash
# Grok 75 · prueba de la PROPUESTA docs/club-satori/propuestas/club_pase_reintentos.sql contra STAGING, en UNA transacción
# que termina en un raise con el resultado (se descarta todo: ni la tabla ni las funciones quedan). Token: el proxy.
set -euo pipefail
REF=hwiatgicyyqyezqwldia
RAIZ=$(git rev-parse --show-toplevel)
P=$(cat "$RAIZ/docs/club-satori/propuestas/club_pase_reintentos.sql")
Q="begin;
$P
create temp table _r (caso text, ok boolean, detalle text);
grant insert on _r to service_role;
do \$t\$
declare m1 uuid := '00000000-0000-4000-8000-0000000000a1'; m2 uuid := '00000000-0000-4000-8000-0000000000a2'; n int; e text;
begin
  set local role service_role;
  n := public.club_pase_reintento_anotar(m1, 'google', 12, 'PATCH HTTP 500');
  n := public.club_pase_reintento_anotar(m1, 'google', 15, 'PATCH HTTP 503');
  insert into _r values ('anotar dos veces: 2 intentos, se queda el evento más viejo y el último error', n = 2
    and (select (evento_id, ultimo_error) = (12::bigint, 'PATCH HTTP 503') from club_pase_reintentos where miembro_id = m1), n::text);
  perform public.club_pase_reintento_anotar(m2, 'google', null, 'datos');
  insert into _r values ('leer: los dos, bajo el tope', (select count(*) from public.club_pase_reintentos_leer('google', 10, 200)) = 2, '');
  insert into _r values ('leer con tope 2: el de 2 intentos ya no se reintenta solo (queda anotado)',
    (select array_agg(miembro_id) from public.club_pase_reintentos_leer('google', 2, 200)) = array[m2]
    and exists (select 1 from club_pase_reintentos where miembro_id = m1), '');
  insert into _r values ('otra plataforma no ve nada', not exists (select 1 from public.club_pase_reintentos_leer('apple', 10, 200)), '');
  -- cada llamada en su propia sentencia (una consulta ve la foto de antes de sus propias llamadas)
  e := public.club_pase_reintento_resuelto(m2, 'google')::text;
  e := e || '/' || public.club_pase_reintento_resuelto(m2, 'google')::text;
  insert into _r values ('resuelto borra la anotación (y uno inexistente da false)',
    e = 'true/false' and not exists (select 1 from club_pase_reintentos where miembro_id = m2), e);
  begin perform public.club_pase_reintento_anotar(m2, 'google', 1, 'tel 50660001234'); e := 'guardó'; exception when check_violation then e := 'rechazado'; end;
  insert into _r values ('un mensaje con un número largo (teléfono) se rechaza', e = 'rechazado', e);
  reset role;
  insert into _r values ('solo service_role ejecuta (anon y authenticated no)',
    not has_function_privilege('anon', 'public.club_pase_reintento_anotar(uuid, text, bigint, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.club_pase_reintentos_leer(text, int, int)', 'EXECUTE')
    and not has_table_privilege('authenticated', 'public.club_pase_reintentos', 'SELECT'), '');
end \$t\$;
do \$r\$ begin raise exception 'RES:%', (select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', detalle)) from _r); end \$r\$;"
jq -n --arg q "$Q" '{query:$q}' | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-x}" -H 'Content-Type: application/json' --data-binary @- \
  | jq -r '.message' | sed -n 's/.*RES:\(\[.*\]\).*/\1/p' | jq -c '.[] | {ok, caso}' | tee /dev/stderr \
  | jq -s 'map(.ok) | "\(map(select(.)) | length)/\(length)"' -r | { read -r x; echo "pruebas: $x"; [[ -n "$x" && "${x%/*}" == "${x#*/}" ]]; }
