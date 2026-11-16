-- 179_pruebas (origen club 124) · «Reservar» del portal del socio abre el OpenTable de SU local.
-- Arma datos ficticios, mide el portal ANTES, aplica la 179 dentro de la transacción, prueba, corre el rollback y termina
-- en ROLLBACK: no deja nada. Devuelve un JSON con cada caso y al final un ASSERT: si algún caso falla, aborta con
-- «179-FALLAN: <casos>». Se corre con scripts/sql/179_pruebas.py (--local o --armar para staging, con el OK del dueño).
-- Necesita la 167 y la 173 en la base (staging, o el Postgres 16 local armado con scripts/sql/local_armar_base.sh SIN la 179).
--
-- MARCADORES que llena el runner: «-- @@179@@» → cuerpo de supabase/migrations/179_… sin begin/commit (con --mutar, con
-- el arreglo deshecho a propósito); «-- @@179R@@» → cuerpo de scripts/sql/179_rollback.sql sin begin/commit ni el delete
-- del ledger.
--
-- Todo ficticio: locales prueba179st (hace de Santa Teresa), prueba179no (hace de Nosara), prueba179sin (sin fila de
-- configuración), prueba179nul (fila sin link) y prueba179vie (fila con un link viejo que no es de OpenTable, cargado
-- antes de la 179). Un socio activo en cada uno, un referente (no socio) en prueba179st. Links de OpenTable con rid
-- ficticios (999xxxx) y parámetros de canal inventados. Owner: el owner activo de la base (en local, --semilla-local).
begin;
create temp table _r179 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r179 to anon, authenticated;
grant usage on sequence _r179_n_seq to anon, authenticated;

create temp table _c179 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8179-0000000000a1'::uuid as manager_no,
       'https://www.opentable.com/restref/client/?rid=9990001&restref=9990001&lang=es-MX&ot_source=Club%20Satori&corrid=prueba-179'::text as url_st,
       'https://www.opentable.com/restref/client/?rid=9990002&lang=en-US&ot_source=Club&ot_campaign=socio'::text as url_no;
grant select on _c179 to anon, authenticated;

insert into public.locations (id, name) values
  ('prueba179st', 'Local Ficticio ST'), ('prueba179no', 'Local Ficticio NO'), ('prueba179sin', 'Local Ficticio Sin'),
  ('prueba179nul', 'Local Ficticio Nulo'), ('prueba179vie', 'Local Ficticio Viejo')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba179st', 'Local Ficticio ST', true), ('prueba179no', 'Local Ficticio NO', true), ('prueba179sin', 'Local Ficticio Sin', true),
  ('prueba179nul', 'Local Ficticio Nulo', true), ('prueba179vie', 'Local Ficticio Viejo', true);
update public.club_config_global set club_url = coalesce(club_url, 'https://club.ejemplo.test');
-- la 173 sembró una fila por local que existía: estos se crean después → sin fila. Se arma a mano lo de antes de la 179.
delete from public.club_cumple_config where location_id like 'prueba179%';
insert into public.club_cumple_config (location_id, reserva_url, solo_reserva) values
  ('prueba179st', 'https://www.opentable.com/restref/client/?rid=9990009', true),
  ('prueba179no', 'https://www.opentable.com/restref/client/?rid=9990009', true),
  ('prueba179nul', null, false),
  ('prueba179vie', 'https://reservas.ejemplo.test/r?rid=1', true);

