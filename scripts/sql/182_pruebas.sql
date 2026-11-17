-- 182_pruebas (origen club 127) · «Reservar una mesa» para TODO anfitrión: club_portal devuelve `reserva_url` arriba
-- (el link del local del anfitrión). Arma datos ficticios, mide ANTES, aplica la 182 dentro de la transacción, prueba,
-- corre el rollback y termina en ROLLBACK: no deja nada. Al final un ASSERT: cada caso caído sale como WARNING
-- («182 FALLA <caso> — <detalle>»), después el resumen («182 RESUMEN: pasaron X / fallaron Y de N») y, si Y > 0 o faltan
-- casos, ABORTA con «182-FALLAN: <casos> · pasaron X / fallaron Y». Se corre con scripts/sql/182_pruebas.py (--local, o
-- --armar para staging). Necesita la 180 en la base y NO la 182.
--
-- MARCADORES que llena el runner: «-- @@182@@» → cuerpo de supabase/migrations/182_… sin begin/commit (con --mutar, con
-- el arreglo deshecho a propósito); «-- @@182R@@» → cuerpo de scripts/sql/182_rollback.sql sin begin/commit ni el delete
-- del ledger.
--
-- Todo ficticio: locales prueba182st (link de OpenTable), prueba182no (otro link), prueba182sin (sin link) y prueba182vie
-- (un link que no es de OpenTable, puesto sin el trigger de la 180 dentro de la transacción). En cada local: un
-- socio puro, un anfitrión puro, un anfitrión que además es socio, una cuenta del equipo y un anfitrión con el rol de
-- baja. Links de OpenTable con rid ficticios (999xxxx).
begin;
create temp table _r182 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r182 to anon, authenticated;
grant usage on sequence _r182_n_seq to anon, authenticated;

create temp table _c182 on commit drop as
select 'https://www.opentable.com/restref/client/?rid=9990182&lang=es-MX&ot_source=Club%20Satori&ot_campaign=club'::text as url_st,
       'https://www.opentable.com.mx/r/local-ficticio-182?ot_source=Club&ot_campaign=club'::text as url_no;
grant select on _c182 to anon, authenticated;

insert into public.locations (id, name) values
  ('prueba182st', 'Local Ficticio ST'), ('prueba182no', 'Local Ficticio NO'), ('prueba182sin', 'Local Ficticio Sin'),
  ('prueba182vie', 'Local Ficticio Viejo')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba182st', 'Local Ficticio ST', true), ('prueba182no', 'Local Ficticio NO', true),
  ('prueba182sin', 'Local Ficticio Sin', true), ('prueba182vie', 'Local Ficticio Viejo', true)
on conflict (location_id) do nothing;
update public.club_config set reserva_url = (select url_st from _c182) where location_id = 'prueba182st';
update public.club_config set reserva_url = (select url_no from _c182) where location_id = 'prueba182no';
-- un link viejo que no es de OpenTable (la 180 ya no deja guardarlo: solo para armar el caso se saltan los triggers de
-- esta sentencia con session_replication_role, dentro de la transacción descartada; el conector de staging cancela un
-- «alter table … disable trigger»)
set local session_replication_role = replica;
update public.club_config set reserva_url = 'https://reservas.ejemplo.test/r?rid=182' where location_id = 'prueba182vie';
set local session_replication_role = origin;
update public.club_config_global set club_url = 'https://club.ejemplo.test' where club_url is null;

