-- 169_pruebas (origen 115) · Aplica la 169 dentro de una transacción, prueba y termina en ROLLBACK: no deja nada.
-- Corre sobre una base con la 155 (staging, o el Postgres 16 local armado con las migraciones del árbol; con o sin la 168).
-- Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con «169-FALLAN: <casos>».
-- Se corre con scripts/sql/169_pruebas.py (o con el SQL armado: 169_pruebas.py --armar).
--
-- MARCADORES que llena el runner: «-- @@169@@ …» → el cuerpo de supabase/migrations/169_club_retos.sql sin begin/commit
-- ni su bloque de verificación (con --mutar, con el arreglo deshecho a propósito); «-- @@169G@@ …» → la guarda de
-- scripts/sql/169_rollback.sql (caso 16a); «-- @@169R@@ …» → el cuerpo del rollback (caso 16b).
-- Locales FICTICIOS que crea adentro: prueba169a (con cortesía), prueba169b (sin cortesía cargada), prueba169c (con
-- cortesía), prueba169d (reto con grupo de control) y prueba169e (sin reto). Owner ACTIVO de la base (si no hay, el caso
-- 00 falla: NO PROBADO no da verde) y socios con nombres ficticios. Retos armados del año en curso: 2 (el tope es 3).
-- La entrega CONCURRENTE de verdad (dos conexiones a la vez) está en 169_concurrencia.sh (base local).
-- Las fechas son de Costa Rica; la franja se prueba con instantes fijos (incluido 23:30 CR = 05:30 UTC del día siguiente).
begin;
-- foto de antes de la 169 (la 169 no toca club_socio_visita: caso 15 y rollback 16b)
create temp table _p169 on commit drop as
select md5(pg_get_functiondef('public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure)) as md5_visita,
       to_regprocedure('public.club_socio_visita_base(uuid,jsonb,uuid,text)') is not null as con_168;
-- @@169@@   (aquí va el cuerpo de la 169 sin begin/commit)
create temp table _r169 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r169 to anon, authenticated;
grant usage on sequence _r169_n_seq to anon, authenticated;

create temp table _c169 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8169-0000000000ff'::uuid as sin_rol,
       (now() at time zone 'America/Costa_Rica')::date as hoy;
alter table _c169 add column desde date, add column hasta date;
update _c169 set desde = greatest(hoy - 20, date_trunc('year', hoy)::date),
                 hasta = least(hoy + 10, (date_trunc('year', hoy) + interval '1 year - 1 day')::date);
grant select on _c169 to anon, authenticated;
create temp table _f169 (n serial) on commit drop;   -- números de factura ficticios
grant all on _f169 to anon, authenticated;
grant usage on sequence _f169_n_seq to anon, authenticated;
create temp table _v169 (k text primary key, r jsonb) on commit drop;
grant all on _v169 to anon, authenticated;

insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba169a', 'Local Ficticio A', true), ('prueba169b', 'Local Ficticio B', true), ('prueba169c', 'Local Ficticio C', true),
  ('prueba169d', 'Local Ficticio D', true), ('prueba169e', 'Local Ficticio E', true), ('prueba169f', 'Local Ficticio F', true);
-- una factura reciente en A–E (tienen PoS en la base); F no tiene ninguna (como Nosara hoy)
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
select l, '1690000' || right(l, 1), now() - interval '2 days', 'C', 'salon', 'cajero', true, 'ok', 10000
  from unnest(array['prueba169a','prueba169b','prueba169c','prueba169d','prueba169e']) l;
update public.club_promociones set estado = 'vigente', desde = null, hasta = null, hora_desde = null, hora_hasta = null,
                                   dias = '{1,2,3,4,5,6,7}'
 where location_id like 'prueba169_' and 'socio' = any(para);
insert into public.club_cortesias (location_id, codigo_producto, nombre) values
  ('prueba169a', 'P169A1', 'Postre Ficticio A'), ('prueba169a', 'P169A2', 'Bebida Ficticia A'),
  ('prueba169b', 'P169B1', 'Postre Ficticio B'), ('prueba169c', 'P169C1', 'Postre Ficticio C'),
  ('prueba169d', 'P169D1', 'Postre Ficticio D');
update public.club_config_global set club_url = coalesce(club_url, 'https://club.ejemplo.test'), socio_visitas_por_dia = 1;

select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-169-0123456789abcdef', 'sha256'), 'hex'));
select set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-169-0123456789abcdef"}', true);

create function pg_temp.k(p_cod text) returns uuid language sql stable as $f$
  select id from public.club_cortesias where codigo_producto = p_cod $f$;
-- Socios: id fijo por texto; alta hace 10 días. tipo 'socio' crea su rol socio activo (trigger de la 150).
create function pg_temp.sid(p text) returns uuid language sql immutable as $f$
  select ('00000000-0000-4000-8169-' || lpad(substr(md5(p), 1, 12), 12, '0'))::uuid $f$;
create function pg_temp.socio(p text, p_tipo text default 'socio') returns void language plpgsql as $f$
begin
  insert into public.club_miembros (id, location_id, tipo, nombre) values (pg_temp.sid(p), 'prueba169a', p_tipo, 'Socio Ficticio ' || p);
  insert into public.club_miembro_roles (miembro_id, rol, estado) values (pg_temp.sid(p), 'socio', 'activo')
    on conflict (miembro_id, rol) do update set estado = 'activo';
  update public.club_miembro_roles set desde = now() - interval '10 days' where miembro_id = pg_temp.sid(p) and rol = 'socio';
end $f$;
-- una visita registrada hace N días a una hora CR (directo en la tabla, como si la hubiera hecho la caja ese día). Con
-- p_fact (por defecto), sobre una factura cerrada (C) con el 856 de ese momento (cuenta con la opción B); sin p_fact, un
-- escaneo sobre un pedido que nunca tuvo factura. p_cort = cortesías que ya lleva la visita.
create function pg_temp.visita(p text, p_dias int, p_loc text default 'prueba169a', p_hora text default '13:00',
                               p_est text default 'aplica', p_fact boolean default true, p_cort jsonb default '[]') returns uuid
language plpgsql as $f$
declare v_nf text; v_t uuid; v_id uuid;
        v_ts timestamptz := (((select hoy from _c169) - p_dias) + p_hora::time) at time zone 'America/Costa_Rica';
begin
  insert into _f169 default values;
  v_nf := '169' || lpad(currval('_f169_n_seq')::text, 6, '0');
  if p_fact then
    insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
    values (p_loc, v_nf, v_ts, 'C', 'salon', 'cajero', true, 'ok', 10000) returning id into v_t;
    insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto) values (v_t, '856', 'LOCAL CLUB', 1, 0);
  end if;
  insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, client_op_id, pos_ref, cortesias, estado_beneficio, aplicar)
  values (p_loc, pg_temp.sid(p), (v_ts at time zone 'America/Costa_Rica')::date, v_ts, gen_random_uuid(),
          jsonb_build_object('modo', 'factura', 'local', p_loc, 'numero_factura', v_nf), p_cort, p_est, '{}'::jsonb)
  returning id into v_id;
  return v_id;
