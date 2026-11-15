-- 167_pruebas (origen 113) · Aplica la 167 dentro de una transacción, prueba y termina en ROLLBACK: no deja nada.
-- Corre sobre una base con 155→158 (staging, o el Postgres 16 local armado con las migraciones del árbol; con y sin la
-- 157). Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con «167-FALLAN: <casos>».
-- Se corre con scripts/sql/167_pruebas.py (o con el SQL armado: 167_pruebas.py --armar).
--
-- MARCADORES que llena el runner: «-- @@167@@ …» → el cuerpo de supabase/migrations/167_club_resena_socios.sql sin
-- begin/commit ni su bloque de verificación (con --mutar, con el arreglo deshecho a propósito); «-- @@167R@@ …» → el
-- cuerpo de scripts/sql/167_rollback.sql (sin begin/commit ni su verificación), para el caso 18.
-- Usa dos locales FICTICIOS que crea adentro (prueba167a con link, prueba167b sin link) y un owner ACTIVO de la base; si
-- no hay owner, el caso 00 falla (NO PROBADO no da verde). Socios con nombres ficticios. Links de reseña ficticios.
begin;
-- foto del portal ANTES de la 167 (para el caso 17 y el rollback del 18)
create temp table _p167 on commit drop as
select md5(pg_get_functiondef('public.club_portal(text)'::regprocedure)) as md5_portal,
       to_regprocedure('public.club_corte_equipo(uuid)') is not null as con_157;
-- @@167@@   (aquí va el cuerpo de la 167 sin begin/commit)
create temp table _r167 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r167 to anon, authenticated;
grant usage on sequence _r167_n_seq to anon, authenticated;

insert into public.club_config (location_id, nombre, resena_url) values
  ('prueba167a', 'Local Ficticio A', 'https://g.page/r/PRUEBA-FICTICIA-167/review'),
  ('prueba167b', 'Local Ficticio B', null);
update public.club_config_global set club_url = coalesce(club_url, 'https://club.ejemplo.test'),
                                     resena_socio_cada = 5, resena_socio_espera_dias = 90;
create temp table _c167 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       'https://g.page/r/PRUEBA-FICTICIA-167/review'::text as url;
grant select on _c167 to anon, authenticated;

select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-167-0123456789abcdef', 'sha256'), 'hex'));
select set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-167-0123456789abcdef"}', true);

-- Socios de prueba: id fijo por letra. tipo 'socio' crea su rol socio activo (trigger de la 150).
create function pg_temp.sid(p text) returns uuid language sql immutable as $f$
  select ('00000000-0000-4000-8167-' || lpad(to_hex(ascii(p)), 12, '0'))::uuid $f$;
create function pg_temp.socio(p text, p_tipo text default 'socio') returns void language plpgsql as $f$
begin
  insert into public.club_miembros (id, location_id, tipo, nombre) values (pg_temp.sid(p), 'prueba167a', p_tipo, 'Socio Ficticio ' || p);
  if p_tipo <> 'socio' then
    insert into public.club_miembro_roles (miembro_id, rol, estado) values (pg_temp.sid(p), 'socio', 'activo')
      on conflict (miembro_id, rol) do update set estado = 'activo';
  end if;
end $f$;
-- n visitas; la más nueva hace `p_hace`, las otras un minuto antes cada una
create function pg_temp.visitas(p text, p_n int, p_loc text, p_hace interval, p_estado text default 'aplica') returns void
language sql as $f$
  insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, client_op_id, estado_beneficio, aplicar)
  select p_loc, pg_temp.sid(p), ((now() - p_hace - make_interval(mins => k)) at time zone 'America/Costa_Rica')::date, now() - p_hace - make_interval(mins => k),
         gen_random_uuid(), p_estado, '{}'::jsonb
    from generate_series(0, p_n - 1) k $f$;
create function pg_temp.tok(p text) returns text language sql stable as $f$
  select token_portal from public.club_miembros where id = pg_temp.sid(p) $f$;
create function pg_temp.res(p text) returns jsonb language sql stable as $f$
  select public.club_portal(pg_temp.tok(p))->'resena' $f$;
create function pg_temp.marcar(p text, a text) returns jsonb language sql as $f$
  select public.club_portal_resena(pg_temp.tok(p), a) $f$;
