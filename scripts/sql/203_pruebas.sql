-- 203_pruebas · pos_familia_nombre_guardar (el owner pone el nombre de una familia del PoS). Transacción que termina en
-- ROLLBACK: no deja nada. Usa un LOCAL FICTICIO ('prueba-203') con familias y usuarios inventados.
-- Corre en STAGING (ref hwiatgic…), antes o después de aplicar la 203 (si ya está, se saca DENTRO de la transacción para
-- probar el archivo), o en un Postgres 16 local armado con scripts/sql/local_armar_base.sh (con --local). Nunca contra PROD.
-- Se arma y se corre con scripts/sql/203_pruebas.py (--armar [--local] [--mutar X] | --psql "<conexión>" [--mutar todas]).
-- MARCADORES: «@@preludio@@» → 203_preludio_local.sql (solo con --local) · «@@203@@» → cuerpo de
-- supabase/migrations/203_pos_familia_nombre.sql (con --mutar, roto a propósito) · «@@203_texto@@» → el mismo cuerpo
-- como texto (guarda de «ya existe») · «@@203_rollback@@» → scripts/sql/203_rollback.sql.
begin;
create temp table _r203 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _a203 (k text primary key, v text) on commit drop;
grant all on _r203, _a203 to public;
grant usage on sequence _r203_n_seq to public;
-- @@preludio@@

-- Si la 203 ya estaba aplicada en esta base, se saca DENTRO de la transacción: se prueba el archivo.
drop function if exists public.pos_familia_nombre_guardar(text, integer, text);

-- ── Datos ficticios ──────────────────────────────────────────────────────────────────────────────────────────────
create temp table _c203 on commit drop as
select '00000000-0000-4000-8202-0000000000b1'::uuid as owner_id,
       '00000000-0000-4000-8202-0000000000b2'::uuid as owner_inactivo,
       '00000000-0000-4000-8202-0000000000a1'::uuid as manager,       -- manager de prueba-203 (su local)
       '00000000-0000-4000-8202-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8202-0000000000e1'::uuid as salonero,
       '00000000-0000-4000-8202-0000000000e2'::uuid as cajero,
       'prueba-203'::text as loc;
grant select on _c203 to public;
insert into public.locations (id, name, is_active) values ('prueba-203', 'Local de prueba 203', false) on conflict (id) do nothing;
insert into auth.users (id, raw_user_meta_data)
select x, '{"full_name":"Ficticio 203"}'::jsonb
  from _c203 c, unnest(array[c.owner_id, c.owner_inactivo, c.manager, c.contador, c.salonero, c.cajero]) x;
update public.profiles p set role = r.rol::public.user_role, is_active = r.activo
  from _c203 c, (values (1, 'owner', true), (2, 'owner', false), (3, 'manager', true), (4, 'contador', true),
                        (5, 'salonero', true), (6, 'cajero', true)) r(i, rol, activo)
 where p.id = (array[c.owner_id, c.owner_inactivo, c.manager, c.contador, c.salonero, c.cajero])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, loc from _c203;
insert into public.profile_locations (profile_id, location_id) select salonero, loc from _c203;
-- Familias ficticias del local de prueba (como las carga una migración: con el rol de la sesión).
insert into public.pos_familias (local, familia, nombre, categoria, orden) values
  ('prueba-203',  7, 'Grupo A (surf)',      'otros',    10),
  ('prueba-203',  5, 'BEBIDAS FICTICIAS',   'bebida',   10),
  ('prueba-203', 17, 'CORTESIAS FICTICIAS', 'cortesia', 10);
-- Huella de lo que NO se puede mover: todas las filas salvo el nombre de la familia 7 de prueba-203, y la categoría y
-- el orden de esa misma fila.
create temp table _h203 on commit drop as
select md5(string_agg(format('%s|%s|%s|%s|%s', local, familia,
                             case when local = 'prueba-203' and familia = 7 then '' else nombre end, categoria, orden),
                      ';' order by local, familia)) as h
  from public.pos_familias;

-- ── La 203 ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- @@203@@

