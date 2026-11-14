-- 159_pruebas (origen 101) · SOLO STAGING. Aplica la 159 dentro de una transacción, prueba y termina en ROLLBACK: no
-- deja nada. Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con
-- «159-FALLAN: <casos>». Se corre con scripts/sql/159_pruebas.py, o a mano con el SQL armado (159_pruebas.py --armar).
--
-- MARCADOR que llena el runner: la línea «-- @@159@@ …» → el cuerpo de supabase/migrations/159_club_aviso_v1_2.sql
-- (re-ejecutable). Con --mutar, ese cuerpo va con una parte deshecha a propósito y sus casos tienen que caer.
-- Usa un owner y un manager ACTIVOS de la base y el local con el Club encendido (el primero por id); si falta alguno, el
-- caso 00 falla: NO PROBADO no da verde. JWT simulado con set_config('request.jwt.claims', …, true); club-web simulado
-- con una clave de prueba cargada en la transacción. Personas ficticias con teléfonos 6001590x.
-- El trigger de edad es DIFERIDO: cada caso que lo necesita fuerza el chequeo con «set constraints … immediate» dentro
-- de su bloque (si no, el rollback final lo saltearía y la prueba no probaría nada).
begin;
-- @@159@@   (aquí va el cuerpo de la 159)
create temp table _r159 (n serial, caso text, ok boolean, detalle text) on commit drop;
create function pg_temp.r(c text, ok boolean, d text) returns void language sql as $f$
  insert into pg_temp._r159 (caso, ok, detalle) values (c, ok, d);
$f$;
create temp table _c159 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       (select p.id from public.profiles p where p.is_active and p.role::text = 'manager' order by p.id limit 1) as manager_id,
       (select c.location_id from public.club_config c where c.club_activo order by c.location_id limit 1) as loc;

-- club-web simulado (clave de prueba, solo en esta transacción)
select public.club_web_clave_cargar(encode(extensions.digest('clave-de-prueba-del-club-159-0123456789abcdef', 'sha256'), 'hex'));
select set_config('request.headers', '{"x-club-web":"clave-de-prueba-del-club-159-0123456789abcdef"}', true);