-- miembros por local: socio puro, anfitrión puro, anfitrión + socio, equipo, anfitrión con el rol de baja
create temp table _m182 (clave text primary key, id uuid, loc text) on commit drop;
grant select on _m182 to anon, authenticated;
do $$
declare v uuid; l text;
begin
  foreach l in array array['st', 'no', 'sin', 'vie'] loop
    insert into public.club_miembros (location_id, tipo, nombre) values ('prueba182' || l, 'socio', 'Socio Ficticio ' || l) returning id into v;
    insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por) values (v, 'socio', 'activo', 'caja')
      on conflict (miembro_id, rol) do update set estado = 'activo';
    insert into _m182 values ('socio_' || l, v, 'prueba182' || l);

    insert into public.club_miembros (location_id, tipo, nombre) values ('prueba182' || l, 'referente', 'Anfitrion Ficticio ' || l) returning id into v;
    insert into public.club_miembro_roles (miembro_id, rol, estado) values (v, 'referente', 'activo')
      on conflict (miembro_id, rol) do update set estado = 'activo';
    insert into _m182 values ('anf_' || l, v, 'prueba182' || l);

    insert into public.club_miembros (location_id, tipo, nombre) values ('prueba182' || l, 'referente', 'Anfitrion Socio Ficticio ' || l) returning id into v;
    insert into public.club_miembro_roles (miembro_id, rol, estado) values (v, 'referente', 'activo')
      on conflict (miembro_id, rol) do update set estado = 'activo';
    insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por) values (v, 'socio', 'activo', 'caja')
      on conflict (miembro_id, rol) do update set estado = 'activo';
    insert into _m182 values ('anfsoc_' || l, v, 'prueba182' || l);

    insert into public.club_miembros (location_id, tipo, nombre) values ('prueba182' || l, 'equipo', 'Equipo Ficticio ' || l) returning id into v;
    insert into public.club_miembro_roles (miembro_id, rol, estado) values (v, 'equipo', 'activo')
      on conflict (miembro_id, rol) do update set estado = 'activo';
    insert into _m182 values ('equipo_' || l, v, 'prueba182' || l);

    insert into public.club_miembros (location_id, tipo, nombre) values ('prueba182' || l, 'referente', 'Anfitrion Baja Ficticio ' || l) returning id into v;
    insert into public.club_miembro_roles (miembro_id, rol, estado) values (v, 'referente', 'activo')
      on conflict (miembro_id, rol) do update set estado = 'activo';
    insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por) values (v, 'socio', 'activo', 'caja')
      on conflict (miembro_id, rol) do update set estado = 'activo';
    update public.club_miembro_roles set estado = 'baja' where miembro_id = v and rol = 'referente';
    insert into _m182 values ('anfbaja_' || l, v, 'prueba182' || l);
  end loop;
end $$;

select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-182-0123456789abcdef', 'sha256'), 'hex'));
create function pg_temp.web(p_on boolean) returns void language sql as $f$
  select set_config('request.headers', case when p_on then '{"x-club-web":"clave-de-prueba-del-club-182-0123456789abcdef"}' else '' end, true) $f$;
create function pg_temp.tok(p text) returns text language sql stable as $f$
  select m.token_portal from public.club_miembros m join _m182 x on x.id = m.id where x.clave = p $f$;
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
create function pg_temp.api() returns table (rolname text, fn text) language sql stable as $f$
  select r.rolname, p.oid::regprocedure::text from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
   where p.pronamespace = 'public'::regnamespace and has_function_privilege(r.rolname, p.oid, 'EXECUTE') $f$;

-- ── ANTES de la 182 ────────────────────────────────────────────────────────────────────────────────────────────────
create temp table _antes182 on commit drop as
select x.clave, pg_temp.portal(pg_temp.tok(x.clave)) as j from _m182 x;
create temp table _api_antes182 on commit drop as select * from pg_temp.api();
create temp table _src_antes182 on commit drop as
select p.oid::regprocedure::text as fn, p.prosrc, p.provolatile, p.prosecdef, p.proconfig, p.proacl::text as acl,
       obj_description(p.oid, 'pg_proc') as comentario
  from pg_proc p where p.oid = 'public.club_portal(text)'::regprocedure;
grant select on _antes182, _api_antes182, _src_antes182 to anon, authenticated;