-- manager ficticio de prueba179no (el owner de la base lo activa)
insert into auth.users (id, raw_user_meta_data) values ((select manager_no from _c179), '{"full_name":"Manager Ficticio NO"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c179), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager', is_active = true where id = (select manager_no from _c179);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values ((select manager_no from _c179), 'prueba179no', true);

-- socios (uno por local) y un referente en prueba179st
create temp table _m179 (clave text primary key, id uuid, loc text) on commit drop;
grant select on _m179 to anon, authenticated;
do $$
declare v uuid; l text;
begin
  foreach l in array array['st', 'no', 'sin', 'nul', 'vie'] loop
    insert into public.club_miembros (location_id, tipo, nombre) values ('prueba179' || l, 'socio', 'Socio Ficticio ' || l) returning id into v;
    insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por) values (v, 'socio', 'activo', 'caja')
      on conflict (miembro_id, rol) do update set estado = 'activo';
    insert into _m179 values ('socio_' || l, v, 'prueba179' || l);
  end loop;
  insert into public.club_miembros (location_id, tipo, nombre) values ('prueba179st', 'referente', 'Referente Ficticio') returning id into v;
  insert into public.club_miembro_roles (miembro_id, rol, estado) values (v, 'referente', 'activo') on conflict do nothing;
  insert into _m179 values ('referente', v, 'prueba179st');
end $$;

select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-179-0123456789abcdef', 'sha256'), 'hex'));
create function pg_temp.web(p_on boolean) returns void language sql as $f$
  select set_config('request.headers', case when p_on then '{"x-club-web":"clave-de-prueba-del-club-179-0123456789abcdef"}' else '' end, true) $f$;
create function pg_temp.tok(p text) returns text language sql stable as $f$
  select m.token_portal from public.club_miembros m join _m179 x on x.id = m.id where x.clave = p $f$;
-- el portal como lo llama club-web: rol anon, con el portón x-club-web (o sin él)
create function pg_temp.portal(p_tok text, p_web boolean default true) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.web(p_web);
  set local role anon;
  r := public.club_portal(p_tok);
  reset role;
  perform pg_temp.web(false);
  return r;
exception when others then
  reset role;
  perform pg_temp.web(false);
  raise;
