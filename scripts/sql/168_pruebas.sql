-- 168_pruebas (origen 114) · Aplica la 168 dentro de una transacción, prueba y termina en ROLLBACK: no deja nada.
-- Corre sobre una base con la 155 (staging, o el Postgres 16 local armado con las migraciones del árbol; con y sin la 157).
-- Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con «168-FALLAN: <casos>».
-- Se corre con scripts/sql/168_pruebas.py (o con el SQL armado: 168_pruebas.py --armar).
--
-- MARCADORES que llena el runner: «-- @@168@@ …» → el cuerpo de supabase/migrations/168_club_primeros_90.sql sin
-- begin/commit ni su bloque de verificación (con --mutar, con el arreglo deshecho a propósito); «-- @@168G@@ …» → la
-- guarda de scripts/sql/168_rollback.sql (caso 15a); «-- @@168R@@ …» → el cuerpo del rollback (caso 15b).
-- Usa tres locales FICTICIOS que crea adentro (prueba168a y prueba168c con la cortesía, prueba168b sin cargarla), un
-- owner ACTIVO de la base (si no hay, el caso 00 falla: NO PROBADO no da verde) y socios con nombres ficticios.
-- La doble aplicación CONCURRENTE de verdad (dos conexiones a la vez) está en 168_concurrencia.sh (base local).
begin;
-- foto de las funciones ANTES de la 168 (para el rollback del 15b)
create temp table _p168 on commit drop as
select md5(pg_get_functiondef('public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure)) as md5_visita,
       md5(pg_get_functiondef('public.club_pase_datos(uuid)'::regprocedure)) as md5_pase,
       to_regprocedure('public.club_corte_equipo(uuid)') is not null as con_157;
-- @@168@@   (aquí va el cuerpo de la 168 sin begin/commit)
create temp table _r168 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r168 to anon, authenticated;
grant usage on sequence _r168_n_seq to anon, authenticated;

create temp table _c168 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8168-0000000000ff'::uuid as sin_rol;
grant select on _c168 to anon, authenticated;
create temp table _f168 (n serial) on commit drop;   -- números de factura ficticios
grant all on _f168 to anon, authenticated;
grant usage on sequence _f168_n_seq to anon, authenticated;

insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba168a', 'Local Ficticio A', true), ('prueba168b', 'Local Ficticio B', true), ('prueba168c', 'Local Ficticio C', true);
update public.club_promociones set estado = 'vigente', desde = null, hasta = null, hora_desde = null, hora_hasta = null,
                                   dias = '{1,2,3,4,5,6,7}'
 where location_id in ('prueba168a', 'prueba168b', 'prueba168c') and 'socio' = any(para);
insert into public.club_cortesias (location_id, codigo_producto, nombre) values
  ('prueba168a', 'P168A1', 'Postre Ficticio'), ('prueba168a', 'P168A2', 'Bebida Ficticia'),
  ('prueba168b', 'P168B1', 'Postre Ficticio B'), ('prueba168c', 'P168C1', 'Postre Ficticio C');
update public.club_config_global set club_url = coalesce(club_url, 'https://club.ejemplo.test'), socio_visitas_por_dia = 1;

select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-168-0123456789abcdef', 'sha256'), 'hex'));
select set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-168-0123456789abcdef"}', true);

-- Socios de prueba: id fijo por letra; alta hace N días (hora CR). tipo 'socio' crea su rol socio activo (trigger de la 150).
create function pg_temp.sid(p text) returns uuid language sql immutable as $f$
  select ('00000000-0000-4000-8168-' || lpad(to_hex(ascii(p)), 12, '0'))::uuid $f$;
create function pg_temp.socio(p text, p_alta_dias int, p_tipo text default 'socio') returns void language plpgsql as $f$
begin
  insert into public.club_miembros (id, location_id, tipo, nombre) values (pg_temp.sid(p), 'prueba168a', p_tipo, 'Socio Ficticio ' || p);
  insert into public.club_miembro_roles (miembro_id, rol, estado) values (pg_temp.sid(p), 'socio', 'activo')
    on conflict (miembro_id, rol) do update set estado = 'activo';
  update public.club_miembro_roles set desde = now() - make_interval(days => p_alta_dias)
   where miembro_id = pg_temp.sid(p) and rol = 'socio';
end $f$;
-- una visita registrada un día CR (directo en la tabla, como si la hubiera hecho la caja ese día a las 20:00 CR).
-- p_fact: con su factura cerrada (C) en el PoS · p_856: la factura lleva el 856 (LOCAL CLUB). Opción B: sin las dos, un
-- día anterior no cuenta para el avance.
create function pg_temp.hoy() returns date language sql stable as $f$ select (now() at time zone 'America/Costa_Rica')::date $f$;
create function pg_temp.visita_dia(p text, p_fecha date, p_loc text default 'prueba168a', p_fact boolean default true,
                                   p_856 boolean default true) returns void language plpgsql as $f$
declare v_nf text; v_t uuid; v_ts timestamptz := (p_fecha + time '20:00') at time zone 'America/Costa_Rica';
begin
  insert into _f168 default values;
  v_nf := '168' || lpad(currval('_f168_n_seq')::text, 6, '0');
  if p_fact then
    insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
    values (p_loc, v_nf, v_ts, 'C', 'salon', 'cajero', true, 'ok', 10000) returning id into v_t;
    if p_856 then
      insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto) values (v_t, '856', 'LOCAL CLUB', 1, 0);
    end if;
  end if;
  insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, client_op_id, pos_ref, estado_beneficio, aplicar)
  values (p_loc, pg_temp.sid(p), p_fecha, v_ts, gen_random_uuid(),
          jsonb_build_object('modo', 'factura', 'local', p_loc, 'numero_factura', v_nf), 'aplica', '{}'::jsonb);