-- 00. el antes es el de hoy (180): el anfitrión puro no recibe ningún link; el que es socio, solo dentro de `socio`
insert into _r182 (caso, ok, detalle)
select '00 antes: nadie recibe reserva_url arriba; anfitrión puro sin link; anfitrión+socio solo en socio.reserva_url',
       (select count(*) from _antes182 where j ? 'reserva_url') = 0
       and (select j->>'anfitrion' from _antes182 where clave = 'anf_st') = 'true'
       and (select jsonb_typeof(j->'socio') from _antes182 where clave = 'anf_st') = 'null'
       and (select j->'socio'->>'reserva_url' from _antes182 where clave = 'anfsoc_st') = (select url_st from _c182)
       and (select j->>'anfitrion' from _antes182 where clave = 'socio_st') = 'false'
       and (select j->>'anfitrion' from _antes182 where clave = 'anfbaja_st') = 'false'
       and (select j->>'anfitrion' from _antes182 where clave = 'equipo_st') = 'true',
       (select j::text from _antes182 where clave = 'anf_st');

-- @@182@@   (aquí va el cuerpo de la 182 sin begin/commit)

-- 01. anfitrión puro: recibe el link de SU local arriba, tal cual; el resto del portal idéntico al de antes
insert into _r182 (caso, ok, detalle)
select '01 anfitrión puro ST y NO: reserva_url = el link de su local, tal cual; el resto idéntico',
       (d_st->>'reserva_url') = (select url_st from _c182)
       and (d_no->>'reserva_url') = (select url_no from _c182)
       and (d_st - 'reserva_url') = (select j from _antes182 where clave = 'anf_st')
       and (d_no - 'reserva_url') = (select j from _antes182 where clave = 'anf_no'),
       concat_ws(' | ', d_st->>'reserva_url', d_no->>'reserva_url')
  from (select pg_temp.portal(pg_temp.tok('anf_st')) d_st, pg_temp.portal(pg_temp.tok('anf_no')) d_no) z;

-- 02. anfitrión que además es socio: arriba el mismo link que en `socio`; `socio.reserva_url` igual que antes
insert into _r182 (caso, ok, detalle)
select '02 anfitrión+socio: reserva_url = socio.reserva_url = el link de su local; el resto idéntico',
       (d->>'reserva_url') = (select url_st from _c182)
       and (d->'socio'->>'reserva_url') = (select url_st from _c182)
       and (d - 'reserva_url') = (select j from _antes182 where clave = 'anfsoc_st'),
       d::text
  from (select pg_temp.portal(pg_temp.tok('anfsoc_st')) d) z;

-- 03. a quien no es anfitrión no le llega nada nuevo: socio puro y anfitrión con el rol de baja, idénticos a antes
insert into _r182 (caso, ok, detalle)
select '03 socio puro y anfitrión de baja (en los 4 locales): portal idéntico a antes, sin reserva_url arriba',
       bool_and(pg_temp.portal(pg_temp.tok(a.clave)) = a.j and not pg_temp.portal(pg_temp.tok(a.clave)) ? 'reserva_url'),
       string_agg(a.clave, ',') filter (where pg_temp.portal(pg_temp.tok(a.clave)) <> a.j)
  from _antes182 a where a.clave like 'socio_%' or a.clave like 'anfbaja_%';

-- 04. sin link del local, o con uno que no es de OpenTable: la clave viene en null (nunca otro local ni el link malo)
insert into _r182 (caso, ok, detalle)
select '04 anfitrión de local sin link y de local con link no-OpenTable: reserva_url null (clave presente)',
       bool_and((d ? 'reserva_url') and jsonb_typeof(d->'reserva_url') = 'null'),
       string_agg(clave || '=' || coalesce(d->>'reserva_url', 'null'), ' | ')
  from (select x.clave, pg_temp.portal(pg_temp.tok(x.clave)) d from _m182 x
         where x.clave in ('anf_sin', 'anf_vie', 'anfsoc_sin', 'anfsoc_vie', 'equipo_sin', 'equipo_vie')) z;