create function pg_temp.pedidos(p text) returns int language sql stable as $f$
  select count(*)::int from public.club_resena_socio where miembro_id = pg_temp.sid(p) $f$;

-- 00. hay owner activo
insert into _r167 (caso, ok, detalle)
select '00 hay un owner activo (y la base trae la 158)', owner_id is not null
       and exists (select 1 from information_schema.columns where table_name = 'club_config' and column_name = 'resena_url'),
       'con 157: ' || (select con_157 from _p167) from _c167;

-- 0. catálogo
insert into _r167 (caso, ok, detalle)
select '0 catálogo: 4 definer con search_path · portal y marca con anon · internas cerradas · portal envuelve a datos · defaults 5/90',
       (select bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp']) from pg_proc p
         where p.oid in ('public.club_portal(text)'::regprocedure, 'public.club_portal_datos(text)'::regprocedure,
                         'public.club_portal_resena(text,text)'::regprocedure, 'public.club_resena_socio_toca(uuid)'::regprocedure))
       and has_function_privilege('anon', 'public.club_portal(text)', 'EXECUTE')
       and has_function_privilege('anon', 'public.club_portal_resena(text,text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_portal_datos(text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_portal_datos(text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_resena_socio_toca(uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_resena_socio_toca(uuid)', 'EXECUTE')
       and position('club_portal_datos(p_token)' in (select prosrc from pg_proc where oid = 'public.club_portal(text)'::regprocedure)) > 0
       and (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
             where d.adrelid = 'public.club_config_global'::regclass and a.attname = 'resena_socio_cada') = '5'
       and (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
             where d.adrelid = 'public.club_config_global'::regclass and a.attname = 'resena_socio_espera_dias') = '90',
       null;

-- 1–2. el socio con 4 visitas con beneficio no la ve; con la 5.ª, sí (link y nombre del local de esa visita)
select pg_temp.socio('a');
select pg_temp.visitas('a', 4, 'prueba167a', interval '2 days');
insert into _r167 (caso, ok, detalle) select '1 socio con 4 visitas con beneficio → sin tarjeta', r = 'null'::jsonb, r::text
  from (select pg_temp.res('a') r) x;
select pg_temp.visitas('a', 1, 'prueba167a', interval '1 hour');
insert into _r167 (caso, ok, detalle)
select '2 con la 5.ª visita → tarjeta con el link y el nombre del local de la visita',
       (r->>'url') = (select url from _c167) and (r->>'local') = 'Local Ficticio A', r::text
  from (select pg_temp.res('a') r) x;

-- 3. las visitas SIN beneficio no cuentan (paga con créditos, como invitado, sin promoción)
select pg_temp.socio('b');
select pg_temp.visitas('b', 4, 'prueba167a', interval '3 days');
select pg_temp.visitas('b', 1, 'prueba167a', interval '2 days', 'paga_con_creditos');
select pg_temp.visitas('b', 1, 'prueba167a', interval '1 day', 'como_invitado');
select pg_temp.visitas('b', 1, 'prueba167a', interval '1 hour', 'sin_promocion');
insert into _r167 (caso, ok, detalle) select '3 4 con beneficio + 3 sin beneficio → sin tarjeta', r = 'null'::jsonb, r::text
  from (select pg_temp.res('b') r) x;

-- 4. el local de la ÚLTIMA visita sin link → no se muestra (aunque los otros locales tengan)
select pg_temp.socio('c');
select pg_temp.visitas('c', 4, 'prueba167a', interval '2 days');
select pg_temp.visitas('c', 1, 'prueba167b', interval '1 hour');
insert into _r167 (caso, ok, detalle) select '4 última visita en un local sin link → sin tarjeta', r = 'null'::jsonb, r::text
  from (select pg_temp.res('c') r) x;

-- 5. «mostrada» deja UN pedido y la tarjeta sigue a la vista (misma visita) hasta que la cierra
select pg_temp.marcar('a', 'mostrada');
select pg_temp.marcar('a', 'mostrada');
insert into _r167 (caso, ok, detalle)
select '5 mostrada (dos veces) → un solo pedido, sin cerrar; la tarjeta sigue',
       pg_temp.pedidos('a') = 1 and (pg_temp.res('a')->>'url') is not null
       and exists (select 1 from public.club_resena_socio where miembro_id = pg_temp.sid('a') and cerrada_en is null and clic_en is null
                    and location_id = 'prueba167a'),
       'pedidos ' || pg_temp.pedidos('a');

