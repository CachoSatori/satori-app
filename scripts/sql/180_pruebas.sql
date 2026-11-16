-- 180_pruebas (origen club 125) · El link de reservas (OpenTable) es de CADA LOCAL (Club → Locales) + «Reservar una mesa»
-- en la página del cupón. Arma datos ficticios, mide ANTES, aplica la 180 dentro de la transacción, prueba, corre el
-- rollback y termina en ROLLBACK: no deja nada. Devuelve un JSON con cada caso y al final un ASSERT: si algún caso falla,
-- aborta con «180-FALLAN: <casos>». Se corre con scripts/sql/180_pruebas.py (--local, o --armar para staging con el OK
-- del dueño). Necesita la 179 en la base y NO la 180.
--
-- MARCADORES que llena el runner: «-- @@180@@» → cuerpo de supabase/migrations/180_… sin begin/commit (con --mutar, con
-- el arreglo deshecho a propósito); «-- @@180R@@» → cuerpo de scripts/sql/180_rollback.sql sin begin/commit ni el delete
-- del ledger.
--
-- Todo ficticio: locales prueba180st (hace de Santa Teresa), prueba180no (hace de Nosara), prueba180sin (sin fila de
-- cumpleaños) y prueba180vie (link viejo que no es de OpenTable en Promociones). Un socio activo y un anfitrión con un
-- cupón vigente en cada uno. Links de OpenTable con rid ficticios (999xxxx) y parámetros de canal inventados.
begin;
create temp table _r180 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r180 to anon, authenticated;
grant usage on sequence _r180_n_seq to anon, authenticated;

create temp table _c180 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8180-0000000000a1'::uuid as manager_no,
       'https://www.opentable.com/restref/client/?rid=9990101&restref=9990101&lang=es-MX&ot_source=Club%20Satori&corrid=prueba-180'::text as url_st,
       'https://www.opentable.com/restref/client/?rid=9990102&lang=en-US&ot_source=Club&ot_campaign=socio'::text as url_no,
       'https://www.opentable.com.mx/r/local-ficticio-no?ot_source=Locales&ot_campaign=cupon'::text as url_no2;
grant select on _c180 to anon, authenticated;

insert into public.locations (id, name) values
  ('prueba180st', 'Local Ficticio ST'), ('prueba180no', 'Local Ficticio NO'), ('prueba180sin', 'Local Ficticio Sin'),
  ('prueba180vie', 'Local Ficticio Viejo')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo, mapa_url) values
  ('prueba180st', 'Local Ficticio ST', true, 'https://maps.app.goo.gl/FicticioST'), ('prueba180no', 'Local Ficticio NO', true, null),
  ('prueba180sin', 'Local Ficticio Sin', true, null), ('prueba180vie', 'Local Ficticio Viejo', true, null);
update public.club_config_global set club_url = coalesce(club_url, 'https://club.ejemplo.test');
-- lo de antes de la 180: el link vive en Promociones (club_cumple_config)
delete from public.club_cumple_config where location_id like 'prueba180%';
insert into public.club_cumple_config (location_id, reserva_url, solo_reserva) values
  ('prueba180st', (select url_st from _c180), true),
  ('prueba180no', (select url_no from _c180), true),
  ('prueba180vie', 'https://reservas.ejemplo.test/r?rid=1', true);

-- manager ficticio de prueba180no (el owner de la base lo activa)
insert into auth.users (id, raw_user_meta_data) values ((select manager_no from _c180), '{"full_name":"Manager Ficticio NO"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c180), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager', is_active = true where id = (select manager_no from _c180);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values ((select manager_no from _c180), 'prueba180no', true);

-- socio + anfitrión con un cupón vigente por local
create temp table _m180 (clave text primary key, id uuid, loc text, cupon text) on commit drop;
grant select on _m180 to anon, authenticated;
do $$
declare v uuid; l text; cod text;
begin
  foreach l in array array['st', 'no', 'sin', 'vie'] loop
    insert into public.club_miembros (location_id, tipo, nombre) values ('prueba180' || l, 'socio', 'Socio Ficticio ' || l) returning id into v;
    insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por) values (v, 'socio', 'activo', 'caja')
      on conflict (miembro_id, rol) do update set estado = 'activo';
    insert into _m180 values ('socio_' || l, v, 'prueba180' || l, null);
    insert into public.club_miembros (location_id, tipo, nombre) values ('prueba180' || l, 'referente', 'Anfitrion Ficticio ' || l) returning id into v;
    insert into public.club_miembro_roles (miembro_id, rol, estado) values (v, 'referente', 'activo') on conflict do nothing;
    cod := upper(rpad(translate(l, 'ilo', 'JKP'), 5, 'X')) || 'Q8Z2Y';
    insert into public.club_cupones (location_id, referente_id, codigo, estado, vence_en) values ('prueba180' || l, v, cod, 'vigente', now() + interval '7 days');
    insert into _m180 values ('anfitrion_' || l, v, 'prueba180' || l, cod);
  end loop;
