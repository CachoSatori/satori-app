-- 163_pruebas (origen 109) · Aplica la 159 y la 163 dentro de una transacción, prueba y termina en ROLLBACK: no deja
-- nada. Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con «163-FALLAN: <casos>».
-- Se corre con scripts/sql/163_pruebas.py (staging o una Postgres local descartable con --psql), o a mano con el SQL
-- armado (163_pruebas.py --armar).
--
-- MARCADOR que llena el runner: la línea «-- @@163@@ …» → el cuerpo de la 159 (re-ejecutable: si ya está, no cambia
-- nada) y después el de la 163. Con --mutar, el cuerpo de la 163 va con una parte deshecha a propósito y sus casos
-- tienen que caer.
-- Usa un owner y un manager ACTIVOS de la base y el local con el Club encendido (el primero por id); si falta alguno, el
-- caso 00 falla: NO PROBADO no da verde. JWT simulado con set_config('request.jwt.claims', …, true). Personas ficticias
-- con teléfonos 6001630x. Las personas «de antes de la 159» (sin mayor_edad_en) se arman con el trigger de edad apagado
-- SOLO durante el armado (dentro de esta transacción) y se vuelve a encender antes de los casos.
-- El trigger de edad es DIFERIDO: cada caso fuerza el chequeo con «set constraints … immediate» dentro de su bloque
-- (si no, el rollback final lo saltearía y la prueba no probaría nada).
begin;
-- @@163@@   (aquí van el cuerpo de la 159 y el de la 163)
create temp table _r163 (n serial, caso text, ok boolean, detalle text) on commit drop;
create function pg_temp.r(c text, ok boolean, d text) returns void language sql as $f$
  insert into pg_temp._r163 (caso, ok, detalle) values (c, coalesce(ok, false), d);   -- null (sin dato) = falla
$f$;
create temp table _c163 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       (select p.id from public.profiles p where p.is_active and p.role::text = 'manager' order by p.id limit 1) as manager_id,
       (select c.location_id from public.club_config c where c.club_activo order by c.location_id limit 1) as loc;
create function pg_temp.como(u uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true)
$f$;
create temp table _p163 (k text primary key, id uuid) on commit drop;
create function pg_temp.p(k text) returns uuid language sql as $f$ select id from pg_temp._p163 where _p163.k = p.k $f$;
create function pg_temp.rol(k text) returns public.club_miembro_roles language sql as $f$
  select r from public.club_miembro_roles r where r.miembro_id = pg_temp.p(k) and r.rol = 'socio'
$f$;
create function pg_temp.audits(k text) returns int language sql as $f$
  select count(*)::int from public.club_auditoria a where a.objeto_id = pg_temp.p(k) and a.accion = 'socio_mayor_edad'
$f$;

-- los bloques evalúan los argumentos ya con el rol de la app: que puedan leer los datos de la prueba (solo temporales)
grant select on _c163, _p163 to anon, authenticated;

-- 00. hay owner y manager activos y un local con el Club encendido; los teléfonos de prueba no existen
select pg_temp.r('00 owner y manager activos, local con el Club encendido, teléfonos de prueba libres',
       owner_id is not null and manager_id is not null and loc is not null
       and not exists (select 1 from public.club_miembros_contacto k where k.telefono like '+5066001630%'),
       'local = ' || coalesce(loc, 'NINGUNO'))
  from _c163;

