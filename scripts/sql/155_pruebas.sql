-- 155_pruebas (origen 102) · SOLO STAGING. Aplica la 155 dentro de una transacción, prueba y termina en ROLLBACK: no
-- deja nada. Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con
-- «155-FALLAN: <casos>». Se corre con scripts/sql/155_pruebas.py, o a mano con el SQL armado (155_pruebas.py --armar).
--
-- MARCADOR que llena el runner: la línea «-- @@155@@ …» → el cuerpo de supabase/migrations/155_club_tope_sin_carga_inicial.sql
-- sin begin; / commit; (re-ejecutable: también vale sobre un staging que ya la tiene). Con --mutar, ese cuerpo va con
-- el arreglo deshecho (o cambiado) a propósito y sus casos tienen que caer.
-- Usa un owner ACTIVO de la base y el local con el Club encendido (el primero por nombre); si falta alguno, el caso 00
-- falla: NO PROBADO no da verde. JWT simulado con set_config('request.jwt.claims', …, true).
-- Anfitriones de prueba con nombres ficticios, en un mes viejo (marzo de 2001) donde no hay datos reales. Las personas
-- se calculan desde club_config del local: «sobre» = la mínima que pasa el tope + 1; «bajo» = 1.
begin;
-- @@155@@   (aquí va el cuerpo de la 155 sin begin/commit)
create temp table _r155 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _c155 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       (select c.location_id from public.club_config c where c.club_activo order by c.location_id limit 1) as loc;
alter table _c155 add column sobre int, add column bajo int, add column tope numeric;
update _c155 x set tope = c.anfitrion_tope_mes_crc,
                   sobre = ceil(c.anfitrion_tope_mes_crc * c.personas_por_credito / c.valor_credito_crc)::int + 1,
                   bajo = 1
  from public.club_config c where c.location_id = x.loc;

-- 00. hay owner activo y un local con el Club encendido y tope > 0
insert into _r155 (caso, ok, detalle)
select '00 hay owner activo y local con el Club encendido (tope > 0)', owner_id is not null and loc is not null and tope > 0,
       'local = ' || coalesce(loc, 'NINGUNO') || ' · sobre = ' || coalesce(sobre::text, '?') || ' personas'
  from _c155;

-- 0. catálogo: misma firma, STABLE, SECURITY DEFINER, search_path, anon sin EXECUTE, authenticated con EXECUTE
insert into _r155 (caso, ok, detalle)
select '0 catálogo: definer · stable · search_path=public, pg_temp · anon sin EXECUTE · authenticated con EXECUTE',
       p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public, pg_temp']
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       coalesce(p.proacl::text, 'sin acl')
  from pg_proc p where p.oid = 'public.club_excepciones(date,date,text,text)'::regprocedure;

-- anfitriones de prueba: A carga sobre el tope · B app sobre el tope · C carga sobre + app bajo · D carga + app sobre
-- · E papel sobre el tope
insert into public.club_miembros (id, location_id, tipo, nombre)
select v.id::uuid, c.loc, 'referente', v.nombre
  from _c155 c, (values ('00000000-0000-4000-8000-0000000155a1', 'Anfitrion Prueba A'),
                        ('00000000-0000-4000-8000-0000000155b1', 'Anfitrion Prueba B'),
                        ('00000000-0000-4000-8000-0000000155c1', 'Anfitrion Prueba C'),
                        ('00000000-0000-4000-8000-0000000155d1', 'Anfitrion Prueba D'),
                        ('00000000-0000-4000-8000-0000000155e1', 'Anfitrion Prueba E')) v(id, nombre)
 where c.loc is not null;

insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc,
                                     fecha_visita, registrado_en, origen, nota)
select c.loc, v.mid::uuid, 'tarjeta', case v.cuanto when 'sobre' then c.sobre else c.bajo end,
       cfg.personas_por_credito, cfg.valor_credito_crc, timestamptz '2001-03-15 12:00:00-06', now(), v.origen, 'prueba 155'
  from _c155 c join public.club_config cfg on cfg.location_id = c.loc,
       (values ('00000000-0000-4000-8000-0000000155a1', 'migracion', 'sobre'),
               ('00000000-0000-4000-8000-0000000155b1', 'app',       'sobre'),
               ('00000000-0000-4000-8000-0000000155c1', 'migracion', 'sobre'),
               ('00000000-0000-4000-8000-0000000155c1', 'app',       'bajo'),
               ('00000000-0000-4000-8000-0000000155d1', 'migracion', 'sobre'),
               ('00000000-0000-4000-8000-0000000155d1', 'app',       'sobre'),
               ('00000000-0000-4000-8000-0000000155e1', 'papel',     'sobre')) v(mid, origen, cuanto);

