-- 156_pruebas (origen 103) · SOLO STAGING. Aplica la 156 dentro de una transacción, prueba y termina en ROLLBACK: no
-- deja nada. Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con
-- «156-FALLAN: <casos>». Se corre con scripts/sql/156_pruebas.py, o a mano con el SQL armado (156_pruebas.py --armar).
--
-- MARCADOR que llena el runner: la línea «-- @@156@@ …» → el cuerpo de supabase/migrations/156_club_alta_caja_link_portal.sql
-- sin begin; / commit; ni su verificación final. Con --mutar, ese cuerpo va con el arreglo deshecho a propósito y sus
-- casos tienen que caer.
-- Usa un owner ACTIVO y un perfil con rol cajero (si está inactivo, se lo activa SOLO dentro de la transacción), y el
-- local con el Club encendido. Si falta alguno, el caso 00 falla: NO PROBADO no da verde. Las llamadas del cajero van
-- con `set local role authenticated` y su JWT simulado (set_config('request.jwt.claims', …, true)).
-- Personas de prueba con nombres y teléfonos ficticios (6001560x); el 00 exige que esos teléfonos no sean de nadie.
begin;
-- @@156@@   (aquí va el cuerpo de la 156 sin begin/commit)
create temp table _r156 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r156 to authenticated;
grant usage on sequence _r156_n_seq to authenticated;
create temp table _c156 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       (select p.id from public.profiles p where p.role::text = 'cajero' order by p.is_active desc, p.id limit 1) as cajero_id,
       (select c.location_id from public.club_config c where c.club_activo order by c.location_id limit 1) as loc,
       null::uuid as anfitrion_id;
-- profiles_guarda_roles (SEC-01) exige un owner activo para tocar perfiles: JWT del owner solo para esto
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c156), 'role', 'authenticated')::text, true);
update public.profiles set is_active = true where id = (select cajero_id from _c156);
select set_config('request.jwt.claims', '', true);
-- resultados de las llamadas (los escribe el bloque que corre como authenticated)
create temp table _j156 (paso text primary key, j jsonb, err text) on commit drop;
grant all on _j156, _c156 to authenticated;

-- 00. prerrequisitos
insert into _r156 (caso, ok, detalle)
select '00 owner activo, cajero, local con el Club encendido y teléfonos de prueba libres',
       owner_id is not null and cajero_id is not null and loc is not null
       and not exists (select 1 from public.club_miembros_contacto c
                        where c.telefono in (select public.club_norm_telefono(t) from unnest(array['60015601','60015602','60015603','60015604']) t)),
       'local = ' || coalesce(loc, 'NINGUNO') || ' · cajero = ' || coalesce(left(cajero_id::text, 8), 'NINGUNO')
  from _c156;

-- 0. catálogo
insert into _r156 (caso, ok, detalle)
select '0 catálogo: definer · search_path=public, pg_temp · anon sin EXECUTE · authenticated con EXECUTE · token general cerrado a anon',
       p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_miembro_token(uuid)', 'EXECUTE'),
       coalesce(p.proacl::text, 'sin acl')
  from pg_proc p where p.oid = 'public.club_socio_alta_caja(text,text,text,boolean,text)'::regprocedure;

-- anfitrión EXISTENTE (creado «hace un mes») con el teléfono 60015602: el cajero no puede llevarse su token
with m as (
  insert into public.club_miembros (location_id, tipo, nombre)
  select loc, 'referente', 'Anfitrion Prueba 156' from _c156 returning id, location_id
)
update _c156 set anfitrion_id = (select id from m);
insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email, optin_whatsapp)
select anfitrion_id, loc, public.club_norm_telefono('60015602'), null, false from _c156;
update public.club_miembros set created_at = now() - interval '30 days' where id = (select anfitrion_id from _c156);

