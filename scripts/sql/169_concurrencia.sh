#!/usr/bin/env bash
# 169 · Entrega CONCURRENTE del premio del reto (dos cajas a la vez) — SOLO base local de Postgres 16 (nunca staging ni
# prod: deja datos confirmados en una base descartable que crea y borra).
#
#   bash scripts/sql/169_concurrencia.sh <base_plantilla> [--mutar dos_veces]
#   (la plantilla: una base local armada con las migraciones del árbol, sin la 169; p. ej. la de pg1d/armar.sh)
#
# Arma una base copia de la plantilla, aplica la 169 (con --mutar, con los chequeos de estado sacados, como
# 169_pruebas.py), arma un reto ficticio (meta 3) y carga un socio con 2 días de visita; registra HOY dos visitas suyas en
# dos facturas distintas (tope del día en 2: la primera gana el reto) y abre DOS conexiones que llaman a la vez al paso de
# caja (club_reto_en_visita), cada una con su visita. La primera retiene su transacción 3 s antes de confirmar.
# Espera: UNA sola cortesía 'reto' entre las dos visitas y la segunda caja esperó a la primera (candado por socio).
# Sale 0 si se cumple, 1 si no. Con --mutar dos_veces tiene que salir 1 (la prueba muerde).
set -u
PLANTILLA=${1:?base plantilla}
MUTAR=${3:-}
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
CX="host=/tmp port=${PGPORT_LOCAL:-5499} user=${PGUSER_LOCAL:-pgv}"
DB=c169conc_$$
psql "$CX dbname=postgres" -Xq -c "create database $DB template $PLANTILLA" >/dev/null || exit 2
trap 'psql "$CX dbname=postgres" -Xq -c "drop database if exists $DB" >/dev/null' EXIT

MIG=$(python3 - "$RAIZ" "$MUTAR" <<'PY'
import sys, importlib.util
spec = importlib.util.spec_from_file_location('p169', sys.argv[1] + '/scripts/sql/169_pruebas.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print('begin;\n' + m.cuerpo(sys.argv[2] or None) + '\ncommit;')
PY
)
echo "$MIG" | psql "$CX dbname=$DB" -Xq -v ON_ERROR_STOP=1 >/dev/null 2>&1 || { echo "no se pudo aplicar la 169"; exit 2; }

psql "$CX dbname=$DB" -Xq -v ON_ERROR_STOP=1 >/dev/null <<'SQL' || { echo "no se pudo cargar la semilla"; exit 2; }
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8169-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8169-0000000000aa';
insert into public.club_config (location_id, nombre, club_activo) values ('prueba169a', 'Local Ficticio A', true);
update public.club_promociones set estado = 'vigente', desde = null, hasta = null, hora_desde = null, hora_hasta = null
 where location_id = 'prueba169a' and 'socio' = any(para);
insert into public.club_cortesias (location_id, codigo_producto, nombre) values ('prueba169a', 'P169A1', 'Postre Ficticio');
update public.club_config_global set socio_visitas_por_dia = 2;
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
values ('prueba169a', '169900001', now() - interval '5 minutes', 'C', 'salon', 'cajero', true, 'ok', 10000),
       ('prueba169a', '169900002', now() - interval '5 minutes', 'C', 'salon', 'cajero', true, 'ok', 10000);
insert into public.club_retos (nombre, nombre_en, locales, estado, desde, hasta, meta, cortesias, armado_en)
select 'Reto Ficticio', 'Ficticious Challenge', '{prueba169a}', 'vigente',
       greatest(h - 20, date_trunc('year', h)::date), least(h + 10, (date_trunc('year', h) + interval '1 year - 1 day')::date), 3,
       jsonb_build_object('prueba169a', (select id from public.club_cortesias where codigo_producto = 'P169A1')), now()
  from (select (now() at time zone 'America/Costa_Rica')::date h) x;
insert into public.club_miembros (id, location_id, tipo, nombre) values ('00000000-0000-4000-8169-0000000000c1', 'prueba169a', 'socio', 'Socio Ficticio');
insert into public.club_miembro_roles (miembro_id, rol, estado) values ('00000000-0000-4000-8169-0000000000c1', 'socio', 'activo')
  on conflict (miembro_id, rol) do update set estado = 'activo';
-- dos días anteriores con visita sobre una factura cerrada con el 856 (cuentan con la opción B)
with d as (select x as dias, '16980000' || x as nf, now() - make_interval(days => x) as ts from unnest(array[3, 2]) x),
     t as (insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
           select 'prueba169a', nf, ts, 'C', 'salon', 'cajero', true, 'ok', 10000 from d returning id),
     l as (insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto) select id, '856', 'LOCAL CLUB', 1, 0 from t)
insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, client_op_id, pos_ref, estado_beneficio, aplicar)
select 'prueba169a', '00000000-0000-4000-8169-0000000000c1', (ts at time zone 'America/Costa_Rica')::date, ts, gen_random_uuid(),
       jsonb_build_object('modo', 'factura', 'local', 'prueba169a', 'numero_factura', nf), 'aplica', '{}' from d;
-- las dos visitas de hoy (confirmadas): la primera gana el reto por el trigger
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8169-0000000000aa","role":"authenticated"}', false);
set role authenticated;
select public.club_socio_visita('00000000-0000-4000-8169-0000000000c1', '{"modo":"factura","local":"prueba169a","numero_factura":"169900001"}'::jsonb, gen_random_uuid(), 'prueba169a');
select public.club_socio_visita('00000000-0000-4000-8169-0000000000c1', '{"modo":"factura","local":"prueba169a","numero_factura":"169900002"}'::jsonb, gen_random_uuid(), 'prueba169a');
SQL

V1=$(psql "$CX dbname=$DB" -XAt -c "select id from public.club_visitas_socio where fecha = (now() at time zone 'America/Costa_Rica')::date order by registrada_en limit 1")
V2=$(psql "$CX dbname=$DB" -XAt -c "select id from public.club_visitas_socio where fecha = (now() at time zone 'America/Costa_Rica')::date order by registrada_en desc limit 1")
[ -n "$V1" ] && [ -n "$V2" ] && [ "$V1" != "$V2" ] || { echo "no quedaron dos visitas de hoy"; exit 2; }

caja() {   # $1 visita · $2 segundos que retiene la transacción
  psql "$CX dbname=$DB" -Xqt -v ON_ERROR_STOP=1 <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8169-0000000000aa","role":"authenticated"}', true);
set local role authenticated;
select 'R:' || public.club_reto_en_visita('$1', 'prueba169a')::text;
select pg_sleep($2);
commit;
SQL
}
T0=$(date +%s.%N)
caja "$V1" 3 > /tmp/c169_1_$$ 2>&1 &
sleep 1
caja "$V2" 0 > /tmp/c169_2_$$ 2>&1
T2=$(date +%s.%N)
wait
N=$(psql "$CX dbname=$DB" -XAt -c "select count(*) from public.club_visitas_socio v, jsonb_array_elements(v.cortesias) x where x->>'motivo' = 'reto'")
U=$(psql "$CX dbname=$DB" -XAt -c "select count(*) from public.club_retos_ganados where estado = 'usada'")
ESPERO=$(python3 -c "print(1 if $T2 - $T0 >= 2.5 else 0)")
rm -f /tmp/c169_1_$$ /tmp/c169_2_$$
echo "cortesías 'reto' en visitas: $N · premios usados: $U · la 2.ª caja esperó a la 1.ª: $ESPERO"
if [ "$N" = 1 ] && [ "$U" = 1 ] && [ "$ESPERO" = 1 ]; then echo "OK: un solo premio con dos cajas a la vez"; exit 0; fi
echo "FALLA: doble entrega concurrente"; exit 1