-- datos de una autoalta de prueba (los de base + lo que se pase). Se arman ANTES de pasar a anon: con el rol de anon solo
-- se llama a la función pública.
create function pg_temp.datos(tel text, extra jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('nombre', 'Socia Prueba Ficticia', 'whatsapp', tel, 'acepto', 'v1.2',
                            'local', (select loc from pg_temp._c159)) || extra
$f$;
create function pg_temp.mid(tel text) returns uuid language sql as $f$
  select public.club_miembro_por_telefono(public.club_norm_telefono(tel))
$f$;
create function pg_temp.como(u uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true)
$f$;

-- 00. hay owner y manager activos y un local con el Club encendido; los teléfonos de prueba no existen
select pg_temp.r('00 owner y manager activos, local con el Club encendido, teléfonos de prueba libres',
       owner_id is not null and manager_id is not null and loc is not null
       and not exists (select 1 from public.club_miembros_contacto k where k.telefono like '+5066001590%' or k.telefono like '+5066001591%'),
       'local = ' || coalesce(loc, 'NINGUNO'))
  from _c159;

-- 01. aviso v1.2: registrado (huellas de 64 hex), default y todos los locales en v1.2
select pg_temp.r('01 aviso v1.2 registrado, default v1.2 y ningún local en v1.1',
       exists (select 1 from public.club_avisos_privacidad a where a.version = 'v1.2' and a.sha256_es ~ '^[0-9a-f]{64}$' and a.sha256_en ~ '^[0-9a-f]{64}$')
       and (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'club_config'
             and column_name = 'aviso_privacidad_version') like '''v1.2''%'
       and not exists (select 1 from public.club_config where aviso_privacidad_version = 'v1.1'),
       (select string_agg(distinct aviso_privacidad_version, ',') from public.club_config));

-- 02. catálogo: v2 definer + search_path; authenticated sí, anon no; la de 5 argumentos sin EXECUTE para authenticated;
--     autoalta para anon; las funciones de trigger sin EXECUTE
select pg_temp.r('02 catálogo: v2 definer/search_path · authenticated v2 sí, anon no · alta_caja(5) cerrada · triggers cerrados',
       p.prosecdef and p.proconfig = array['search_path=public, pg_temp']
       and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_socio_alta_caja(text,text,text,boolean,text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_socio_alta_caja(text,text,text,boolean,text)', 'EXECUTE')
       and has_function_privilege('anon', 'public.club_socio_autoalta(jsonb)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_contacto_cumple_guardia()', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_roles_mayor_edad_chk()', 'EXECUTE')
       and exists (select 1 from pg_trigger t where t.tgname = 'club_roles_mayor_edad_trg' and t.tgdeferrable and t.tginitdeferred),
       coalesce(p.proacl::text, 'sin acl'))
  from pg_proc p where p.oid = 'public.club_socio_alta_caja_v2(text,text,text,boolean,boolean,text)'::regprocedure;

-- 03–06. autoalta rechaza: sin mayor_edad · mayor_edad en texto · cumpleaños sin permiso · 31-abr · y no crea a nadie
do $$
declare e text; c record; d jsonb;
begin
  for c in select * from (values
      ('03 autoalta sin mayor_edad → «Datos no válidos» y no crea a nadie', '60015903', '{}'::jsonb),
      ('04 autoalta con mayor_edad = "true" (texto) → rechazada', '60015903', '{"mayor_edad":"true"}'::jsonb),
      ('05 autoalta con cumpleaños sin permiso → rechazada', '60015903', '{"mayor_edad":true,"cumple_dia":3,"cumple_mes":4}'::jsonb),
      ('06 autoalta con 31 de abril → rechazada', '60015903', '{"mayor_edad":true,"cumple_dia":31,"cumple_mes":4,"cumple_permiso":true}'::jsonb)
    ) v(caso, tel, extra)
  loop
    d := pg_temp.datos(c.tel, c.extra);
    begin
      set local role anon;
      perform public.club_socio_autoalta(d);
      reset role;
      e := 'pasó';
    exception when others then reset role; e := sqlerrm;
    end;
    perform pg_temp.r(c.caso, e = 'Datos no válidos' and pg_temp.mid(c.tel) is null, e);
  end loop;
end $$;

-- 07. autoalta con 29-feb + permiso + mayor (como anon, por club-web) → persona, mayor_edad_en y cumpleaños; el trigger
--     diferido no la rechaza
do $$
declare e text := 'ok'; v uuid; k record; r record;
  d jsonb := pg_temp.datos('60015901', '{"mayor_edad":true,"cumple_dia":29,"cumple_mes":2,"cumple_permiso":true}'::jsonb);
begin
  begin
    set local role anon;
    perform public.club_socio_autoalta(d);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  v := pg_temp.mid('60015901');
  select * into k from public.club_miembros_contacto where miembro_id = v;
  select * into r from public.club_miembro_roles where miembro_id = v and rol = 'socio';
  perform pg_temp.r('07 autoalta 29-feb con permiso: socio pendiente, mayor_edad_en y cumpleaños guardados',
         e = 'ok' and v is not null and r.estado = 'pendiente' and r.alta_por = 'autoalta' and r.mayor_edad_en is not null
         and k.cumple_dia = 29 and k.cumple_mes = 2 and k.cumple_permiso_en is not null, e);
end $$;

-- 08. autoalta sin cumpleaños → contacto sin cumpleaños; mayor_edad_en igual
do $$
declare e text := 'ok'; v uuid; d jsonb := pg_temp.datos('60015902', '{"mayor_edad":true}'::jsonb);
begin
  begin
    set local role anon;
    perform public.club_socio_autoalta(d);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  v := pg_temp.mid('60015902');
  perform pg_temp.r('08 autoalta sin cumpleaños: mayor_edad_en sí, cumpleaños null',
         e = 'ok' and v is not null
         and (select mayor_edad_en is not null from public.club_miembro_roles where miembro_id = v and rol = 'socio')
         and (select cumple_dia is null and cumple_permiso_en is null from public.club_miembros_contacto where miembro_id = v), e);
end $$;

-- 09. la tabla rechaza 31-abr y el día sin el permiso (check), aunque escriba el dueño de la autoalta (la guardia lo deja
--     pasar: fila nacida en la transacción)
do $$
declare e1 text := 'pasó'; e2 text := 'pasó'; v uuid := pg_temp.mid('60015902');
  dueno text := (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.club_socio_autoalta(jsonb)'::regprocedure);
begin
  begin
    execute format('set local role %I', dueno);
    update public.club_miembros_contacto set cumple_dia = 31, cumple_mes = 4, cumple_permiso_en = now() where miembro_id = v;
    reset role;
  exception when others then reset role; e1 := sqlstate; end;
  begin
    execute format('set local role %I', dueno);
    update public.club_miembros_contacto set cumple_dia = 3, cumple_mes = 4 where miembro_id = v;
    reset role;
  exception when others then reset role; e2 := sqlstate; end;
  perform pg_temp.r('09 check: 31-abr y día/mes sin permiso → 23514', e1 = '23514' and e2 = '23514', e1 || ' · ' || e2);
end $$;

-- 10. manager: ni por la tabla (como la app) ni por la función del owner cambia el cumpleaños de 07
do $$
declare e1 text := 'pasó'; e2 text := 'pasó'; v uuid := pg_temp.mid('60015901');
begin
  perform pg_temp.como((select manager_id from pg_temp._c159));
  begin
    set local role authenticated;
    update public.club_miembros_contacto set cumple_dia = 1, cumple_mes = 3 where miembro_id = v;
    reset role;
  exception when others then reset role; e1 := sqlstate;
  end;
  begin
    set local role authenticated;
    perform public.club_socio_cumple_corregir(v, 1, 3, 'nota de prueba');
    reset role;
  exception when others then reset role; e2 := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.r('10 manager no cambia el cumpleaños: tabla 42501 · corregir «Sin permiso» (antes de la guardia)',
         e1 = '42501' and e2 = '42501 Sin permiso' and (select cumple_dia = 29 from public.club_miembros_contacto where miembro_id = v), e1 || ' · ' || e2);
end $$;

-- 11. ni una función de la base (postgres) cambia un cumpleaños ya cargado si quien llama no es owner
do $$
declare e text := 'pasó'; v uuid := pg_temp.mid('60015901');
begin
  perform pg_temp.como((select manager_id from pg_temp._c159));
  begin update public.club_miembros_contacto set cumple_dia = 1, cumple_mes = 3 where miembro_id = v;
  exception when others then e := sqlstate; end;
  perform pg_temp.r('11 postgres + JWT de manager: cumpleaños ya cargado no cambia (42501)', e = '42501', e);
end $$;

-- 12. cargar un cumpleaños DESPUÉS del alta (fila de contacto de antes) → rechazado, aunque escriba el dueño de la autoalta
do $$
declare e text := 'pasó'; v uuid := pg_temp.mid('60015902');
  dueno text := (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.club_socio_autoalta(jsonb)'::regprocedure);
begin
  perform pg_temp.como((select manager_id from pg_temp._c159));
  update public.club_miembros_contacto set created_at = now() - interval '1 day' where miembro_id = v;
  begin
    execute format('set local role %I', dueno);
    update public.club_miembros_contacto set cumple_dia = 5, cumple_mes = 5, cumple_permiso_en = now() where miembro_id = v;
    reset role;
  exception when others then reset role; e := sqlstate; end;
  perform pg_temp.r('12 cumpleaños agregado después del alta (portal o función) → 42501', e = '42501', e);
end $$;

-- 13. owner lo corrige con club_socio_cumple_corregir: pasa, y la auditoría lo registra SIN el dato
do $$
declare e text := 'ok'; v uuid := pg_temp.mid('60015901'); a jsonb;
begin
  perform pg_temp.como((select owner_id from pg_temp._c159));
  begin
    set local role authenticated;
    perform public.club_socio_cumple_corregir(v, 28, 2, 'nota de prueba: lo pidió por escrito');
    reset role;
  exception when others then reset role; e := sqlstate || ' ' || sqlerrm;
  end;
  select coalesce(antes, '{}') || coalesce(despues, '{}') into a from public.club_auditoria
   where accion = 'cumple_corregido' and objeto_id = v order by en desc limit 1;
  perform pg_temp.r('13 owner corrige el cumpleaños; auditoría «cumple_corregido» sin día ni mes',
         e = 'ok' and (select cumple_dia = 28 from public.club_miembros_contacto where miembro_id = v)
         and a is not null and a::text !~ '"(dia|mes|cumple_dia|cumple_mes)"', e || ' · ' || coalesce(a::text, 'sin auditoría'));
end $$;

-- 14. baja del socio (cualquier vía) → el cumpleaños se borra y queda «cumple_borrado» en la auditoría
do $$
declare v uuid := pg_temp.mid('60015901');
begin
  perform pg_temp.como((select owner_id from pg_temp._c159));
  update public.club_miembro_roles set estado = 'baja', actualizado_en = now() where miembro_id = v and rol = 'socio';
  perform pg_temp.r('14 baja del socio → cumpleaños borrado (y auditado)',
         (select cumple_dia is null and cumple_mes is null and cumple_permiso_en is null from public.club_miembros_contacto where miembro_id = v)
         and exists (select 1 from public.club_auditoria where accion = 'cumple_borrado' and objeto_id = v), null);
end $$;

-- 15. alta en caja v2 sin «mayor de 18» → rechazada con su mensaje, sin persona
do $$
declare e text := 'pasó'; l text := (select loc from pg_temp._c159);
begin
  perform pg_temp.como((select owner_id from pg_temp._c159));
  begin
    set local role authenticated;
    perform public.club_socio_alta_caja_v2('Caja Prueba Ficticia', '60015905', null, true, false, l);
    reset role;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('15 alta en caja v2 sin «mayor de 18» → rechazada, sin persona',
         e like 'Falta «es mayor de 18»%' and pg_temp.mid('60015905') is null, e);
end $$;

-- 16. alta en caja v2 con «mayor de 18» → activo provisional con mayor_edad_en; el trigger diferido no la rechaza
do $$
declare e text := 'ok'; j jsonb; l text := (select loc from pg_temp._c159);
begin
  perform pg_temp.como((select owner_id from pg_temp._c159));
  begin
    set local role authenticated;
    j := public.club_socio_alta_caja_v2('Caja Prueba Ficticia', '60015906', null, true, true, l);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('16 alta en caja v2 con «mayor de 18» → activo, mayor_edad_en, sin cumpleaños',
         e = 'ok' and j->>'estado' = 'activo'
         and (select mayor_edad_en is not null and alta_por = 'caja' from public.club_miembro_roles where miembro_id = pg_temp.mid('60015906') and rol = 'socio')
         and (select cumple_dia is null from public.club_miembros_contacto where miembro_id = pg_temp.mid('60015906')), e);
end $$;

-- 17. el trigger diferido: la de 5 argumentos llamada por fuera de la v2 (postgres + JWT de owner) → rechazada al confirmar
do $$
declare e text := 'pasó';
begin
  perform pg_temp.como((select owner_id from pg_temp._c159));
  begin
    perform public.club_socio_alta_caja('Caja Directa Ficticia', '60015907', null, true, (select loc from pg_temp._c159));
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then e := sqlerrm;
  end;
  perform pg_temp.r('17 trigger diferido: alta de socio sin mayor_edad_en → rechazada al confirmar',
         e like 'Falta confirmar que es mayor de 18 años%' and pg_temp.mid('60015907') is null, e);
end $$;

-- 18. authenticated no llama a la de 5 argumentos (42501); anon no llama a la v2 (42501)
do $$
declare e1 text := 'pasó'; e2 text := 'pasó'; l text := (select loc from pg_temp._c159);
begin
  perform pg_temp.como((select owner_id from pg_temp._c159));
  begin
    set local role authenticated;
    perform public.club_socio_alta_caja('Caja Prueba Ficticia', '60015908', null, true, l);
    reset role;
  exception when others then reset role; e1 := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  begin
    set local role anon;
    perform public.club_socio_alta_caja_v2('Caja Prueba Ficticia', '60015908', null, true, true, null);
    reset role;
  exception when others then reset role; e2 := sqlstate;
  end;
  perform pg_temp.r('18 authenticated → alta_caja(5) 42501 · anon → v2 42501', e1 = '42501' and e2 = '42501', e1 || ' · ' || e2);
end $$;

-- 19. privacidad: ninguna función que lee el contacto o el portal devuelve el cumpleaños
select pg_temp.r('19 privacidad: club_portal, club_miembro_contacto_ver y el exporte de ofertas no devuelven el cumpleaños',
       not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                     and p.proname in ('club_portal', 'club_miembro_contacto_ver', 'club_contactos_ofertas_exportar',
                                       'club_resolver_miembro', 'club_buscar', 'club_pase_datos', 'club_reporte_altas')
                     and (pg_get_functiondef(p.oid) ~* 'cumple' or pg_get_function_result(p.oid) ~* 'cumple'))
       and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and pg_get_functiondef(p.oid) ~* 'cumple_dia')
           = 5,   -- solo la guardia, su rastro, la baja, la autoalta y la corrección del owner
       (select string_agg(p.proname, ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and pg_get_functiondef(p.oid) ~* 'cumple_dia'));

-- 20. (verificador #1) la guardia mira el dueño REAL de club_socio_autoalta, no el nombre «postgres»: con la autoalta de
--     otro dueño, ese dueño carga el cumpleaños en el alta y el dueño anterior ya no puede
do $$
declare e1 text := 'ok'; e2 text := 'pasó'; v1 uuid; v2 uuid;
  d1 jsonb := pg_temp.datos('60015911', '{"mayor_edad":true}'::jsonb);
  d2 jsonb := pg_temp.datos('60015912', '{"mayor_edad":true}'::jsonb);
  dueno text := (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.club_socio_autoalta(jsonb)'::regprocedure);
begin
  set local role anon;
  perform public.club_socio_autoalta(d1);
  perform public.club_socio_autoalta(d2);
  reset role;
  v1 := pg_temp.mid('60015911'); v2 := pg_temp.mid('60015912');
  create role club159_dueno_prueba nologin;
  execute format('grant club159_dueno_prueba to %I', current_user);
  grant select, update on public.club_miembros_contacto to club159_dueno_prueba;
  create policy club159_dueno_prueba on public.club_miembros_contacto for all to club159_dueno_prueba using (true) with check (true);
  alter function public.club_socio_autoalta(jsonb) owner to club159_dueno_prueba;
  begin
    set local role club159_dueno_prueba;
    update public.club_miembros_contacto set cumple_dia = 4, cumple_mes = 7, cumple_permiso_en = now() where miembro_id = v1;
    reset role;
  exception when others then reset role; e1 := sqlstate || ' ' || sqlerrm; end;
  begin
    execute format('set local role %I', dueno);
    update public.club_miembros_contacto set cumple_dia = 4, cumple_mes = 7, cumple_permiso_en = now() where miembro_id = v2;
    reset role;
  exception when others then reset role; e2 := sqlstate; end;
  execute format('alter function public.club_socio_autoalta(jsonb) owner to %I', dueno);
  perform pg_temp.r('20 autoalta de otro dueño: ese dueño carga el cumpleaños en el alta; «' || dueno || '» ya no (42501)',
         e1 = 'ok' and e2 = '42501' and v1 is not null and v2 is not null
         and (select cumple_dia = 4 from public.club_miembros_contacto where miembro_id = v1)
         and (select cumple_dia is null from public.club_miembros_contacto where miembro_id = v2), e1 || ' · ' || e2);
end $$;

-- 21. (verificador #2) la purga borra el rol de socio (DELETE) y conserva el contacto si hay otro rol: el cumpleaños se borra
do $$
declare v uuid; e text := 'ok'; d jsonb := pg_temp.datos('60015913', '{"mayor_edad":true,"cumple_dia":5,"cumple_mes":6,"cumple_permiso":true}'::jsonb);
begin
  begin
    set local role anon;
    perform public.club_socio_autoalta(d);
    reset role;
  exception when others then reset role; e := sqlerrm; end;
  v := pg_temp.mid('60015913');
  delete from public.club_socio_solicitudes where miembro_id = v;
  delete from public.club_miembro_roles where miembro_id = v and rol = 'socio';   -- lo mismo que hace club_socios_mantenimiento
  perform pg_temp.r('21 rol de socio eliminado (purga) con el contacto vivo → cumpleaños borrado y auditado',
         e = 'ok' and v is not null
         and (select cumple_dia is null and cumple_mes is null and cumple_permiso_en is null and telefono is not null
                from public.club_miembros_contacto where miembro_id = v)
         and exists (select 1 from public.club_auditoria where accion = 'cumple_borrado' and objeto_id = v), e);
end $$;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r159;

-- ASSERT: si algún caso falla, la transacción aborta y dice cuáles
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r159 where ok is not true;   -- null = falla
  if v is not null then raise exception '159-FALLAN: %', v; end if;
  if (select count(*) from _r159) <> 22 then raise exception '159-FALLAN: se esperaban 22 casos'; end if;
end $$;
rollback;