end $f$;
create function pg_temp.error_de(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $f$;
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
-- guardar Promociones como p_uid (formulario entero, apagado, sin cortesía)
create function pg_temp.guardar(p_uid uuid, p_loc text, p_url text, p_solo boolean default true) returns jsonb language sql as $f$
  select pg_temp.como(p_uid, format('public.club_cumple_config_guardar(%L::jsonb, %L)',
    jsonb_build_object('activo', false, 'beneficio', 'postre de cortesía', 'min_personas', 5, 'dias_antes', 7,
                       'dias_despues', 7, 'uno_por_mesa', true, 'solo_reserva', p_solo, 'reserva_url', p_url, 'cortesia_id', null),
    p_loc)) $f$;
create function pg_temp.err_guardar(p_uid uuid, p_loc text, p_url text) returns text language sql as $f$
  select pg_temp.error_de(format('select pg_temp.guardar(%L::uuid, %L, %L)', p_uid, p_loc, p_url)) $f$;

-- ── ANTES de la 179 ────────────────────────────────────────────────────────────────────────────────────────────────
create temp table _antes179 on commit drop as
select x.clave, pg_temp.portal(pg_temp.tok(x.clave)) as j from _m179 x;
create temp table _err_antes179 on commit drop as
select pg_temp.error_de(format('select pg_temp.portal(%L)', repeat('ab', 32))) as token_ajeno,
       pg_temp.error_de('select pg_temp.portal(''no-es-un-token'')') as token_malo,
       pg_temp.error_de(format('select pg_temp.portal(%L, false)', pg_temp.tok('socio_st'))) as sin_porton;
-- qué puede ejecutar la API (anon y authenticated) en public
create temp table _api_antes179 on commit drop as
select r.rolname, p.oid::regprocedure::text as fn
  from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
 where p.pronamespace = 'public'::regnamespace and has_function_privilege(r.rolname, p.oid, 'EXECUTE');
create temp table _src_antes179 on commit drop as
select p.oid::regprocedure::text as fn, p.prosrc, p.provolatile, p.prosecdef, p.proconfig
  from pg_proc p where p.oid in ('public.club_portal(text)'::regprocedure, 'public.club_cumple_config_guardar(jsonb,text)'::regprocedure);
grant select on _antes179, _err_antes179, _api_antes179, _src_antes179 to anon, authenticated;

-- 00. hay owner y el antes es el de hoy: el socio no trae reserva_url
insert into _r179 (caso, ok, detalle)
select '00 hay owner activo; antes de la 179 el portal del socio no trae reserva_url y el del referente no trae socio',
       (select owner_id from _c179) is not null
       and (select count(*) from _antes179 where clave like 'socio_%' and jsonb_typeof(j->'socio') = 'object' and not (j->'socio') ? 'reserva_url') = 5
       and (select jsonb_typeof(j->'socio') from _antes179 where clave = 'referente') is distinct from 'object',
       (select j::text from _antes179 where clave = 'socio_st');

-- @@179@@   (aquí va el cuerpo de la 179 sin begin/commit)

-- 01. Promociones guarda un link de OpenTable con sus parámetros TAL CUAL (owner en ST, manager en NO, variantes)
do $$ declare a jsonb; b jsonb; c jsonb; d jsonb; e jsonb;
begin
  a := pg_temp.guardar((select owner_id from _c179), 'prueba179st', (select url_st from _c179));
  b := pg_temp.guardar((select manager_no from _c179), 'prueba179no', (select url_no from _c179));
  c := pg_temp.guardar((select owner_id from _c179), 'prueba179sin', 'https://www.opentable.com.mx/r/local-ficticio?ref=club');
  d := pg_temp.guardar((select owner_id from _c179), 'prueba179sin', 'https://restref.opentable.co.uk/client/?rid=9990003#x');
  e := pg_temp.guardar((select owner_id from _c179), 'prueba179sin', 'https://WWW.OPENTABLE.COM/booking/r?rid=9990004');
  insert into _r179 (caso, ok, detalle) values ('01 Promociones guarda el link de OpenTable tal cual (parámetros incluidos; .com.mx, .co.uk, subdominio, host en mayúsculas)',
    a->>'reserva_url' = (select url_st from _c179) and b->>'reserva_url' = (select url_no from _c179)
    and (select reserva_url from public.club_cumple_config where location_id = 'prueba179st') = (select url_st from _c179)
    and (select reserva_url from public.club_cumple_config where location_id = 'prueba179no') = (select url_no from _c179)
    and c->>'reserva_url' = 'https://www.opentable.com.mx/r/local-ficticio?ref=club'
    and d->>'reserva_url' = 'https://restref.opentable.co.uk/client/?rid=9990003#x'
    and e->>'reserva_url' = 'https://WWW.OPENTABLE.COM/booking/r?rid=9990004',
    concat_ws(' | ', a->>'reserva_url', b->>'reserva_url', c->>'reserva_url', d->>'reserva_url', e->>'reserva_url'));
exception when others then
  insert into _r179 (caso, ok, detalle) values ('01 (error sin atrapar)', false, sqlerrm);
end $$;
-- prueba179sin vuelve a no tener fila (para el caso 05)
delete from public.club_cumple_config where location_id = 'prueba179sin';

-- 02. Promociones rechaza lo que no es https de OpenTable (y no cambia la fila)
insert into _r179 (caso, ok, detalle)
select '02 Promociones rechaza http, otro dominio, opentable.com.otro, usuario@, puerto, otroopentable, javascript y > 300',
       bool_and(coalesce(e like 'P0001 El link de reserva tiene que%', false))
       and (select reserva_url from public.club_cumple_config where location_id = 'prueba179st') = (select url_st from _c179),
       string_agg(u || ' → ' || coalesce(e, 'ACEPTADO'), ' | ')
  from (select u, pg_temp.err_guardar((select owner_id from _c179), 'prueba179st', u) e
          from unnest(array[
            'http://www.opentable.com/restref/client/?rid=9990001',
            'https://reservas.ejemplo.test/r?rid=1',
            'https://www.opentable.com.otro.test/r?rid=1',
            'https://www.opentable.com@otro.test/r?rid=1',
            'https://www.opentable.com:8443/r?rid=1',
            'https://otroopentable.com/r?rid=1',
            'https://opentable.otro.test/',
            'javascript:alert(1)//opentable.com',
            'https://www.opentable.com/r?x=' || repeat('a', 300)]) u) z;

-- 03. socio del local «Santa Teresa» → su link, idéntico
insert into _r179 (caso, ok, detalle)
select '03 socio de ST: socio.reserva_url = el link de ST, idéntico (tal cual)',
       (j->'socio'->>'reserva_url') = (select url_st from _c179), j->'socio'->>'reserva_url'
  from (select pg_temp.portal(pg_temp.tok('socio_st')) j) x;

-- 04. socio del local «Nosara» → el de Nosara
insert into _r179 (caso, ok, detalle)
select '04 socio de NO: socio.reserva_url = el link de NO (no el de ST)',
       (j->'socio'->>'reserva_url') = (select url_no from _c179), j->'socio'->>'reserva_url'
  from (select pg_temp.portal(pg_temp.tok('socio_no')) j) x;

-- 05. sin fila, fila sin link y link viejo que no es de OpenTable → null (la clave está, con null)
insert into _r179 (caso, ok, detalle)
select '05 sin configuración, sin link o link viejo no-OpenTable → socio.reserva_url null',
       bool_and((j->'socio') ? 'reserva_url' and jsonb_typeof(j->'socio'->'reserva_url') = 'null'),
       string_agg(c || '=' || coalesce(j->'socio'->>'reserva_url', 'null'), ' | ')
  from (select c, pg_temp.portal(pg_temp.tok(c)) j from unnest(array['socio_sin', 'socio_nul', 'socio_vie']) c) x;

-- 06. nada más cambia: todo el portal = el de antes salvo socio.reserva_url; el referente (no socio), idéntico
insert into _r179 (caso, ok, detalle)
select '06 el portal es el de antes salvo socio.reserva_url; el referente no recibe nada nuevo',
       bool_and(case when a.clave = 'referente' then d.j = a.j
                     else (d.j #- '{socio,reserva_url}') = a.j and (select count(*) from jsonb_object_keys(d.j->'socio')) = (select count(*) from jsonb_object_keys(a.j->'socio')) + 1 end),
       string_agg(a.clave, ',') filter (where not (case when a.clave = 'referente' then d.j = a.j else (d.j #- '{socio,reserva_url}') = a.j end))
  from _antes179 a cross join lateral (select pg_temp.portal(pg_temp.tok(a.clave)) j) d;

-- 07. token inválido, token que no existe y sin portón: el mismo error que antes
insert into _r179 (caso, ok, detalle)
select '07 token ajeno, token mal formado y sin x-club-web → el mismo error de antes («Enlace no válido»)',
       d.token_ajeno = a.token_ajeno and d.token_malo = a.token_malo and d.sin_porton = a.sin_porton
       and a.token_ajeno like '%Enlace no válido%' and a.sin_porton like '%Enlace no válido%',
       concat_ws(' | ', d.token_ajeno, d.token_malo, d.sin_porton)
  from _err_antes179 a,
       (select pg_temp.error_de(format('select pg_temp.portal(%L)', repeat('ab', 32))) as token_ajeno,
               pg_temp.error_de('select pg_temp.portal(''no-es-un-token'')') as token_malo,
               pg_temp.error_de(format('select pg_temp.portal(%L, false)', pg_temp.tok('socio_st'))) as sin_porton) d;

-- 08. la API (anon y authenticated) ejecuta exactamente lo mismo que antes; la interna nueva, nadie
insert into _r179 (caso, ok, detalle)
select '08 nada nuevo ejecutable por anon ni authenticated (club_reserva_url_ok cerrada)',
       not exists (select r.rolname, p.oid::regprocedure::text from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
                    where p.pronamespace = 'public'::regnamespace and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
                   except select * from _api_antes179)
       and not exists (select * from _api_antes179 except
                       select r.rolname, p.oid::regprocedure::text from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
                        where p.pronamespace = 'public'::regnamespace and has_function_privilege(r.rolname, p.oid, 'EXECUTE'))
       and to_regprocedure('public.club_reserva_url_ok(text)') is not null
       and not has_function_privilege('anon', 'public.club_reserva_url_ok(text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_reserva_url_ok(text)', 'EXECUTE'),
       (select string_agg(r.rolname || ':' || p.oid::regprocedure::text, ',') from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
         where p.pronamespace = 'public'::regnamespace and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
           and (r.rolname, p.oid::regprocedure::text) not in (select * from _api_antes179));

-- 09. el guardado es el de la 173 + solo el bloque del dominio; el manager sigue sin poder tocar otro local
insert into _r179 (caso, ok, detalle)
select '09 club_cumple_config_guardar = la 173 + el bloque de OpenTable (mismo security definer y search_path); manager en otro local → 42501',
       replace(p.prosrc, E'  -- 179: además, de OpenTable (opentable.com y sus subdominios o variantes regionales). Se guarda TAL CUAL (con sus\n  -- parámetros: OpenTable registra por ahí el canal de entrada); no se reconstruye.\n  if v_url is not null and not public.club_reserva_url_ok(v_url) then\n    raise exception ''El link de reserva tiene que ser de OpenTable (https://www.opentable.com/…): copialo tal cual del navegador'' using errcode = ''P0001'';\n  end if;\n', '') = a.prosrc
       and p.prosecdef = a.prosecdef and p.provolatile = a.provolatile and p.proconfig = a.proconfig
       and pg_temp.err_guardar((select manager_no from _c179), 'prueba179st', (select url_no from _c179)) like '42501 %'
       and (select reserva_url from public.club_cumple_config where location_id = 'prueba179st') = (select url_st from _c179),
       pg_temp.err_guardar((select manager_no from _c179), 'prueba179st', (select url_no from _c179))
  from pg_proc p join _src_antes179 a on a.fn = 'club_cumple_config_guardar(jsonb,text)'
 where p.oid = 'public.club_cumple_config_guardar(jsonb,text)'::regprocedure;

-- 10. sin link y sin «solo con reserva» se sigue pudiendo guardar (null); con «solo con reserva», como en la 173
insert into _r179 (caso, ok, detalle)
select '10 link vacío: sin «solo con reserva» guarda null; con «solo con reserva» el error de la 173',
       (pg_temp.guardar((select owner_id from _c179), 'prueba179nul', '', false)->'reserva_url') = 'null'::jsonb
       and pg_temp.error_de(format('select pg_temp.guardar(%L::uuid, %L, %L, true)', (select owner_id from _c179), 'prueba179nul', ''))
           like 'P0001 Con «solo con reserva» hace falta el link de reserva%', null;

-- 11. vuelta atrás (en esta misma transacción descartada)
-- @@179R@@   (aquí va el cuerpo de scripts/sql/179_rollback.sql sin begin/commit)
insert into _r179 (caso, ok, detalle)
select '11 rollback: club_portal y el guardado vuelven byte a byte, sin la interna, la API como antes y el portal sin reserva_url',
       (select count(*) from pg_proc p join _src_antes179 a on a.fn = p.oid::regprocedure::text
         where p.prosrc = a.prosrc and p.prosecdef = a.prosecdef and p.provolatile = a.provolatile and p.proconfig = a.proconfig) = 2
       and to_regprocedure('public.club_reserva_url_ok(text)') is null
       and not exists (select r.rolname, p.oid::regprocedure::text from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
                        where p.pronamespace = 'public'::regnamespace and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
                       except select * from _api_antes179)
       and has_function_privilege('anon', 'public.club_portal(text)', 'EXECUTE')
       and (select bool_and(not coalesce((pg_temp.portal(pg_temp.tok(x.clave))->'socio') ? 'reserva_url', false)) from _m179 x),
       null;

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r179;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r179 where not ok or ok is null;
  if v is not null then raise exception '179-FALLAN: %', v; end if;
  if (select count(*) from _r179) < 12 then raise exception '179-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