end $$;

select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-180-0123456789abcdef', 'sha256'), 'hex'));
create function pg_temp.web(p_on boolean) returns void language sql as $f$
  select set_config('request.headers', case when p_on then '{"x-club-web":"clave-de-prueba-del-club-180-0123456789abcdef"}' else '' end, true) $f$;
create function pg_temp.tok(p text) returns text language sql stable as $f$
  select m.token_portal from public.club_miembros m join _m180 x on x.id = m.id where x.clave = p $f$;
create function pg_temp.cup(p text) returns text language sql stable as $f$ select cupon from _m180 where clave = 'anfitrion_' || p $f$;
-- portal y cupón como los llama club-web: rol anon, con el portón x-club-web (o sin él)
create function pg_temp.anon(p_fn text, p_arg text, p_web boolean default true) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.web(p_web);
  set local role anon;
  execute format('select public.%I(%L)', p_fn, p_arg) into r;
  reset role;
  perform pg_temp.web(false);
  return r;
exception when others then
  reset role;
  perform pg_temp.web(false);
  raise;
end $f$;
create function pg_temp.portal(p_tok text) returns jsonb language sql as $f$ select pg_temp.anon('club_portal', p_tok) $f$;
create function pg_temp.cupon(p_cod text) returns jsonb language sql as $f$ select pg_temp.anon('club_cupon_ver', p_cod) $f$;
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
-- Club → Locales: el UPDATE directo que hace la app (RLS de club_config). Devuelve cuántas filas cambió.
create function pg_temp.locales(p_uid uuid, p_loc text, p_url text) returns int language plpgsql as $f$
declare n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.club_config set reserva_url = p_url where location_id = p_loc;
  get diagnostics n = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return n;
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
create function pg_temp.api() returns table (rolname text, fn text) language sql stable as $f$
  select r.rolname, p.oid::regprocedure::text from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
   where p.pronamespace = 'public'::regnamespace and has_function_privilege(r.rolname, p.oid, 'EXECUTE') $f$;

-- ── ANTES de la 180 ────────────────────────────────────────────────────────────────────────────────────────────────
create temp table _antes180 on commit drop as
select x.clave, case when x.clave like 'socio_%' then pg_temp.portal(pg_temp.tok(x.clave)) else pg_temp.cupon(x.cupon) end as j from _m180 x;
create temp table _api_antes180 on commit drop as select * from pg_temp.api();
create temp table _src_antes180 on commit drop as
select p.oid::regprocedure::text as fn, p.prosrc, p.provolatile, p.prosecdef, p.proconfig, p.proacl::text as acl
  from pg_proc p where p.oid in ('public.club_portal(text)'::regprocedure, 'public.club_cumple_config_guardar(jsonb,text)'::regprocedure,
                                 'public.club_cumple_cfg_json(public.club_cumple_config)'::regprocedure, 'public.club_cupon_ver(text)'::regprocedure);
create temp table _cols_antes180 on commit drop as
select attname from pg_attribute where attrelid = 'public.club_config'::regclass and attnum > 0 and not attisdropped;
grant select on _antes180, _api_antes180, _src_antes180, _cols_antes180 to anon, authenticated;