-- 6. «cerrada» → no vuelve
select pg_temp.marcar('a', 'cerrada');
insert into _r167 (caso, ok, detalle)
select '6 cerrada → sin tarjeta y el pedido queda cerrado', pg_temp.res('a') = 'null'::jsonb
       and exists (select 1 from public.club_resena_socio where miembro_id = pg_temp.sid('a') and cerrada_en is not null),
       pg_temp.res('a')::text;

-- 7. 5 visitas más, pero dentro de los 90 días → no vuelve
select pg_temp.visitas('a', 5, 'prueba167a', interval '1 minute');
insert into _r167 (caso, ok, detalle) select '7 otras 5 visitas dentro de los 90 días → sin tarjeta', pg_temp.res('a') = 'null'::jsonb,
       pg_temp.res('a')::text;

-- 8. pasados 91 días desde el pedido → vuelve, con la visita nueva (otro pedido)
update public.club_resena_socio set mostrada_en = now() - interval '91 days' where miembro_id = pg_temp.sid('a');
select pg_temp.marcar('a', 'mostrada');
insert into _r167 (caso, ok, detalle)
select '8 pasados 91 días y 5 visitas nuevas → vuelve (pedido nuevo, otra visita)',
       (pg_temp.res('a')->>'url') is not null and pg_temp.pedidos('a') = 2
       and (select count(distinct visita_id) from public.club_resena_socio where miembro_id = pg_temp.sid('a')) = 2,
       'pedidos ' || pg_temp.pedidos('a');

-- 9. pasados 91 días pero solo 4 visitas desde la que disparó el pedido anterior → no vuelve
select pg_temp.socio('d');
select pg_temp.visitas('d', 5, 'prueba167a', interval '100 days');
select pg_temp.marcar('d', 'cerrada');      -- sin «mostrada» antes: igual deja el pedido, cerrado
update public.club_resena_socio set mostrada_en = now() - interval '99 days' where miembro_id = pg_temp.sid('d');
select pg_temp.visitas('d', 4, 'prueba167a', interval '1 hour');
insert into _r167 (caso, ok, detalle)
select '9 a los 99 días con solo 4 visitas nuevas → sin tarjeta (cuenta desde el pedido anterior)',
       pg_temp.res('d') = 'null'::jsonb and pg_temp.pedidos('d') = 1, pg_temp.res('d')::text;

-- 10. «clic» → marca la hora una sola vez y la tarjeta no vuelve
select pg_temp.socio('e');
select pg_temp.visitas('e', 5, 'prueba167a', interval '1 hour');
select pg_temp.marcar('e', 'mostrada');
update public.club_resena_socio set clic_en = timestamptz '2001-01-01 12:00-06' where miembro_id = pg_temp.sid('e');
select pg_temp.marcar('e', 'clic');
insert into _r167 (caso, ok, detalle)
select '10 clic: no pisa la marca anterior y la tarjeta no vuelve',
       (select clic_en = timestamptz '2001-01-01 12:00-06' from public.club_resena_socio where miembro_id = pg_temp.sid('e'))
       and pg_temp.res('e') = 'null'::jsonb, null;
select pg_temp.socio('f');
select pg_temp.visitas('f', 5, 'prueba167a', interval '1 hour');
select pg_temp.marcar('f', 'clic');
insert into _r167 (caso, ok, detalle)
select '10b clic sin «mostrada» → deja el pedido con la hora del clic',
       exists (select 1 from public.club_resena_socio where miembro_id = pg_temp.sid('f') and clic_en = now())
       and pg_temp.res('f') = 'null'::jsonb, null;

