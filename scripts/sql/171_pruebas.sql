-- 171_pruebas (origen club 117) · STAGING o base local. Aplica la 171 dentro de una transacción, prueba y termina en
-- ROLLBACK: no deja nada. Devuelve un JSON con cada caso y al final un ASSERT: si algún caso falla, aborta con
-- «171-FALLAN: <casos>». Se corre con scripts/sql/171_pruebas.py (staging, o --local con psql), o a mano con el SQL
-- armado (171_pruebas.py --armar).
--
-- MARCADOR que llena el runner: la línea «-- @@171@@ …» → el cuerpo de
-- supabase/migrations/171_club_miembro_guardar_reune_156_157.sql sin begin; / commit;. Con --mutar, ese cuerpo va con el
-- arreglo deshecho a propósito (y sin su verificación final, para que caigan los CASOS y no la migración).
--
-- Sirve con y sin la 170 (envoltorio + club_miembro_guardar__nucleo) y con y sin la 163 (club_miembro_guardar_v2): los
-- casos de cada una corren solo si su función existe, y la cantidad esperada de casos cambia con eso.
-- Usa un owner ACTIVO, un perfil manager (se activa SOLO dentro de la transacción) y el local con el Club encendido; con
-- la 170, además un manager de OTRO local (el que no tenga ese local en mis_locales()). Si falta alguno, el 00 falla:
-- NO PROBADO no da verde. Las llamadas van con `set local role authenticated` y el JWT simulado.
-- Miembros de prueba con nombres ficticios, creados adentro (sin teléfonos).
begin;
create temp table _r171 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _j171 (paso text primary key, j jsonb, err text) on commit drop;
create temp table _c171 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       (select p.id from public.profiles p where p.role::text = 'manager' order by p.is_active desc, p.id limit 1) as manager_id,
       (select c.location_id from public.club_config c where c.club_activo order by c.location_id limit 1) as loc,
       null::uuid as otro_manager_id,
       null::uuid as socio, null::uuid as socio_baja, null::uuid as socio_anf, null::uuid as ref_equipo,
       null::uuid as eq_baja, null::uuid as ex_equipo, null::uuid as ref_baja, null::uuid as socio_v2,
       null::text as tok_socio, null::text as tok_socio_anf, null::text as tok_ref, null::text as tok_v2;
grant all on _r171, _j171, _c171 to authenticated;
grant usage on sequence _r171_n_seq to authenticated;
-- el manager se activa solo acá (profiles_guarda_roles pide JWT de un owner activo)
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c171), 'role', 'authenticated')::text, true);
update public.profiles set is_active = true where id = (select manager_id from _c171);
select set_config('request.jwt.claims', '', true);
-- con la 170: un manager cuyo mis_locales() NO tiene el local de la prueba (si no hay, el 00 cae)
update _c171 set otro_manager_id = (
  select p.id from public.profiles p
   where p.role::text = 'manager' and p.is_active and p.id <> _c171.manager_id
     and exists (select 1 from public.profile_locations pl where pl.profile_id = p.id)
     and not exists (select 1 from public.profile_locations pl where pl.profile_id = p.id and pl.location_id = _c171.loc)
   order by p.id limit 1);

-- @@171@@   (aquí va el cuerpo de la 171 sin begin/commit)

create temp table _e171 on commit drop as
select to_regprocedure('public.club_miembro_guardar__nucleo(uuid,text,text,uuid,text,jsonb,text)') is not null as con_170,
       to_regprocedure('public.club_miembro_guardar_v2(uuid,text,text,uuid,text,jsonb,boolean,text)') is not null as con_163;
grant all on _e171 to authenticated;

-- 00. prerrequisitos
insert into _r171 (caso, ok, detalle)
select '00 owner activo, manager, local con el Club encendido (y con la 170, un manager de otro local)',
       c.owner_id is not null and c.manager_id is not null and c.loc is not null and (not e.con_170 or c.otro_manager_id is not null),
       'local = ' || coalesce(c.loc, 'NINGUNO') || ' · 170 = ' || e.con_170 || ' · 163 = ' || e.con_163
  from _c171 c, _e171 e;

