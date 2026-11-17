-- 186_pruebas · Cumpleaños: el owner deshace la marca «enviado» con nota obligatoria. Postgres local (nunca prod).
-- Aplica la 186 dentro de una transacción, corre la batería y el rollback y termina en ROLLBACK: no deja nada.
-- Corre ANTES de aplicar (R15): base local armada con scripts/sql/local_armar_base.sh (con la 185, sin la 186).
-- Se corre con scripts/sql/186_pruebas.py (--local … --semilla-local; --mutar todas).
--
-- MARCADORES que llena el runner: «-- @@186@@» → cuerpo de supabase/migrations/186_… sin begin/commit (con --mutar, con
-- el arreglo roto a propósito); «-- @@186R@@» → cuerpo de scripts/sql/186_rollback.sql sin begin/commit.
-- Locales FICTICIOS prueba186a y prueba186b; un owner activo de la base (en local lo crea --semilla-local), un manager
-- de prueba186a y un cajero ficticios; socios «Socio Ficticio N» con WhatsApp +1 555 01xx (rango de ficción).
-- Las fechas de la lista se prueban con un día FIJO (club_cumple_enviados_lista con p_hoy); las públicas usan el día
-- real de CR, así que esos socios cumplen «hoy + 3» (calculado en la batería, sin depender del día en que corre).
begin;
-- @@186@@   (aquí va el cuerpo de la 186 sin begin/commit)
create temp table _r186 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r186 to anon, authenticated;
grant usage on sequence _r186_n_seq to anon, authenticated;

create temp table _c186 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8186-0000000000a1'::uuid as manager_a,
       '00000000-0000-4000-8186-0000000000c1'::uuid as cajero,
       (now() at time zone 'America/Costa_Rica')::date as hoy,
       (now() at time zone 'America/Costa_Rica')::date + 3 as cumple;
grant select on _c186 to anon, authenticated;

insert into public.locations (id, name) values ('prueba186a', 'Local Ficticio A'), ('prueba186b', 'Local Ficticio B')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba186a', 'Local Ficticio A', true), ('prueba186b', 'Local Ficticio B', true);
insert into public.club_cortesias (location_id, codigo_producto, nombre) values
  ('prueba186a', 'P186A1', 'Postre Ficticio A'), ('prueba186b', 'P186B1', 'Postre Ficticio B');
update public.club_config_global set club_url = coalesce(club_url, 'https://club.ejemplo.test');