-- ── Ayudantes ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Llama la puerta como el usuario (JWT de authenticated; null = anon). Devuelve el nombre guardado o «ERR:<sqlstate>».
create function pg_temp.rpc(p_uid uuid, p_local text, p_familia int, p_nombre text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  r := public.pos_familia_nombre_guardar(p_local, p_familia, p_nombre);
  reset role; perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  reset role; perform set_config('request.jwt.claims', '', true);
  return 'ERR:' || sqlstate;
end $f$;
-- Un UPDATE directo a la tabla como el usuario: cuántas filas tocó, o el SQLSTATE.
create function pg_temp.directo(p_uid uuid) returns text language plpgsql as $f$
declare k int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.pos_familias set nombre = 'DIRECTO' where local = 'prueba-203' and familia = 5;
  get diagnostics k = row_count;
  reset role; perform set_config('request.jwt.claims', '', true);
  return k::text;
exception when others then
  reset role; perform set_config('request.jwt.claims', '', true);
  return 'ERR:' || sqlstate;
end $f$;
create function pg_temp.nom(p_familia int) returns text language sql as $f$
  select nombre from public.pos_familias where local = 'prueba-203' and familia = p_familia $f$;

-- ═══ A. El owner cambia el nombre ═══════════════════════════════════════════════════════════════════════════════
insert into _a203 select 'r01', pg_temp.rpc(owner_id, loc, 7, '  Escuela   Ficticia  (surf) ') from _c203;
insert into _r203 (caso, ok, detalle)
select '01 owner: cambia el nombre, sin espacios a los costados ni repetidos, y lo devuelve como quedó',
       (select v from _a203 where k = 'r01') = 'Escuela Ficticia (surf)' and pg_temp.nom(7) = 'Escuela Ficticia (surf)',
       (select v from _a203 where k = 'r01') || ' / ' || pg_temp.nom(7);
insert into _r203 (caso, ok, detalle)
select '02 solo cambia ese nombre: categoría, orden y las demás familias (de todos los locales) quedan igual',
       (select md5(string_agg(format('%s|%s|%s|%s|%s', local, familia,
                                     case when local = 'prueba-203' and familia = 7 then '' else nombre end, categoria, orden),
                              ';' order by local, familia)) from public.pos_familias) = (select h from _h203),
       null;
insert into _a203 select 'r03', pg_temp.rpc(owner_id, loc, 7, 'Ñandú Café #2 & Co. - 1/2 + ''A'', B') from _c203;
insert into _r203 (caso, ok, detalle)
select '03 owner: tildes, ñ y ( ) . , - / & '' + # se aceptan',
       (select v from _a203 where k = 'r03') = 'Ñandú Café #2 & Co. - 1/2 + ''A'', B', (select v from _a203 where k = 'r03');
insert into _a203 select 'r04', pg_temp.rpc(owner_id, loc, 7, repeat('x', 40)) from _c203;
insert into _r203 (caso, ok, detalle)
select '04 owner: 40 caracteres entran', (select v from _a203 where k = 'r04') = repeat('x', 40), (select v from _a203 where k = 'r04');
insert into _a203 select 'r05', pg_temp.rpc(owner_id, loc, 17, 'Regalías ficticias') from _c203;
insert into _r203 (caso, ok, detalle)
select '05 owner: renombrar la familia de regalías no le cambia la categoría (sigue cortesia)',
       (select v from _a203 where k = 'r05') = 'Regalías ficticias'
       and (select categoria from public.pos_familias where local = 'prueba-203' and familia = 17) = 'cortesia',
       (select v from _a203 where k = 'r05');
select set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true) from _c203;
insert into _a203 select 'r06', public.pos_catalogo_productos('prueba-203') -> 'familias';
select set_config('request.jwt.claims', '', true);
insert into _r203 (caso, ok, detalle)
select '06 el catálogo de Ajustes (pos_catalogo_productos) devuelve el nombre nuevo',
       exists (select 1 from jsonb_array_elements((select v from _a203 where k = 'r06')::jsonb) e
                where (e ->> 0)::int = 17 and e ->> 1 = 'Regalías ficticias'),
       (select v from _a203 where k = 'r06');