-- 00. hay owner y el antes es el de hoy (179): el portal lee Promociones; el cupón no trae local.reserva
insert into _r180 (caso, ok, detalle)
select '00 hay owner; antes: portal ST/NO = link de Promociones, sin/viejo = null; el cupón no trae local.reserva',
       (select owner_id from _c180) is not null
       and (select j->'socio'->>'reserva_url' from _antes180 where clave = 'socio_st') = (select url_st from _c180)
       and (select j->'socio'->>'reserva_url' from _antes180 where clave = 'socio_no') = (select url_no from _c180)
       and (select count(*) from _antes180 where clave in ('socio_sin', 'socio_vie') and jsonb_typeof(j->'socio'->'reserva_url') = 'null') = 2
       and (select count(*) from _antes180 where clave like 'anfitrion_%' and jsonb_typeof(j->'local') = 'object' and not (j->'local') ? 'reserva') = 4
       and not exists (select 1 from _cols_antes180 where attname = 'reserva_url'),
       (select j::text from _antes180 where clave = 'anfitrion_st');

-- @@180@@   (aquí va el cuerpo de la 180 sin begin/commit)

-- 01. la copia: el valor migrado coincide con Promociones (solo OpenTable); la columna vieja queda igual
insert into _r180 (caso, ok, detalle)
select '01 copia: Locales ST/NO = el link de Promociones idéntico; sin fila y link viejo no-OpenTable → null; Promociones intacta',
       (select reserva_url from public.club_config where location_id = 'prueba180st') = (select url_st from _c180)
       and (select reserva_url from public.club_config where location_id = 'prueba180no') = (select url_no from _c180)
       and (select reserva_url from public.club_config where location_id = 'prueba180sin') is null
       and (select reserva_url from public.club_config where location_id = 'prueba180vie') is null
       and (select reserva_url from public.club_cumple_config where location_id = 'prueba180st') = (select url_st from _c180)
       and (select reserva_url from public.club_cumple_config where location_id = 'prueba180vie') = 'https://reservas.ejemplo.test/r?rid=1',
       (select string_agg(location_id || '=' || coalesce(reserva_url, 'null'), ' | ' order by location_id) from public.club_config where location_id like 'prueba180%');