insert into auth.users (id, raw_user_meta_data) values
  ((select manager_a from _c186), '{"full_name":"Manager Ficticio A"}'),
  ((select cajero from _c186), '{"full_name":"Cajero Ficticio"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c186), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager', is_active = true where id = (select manager_a from _c186);
update public.profiles set role = 'cajero', is_active = true where id = (select cajero from _c186);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values ((select manager_a from _c186), 'prueba186a', true);

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
create function pg_temp.tel(n int) returns text language sql immutable as $f$ select '+1555018' || lpad(n::text, 3, '0') $f$;
create function pg_temp.alta(n int, p_dia int, p_mes int, p_loc text default 'prueba186a') returns jsonb language sql as $f$
  select pg_temp.como((select cajero from _c186), format(
    'public.club_socio_alta_caja_v3(%L, %L, null, true, true, %s, %s, true, %L)',
    'Socio Ficticio ' || n, pg_temp.tel(n), p_dia, p_mes, p_loc)) $f$;
create function pg_temp.mid(n int) returns uuid language sql stable as $f$
  select public.club_miembro_por_telefono(pg_temp.tel(n)) $f$;
create function pg_temp.cfg(p_loc text) returns jsonb language sql as $f$
  select pg_temp.como((select owner_id from _c186), format('public.club_cumple_config_guardar(%L::jsonb, %L)',
    jsonb_build_object('activo', true, 'beneficio', 'postre de cortesía', 'min_personas', 5, 'dias_antes', 7,
                       'dias_despues', 7, 'uno_por_mesa', true, 'solo_reserva', false,
                       'reserva_url', 'https://reservas.ejemplo.test/r?rid=1',
                       'cortesia_id', (select id from public.club_cortesias where codigo_producto = 'P186' || upper(right(p_loc, 1)) || '1')),
    p_loc)) $f$;
create function pg_temp.marcado(n int) returns boolean language sql stable as $f$
  select exists (select 1 from public.club_cumple_envios e where e.miembro_id = pg_temp.mid(n)) $f$;
create function pg_temp.ids(j jsonb) returns text[] language sql immutable as $f$
  select coalesce(array_agg(x->>'miembro_id' order by o), '{}') from jsonb_array_elements(j) with ordinality t(x, o) $f$;
-- solo los socios S1–S4 (los del día fijo): S5/S6 cumplen «hoy + 3» y podrían caer en la ventana del 28-dic si la
-- batería corre a fin de año
create function pg_temp.ids14(j jsonb) returns text[] language sql stable as $f$
  select coalesce(array_agg(i order by o), '{}') from unnest(pg_temp.ids(j)) with ordinality t(i, o)
   where i in (select pg_temp.mid(n)::text from generate_series(1, 4) n) $f$;

-- Datos: beneficio encendido en los dos locales. Día fijo de la lista: 28-dic-2026.
--   S1 (A) cumple 2-ene, marcado · S2 (A) cumple 31-dic, sin marcar · S3 (B) cumple 2-ene, marcado · S4 (A) cumple
--   20-ene, fuera de la ventana. Con el día real: S5 (A) y S6 (B) cumplen «hoy + 3», marcados hoy.
do $$
begin
  perform pg_temp.cfg('prueba186a'); perform pg_temp.cfg('prueba186b');
  perform pg_temp.alta(1, 2, 1); perform pg_temp.alta(2, 31, 12); perform pg_temp.alta(3, 2, 1, 'prueba186b');
  perform pg_temp.alta(4, 20, 1);
  perform public.club_cumple_marcar(pg_temp.mid(1), 'prueba186a', date '2026-12-28');
  perform public.club_cumple_marcar(pg_temp.mid(3), 'prueba186b', date '2026-12-28');
  perform pg_temp.alta(5, extract(day from (select cumple from _c186))::int, extract(month from (select cumple from _c186))::int);
  perform pg_temp.alta(6, extract(day from (select cumple from _c186))::int, extract(month from (select cumple from _c186))::int, 'prueba186b');
  perform public.club_cumple_marcar(pg_temp.mid(5), 'prueba186a', (select hoy from _c186));
  perform public.club_cumple_marcar(pg_temp.mid(6), 'prueba186b', (select hoy from _c186));
end $$;

-- 00. el armado quedó: personal con su rol, seis socios, cuatro marcas
insert into _r186 (caso, ok, detalle)
select '00 armado: owner, manager y cajero activos; 6 socios; 4 marcas',
       c.owner_id is not null
       and exists (select 1 from public.profiles p where p.id = c.manager_a and p.role::text = 'manager' and p.is_active)
       and exists (select 1 from public.profiles p where p.id = c.cajero and p.role::text = 'cajero' and p.is_active)
       and (select count(*) from generate_series(1, 6) n where pg_temp.mid(n) is not null) = 6
       and pg_temp.marcado(1) and not pg_temp.marcado(2) and pg_temp.marcado(3) and pg_temp.marcado(5) and pg_temp.marcado(6),
       null
  from _c186 c;

-- 01. lista interna: solo los marcados del local dentro de la ventana; complemento exacto de la lista del Inicio
do $$ declare e jsonb; l jsonb;
begin
  e := public.club_cumple_enviados_lista('prueba186a', date '2026-12-28');
  l := public.club_cumple_lista('prueba186a', date '2026-12-28');
  insert into _r186 (caso, ok, detalle) values ('01 «ya saludados» (día fijo): S1 sí; S2 sin marca, S3 de otro local y S4 fuera de ventana no',
    pg_temp.ids14(e) = array[pg_temp.mid(1)::text]
    and exists (select 1 from jsonb_array_elements(e) x where x->>'miembro_id' = pg_temp.mid(1)::text
                   and (x->>'faltan')::int = 5 and x->>'enviado_en' is not null and x->>'nombre' = 'Socio Ficticio 1')
    and pg_temp.ids14(l->'socios') = array[pg_temp.mid(2)::text],
    concat_ws(' | ', e, l->'socios'));
exception when others then
  insert into _r186 (caso, ok, detalle) values ('01 (error sin atrapar)', false, sqlerrm);
end $$;

-- 02. la pública, como owner (día real): trae S5 y no S6 (otro local)
do $$ declare e jsonb;
begin
  e := pg_temp.como((select owner_id from _c186), 'public.club_cumple_enviados(''prueba186a'')');
  insert into _r186 (caso, ok, detalle) values ('02 club_cumple_enviados como owner: S5 (faltan 3), sin S6 de otro local',
    pg_temp.ids(e) = array[pg_temp.mid(5)::text] and (e->0->>'faltan')::int = 3, e::text);
exception when others then
  insert into _r186 (caso, ok, detalle) values ('02 (error sin atrapar)', false, sqlerrm);
end $$;

-- 03. «ya saludados»: manager y cajero no (42501); anon sin EXECUTE
insert into _r186 (caso, ok, detalle)
select '03 club_cumple_enviados: manager y cajero → 42501; anon sin EXECUTE',
       a like '42501:Sin permiso%' and b like '42501:Sin permiso%'
       and not has_function_privilege('anon', 'public.club_cumple_enviados(text)', 'execute'),
       concat_ws(' | ', a, b)
  from (select pg_temp.err_como(c.manager_a, 'public.club_cumple_enviados(''prueba186a'')') a,
               pg_temp.err_como(c.cajero, 'public.club_cumple_enviados(''prueba186a'')') b from _c186 c) x;

-- 04. sin nota, nota corta o de más de 500: no deshace
insert into _r186 (caso, ok, detalle)
select '04 nota obligatoria (3 a 500): null, «ok» y 501 caracteres no deshacen; la marca sigue',
       a like 'P0001:Escribí una nota%' and b like 'P0001:Escribí una nota%' and d like 'P0001:Escribí una nota%'
       and pg_temp.marcado(5),
       concat_ws(' | ', a, b, d)
  from (select pg_temp.err_como(c.owner_id, format('public.club_cumple_deshacer_envio(%L, null, ''prueba186a'')', pg_temp.mid(5))) a,
               pg_temp.err_como(c.owner_id, format('public.club_cumple_deshacer_envio(%L, ''  ok  '', ''prueba186a'')', pg_temp.mid(5))) b,
               pg_temp.err_como(c.owner_id, format('public.club_cumple_deshacer_envio(%L, %L, ''prueba186a'')', pg_temp.mid(5), repeat('x', 501))) d
          from _c186 c) x;

-- 05. manager (de su propio local) y cajero no deshacen; anon sin EXECUTE
insert into _r186 (caso, ok, detalle)
select '05 deshacer: manager y cajero → 42501; anon sin EXECUTE; la marca sigue',
       a like '42501:Sin permiso%' and b like '42501:Sin permiso%' and pg_temp.marcado(5)
       and not has_function_privilege('anon', 'public.club_cumple_deshacer_envio(uuid,text,text)', 'execute'),
       concat_ws(' | ', a, b)
  from (select pg_temp.err_como(c.manager_a, format('public.club_cumple_deshacer_envio(%L, ''tocado por error'', ''prueba186a'')', pg_temp.mid(5))) a,
               pg_temp.err_como(c.cajero, format('public.club_cumple_deshacer_envio(%L, ''tocado por error'', ''prueba186a'')', pg_temp.mid(5))) b
          from _c186 c) x;

-- 06. socio de otro local pasado con el local A: no se toca su marca
insert into _r186 (caso, ok, detalle)
select '06 socio de otro local (S6 con prueba186a) → «no está marcado»; su marca sigue',
       a like 'P0001:Ese saludo no está marcado%' and pg_temp.marcado(6), a
  from (select pg_temp.err_como(c.owner_id, format('public.club_cumple_deshacer_envio(%L, ''tocado por error'', ''prueba186a'')', pg_temp.mid(6))) a
          from _c186 c) x;

-- 07. owner con nota: deshace, audita (fila borrada + nota) y el socio vuelve a la lista del Inicio
do $$ declare r jsonb; l jsonb; e jsonb; au record;
begin
  r := pg_temp.como((select owner_id from _c186), format('public.club_cumple_deshacer_envio(%L, ''  WhatsApp no abrió  '', ''prueba186a'')', pg_temp.mid(5)));
  l := public.club_cumple_lista('prueba186a', (select hoy from _c186));
  e := pg_temp.como((select owner_id from _c186), 'public.club_cumple_enviados(''prueba186a'')');
  select * into au from public.club_auditoria a where a.accion = 'cumple_deshacer_envio' and a.objeto_id = pg_temp.mid(5)
   order by a.en desc limit 1;
  insert into _r186 (caso, ok, detalle) values ('07 owner con nota: borra la marca, audita (antes = fila, después = nota) y vuelve a la lista',
    r = 'true'::jsonb and not pg_temp.marcado(5)
    and au.actor = (select owner_id from _c186) and au.rol = 'owner' and au.tabla = 'club_cumple_envios'
    and au.antes->>'miembro_id' = pg_temp.mid(5)::text and (au.antes->>'anio')::int = extract(year from (select cumple from _c186))::int
    and au.despues->>'nota' = 'WhatsApp no abrió' and au.despues->>'local' = 'prueba186a'
    and pg_temp.mid(5)::text = any(pg_temp.ids(l->'socios'))
    and jsonb_array_length(e) = 0
    and pg_temp.marcado(1) and pg_temp.marcado(3) and pg_temp.marcado(6),
    concat_ws(' | ', r, to_jsonb(au)));
exception when others then
  insert into _r186 (caso, ok, detalle) values ('07 (error sin atrapar)', false, sqlerrm);
end $$;

-- 08. deshacer otra vez → «no está marcado»; se puede volver a marcar (el WhatsApp del Inicio)
do $$ declare a text; m jsonb;
begin
  a := pg_temp.err_como((select owner_id from _c186), format('public.club_cumple_deshacer_envio(%L, ''otra vez'', ''prueba186a'')', pg_temp.mid(5)));
  m := pg_temp.como((select owner_id from _c186), format('public.club_cumple_enviar(%L, ''prueba186a'')', pg_temp.mid(5)));
  insert into _r186 (caso, ok, detalle) values ('08 sin marca → «no está marcado»; después se vuelve a marcar con club_cumple_enviar',
    a like 'P0001:Ese saludo no está marcado%' and m->>'whatsapp' = pg_temp.tel(5) and pg_temp.marcado(5),
    concat_ws(' | ', a, m));
exception when others then
  insert into _r186 (caso, ok, detalle) values ('08 (error sin atrapar)', false, sqlerrm);
end $$;

-- 09. permisos y forma de las funciones
insert into _r186 (caso, ok, detalle)
select '09 permisos: lista interna sin EXECUTE para la API; las dos públicas SECURITY DEFINER con search_path fijo',
       not has_function_privilege('authenticated', 'public.club_cumple_enviados_lista(text,date)', 'execute')
       and not has_function_privilege('anon', 'public.club_cumple_enviados_lista(text,date)', 'execute')
       and has_function_privilege('authenticated', 'public.club_cumple_enviados(text)', 'execute')
       and has_function_privilege('authenticated', 'public.club_cumple_deshacer_envio(uuid,text,text)', 'execute')
       and (select bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp']) from pg_proc p
             where p.oid in ('public.club_cumple_enviados(text)'::regprocedure, 'public.club_cumple_deshacer_envio(uuid,text,text)'::regprocedure)),
       null;

-- 10. rollback: las tres funciones se van; las marcas quedan como estaban
-- @@186R@@   (aquí va el cuerpo de scripts/sql/186_rollback.sql sin begin/commit)
insert into _r186 (caso, ok, detalle)
select '10 rollback: sin las tres funciones; marcas intactas',
       to_regprocedure('public.club_cumple_deshacer_envio(uuid,text,text)') is null
       and to_regprocedure('public.club_cumple_enviados(text)') is null
       and to_regprocedure('public.club_cumple_enviados_lista(text,date)') is null
       and pg_temp.marcado(1) and pg_temp.marcado(3) and pg_temp.marcado(5) and pg_temp.marcado(6),
       null;

-- Resultado
select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r186;

-- ASSERT: cada caso que falla sale como WARNING («186 FALLA <caso> — <detalle>»), después el resumen
-- («186 RESUMEN: pasaron X / fallaron Y de 11») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «186-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 11;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _r186 where ok is not true order by n loop   -- null = falla
    raise warning '186 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r186;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '186 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice '186 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception '186-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