end $f$;
create function pg_temp.visita(p text, p_dias int, p_loc text default 'prueba168a', p_fact boolean default true,
                               p_856 boolean default true) returns void language sql as $f$
  select pg_temp.visita_dia(p, pg_temp.hoy() - p_dias, p_loc, p_fact, p_856) $f$;
-- alta a una HORA CR fija de un día CR (para los bordes de hora: 19:00 CR = 01:00 UTC del día siguiente)
create function pg_temp.alta_a(p text, p_fecha date, p_hora time) returns void language sql as $f$
  update public.club_miembro_roles set desde = (p_fecha + p_hora) at time zone 'America/Costa_Rica'
   where miembro_id = pg_temp.sid(p) and rol = 'socio' $f$;
-- la caja (owner) escanea al socio HOY con una factura nueva del local; devuelve «qué aplicar»
create function pg_temp.escanear(p text, p_loc text default 'prueba168a', p_op uuid default null) returns jsonb language plpgsql as $f$
declare v_nf text; r jsonb;
begin
  insert into _f168 default values;
  v_nf := '168' || lpad(currval('_f168_n_seq')::text, 6, '0');
  insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, total_crc)
  values (p_loc, v_nf, now() - interval '5 minutes', 'C', 'salon', 'cajero', true, 'ok', 10000);
  perform set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c168), 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.club_socio_visita(pg_temp.sid(p), jsonb_build_object('modo', 'factura', 'local', p_loc, 'numero_factura', v_nf),
                                coalesce(p_op, gen_random_uuid()), p_loc);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise;
end $f$;
create function pg_temp.especial(r jsonb) returns int language sql immutable as $f$
  select count(*)::int from jsonb_array_elements(coalesce(r->'cortesias', '[]'::jsonb)) x where x->>'motivo' = 'primeros_90' $f$;
create function pg_temp.fila(p text) returns public.club_primeros90 language sql stable as $f$
  select * from public.club_primeros90 where miembro_id = pg_temp.sid(p) $f$;
create function pg_temp.guardar(p_activo boolean, p_cod text, p_loc text, p_uid uuid) returns jsonb language plpgsql as $f$
declare r jsonb; v_k uuid := (select k.id from public.club_cortesias k where k.location_id = p_loc and k.codigo_producto = p_cod);
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.club_primeros90_config_guardar(p_activo, v_k, p_loc);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise;
end $f$;

-- 00. hay owner activo
insert into _r168 (caso, ok, detalle)
select '00 hay un owner activo', owner_id is not null, 'con 157: ' || (select con_157 from _p168) from _c168;