-- 0. catálogo: el objeto que cambió tiene el cuerpo fusionado, definer y search_path; permisos como antes
insert into _r171 (caso, ok, detalle)
select '0 catálogo: cuerpo fusión (md5), definer, search_path; pública con EXECUTE solo authenticated; núcleo cerrado',
       md5(p.prosrc) = 'e004268dd2d2198d77a3b49cb29ecc50' and p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
       and has_function_privilege('authenticated', 'public.club_miembro_guardar(uuid,text,text,uuid,text,jsonb,text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_miembro_guardar(uuid,text,text,uuid,text,jsonb,text)', 'EXECUTE')
       and (not e.con_170 or (not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                              and not has_function_privilege('anon', p.oid, 'EXECUTE')
                              and (select position('club_exigir_local' in q.prosrc) > 0 and position('club_miembro_guardar__nucleo(' in q.prosrc) > 0
                                     from pg_proc q where q.oid = 'public.club_miembro_guardar(uuid,text,text,uuid,text,jsonb,text)'::regprocedure))),
       p.oid::regprocedure::text || ' md5 ' || md5(p.prosrc)
  from _e171 e
  join pg_proc p on p.oid = coalesce(to_regprocedure('public.club_miembro_guardar__nucleo(uuid,text,text,uuid,text,jsonb,text)'),
                                     to_regprocedure('public.club_miembro_guardar(uuid,text,text,uuid,text,jsonb,text)'));

-- Miembros de prueba (como postgres; el trigger les arma el rol)
do $$
declare c _c171%rowtype; v_pp int; v_vc int;
begin
  select * into c from _c171;
  select cf.personas_por_credito, cf.valor_credito_crc into v_pp, v_vc from public.club_config cf where cf.location_id = c.loc;
  insert into public.club_miembros (location_id, tipo, nombre) values (c.loc, 'socio', 'Socio Ficticio Editar') returning id into c.socio;
  insert into public.club_miembros (location_id, tipo, nombre) values (c.loc, 'socio', 'Socio Ficticio Baja') returning id into c.socio_baja;
  insert into public.club_miembros (location_id, tipo, nombre) values (c.loc, 'socio', 'Socio Ficticio Anfitrion') returning id into c.socio_anf;
  insert into public.club_miembros (location_id, tipo, nombre) values (c.loc, 'referente', 'Referente Ficticio Equipo') returning id into c.ref_equipo;
  insert into public.club_miembros (location_id, tipo, nombre) values (c.loc, 'equipo', 'Equipo Ficticio Baja') returning id into c.eq_baja;
  insert into public.club_miembros (location_id, tipo, nombre) values (c.loc, 'equipo', 'Ex Equipo Ficticio') returning id into c.ex_equipo;
  insert into public.club_miembros (location_id, tipo, nombre) values (c.loc, 'referente', 'Referente Ficticio Baja') returning id into c.ref_baja;
  insert into public.club_miembros (location_id, tipo, nombre) values (c.loc, 'socio', 'Socio Ficticio V2') returning id into c.socio_v2;
  -- saldos: equipo 6 (congelado por ser del equipo) · referente 5 · ex equipo: 6 antes del corte, 3 después
  insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, origen, nota)
  values (c.loc, c.eq_baja, 'ajuste', 6, v_pp, v_vc, 'app', 'prueba 171'),
         (c.loc, c.ref_baja, 'ajuste', 5, v_pp, v_vc, 'app', 'prueba 171'),
         (c.loc, c.ex_equipo, 'ajuste', 6, v_pp, v_vc, 'app', 'prueba 171');
  update public.club_miembros set tipo = 'referente' where id = c.ex_equipo;   -- sale del equipo: corte (157) a now()
  insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, origen, nota,
                                       registrado_en)
  values (c.loc, c.ex_equipo, 'ajuste', 3, v_pp, v_vc, 'app', 'prueba 171', now() + interval '1 second');
  -- el socio de baja ya está de baja
  update public.club_miembros set estado = 'baja' where id = c.socio_baja;
  select m.token_portal into c.tok_socio from public.club_miembros m where m.id = c.socio;
  select m.token_portal into c.tok_socio_anf from public.club_miembros m where m.id = c.socio_anf;
  select m.token_portal into c.tok_ref from public.club_miembros m where m.id = c.ref_equipo;
  select m.token_portal into c.tok_v2 from public.club_miembros m where m.id = c.socio_v2;
  delete from _c171; insert into _c171 select c.*;
