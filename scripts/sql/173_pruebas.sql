-- 173_pruebas (origen club 119) · Aplica la 173 dentro de una transacción, prueba y termina en ROLLBACK: no deja nada.
-- Corre sobre una base con la 159 y la 170 (staging, o el Postgres 16 local armado con las migraciones del árbol; con o
-- sin la 172). Devuelve un JSON con cada caso y ok, y al final un ASSERT: cada caso caído sale como WARNING, un resumen
-- «pasaron X / fallaron Y» y, si algún caso falla, aborta con
-- «173-FALLAN: <casos>». Se corre con scripts/sql/173_pruebas.py (o con el SQL armado: 173_pruebas.py --armar).
--
-- MARCADORES que llena el runner: «-- @@173@@ …» → el cuerpo de supabase/migrations/173_… sin begin/commit ni su bloque
-- de verificación (con --mutar, con el arreglo deshecho a propósito); «-- @@173R@@ …» → el cuerpo del rollback (caso 18).
-- Locales FICTICIOS que crea adentro: prueba173a y prueba173b (Club encendido). Un owner ACTIVO de la base (en local lo
-- crea --semilla-local), un manager de prueba173a y otro de prueba173b y un cajero, todos ficticios y creados adentro.
-- Socios con nombres ficticios; WhatsApp ficticios (+1 555 01xx, rango reservado para ficción).
-- Las fechas de la ventana y de la marca «enviado» se prueban con días fijos (cruzando el fin de año) en las funciones
-- internas (club_cumple_lista / _marcar / _en_caja_dia con p_hoy); las públicas, por permisos y forma.
begin;
-- @@173@@   (aquí va el cuerpo de la 173 sin begin/commit)
create temp table _r173 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r173 to anon, authenticated;
grant usage on sequence _r173_n_seq to anon, authenticated;

create temp table _c173 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8173-0000000000a1'::uuid as manager_a,
       '00000000-0000-4000-8173-0000000000b1'::uuid as manager_b,
       '00000000-0000-4000-8173-0000000000c1'::uuid as cajero;
grant select on _c173 to anon, authenticated;

insert into public.locations (id, name) values ('prueba173a', 'Local Ficticio A'), ('prueba173b', 'Local Ficticio B')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba173a', 'Local Ficticio A', true), ('prueba173b', 'Local Ficticio B', true);
insert into public.club_cortesias (location_id, codigo_producto, nombre) values
  ('prueba173a', 'P173A1', 'Postre Ficticio A'), ('prueba173b', 'P173B1', 'Postre Ficticio B');
insert into public.club_cortesias (location_id, codigo_producto, nombre, activa) values ('prueba173a', 'P173A2', 'Apagada Ficticia', false);
update public.club_config_global set club_url = coalesce(club_url, 'https://club.ejemplo.test');