-- ── Armado: personas de antes de la 159 (trigger de edad apagado SOLO acá) ─────────────────────
alter table public.club_miembro_roles disable trigger club_roles_mayor_edad_trg;
do $$
declare loc text := (select loc from pg_temp._c163); v uuid; k text;
begin
  -- A: autoalta pendiente SIN edad (la de antes de la 159) · B y B2: autoalta pendiente CON edad
  foreach k in array array['A', 'B', 'B2'] loop
    v := public.club_socio_crear('Socio Prueba ' || k, public.club_norm_telefono('6001630' || (array_position(array['A','B','B2'], k))::text),
                                 null, 'pendiente', 'autoalta', null, 'v1.2', loc);
    if k <> 'A' then update public.club_miembro_roles set mayor_edad_en = now() - interval '1 day' where miembro_id = v and rol = 'socio'; end if;
    insert into pg_temp._p163 values (k, v);
  end loop;
  -- Anfitriones con rol de socio, dados de baja por gerencia (la persona entera):
  --   C: socio validado SIN edad · D: socio validado CON edad · E: autoalta SIN validar y sin edad (vuelve a pendiente)
  --   F: socio que se dio de baja él mismo (portal) y sin edad (la reactivación no lo devuelve)
  --   H: anfitrión ACTIVO con socio activo SIN edad (para editar sin reactivar)
  --   G: socio de la carga inicial (alta_por = 'migracion'), validado, sin edad
  foreach k in array array['C', 'D', 'E', 'F', 'H', 'G'] loop
    insert into public.club_miembros (location_id, tipo, nombre) values (loc, 'referente', 'Anfitrion Prueba ' || k) returning id into v;
    insert into public.club_miembro_roles (miembro_id, rol, estado, alta_por, validado_en, mayor_edad_en)
    values (v, 'socio', 'activo', case k when 'E' then 'autoalta' when 'G' then 'migracion' else 'caja' end,
            case when k = 'E' then null else now() - interval '30 days' end,
            case when k = 'D' then now() - interval '30 days' end);
    if k = 'F' then update public.club_miembro_roles set estado = 'baja', baja_por = 'socio' where miembro_id = v and rol = 'socio'; end if;
    if k <> 'H' then update public.club_miembros set estado = 'baja', updated_at = now() where id = v; end if;
    insert into pg_temp._p163 values (k, v);
  end loop;
end $$;
alter table public.club_miembro_roles enable trigger club_roles_mayor_edad_trg;

-- 01. armado como se espera (si no, lo que sigue no prueba nada)
select pg_temp.r('01 armado: A pendiente sin edad · B/B2 pendientes con edad · C/D/E en baja por gerencia · F baja del socio · H activo sin edad',
       (pg_temp.rol('A')).estado = 'pendiente' and (pg_temp.rol('A')).mayor_edad_en is null
       and (pg_temp.rol('B')).mayor_edad_en is not null and (pg_temp.rol('B2')).estado = 'pendiente'
       and (pg_temp.rol('C')).estado = 'baja' and (pg_temp.rol('C')).baja_por = 'gerencia' and (pg_temp.rol('C')).mayor_edad_en is null
       and (pg_temp.rol('D')).estado = 'baja' and (pg_temp.rol('E')).estado = 'baja' and (pg_temp.rol('F')).baja_por = 'socio'
       and (pg_temp.rol('H')).estado = 'activo' and (pg_temp.rol('H')).mayor_edad_en is null,
       null);

