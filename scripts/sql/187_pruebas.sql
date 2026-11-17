-- 187_pruebas · Retos por local: un reto pertenece a UN local. Postgres local (nunca prod).
-- Aplica la 187 dentro de una transacción, corre la batería y el rollback y termina en ROLLBACK: no deja nada.
-- Corre ANTES de aplicar (R15): base local armada con scripts/sql/local_armar_base.sh (sin la 187).
-- Se corre con scripts/sql/187_pruebas.py (--local … --semilla-local; --mutar todas).
--
-- MARCADORES que llena el runner: «-- @@187@@» → cuerpo de supabase/migrations/187_… sin begin/commit (con --mutar, con
-- el arreglo roto a propósito); «-- @@187R@@» → cuerpo de scripts/sql/187_rollback.sql sin begin/commit;
-- «-- @@187PRE@@» → la función pg_temp.prechequeo() con el PRIMER bloque «do $$ … $$;» de la 187 (el pre-chequeo);
-- «-- @@187REGLAS@@» → la función pg_temp.reglas_bloque() con el bloque «do $$ … $$;» del tope por local (caso 10).
-- Locales FICTICIOS prueba187a y prueba187b; un owner activo de la base (en local lo crea --semilla-local) y un manager
-- de prueba187a ficticio. Fechas del reto en 2032 (nunca en el pasado).
begin;
create temp table _r187 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r187 to anon, authenticated;
grant usage on sequence _r187_n_seq to anon, authenticated;

create temp table _c187 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8187-0000000000a1'::uuid as manager_a;
grant select on _c187 to anon, authenticated;

insert into public.locations (id, name) values ('prueba187a', 'Local Ficticio A'), ('prueba187b', 'Local Ficticio B')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba187a', 'Local Ficticio A', true), ('prueba187b', 'Local Ficticio B', true);
insert into public.club_cortesias (location_id, codigo_producto, nombre) values
  ('prueba187a', 'P187A1', 'Postre Ficticio A'), ('prueba187b', 'P187B1', 'Postre Ficticio B');
update public.club_config_global set retos_exige_factura = false;   -- sin facturas del PoS en los locales ficticios