end $$;

-- Llamadas como OWNER
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c171), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare c _c171%rowtype;
begin
  select * into c from _c171;
  begin perform public.club_miembro_guardar(c.socio, 'socio', 'Socio Ficticio Editado', null, 'activo', null, null);
        insert into _j171 values ('editar_socio', null, 'ok');
  exception when others then insert into _j171 values ('editar_socio', null, sqlstate || ' ' || sqlerrm); end;
  begin perform public.club_miembro_guardar(null, 'socio', 'Socio Ficticio Nuevo', null, 'activo', null, c.loc);
        insert into _j171 values ('crear_socio', null, 'ok');
  exception when others then insert into _j171 values ('crear_socio', null, sqlerrm); end;
  begin perform public.club_miembro_guardar(c.ref_equipo, 'socio', 'Referente Ficticio Equipo', null, 'activo', null, null);
        insert into _j171 values ('a_socio', null, 'ok');
  exception when others then insert into _j171 values ('a_socio', null, sqlerrm); end;
  begin perform public.club_miembro_guardar(c.socio_baja, 'socio', 'Socio Ficticio Baja', null, 'activo', null, null);
        insert into _j171 values ('reactivar', null, 'ok');
  exception when others then insert into _j171 values ('reactivar', null, sqlerrm); end;
  begin perform public.club_miembro_guardar(c.socio_baja, 'socio', 'Socio Ficticio Baja Editado', null, 'baja', null, null);
        insert into _j171 values ('editar_baja', null, 'ok');
  exception when others then insert into _j171 values ('editar_baja', null, sqlstate || ' ' || sqlerrm); end;
  begin perform public.club_miembro_guardar(c.socio_anf, 'referente', 'Socio Ficticio Anfitrion', null, 'activo', null, null);
        insert into _j171 values ('a_anfitrion', null, 'ok');
  exception when others then insert into _j171 values ('a_anfitrion', null, sqlstate || ' ' || sqlerrm); end;
  begin perform public.club_miembro_guardar(c.ref_equipo, 'equipo', 'Referente Ficticio Equipo', null, 'activo', null, null);
        insert into _j171 values ('ref_a_equipo', null, 'ok');
  exception when others then insert into _j171 values ('ref_a_equipo', null, sqlstate || ' ' || sqlerrm); end;
  begin perform public.club_miembro_guardar(c.eq_baja, 'equipo', 'Equipo Ficticio Baja', null, 'baja', null, null);
        insert into _j171 values ('baja_equipo', null, 'ok');
  exception when others then insert into _j171 values ('baja_equipo', null, sqlstate || ' ' || sqlerrm); end;
  begin perform public.club_miembro_guardar(c.ref_baja, 'referente', 'Referente Ficticio Baja', null, 'baja', null, null);
        insert into _j171 values ('baja_ref', null, 'ok');
  exception when others then insert into _j171 values ('baja_ref', null, sqlstate || ' ' || sqlerrm); end;
  begin perform public.club_miembro_guardar(c.ex_equipo, 'referente', 'Ex Equipo Ficticio', null, 'baja', null, null);
        insert into _j171 values ('baja_ex_equipo', null, 'ok');
  exception when others then insert into _j171 values ('baja_ex_equipo', null, sqlstate || ' ' || sqlerrm); end;
end $$;
reset role;