-- 11. equipo (D7): ni por tipo ni por rol, aunque tenga el rol socio activo y 5 visitas
select pg_temp.socio('g', 'equipo');
select pg_temp.visitas('g', 5, 'prueba167a', interval '1 hour');
select pg_temp.socio('h');
insert into public.club_miembro_roles (miembro_id, rol, estado) values (pg_temp.sid('h'), 'equipo', 'activo');
select pg_temp.visitas('h', 5, 'prueba167a', interval '1 hour');
select pg_temp.marcar('g', 'mostrada'); select pg_temp.marcar('h', 'mostrada');
insert into _r167 (caso, ok, detalle)
select '11 equipo (tipo o rol) con 5 visitas → sin tarjeta y no se marca nada',
       pg_temp.res('g') = 'null'::jsonb and pg_temp.res('h') = 'null'::jsonb and pg_temp.pedidos('g') = 0 and pg_temp.pedidos('h') = 0,
       pg_temp.res('g')::text || ' · ' || pg_temp.res('h')::text;

-- 12. socio pendiente (sin validar) → sin tarjeta
select pg_temp.socio('i');
update public.club_miembro_roles set estado = 'pendiente' where miembro_id = pg_temp.sid('i') and rol = 'socio';
select pg_temp.visitas('i', 5, 'prueba167a', interval '1 hour');
insert into _r167 (caso, ok, detalle) select '12 socio pendiente con 5 visitas → sin tarjeta', pg_temp.res('i') = 'null'::jsonb, null;

-- 13. marcar sin que toque → no deja nada y responde igual
insert into _r167 (caso, ok, detalle)
select '13 marcar sin que toque → {ok:true} y ningún pedido',
       pg_temp.marcar('b', 'mostrada') = '{"ok": true}'::jsonb and pg_temp.marcar('b', 'clic') = '{"ok": true}'::jsonb
       and pg_temp.pedidos('b') = 0, null;

-- 14. sin header de club-web, token mal formado o acción inválida → error; y no marca
do $$
declare v1 boolean := false; v2 boolean := false; v3 boolean := false; v4 boolean := false;
begin
  perform set_config('request.headers', '{}', true);
  begin perform public.club_portal(pg_temp.tok('c')); exception when others then v1 := sqlerrm = 'Enlace no válido'; end;
  begin perform public.club_portal_resena(pg_temp.tok('c'), 'mostrada'); exception when others then v2 := sqlerrm = 'Enlace no válido'; end;
  perform set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-167-0123456789abcdef"}', true);
  begin perform public.club_portal_resena('nada', 'mostrada'); exception when others then v3 := sqlstate = 'P0001'; end;
  begin perform public.club_portal_resena(pg_temp.tok('c'), 'borrar'); exception when others then v4 := sqlstate = 'P0001'; end;
  insert into _r167 (caso, ok, detalle) values ('14 sin header, token mal formado o acción inválida → error',
    v1 and v2 and v3 and v4, v1 || ' ' || v2 || ' ' || v3 || ' ' || v4);
end $$;

-- 15. como anon (lo que usa club-web): ve la tarjeta y marca por las funciones; la tabla y las internas, cerradas
select pg_temp.socio('j');
select pg_temp.visitas('j', 5, 'prueba167a', interval '1 hour');
create temp table _t167 on commit drop as select pg_temp.tok('j') as tok, pg_temp.sid('j') as id;
grant select on _t167 to anon;
do $$
declare v_j jsonb; v_tabla boolean := false; v_datos boolean := false; v_toca boolean := false; v_tok text; v_id uuid;
begin
  select tok, id into v_tok, v_id from _t167;
  set local role anon;
  v_j := public.club_portal(v_tok);
  perform public.club_portal_resena(v_tok, 'mostrada');
  begin perform 1 from public.club_resena_socio limit 1; exception when insufficient_privilege then v_tabla := true; end;
  begin perform public.club_portal_datos(v_tok); exception when insufficient_privilege then v_datos := true; end;
  begin perform public.club_resena_socio_toca(v_id); exception when insufficient_privilege then v_toca := true; end;
  reset role;
  insert into _r167 (caso, ok, detalle) values ('15 anon: portal con tarjeta y marca; tabla, datos y toca → permission denied',
    (v_j->'resena'->>'url') is not null and v_tabla and v_datos and v_toca
    and exists (select 1 from public.club_resena_socio where miembro_id = v_id),
    'resena ' || coalesce(v_j->>'resena', 'null') || ' · tabla ' || v_tabla || ' · datos ' || v_datos || ' · toca ' || v_toca);