-- ═══ B. Nadie más ═══════════════════════════════════════════════════════════════════════════════════════════════
insert into _a203 select 'r07', pg_temp.rpc(manager, loc, 7, 'Manager ficticio') from _c203;
insert into _a203 select 'r08', pg_temp.rpc(contador, loc, 7, 'Contador ficticio') from _c203;
insert into _a203 select 'r09s', pg_temp.rpc(salonero, loc, 7, 'Salonero ficticio') from _c203;
insert into _a203 select 'r09c', pg_temp.rpc(cajero, loc, 7, 'Cajero ficticio') from _c203;
insert into _a203 select 'r10', pg_temp.rpc(owner_inactivo, loc, 7, 'Inactivo ficticio') from _c203;
insert into _a203 select 'r11', pg_temp.rpc(null, loc, 7, 'Anon ficticio') from _c203;
insert into _r203 (caso, ok, detalle)
select '07 manager, aun en SU local → 42501 y no cambia nada', (select v from _a203 where k = 'r07') = 'ERR:42501' and pg_temp.nom(7) = repeat('x', 40),
       (select v from _a203 where k = 'r07');
insert into _r203 (caso, ok, detalle)
select '08 contador → 42501', (select v from _a203 where k = 'r08') = 'ERR:42501', (select v from _a203 where k = 'r08');
insert into _r203 (caso, ok, detalle)
select '09 salonero y cajero → 42501', (select v from _a203 where k = 'r09s') = 'ERR:42501' and (select v from _a203 where k = 'r09c') = 'ERR:42501',
       (select v from _a203 where k = 'r09s') || ' / ' || (select v from _a203 where k = 'r09c');
insert into _r203 (caso, ok, detalle)
select '10 owner INACTIVO → 42501', (select v from _a203 where k = 'r10') = 'ERR:42501', (select v from _a203 where k = 'r10');
insert into _r203 (caso, ok, detalle)
select '11 anon: sin execute (42501) y sin privilegio',
       (select v from _a203 where k = 'r11') = 'ERR:42501'
       and not has_function_privilege('anon', 'public.pos_familia_nombre_guardar(text,integer,text)', 'execute'),
       (select v from _a203 where k = 'r11');
insert into _r203 (caso, ok, detalle)
select '12 nadie (ni el owner) escribe la tabla directo por la API: la única puerta es la función',
       pg_temp.directo(owner_id) in ('ERR:42501', '0') and pg_temp.directo(manager) in ('ERR:42501', '0')
       and pg_temp.nom(5) = 'BEBIDAS FICTICIAS',
       pg_temp.directo(owner_id) || ' / ' || pg_temp.directo(manager)
  from _c203;

-- ═══ C. Nombre ══════════════════════════════════════════════════════════════════════════════════════════════════
insert into _a203 select 'r13a', pg_temp.rpc(owner_id, loc, 5, '') from _c203;
insert into _a203 select 'r13b', pg_temp.rpc(owner_id, loc, 5, '   ') from _c203;
insert into _a203 select 'r13c', pg_temp.rpc(owner_id, loc, 5, null) from _c203;
insert into _r203 (caso, ok, detalle)
select '13 nombre vacío, solo espacios o null → 22023',
       (select count(*) from _a203 where k in ('r13a', 'r13b', 'r13c') and v = 'ERR:22023') = 3,
       (select string_agg(v, ' / ' order by k) from _a203 where k like 'r13%');
insert into _a203 select 'r14', pg_temp.rpc(owner_id, loc, 5, repeat('x', 41)) from _c203;
insert into _r203 (caso, ok, detalle)
select '14 41 caracteres → 22023', (select v from _a203 where k = 'r14') = 'ERR:22023', (select v from _a203 where k = 'r14');
insert into _a203 select 'r15' || i, pg_temp.rpc(owner_id, loc, 5, x)
  from _c203, unnest(array['alguien@ejemplo.test', '<b>x</b>', 'a; drop', 'emoji 🍣', 'comilla "doble"', 'dólar $5',
                           'por%ciento', 'guion_bajo', 'barra\x', 'ñ' || chr(0x200B)]) with ordinality u(x, i);