end $f$;
-- llamar algo como un usuario (owner, sin rol…)
create function pg_temp.como(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select to_jsonb((' || p_sql || '))' into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise;
end $f$;
-- la caja (owner) escanea al socio HOY con una factura nueva y, como la pantalla, llama al paso del reto
create function pg_temp.caja(p text, p_loc text default 'prueba169a', p_op uuid default null) returns jsonb language plpgsql as $f$
declare v_nf text; r jsonb; v_uid uuid := (select owner_id from _c169);
begin
  insert into _f169 default values;
  v_nf := '169' || lpad(currval('_f169_n_seq')::text, 6, '0');
  insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
  values (p_loc, v_nf, now() - interval '5 minutes', 'C', 'salon', 'cajero', true, 'ok', 10000);
  r := pg_temp.como(v_uid, format('public.club_socio_visita(%L::uuid, %L::jsonb, %L::uuid, %L)', pg_temp.sid(p),
         jsonb_build_object('modo', 'factura', 'local', p_loc, 'numero_factura', v_nf), coalesce(p_op, gen_random_uuid()), p_loc));
  if r->>'visita_id' is not null and not (r ? 'reto') then
    r := pg_temp.como(v_uid, format('public.club_reto_en_visita(%L::uuid, %L)', r->>'visita_id', p_loc)) || jsonb_build_object('repetida', r->'repetida');
  end if;
  return r;
end $f$;
create function pg_temp.premio(r jsonb) returns int language sql immutable as $f$
  select count(*)::int from jsonb_array_elements(coalesce(r->'cortesias', '[]'::jsonb)) x where x->>'motivo' = 'reto' $f$;
create function pg_temp.g(p text, p_reto text default 'Reto Ficticio Almuerzos') returns public.club_retos_ganados language sql stable as $f$
  select g.* from public.club_retos_ganados g join public.club_retos r on r.id = g.reto_id
   where g.miembro_id = pg_temp.sid(p) and r.nombre = p_reto $f$;
create function pg_temp.portal(p text) returns jsonb language sql as $f$
  select public.club_portal_retos((select token_portal from public.club_miembros where id = pg_temp.sid(p))) $f$;
-- un reto directo en la tabla (las reglas del trigger valen igual); armado = true lo deja vigente
create function pg_temp.reto(p_nom text, p_loc text[], p_desde date, p_hasta date, p_armado boolean default true,
                             p_meta int default 3, p_cort jsonb default '{}', p_ctrl int default 0,
                             p_hd time default null, p_hh time default null, p_dias int[] default '{1,2,3,4,5,6,7}') returns uuid
language sql as $f$
  insert into public.club_retos (nombre, nombre_en, locales, estado, desde, hasta, dias, hora_desde, hora_hasta, meta, cortesias,
                                 control_pct, armado_en)
  values (p_nom, p_nom || ' EN', p_loc, case when p_armado then 'vigente' else 'borrador' end, p_desde, p_hasta, p_dias, p_hd, p_hh,
          p_meta, p_cort, p_ctrl, case when p_armado then now() end)
  returning id $f$;
create function pg_temp.error_de(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $f$;

-- 00. hay owner activo y la fecha deja probar (3 días hacia atrás en el mismo año)
insert into _r169 (caso, ok, detalle)
select '00 hay un owner activo · la ventana del reto de prueba entra en el año',
       owner_id is not null and hoy - 4 >= desde, 'con 168: ' || (select con_168 from _p169) || ' · ventana ' || desde || '..' || hasta from _c169;

-- 0. catálogo
insert into _r169 (caso, ok, detalle)
select '0 catálogo: definer con search_path · caja y club-web con permiso · internas y tablas cerradas · ningún reto armado',
       (select bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp']) from pg_proc p
         where p.oid in ('public.club_reto_en_visita(uuid,text)'::regprocedure, 'public.club_portal_retos(text)'::regprocedure,
                         'public.club_retos_evaluar(uuid)'::regprocedure, 'public.club_retos_listar()'::regprocedure,
                         'public.club_reto_guardar(uuid,jsonb)'::regprocedure, 'public.club_reto_armar(uuid)'::regprocedure,
                         'public.club_reto_terminar(uuid)'::regprocedure, 'public.club_reto_borrar(uuid)'::regprocedure,
                         'public.club_retos_reglas()'::regprocedure, 'public.club_retos_visita_trg()'::regprocedure,
                         'public.club_retos_del_socio(uuid)'::regprocedure))
       and has_function_privilege('authenticated', 'public.club_reto_en_visita(uuid,text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_reto_en_visita(uuid,text)', 'EXECUTE')
       and has_function_privilege('anon', 'public.club_portal_retos(text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_retos_evaluar(uuid)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_retos_del_socio(uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_reto_avance(public.club_retos,uuid,date)', 'EXECUTE')
       and not has_table_privilege('authenticated', 'public.club_retos', 'SELECT')
       and not has_table_privilege('authenticated', 'public.club_retos', 'INSERT')
       and not has_table_privilege('anon', 'public.club_retos_ganados', 'SELECT')
       and not has_table_privilege('authenticated', 'public.club_retos_ganados', 'INSERT')
       and not exists (select 1 from public.club_retos where armado_en is not null and nombre not like '%Ficticio%'
                         and extract(year from desde) = extract(year from (select hoy from _c169)) having count(*) > 1),
       null;

-- 1. APAGADO POR DEFECTO: con el reto en BORRADOR, la 3.ª visita no gana ni se ofrece y «Mi Club» no muestra nada
insert into _v169 values ('reto', to_jsonb(pg_temp.reto('Reto Ficticio Almuerzos', array['prueba169a','prueba169b','prueba169c'],
  (select desde from _c169), (select hasta from _c169), false, 3,
  jsonb_build_object('prueba169a', pg_temp.k('P169A1'), 'prueba169c', pg_temp.k('P169C1')))));
select pg_temp.socio('a');
select pg_temp.visita('a', 3); select pg_temp.visita('a', 2);
insert into _v169 values ('a1', pg_temp.caja('a'));
insert into _r169 (caso, ok, detalle)
select '1 apagado: reto en borrador → la 3.ª visita no gana ni ofrece · «Mi Club» vacío · la caja sigue igual (aplica)',
       pg_temp.premio(r) = 0 and (pg_temp.g('a')).id is null and pg_temp.portal('a')->'retos' = '[]'::jsonb
       and r->>'estado' = 'aplica' and not (r ? 'reto'),
       r::text from _v169 where k = 'a1';
-- el owner lo ARMA (de acá en adelante cuenta)
update public.club_retos set estado = 'vigente', armado_en = now() where nombre = 'Reto Ficticio Almuerzos';

-- 2. FRANJA EN HORA CR: misma regla que la promoción (grilla) · bordes explícitos · avance con franja
insert into public.club_promociones (location_id, nombre, para, estado, desde, hasta, dias, hora_desde, hora_hasta, porcentaje)
values ('prueba169e', 'Promo Ficticia Mediodia', '{socio}', 'vigente', '2026-12-01', '2026-12-31', '{1,2,3,4,5}', '11:30', '15:00', 10),
       ('prueba169e', 'Promo Ficticia Noche', '{socio}', 'vigente', '2026-12-01', '2026-12-31', '{5,6}', '22:00', '02:00', 10);
insert into _v169 values ('fr1', to_jsonb(pg_temp.reto('Reto Ficticio Franja Uno', '{prueba169e}', '2026-12-01', '2026-12-31', false, 3, '{}', 0, '11:30', '15:00', '{1,2,3,4,5}')));
insert into _v169 values ('fr2', to_jsonb(pg_temp.reto('Reto Ficticio Franja Dos', '{prueba169e}', '2026-12-01', '2026-12-31', false, 3, '{}', 0, '22:00', '02:00', '{5,6}')));
select pg_temp.socio('f');
insert into _v169 values ('frv', to_jsonb(pg_temp.reto('Reto Ficticio Franja Avance', '{prueba169e}', (select desde from _c169), (select hasta from _c169),
                                                     false, 3, '{}', 0, '11:30', '15:00')));
select pg_temp.visita('f', 4, 'prueba169e', '12:00');   -- cuenta
select pg_temp.visita('f', 3, 'prueba169e', '16:00');   -- fuera de la franja
select pg_temp.visita('f', 2, 'prueba169e', '11:00');   -- fuera de la franja
select pg_temp.visita('f', 2, 'prueba169e', '14:59');   -- cuenta
select pg_temp.visita('f', 1, 'prueba169b', '13:00');   -- otro local (el reto es del E)
insert into _r169 (caso, ok, detalle)
select '2 franja hora CR = la de promociones (grilla de 31 días × 48 medias horas, normal y cruzando medianoche) · bordes · avance cuenta solo las de la franja (2)',
       (select bool_and(public.club_reto_en_franja(r1, t) = public.club_promo_vigente_en(p1, t)
                        and public.club_reto_en_franja(r2, t) = public.club_promo_vigente_en(p2, t))
          from public.club_retos r1, public.club_retos r2, public.club_promociones p1, public.club_promociones p2,
               generate_series(timestamptz '2026-11-30 00:15:00-06', timestamptz '2027-01-01 23:45:00-06', interval '30 minutes') t
         where r1.nombre = 'Reto Ficticio Franja Uno' and r2.nombre = 'Reto Ficticio Franja Dos'
           and p1.nombre = 'Promo Ficticia Mediodia' and p2.nombre = 'Promo Ficticia Noche')
       and public.club_reto_en_franja(r1, timestamptz '2026-12-07 17:59:00+00')        -- lunes 11:59 CR
       and not public.club_reto_en_franja(r1, timestamptz '2026-12-07 21:00:00+00')    -- lunes 15:00 CR (fin, afuera)
       and not public.club_reto_en_franja(r1, timestamptz '2026-12-07 17:00:00+00')    -- lunes 11:00 CR
       and not public.club_reto_en_franja(r1, timestamptz '2026-12-05 18:00:00+00')    -- sábado 12:00 CR
       and public.club_reto_en_franja(r2, timestamptz '2026-12-05 07:30:00+00')        -- sábado 01:30 CR (viernes de noche)
       and not public.club_reto_en_franja(r2, timestamptz '2026-12-01 05:30:00+00')    -- 23:30 CR del 30-nov (antes del desde)
       and public.club_reto_en_franja(r2, timestamptz '2027-01-01 05:30:00+00') = false -- 23:30 CR del 31-dic: jueves, no va
       and public.club_reto_avance(rv, pg_temp.sid('f'), (select hoy from _c169)) = 2,
       'avance f = ' || public.club_reto_avance(rv, pg_temp.sid('f'), (select hoy from _c169))
  from public.club_retos r1, public.club_retos r2, public.club_retos rv
 where r1.nombre = 'Reto Ficticio Franja Uno' and r2.nombre = 'Reto Ficticio Franja Dos' and rv.nombre = 'Reto Ficticio Franja Avance';

-- 3. TOPE: máximo 3 retos ARMADOS por año (todos los locales); un borrador no cuenta; otro año sí entra
do $$
declare e text[] := '{}';
begin
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio T1', '{prueba169a}', '2030-02-01', '2030-02-28')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio T2', '{prueba169b}', '2030-02-01', '2030-02-28')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio T3', '{prueba169a}', '2030-06-01', '2030-06-30')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio T4', '{prueba169c}', '2030-09-01', '2030-09-30')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio T5', '{prueba169c}', '2030-09-01', '2030-09-30', false)$q$);
  e := e || pg_temp.error_de($q$update public.club_retos set estado = 'vigente', armado_en = now() where nombre = 'Reto Ficticio T5'$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio T6', '{prueba169c}', '2029-09-01', '2029-09-30')$q$);
  insert into _r169 (caso, ok, detalle) values ('3 tope: 3 armados en 2030 entran · el 4.º armado → «Ya hay 3» · el 4.º en borrador entra · armarlo → error · 2029 entra',
    e[1] is null and e[2] is null and e[3] is null and coalesce(e[4], '') like 'Ya hay 3 retos armados en 2030%'
    and e[5] is null and coalesce(e[6], '') like 'Ya hay 3%' and e[7] is null
    and (select count(*) from public.club_retos where armado_en is not null and extract(year from desde) = 2030) = 3,
    array_to_string(e, ' | ', '·'));
end $$;

-- 4. SUPERPOSICIÓN: dos armados no se pisan en fechas en el mismo local (sí en locales distintos; pegados, sí)
do $$
declare e text[] := '{}';
begin
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio S1', '{prueba169a}', '2031-03-01', '2031-03-31')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio S2', '{prueba169a}', '2031-03-31', '2031-04-10')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio S3', '{prueba169b}', '2031-03-15', '2031-04-10')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio S4', '{prueba169a}', '2031-04-01', '2031-04-30')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio S5', '{prueba169c,prueba169b}', '2028-03-01', '2028-03-02')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio S6', '{prueba169d,prueba169b}', '2028-03-02', '2028-03-20')$q$);
  e := e || pg_temp.error_de($q$update public.club_retos set estado = 'terminada', terminada_en = now() where nombre = 'Reto Ficticio S5'$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio S7', '{prueba169d,prueba169b}', '2028-03-02', '2028-03-20')$q$);
  insert into _r169 (caso, ok, detalle) values ('4 superposición: mismo local y fechas que se pisan → error · otro local entra · pegado (día siguiente) entra · un local en común → error · terminado ya no bloquea su local',
    e[1] is null and coalesce(e[2], '') like 'Se superpone con el reto «Reto Ficticio S1»%' and e[3] is null and e[4] is null
    and e[5] is null and coalesce(e[6], '') like 'Se superpone%' and e[7] is null and e[8] is null,
    array_to_string(e, ' | ', '·'));
end $$;

-- 5. ARMADO INMUTABLE: no se edita ni se borra; se termina; terminado no cambia; un borrador se borra
do $$
declare e text[] := '{}';
begin
  e := e || pg_temp.error_de($q$update public.club_retos set meta = 2 where nombre = 'Reto Ficticio T1'$q$);
  e := e || pg_temp.error_de($q$delete from public.club_retos where nombre = 'Reto Ficticio T1'$q$);
  e := e || pg_temp.error_de($q$update public.club_retos set estado = 'terminada', terminada_en = now() where nombre = 'Reto Ficticio T1'$q$);
  e := e || pg_temp.error_de($q$update public.club_retos set estado = 'vigente' where nombre = 'Reto Ficticio T1'$q$);
  e := e || pg_temp.error_de($q$delete from public.club_retos where nombre = 'Reto Ficticio T5'$q$);
  insert into _r169 (caso, ok, detalle) values ('5 armado: editar meta → error · borrar → error · terminar entra · terminado no cambia · borrador se borra',
    coalesce(e[1], '') like 'Un reto armado no se edita%' and coalesce(e[2], '') like 'Un reto armado no se borra%'
    and e[3] is null and coalesce(e[4], '') like 'Un reto terminado no se cambia%' and e[5] is null
    and not exists (select 1 from public.club_retos where nombre = 'Reto Ficticio T5'),
    array_to_string(e, ' | ', '·'));
end $$;

-- 6. GANA Y SE OFRECE: 2 días con visita (uno doble: cuenta uno) → la de hoy es la 3.ª: gana y la caja la ofrece
select pg_temp.socio('c');
select pg_temp.visita('c', 3); select pg_temp.visita('c', 2, 'prueba169b'); select pg_temp.visita('c', 2, 'prueba169b', '20:00');
insert into _v169 values ('c0', to_jsonb(public.club_reto_avance((select r from public.club_retos r where r.nombre = 'Reto Ficticio Almuerzos'), pg_temp.sid('c'), (select hoy from _c169))));
insert into _v169 values ('c1', pg_temp.caja('c'));
insert into _r169 (caso, ok, detalle)
select '6 avance 2 (dos visitas el mismo día cuentan una, en otro local del reto) · la 3.ª gana y se ofrece (motivo reto, texto, aviso con el artículo) · en la visita y la auditoría',
       (select r from _v169 where k = 'c0') = '2'::jsonb
       and pg_temp.premio(r) = 1 and r->>'estado' = 'aplica'
       and r->>'texto' like '%1 cortesía de premio del reto: Postre Ficticio A%'
       and r->'reto'->>'estado' = 'ofrecida'
       and exists (select 1 from jsonb_array_elements_text(r->'avisos') a where a like '%P169A1%una sola vez%')
       and (pg_temp.g('c')).estado = 'usada' and (pg_temp.g('c')).visita_id = (r->>'visita_id')::uuid
       and (pg_temp.g('c')).visita_ganadora = (r->>'visita_id')::uuid and (pg_temp.g('c')).location_id = 'prueba169a'
       and pg_temp.premio((select v.aplicar from public.club_visitas_socio v where v.id = (r->>'visita_id')::uuid)) = 1
       and (select jsonb_path_exists(v.cortesias, '$[*] ? (@.motivo == "reto")') from public.club_visitas_socio v where v.id = (r->>'visita_id')::uuid)
       and (select count(*) from public.club_auditoria au where au.objeto_id = (pg_temp.g('c')).id
              and au.accion in ('reto_ganado', 'reto_usado')) = 2,
       r::text from _v169 where k = 'c1';

-- 7. UNA SOLA VEZ: otra factura hoy (tope 2) → sin premio · reescaneo (misma op) → el mismo · el paso de caja otra vez → igual
update public.club_config_global set socio_visitas_por_dia = 2;
insert into _v169 values ('c2', pg_temp.caja('c'));
insert into _v169 values ('c3', pg_temp.caja('c', 'prueba169a', (select v.client_op_id from public.club_visitas_socio v
                                                                 where v.id = ((select r from _v169 where k = 'c1')->>'visita_id')::uuid)));
insert into _v169 values ('c4', pg_temp.como((select owner_id from _c169),
  format('public.club_reto_en_visita(%L::uuid, %L)', (select r from _v169 where k = 'c1')->>'visita_id', 'prueba169a')));
update public.club_config_global set socio_visitas_por_dia = 1;
insert into _r169 (caso, ok, detalle)
select '7 una sola vez: 2.ª visita del día sin premio · reescaneo = el mismo (repetida) · el paso otra vez no suma · uno solo en todas las visitas',
       pg_temp.premio((select r from _v169 where k = 'c2')) = 0
       and ((select r from _v169 where k = 'c3')->>'repetida')::boolean
       and pg_temp.premio((select r from _v169 where k = 'c3')) = 1
       and pg_temp.premio((select r from _v169 where k = 'c4')) = 1
       and (select count(*) from public.club_visitas_socio v, jsonb_array_elements(v.cortesias) x
             where v.miembro_id = pg_temp.sid('c') and x->>'motivo' = 'reto') = 1
       and (select count(*) from public.club_retos_ganados where miembro_id = pg_temp.sid('c')) = 1,
       (select r::text from _v169 where k = 'c2');

-- 8. EQUIPO EXCLUIDO (D7): tipo 'equipo' con rol socio, y un socio con rol equipo activo → no gana ni ve el reto
select pg_temp.socio('g', 'equipo');
select pg_temp.visita('g', 3); select pg_temp.visita('g', 2);
insert into _v169 values ('g1', pg_temp.caja('g'));
select pg_temp.socio('h');
insert into public.club_miembro_roles (miembro_id, rol, estado) values (pg_temp.sid('h'), 'equipo', 'activo');
select pg_temp.visita('h', 3); select pg_temp.visita('h', 2);
insert into _v169 values ('h1', pg_temp.caja('h'));
insert into _r169 (caso, ok, detalle)
select '8 equipo excluido (tipo y rol, con y sin la 157): no gana, no se ofrece, «Mi Club» sin retos',
       pg_temp.premio((select r from _v169 where k = 'g1')) = 0 and (pg_temp.g('g')).id is null
       and pg_temp.premio((select r from _v169 where k = 'h1')) = 0 and (pg_temp.g('h')).id is null
       and pg_temp.portal('g')->'retos' = '[]'::jsonb and pg_temp.portal('h')->'retos' = '[]'::jsonb,
       (select r::text from _v169 where k = 'h1');

-- 9. GRUPO DE CONTROL: sorteo fijo ~15 % · el del grupo no ve ni gana el reto (beneficio base igual) · el otro sí
insert into _v169 values ('ctl', to_jsonb(pg_temp.reto('Reto Ficticio Control', '{prueba169d}', (select desde from _c169), (select hasta from _c169),
                                                     true, 3, jsonb_build_object('prueba169d', pg_temp.k('P169D1')), 15)));
create temp table _ctl on commit drop as
select p, public.club_reto_control(((select r from _v169 where k = 'ctl') #>> '{}')::uuid, 15, pg_temp.sid(p)) as en_control
  from (select 'ctl' || i as p from generate_series(1, 60) i) x;
select pg_temp.socio((select p from _ctl where en_control order by p limit 1));
select pg_temp.socio((select p from _ctl where not en_control order by p limit 1));
select pg_temp.visita(p, 3, 'prueba169d'), pg_temp.visita(p, 2, 'prueba169d')
  from (select (select p from _ctl where en_control order by p limit 1) p union all select (select p from _ctl where not en_control order by p limit 1)) x;
insert into _v169 values ('ctl1', pg_temp.caja((select p from _ctl where en_control order by p limit 1), 'prueba169d'));
insert into _v169 values ('ctl2', pg_temp.caja((select p from _ctl where not en_control order by p limit 1), 'prueba169d'));
insert into _r169 (caso, ok, detalle)
select '9 grupo de control: ~15 % (1000 sorteos entre 10 y 20 %) y fijo · en control: sin premio ni reto en «Mi Club», con beneficio base · fuera: gana',
       (select count(*) filter (where public.club_reto_control(((select r from _v169 where k = 'ctl') #>> '{}')::uuid, 15, gen_random_uuid()))
          from generate_series(1, 1000)) between 100 and 200
       and (select bool_and(en_control = public.club_reto_control(((select r from _v169 where k = 'ctl') #>> '{}')::uuid, 15, pg_temp.sid(p))) from _ctl)
       and not public.club_reto_control(((select r from _v169 where k = 'ctl') #>> '{}')::uuid, 0, pg_temp.sid('ctl1'))
       and pg_temp.premio((select r from _v169 where k = 'ctl1')) = 0 and (select r from _v169 where k = 'ctl1')->>'estado' = 'aplica'
       and (pg_temp.g((select p from _ctl where en_control order by p limit 1), 'Reto Ficticio Control')).id is null
       and not exists (select 1 from jsonb_array_elements(pg_temp.portal((select p from _ctl where en_control order by p limit 1))->'retos') x
                        where x->>'nombre' = 'Reto Ficticio Control')
       and exists (select 1 from jsonb_array_elements(pg_temp.portal((select p from _ctl where en_control order by p limit 1))->'retos') x
                    where x->>'nombre' = 'Reto Ficticio Almuerzos')
       and pg_temp.premio((select r from _v169 where k = 'ctl2')) = 1,
       (select count(*) filter (where en_control) || ' de 60 en control' from _ctl);

-- 10. REGLA FIJA: la visita ganadora se paga con créditos → no va en esa factura, queda guardada; en la próxima, sí
select pg_temp.socio('j');
select pg_temp.visita('j', 3); select pg_temp.visita('j', 2);
insert into _v169 values ('j0', to_jsonb(pg_temp.visita('j', 0, 'prueba169a', to_char(now() at time zone 'America/Costa_Rica', 'HH24:MI:SS'), 'paga_con_creditos')));
insert into _v169 values ('j1', pg_temp.como((select owner_id from _c169),
  format('public.club_reto_en_visita(%L::uuid, %L)', (select r #>> '{}' from _v169 where k = 'j0'), 'prueba169a')));
insert into _v169 values ('jp', pg_temp.portal('j'));
insert into _v169 values ('j2', pg_temp.caja('j'));
insert into _r169 (caso, ok, detalle)
select '10 pagada con créditos: gana pero NO va en esa factura (guardada, con aviso) · «Mi Club» la muestra ganada · en la próxima visita se ofrece',
       pg_temp.premio((select r from _v169 where k = 'j1')) = 0
       and (select r->'reto'->>'estado' from _v169 where k = 'j1') = 'guardada'
       and exists (select 1 from _v169, jsonb_array_elements_text(r->'avisos') a where k = 'j1' and a like '%NO va en esta factura%')
       and (select x->>'ganada' from _v169, jsonb_array_elements(r->'retos') x where k = 'jp' and x->>'nombre' = 'Reto Ficticio Almuerzos') = 'true'
       and (select x->>'vence_en' from _v169, jsonb_array_elements(r->'retos') x where k = 'jp' and x->>'nombre' = 'Reto Ficticio Almuerzos') is not null
       and pg_temp.premio((select r from _v169 where k = 'j2')) = 1 and (pg_temp.g('j')).estado = 'usada',
       (select r::text from _v169 where k = 'j1');

-- 11. LOCAL SIN ARTÍCULO: gana en B (sin cortesía) → no se ofrece, avisa, queda · artículo inactivo en C → igual · en A, sí
select pg_temp.socio('k');
select pg_temp.visita('k', 3, 'prueba169b'); select pg_temp.visita('k', 2, 'prueba169b');
insert into _v169 values ('k1', pg_temp.caja('k', 'prueba169b'));
select pg_temp.socio('l');
select pg_temp.visita('l', 3, 'prueba169c'); select pg_temp.visita('l', 2, 'prueba169c');
update public.club_cortesias set activa = false where codigo_producto = 'P169C1';
insert into _v169 values ('l1', pg_temp.caja('l', 'prueba169c'));
update public.club_cortesias set activa = true where codigo_producto = 'P169C1';
update public.club_config_global set socio_visitas_por_dia = 2;
insert into _v169 values ('k2', pg_temp.caja('k', 'prueba169a'));
update public.club_config_global set socio_visitas_por_dia = 1;
insert into _r169 (caso, ok, detalle)
select '11 local sin la cortesía (B) o con el artículo inactivo (C): avisa y NO la ofrece, queda disponible · en A se ofrece con el artículo de A',
       pg_temp.premio((select r from _v169 where k = 'k1')) = 0
       and (select r->'reto'->>'estado' from _v169 where k = 'k1') = 'sin_configurar'
       and exists (select 1 from _v169, jsonb_array_elements_text(r->'avisos') a where k = 'k1' and a like '%NO lo ofrezcas%')
       and pg_temp.premio((select r from _v169 where k = 'l1')) = 0
       and (select r->'reto'->>'estado' from _v169 where k = 'l1') = 'sin_configurar' and (pg_temp.g('l')).estado = 'disponible'
       and pg_temp.premio((select r from _v169 where k = 'k2')) = 1 and (pg_temp.g('k')).location_id = 'prueba169a'
       and (pg_temp.g('k')).cortesia->>'codigo' = 'P169A1',
       (select r::text from _v169 where k = 'k1');

-- 12. VENCIDA: el premio guardado vence → no se ofrece, pasa a 'vencida' (auditado) y «Mi Club» ya no lo muestra
update public.club_retos_ganados set vence_en = now() - interval '1 minute' where miembro_id = pg_temp.sid('l');
update public.club_config_global set socio_visitas_por_dia = 2;
insert into _v169 values ('l2', pg_temp.caja('l', 'prueba169a'));
update public.club_config_global set socio_visitas_por_dia = 1;
insert into _r169 (caso, ok, detalle)
select '12 vencido → no se ofrece · estado vencida con auditoría · «Mi Club» no lo muestra',
       pg_temp.premio((select r from _v169 where k = 'l2')) = 0 and (pg_temp.g('l')).estado = 'vencida'
       and exists (select 1 from public.club_auditoria au where au.objeto_id = (pg_temp.g('l')).id and au.accion = 'reto_vencido')
       and not exists (select 1 from jsonb_array_elements(pg_temp.portal('l')->'retos') x where x->>'ganada' = 'true'),
       (select r::text from _v169 where k = 'l2');

-- 13. PORTAL (anon, solo por club-web): {retos} con avance; sin portón o token malo → «Enlace no válido»; tablas cerradas
select pg_temp.socio('b');
select pg_temp.visita('b', 3);
do $$
declare v jsonb; v_sin boolean := false; v_mal boolean := false; v_tab boolean := false;
        v_tok text := (select token_portal from public.club_miembros where id = pg_temp.sid('b'));
        v_c jsonb; v_a jsonb; v_tok_c text := (select token_portal from public.club_miembros where id = pg_temp.sid('c'));
begin
  set local role anon;
  v := public.club_portal_retos(v_tok);
  v_c := public.club_portal_retos(v_tok_c);
  begin perform public.club_portal_retos(repeat('0', 64)); exception when others then v_mal := sqlerrm = 'Enlace no válido'; end;
  begin perform 1 from public.club_retos_ganados limit 1; exception when insufficient_privilege then v_tab := true; end;
  perform set_config('request.headers', '{}', true);
  begin perform public.club_portal_retos(v_tok);
  exception when others then v_sin := sqlerrm = 'Enlace no válido'; end;
  reset role;
  perform set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-169-0123456789abcdef"}', true);
  v_a := (select x from jsonb_array_elements(v->'retos') x where x->>'nombre' = 'Reto Ficticio Almuerzos');
  insert into _r169 (caso, ok, detalle) values ('13 portal: anon con portón ve el reto (1 de 3, ES/EN, franja, locales) · el usado no se muestra · sin portón y token malo → Enlace no válido · tabla cerrada',
    v_a->>'avance' = '1' and v_a->>'meta' = '3'
    and v_a->>'ganada' = 'false' and v_a->>'nombre_en' = 'Reto Ficticio Almuerzos EN'
    and jsonb_array_length(v_a->'locales') = 3 and v_a ? 'hora_desde'
    and not exists (select 1 from jsonb_array_elements(v_c->'retos') x where x->>'nombre' = 'Reto Ficticio Almuerzos') and v_sin and v_mal and v_tab,
    v::text || ' · c ' || v_c::text || ' sin ' || v_sin || ' mal ' || v_mal || ' tab ' || v_tab);
exception when others then
  reset role;
  perform set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-169-0123456789abcdef"}', true);
  insert into _r169 (caso, ok, detalle) values ('13 portal', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 14. GERENCIA: solo el owner guarda/arma/termina; nada en el pasado; cortesía de cada local, activa y de ese local
do $$
declare
  o uuid := (select owner_id from _c169); s uuid := (select sin_rol from _c169);
  v_hoy date := (select hoy from _c169);
  d jsonb := jsonb_build_object('nombre', 'Reto Ficticio Gerencia', 'nombre_en', 'Ficticious Challenge', 'locales', jsonb_build_array('prueba169a', 'prueba169b'),
                                'desde', '2032-05-01', 'hasta', '2032-05-31', 'dias', jsonb_build_array(1,2,3,4,5),
                                'hora_desde', '11:30', 'hora_hasta', '15:00', 'meta', 3, 'vence_dias', 30, 'control_pct', 15,
                                'cortesias', jsonb_build_object('prueba169a', pg_temp.k('P169A1')));
  v_id uuid; e_pas text; e_rol text; e_arm text; e_ina text; e_otro text; e_lis text; e_dat text; v_l jsonb; v_aud int;
begin
  e_pas := pg_temp.error_de(format('select pg_temp.como(%L, %L)', o,
             format('public.club_reto_guardar(null, %L::jsonb)', d || jsonb_build_object('desde', v_hoy - 1, 'hasta', v_hoy + 5))));
  e_rol := pg_temp.error_de(format('select pg_temp.como(%L, %L)', s, format('public.club_reto_guardar(null, %L::jsonb)', d)));
  e_lis := pg_temp.error_de(format('select pg_temp.como(%L, %L)', s, 'public.club_retos_listar()'));
  e_dat := pg_temp.error_de(format('select pg_temp.como(%L, %L)', o, format('public.club_reto_guardar(null, %L::jsonb)', d || '{"meta": 50}')));
  update public.club_cortesias set activa = false where codigo_producto = 'P169A2';
  e_ina := pg_temp.error_de(format('select pg_temp.como(%L, %L)', o, format('public.club_reto_guardar(null, %L::jsonb)',
             d || jsonb_build_object('cortesias', jsonb_build_object('prueba169a', pg_temp.k('P169A2'))))));
  e_otro := pg_temp.error_de(format('select pg_temp.como(%L, %L)', o, format('public.club_reto_guardar(null, %L::jsonb)',
             d || jsonb_build_object('cortesias', jsonb_build_object('prueba169a', pg_temp.k('P169C1'))))));
  v_id := (pg_temp.como(o, format('public.club_reto_guardar(null, %L::jsonb)', d)) #>> '{}')::uuid;
  e_arm := pg_temp.error_de(format('select pg_temp.como(%L, %L)', o, format('public.club_reto_armar(%L::uuid)', v_id)));
  perform pg_temp.como(o, format('public.club_reto_guardar(%L::uuid, %L::jsonb)', v_id, d || '{"locales": ["prueba169a"]}'));
  perform pg_temp.como(o, format('public.club_reto_armar(%L::uuid)', v_id));
  v_l := (select x from jsonb_array_elements(pg_temp.como(o, 'public.club_retos_listar()')->'retos') x where x->>'id' = v_id::text);
  perform pg_temp.como(o, format('public.club_reto_terminar(%L::uuid)', v_id));
  select count(*) into v_aud from public.club_auditoria a where a.objeto_id = v_id and a.accion in ('reto_alta','reto_edicion','reto_armado','reto_terminado');
  insert into _r169 (caso, ok, detalle) values ('14 gerencia: en el pasado → error · sin rol → 42501 (guardar y listar) · datos fuera de rango → error claro · cortesía inactiva u otro local → error · armar sin cortesía de cada local → error · armar/terminar con auditoría',
    e_pas like 'El reto no puede empezar en el pasado%' and e_rol = 'Sin permiso' and e_lis = 'Sin permiso'
    and e_dat like 'Revisá los datos del reto%'
    and e_ina like 'La cortesía «Bebida Ficticia A» está inactiva%' and e_otro like 'Esa cortesía no es de ese local%'
    and e_arm like 'Para armarlo, elegí la cortesía de premio de cada local%'
    and v_l->>'estado' = 'vigente' and (v_l->>'armado')::boolean and v_l->>'control_pct' = '15'
    and v_l->'cortesias'->'prueba169a'->>'codigo' = 'P169A1'
    and (select estado from public.club_retos where id = v_id) = 'terminada' and v_aud = 4,
    concat_ws(' | ', e_pas, e_rol, e_lis, e_dat, e_ina, e_otro, e_arm, v_l::text, v_aud::text));
exception when others then
  insert into _r169 (caso, ok, detalle) values ('14 gerencia', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 15. CONVIVENCIA CON LA 168: la 169 no toca club_socio_visita (md5 igual). Con la 168 aplicada, la visita que gana la
--     bienvenida (4.ª) y el reto (3.ª) lleva LAS DOS cortesías (primeros_90 y reto) y el reescaneo muestra las dos.
do $$
declare r jsonb; r2 jsonb; v_op uuid; v_con boolean := (select con_168 from _p169);
begin
  if v_con then
    execute format('update public.club_config set primeros90_cortesia_id = %L where location_id = %L', pg_temp.k('P169A2'), 'prueba169a');
    update public.club_cortesias set activa = true where codigo_producto = 'P169A2';
    execute 'update public.club_config_global set primeros90_activo = true';
    perform pg_temp.socio('m');
    perform pg_temp.visita('m', 3); perform pg_temp.visita('m', 2);
    r := pg_temp.caja('m');
    v_op := (select client_op_id from public.club_visitas_socio where id = (r->>'visita_id')::uuid);
    r2 := pg_temp.caja('m', 'prueba169a', v_op);
    execute 'update public.club_config_global set primeros90_activo = false';   -- los casos siguientes, sin bienvenida nueva
  end if;
  insert into _r169 (caso, ok, detalle) values ('15 convivencia: club_socio_visita igual que antes (md5) · con la 168: la visita que gana las dos lleva la bienvenida y el reto queda guardado (una cortesía de premio por visita), igual en el reescaneo',
    md5(pg_get_functiondef('public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure)) = (select md5_visita from _p169)
    and (not v_con or (pg_temp.premio(r) = 0
         and (select count(*) from jsonb_array_elements(r->'cortesias') x where x->>'motivo' = 'primeros_90') = 1
         and r->'primeros90'->>'estado' = 'ofrecida' and r->'reto'->>'estado' = 'guardada'
         and pg_temp.premio(r2) = 0 and (r2->>'repetida')::boolean and r2->'reto'->>'estado' = 'guardada'
         and (pg_temp.g('m')).estado = 'disponible')),
    'con 168: ' || v_con || ' · ' || coalesce(r::text, ''));
exception when others then
  insert into _r169 (caso, ok, detalle) values ('15 convivencia', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 17. OPCIÓN B: tres escaneos en tres días SIN factura (pedidos que nunca se cobraron) no ganan; la de hoy cuenta por
--     presencia (avance 1). Con retos_exige_factura = false, los mismos días cuentan. Por defecto, prendida.
select pg_temp.socio('n');
select pg_temp.visita('n', 3, 'prueba169a', '13:00', 'aplica', false); select pg_temp.visita('n', 2, 'prueba169a', '13:00', 'aplica', false);
insert into _v169 values ('n1', pg_temp.caja('n'));
insert into _v169 values ('n0', to_jsonb(public.club_reto_avance((select r from public.club_retos r where r.nombre = 'Reto Ficticio Almuerzos'), pg_temp.sid('n'), (select hoy from _c169))));
update public.club_config_global set retos_exige_factura = false;
insert into _v169 values ('n2', to_jsonb(public.club_reto_avance((select r from public.club_retos r where r.nombre = 'Reto Ficticio Almuerzos'), pg_temp.sid('n'), (select hoy from _c169))));
update public.club_config_global set retos_exige_factura = true;
insert into _r169 (caso, ok, detalle)
select '17 opción B: 3 escaneos sin factura no ganan (avance 1: solo la de hoy por presencia) · sin la exigencia, 3 · prendida por defecto',
       pg_temp.premio((select r from _v169 where k = 'n1')) = 0 and (pg_temp.g('n')).id is null
       and (select r from _v169 where k = 'n0') = '1'::jsonb and (select r from _v169 where k = 'n2') = '3'::jsonb
       and (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
             where d.adrelid = 'public.club_config_global'::regclass and a.attname = 'retos_exige_factura') = 'true',
       'n0 ' || (select r::text from _v169 where k = 'n0') || ' n2 ' || (select r::text from _v169 where k = 'n2');

-- 18. VENCIMIENTO al final del día CR mostrado: ganado hoy con 30 días → límite 00:00 CR de hoy + 31; «Mi Club» dice hoy + 30
insert into _r169 (caso, ok, detalle)
select '18 vence al final del día CR mostrado (00:00 CR del día siguiente) · «Mi Club» muestra ese último día',
       (pg_temp.g('j')).vence_en = (((select hoy from _c169) + 31)::timestamp at time zone 'America/Costa_Rica')
       and (pg_temp.g('k')).vence_en = (((select hoy from _c169) + 31)::timestamp at time zone 'America/Costa_Rica')
       and (select (x->>'vence_en')::date from _v169, jsonb_array_elements(r->'retos') x
             where k = 'jp' and x->>'nombre' = 'Reto Ficticio Almuerzos') = (select hoy from _c169) + 30,
       (pg_temp.g('j')).vence_en::text;

-- 19. JORNADA: en una franja que cruza la medianoche (22:00–02:00), una noche cuenta UNA vez (la 01:00 es de la jornada
--     anterior); otra noche suma
select pg_temp.socio('p');
insert into _v169 values ('noc', to_jsonb(pg_temp.reto('Reto Ficticio Noche', '{prueba169e}', (select desde from _c169), (select hasta from _c169),
                                                     false, 3, '{}', 0, '22:00', '02:00')));
select pg_temp.visita('p', 3, 'prueba169e', '23:00'); select pg_temp.visita('p', 2, 'prueba169e', '01:00');
select pg_temp.visita('p', 2, 'prueba169e', '23:30');
insert into _r169 (caso, ok, detalle)
select '19 jornada: vie 23:00 + sáb 01:00 = 1 noche · otra noche = 2 · la 01:30 del sábado es jornada del viernes',
       public.club_reto_avance(r, pg_temp.sid('p'), (select hoy from _c169)) = 2
       and public.club_reto_jornada(r, timestamptz '2026-12-05 07:30:00+00') = date '2026-12-04'
       and public.club_reto_jornada(r, timestamptz '2026-12-05 05:00:00+00') = date '2026-12-04',
       'avance p = ' || public.club_reto_avance(r, pg_temp.sid('p'), (select hoy from _c169))
  from public.club_retos r where r.nombre = 'Reto Ficticio Noche';

-- 20. UNA CORTESÍA DE PREMIO POR VISITA: la visita ganadora ya lleva el premio por referir → el reto NO va ahí (guardado,
--     con aviso); en la próxima visita, sí
select pg_temp.socio('q');
select pg_temp.visita('q', 3); select pg_temp.visita('q', 2);
insert into _v169 values ('q0', to_jsonb(pg_temp.visita('q', 0, 'prueba169a', to_char(now() at time zone 'America/Costa_Rica', 'HH24:MI:SS'), 'aplica', true,
                                                     '[{"id":"x","codigo":"P169A2","nombre":"Bebida Ficticia A","motivo":"premio_referido"}]')));
insert into _v169 values ('q1', pg_temp.como((select owner_id from _c169),
  format('public.club_reto_en_visita(%L::uuid, %L)', (select r #>> '{}' from _v169 where k = 'q0'), 'prueba169a')));
update public.club_config_global set socio_visitas_por_dia = 3;
insert into _v169 values ('q2', pg_temp.caja('q'));
update public.club_config_global set socio_visitas_por_dia = 1;
insert into _r169 (caso, ok, detalle)
select '20 una cortesía de premio por visita: con el premio por referir ya en la factura, el del reto queda guardado (aviso) · en la próxima, se ofrece',
       pg_temp.premio((select r from _v169 where k = 'q1')) = 0
       and (select r->'reto'->>'estado' from _v169 where k = 'q1') = 'guardada'
       and exists (select 1 from _v169, jsonb_array_elements_text(r->'avisos') a where k = 'q1' and a like '%ya lleva otra cortesía de premio%')
       and pg_temp.premio((select r from _v169 where k = 'q2')) = 1 and (pg_temp.g('q')).estado = 'usada',
       (select r::text from _v169 where k = 'q1');

-- 21. LOCAL SIN PoS (como Nosara): con la exigencia prendida, armar un reto ahí → error claro; apagada, entra
do $$
declare e text[] := '{}';
begin
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio Sin PoS', '{prueba169a,prueba169f}', '2033-03-01', '2033-03-31')$q$);
  e := e || pg_temp.error_de($q$select pg_temp.reto('Reto Ficticio Sin PoS B', '{prueba169f}', '2033-03-01', '2033-03-31', false)$q$);
  update public.club_config_global set retos_exige_factura = false;
  e := e || pg_temp.error_de($q$update public.club_retos set estado = 'vigente', armado_en = now() where nombre = 'Reto Ficticio Sin PoS B'$q$);
  update public.club_config_global set retos_exige_factura = true;
  insert into _r169 (caso, ok, detalle) values ('21 local sin facturas del PoS: armar con la exigencia prendida → error («no tiene facturas del PoS») · en borrador entra · sin la exigencia se arma',
    coalesce(e[1], '') like 'El local «Local Ficticio F» no tiene facturas del PoS%' and e[2] is null and e[3] is null,
    array_to_string(e, ' | ', '·'));
end $$;

-- 16a. ROLLBACK con premios ganados → la guarda aborta
do $$
declare v_aborta boolean := false;
begin
  begin
    -- @@169G@@   (aquí va la guarda de 169_rollback.sql)
  exception when others then v_aborta := sqlerrm like '169 rollback: hay premios%'; end;
  insert into _r169 (caso, ok, detalle) values ('16a rollback con premios ganados → aborta', v_aborta, null);
end $$;

-- 16b. ROLLBACK sin premios: sin tablas, funciones ni trigger de la 169; club_socio_visita igual; la caja sigue
delete from public.club_retos_ganados;
drop function pg_temp.g(text, text);   -- dependen del tipo de las tablas
drop function pg_temp.reto(text, text[], date, date, boolean, int, jsonb, int, time, time, int[]);
-- @@169R@@   (aquí va el cuerpo de 169_rollback.sql sin begin/commit)
insert into _r169 (caso, ok, detalle)
select '16b rollback: sin tablas, funciones ni trigger de la 169 · club_socio_visita igual (md5) y con permiso · la caja registra',
       md5(pg_get_functiondef('public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure)) = p.md5_visita
       and has_function_privilege('authenticated', 'public.club_socio_visita(uuid,jsonb,uuid,text)', 'EXECUTE')
       and to_regclass('public.club_retos') is null and to_regclass('public.club_retos_ganados') is null
       and to_regprocedure('public.club_reto_en_visita(uuid,text)') is null and to_regprocedure('public.club_portal_retos(text)') is null
       and not exists (select 1 from pg_proc where proname like 'club_reto%' and pronamespace = 'public'::regnamespace)
       and not exists (select 1 from pg_trigger where tgname in ('club_retos_visita_trg', 'club_retos_reglas_trg'))
       and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_config_global'
                         and column_name = 'retos_exige_factura')
       and pg_temp.visita('b', 1) is not null,
       null
  from _p169 p;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r169;

-- ASSERT: si algún caso falla, la transacción aborta y dice cuáles
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r169 where ok is not true;   -- null = falla
  if v is not null then raise exception '169-FALLAN: %', v; end if;
  if (select count(*) from _r169) <> 24 then raise exception '169-FALLAN: se esperaban 24 casos (NO PROBADO)'; end if;
end $$;
rollback;
