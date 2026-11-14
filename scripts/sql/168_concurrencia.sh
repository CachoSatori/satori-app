#!/usr/bin/env bash
# 168 · Doble aplicación CONCURRENTE (dos cajas a la vez) — SOLO base local de Postgres 16 (nunca staging ni prod: deja
# datos confirmados en una base descartable que crea y borra).
#
#   bash scripts/sql/168_concurrencia.sh <base_plantilla> [--mutar dos_veces]
#   (la plantilla: una base local armada con las migraciones del árbol, sin la 168; p. ej. la de pg1d/armar.sh)
#
# Arma una base copia de la plantilla, aplica la 168 (con --mutar, con los dos chequeos de estado sacados, como
# 168_pruebas.py), carga un socio ficticio que llega a la 4.ª visita HOY y abre DOS conexiones que registran su visita a la
# vez con dos facturas distintas (tope del día en 2). La primera retiene su transacción 3 s antes de confirmar.
# Espera: UNA sola cortesía 'primeros_90' entre las dos visitas y la segunda caja esperó a la primera (candado por socio).
# Sale 0 si se cumple, 1 si no. Con --mutar dos_veces tiene que salir 1 (la prueba muerde).
set -u
PLANTILLA=${1:?base plantilla}
MUTAR=${3:-}
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
CX="host=/tmp port=${PGPORT_LOCAL:-5499} user=${PGUSER_LOCAL:-pgv}"
DB=c168conc_$$
psql "$CX dbname=postgres" -Xq -c "create database $DB template $PLANTILLA" >/dev/null || exit 2
trap 'psql "$CX dbname=postgres" -Xq -c "drop database if exists $DB" >/dev/null' EXIT

MIG=$(python3 - "$RAIZ" "$MUTAR" <<'EOF'
import sys, importlib.util
spec = importlib.util.spec_from_file_location('p168', sys.argv[1] + '/scripts/sql/168_pruebas.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print('begin;\n' + m.cuerpo(sys.argv[2] or None) + '\ncommit;')
EOF
)
echo "$MIG" | psql "$CX dbname=$DB" -Xq -v ON_ERROR_STOP=1 >/dev/null 2>&1 || { echo "no se pudo aplicar la 168"; exit 2; }

psql "$CX dbname=$DB" -Xq -v ON_ERROR_STOP=1 >/dev/null <<'EOF' || { echo "no se pudo cargar la semilla"; exit 2; }
insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-4000-8168-0000000000aa', '{"full_name":"Owner Ficticio"}');
update public.profiles set role = 'owner', is_active = true where id = '00000000-0000-4000-8168-0000000000aa';
insert into public.club_config (location_id, nombre, club_activo) values ('prueba168a', 'Local Ficticio A', true);
update public.club_promociones set estado = 'vigente', desde = null, hasta = null, hora_desde = null, hora_hasta = null
 where location_id = 'prueba168a' and 'socio' = any(para);
insert into public.club_cortesias (location_id, codigo_producto, nombre) values ('prueba168a', 'P168A1', 'Postre Ficticio');
update public.club_config set primeros90_cortesia_id = (select id from public.club_cortesias where codigo_producto = 'P168A1')
 where location_id = 'prueba168a';
update public.club_config_global set primeros90_activo = true, socio_visitas_por_dia = 2;
insert into public.club_miembros (id, location_id, tipo, nombre) values ('00000000-0000-4000-8168-0000000000c1', 'prueba168a', 'socio', 'Socio Ficticio');
insert into public.club_miembro_roles (miembro_id, rol, estado) values ('00000000-0000-4000-8168-0000000000c1', 'socio', 'activo')
  on conflict (miembro_id, rol) do update set estado = 'activo';
update public.club_miembro_roles set desde = now() - interval '10 days' where miembro_id = '00000000-0000-4000-8168-0000000000c1';
-- dos días anteriores con su factura cerrada con el 856 (opción B: sin factura no cuentan)
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
select 'prueba168a', '16880000' || d, now() - make_interval(days => d), 'C', 'salon', 'cajero', true, 'ok', 10000 from unnest(array[7, 4]) d;
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto)
select t.id, '856', 'LOCAL CLUB', 1, 0 from public.pos_ndf_tickets t where t.numero_factura in ('168800007', '168800004');
insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, client_op_id, pos_ref, estado_beneficio, aplicar)
select 'prueba168a', '00000000-0000-4000-8168-0000000000c1', ((now() - make_interval(days => d)) at time zone 'America/Costa_Rica')::date,
       now() - make_interval(days => d), gen_random_uuid(),
       jsonb_build_object('modo', 'factura', 'local', 'prueba168a', 'numero_factura', '16880000' || d), 'aplica', '{}' from unnest(array[7, 4]) d;
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
values ('prueba168a', '168900001', now() - interval '5 minutes', 'C', 'salon', 'cajero', true, 'ok', 10000),
       ('prueba168a', '168900002', now() - interval '5 minutes', 'C', 'salon', 'cajero', true, 'ok', 10000);
EOF

caja() {   # $1 factura · $2 segundos que retiene la transacción
  psql "$CX dbname=$DB" -Xqt -v ON_ERROR_STOP=1 <<EOF
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8168-0000000000aa","role":"authenticated"}', true);
set local role authenticated;
select 'R:' || public.club_socio_visita('00000000-0000-4000-8168-0000000000c1',
         '{"modo":"factura","local":"prueba168a","numero_factura":"$1"}'::jsonb, gen_random_uuid(), 'prueba168a')::text;
select pg_sleep($2);
commit;
EOF
}
T0=$(date +%s.%N)
caja 168900001 3 > /tmp/c168_1_$$ 2>&1 &
sleep 1
caja 168900002 0 > /tmp/c168_2_$$ 2>&1
T2=$(date +%s.%N)
wait
N=$(psql "$CX dbname=$DB" -XAt -c "select count(*) from public.club_visitas_socio v, jsonb_array_elements(v.cortesias) x
                                     where x->>'motivo' = 'primeros_90'")
U=$(psql "$CX dbname=$DB" -XAt -c "select count(*) from public.club_primeros90 where estado = 'usada'")
ESPERO=$(python3 -c "print(1 if $T2 - $T0 >= 2.5 else 0)")
rm -f /tmp/c168_1_$$ /tmp/c168_2_$$
echo "cortesías primeros_90 en visitas: $N · filas usadas: $U · la 2.ª caja esperó a la 1.ª: $ESPERO"
if [ "$N" = 1 ] && [ "$U" = 1 ] && [ "$ESPERO" = 1 ]; then echo "OK: una sola cortesía con dos cajas a la vez"; exit 0; fi
echo "FALLA: doble aplicación concurrente"; exit 1