-- MANAGER del local: «Editar» un socio también le anda (el error de prod lo veía el manager)
select set_config('request.jwt.claims', json_build_object('sub', (select manager_id from _c171), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin perform public.club_miembro_guardar((select socio from _c171), 'socio', 'Socio Ficticio Manager', null, null, null, null);
        insert into _j171 values ('manager_editar', null, 'ok');
  exception when others then insert into _j171 values ('manager_editar', null, sqlstate || ' ' || sqlerrm); end;
end $$;
reset role;

-- 170: un manager de OTRO local no edita por id (el envoltorio sigue)
do $$
begin
  if not (select con_170 from _e171) then return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', (select otro_manager_id from _c171), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.club_miembro_guardar((select socio from _c171), 'socio', 'Socio Ficticio Ajeno', null, null, null, null);
        insert into _j171 values ('otro_local', null, 'ok');
  exception when others then insert into _j171 values ('otro_local', null, sqlstate); end;
  reset role;
end $$;

-- 163: club_miembro_guardar_v2 (envuelve a la pública) sigue andando: editar socio y socio → anfitrión
do $$
begin
  if not (select con_163 from _e171) then return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c171), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute 'select public.club_miembro_guardar_v2($1, ''socio'', ''Socio Ficticio V2 Editado'', null, ''activo'', null, null, null)'
          using (select socio_v2 from _c171);
        insert into _j171 values ('v2_editar', null, 'ok');
  exception when others then insert into _j171 values ('v2_editar', null, sqlstate || ' ' || sqlerrm); end;
  begin execute 'select public.club_miembro_guardar_v2($1, ''concierge_pm'', ''Socio Ficticio V2 Editado'', null, ''activo'', null, null, null)'
          using (select socio_v2 from _c171);
        insert into _j171 values ('v2_anfitrion', null, 'ok');
  exception when others then insert into _j171 values ('v2_anfitrion', null, sqlstate || ' ' || sqlerrm); end;
  reset role;
end $$;
select set_config('request.jwt.claims', '', true);

-- 1. «Editar» un socio como socio: guarda, sigue socio, mismo token (en prod: «Tipo no válido»)
insert into _r171 (caso, ok, detalle)
select '1 Editar socio (tipo socio): guarda, sigue socio y activo, mismo token',
       e.err = 'ok' and m.tipo = 'socio' and m.estado = 'activo' and m.token_portal = c.tok_socio,
       e.err
  from _j171 e, _c171 c join public.club_miembros m on m.id = c.socio where e.paso = 'editar_socio';
-- 2. 'socio' no se crea ni se asigna por acá
insert into _r171 (caso, ok, detalle)
select '2 crear un socio o pasar un anfitrión a socio por Editar → Tipo no válido',
       a.err like 'Tipo no válido%' and b.err like 'Tipo no válido%', 'crear: ' || a.err || ' · a socio: ' || b.err
  from _j171 a, _j171 b where a.paso = 'crear_socio' and b.paso = 'a_socio';
-- 3. LC-DES-01: socio de baja no vuelve a activo por «Editar»; editarlo sin reactivar sí
insert into _r171 (caso, ok, detalle)
select '3 socio de baja → activo por Editar: rechazado con el mensaje; editarlo dejándolo de baja: guarda, sigue de baja',
       r.err = 'Para reactivar a un socio, dalo de alta de nuevo en caja' and b.err = 'ok' and m.estado = 'baja'
       and m.nombre = 'Socio Ficticio Baja Editado',
       'reactivar: ' || r.err || ' · editar: ' || b.err || ' · estado: ' || m.estado
  from _j171 r, _j171 b, _c171 c join public.club_miembros m on m.id = c.socio_baja
 where r.paso = 'reactivar' and b.paso = 'editar_baja';
-- 4. socio → referente: token nuevo (64 hex, distinto) y auditado tipo_a_anfitrion con token_portal_regenerado
insert into _r171 (caso, ok, detalle)
select '4 Editar socio → referente: token nuevo y auditado tipo_a_anfitrion (token_portal_regenerado)',
       g.err = 'ok' and m.tipo = 'referente' and m.token_portal ~ '^[0-9a-f]{64}$' and m.token_portal <> c.tok_socio_anf
       and exists (select 1 from public.club_auditoria a where a.objeto_id = m.id and a.accion = 'tipo_a_anfitrion'
                     and a.antes->>'tipo' = 'socio' and a.despues->>'tipo' = 'referente' and a.despues->>'token_portal_regenerado' = 'true'),
       g.err
  from _j171 g, _c171 c join public.club_miembros m on m.id = c.socio_anf where g.paso = 'a_anfitrion';
-- 5. anfitrión → anfitrión (referente → equipo): sin token nuevo ni tipo_a_anfitrion; el corte del equipo (157) sí
insert into _r171 (caso, ok, detalle)
select '5 referente → equipo: mismo token, sin tipo_a_anfitrion, con la foto equipo_corte (157)',
       g.err = 'ok' and m.tipo = 'equipo' and m.token_portal = c.tok_ref
       and not exists (select 1 from public.club_auditoria a where a.objeto_id = m.id and a.accion = 'tipo_a_anfitrion')
       and exists (select 1 from public.club_auditoria a where a.objeto_id = m.id and a.accion = 'equipo_corte'
                     and a.despues->>'motivo' = 'entra_al_equipo'),
       g.err
  from _j171 g, _c171 c join public.club_miembros m on m.id = c.ref_equipo where g.paso = 'ref_a_equipo';
-- 6. D7 A (157): la baja vence solo lo canjeable: equipo 0 · referente todo (5) · ex equipo solo lo de después del corte (3)
insert into _r171 (caso, ok, detalle)
select '6 baja con D7 A: equipo no vence, referente vence 5, ex equipo vence solo 3 (lo congelado queda)',
       a.err = 'ok' and b.err = 'ok' and x.err = 'ok'
       and (select count(*) from public.club_movimientos v where v.miembro_id = c.eq_baja and v.tipo = 'vencimiento') = 0
       and (select coalesce(sum(v.personas), 0) from public.club_movimientos v where v.miembro_id = c.ref_baja and v.tipo = 'vencimiento') = -5
       and (select coalesce(sum(v.personas), 0) from public.club_movimientos v where v.miembro_id = c.ex_equipo and v.tipo = 'vencimiento') = -3,
       'equipo ' || (select coalesce(sum(v.personas), 0) from public.club_movimientos v where v.miembro_id = c.eq_baja and v.tipo = 'vencimiento')
       || ' · ref ' || (select coalesce(sum(v.personas), 0) from public.club_movimientos v where v.miembro_id = c.ref_baja and v.tipo = 'vencimiento')
       || ' · ex ' || (select coalesce(sum(v.personas), 0) from public.club_movimientos v where v.miembro_id = c.ex_equipo and v.tipo = 'vencimiento')
  from _j171 a, _j171 b, _j171 x, _c171 c where a.paso = 'baja_equipo' and b.paso = 'baja_ref' and x.paso = 'baja_ex_equipo';
-- 7. el manager del local edita un socio
insert into _r171 (caso, ok, detalle)
select '7 manager del local: Editar socio guarda', e.err = 'ok' and m.nombre = 'Socio Ficticio Manager', e.err
  from _j171 e, _c171 c join public.club_miembros m on m.id = c.socio where e.paso = 'manager_editar';
-- 8. anon: sin EXECUTE
do $$ begin
  set local role anon;
  perform public.club_miembro_guardar(null, 'referente', 'Anon Ficticio', null, null, null, null);
  reset role;
  insert into _r171 (caso, ok, detalle) values ('8 anon → permission denied (42501)', false, 'no dio error');
exception when others then
  reset role;
  insert into _r171 (caso, ok, detalle) values ('8 anon → permission denied (42501)', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;
-- 9. (solo con la 170) manager de otro local → 42501, y el socio no cambió
insert into _r171 (caso, ok, detalle)
select '9 170: manager de otro local no edita por id (42501)', o.err = '42501' and m.nombre = 'Socio Ficticio Manager', o.err
  from _e171 e, _j171 o, _c171 c join public.club_miembros m on m.id = c.socio where e.con_170 and o.paso = 'otro_local';
-- 10. (solo con la 163) club_miembro_guardar_v2: editar socio y socio → anfitrión (token nuevo) andan por la 171
insert into _r171 (caso, ok, detalle)
select '10 163: v2 edita un socio y lo pasa a anfitrión con token nuevo',
       a.err = 'ok' and b.err = 'ok' and m.tipo = 'concierge_pm' and m.token_portal <> c.tok_v2,
       'editar: ' || a.err || ' · anfitrión: ' || b.err
  from _e171 e, _j171 a, _j171 b, _c171 c join public.club_miembros m on m.id = c.socio_v2
 where e.con_163 and a.paso = 'v2_editar' and b.paso = 'v2_anfitrion';

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r171;

-- ASSERT: si algún caso falla (o falta), la transacción aborta y dice cuáles
do $$
declare v text; v_esp int := 10 + (select con_170::int + con_163::int from _e171);
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r171 where ok is not true;   -- null = falla
  if v is not null then raise exception '171-FALLAN: %', v; end if;
  if (select count(*) from _r171) <> v_esp then
    raise exception '171-FALLAN: se esperaban % casos y hay %', v_esp, (select count(*) from _r171);
  end if;
end $$;
rollback;