-- 02. catálogo: v2 definer + search_path; authenticated sí, anon no; la interna cerrada; las viejas siguen abiertas
--     para authenticated (clientes viejos); el trigger sigue diferido
select pg_temp.r('02 catálogo: validar_v2 y guardar_v2 definer/search_path, authenticated sí, anon no · registrar cerrada · viejas abiertas',
       v.prosecdef and v.proconfig = array['search_path=public, pg_temp'] and g.prosecdef and g.proconfig = array['search_path=public, pg_temp']
       and has_function_privilege('authenticated', v.oid, 'EXECUTE') and not has_function_privilege('anon', v.oid, 'EXECUTE')
       and has_function_privilege('authenticated', g.oid, 'EXECUTE') and not has_function_privilege('anon', g.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_socio_mayor_edad_registrar(uuid,boolean,text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_socio_mayor_edad_registrar(uuid,boolean,text)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.club_socio_validar(uuid,boolean,text)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.club_miembro_guardar(uuid,text,text,uuid,text,jsonb,text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.club_roles_mayor_edad_chk()', 'EXECUTE')
       and exists (select 1 from pg_trigger t where t.tgname = 'club_roles_mayor_edad_trg' and t.tgdeferrable and t.tginitdeferred and t.tgenabled = 'O'),
       coalesce(v.proacl::text, 'sin acl') || ' · ' || coalesce(g.proacl::text, 'sin acl'))
  from pg_proc v, pg_proc g
 where v.oid = 'public.club_socio_validar_v2(uuid,boolean,boolean,text)'::regprocedure
   and g.oid = 'public.club_miembro_guardar_v2(uuid,text,text,uuid,text,jsonb,boolean,text)'::regprocedure;

-- 03. «Validar socio» (v2) a A SIN la casilla → rechazado con el mensaje de la casilla; A sigue pendiente y sin edad
do $$
declare e text := 'pasó';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_socio_validar_v2(pg_temp.p('A'), true, null, (select loc from pg_temp._c163));
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('03 validar_v2 sin «es mayor de 18» (persona sin edad) → rechazado; sigue pendiente',
         e like 'Falta «es mayor de 18»%' and (pg_temp.rol('A')).estado = 'pendiente' and (pg_temp.rol('A')).mayor_edad_en is null, e);
end $$;

-- 04. la función VIEJA (cliente viejo) tampoco activa a A sin la edad: el trigger lo rechaza al confirmar
do $$
declare e text := 'pasó';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_socio_validar(pg_temp.p('A'), true, (select loc from pg_temp._c163));
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('04 club_socio_validar (cliente viejo) a una persona sin edad → el trigger lo rechaza al confirmar',
         e like 'Falta confirmar que es mayor de 18 años%' and (pg_temp.rol('A')).estado = 'pendiente', e);
end $$;

-- 05. validar_v2 a A CON la casilla → activo provisional, mayor_edad_en registrado y rastro (actor = manager, vía validar)
do $$
declare e text := 'ok'; a record;
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_socio_validar_v2(pg_temp.p('A'), true, true, (select loc from pg_temp._c163));
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  select * into a from public.club_auditoria where objeto_id = pg_temp.p('A') and accion = 'socio_mayor_edad' order by id desc limit 1;
  perform pg_temp.r('05 validar_v2 con la casilla → activo, mayor_edad_en = ahora y auditado (quién, cuándo, vía validar)',
         e = 'ok' and (pg_temp.rol('A')).estado = 'activo' and (pg_temp.rol('A')).mayor_edad_en = now()
         and a.actor = (select manager_id from pg_temp._c163) and a.rol = 'manager' and a.en = now()
         and a.despues->>'via' = 'validar' and pg_temp.audits('A') = 1, e);
end $$;

-- 06. validar_v2 a B (ya tiene la edad) SIN la casilla → pasa, no la pisa ni deja rastro de edad
do $$
declare e text := 'ok'; antes timestamptz := (pg_temp.rol('B')).mayor_edad_en;
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_socio_validar_v2(pg_temp.p('B'), true, null, (select loc from pg_temp._c163));
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('06 validar_v2 con la edad ya registrada → no pide la casilla, no la pisa, sin rastro de edad',
         e = 'ok' and (pg_temp.rol('B')).estado = 'activo' and (pg_temp.rol('B')).mayor_edad_en = antes and pg_temp.audits('B') = 0, e);
end $$;

-- 07. cliente viejo con una persona que YA tiene la edad: sigue funcionando
do $$
declare e text := 'ok';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_socio_validar(pg_temp.p('B2'), true, (select loc from pg_temp._c163));
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('07 club_socio_validar (cliente viejo) con la edad ya registrada → pasa', e = 'ok' and (pg_temp.rol('B2')).estado = 'activo', e);
end $$;

-- 08. reactivar a C (socio validado, sin edad) con guardar_v2 SIN la casilla → rechazado; C sigue de baja
do $$
declare e text := 'pasó';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_miembro_guardar_v2(pg_temp.p('C'), 'referente', 'Anfitrion Prueba C', null, 'activo', null, null, null);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('08 reactivar con guardar_v2 sin «es mayor de 18» (socio sin edad) → rechazado; sigue de baja',
         e like 'Falta «es mayor de 18»%' and (pg_temp.rol('C')).estado = 'baja'
         and (select estado from public.club_miembros where id = pg_temp.p('C')) = 'baja', e);
end $$;

-- 09. la función VIEJA tampoco: el trigger rechaza la reactivación al confirmar
do $$
declare e text := 'pasó';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_miembro_guardar(pg_temp.p('C'), 'referente', 'Anfitrion Prueba C', null, 'activo', null, null);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('09 club_miembro_guardar (cliente viejo) reactivando a un socio sin edad → el trigger lo rechaza',
         e like 'Falta confirmar que es mayor de 18 años%' and (pg_temp.rol('C')).estado = 'baja', e);
end $$;

-- 10. reactivar a C CON la casilla → persona y socio activos, edad registrada y auditada (vía reactivacion)
do $$
declare e text := 'ok'; a record;
begin
  perform pg_temp.como((select owner_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_miembro_guardar_v2(pg_temp.p('C'), 'referente', 'Anfitrion Prueba C', null, 'activo', null, true, null);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  select * into a from public.club_auditoria where objeto_id = pg_temp.p('C') and accion = 'socio_mayor_edad' order by id desc limit 1;
  perform pg_temp.r('10 reactivar con la casilla → socio activo, mayor_edad_en = ahora, auditado por el owner (vía reactivacion)',
         e = 'ok' and (pg_temp.rol('C')).estado = 'activo' and (pg_temp.rol('C')).mayor_edad_en = now()
         and a.actor = (select owner_id from pg_temp._c163) and a.rol = 'owner' and a.despues->>'via' = 'reactivacion', e);
end $$;

-- 11. reactivar a D (ya tiene la edad) sin la casilla → pasa, sin rastro de edad
do $$
declare e text := 'ok';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_miembro_guardar_v2(pg_temp.p('D'), 'referente', 'Anfitrion Prueba D', null, 'activo', null, null, null);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('11 reactivar con la edad ya registrada → no pide la casilla', e = 'ok' and (pg_temp.rol('D')).estado = 'activo' and pg_temp.audits('D') = 0, e);
end $$;

-- 12. reactivar a E (autoalta sin validar) y a F (se dio de baja él) sin la casilla → pasa: E vuelve a PENDIENTE (la
--     edad la pide «Validar socio») y F sigue de baja (la reactivación no lo devuelve); a ninguno se le registra edad
do $$
declare e text := 'ok';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_miembro_guardar_v2(pg_temp.p('E'), 'referente', 'Anfitrion Prueba E', null, 'activo', null, null, null);
    perform public.club_miembro_guardar_v2(pg_temp.p('F'), 'referente', 'Anfitrion Prueba F', null, 'activo', null, null, null);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('12 reactivar sin la casilla: autoalta sin validar → pendiente; baja del propio socio → sigue de baja; sin edad',
         e = 'ok' and (pg_temp.rol('E')).estado = 'pendiente' and (pg_temp.rol('E')).mayor_edad_en is null
         and (pg_temp.rol('F')).estado = 'baja' and (pg_temp.rol('F')).mayor_edad_en is null, e);
end $$;

-- 13. editar (sin reactivar) a H, anfitrión activo con socio activo SIN edad, sin la casilla → pasa igual que antes
do $$
declare e text := 'ok';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_miembro_guardar_v2(pg_temp.p('H'), 'referente', 'Anfitrion Prueba H editado', null, 'activo', null, null, null);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('13 editar sin reactivar (socio activo de antes, sin edad) → pasa, no pide ni registra edad',
         e = 'ok' and (select nombre from public.club_miembros where id = pg_temp.p('H')) = 'Anfitrion Prueba H editado'
         and (pg_temp.rol('H')).mayor_edad_en is null and pg_temp.audits('H') = 0, e);
end $$;

-- 14. bajar a H (activo → baja) y crear un miembro nuevo con guardar_v2: no piden edad
do $$
declare e text := 'ok'; v uuid;
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_miembro_guardar_v2(pg_temp.p('H'), 'referente', 'Anfitrion Prueba H editado', null, 'baja', null, null, null);
    v := public.club_miembro_guardar_v2(null, 'referente', 'Anfitrion Prueba Nuevo', null, 'activo', null, null, (select loc from pg_temp._c163));
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('14 dar de baja y crear un anfitrión nuevo con guardar_v2 → sin pedir edad',
         e = 'ok' and (pg_temp.rol('H')).estado = 'baja' and v is not null, e);
end $$;

-- 15. sin permiso: anon no llama a ninguna v2; un usuario sin rol tampoco (mensaje «Sin permiso» antes de mirar datos)
do $$
declare e1 text := 'pasó'; e2 text := 'pasó'; e3 text := 'pasó';
begin
  begin
    set local role anon;
    perform public.club_socio_validar_v2(pg_temp.p('A'), true, true, null);
    reset role;
  exception when others then reset role; e1 := sqlstate; end;
  begin
    set local role anon;
    perform public.club_miembro_guardar_v2(pg_temp.p('C'), 'referente', 'x', null, 'activo', null, true, null);
    reset role;
  exception when others then reset role; e2 := sqlstate; end;
  perform pg_temp.como('00000000-0000-4000-8000-0000000163ff'::uuid);
  begin
    set local role authenticated;
    perform public.club_socio_validar_v2(pg_temp.p('A'), true, true, null);
    reset role;
  exception when others then reset role; e3 := sqlstate || ' ' || sqlerrm; end;
  perform pg_temp.r('15 anon sin EXECUTE en las v2 (42501) · usuario sin rol → «Sin permiso»',
         e1 = '42501' and e2 = '42501' and e3 = '42501 Sin permiso', e1 || ' · ' || e2 || ' · ' || e3);
end $$;

-- 16. regresión de la 159: el alta en caja por la de 5 argumentos (sin edad) sigue rechazada por el trigger
do $$
declare e text := 'pasó';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    perform public.club_socio_alta_caja('Socio Prueba Caja', '60016309', null, true, (select loc from pg_temp._c163));
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then e := sqlerrm;
  end;
  perform pg_temp.r('16 (159) alta en caja sin edad por la función interna → el trigger la rechaza', e like 'Falta confirmar que es mayor de 18 años%', e);
end $$;

-- 17. reactivar a G (socio de la carga inicial, sin edad) con la función VIEJA → el trigger también lo rechaza
--     (el paso a activo pide la edad venga de donde venga el alta, no solo caja/autoalta)
do $$
declare e text := 'pasó';
begin
  perform pg_temp.como((select manager_id from pg_temp._c163));
  begin
    set local role authenticated;
    perform public.club_miembro_guardar(pg_temp.p('G'), 'referente', 'Anfitrion Prueba G', null, 'activo', null, null);
    reset role;
    set constraints public.club_roles_mayor_edad_trg immediate;
    set constraints public.club_roles_mayor_edad_trg deferred;
  exception when others then reset role; e := sqlerrm;
  end;
  perform pg_temp.r('17 reactivar a un socio de la carga inicial sin edad (cliente viejo) → el trigger lo rechaza',
         e like 'Falta confirmar que es mayor de 18 años%' and (pg_temp.rol('G')).estado = 'baja', e);
end $$;

-- Resultado + ASSERT final (aborta con los casos que fallan; menos de 18 casos = NO PROBADO)
select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r163;
do $$
declare v text := (select string_agg(split_part(caso, ' ', 1), ',' order by n) from pg_temp._r163 where not ok);
begin
  if v is not null then raise exception '163-FALLAN: %', v; end if;
  if (select count(*) from pg_temp._r163) < 18 then raise exception '163-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;
rollback;
