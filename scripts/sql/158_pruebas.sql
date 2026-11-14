-- 158_pruebas (origen 105) · SOLO STAGING. Aplica la 158 dentro de una transacción, prueba y termina en ROLLBACK: no
-- deja nada. Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con
-- «158-FALLAN: <casos>». Se corre con scripts/sql/158_pruebas.py (o con el SQL armado: 158_pruebas.py --armar).
--
-- MARCADOR que llena el runner: la línea «-- @@158@@ …» → el cuerpo de supabase/migrations/158_club_resena_cupon.sql
-- sin begin; / commit; ni su bloque de verificación. Con --mutar, ese cuerpo va con el arreglo deshecho a propósito y
-- sus casos tienen que caer.
-- Usa el primer local de club_config y un owner ACTIVO; si falta alguno, el caso 00 falla (NO PROBADO no da verde).
-- Anfitrión y cupones de prueba con nombres ficticios. Links de reseña ficticios (no son de ningún local real).
begin;
-- @@158@@   (aquí va el cuerpo de la 158 sin begin/commit)
create temp table _r158 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r158 to anon, authenticated;
grant usage on sequence _r158_n_seq to anon, authenticated;
create temp table _c158 on commit drop as
select (select c.location_id from public.club_config c order by c.location_id limit 1) as loc,
       (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       'https://g.page/r/PRUEBA-FICTICIA-158/review'::text as url;
grant select on _c158 to anon, authenticated;

-- clave de PRUEBA de club-web (CLUB-AUD-06), cargada dentro de la transacción descartada
select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-158-0123456789abcdef', 'sha256'), 'hex'));
select set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-158-0123456789abcdef"}', true);

-- 00. hay local y owner activo
insert into _r158 (caso, ok, detalle)
select '00 hay un local en club_config y un owner activo', loc is not null and owner_id is not null,
       'local = ' || coalesce(loc, 'NINGUNO') from _c158;

-- 0. catálogo
insert into _r158 (caso, ok, detalle)
select '0 catálogo: las dos definer · search_path · ver stable · clic volatile · anon y authenticated con EXECUTE',
       bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
                and has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       and bool_or(p.proname = 'club_cupon_ver' and p.provolatile = 's')
       and bool_or(p.proname = 'club_cupon_resena_clic' and p.provolatile = 'v'),
       string_agg(p.proname || ' ' || coalesce(p.proacl::text, 'sin acl'), ' · ')
  from pg_proc p where p.oid in ('public.club_cupon_ver(text)'::regprocedure, 'public.club_cupon_resena_clic(text)'::regprocedure);

-- ¿el CHECK acepta esta dirección? (subtransacción: el error no aborta la batería)
create function pg_temp.acepta(p_url text) returns boolean language plpgsql as $f$
begin
  update public.club_config set resena_url = p_url where location_id = (select loc from _c158);
  return true;
exception when check_violation then
  return false;
end $f$;

-- 1. acepta las direcciones de Google
insert into _r158 (caso, ok, detalle)
select '1 CHECK acepta maps.app.goo.gl, g.page, google.com/maps y search.google.com/local/writereview',
       bool_and(pg_temp.acepta(u)), string_agg(u, ' ') filter (where not pg_temp.acepta(u))
  from unnest(array['https://maps.app.goo.gl/PruebaFicticia1',
                    'https://g.page/r/PRUEBA-FICTICIA/review',
                    'https://www.google.com/maps/place/Ficticio/@9.6,-85.1,17z',
                    'https://google.com/maps?cid=123',
                    'https://search.google.com/local/writereview?placeid=FICTICIO123']) u;

-- 2. rechaza lo que no es Google (o no es https, o trae espacios/comillas, o es muy largo)
insert into _r158 (caso, ok, detalle)
select '2 CHECK rechaza http, otros dominios, dominios parecidos, espacios, comillas, vacíos y > 500',
       not bool_or(pg_temp.acepta(u)), string_agg(left(u, 60), ' ') filter (where pg_temp.acepta(u))
  from unnest(array['http://maps.app.goo.gl/PruebaFicticia1',
                    'https://ejemplo.test/maps',
                    'https://google.com.ejemplo.test/maps',
                    'https://g.page.ejemplo.test/x',
                    'https://google.com@ejemplo.test/maps',
                    'https://google.com/mapsx',
                    'https://maps.app.goo.gl/',
                    'https://g.page/r/x y',
                    'https://g.page/r/x"onclick',
                    'javascript:alert(1)',
                    'https://search.google.com/local/writereview',
                    'https://g.page/' || repeat('a', 500)]) u;

-- el link del local para el resto de la batería
update public.club_config set resena_url = (select url from _c158) where location_id = (select loc from _c158);

-- anfitrión y cupones de prueba: A vigente · B usado hace 1 día · C usado hace 8 días · D anulado · E usado hace 2 días
-- (para el clic) · F usado hace 1 día con clic viejo (no se pisa) · G vigente (clic)
insert into public.club_miembros (id, location_id, tipo, nombre)
select '00000000-0000-4000-8000-000000000158'::uuid, loc, 'referente', 'Anfitrion Prueba Resena' from _c158;
insert into public.club_cupones (location_id, referente_id, codigo, estado, vence_en, usado_en, resena_clic_en)
select c.loc, '00000000-0000-4000-8000-000000000158'::uuid, v.cod, v.est, now() + v.vence, v.usado, v.clic
  from _c158 c, (values ('AAAAA35822', 'vigente', interval '7 days',  null::timestamptz,          null::timestamptz),
                        ('BBBBB35822', 'usado',   interval '7 days',  now() - interval '1 day',   null),
                        ('CCCCC35822', 'usado',   interval '-1 day',  now() - interval '8 days',  null),
                        ('DDDDD35822', 'anulado', interval '7 days',  null,                       null),
                        ('EEEEE35822', 'usado',   interval '7 days',  now() - interval '2 days',  null),
                        ('FFFFF35822', 'usado',   interval '7 days',  now() - interval '1 day',   timestamptz '2001-01-01 12:00-06'),
                        ('GGGGG35822', 'vigente', interval '7 days',  null,                       null)) v(cod, est, vence, usado, clic);

-- 3–6. club_cupon_ver: la reseña solo con el cupón usado hace menos de 7 días
insert into _r158 (caso, ok, detalle)
select '3 vigente → sin reseña', (j->>'estado') = 'vigente' and j ? 'resena' and (j->'resena') = 'null'::jsonb, j::text
  from (select public.club_cupon_ver('AAAAA35822') j) x;
insert into _r158 (caso, ok, detalle)
select '4 usado hace 1 día → reseña del local', (j->>'estado') = 'usado' and (j->>'resena') = (select url from _c158)
       and (j->'local'->>'id') = (select loc from _c158), j::text
  from (select public.club_cupon_ver('BBBBB35822') j) x;
insert into _r158 (caso, ok, detalle)
select '5 usado hace 8 días → sin reseña (aviso corto de siempre)', (j->>'estado') = 'usado' and (j->'resena') = 'null'::jsonb, j::text
  from (select public.club_cupon_ver('CCCCC35822') j) x;
insert into _r158 (caso, ok, detalle)
select '6 anulado → vencido y sin reseña', (j->>'estado') = 'vencido' and (j->'resena') = 'null'::jsonb, j::text
  from (select public.club_cupon_ver('DDDDD35822') j) x;

-- 8. clic: marca la primera vez y no pisa una marca anterior
select public.club_cupon_resena_clic('EEEEE35822');
select public.club_cupon_resena_clic('ffffF35822');   -- minúsculas: se normaliza como en club_cupon_ver
insert into _r158 (caso, ok, detalle)
select '8 clic en usado reciente → marca; con marca previa no se pisa',
       (select resena_clic_en = now() from public.club_cupones where codigo = 'EEEEE35822')
       and (select resena_clic_en = timestamptz '2001-01-01 12:00-06' from public.club_cupones where codigo = 'FFFFF35822'),
       (select string_agg(codigo || '=' || coalesce(resena_clic_en::text, 'null'), ' ') from public.club_cupones
         where codigo in ('EEEEE35822', 'FFFFF35822'));

-- 9. clic en vigente o en usado hace 8 días → no marca
select public.club_cupon_resena_clic('GGGGG35822');
select public.club_cupon_resena_clic('CCCCC35822');
insert into _r158 (caso, ok, detalle)
select '9 clic en vigente o en usado hace más de 7 días → no marca',
       not exists (select 1 from public.club_cupones where codigo in ('GGGGG35822', 'CCCCC35822') and resena_clic_en is not null),
       null;

-- 10. sin el header de club-web: las dos funciones rechazan
do $$
declare v_ok_ver boolean := false; v_ok_clic boolean := false;
begin
  perform set_config('request.headers', '{}', true);
  begin perform public.club_cupon_ver('BBBBB35822'); exception when others then v_ok_ver := sqlerrm = 'Cupón no válido'; end;
  begin perform public.club_cupon_resena_clic('BBBBB35822'); exception when others then v_ok_clic := sqlerrm = 'Cupón no válido'; end;
  perform set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-158-0123456789abcdef"}', true);
  insert into _r158 (caso, ok, detalle) values ('10 sin header x-club-web → ver y clic rechazan', v_ok_ver and v_ok_clic,
    'ver ' || v_ok_ver || ' · clic ' || v_ok_clic);
end $$;
insert into _r158 (caso, ok, detalle)
select '10b el clic rechazado sin header no marcó', not exists (select 1 from public.club_cupones where codigo = 'BBBBB35822' and resena_clic_en is not null), null;

-- 11. código inexistente o mal formado → error
do $$
declare v1 boolean := false; v2 boolean := false;
begin
  begin perform public.club_cupon_resena_clic('ZZZZZ35822'); exception when others then v1 := sqlstate = 'P0001'; end;
  begin perform public.club_cupon_resena_clic('nada'); exception when others then v2 := sqlstate = 'P0001'; end;
  insert into _r158 (caso, ok, detalle) values ('11 clic con código inexistente o mal formado → Cupón no válido', v1 and v2, v1 || ' ' || v2);
end $$;

-- 12. local sin link: ver no devuelve reseña y el clic no marca
update public.club_cupones set resena_clic_en = null where codigo = 'BBBBB35822';   -- casos independientes
update public.club_config set resena_url = null where location_id = (select loc from _c158);
select public.club_cupon_resena_clic('BBBBB35822');
insert into _r158 (caso, ok, detalle)
select '12 local sin link → sin reseña y el clic no marca',
       (public.club_cupon_ver('BBBBB35822')->'resena') = 'null'::jsonb
       and not exists (select 1 from public.club_cupones where codigo = 'BBBBB35822' and resena_clic_en is not null), null;
update public.club_config set resena_url = (select url from _c158) where location_id = (select loc from _c158);

update public.club_cupones set resena_clic_en = null where codigo = 'BBBBB35822';   -- casos independientes
-- 13. como anon (lo que usa club-web): ve la reseña por la función, pero no lee las columnas directo
do $$
declare v_j jsonb; v_tabla boolean := false; v_cup boolean := false;
begin
  set local role anon;
  v_j := public.club_cupon_ver('BBBBB35822');
  perform public.club_cupon_resena_clic('BBBBB35822');
  begin perform resena_url from public.club_config limit 1; exception when insufficient_privilege then v_tabla := true; end;
  begin perform resena_clic_en from public.club_cupones limit 1; exception when insufficient_privilege then v_cup := true; end;
  reset role;
  insert into _r158 (caso, ok, detalle) values ('13 anon: la función devuelve la reseña y marca el clic; las tablas, permission denied',
    (v_j->>'resena') is not null and v_tabla and v_cup
    and exists (select 1 from public.club_cupones where codigo = 'BBBBB35822' and resena_clic_en is not null),
    'resena ' || coalesce(v_j->>'resena', 'null') || ' · tabla ' || v_tabla || ' · cupones ' || v_cup);
exception when others then
  reset role;
  insert into _r158 (caso, ok, detalle) values ('13 anon: la función devuelve la reseña y marca el clic; las tablas, permission denied', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 14. carga del link: owner sí (y queda en club_config_historial); un usuario sin rol, 0 filas
do $$
declare v_owner int; v_otro int; v_hist int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c158), 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.club_config set resena_url = 'https://maps.app.goo.gl/OwnerFicticio158' where location_id = (select loc from _c158);
  get diagnostics v_owner = row_count;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000158ff', 'role', 'authenticated')::text, true);
  update public.club_config set resena_url = 'https://maps.app.goo.gl/OtroFicticio158' where location_id = (select loc from _c158);
  get diagnostics v_otro = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_hist from public.club_config_historial h
   where h.location_id = (select loc from _c158) and h.campo = 'resena_url' and h.valor_nuevo = 'https://maps.app.goo.gl/OwnerFicticio158';
  insert into _r158 (caso, ok, detalle) values ('14 owner carga el link (queda en el historial); un usuario sin rol no cambia nada',
    v_owner = 1 and v_otro = 0 and v_hist = 1, 'owner ' || v_owner || ' · sin rol ' || v_otro || ' · historial ' || v_hist);
exception when others then
  reset role;
  insert into _r158 (caso, ok, detalle) values ('14 owner carga el link (queda en el historial); un usuario sin rol no cambia nada', false, sqlstate || ' ' || sqlerrm);
end $$;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r158;

-- ASSERT: si algún caso falla, la transacción aborta y dice cuáles
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r158 where ok is not true;   -- null = falla
  if v is not null then raise exception '158-FALLAN: %', v; end if;
  if (select count(*) from _r158) <> 16 then raise exception '158-FALLAN: se esperaban 16 casos'; end if;
end $$;
rollback;