-- 0. catálogo
insert into _r168 (caso, ok, detalle)
select '0 catálogo: definer con search_path · caja/club-web/Edge con permiso · internas cerradas · envoltorios · apagado 4/90/60',
       (select bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp']) from pg_proc p
         where p.oid in ('public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure, 'public.club_pase_datos(uuid)'::regprocedure,
                         'public.club_portal_avance(text)'::regprocedure, 'public.club_primeros90_en_visita(uuid,jsonb)'::regprocedure,
                         'public.club_primeros90_avance(uuid)'::regprocedure, 'public.club_primeros90_alta(uuid)'::regprocedure,
                         'public.club_primeros90_config_guardar(boolean,uuid,text)'::regprocedure))
       and has_function_privilege('authenticated', 'public.club_socio_visita(uuid,jsonb,uuid,text)', 'EXECUTE')
       and has_function_privilege('anon', 'public.club_portal_avance(text)', 'EXECUTE')
       and has_function_privilege('service_role', 'public.club_pase_datos(uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_socio_visita_base(uuid,jsonb,uuid,text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_primeros90_en_visita(uuid,jsonb)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_primeros90_avance(uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_primeros90_avance(uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_pase_datos(uuid)', 'EXECUTE')
       and not has_table_privilege('anon', 'public.club_primeros90', 'SELECT')
       and position('club_socio_visita_base(' in (select prosrc from pg_proc where oid = 'public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure)) > 0
       and position('club_pase_datos_base(' in (select prosrc from pg_proc where oid = 'public.club_pase_datos(uuid)'::regprocedure)) > 0
       and (select not primeros90_activo and primeros90_visitas = 4 and primeros90_dias = 90 and primeros90_vence_dias = 60
              from public.club_config_global limit 1),
       null;

-- 1. APAGADO POR DEFECTO: con 3 días de visita (alta + 2) la 4.ª no da nada y no hay avance
select pg_temp.socio('a', 10);
select pg_temp.visita('a', 6); select pg_temp.visita('a', 3);
create temp table _v168 (k text primary key, r jsonb) on commit drop;
insert into _v168 values ('a1', pg_temp.escanear('a'));
insert into _r168 (caso, ok, detalle)
select '1 apagado por defecto: la 4.ª visita no gana ni ofrece · sin avance en portal · pase idéntico al de antes',
       pg_temp.especial(r) = 0 and (pg_temp.fila('a')).id is null and public.club_primeros90_avance(pg_temp.sid('a')) is null
       and not (public.club_pase_datos(pg_temp.sid('a'))->'socio' ? 'avance')
       and public.club_pase_datos(pg_temp.sid('a')) = public.club_pase_datos_base(pg_temp.sid('a'))
       and (public.club_portal_avance((select token_portal from public.club_miembros where id = pg_temp.sid('a')))->'avance') = 'null'::jsonb
       and r->>'estado' = 'aplica',
       r::text from _v168 where k = 'a1';

-- el owner lo enciende con la cortesía del local A; el local B queda encendido para el Club pero SIN cortesía especial
select pg_temp.guardar(true, 'P168A1', 'prueba168a', (select owner_id from _c168));
select pg_temp.guardar(null, 'P168C1', 'prueba168c', (select owner_id from _c168));

-- 2. el alta cuenta como la 1.ª visita
select pg_temp.socio('b', 0);
insert into _r168 (caso, ok, detalle)
select '2 alta de hoy → «Visita 1 de 4» (el alta es la 1.ª), hasta = alta + 89',
       av->>'visita' = '1' and av->>'de' = '4' and av->>'ganada' = 'false'
       and (av->>'hasta')::date = (now() at time zone 'America/Costa_Rica')::date + 89, av::text
  from (select public.club_primeros90_avance(pg_temp.sid('b')) av) x;

-- 3. alta hace 10 días + visitas en 2 días distintos (una de ellas doble: cuenta una) → «3 de 4»; la de hoy gana y se ofrece
select pg_temp.socio('c', 10);
select pg_temp.visita('c', 7); select pg_temp.visita('c', 4); select pg_temp.visita('c', 4);
insert into _v168 values ('c0', public.club_primeros90_avance(pg_temp.sid('c')));
insert into _v168 values ('c1', pg_temp.escanear('c'));
insert into _r168 (caso, ok, detalle)
select '3 dos visitas el mismo día cuentan una (3 de 4) · la 4.ª gana y la caja la ofrece (motivo primeros_90, texto y aviso) · queda en la visita y la auditoría',
       (select r->>'visita' from _v168 where k = 'c0') = '3'
       and pg_temp.especial(r) = 1 and r->>'estado' = 'aplica'
       and r->>'texto' like '%1 cortesía especial de bienvenida: Postre Ficticio%'
       and r->'primeros90'->>'estado' = 'ofrecida'
       and exists (select 1 from jsonb_array_elements_text(r->'avisos') a where a like '%P168A1%una sola vez%')
       and (pg_temp.fila('c')).estado = 'usada' and (pg_temp.fila('c')).visita_id = (r->>'visita_id')::uuid
       and pg_temp.especial((select v.aplicar from public.club_visitas_socio v where v.id = (r->>'visita_id')::uuid)) = 1
       and (select jsonb_path_exists(v.cortesias, '$[*] ? (@.motivo == "primeros_90")') from public.club_visitas_socio v where v.id = (r->>'visita_id')::uuid)
       and (select count(*) from public.club_auditoria au where au.objeto_id = (pg_temp.fila('c')).id
              and au.accion in ('primeros90_ganada', 'primeros90_usada')) = 2,
       r::text from _v168 where k = 'c1';

-- 4. DOBLE APLICACIÓN: tope 2 por día y otra factura hoy → no se ofrece otra vez; el reescaneo (misma op) devuelve la misma
update public.club_config_global set socio_visitas_por_dia = 2;
insert into _v168 values ('c2', pg_temp.escanear('c'));
insert into _v168 values ('c3', pg_temp.escanear('c', 'prueba168a', (select (v.client_op_id) from public.club_visitas_socio v
                                                                      where v.id = ((select r from _v168 where k = 'c1')->>'visita_id')::uuid)));
update public.club_config_global set socio_visitas_por_dia = 1;
insert into _r168 (caso, ok, detalle)
select '4 doble aplicación: 2.ª visita del día sin la especial · reescaneo = la misma (repetida) · una sola en todas las visitas',
       pg_temp.especial((select r from _v168 where k = 'c2')) = 0
       and ((select r from _v168 where k = 'c3')->>'repetida')::boolean
       and pg_temp.especial((select r from _v168 where k = 'c3')) = 1
       and (select count(*) from public.club_visitas_socio v, jsonb_array_elements(v.cortesias) x
             where v.miembro_id = pg_temp.sid('c') and x->>'motivo' = 'primeros_90') = 1,
       (select r::text from _v168 where k = 'c2');

-- 5. FUERA DE LOS 90 DÍAS: alta hace 95 días con 3 visitas dentro (ya sumaría 4) y la de hoy afuera → nada.
--    Borde: alta hace 90 (hoy es el día 90, afuera) → nada; alta hace 89 → gana.
select pg_temp.socio('d', 95);
select pg_temp.visita('d', 80); select pg_temp.visita('d', 70); select pg_temp.visita('d', 60);
insert into _v168 values ('d1', pg_temp.escanear('d'));
select pg_temp.socio('e', 89);
select pg_temp.visita('e', 80); select pg_temp.visita('e', 70);
insert into _v168 values ('e1', pg_temp.escanear('e'));
select pg_temp.socio('f', 90);
select pg_temp.visita('f', 80); select pg_temp.visita('f', 70);
insert into _v168 values ('f1', pg_temp.escanear('f'));
insert into _r168 (caso, ok, detalle)
select '5 fuera de los 90 días: alta hace 95 (con 4 dentro) y hace 90 → la de hoy no gana, sin avance · alta hace 89 → gana',
       pg_temp.especial((select r from _v168 where k = 'd1')) = 0 and (pg_temp.fila('d')).id is null
       and public.club_primeros90_avance(pg_temp.sid('d')) is null
       and pg_temp.especial((select r from _v168 where k = 'f1')) = 0 and (pg_temp.fila('f')).id is null
       and pg_temp.especial((select r from _v168 where k = 'e1')) = 1,
       'd ' || (select r->>'texto' from _v168 where k = 'd1') || ' · e ' || (select r->>'texto' from _v168 where k = 'e1');

-- 6. EQUIPO EXCLUIDO (D7): tipo 'equipo' con rol socio, y un socio con rol equipo activo → nada, sin avance
select pg_temp.socio('g', 10, 'equipo');
select pg_temp.visita('g', 7); select pg_temp.visita('g', 4);
insert into _v168 values ('g1', pg_temp.escanear('g'));
select pg_temp.socio('h', 10);
insert into public.club_miembro_roles (miembro_id, rol, estado) values (pg_temp.sid('h'), 'equipo', 'activo');
select pg_temp.visita('h', 7); select pg_temp.visita('h', 4);
insert into _v168 values ('h1', pg_temp.escanear('h'));
insert into _r168 (caso, ok, detalle)
select '6 equipo excluido (tipo y rol, con y sin la 157): no gana, no se ofrece, sin avance',
       pg_temp.especial((select r from _v168 where k = 'g1')) = 0 and (pg_temp.fila('g')).id is null
       and pg_temp.especial((select r from _v168 where k = 'h1')) = 0 and (pg_temp.fila('h')).id is null
       and public.club_primeros90_avance(pg_temp.sid('g')) is null and public.club_primeros90_avance(pg_temp.sid('h')) is null,
       (select r::text from _v168 where k = 'h1');

-- 7. GRUPO DE CONTROL (gancho #185): sin_avance → ni avance ni cortesía; el beneficio base sigue igual
select pg_temp.socio('i', 10);
update public.club_miembros set sin_avance = true where id = pg_temp.sid('i');
select pg_temp.visita('i', 7); select pg_temp.visita('i', 4);
insert into _v168 values ('i1', pg_temp.escanear('i'));
insert into _r168 (caso, ok, detalle)
select '7 sin_avance: no ve el avance ni gana; el beneficio base (aplica) igual',
       pg_temp.especial(r) = 0 and (pg_temp.fila('i')).id is null and public.club_primeros90_avance(pg_temp.sid('i')) is null
       and r->>'estado' = 'aplica',
       r::text from _v168 where k = 'i1';

-- 8. SIN CONFIGURAR EN ESTE LOCAL: gana en B (sin cortesía) → aviso, NO se ofrece, queda guardada; después, en A, sí
select pg_temp.socio('j', 10);
select pg_temp.visita('j', 7); select pg_temp.visita('j', 4);
insert into _v168 values ('j1', pg_temp.escanear('j', 'prueba168b'));
update public.club_config_global set socio_visitas_por_dia = 2;
insert into _v168 values ('j2', pg_temp.escanear('j', 'prueba168a'));
update public.club_config_global set socio_visitas_por_dia = 1;
insert into _r168 (caso, ok, detalle)
select '8 local sin la cortesía cargada: avisa y no la ofrece (queda disponible, se ve «ganada» en el avance) · en otro local con la cortesía, sí',
       pg_temp.especial((select r from _v168 where k = 'j1')) = 0
       and (select r->'primeros90'->>'estado' from _v168 where k = 'j1') = 'sin_configurar'
       and exists (select 1 from _v168, jsonb_array_elements_text(r->'avisos') a where k = 'j1' and a like '%NO la ofrezcas%')
       and pg_temp.especial((select r from _v168 where k = 'j2')) = 1 and (pg_temp.fila('j')).location_id = 'prueba168a',
       (select r::text from _v168 where k = 'j1');

-- 9. ARTÍCULO INACTIVO: la cortesía del local se desactiva → no se ofrece; config_ver dice que no está lista
select pg_temp.socio('k', 10);
select pg_temp.visita('k', 7); select pg_temp.visita('k', 4);
update public.club_cortesias set activa = false where location_id = 'prueba168c' and codigo_producto = 'P168C1';
insert into _v168 values ('k1', pg_temp.escanear('k', 'prueba168c'));
update public.club_cortesias set activa = true where location_id = 'prueba168c' and codigo_producto = 'P168C1';
insert into _r168 (caso, ok, detalle)
select '9 artículo inactivo en el local → no se ofrece (sin_configurar) y queda disponible',
       pg_temp.especial(r) = 0 and r->'primeros90'->>'estado' = 'sin_configurar' and (pg_temp.fila('k')).estado = 'disponible',
       r::text from _v168 where k = 'k1';

-- 10. REGLA FIJA: sin promoción vigente (la promo del local en borrador) → no va en esta factura; queda guardada
select pg_temp.socio('l', 10);
select pg_temp.visita('l', 7); select pg_temp.visita('l', 4);
update public.club_promociones set estado = 'borrador' where location_id = 'prueba168c' and 'socio' = any(para);
insert into _v168 values ('l1', pg_temp.escanear('l', 'prueba168c'));
update public.club_promociones set estado = 'vigente' where location_id = 'prueba168c' and 'socio' = any(para);
insert into _r168 (caso, ok, detalle)
select '10 visita sin beneficio (sin promoción) → la especial NO va en esa factura, queda guardada con aviso',
       pg_temp.especial(r) = 0 and r->>'estado' = 'sin_promocion' and r->'primeros90'->>'estado' = 'guardada'
       and (pg_temp.fila('l')).estado = 'disponible',
       r::text from _v168 where k = 'l1';

-- 11. PASE: club_pase_datos = club_pase_datos_base + socio.avance (nada más); la ganada disponible se ve «ganada»
insert into _r168 (caso, ok, detalle)
select '11 pase = base + socio.avance (nada más) · ganada disponible → ganada:true con vence_en · alta de hoy → 1 de 4 · usada → sin avance',
       bool_and((public.club_pase_datos(pg_temp.sid(p)) #- '{socio,avance}') = public.club_pase_datos_base(pg_temp.sid(p)))
       and (public.club_pase_datos(pg_temp.sid('l'))->'socio'->'avance'->>'ganada') = 'true'
       and (public.club_pase_datos(pg_temp.sid('l'))->'socio'->'avance'->>'vence_en') is not null
       and (public.club_pase_datos(pg_temp.sid('b'))->'socio'->'avance'->>'visita') = '1'
       and not (public.club_pase_datos(pg_temp.sid('c'))->'socio' ? 'avance'),
       null
  from unnest(array['a', 'b', 'c', 'l']) p;

-- 12. PORTAL (anon, solo por club-web): {avance}; sin portón o con token malo → «Enlace no válido»
do $$
declare v jsonb; v_sin boolean := false; v_mal boolean := false; v_tab boolean := false;
        v_tok text := (select token_portal from public.club_miembros where id = pg_temp.sid('b'));
begin
  set local role anon;
  v := public.club_portal_avance(v_tok);
  begin perform public.club_portal_avance(repeat('0', 64)); exception when others then v_mal := sqlerrm = 'Enlace no válido'; end;
  begin perform 1 from public.club_primeros90 limit 1; exception when insufficient_privilege then v_tab := true; end;
  perform set_config('request.headers', '{}', true);
  begin perform public.club_portal_avance(v_tok);
  exception when others then v_sin := sqlerrm = 'Enlace no válido'; end;
  reset role;
  perform set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-168-0123456789abcdef"}', true);
  insert into _r168 (caso, ok, detalle) values ('12 portal: anon con portón ve {avance} · sin portón y token malo → Enlace no válido · tabla cerrada',
    v->'avance'->>'visita' = '1' and v_sin and v_mal and v_tab, v::text || ' sin ' || v_sin || ' mal ' || v_mal || ' tab ' || v_tab);
exception when others then
  reset role;
  perform set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-168-0123456789abcdef"}', true);
  insert into _r168 (caso, ok, detalle) values ('12 portal: anon con portón ve {avance} · sin portón y token malo → Enlace no válido · tabla cerrada', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 13. CONFIG: sin rol → Sin permiso · encender sin cortesía → error · cortesía inactiva u otro local → error · historial y auditoría
do $$
declare v_sinrol boolean := false; v_sincort boolean := false; v_inact boolean := false; v_otro boolean := false;
        v_hist int; v_aud int; v_kb uuid;
begin
  begin perform pg_temp.guardar(false, null, 'prueba168a', (select sin_rol from _c168));
  exception when others then v_sinrol := sqlstate = '42501'; end;
  begin perform pg_temp.guardar(true, null, 'prueba168b', (select owner_id from _c168));
  exception when others then v_sincort := sqlerrm like 'Para encenderlo%'; end;
  update public.club_cortesias set activa = false where location_id = 'prueba168a' and codigo_producto = 'P168A2';
  begin perform pg_temp.guardar(null, 'P168A2', 'prueba168a', (select owner_id from _c168));
  exception when others then v_inact := sqlerrm like 'Esa cortesía está inactiva%'; end;
  begin
    v_kb := (select k.id from public.club_cortesias k where k.codigo_producto = 'P168B1');
    perform set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c168), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.club_primeros90_config_guardar(null, v_kb, 'prueba168a');
    reset role;
  exception when others then reset role; v_otro := sqlerrm like 'Esa cortesía no es de este local%'; end;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_hist from public.club_config_historial h
   where h.location_id = 'prueba168a' and h.campo = 'primeros90_cortesia_id' and h.valor_anterior is null and h.valor_nuevo is not null;
  select count(*) into v_aud from public.club_auditoria a
   where a.tabla = 'club_config_global' and (a.antes->>'primeros90_activo') = 'false' and (a.despues->>'primeros90_activo') = 'true';
  insert into _r168 (caso, ok, detalle) values ('13 config: sin rol 42501 · encender sin cortesía, inactiva u otro local → error · historial por local y auditoría global',
    v_sinrol and v_sincort and v_inact and v_otro and v_hist = 1 and v_aud = 1,
    'sinrol ' || v_sinrol || ' sincort ' || v_sincort || ' inact ' || v_inact || ' otro ' || v_otro || ' hist ' || v_hist || ' aud ' || v_aud);
exception when others then
  reset role;
  insert into _r168 (caso, ok, detalle) values ('13 config: sin rol 42501 · encender sin cortesía, inactiva u otro local → error · historial por local y auditoría global', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 14. VENCIDA: la guardada vence → no se ofrece y pasa a 'vencida'; apagado después de ganar → lo ganado se respeta
update public.club_primeros90 set vence_en = now() - interval '1 minute' where miembro_id = pg_temp.sid('l');
update public.club_config_global set socio_visitas_por_dia = 2;
insert into _v168 values ('l2', pg_temp.escanear('l', 'prueba168a'));
select pg_temp.guardar(false, 'P168A1', 'prueba168a', (select owner_id from _c168));
insert into _v168 values ('k2', pg_temp.escanear('k', 'prueba168a'));
update public.club_config_global set socio_visitas_por_dia = 1;
insert into _r168 (caso, ok, detalle)
select '14 vencida → no se ofrece (estado vencida) · apagado el programa, la ganada antes se respeta',
       pg_temp.especial((select r from _v168 where k = 'l2')) = 0 and (pg_temp.fila('l')).estado = 'vencida'
       and pg_temp.especial((select r from _v168 where k = 'k2')) = 1 and (pg_temp.fila('k')).estado = 'usada',
       (select r::text from _v168 where k = 'l2');

-- (el caso 14 lo apagó: se vuelve a encender para 16–19)
select pg_temp.guardar(true, 'P168A1', 'prueba168a', (select owner_id from _c168));

-- 16. HORA CR (verificador del #187): el día del alta y la ventana se cuentan en hora de Costa Rica, no en UTC.
--     m: alta el día D a las 19:30 CR (= 01:30 UTC de D+1) + visitas con factura en D+1 y D+5 + hoy → 4.ª, gana.
--     n: alta hace 90 días a las 19:00 CR (en UTC sería hace 89) + 3 visitas dentro → hoy es el día 90: no gana.
select pg_temp.socio('m', 0);
select pg_temp.alta_a('m', pg_temp.hoy() - 10, time '19:30');
select pg_temp.visita_dia('m', pg_temp.hoy() - 9); select pg_temp.visita_dia('m', pg_temp.hoy() - 5);
insert into _v168 values ('m1', pg_temp.escanear('m'));
select pg_temp.socio('n', 0);
select pg_temp.alta_a('n', pg_temp.hoy() - 90, time '19:00');
select pg_temp.visita('n', 80); select pg_temp.visita('n', 70); select pg_temp.visita('n', 60);
insert into _v168 values ('n1', pg_temp.escanear('n'));
select pg_temp.socio('q', 0);
select pg_temp.alta_a('q', pg_temp.hoy() - 1, time '23:59:30');
insert into _r168 (caso, ok, detalle)
select '16 hora CR: alta a las 19:30 CR, la visita del día siguiente CR cuenta (gana) · alta hace 90 a las 19:00 CR → no gana · alta ayer 23:59:30 CR → hasta = ayer + 89',
       pg_temp.especial((select r from _v168 where k = 'm1')) = 1
       and pg_temp.especial((select r from _v168 where k = 'n1')) = 0 and (pg_temp.fila('n')).id is null
       and (public.club_primeros90_avance(pg_temp.sid('q'))->>'hasta')::date = pg_temp.hoy() - 1 + 89
       and public.club_primeros90_avance(pg_temp.sid('q'))->>'visita' = '1',
       'm ' || (select r->>'texto' from _v168 where k = 'm1') || ' · n ' || (select r->>'texto' from _v168 where k = 'n1')
       || ' · q ' || public.club_primeros90_avance(pg_temp.sid('q'))::text;

-- 17. OPCIÓN B: los días anteriores cuentan solo con factura cerrada con el 856/857. Tres escaneos sin factura (dos días
--     anteriores sin factura y uno con una factura ajena sin el 856) + hoy → no gana; el avance dice 2 (alta + hoy).
--     Con primeros90_exige_factura = false, los mismos días cuentan.
select pg_temp.socio('o', 20);
select pg_temp.visita('o', 9, 'prueba168a', false); select pg_temp.visita('o', 6, 'prueba168a', false);
select pg_temp.visita('o', 3, 'prueba168a', true, false);
insert into _v168 values ('o1', pg_temp.escanear('o'));
insert into _v168 values ('o2', public.club_primeros90_avance(pg_temp.sid('o')));
update public.club_config_global set primeros90_exige_factura = false;
insert into _v168 values ('o3', public.club_primeros90_avance(pg_temp.sid('o')));
update public.club_config_global set primeros90_exige_factura = true;
insert into _r168 (caso, ok, detalle)
select '17 opción B: tres escaneos sin factura (o con factura ajena sin 856) + hoy → no gana, avance 2 de 4 · sin exigir factura → 4 de 4',
       pg_temp.especial((select r from _v168 where k = 'o1')) = 0 and (pg_temp.fila('o')).id is null
       and (select r->>'visita' from _v168 where k = 'o2') = '2'
       and (select r->>'visita' from _v168 where k = 'o3') = '4'
       and (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
             where d.adrelid = 'public.club_config_global'::regclass and a.attname = 'primeros90_exige_factura') = 'true',
       (select r::text from _v168 where k = 'o2') || ' · ' || (select r::text from _v168 where k = 'o3');

-- 18. VENCIMIENTO al final del día CR mostrado: r gana hoy en B (sin cortesía: queda guardada) → «vale hasta» hoy + 60
--     y el límite es las 00:00 CR del día siguiente (a las 23:59:59 CR del día mostrado todavía vale).
select pg_temp.socio('r', 10);
select pg_temp.visita('r', 7); select pg_temp.visita('r', 4);
insert into _v168 values ('r1', pg_temp.escanear('r', 'prueba168b'));
insert into _r168 (caso, ok, detalle)
select '18 vencimiento: «vale hasta» = día de la visita + 60 y vence a las 00:00 CR del día siguiente',
       (pg_temp.fila('r')).estado = 'disponible'
       and (pg_temp.fila('r')).vence_en = ((pg_temp.hoy() + 61)::timestamp at time zone 'America/Costa_Rica')
       and (public.club_primeros90_avance(pg_temp.sid('r'))->>'vence_en')::date = pg_temp.hoy() + 60
       and ((pg_temp.hoy() + 60 + time '23:59:59') at time zone 'America/Costa_Rica') < (pg_temp.fila('r')).vence_en,
       (pg_temp.fila('r')).vence_en::text || ' · ' || public.club_primeros90_avance(pg_temp.sid('r'))::text;

-- 19. La cortesía tiene que ser del local de la caja: B apuntando (por fuera de la función) a la de A → no se ofrece en B.
update public.club_config set primeros90_cortesia_id = (select k.id from public.club_cortesias k where k.codigo_producto = 'P168A1')
 where location_id = 'prueba168b';
select pg_temp.socio('s', 10);
select pg_temp.visita('s', 7); select pg_temp.visita('s', 4);
insert into _v168 values ('s1', pg_temp.escanear('s', 'prueba168b'));
update public.club_config set primeros90_cortesia_id = null where location_id = 'prueba168b';
insert into _r168 (caso, ok, detalle)
select '19 local B con la cortesía de A cargada por fuera → sin_configurar en B, no se ofrece',
       pg_temp.especial(r) = 0 and r->'primeros90'->>'estado' = 'sin_configurar' and (pg_temp.fila('s')).estado = 'disponible',
       r::text from _v168 where k = 's1';

-- 15a. ROLLBACK con cortesías ganadas → la guarda aborta
do $$
declare v_aborta boolean := false;
begin
  begin
    -- @@168G@@   (aquí va la guarda de 168_rollback.sql)
  exception when others then v_aborta := sqlerrm like '168 rollback: hay cortesías%'; end;
  insert into _r168 (caso, ok, detalle) values ('15a rollback con cortesías ganadas → aborta', v_aborta, null);
end $$;

-- 15b. ROLLBACK sin cortesías: club_socio_visita y club_pase_datos vuelven a ser las de antes (md5), sin tabla ni columnas
delete from public.club_primeros90;
drop function pg_temp.fila(text);   -- depende del tipo de la tabla
-- @@168R@@   (aquí va el cuerpo de 168_rollback.sql sin begin/commit)
insert into _r168 (caso, ok, detalle)
select '15b rollback: visita y pase = los de antes (md5) · sin base, tabla, columnas ni funciones de la 168 · permisos de antes',
       md5(pg_get_functiondef('public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure)) = p.md5_visita
       and md5(pg_get_functiondef('public.club_pase_datos(uuid)'::regprocedure)) = p.md5_pase
       and has_function_privilege('authenticated', 'public.club_socio_visita(uuid,jsonb,uuid,text)', 'EXECUTE')
       and has_function_privilege('service_role', 'public.club_pase_datos(uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_pase_datos(uuid)', 'EXECUTE')
       and to_regprocedure('public.club_socio_visita_base(uuid,jsonb,uuid,text)') is null
       and to_regprocedure('public.club_pase_datos_base(uuid)') is null
       and to_regprocedure('public.club_portal_avance(text)') is null
       and to_regprocedure('public.club_primeros90_en_visita(uuid,jsonb)') is null
       and to_regclass('public.club_primeros90') is null
       and not exists (select 1 from information_schema.columns where table_schema = 'public'
                        and ((table_name = 'club_config_global' and column_name like 'primeros90%')
                          or (table_name = 'club_config' and column_name = 'primeros90_cortesia_id')
                          or (table_name = 'club_miembros' and column_name = 'sin_avance'))),
       'md5 visita ' || p.md5_visita || ' → ' || md5(pg_get_functiondef('public.club_socio_visita(uuid,jsonb,uuid,text)'::regprocedure))
  from _p168 p;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r168;

-- ASSERT: si algún caso falla, la transacción aborta y dice cuáles
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r168 where ok is not true;   -- null = falla
  if v is not null then raise exception '168-FALLAN: %', v; end if;
  if (select count(*) from _r168) <> 22 then raise exception '168-FALLAN: se esperaban 22 casos (NO PROBADO)'; end if;
end $$;
rollback;