exception when others then
  reset role;
  insert into _r167 (caso, ok, detalle) values ('15 anon: portal con tarjeta y marca; tabla, datos y toca → permission denied', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 16. config: el owner cambia N (queda en club_auditoria); sin rol, 0 filas; el CHECK frena valores fuera de rango
do $$
declare v_owner int; v_otro int; v_aud int; v_chk1 boolean := false; v_chk2 boolean := false; v_n3 boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c167), 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.club_config_global set resena_socio_cada = 3;
  get diagnostics v_owner = row_count;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8167-0000000000ff', 'role', 'authenticated')::text, true);
  update public.club_config_global set resena_socio_cada = 7;
  get diagnostics v_otro = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_aud from public.club_auditoria a
   where a.tabla = 'club_config_global' and (a.antes->>'resena_socio_cada') = '5' and (a.despues->>'resena_socio_cada') = '3';
  begin update public.club_config_global set resena_socio_cada = 0; exception when check_violation then v_chk1 := true; end;
  begin update public.club_config_global set resena_socio_espera_dias = 10; exception when check_violation then v_chk2 := true; end;
  -- con N = 3, un socio con 3 visitas ya la ve
  perform pg_temp.socio('k');
  perform pg_temp.visitas('k', 3, 'prueba167a', interval '1 hour');
  v_n3 := (pg_temp.res('k')->>'url') is not null;
  update public.club_config_global set resena_socio_cada = 5;
  insert into _r167 (caso, ok, detalle) values ('16 owner cambia N (queda en la auditoría) · sin rol 0 filas · CHECK 1–50 y 30–365 · con N=3 toca a las 3',
    v_owner = 1 and v_otro = 0 and v_aud = 1 and v_chk1 and v_chk2 and v_n3 and pg_temp.res('k') = 'null'::jsonb,
    'owner ' || v_owner || ' · sin rol ' || v_otro || ' · auditoría ' || v_aud || ' · check ' || v_chk1 || '/' || v_chk2 || ' · n3 ' || v_n3);
exception when others then
  reset role;
  insert into _r167 (caso, ok, detalle) values ('16 owner cambia N (queda en la auditoría) · sin rol 0 filas · CHECK 1–50 y 30–365 · con N=3 toca a las 3', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 17. las claves de antes no cambian (150 o 157): club_portal = club_portal_datos + `resena`
insert into _r167 (caso, ok, detalle)
select '17 club_portal = club_portal_datos + «resena» (nada más)',
       bool_and((public.club_portal(pg_temp.tok(p)) - 'resena') = public.club_portal_datos(pg_temp.tok(p))
                and public.club_portal(pg_temp.tok(p)) ? 'resena'
                and not public.club_portal_datos(pg_temp.tok(p)) ? 'resena'), null
  from unnest(array['a', 'c', 'g', 'j']) p;

-- 18. ROLLBACK: se corre el cuerpo de scripts/sql/167_rollback.sql y club_portal vuelve a ser la de antes (md5), sin
-- envoltorio, sin tabla, sin columnas, sin las funciones nuevas, y con anon igual que antes.
-- @@167R@@   (aquí va el cuerpo de 167_rollback.sql sin begin/commit)
insert into _r167 (caso, ok, detalle)
select '18 rollback: club_portal = la de antes (md5) · sin tabla, columnas ni funciones de la 167 · anon sigue',
       md5(pg_get_functiondef('public.club_portal(text)'::regprocedure)) = p.md5_portal
       and has_function_privilege('anon', 'public.club_portal(text)', 'EXECUTE')
       and to_regprocedure('public.club_portal_datos(text)') is null
       and to_regprocedure('public.club_portal_resena(text,text)') is null
       and to_regprocedure('public.club_resena_socio_toca(uuid)') is null
       and to_regclass('public.club_resena_socio') is null
       and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_config_global'
                        and column_name in ('resena_socio_cada', 'resena_socio_espera_dias')),
       'md5 antes ' || p.md5_portal || ' · después ' || md5(pg_get_functiondef('public.club_portal(text)'::regprocedure))
  from _p167 p;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r167;

-- ASSERT: si algún caso falla, la transacción aborta y dice cuáles
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r167 where ok is not true;   -- null = falla
  if v is not null then raise exception '167-FALLAN: %', v; end if;
  if (select count(*) from _r167) <> 21 then raise exception '167-FALLAN: se esperaban 21 casos (NO PROBADO)'; end if;
end $$;
rollback;