insert into _r203 (caso, ok, detalle)
select '15 caracteres fuera de la lista (@ < > ; emoji, " $ % _ \ y un espacio invisible) → 22023 y no cambia nada',
       (select count(*) from _a203 where k like 'r15%' and v = 'ERR:22023') = 10 and pg_temp.nom(5) = 'BEBIDAS FICTICIAS',
       (select string_agg(k || '=' || v, ' ' order by k) from _a203 where k like 'r15%' and v <> 'ERR:22023');

insert into _a203 select 'r15b', pg_temp.rpc(owner_id, loc, 5, 'Línea' || chr(10) || chr(9) || ' dos') from _c203;
insert into _r203 (caso, ok, detalle)
select '15b un salto de línea o un tab pegados se vuelven UN espacio (no quedan en el nombre)',
       (select v from _a203 where k = 'r15b') = 'Línea dos' and pg_temp.nom(5) = 'Línea dos', (select v from _a203 where k = 'r15b');

-- ═══ D. Familia y local ═════════════════════════════════════════════════════════════════════════════════════════
insert into _a203 select 'r16', pg_temp.rpc(owner_id, loc, 99, 'Nueva ficticia') from _c203;
insert into _r203 (caso, ok, detalle)
select '16 familia que no existe en el local → 22023 y NO se crea',
       (select v from _a203 where k = 'r16') = 'ERR:22023'
       and not exists (select 1 from public.pos_familias where local = 'prueba-203' and familia = 99),
       (select v from _a203 where k = 'r16');
insert into _a203 select 'r17', pg_temp.rpc(owner_id, 'local-que-no-existe-203', 7, 'Otro ficticio') from _c203;
insert into _a203 select 'r17n', pg_temp.rpc(owner_id, null, 7, 'Otro ficticio') from _c203;
insert into _a203 select 'r17f', pg_temp.rpc(owner_id, loc, null, 'Otro ficticio') from _c203;
insert into _r203 (caso, ok, detalle)
select '17 local desconocido, local null o familia null → 22023',
       (select count(*) from _a203 where k in ('r17', 'r17n', 'r17f') and v = 'ERR:22023') = 3,
       (select string_agg(v, ' / ' order by k) from _a203 where k like 'r17%');

-- ═══ E. Forma de la función ═════════════════════════════════════════════════════════════════════════════════════
insert into _r203 (caso, ok, detalle)
select '18 SECURITY DEFINER con search_path fijo (public, pg_temp)',
       p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp'],
       coalesce(array_to_string(p.proconfig, ','), '(sin config)')
  from pg_proc p where p.oid = 'public.pos_familia_nombre_guardar(text,integer,text)'::regprocedure;

-- ═══ F. Guarda y vuelta atrás ═══════════════════════════════════════════════════════════════════════════════════
do $g$ begin
  begin
    execute $m203$
-- @@203_texto@@
    $m203$;
    insert into _a203 values ('r19', 'corrió');
  exception when others then insert into _a203 values ('r19', sqlerrm);
  end;
end $g$;
insert into _r203 (caso, ok, detalle)
select '19 correr la 203 otra vez se para en la guarda («ya existe») sin tocar nada',
       (select v from _a203 where k = 'r19') like '203: pos_familia_nombre_guardar ya existe%'
       and (select count(*) from pg_proc where proname = 'pos_familia_nombre_guardar') = 1,
       (select v from _a203 where k = 'r19');
-- @@203_rollback@@
insert into _r203 (caso, ok, detalle)
select '20 después de 203_rollback.sql no queda la función y el comentario vuelve al de la 198',
       to_regprocedure('public.pos_familia_nombre_guardar(text,integer,text)') is null
       and obj_description('public.pos_familias'::regclass, 'pg_class') like 'Mig 198. %nadie la edita desde la app%',
       null;

select json_build_object(
  'ok', (select count(*) from _r203 where ok), 'fallas', (select count(*) from _r203 where ok is not true),
  'fallaron', (select json_agg(json_build_array(left(caso, 2), left(coalesce(detalle, ''), 200)) order by n) from _r203 where ok is not true)) as resultado;
rollback;