-- 05. la cuenta del equipo también es anfitrión: recibe el link de su local
insert into _r182 (caso, ok, detalle)
select '05 equipo (rol no socio, activo): reserva_url = el link de su local; el resto idéntico',
       (pg_temp.portal(pg_temp.tok('equipo_no'))->>'reserva_url') = (select url_no from _c182)
       and (pg_temp.portal(pg_temp.tok('equipo_no')) - 'reserva_url') = (select j from _antes182 where clave = 'equipo_no'),
       pg_temp.portal(pg_temp.tok('equipo_no'))->>'reserva_url';

-- 06. el link sigue al local: cambiar el link de NO cambia el portal del anfitrión de NO y no el de ST
do $$ declare a text; b text;
begin
  update public.club_config set reserva_url = (select url_st from _c182) || '&x=no' where location_id = 'prueba182no';
  a := pg_temp.portal(pg_temp.tok('anf_no'))->>'reserva_url';
  b := pg_temp.portal(pg_temp.tok('anf_st'))->>'reserva_url';
  update public.club_config set reserva_url = (select url_no from _c182) where location_id = 'prueba182no';
  insert into _r182 (caso, ok, detalle) values ('06 el link sale del local del anfitrión al momento (NO cambia; ST no)',
    a = (select url_st from _c182) || '&x=no' and b = (select url_st from _c182), concat_ws(' | ', a, b));
exception when others then
  insert into _r182 (caso, ok, detalle) values ('06 (error sin atrapar)', false, sqlerrm);
end $$;

-- 07. permisos iguales: la API ejecuta lo mismo; club_portal mismo ACL, SECURITY DEFINER y search_path; sin portón → error
insert into _r182 (caso, ok, detalle)
select '07 la API ejecuta lo mismo que antes; club_portal mismo ACL/definer/config; sin x-club-web → «Enlace no válido»',
       not exists (select * from pg_temp.api() except select * from _api_antes182)
       and not exists (select * from _api_antes182 except select * from pg_temp.api())
       and (select p.proacl::text = a.acl and p.prosecdef = a.prosecdef and p.provolatile = a.provolatile
                   and p.proconfig is not distinct from a.proconfig
              from pg_proc p join _src_antes182 a on a.fn = p.oid::regprocedure::text)
       and pg_temp.error_de(format('select pg_temp.portal(%L, false)', pg_temp.tok('anf_st'))) like '%Enlace no válido%'
       and pg_temp.error_de('select pg_temp.portal(''no-es-un-token'')') like '%Enlace no válido%',
       (select string_agg(rolname || ':' || fn, ',') from (select * from pg_temp.api() except select * from _api_antes182) z);

-- 08. vuelta atrás (en esta misma transacción descartada)
-- @@182R@@   (aquí va el cuerpo de scripts/sql/182_rollback.sql sin begin/commit)
insert into _r182 (caso, ok, detalle)
select '08 rollback: club_portal byte a byte la de la 180 (cuerpo, ACL, comentario) y todos los portales = antes',
       (select count(*) from pg_proc p join _src_antes182 a on a.fn = p.oid::regprocedure::text
         where p.prosrc = a.prosrc and p.prosecdef = a.prosecdef and p.provolatile = a.provolatile
           and p.proconfig is not distinct from a.proconfig and p.proacl::text is not distinct from a.acl
           and obj_description(p.oid, 'pg_proc') is not distinct from a.comentario) = 1
       and not exists (select * from pg_temp.api() except select * from _api_antes182)
       and (select bool_and(pg_temp.portal(pg_temp.tok(a.clave)) = a.j) from _antes182 a),
       (select string_agg(a.clave, ',') from _antes182 a where pg_temp.portal(pg_temp.tok(a.clave)) <> a.j);

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r182;
-- ASSERT (sin «exception when others»: si lo tuviera se tragaría su propio raise; scripts/sql/baterias_assert.test.ts)
do $$
declare
  r record;
  v_esp constant int := 9;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _r182 where ok is not true order by n loop   -- null = falla
    raise warning '182 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r182;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '182 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice '182 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception '182-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;

rollback;