-- personal ficticio (el owner de la base los activa; profiles_guarda_roles pide JWT de un owner activo)
insert into auth.users (id, raw_user_meta_data) values
  ((select manager_a from _c173), '{"full_name":"Manager Ficticio A"}'),
  ((select manager_b from _c173), '{"full_name":"Manager Ficticio B"}'),
  ((select cajero from _c173), '{"full_name":"Cajero Ficticio"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c173), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager', is_active = true where id in ((select manager_a from _c173), (select manager_b from _c173));
update public.profiles set role = 'cajero', is_active = true where id = (select cajero from _c173);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values
  ((select manager_a from _c173), 'prueba173a', true), ((select manager_b from _c173), 'prueba173b', true);

select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-173-0123456789abcdef', 'sha256'), 'hex'));
create function pg_temp.web(p_on boolean) returns void language sql as $f$
  select set_config('request.headers', case when p_on then '{"x-club-web":"clave-de-prueba-del-club-173-0123456789abcdef"}' else '' end, true) $f$;

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
create function pg_temp.error_de(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $f$;
create function pg_temp.err_como(p_uid uuid, p_sql text) returns text language sql as $f$
  select pg_temp.error_de(format('select pg_temp.como(%L::uuid, %L)', p_uid, p_sql)) $f$;
create function pg_temp.tel(n int) returns text language sql immutable as $f$ select '+1555010' || lpad(n::text, 4, '0') $f$;
-- alta en caja (v3) como el cajero
create function pg_temp.alta(n int, p_dia int, p_mes int, p_perm boolean, p_loc text default 'prueba173a') returns jsonb language sql as $f$
  select pg_temp.como((select cajero from _c173), format(
    'public.club_socio_alta_caja_v3(%L, %L, null, true, true, %s, %s, %s, %L)',
    'Socio Ficticio ' || n, pg_temp.tel(n), coalesce(p_dia::text, 'null'), coalesce(p_mes::text, 'null'),
    coalesce(p_perm::text, 'null'), p_loc)) $f$;
create function pg_temp.mid(n int) returns uuid language sql stable as $f$
  select public.club_miembro_por_telefono(pg_temp.tel(n)) $f$;
create function pg_temp.cto(n int) returns public.club_miembros_contacto language sql stable as $f$
  select * from public.club_miembros_contacto where miembro_id = pg_temp.mid(n) $f$;
create function pg_temp.tok(n int) returns text language sql stable as $f$
  select token_portal from public.club_miembros where id = pg_temp.mid(n) $f$;
-- «viejo»: la fila de contacto no nació en esta transacción (como un socio de ayer)
create function pg_temp.viejo(n int) returns void language sql as $f$
  update public.club_miembros_contacto set created_at = now() - interval '2 days' where miembro_id = pg_temp.mid(n) $f$;
create function pg_temp.cfg(p_loc text, p_activo boolean, p_extra jsonb default '{}') returns jsonb language sql as $f$
  select pg_temp.como((select owner_id from _c173), format('public.club_cumple_config_guardar(%L::jsonb, %L)',
    jsonb_build_object('activo', p_activo, 'beneficio', 'postre de cortesía', 'min_personas', 5, 'dias_antes', 7,
                       'dias_despues', 7, 'uno_por_mesa', true, 'solo_reserva', true,
                       'reserva_url', 'https://reservas.ejemplo.test/r?rid=1',
                       'cortesia_id', (select id from public.club_cortesias where codigo_producto = 'P173' || upper(right(p_loc, 1)) || '1'))
    || p_extra, p_loc)) $f$;

-- 00. hay owner activo y el personal ficticio quedó con su rol
insert into _r173 (caso, ok, detalle)
select '00 hay un owner activo y el manager/cajero ficticios',
       c.owner_id is not null
       and (select count(*) from public.profiles p where p.id in (c.manager_a, c.manager_b) and p.role::text = 'manager' and p.is_active) = 2
       and exists (select 1 from public.profiles p where p.id = c.cajero and p.role::text = 'cajero' and p.is_active),
       'owner ' || coalesce(c.owner_id::text, 'NINGUNO')
  from _c173 c;

-- 01. alta en caja CON permiso → guardado (día y mes, permiso con fecha); respuesta «guardado»
do $$ declare r jsonb; c public.club_miembros_contacto;
begin
  r := pg_temp.alta(1, 12, 3, true); c := pg_temp.cto(1);
  insert into _r173 (caso, ok, detalle) values ('01 alta en caja con permiso → cumpleaños guardado',
    r->>'cumple' = 'guardado' and c.cumple_dia = 12 and c.cumple_mes = 3 and c.cumple_permiso_en is not null and c.cumple_portal_en is null,
    r::text);
exception when others then
  insert into _r173 (caso, ok, detalle) values ('01 (error sin atrapar)', false, sqlerrm);
end $$;

-- 02. alta en caja SIN cumpleaños → nada guardado; «no_dio»
do $$ declare r jsonb; c public.club_miembros_contacto;
begin
  r := pg_temp.alta(2, null, null, false); c := pg_temp.cto(2);
  insert into _r173 (caso, ok, detalle) values ('02 alta en caja sin cumpleaños → nada guardado',
    r->>'cumple' = 'no_dio' and c.cumple_dia is null and c.cumple_permiso_en is null, r::text);
exception when others then
  insert into _r173 (caso, ok, detalle) values ('02 (error sin atrapar)', false, sqlerrm);
end $$;

-- 03. día y mes SIN el permiso → error y NO hay alta (se valida antes); permiso sin fecha y 31/4 → error
insert into _r173 (caso, ok, detalle)
select '03 cumpleaños sin permiso (o permiso sin fecha, o fecha que no existe) → error y sin alta',
       e1 like 'Para guardar el cumpleaños marcá que dio permiso%' and pg_temp.mid(3) is null
       and e2 like 'Marcaste el permiso del cumpleaños pero falta%' and pg_temp.mid(4) is null
       and e3 like 'Cumpleaños no válido%' and pg_temp.mid(5) is null,
       concat_ws(' | ', e1, e2, e3)
  from (select pg_temp.error_de('select pg_temp.alta(3, 12, 3, false)') e1,
               pg_temp.error_de('select pg_temp.alta(4, null, null, true)') e2,
               pg_temp.error_de('select pg_temp.alta(5, 31, 4, true)') e3) x;

-- 04. persona que ya existía y lo tenía (un referente al que el owner se lo cargó por pedido) y ahora se da de alta como
--     socio en caja → «ya_tenia», el dato no cambia
do $$ declare v uuid; v2 uuid; r jsonb; r2 jsonb; c public.club_miembros_contacto;
begin
  insert into public.club_miembros (location_id, tipo, nombre) values ('prueba173a', 'referente', 'Referente Ficticio Seis') returning id into v;
  insert into public.club_miembros_contacto (miembro_id, location_id, telefono) values (v, 'prueba173a', pg_temp.tel(6));
  insert into public.club_miembro_roles (miembro_id, rol, estado) values (v, 'referente', 'activo') on conflict do nothing;
  perform pg_temp.como((select owner_id from _c173), format('public.club_socio_cumple_corregir(%L::uuid, 5, 6, %L)', v, 'lo pidió por escrito'));
  r := pg_temp.alta(6, 20, 8, true); c := pg_temp.cto(6);
  -- y quien ya existía de antes SIN cumpleaños (contacto viejo): la caja sí lo carga (con la marca de la función)
  insert into public.club_miembros (location_id, tipo, nombre) values ('prueba173a', 'referente', 'Referente Ficticio Trece') returning id into v2;
  insert into public.club_miembros_contacto (miembro_id, location_id, telefono, created_at) values (v2, 'prueba173a', pg_temp.tel(13), now() - interval '30 days');
  insert into public.club_miembro_roles (miembro_id, rol, estado) values (v2, 'referente', 'activo') on conflict do nothing;
  r2 := pg_temp.alta(13, 9, 9, true);
  insert into _r173 (caso, ok, detalle) values ('04 alta en caja de quien ya existía: lo tenía → «ya_tenia» (no cambia); no lo tenía → «guardado»',
    pg_temp.mid(6) = v and r->>'cumple' = 'ya_tenia' and c.cumple_dia = 5 and c.cumple_mes = 6
    and pg_temp.mid(13) = v2 and r2->>'cumple' = 'guardado' and (pg_temp.cto(13)).cumple_dia = 9, concat_ws(' | ', r, r2));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('04 (error sin atrapar)', false, sqlerrm);
end $$;

-- 05. GUARDIA: cargarlo a un contacto viejo sin la marca de la función → rechazado (aun como el dueño de las funciones);
--     cambiarlo después de cargado, también; borrarlo, siempre se puede; el owner lo corrige
do $$ declare e1 text; e2 text; e3 text; e4 text; c public.club_miembros_contacto;
begin
  perform pg_temp.viejo(2);
  e1 := pg_temp.error_de(format('update public.club_miembros_contacto set cumple_dia = 1, cumple_mes = 1, cumple_permiso_en = now() where miembro_id = %L', pg_temp.mid(2)));
  perform pg_temp.viejo(1);
  e2 := pg_temp.error_de(format('update public.club_miembros_contacto set cumple_dia = 2 where miembro_id = %L', pg_temp.mid(1)));
  -- con la marca de la caja tampoco se CAMBIA uno cargado (la marca solo sirve para el que no lo tiene)
  perform set_config('club.cumple_carga', 'alta_caja', true);
  e3 := pg_temp.error_de(format('update public.club_miembros_contacto set cumple_dia = 2 where miembro_id = %L', pg_temp.mid(1)));
  perform set_config('club.cumple_carga', '', true);
  -- la app (authenticated) no puede escribir la tabla directo
  e4 := pg_temp.err_como((select manager_a from _c173),
          format('(select count(*) from (update public.club_miembros_contacto set cumple_dia = 1, cumple_mes = 1, cumple_permiso_en = now() where miembro_id = %L returning 1) u)', pg_temp.mid(2)));
  c := pg_temp.cto(2);
  insert into _r173 (caso, ok, detalle) values ('05 guardia: sin la marca no se carga; cargado no se cambia; la app no escribe directo',
    e1 like 'El cumpleaños no se cambia después del alta%' and e2 like 'El cumpleaños no se cambia después del alta%'
    and e3 like 'El cumpleaños no se cambia después del alta%' and e4 is not null and c.cumple_dia is null,
    concat_ws(' | ', e1, e2, e3, e4));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('05 (error sin atrapar)', false, sqlerrm);
end $$;

-- 06. PORTAL: quien no lo dio ve «puede agregar», lo agrega (con marca del portal) y después ya no puede
do $$ declare a jsonb; r jsonb; b jsonb; c public.club_miembros_contacto;
begin
  perform pg_temp.web(true);
  a := public.club_portal_cumple(pg_temp.tok(2));
  r := public.club_portal_cumple_agregar(pg_temp.tok(2), 29, 2, true);
  b := public.club_portal_cumple(pg_temp.tok(2));
  c := pg_temp.cto(2);
  insert into _r173 (caso, ok, detalle) values ('06 portal: lo agrega una vez (29-feb vale) y el estado no trae la fecha',
    a = '{"socio": true, "tiene": false, "puede_agregar": true}'::jsonb and r = '{"ok": true}'::jsonb
    and b = '{"socio": true, "tiene": true, "puede_agregar": false}'::jsonb
    and c.cumple_dia = 29 and c.cumple_mes = 2 and c.cumple_portal_en is not null and c.cumple_permiso_en is not null
    and exists (select 1 from public.club_auditoria x where x.accion = 'cumple_portal' and x.objeto_id = pg_temp.mid(2)),
    concat_ws(' | ', a, r, b));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('06 (error sin atrapar)', false, sqlerrm);
end $$;

-- 07. PORTAL, segunda vez → rechazada; aunque el owner se lo borre, el portal no deja volver a cargarlo
do $$ declare e1 text; e2 text; c public.club_miembros_contacto;
begin
  perform pg_temp.web(true);
  e1 := pg_temp.error_de(format('select public.club_portal_cumple_agregar(%L, 1, 1, true)', pg_temp.tok(2)));
  perform pg_temp.como((select owner_id from _c173), format('public.club_socio_cumple_corregir(%L::uuid, null, null, %L)', pg_temp.mid(2), 'lo pidió por escrito'));
  e2 := pg_temp.error_de(format('select public.club_portal_cumple_agregar(%L, 1, 1, true)', pg_temp.tok(2)));
  c := pg_temp.cto(2);
  insert into _r173 (caso, ok, detalle) values ('07 portal segunda vez → «ya cargado» (también después de que el owner lo borra)',
    e1 = 'Cumpleaños ya cargado' and e2 = 'Cumpleaños ya cargado' and c.cumple_dia is null and c.cumple_portal_en is not null,
    concat_ws(' | ', e1, e2));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('07 (error sin atrapar)', false, sqlerrm);
end $$;

-- 08. PORTAL: quien lo dio en el alta no lo agrega; sin portón, sin permiso o fecha mala → rechazado; anfitrión sin socio → no
do $$ declare e1 text; e2 text; e3 text; e4 text; e5 text; v uuid; a jsonb;
begin
  perform pg_temp.web(true);
  e1 := pg_temp.error_de(format('select public.club_portal_cumple_agregar(%L, 1, 1, true)', pg_temp.tok(1)));
  perform pg_temp.alta(7, null, null, false);
  e2 := pg_temp.error_de(format('select public.club_portal_cumple_agregar(%L, 1, 1, false)', pg_temp.tok(7)));
  e3 := pg_temp.error_de(format('select public.club_portal_cumple_agregar(%L, 31, 4, true)', pg_temp.tok(7)));
  perform pg_temp.web(false);
  e4 := pg_temp.error_de(format('select public.club_portal_cumple_agregar(%L, 1, 1, true)', pg_temp.tok(7)));
  perform pg_temp.web(true);
  insert into public.club_miembros (location_id, tipo, nombre) values ('prueba173a', 'referente', 'Referente Ficticio') returning id into v;
  insert into public.club_miembros_contacto (miembro_id, location_id) values (v, 'prueba173a');
  e5 := pg_temp.error_de(format('select public.club_portal_cumple_agregar(%L, 1, 1, true)', (select token_portal from public.club_miembros where id = v)));
  a := public.club_portal_cumple((select token_portal from public.club_miembros where id = v));
  insert into _r173 (caso, ok, detalle) values ('08 portal: ya lo dio · sin permiso · 31/4 · sin x-club-web · no socio → rechazado',
    e1 = 'Cumpleaños ya cargado' and e2 = 'Datos no válidos' and e3 = 'Datos no válidos' and e4 = 'Enlace no válido'
    and e5 = 'Enlace no válido' and (a->>'puede_agregar')::boolean = false and (pg_temp.cto(7)).cumple_dia is null,
    concat_ws(' | ', e1, e2, e3, e4, e5, a));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('08 (error sin atrapar)', false, sqlerrm);
end $$;

-- 09. La marca del portal no se toca a mano (ni ponerla ni borrarla), ni con la marca de la caja
do $$ declare e1 text; e2 text;
begin
  e1 := pg_temp.error_de(format('update public.club_miembros_contacto set cumple_portal_en = null where miembro_id = %L', pg_temp.mid(2)));
  perform set_config('club.cumple_carga', 'alta_caja', true);
  e2 := pg_temp.error_de(format('update public.club_miembros_contacto set cumple_portal_en = now() where miembro_id = %L', pg_temp.mid(7)));
  perform set_config('club.cumple_carga', '', true);
  insert into _r173 (caso, ok, detalle) values ('09 la marca «agregado desde el portal» no se borra ni se pone a mano',
    e1 like 'La marca del cumpleaños del portal%' and e2 like 'La marca del cumpleaños del portal%', concat_ws(' | ', e1, e2));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('09 (error sin atrapar)', false, sqlerrm);
end $$;

-- 10. Fechas cruzando el fin de año y el 29-feb
do $$
begin
  insert into _r173 (caso, ok, detalle)
  select '10 ventana y próximo cumpleaños cruzando el fin de año; 29-feb en año no bisiesto = 28-feb',
         public.club_cumple_en_ventana(30, 12, date '2027-01-03', 7, 7) = date '2026-12-30'
         and public.club_cumple_en_ventana(2, 1, date '2026-12-28', 7, 7) = date '2027-01-02'
         and public.club_cumple_en_ventana(2, 1, date '2026-12-24', 7, 7) is null
         and public.club_cumple_en_ventana(30, 12, date '2027-01-07', 7, 7) is null
         and public.club_cumple_en_ventana(30, 12, date '2027-01-06', 7, 7) = date '2026-12-30'
         and public.club_cumple_en_ventana(15, 6, date '2027-06-15', 0, 0) = date '2027-06-15'
         and public.club_cumple_proximo(2, 1, date '2026-12-28') = date '2027-01-02'
         and public.club_cumple_proximo(28, 12, date '2026-12-28') = date '2026-12-28'
         and public.club_cumple_proximo(29, 2, date '2027-01-10') = date '2027-02-28'
         and public.club_cumple_proximo(29, 2, date '2027-12-01') = date '2028-02-29',
         null;
exception when others then
  insert into _r173 (caso, ok, detalle) values ('10 (error sin atrapar)', false, sqlerrm);
end $$;

-- 11. Inicio: lista y marca «enviado» por AÑO DEL CUMPLEAÑOS (avisado el 28-dic para el 2-ene → año siguiente)
do $$ declare v uuid; l1 jsonb; m jsonb; l2 jsonb; e text; l3 jsonb; l0 jsonb; enb boolean;
begin
  perform pg_temp.alta(8, 2, 1, true);    v := pg_temp.mid(8);
  perform pg_temp.alta(9, 20, 1, true);   -- fuera de los 7 días
  l0 := public.club_cumple_lista('prueba173a', date '2026-12-28');   -- apagado: lista vacía
  perform pg_temp.cfg('prueba173a', true);
  l1 := public.club_cumple_lista('prueba173a', date '2026-12-28');
  m  := public.club_cumple_marcar(v, 'prueba173a', date '2026-12-28');
  l2 := public.club_cumple_lista('prueba173a', date '2026-12-29');
  e  := pg_temp.error_de(format('select public.club_cumple_marcar(%L, %L, %L)', v, 'prueba173a', date '2026-12-30'));
  l3 := public.club_cumple_lista('prueba173a', date '2027-12-28');   -- el año siguiente vuelve a aparecer
  enb := exists (select 1 from public.club_cumple_envios x where x.miembro_id = v and x.anio = 2027);
  insert into _r173 (caso, ok, detalle) values ('11 lista del Inicio y marca «enviado»: una por socio y año del cumpleaños',
    jsonb_array_length(l0->'socios') = 0
    and (select array_agg(x->>'miembro_id') from jsonb_array_elements(l1->'socios') x) = array[v::text]
    and (l1->'socios'->0->>'faltan')::int = 5
    and m->>'whatsapp' = pg_temp.tel(8) and m->>'cumple' = '2027-01-02' and m->>'desde' = '2026-12-26' and m->>'hasta' = '2027-01-09'
    and m->>'beneficio' = 'postre de cortesía' and enb
    and jsonb_array_length(l2->'socios') = 0
    and e = 'Ya se le mandó el saludo de cumpleaños de este año'
    and (select array_agg(x->>'miembro_id') from jsonb_array_elements(l3->'socios') x) = array[v::text]
    and exists (select 1 from public.club_auditoria x where x.accion = 'cumple_enviar' and x.objeto_id = v
                  and not (coalesce(x.despues, '{}'::jsonb) ? 'whatsapp')),
    concat_ws(' | ', l1, m, e));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('11 (error sin atrapar)', false, sqlerrm);
end $$;

-- 12. Fuera de la lista: socio de baja, sin permiso (sin cumpleaños), de otro local
do $$ declare l jsonb; v uuid;
begin
  perform pg_temp.alta(10, 30, 12, true);
  update public.club_miembro_roles set estado = 'baja' where miembro_id = pg_temp.mid(10) and rol = 'socio';
  perform pg_temp.alta(11, 30, 12, true, 'prueba173b');
  perform pg_temp.alta(14, 30, 12, true);   -- vuelve a pendiente (como una autoalta sin validar): no es socio activo
  update public.club_miembro_roles set estado = 'pendiente' where miembro_id = pg_temp.mid(14) and rol = 'socio';
  perform pg_temp.alta(15, 31, 12, true);   -- control: activo, sí aparece
  l := public.club_cumple_lista('prueba173a', date '2026-12-28');
  insert into _r173 (caso, ok, detalle) values ('12 la lista no trae bajas, pendientes, sin permiso ni socios de otro local',
    not exists (select 1 from jsonb_array_elements(l->'socios') x
                 where (x->>'miembro_id')::uuid in (pg_temp.mid(10), pg_temp.mid(11), pg_temp.mid(14), pg_temp.mid(2), pg_temp.mid(7)))
    and exists (select 1 from jsonb_array_elements(l->'socios') x where (x->>'miembro_id')::uuid = pg_temp.mid(15)),
    l::text);
exception when others then
  insert into _r173 (caso, ok, detalle) values ('12 (error sin atrapar)', false, sqlerrm);
end $$;

-- 13. Caja: dentro de la ventana (cruzando el año) aplica, sin la fecha; fuera o apagado, no
do $$ declare a jsonb; b jsonb; c jsonb; d jsonb; o jsonb; ob jsonb;
begin
  perform pg_temp.alta(12, 30, 12, true);
  a := public.club_cumple_en_caja_dia(pg_temp.mid(12), 'prueba173a', date '2027-01-03');
  b := public.club_cumple_en_caja_dia(pg_temp.mid(12), 'prueba173a', date '2027-01-10');
  c := public.club_cumple_en_caja_dia(pg_temp.mid(2), 'prueba173a', date '2027-01-03');   -- sin cumpleaños
  -- socio de OTRO local (prueba173b), con el beneficio encendido allá y dentro de su ventana: igual que «sin beneficio»
  perform pg_temp.cfg('prueba173b', true);
  perform pg_temp.alta(16, 30, 12, true, 'prueba173b');
  o := public.club_cumple_en_caja_dia(pg_temp.mid(16), 'prueba173a', date '2027-01-03');
  ob := public.club_cumple_en_caja_dia(pg_temp.mid(16), 'prueba173b', date '2027-01-03');   -- control: en su local, sí
  perform pg_temp.cfg('prueba173a', false);
  d := public.club_cumple_en_caja_dia(pg_temp.mid(12), 'prueba173a', date '2027-01-03');
  perform pg_temp.cfg('prueba173a', true);
  insert into _r173 (caso, ok, detalle) values ('13 caja: aplica en la ventana (cruzando el año) con el artículo; fuera/apagado no; nunca la fecha',
    (a->>'aplica')::boolean and a->>'beneficio' = 'postre de cortesía' and a->'cortesia'->>'codigo' = 'P173A1'
    and (a->>'lista_para_caja')::boolean and (a->>'min_personas')::int = 5
    and not (a ? 'cumple') and not (a ? 'desde') and not (a ? 'hasta') and a::text !~ '12-30|30/12'
    and b = '{"aplica": false}'::jsonb and c = '{"aplica": false}'::jsonb and d = '{"aplica": false}'::jsonb,
    concat_ws(' | ', a, b, d));
  insert into _r173 (caso, ok, detalle) values ('13b caja: socio de otro local → lo mismo que «sin beneficio» (no revela si está cerca)',
    o = '{"aplica": false}'::jsonb and (ob->>'aplica')::boolean, concat_ws(' | ', o, ob));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('13 (error sin atrapar)', false, sqlerrm);
end $$;

-- 14. Configuración: el manager edita SU local (y queda auditado); no el otro; el cajero no; reglas de los datos
do $$ declare r jsonb; e1 text; e2 text; e3 text; e4 text; e5 text; e6 text; e7 text; base jsonb;
begin
  base := jsonb_build_object('activo', false, 'beneficio', 'copa de vino', 'min_personas', 4, 'dias_antes', 3,
                             'dias_despues', 10, 'uno_por_mesa', false, 'solo_reserva', true,
                             'reserva_url', 'https://reservas.ejemplo.test/r?rid=2', 'cortesia_id', null);
  r  := pg_temp.como((select manager_a from _c173), format('public.club_cumple_config_guardar(%L::jsonb, %L)', base, 'prueba173a'));
  e1 := pg_temp.err_como((select manager_a from _c173), format('public.club_cumple_config_guardar(%L::jsonb, %L)', base, 'prueba173b'));
  e2 := pg_temp.err_como((select cajero from _c173), format('public.club_cumple_config_guardar(%L::jsonb, %L)', base, 'prueba173a'));
  e3 := pg_temp.err_como((select manager_a from _c173), format('public.club_cumple_config_guardar(%L::jsonb, %L)', base || '{"activo": true}', 'prueba173a'));
  e4 := pg_temp.err_como((select manager_a from _c173), format('public.club_cumple_config_guardar(%L::jsonb, %L)', base || '{"reserva_url": null}', 'prueba173a'));
  e5 := pg_temp.err_como((select manager_a from _c173), format('public.club_cumple_config_guardar(%L::jsonb, %L)', base || '{"reserva_url": "http://x.test/r"}', 'prueba173a'));
  e6 := pg_temp.err_como((select manager_a from _c173), format('public.club_cumple_config_guardar(%L::jsonb, %L)',
          base || jsonb_build_object('cortesia_id', (select id from public.club_cortesias where codigo_producto = 'P173B1')), 'prueba173a'));
  e7 := pg_temp.err_como((select manager_a from _c173), format('public.club_cumple_config_guardar(%L::jsonb, %L)',
          base || jsonb_build_object('cortesia_id', (select id from public.club_cortesias where codigo_producto = 'P173A2')), 'prueba173a'));
  insert into _r173 (caso, ok, detalle) values ('14 config: manager de su local sí (auditado); otro local, cajero y datos malos no',
    r->>'beneficio' = 'copa de vino' and (r->>'min_personas')::int = 4 and (r->>'dias_despues')::int = 10 and not (r->>'activo')::boolean
    and exists (select 1 from public.club_auditoria x where x.accion = 'cumple_config' and x.despues->>'beneficio' = 'copa de vino'
                  and x.antes->>'beneficio' = 'postre de cortesía')
    and e1 = 'Sin permiso en ese local' and e2 = 'Sin permiso'
    and e3 like 'Para encenderlo, elegí el artículo%' and e4 like 'Con «solo con reserva» hace falta%'
    and e5 like 'El link de reserva tiene que empezar con https%' and e6 like 'Esa cortesía no es de este local%'
    and e7 like 'Esa cortesía está inactiva%',
    concat_ws(' | ', r, e1, e2, e3, e4, e5, e6, e7));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('14 (error sin atrapar)', false, sqlerrm);
end $$;

-- 15. Permisos de las públicas: Inicio y WhatsApp (owner y manager de su local), caja (también cajero), la API no ve tablas
do $$ declare e1 text; e2 text; e3 text; e4 text; e5 text; r jsonb; c jsonb; v jsonb;
begin
  perform pg_temp.cfg('prueba173a', true);
  r  := pg_temp.como((select manager_a from _c173), format('public.club_cumple_proximos(%L)', 'prueba173a'));
  e1 := pg_temp.err_como((select manager_a from _c173), format('public.club_cumple_proximos(%L)', 'prueba173b'));
  e2 := pg_temp.err_como((select cajero from _c173), format('public.club_cumple_proximos(%L)', 'prueba173a'));
  e3 := pg_temp.err_como((select manager_b from _c173), format('public.club_cumple_enviar(%L::uuid, %L)', pg_temp.mid(12), 'prueba173a'));
  c  := pg_temp.como((select cajero from _c173), format('public.club_cumple_en_caja(%L::uuid, %L)', pg_temp.mid(12), 'prueba173a'));
  e4 := pg_temp.err_como((select manager_b from _c173), format('public.club_cumple_en_caja(%L::uuid, %L)', pg_temp.mid(12), 'prueba173a'));
  e5 := pg_temp.err_como((select manager_a from _c173), '(select count(*) from public.club_cumple_envios)');
  v  := pg_temp.como((select manager_a from _c173), format('public.club_cumple_config_ver(%L)', 'prueba173a'));
  insert into _r173 (caso, ok, detalle) values ('15 permisos: Inicio/WhatsApp owner y manager de su local; caja con cajero; tablas cerradas',
    r ? 'socios' and (r->>'activo')::boolean and e1 = 'Sin permiso en ese local' and e2 = 'Sin permiso'
    and e3 = 'Sin permiso en ese local' and c ? 'aplica' and e4 = 'Sin permiso en ese local' and e5 like 'permission denied%'
    and v->>'reserva_url' = 'https://reservas.ejemplo.test/r?rid=1',
    concat_ws(' | ', e1, e2, e3, e4, e5));
exception when others then
  insert into _r173 (caso, ok, detalle) values ('15 (error sin atrapar)', false, sqlerrm);
end $$;

-- 16. Locales que ya existían quedan con su fila APAGADA y el link de OpenTable; el aviso queda en v1.3 con su huella
insert into _r173 (caso, ok, detalle)
select '16 filas de config apagadas con OpenTable por defecto · aviso v1.3 vigente y registrado',
       not exists (select 1 from public.club_cumple_config k where k.location_id not like 'prueba173_' and k.activo)
       and not exists (select 1 from public.club_cumple_config k where k.location_id not like 'prueba173_'
                         and k.reserva_url is distinct from 'https://www.opentable.com/restref/client/?rid=1347736')
       and (select count(*) from public.club_cumple_config k where k.location_id not like 'prueba173_')
           = (select count(*) from public.club_config c where c.location_id not like 'prueba173_')
       and not exists (select 1 from public.club_config where aviso_privacidad_version = 'v1.2')
       and exists (select 1 from public.club_avisos_privacidad where version = 'v1.3'),
       null;

-- 17. La autoalta de la 159 sigue cargando el cumpleaños (la guardia rehecha no la rompe)
do $$ declare r jsonb; c public.club_miembros_contacto;
begin
  perform pg_temp.web(true);
  r := public.club_socio_autoalta(jsonb_build_object('nombre', 'Socio Ficticio Web', 'whatsapp', pg_temp.tel(20), 'acepto', 'v1.3',
                                                     'mayor_edad', true, 'cumple_dia', 4, 'cumple_mes', 7, 'cumple_permiso', true,
                                                     'local', 'prueba173a'));
  c := pg_temp.cto(20);
  insert into _r173 (caso, ok, detalle) values ('17 autoalta web (v1.3) sigue guardando el cumpleaños',
    (r->>'ok')::boolean and c.cumple_dia = 4 and c.cumple_mes = 7, r::text);
exception when others then
  insert into _r173 (caso, ok, detalle) values ('17 (error sin atrapar)', false, sqlerrm);
end $$;

-- 18. ROLLBACK: sin objetos de la 173, la guardia de la 159 vuelve y la v2 de caja sigue
-- @@173R@@   (aquí va el cuerpo de 173_rollback.sql sin begin/commit)
insert into _r173 (caso, ok, detalle)
select '18 rollback: sin tablas, funciones ni columna de la 173 · aviso de vuelta en v1.2 · la v2 de caja sigue',
       to_regclass('public.club_cumple_config') is null and to_regclass('public.club_cumple_envios') is null
       and to_regprocedure('public.club_socio_alta_caja_v3(text,text,text,boolean,boolean,int,int,boolean,text)') is null
       and to_regprocedure('public.club_portal_cumple_agregar(text,int,int,boolean)') is null
       and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'club_cumple%')
       and to_regprocedure('public.club_portal_cumple(text)') is null
       and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_miembros_contacto'
                         and column_name = 'cumple_portal_en')
       and position('club.cumple_carga' in pg_get_functiondef('public.club_contacto_cumple_guardia()'::regprocedure)) = 0
       and not exists (select 1 from public.club_config where aviso_privacidad_version = 'v1.3')
       and has_function_privilege('authenticated', 'public.club_socio_alta_caja_v2(text,text,text,boolean,boolean,text)', 'EXECUTE'),
       null;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r173;

-- ASSERT: cada caso que falla sale como WARNING («173 FALLA <caso> — <detalle>»), después el resumen
-- («173 RESUMEN: pasaron X / fallaron Y de 20») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «173-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others»: antes lo tenía y se
-- tragaba su propio raise (un caso 18 caído terminaba en ROLLBACK limpio, sin error).
do $$
declare
  r record;
  v_esp constant int := 20;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _r173 where ok is not true order by n loop   -- null = falla
    raise warning '173 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r173;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '173 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice '173 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception '173-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