-- como owner (JWT simulado), solo la verificación del tope, en marzo de 2001
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c155), 'role', 'authenticated')::text, true);
create temp table _e155 on commit drop as
select e.ref, e.detalle from public.club_excepciones('2001-03-01', '2001-03-31', (select loc from _c155), 'ANFITRION_SOBRE_TOPE') e;
-- y la función entera (sin p_tipo): lo mismo para el tope
create temp table _t155 on commit drop as
select e.ref from public.club_excepciones('2001-03-01', '2001-03-31', (select loc from _c155)) e where e.tipo = 'ANFITRION_SOBRE_TOPE';
select set_config('request.jwt.claims', '', true);

-- 1. carga inicial sobre el tope → NO alerta
insert into _r155 (caso, ok, detalle)
select '1 tarjeta de la carga inicial (origen migracion) sobre el tope NO alerta',
       not exists (select 1 from _e155 where ref = 'tope:00000000-0000-4000-8000-0000000155a1:2001-03'), null;
-- 2. tarjeta normal sobre el tope → alerta
insert into _r155 (caso, ok, detalle)
select '2 tarjeta normal (origen app) sobre el tope SÍ alerta',
       exists (select 1 from _e155 where ref = 'tope:00000000-0000-4000-8000-0000000155b1:2001-03'), null;
-- 3. carga sobre el tope + normal por debajo → NO alerta (solo cuenta lo normal)
insert into _r155 (caso, ok, detalle)
select '3 carga sobre el tope + app por debajo NO alerta',
       not exists (select 1 from _e155 where ref = 'tope:00000000-0000-4000-8000-0000000155c1:2001-03'), null;
-- 4. carga + normal sobre el tope → alerta, y el ganado es SOLO el de la tarjeta normal
insert into _r155 (caso, ok, detalle)
select '4 carga + app sobre el tope: alerta con ganado_crc solo de la app',
       coalesce((select (e.detalle->>'ganado_crc')::numeric = round(c.sobre * cfg.valor_credito_crc / cfg.personas_por_credito)
                   from _e155 e where e.ref = 'tope:00000000-0000-4000-8000-0000000155d1:2001-03'), false),
       (select e.detalle->>'ganado_crc' from _e155 e where e.ref = 'tope:00000000-0000-4000-8000-0000000155d1:2001-03')
  from _c155 c join public.club_config cfg on cfg.location_id = c.loc;
-- 5. las tarjetas de papel (origen papel) siguen contando
insert into _r155 (caso, ok, detalle)
select '5 tarjeta de papel (origen papel) sobre el tope SÍ alerta',
       exists (select 1 from _e155 where ref = 'tope:00000000-0000-4000-8000-0000000155e1:2001-03'), null;
-- 6. la función entera (sin p_tipo) da las mismas alertas de tope que con p_tipo
insert into _r155 (caso, ok, detalle)
select '6 sin p_tipo: mismas alertas de tope (B, D y E)',
       (select array_agg(ref order by ref) from _t155) = (select array_agg(ref order by ref) from _e155)
       and (select count(*) from _e155) = 3,
       (select count(*) from _e155)::text || ' con p_tipo · ' || (select count(*) from _t155)::text || ' sin p_tipo';
-- 7. anon: sin EXECUTE
do $$ begin
  set local role anon;
  perform public.club_excepciones('2001-03-01', '2001-03-31', null, 'ANFITRION_SOBRE_TOPE');
  reset role;
  insert into _r155 (caso, ok, detalle) values ('7 anon → permission denied (42501)', false, 'no dio error');
exception when others then
  reset role;
  insert into _r155 (caso, ok, detalle) values ('7 anon → permission denied (42501)', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r155;

-- ASSERT: si algún caso falla, la transacción aborta y dice cuáles
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r155 where ok is not true;   -- null = falla
  if v is not null then raise exception '155-FALLAN: %', v; end if;
  if (select count(*) from _r155) <> 9 then raise exception '155-FALLAN: se esperaban 9 casos'; end if;
end $$;
rollback;