insert into auth.users (id, raw_user_meta_data) values ((select manager_a from _c187), '{"full_name":"Manager Ficticio A"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c187), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager', is_active = true where id = (select manager_a from _c187);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values ((select manager_a from _c187), 'prueba187a', true);

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
create function pg_temp.error_de(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end $f$;
create function pg_temp.err_como(p_uid uuid, p_sql text) returns text language sql as $f$
  select pg_temp.error_de(format('select pg_temp.como(%L::uuid, %L)', p_uid, p_sql)) $f$;
create function pg_temp.k(p_cod text) returns text language sql stable as $f$
  select id::text from public.club_cortesias where codigo_producto = p_cod $f$;
create function pg_temp.datos(p_nombre text, p_locales text[], p_desde date) returns jsonb language sql stable as $f$
  select jsonb_build_object('nombre', p_nombre, 'nombre_en', 'Fictitious ' || p_nombre, 'locales', to_jsonb(p_locales),
                            'desde', p_desde, 'hasta', p_desde + 20, 'dias', jsonb_build_array(1,2,3,4,5,6,7),
                            'hora_desde', '11:30', 'hora_hasta', '15:00', 'meta', 3, 'vence_dias', 30, 'control_pct', 0,
                            'cortesias', (select jsonb_object_agg(l, pg_temp.k('P187' || upper(right(l, 1)) || '1')) from unnest(p_locales) l)) $f$;
create function pg_temp.guardar(p_id uuid, d jsonb) returns text language sql as $f$
  select pg_temp.err_como((select owner_id from _c187), format('public.club_reto_guardar(%L::uuid, %L::jsonb)', p_id, d)) $f$;
-- pre-chequeo de la 187 (su primer bloque do), para el caso 08
-- @@187PRE@@   (aquí va create function pg_temp.prechequeo() … con el primer bloque de la 187)

-- Antes de la 187: un reto con dos locales todavía se guarda (borrador) — es lo que la 187 corta
do $$ declare e text;
begin
  e := pg_temp.guardar(null, pg_temp.datos('Reto Antes', array['prueba187a', 'prueba187b'], date '2032-03-01'));
  insert into _r187 (caso, ok, detalle) values ('00 armado: owner y manager; ANTES de la 187 un reto de dos locales se guarda',
    (select owner_id from _c187) is not null and e is null
    and exists (select 1 from public.club_retos where nombre = 'Reto Antes' and cardinality(locales) = 2), e);
  delete from public.club_retos where nombre = 'Reto Antes';   -- borrador: se borra
end $$;

-- @@187@@   (aquí va el cuerpo de la 187 sin begin/commit)

-- 01. guardar un reto nuevo con dos locales → mensaje claro; no queda nada
do $$ declare e text;
begin
  e := pg_temp.guardar(null, pg_temp.datos('Reto Doble', array['prueba187a', 'prueba187b'], date '2032-03-01'));
  insert into _r187 (caso, ok, detalle) values ('01 nuevo con dos locales → «Un reto es de un solo local»; no se guarda',
    e like 'P0001:Un reto es de un solo local%' and not exists (select 1 from public.club_retos where nombre = 'Reto Doble'), e);
end $$;

-- 02. un local: se guarda; editarlo a dos locales → mismo mensaje y sigue con uno
do $$ declare e1 text; e2 text; v uuid;
begin
  e1 := pg_temp.guardar(null, pg_temp.datos('Reto A', array['prueba187a'], date '2032-03-01'));
  v := (select id from public.club_retos where nombre = 'Reto A');
  e2 := pg_temp.guardar(v, pg_temp.datos('Reto A', array['prueba187a', 'prueba187b'], date '2032-03-01'));
  insert into _r187 (caso, ok, detalle) values ('02 un local se guarda; editarlo a dos → rechazado y sigue con su local',
    e1 is null and v is not null and e2 like 'P0001:Un reto es de un solo local%'
    and (select locales from public.club_retos where id = v) = array['prueba187a'], concat_ws(' | ', e1, e2));
end $$;

-- 03. por fuera de las funciones: INSERT directo con dos locales → mensaje; sin el trigger, el CHECK igual corta
do $$ declare e1 text; e2 text;
begin
  e1 := pg_temp.error_de($q$insert into public.club_retos (nombre, nombre_en, locales, desde, hasta, meta)
                            values ('Reto Directo', 'Direct', array['prueba187a','prueba187b'], '2032-04-01', '2032-04-20', 3)$q$);
  alter table public.club_retos disable trigger club_retos_a_un_local_trg;
  e2 := pg_temp.error_de($q$insert into public.club_retos (nombre, nombre_en, locales, desde, hasta, meta)
                            values ('Reto Directo', 'Direct', array['prueba187a','prueba187b'], '2032-04-01', '2032-04-20', 3)$q$);
  alter table public.club_retos enable trigger club_retos_a_un_local_trg;
  insert into _r187 (caso, ok, detalle) values ('03 INSERT directo de dos locales → trigger (P0001); sin trigger → CHECK (23514)',
    e1 like 'P0001:Un reto es de un solo local%' and e2 like '23514:%club_retos_un_local%', concat_ws(' | ', e1, e2));
end $$;

-- 04. el reto del otro local y la lista: el manager de A ve solo el de A; el owner, los dos
do $$ declare e text; lo jsonb; lm jsonb;
begin
  e := pg_temp.guardar(null, pg_temp.datos('Reto B', array['prueba187b'], date '2032-03-01'));
  lo := pg_temp.como((select owner_id from _c187), 'public.club_retos_listar()');
  lm := pg_temp.como((select manager_a from _c187), 'public.club_retos_listar()');
  insert into _r187 (caso, ok, detalle) values ('04 owner ve Reto A y Reto B; el manager de A, solo Reto A (con un local)',
    e is null
    and (select array_agg(x->>'nombre' order by x->>'nombre') from jsonb_array_elements(lo->'retos') x where x->>'nombre' in ('Reto A', 'Reto B')) = array['Reto A', 'Reto B']
    and (select array_agg(x->>'nombre') from jsonb_array_elements(lm->'retos') x where x->>'nombre' like 'Reto %') = array['Reto A']
    and (select x->'locales' from jsonb_array_elements(lm->'retos') x where x->>'nombre' = 'Reto A') = '["prueba187a"]'::jsonb,
    concat_ws(' | ', e, lm));
end $$;

-- 05. armar y terminar siguen (no tocan los locales); dos retos de locales distintos en las mismas fechas, sí
do $$ declare va uuid := (select id from public.club_retos where nombre = 'Reto A'); vb uuid := (select id from public.club_retos where nombre = 'Reto B');
  e1 text; e2 text; e3 text;
begin
  e1 := pg_temp.err_como((select owner_id from _c187), format('public.club_reto_armar(%L::uuid)', va));
  e2 := pg_temp.err_como((select owner_id from _c187), format('public.club_reto_armar(%L::uuid)', vb));
  e3 := pg_temp.err_como((select owner_id from _c187), format('public.club_reto_terminar(%L::uuid)', va));
  insert into _r187 (caso, ok, detalle) values ('05 armar A y B (mismas fechas, locales distintos) y terminar A: sin errores',
    e1 is null and e2 is null and e3 is null
    and (select estado from public.club_retos where id = va) = 'terminada' and (select estado from public.club_retos where id = vb) = 'vigente',
    concat_ws(' | ', e1, e2, e3));
end $$;

-- 06. permisos y forma
insert into _r187 (caso, ok, detalle)
select '06 función del trigger sin EXECUTE para la API; CHECK validado; el trigger corre antes que club_retos_reglas_trg',
       not has_function_privilege('authenticated', 'public.club_retos_a_un_local()', 'execute')
       and not has_function_privilege('anon', 'public.club_retos_a_un_local()', 'execute')
       and exists (select 1 from pg_constraint where conname = 'club_retos_un_local' and convalidated)
       and (select array_agg(tgname::text order by tgname) from pg_trigger
             where tgrelid = 'public.club_retos'::regclass and not tgisinternal and tgname in ('club_retos_a_un_local_trg', 'club_retos_reglas_trg'))
           = array['club_retos_a_un_local_trg', 'club_retos_reglas_trg'],
       null;

-- 09. tope de 3 armados por año POR LOCAL (decisión del dueño 17-nov): A arma 3 en 2033 y el 4.º de A se rechaza con el
--     nombre del local; B, en el mismo año y con A ya en 3, arma igual (con el tope de la 169, todos juntos, caía)
do $$ declare v uuid; e text; e4 text; eb text; i int;
begin
  for i in 1..3 loop
    e := concat_ws(' | ', e, pg_temp.guardar(null, pg_temp.datos('Tope A' || i, array['prueba187a'], make_date(2033, i + 1, 1))));
    v := (select id from public.club_retos where nombre = 'Tope A' || i);
    e := concat_ws(' | ', e, pg_temp.err_como((select owner_id from _c187), format('public.club_reto_armar(%L::uuid)', v)));
  end loop;
  e4 := pg_temp.guardar(null, pg_temp.datos('Tope A4', array['prueba187a'], date '2033-06-01'));
  e4 := concat_ws(' | ', e4, pg_temp.err_como((select owner_id from _c187),
          format('public.club_reto_armar(%L::uuid)', (select id from public.club_retos where nombre = 'Tope A4'))));
  eb := pg_temp.guardar(null, pg_temp.datos('Tope B1', array['prueba187b'], date '2033-02-01'));
  eb := concat_ws(' | ', eb, pg_temp.err_como((select owner_id from _c187),
          format('public.club_reto_armar(%L::uuid)', (select id from public.club_retos where nombre = 'Tope B1'))));
  insert into _r187 (caso, ok, detalle) values ('09 tope por local: A arma 3 en 2033, el 4.º de A → «Ya hay 3 retos armados en 2033 en «Local Ficticio A»»; B arma igual',
    nullif(e, '') is null and e4 like 'P0001:Ya hay 3 retos armados en 2033 en «Local Ficticio A»: es el máximo por año y local%'
    and (select armado_en from public.club_retos where nombre = 'Tope A4') is null
    and nullif(eb, '') is null and (select estado from public.club_retos where nombre = 'Tope B1') = 'vigente',
    concat_ws(' || ', e, e4, eb));
end $$;

-- 10. guarda de md5 (R13): con club_retos_reglas ya cambiada, el bloque del tope de la 187 aborta sin tocar nada
-- @@187REGLAS@@   (aquí va create function pg_temp.reglas_bloque() … con el bloque «do $$ … $$;» del tope de la 187)
do $$ declare e text; m0 text := md5(pg_get_functiondef('public.club_retos_reglas()'::regprocedure));
begin
  e := pg_temp.error_de('select pg_temp.reglas_bloque()');
  insert into _r187 (caso, ok, detalle) values ('10 guarda de md5: sobre una club_retos_reglas distinta de la 169, el bloque aborta «no es la esperada» y no la cambia',
    e like 'P0001:187: club_retos_reglas no es la esperada (la de la 169)%'
    and md5(pg_get_functiondef('public.club_retos_reglas()'::regprocedure)) = m0, e);
end $$;

-- 07. rollback: se van el trigger, la función y el CHECK; club_retos_reglas vuelve a la de la 169; los retos quedan
-- @@187R@@   (aquí va el cuerpo de scripts/sql/187_rollback.sql sin begin/commit)
insert into _r187 (caso, ok, detalle)
select '07 rollback: sin trigger, función ni CHECK; club_retos_reglas = la de la 169 (md5); Reto A y Reto B siguen',
       md5(pg_get_functiondef('public.club_retos_reglas()'::regprocedure)) = '000ef92116630f046136fc56a90f5b6f'
       and to_regprocedure('public.club_retos_a_un_local()') is null
       and not exists (select 1 from pg_constraint where conname = 'club_retos_un_local')
       and not exists (select 1 from pg_trigger where tgname = 'club_retos_a_un_local_trg')
       and (select count(*) from public.club_retos where nombre in ('Reto A', 'Reto B')) = 2,
       null;

-- 08. el pre-chequeo de la 187 frena si hay un reto de dos locales (sin la 187, se puede crear uno)
do $$ declare e0 text; e1 text;
begin
  e0 := pg_temp.error_de('select pg_temp.prechequeo()');   -- sin retos de dos locales: pasa
  insert into public.club_retos (nombre, nombre_en, locales, desde, hasta, meta)
  values ('Reto Viejo Doble', 'Old Double', array['prueba187a','prueba187b'], '2032-06-01', '2032-06-20', 3);
  e1 := pg_temp.error_de('select pg_temp.prechequeo()');
  insert into _r187 (caso, ok, detalle) values ('08 pre-chequeo: pasa sin retos dobles; con uno, aborta «hay 1 reto(s) con más de un local»',
    e0 is null and e1 like 'P0001:187: hay 1 reto(s) con más de un local%', concat_ws(' | ', e0, e1));
end $$;

-- Resultado
select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r187;

-- ASSERT: cada caso que falla sale como WARNING («187 FALLA <caso> — <detalle>»), después el resumen
-- («187 RESUMEN: pasaron X / fallaron Y de 11») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «187-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 11;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _r187 where ok is not true order by n loop   -- null = falla
    raise warning '187 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r187;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '187 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice '187 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception '187-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