-- 02. justo después de la migración el portal y el cupón son los de antes (el portal, idéntico; el cupón + local.reserva)
insert into _r180 (caso, ok, detalle)
select '02 recién migrado: el portal de cada socio es idéntico al de antes; el cupón = antes + solo local.reserva',
       bool_and(case when a.clave like 'socio_%' then d.j = a.j
                     else (d.j #- '{local,reserva}') = a.j and (d.j->'local') ? 'reserva' end),
       string_agg(a.clave, ',') filter (where not (case when a.clave like 'socio_%' then d.j = a.j else (d.j #- '{local,reserva}') = a.j end))
  from _antes180 a cross join lateral (select case when a.clave like 'socio_%' then pg_temp.portal(pg_temp.tok(a.clave))
                                                    else pg_temp.cupon((select cupon from _m180 where clave = a.clave)) end j) d;

-- 03. el owner cambia el link de NO en Locales → el portal del socio de NO lo usa; ST no cambia; Promociones no se toca
do $$ declare n int; b text;
begin
  n := pg_temp.locales((select owner_id from _c180), 'prueba180no', (select url_no2 from _c180));
  b := pg_temp.locales((select owner_id from _c180), 'prueba180sin', '   ')::text;   -- vacío → null
  insert into _r180 (caso, ok, detalle) values ('03 Locales (owner): el link nuevo de NO va al portal del socio de NO tal cual; ST igual; vacío → null',
    n = 1 and (pg_temp.portal(pg_temp.tok('socio_no'))->'socio'->>'reserva_url') = (select url_no2 from _c180)
    and (pg_temp.portal(pg_temp.tok('socio_st'))->'socio'->>'reserva_url') = (select url_st from _c180)
    and (select reserva_url from public.club_config where location_id = 'prueba180sin') is null
    and (select reserva_url from public.club_cumple_config where location_id = 'prueba180no') = (select url_no from _c180),
    concat_ws(' | ', n, b, pg_temp.portal(pg_temp.tok('socio_no'))->'socio'->>'reserva_url'));
exception when others then
  insert into _r180 (caso, ok, detalle) values ('03 (error sin atrapar)', false, sqlerrm);
end $$;

-- 04. Locales rechaza lo que no es https de OpenTable (y no cambia la fila); el manager no puede editar Locales
insert into _r180 (caso, ok, detalle)
select '04 Locales rechaza http, otro dominio, opentable.com.otro, usuario@, puerto, otroopentable, javascript y > 300; manager → 0 filas',
       bool_and(coalesce(e like 'P0001 El link de reservas tiene que ser de OpenTable%', false))
       and (select reserva_url from public.club_config where location_id = 'prueba180st') = (select url_st from _c180)
       and pg_temp.locales((select manager_no from _c180), 'prueba180no', (select url_st from _c180)) = 0
       and (select reserva_url from public.club_config where location_id = 'prueba180no') = (select url_no2 from _c180),
       string_agg(left(u, 50) || ' → ' || coalesce(e, 'ACEPTADO'), ' | ')
  from (select u, pg_temp.error_de(format('select pg_temp.locales(%L::uuid, %L, %L)', (select owner_id from _c180), 'prueba180st', u)) e
          from unnest(array[
            'http://www.opentable.com/restref/client/?rid=9990101',
            'https://reservas.ejemplo.test/r?rid=1',
            'https://www.opentable.com.otro.test/r?rid=1',
            'https://www.opentable.com@otro.test/r?rid=1',
            'https://www.opentable.com:8443/r?rid=1',
            'https://otroopentable.com/r?rid=1',
            'javascript:alert(1)//opentable.com',
            'https://www.opentable.com/r?x=' || repeat('a', 300)]) u) z;

-- 05. página del cupón: local.reserva = el link del local DEL CUPÓN (tal cual); sin link → null; nada más cambia
insert into _r180 (caso, ok, detalle)
select '05 cupón: ST → link de ST, NO → link nuevo de NO, sin/viejo → null; el resto del cupón = antes',
       (pg_temp.cupon(pg_temp.cup('st'))->'local'->>'reserva') = (select url_st from _c180)
       and (pg_temp.cupon(pg_temp.cup('no'))->'local'->>'reserva') = (select url_no2 from _c180)
       and jsonb_typeof(pg_temp.cupon(pg_temp.cup('sin'))->'local'->'reserva') = 'null'
       and jsonb_typeof(pg_temp.cupon(pg_temp.cup('vie'))->'local'->'reserva') = 'null'
       and (select bool_and((pg_temp.cupon(x.cupon) #- '{local,reserva}') = a.j) from _m180 x join _antes180 a using (clave) where x.cupon is not null),
       concat_ws(' | ', pg_temp.cupon(pg_temp.cup('st'))::text, pg_temp.cupon(pg_temp.cup('no'))->'local'->>'reserva');

-- 06. anon: nada nuevo ejecutable; sin portón el cupón sigue cerrado; club_config sigue sin lectura para anon
insert into _r180 (caso, ok, detalle)
select '06 la API ejecuta lo mismo que antes; trigger e interna cerradas; cupón sin x-club-web → «Cupón no válido»; anon sin club_config',
       not exists (select * from pg_temp.api() except select * from _api_antes180)
       and not exists (select * from _api_antes180 except select * from pg_temp.api())
       and to_regprocedure('public.club_config_reserva_url_validar()') is not null
       and not has_function_privilege('anon', 'public.club_config_reserva_url_validar()', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_config_reserva_url_validar()', 'EXECUTE')
       and pg_temp.error_de(format('select pg_temp.anon(''club_cupon_ver'', %L, false)', pg_temp.cup('st'))) like '%Cupón no válido%'
       and not has_table_privilege('anon', 'public.club_config', 'SELECT')
       and not has_column_privilege('anon', 'public.club_config', 'reserva_url', 'SELECT'),
       (select string_agg(rolname || ':' || fn, ',') from (select * from pg_temp.api() except select * from _api_antes180) z);

-- 07. Promociones (ver) y el aviso de cumpleaños del Inicio (WhatsApp) leen el link del LOCAL
insert into _r180 (caso, ok, detalle)
select '07 club_cumple_config_ver y club_cumple_proximos (WhatsApp) devuelven el link del local (NO: el nuevo; sin: null)',
       (pg_temp.como((select owner_id from _c180), 'public.club_cumple_config_ver(''prueba180no'')')->>'reserva_url') = (select url_no2 from _c180)
       and (pg_temp.como((select manager_no from _c180), 'public.club_cumple_proximos(''prueba180no'')')->>'reserva_url') = (select url_no2 from _c180)
       and jsonb_typeof(pg_temp.como((select owner_id from _c180), 'public.club_cumple_config_ver(''prueba180sin'')')->'reserva_url') = 'null',
       pg_temp.como((select owner_id from _c180), 'public.club_cumple_config_ver(''prueba180no'')')::text;

-- 08. guardar Promociones: el link del formulario se ignora; «solo con reserva» exige el link del local; manager ajeno → 42501
do $$ declare a jsonb; e1 text; b jsonb; e2 text;
begin
  a := pg_temp.guardar((select owner_id from _c180), 'prueba180st', 'https://reservas.ejemplo.test/otro');
  e1 := pg_temp.error_de(format('select pg_temp.guardar(%L::uuid, %L, %L, true)', (select owner_id from _c180), 'prueba180sin', (select url_st from _c180)));
  b := pg_temp.guardar((select owner_id from _c180), 'prueba180sin', null, false);
  e2 := pg_temp.error_de(format('select pg_temp.guardar(%L::uuid, %L, %L)', (select manager_no from _c180), 'prueba180st', null));
  insert into _r180 (caso, ok, detalle) values ('08 Promociones ignora reserva_url del formulario (ni Locales ni la columna vieja cambian); solo con reserva sin link del local → error; 42501 ajeno',
    (a->>'reserva_url') = (select url_st from _c180)
    and (select reserva_url from public.club_config where location_id = 'prueba180st') = (select url_st from _c180)
    and (select reserva_url from public.club_cumple_config where location_id = 'prueba180st') = (select url_st from _c180)
    and e1 like 'P0001 Con «solo con reserva» hace falta el link de reservas del local%'
    and (b->>'solo_reserva') = 'false'
    and (select reserva_url from public.club_cumple_config where location_id = 'prueba180sin') is null
    and e2 like '42501 %',
    concat_ws(' | ', a->>'reserva_url', e1, e2));
exception when others then
  insert into _r180 (caso, ok, detalle) values ('08 (error sin atrapar)', false, sqlerrm);
end $$;

-- 09. un local nuevo copiado de ST no hereda su OpenTable
create temp table _cp180 on commit drop as
select pg_temp.como((select owner_id from _c180), 'public.club_local_crear(''prueba180cp'', ''Local Ficticio Copia'', null, null, ''prueba180st'')') #>> '{}' as id;
insert into _r180 (caso, ok, detalle)
select '09 club_local_crear «copiar de» ST: el local nuevo arranca sin link de reservas',
       (select id from _cp180) = 'prueba180cp'
       and exists (select 1 from public.club_config where location_id = 'prueba180cp' and reserva_url is null),
       (select coalesce(reserva_url, 'null') from public.club_config where location_id = 'prueba180cp');

-- 10. vuelta atrás (en esta misma transacción descartada)
-- @@180R@@   (aquí va el cuerpo de scripts/sql/180_rollback.sql sin begin/commit)
insert into _r180 (caso, ok, detalle)
select '10 rollback: 4 funciones byte a byte, sin trigger ni columna, la API como antes, lo de Locales vuelve a Promociones y al portal',
       (select count(*) from pg_proc p join _src_antes180 a on a.fn = p.oid::regprocedure::text
         where p.prosrc = a.prosrc and p.prosecdef = a.prosecdef and p.provolatile = a.provolatile and p.proconfig is not distinct from a.proconfig
           and p.proacl::text is not distinct from a.acl) = 4
       and to_regprocedure('public.club_config_reserva_url_validar()') is null
       and not exists (select 1 from pg_trigger where tgname = 'club_config_reserva_url_trg')
       and not exists (select 1 from pg_attribute where attrelid = 'public.club_config'::regclass and attname = 'reserva_url' and not attisdropped)
       and not exists (select * from pg_temp.api() except select * from _api_antes180)
       and (select reserva_url from public.club_cumple_config where location_id = 'prueba180no') = (select url_no2 from _c180)
       and (pg_temp.portal(pg_temp.tok('socio_no'))->'socio'->>'reserva_url') = (select url_no2 from _c180)
       and (select bool_and(not (pg_temp.cupon(x.cupon)->'local') ? 'reserva') from _m180 x where x.cupon is not null),
       (select string_agg(a.fn, ',') from _src_antes180 a join pg_proc p on a.fn = p.oid::regprocedure::text where p.prosrc <> a.prosrc);

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r180;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r180 where not ok or ok is null;
  if v is not null then raise exception '180-FALLAN: %', v; end if;
  if (select count(*) from _r180) < 11 then raise exception '180-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