-- como CAJERO (rol authenticated + JWT)
select set_config('request.jwt.claims', json_build_object('sub', (select cajero_id from _c156), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_loc text := (select loc from _c156); r jsonb; v_m uuid;
begin
  -- alta nueva
  begin r := public.club_socio_alta_caja('Socia Nueva Ficticia', '60015601', null, true, v_loc);
        insert into _j156 values ('nuevo', r, null);
  exception when others then insert into _j156 values ('nuevo', null, sqlstate || ' ' || sqlerrm); end;
  v_m := (select (x.j->>'miembro_id')::uuid from _j156 x where x.paso = 'nuevo');
  -- el token general NO: ni de su alta recién hecha…
  begin perform public.club_miembro_token(v_m); insert into _j156 values ('token_propio', null, 'ok');
  exception when others then insert into _j156 values ('token_propio', null, sqlstate); end;
  -- …ni de otro miembro
  begin perform public.club_miembro_token((select anfitrion_id from _c156)); insert into _j156 values ('token_otro', null, 'ok');
  exception when others then insert into _j156 values ('token_otro', null, sqlstate); end;
  -- el teléfono de un anfitrión que ya existe: club_socio_crear reusa la persona → sin token
  begin r := public.club_socio_alta_caja('Otro Nombre Ficticio', '60015602', null, true, v_loc);
        insert into _j156 values ('existente', r, null);
  exception when others then insert into _j156 values ('existente', null, sqlstate || ' ' || sqlerrm); end;
  -- otra vez el mismo número: «Ya es socio», nada de token
  begin r := public.club_socio_alta_caja('Socia Nueva Ficticia', '60015601', null, true, v_loc);
        insert into _j156 values ('repetida', r, null);
  exception when others then insert into _j156 values ('repetida', null, sqlstate || ' ' || sqlerrm); end;
  -- alta de 60015603 (después se le da de baja como owner y vuelve)
  begin r := public.club_socio_alta_caja('Socio Baja Ficticio', '60015603', null, true, v_loc);
        insert into _j156 values ('baja_1', r, null);
  exception when others then insert into _j156 values ('baja_1', null, sqlstate || ' ' || sqlerrm); end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- el socio de 60015603 se da de baja (directo, como postgres) y vuelve por caja
update public.club_miembro_roles set estado = 'baja'
 where rol = 'socio' and miembro_id = (select (j->>'miembro_id')::uuid from _j156 where paso = 'baja_1');
select set_config('request.jwt.claims', json_build_object('sub', (select cajero_id from _c156), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  begin r := public.club_socio_alta_caja('Socio Baja Ficticio', '60015603', null, true, (select loc from _c156));
        insert into _j156 values ('baja_vuelve', r, null);
  exception when others then insert into _j156 values ('baja_vuelve', null, sqlstate || ' ' || sqlerrm); end;
end $$;
reset role;
-- como OWNER: también recibe el token de la persona nueva
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c156), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  begin r := public.club_socio_alta_caja('Owner Alta Ficticia', '60015604', null, true, (select loc from _c156));
        insert into _j156 values ('owner', r, null);
  exception when others then insert into _j156 values ('owner', null, sqlstate || ' ' || sqlerrm); end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- foto del token que quedó en club_miembros al alta (antes de activarlo como anfitrión, que lo regenera)
insert into _j156 (paso, j, err)
select 'tok_alta', jsonb_build_object('t', m.token_portal), null
  from _j156 x join public.club_miembros m on m.id = (x.j->>'miembro_id')::uuid where x.paso = 'nuevo';
insert into _j156 (paso, j, err)
select 'tok_owner', jsonb_build_object('t', m.token_portal), null
  from _j156 x join public.club_miembros m on m.id = (x.j->>'miembro_id')::uuid where x.paso = 'owner';

-- el socio nuevo del cajero se activa como ANFITRIÓN (owner): el link que se le dio en el alta deja de servir.
-- Clave de club-web ficticia, solo dentro de la transacción, para llamar a club_canje_codigo_generar como lo hace club-web.
insert into public.club_web_clave (sha256) values (encode(extensions.digest('clave-de-prueba-156-0123456789abcdef', 'sha256'), 'hex'));
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c156), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_m uuid := (select (x.j->>'miembro_id')::uuid from _j156 x where x.paso = 'nuevo');
begin
  begin perform public.club_rol_activar_anfitrion(v_m, 'referente', 'Prueba 156: activar anfitrion');
        insert into _j156 values ('activar', null, 'ok');
  exception when others then insert into _j156 values ('activar', null, sqlstate || ' ' || sqlerrm); end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.headers', json_build_object('x-club-web', 'clave-de-prueba-156-0123456789abcdef')::text, true);
do $$
declare v_viejo text := (select x.j->>'token_portal' from _j156 x where x.paso = 'nuevo');
        v_nuevo text := (select m.token_portal from public.club_miembros m join _j156 x on m.id = (x.j->>'miembro_id')::uuid
                          where x.paso = 'nuevo');
begin
  begin perform public.club_canje_codigo_generar(v_viejo); insert into _j156 values ('canje_viejo', null, 'ok');
  exception when others then insert into _j156 values ('canje_viejo', null, sqlerrm); end;
  begin perform public.club_canje_codigo_generar(v_nuevo); insert into _j156 values ('canje_nuevo', null, 'ok');
  exception when others then insert into _j156 values ('canje_nuevo', null, sqlerrm); end;
end $$;
select set_config('request.headers', '', true);

-- «Editar» (club_miembro_guardar, owner) sobre el socio que dio de alta el owner (60015604):
--   editar_socio: con tipo socio (antes fallaba «Tipo no válido») · socio_crear / a_socio: 'socio' no se crea ni se asigna
--   a_anfitrion: socio → referente desde «Editar»: token nuevo; el link del alta ya no genera códigos de canje
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c156), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_m uuid := (select (x.j->>'miembro_id')::uuid from _j156 x where x.paso = 'owner');
begin
  begin perform public.club_miembro_guardar(v_m, 'socio', 'Owner Alta Editada', null, 'activo', null, null);
        insert into _j156 values ('editar_socio', null, 'ok');
  exception when others then insert into _j156 values ('editar_socio', null, sqlstate || ' ' || sqlerrm); end;
end $$;
reset role;
-- foto después de editar el socio (antes de pasarlo a referente más abajo)
insert into _j156 (paso, j, err)
select 'post_editar', jsonb_build_object('tipo', m.tipo, 'nombre', m.nombre, 'token', m.token_portal), null
  from _j156 x join public.club_miembros m on m.id = (x.j->>'miembro_id')::uuid where x.paso = 'owner';
set local role authenticated;
do $$
declare v_m uuid := (select (x.j->>'miembro_id')::uuid from _j156 x where x.paso = 'owner');
begin
  begin perform public.club_miembro_guardar(null, 'socio', 'Socio Por Editar Ficticio', null, 'activo', null, (select loc from _c156));
        insert into _j156 values ('socio_crear', null, 'ok');
  exception when others then insert into _j156 values ('socio_crear', null, sqlerrm); end;
  begin perform public.club_miembro_guardar((select anfitrion_id from _c156), 'socio', 'Anfitrion Prueba 156', null, 'activo', null, null);
        insert into _j156 values ('a_socio', null, 'ok');
  exception when others then insert into _j156 values ('a_socio', null, sqlerrm); end;
  begin perform public.club_miembro_guardar(v_m, 'referente', 'Owner Alta Editada', null, 'activo', null, null);
        insert into _j156 values ('a_anfitrion', null, 'ok');
  exception when others then insert into _j156 values ('a_anfitrion', null, sqlstate || ' ' || sqlerrm); end;
end $$;
-- LC-DES-01: el socio de 60015603 se da de baja por «Editar» y después se intenta volver a activo por ahí
do $$
declare v_m uuid := (select (x.j->>'miembro_id')::uuid from _j156 x where x.paso = 'baja_vuelve');
begin
  begin perform public.club_miembro_guardar(v_m, 'socio', 'Socio Baja Ficticio', null, 'baja', null, null);
        insert into _j156 values ('socio_a_baja', null, 'ok');
  exception when others then insert into _j156 values ('socio_a_baja', null, sqlerrm); end;
  begin perform public.club_miembro_guardar(v_m, 'socio', 'Socio Baja Ficticio', null, 'activo', null, null);
        insert into _j156 values ('socio_reactivar', null, 'ok');
  exception when others then insert into _j156 values ('socio_reactivar', null, sqlerrm); end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.headers', json_build_object('x-club-web', 'clave-de-prueba-156-0123456789abcdef')::text, true);
do $$
declare v_viejo text := (select x.j->>'t' from _j156 x where x.paso = 'tok_owner');
        v_nuevo text := (select m.token_portal from public.club_miembros m join _j156 x on m.id = (x.j->>'miembro_id')::uuid
                          where x.paso = 'owner');
begin
  begin perform public.club_canje_codigo_generar(v_viejo); insert into _j156 values ('g_canje_viejo', null, 'ok');
  exception when others then insert into _j156 values ('g_canje_viejo', null, sqlerrm); end;
  begin perform public.club_canje_codigo_generar(v_nuevo); insert into _j156 values ('g_canje_nuevo', null, 'ok');
  exception when others then insert into _j156 values ('g_canje_nuevo', null, sqlerrm); end;
end $$;
select set_config('request.headers', '', true);

-- 1. cajero, alta nueva → token_portal = el del socio recién creado (64 hex)
insert into _r156 (caso, ok, detalle)
select '1 cajero: alta nueva devuelve el token del portal de ESE socio',
       coalesce(x.j->>'token_portal' = t.j->>'t' and t.j->>'t' ~ '^[0-9a-f]{64}$', false),
       coalesce(x.err, 'token ' || case when x.j->>'token_portal' is null then 'null' else 'presente' end)
  from _j156 x left join _j156 t on t.paso = 'tok_alta' where x.paso = 'nuevo';
-- 2. queda auditado una vez como ver_link_portal, con el cajero como actor y via alta_caja
insert into _r156 (caso, ok, detalle)
select '2 auditoría: 1 fila ver_link_portal (actor cajero, via alta_caja)',
       count(*) = 1 and bool_and(a.actor = c.cajero_id and a.despues->>'via' = 'alta_caja'), count(*)::text || ' filas'
  from _c156 c, _j156 x
  join public.club_auditoria a on a.objeto_id = (x.j->>'miembro_id')::uuid and a.accion = 'ver_link_portal'
 where x.paso = 'nuevo';
-- 3. el token general sigue cerrado al cajero, también para su alta recién hecha
insert into _r156 (caso, ok, detalle)
select '3 cajero: club_miembro_token de su propia alta → 42501', err = '42501', err from _j156 where paso = 'token_propio';
-- 4. ni para otro miembro
insert into _r156 (caso, ok, detalle)
select '4 cajero: club_miembro_token de otro miembro → 42501', err = '42501', err from _j156 where paso = 'token_otro';
-- 5. teléfono de un anfitrión que ya existe → el alta reusa la persona y NO devuelve su token (ni lo audita)
insert into _r156 (caso, ok, detalle)
select '5 número de un anfitrión existente: sin token y sin ver_link_portal',
       x.err is null and (x.j->>'miembro_id')::uuid = c.anfitrion_id and x.j ? 'token_portal' and x.j->>'token_portal' is null
       and not exists (select 1 from public.club_auditoria a where a.objeto_id = c.anfitrion_id and a.accion = 'ver_link_portal'),
       coalesce(x.err, 'token ' || case when x.j->>'token_portal' is null then 'null' else 'PRESENTE' end)
  from _j156 x, _c156 c where x.paso = 'existente';
-- 6. socio dado de baja que vuelve por caja → sin token (la persona no es nueva)
insert into _r156 (caso, ok, detalle)
select '6 socio dado de baja que vuelve: sin token',
       x.err is null and (x.j->>'miembro_id') = (b.j->>'miembro_id') and x.j->>'token_portal' is null,
       coalesce(x.err, 'token ' || case when x.j->>'token_portal' is null then 'null' else 'PRESENTE' end)
  from _j156 x, _j156 b where x.paso = 'baja_vuelve' and b.paso = 'baja_1';
-- 7. la misma alta repetida: error «Ya es socio», sin respuesta ni token
insert into _r156 (caso, ok, detalle)
select '7 alta repetida del mismo número → «Ya es socio», sin token', j is null and err like 'P0001 Ya es socio%', coalesce(err, 'no dio error')
  from _j156 where paso = 'repetida';
-- 8. owner: también recibe el token de la persona nueva
insert into _r156 (caso, ok, detalle)
select '8 owner: alta nueva devuelve el token de ese socio',
       coalesce(x.j->>'token_portal' = t.j->>'t', false), coalesce(x.err, 'ok')
  from _j156 x left join _j156 t on t.paso = 'tok_owner' where x.paso = 'owner';
-- 9. las claves de antes siguen igual
insert into _r156 (caso, ok, detalle)
select '9 respuesta: miembro_id, estado activo y provisional_hasta como antes',
       coalesce(j ? 'miembro_id' and j->>'estado' = 'activo' and (j->>'provisional_hasta')::timestamptz > now(), false), null
  from _j156 where paso = 'nuevo';
-- 12. activar como anfitrión regenera el token del portal (distinto del que se entregó en el alta)
insert into _r156 (caso, ok, detalle)
select '12 activar anfitrión: token_portal nuevo, distinto del entregado en el alta',
       coalesce(a.err = 'ok' and m.token_portal ~ '^[0-9a-f]{64}$' and m.token_portal <> (x.j->>'token_portal') and m.tipo = 'referente', false),
       a.err
  from _j156 x join public.club_miembros m on m.id = (x.j->>'miembro_id')::uuid, _j156 a
 where x.paso = 'nuevo' and a.paso = 'activar';
-- 13. el link del alta ya NO genera códigos de canje; el nuevo sí llega al anfitrión (sin saldo: «no te alcanza»)
insert into _r156 (caso, ok, detalle)
select '13 el link del alta ya no genera códigos de canje; el nuevo sí llega al anfitrión',
       v.err = 'Enlace no válido' and n.err <> 'Enlace no válido', 'viejo: ' || v.err || ' · nuevo: ' || n.err
  from _j156 v, _j156 n where v.paso = 'canje_viejo' and n.paso = 'canje_nuevo';
-- 14. queda auditado: activar_anfitrion con token_portal_regenerado y el trigger con token_cambiado
insert into _r156 (caso, ok, detalle)
select '14 auditoría de la activación: token_portal_regenerado y regenerar_codigo con token_cambiado',
       exists (select 1 from public.club_auditoria a where a.objeto_id = (x.j->>'miembro_id')::uuid and a.accion = 'activar_anfitrion'
                  and a.despues->>'token_portal_regenerado' = 'true')
       and exists (select 1 from public.club_auditoria a where a.objeto_id = (x.j->>'miembro_id')::uuid and a.accion = 'regenerar_codigo'
                      and a.despues->>'token_cambiado' = 'true'),
       null
  from _j156 x where x.paso = 'nuevo';
-- 15. «Editar» sobre un socio puro (tipo socio) guarda; sigue socio y con el mismo link
insert into _r156 (caso, ok, detalle)
select '15 Editar un socio (tipo socio): guarda, sigue socio, mismo token',
       coalesce(e.err = 'ok' and f.j->>'tipo' = 'socio' and f.j->>'nombre' = 'Owner Alta Editada' and f.j->>'token' = t.j->>'t'
       and exists (select 1 from public.club_auditoria a where a.objeto_id = (x.j->>'miembro_id')::uuid and a.accion = 'edicion'), false),
       e.err
  from _j156 e, _j156 f, _j156 t, _j156 x
 where e.paso = 'editar_socio' and f.paso = 'post_editar' and t.paso = 'tok_owner' and x.paso = 'owner';
-- 16. 'socio' no se crea ni se asigna desde «Editar»
insert into _r156 (caso, ok, detalle)
select '16 Editar: crear un socio o pasar un anfitrión a socio → Tipo no válido',
       c.err like 'Tipo no válido%' and a.err like 'Tipo no válido%', 'crear: ' || c.err || ' · a socio: ' || a.err
  from _j156 c, _j156 a where c.paso = 'socio_crear' and a.paso = 'a_socio';
-- 17. socio → referente desde «Editar»: token nuevo, el link del alta ya no genera canje, auditado
insert into _r156 (caso, ok, detalle)
select '17 Editar socio → referente: token nuevo, link del alta sin canje, auditado tipo_a_anfitrion',
       g.err = 'ok' and m.tipo = 'referente' and m.token_portal <> (t.j->>'t')
       and v.err = 'Enlace no válido' and n.err <> 'Enlace no válido'
       and exists (select 1 from public.club_auditoria a where a.objeto_id = m.id and a.accion = 'tipo_a_anfitrion'
                     and a.despues->>'token_portal_regenerado' = 'true'),
       'guardar: ' || g.err || ' · viejo: ' || v.err || ' · nuevo: ' || n.err
  from _j156 g, _j156 t, _j156 v, _j156 n, _j156 x join public.club_miembros m on m.id = (x.j->>'miembro_id')::uuid
 where g.paso = 'a_anfitrion' and t.paso = 'tok_owner' and v.paso = 'g_canje_viejo' and n.paso = 'g_canje_nuevo' and x.paso = 'owner';
-- 18. LC-DES-01: un socio dado de baja no vuelve a activo por «Editar» (sigue de baja)
insert into _r156 (caso, ok, detalle)
select '18 socio de baja → activo por Editar: rechazado, sigue de baja',
       b.err = 'ok' and r.err = 'Para reactivar a un socio, dalo de alta de nuevo en caja' and m.estado = 'baja',
       'baja: ' || b.err || ' · reactivar: ' || r.err || ' · estado: ' || m.estado
  from _j156 b, _j156 r, _j156 x join public.club_miembros m on m.id = (x.j->>'miembro_id')::uuid
 where b.paso = 'socio_a_baja' and r.paso = 'socio_reactivar' and x.paso = 'baja_vuelve';
-- 10. anon: sin EXECUTE
do $$ begin
  set local role anon;
  perform public.club_socio_alta_caja('Anon Ficticio', '60015609', null, true, null);
  reset role;
  insert into _r156 (caso, ok, detalle) values ('10 anon → permission denied (42501)', false, 'no dio error');
exception when others then
  reset role;
  insert into _r156 (caso, ok, detalle) values ('10 anon → permission denied (42501)', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;
-- 11. salonero (rol sin alta en caja) → Sin permiso, y nada de token
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c156), 'role', 'authenticated')::text, true);
update public.profiles set role = 'salonero' where id = (select cajero_id from _c156);
select set_config('request.jwt.claims', json_build_object('sub', (select cajero_id from _c156), 'role', 'authenticated')::text, true);
do $$ begin
  set local role authenticated;
  perform public.club_socio_alta_caja('Salonero Ficticio', '60015608', null, true, (select loc from _c156));
  reset role;
  insert into _r156 (caso, ok, detalle) values ('11 salonero → Sin permiso (42501)', false, 'no dio error');
exception when others then
  reset role;
  insert into _r156 (caso, ok, detalle) values ('11 salonero → Sin permiso (42501)', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;
select set_config('request.jwt.claims', '', true);

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r156;

-- ASSERT: si algún caso falla, la transacción aborta y dice cuáles
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r156 where ok is not true;   -- null = falla
  if v is not null then raise exception '156-FALLAN: %', v; end if;
  if (select count(*) from _r156) <> 20 then raise exception '156-FALLAN: se esperaban 20 casos'; end if;
end $$;
rollback;
