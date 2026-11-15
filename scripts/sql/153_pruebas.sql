-- 153_pruebas (origen 096) · SOLO STAGING. Aplica la 153 dentro de una transacción, prueba y termina en ROLLBACK: no
-- deja nada. Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con
-- «153-FALLAN: <casos>». Se corre con scripts/sql/153_pruebas.py, o a mano con el SQL armado (153_pruebas.py --armar).
--
-- MARCADOR que llena el runner: la línea «-- @@153@@ …» → el cuerpo de supabase/migrations/153_proveedor_agregar_alias.sql
-- sin begin; / commit; (es re-ejecutable: también vale sobre un staging que ya la tiene). Con --mutar, ese cuerpo va con
-- un arreglo deshecho a propósito y algún caso tiene que caer.
-- Usuarios ACTIVOS de la base, elegidos acá adentro: el «escritor» (rol que suppliers_op_write deja escribir, en este
-- orden: cajero → manager → owner; el caso 00 dice cuál usó), un contador y un salonero. Si falta alguno, el caso 00
-- falla: NO PROBADO no da verde. El JWT se simula con set_config('request.jwt.claims', …, true).
-- Proveedores de prueba con nombres ficticios; todo se descarta con el rollback.
begin;
-- @@153@@   (aquí va el cuerpo de la 153 sin begin/commit)
create temp table _r96 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r96 to authenticated;
grant usage on sequence _r96_n_seq to authenticated;
create temp table _u96 on commit drop as
select 'escritor'::text as rol, e.id, e.rol_real
  from (select null::int) x
  left join lateral (select p.id, p.role::text as rol_real from public.profiles p
                      where p.is_active and p.role::text in ('cajero', 'manager', 'owner')
                      order by array_position(array['cajero', 'manager', 'owner'], p.role::text), p.id limit 1) e on true
union all
select r.rol, (select p.id from public.profiles p where p.role::text = r.rol and p.is_active order by p.id limit 1), r.rol
  from unnest(array['contador', 'salonero']) as r(rol);
-- claims de un rol de prueba (o sin sub si no hay usuario: el caso 00 ya falla)
create function pg_temp.jwt96(p_rol text) returns text language sql as $f$
  select json_build_object('sub', (select id from _u96 where rol = p_rol), 'role', 'authenticated')::text
$f$;

-- 00. hay escritor (cajero → manager → owner), contador y salonero activos; el detalle dice qué rol escribe
insert into _r96 (caso, ok, detalle)
select '00 hay escritor (cajero/manager/owner), contador y salonero activos en la base', bool_and(id is not null),
       'escritor = ' || coalesce((select rol_real from _u96 where rol = 'escritor' and id is not null), 'NINGUNO')
       || ' · faltan: ' || coalesce(string_agg(rol, ', ') filter (where id is null), '—')
  from _u96;

insert into public.suppliers (id, name, is_active, aliases) values
  ('00000000-0000-4000-8000-000000000961', 'Proveedor Prueba Noventa', true,  array['Legal Uno, S.A.']),
  ('00000000-0000-4000-8000-000000000962', 'Proveedor Prueba Inactivo', false, null),
  ('00000000-0000-4000-8000-000000000963', 'Proveedor Prueba Sin Alias', true, null);

-- 0. catálogo: INVOKER, anon sin EXECUTE, authenticated con EXECUTE
insert into _r96 (caso, ok, detalle)
select '0 catálogo: INVOKER · anon sin EXECUTE · authenticated con EXECUTE',
       not (select prosecdef from pg_proc where oid = 'public.proveedor_agregar_alias(uuid,text)'::regprocedure)
       and not has_function_privilege('anon', 'public.proveedor_agregar_alias(uuid,text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.proveedor_clave_alias(text)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.proveedor_agregar_alias(uuid,text)', 'EXECUTE'), null;

-- 1–6: como el ESCRITOR activo (cajero → manager → owner)
do $$
declare r boolean; v text[];
begin
  perform set_config('request.jwt.claims', pg_temp.jwt96('escritor'), true);
  set local role authenticated;

  -- 1. agrega y conserva los que había
  r := public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000961', '  Legal Dos Ltda  ');
  select aliases into v from public.suppliers where id = '00000000-0000-4000-8000-000000000961';
  insert into _r96 (caso, ok, detalle) values ('1 escritor agrega: true, conserva el anterior y guarda el alias recortado',
    r is true and v = array['Legal Uno, S.A.', 'Legal Dos Ltda'], coalesce(v::text, 'null'));

  -- 2. misma clave con otro formato → no duplica
  r := public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000961', 'LEGAL DÓS, ltda.');
  select aliases into v from public.suppliers where id = '00000000-0000-4000-8000-000000000961';
  insert into _r96 (caso, ok, detalle) values ('2 misma clave (mayúsculas, tilde, puntuación) → false, no duplica',
    r is false and cardinality(v) = 2, coalesce(v::text, 'null'));

  -- 3. igual al NOMBRE del proveedor (por clave) → no se agrega
  r := public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000961', 'proveedor prueba noventa');
  select aliases into v from public.suppliers where id = '00000000-0000-4000-8000-000000000961';
  insert into _r96 (caso, ok, detalle) values ('3 igual al nombre por clave → false, no cambia',
    r is false and cardinality(v) = 2, coalesce(v::text, 'null'));

  -- 4. aliases null → arranca la lista
  r := public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000963', 'Nombre Legal Tres');
  select aliases into v from public.suppliers where id = '00000000-0000-4000-8000-000000000963';
  insert into _r96 (caso, ok, detalle) values ('4 aliases null → true y queda [alias]',
    r is true and v = array['Nombre Legal Tres'], coalesce(v::text, 'null'));

  -- 5. proveedor inactivo → false, no cambia
  r := public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000962', 'Nombre Legal Cuatro');
  select aliases into v from public.suppliers where id = '00000000-0000-4000-8000-000000000962';
  insert into _r96 (caso, ok, detalle) values ('5 proveedor inactivo → false, no cambia', r is false and v is null, coalesce(v::text, 'null'));

  -- 6. proveedor que no existe → false
  r := public.proveedor_agregar_alias('00000000-0000-4000-8000-0000000009ff', 'Nombre Legal Cinco');
  insert into _r96 (caso, ok, detalle) values ('6 proveedor inexistente → false', r is false, null);
  reset role;
end $$;

-- 7. alias corto (clave < 4) → 22023
do $$ begin
  perform set_config('request.jwt.claims', pg_temp.jwt96('escritor'), true);
  set local role authenticated;
  perform public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000961', 'S. A.');
  reset role;
  insert into _r96 (caso, ok, detalle) values ('7 alias corto («S. A.», clave de 2) → rechaza 22023', false, 'no dio error');
exception when others then
  reset role;
  insert into _r96 (caso, ok, detalle) values ('7 alias corto («S. A.», clave de 2) → rechaza 22023', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
end $$;

-- 8. alias vacío (solo puntuación) → 22023
do $$ begin
  perform set_config('request.jwt.claims', pg_temp.jwt96('escritor'), true);
  set local role authenticated;
  perform public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000961', ' ,.- ');
  reset role;
  insert into _r96 (caso, ok, detalle) values ('8 alias vacío (solo puntuación) → rechaza 22023', false, 'no dio error');
exception when others then
  reset role;
  insert into _r96 (caso, ok, detalle) values ('8 alias vacío (solo puntuación) → rechaza 22023', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
end $$;

-- 9. CONTADOR (lee suppliers por la 095, no escribe): la RLS no lo deja → false y la fila no cambia
do $$
declare r boolean; vio boolean;
begin
  perform set_config('request.jwt.claims', pg_temp.jwt96('contador'), true);
  set local role authenticated;
  vio := exists (select 1 from public.suppliers where id = '00000000-0000-4000-8000-000000000961');
  r := public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000961', 'Alias Del Contador');
  reset role;
  insert into _r96 (caso, ok, detalle)
  select '9 contador (ve la fila) → false y no cambia (RLS)',
         vio and r is false
         and not exists (select 1 from public.suppliers where id = '00000000-0000-4000-8000-000000000961'
                          and 'Alias Del Contador' = any (aliases)),
         'vio=' || vio || ' r=' || coalesce(r::text, 'null');
exception when others then
  reset role;
  insert into _r96 (caso, ok, detalle) values ('9 contador (ve la fila) → false y no cambia (RLS)', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 10. SALONERO → false y la fila no cambia
do $$
declare r boolean;
begin
  perform set_config('request.jwt.claims', pg_temp.jwt96('salonero'), true);
  set local role authenticated;
  r := public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000961', 'Alias Del Salonero');
  reset role;
  insert into _r96 (caso, ok, detalle)
  select '10 salonero → false y no cambia (RLS)',
         r is false and not exists (select 1 from public.suppliers where id = '00000000-0000-4000-8000-000000000961'
                                     and 'Alias Del Salonero' = any (aliases)),
         'r=' || coalesce(r::text, 'null');
exception when others then
  reset role;
  insert into _r96 (caso, ok, detalle) values ('10 salonero → false y no cambia (RLS)', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 11. anon: sin EXECUTE
do $$ begin
  set local role anon;
  perform public.proveedor_agregar_alias('00000000-0000-4000-8000-000000000961', 'Alias Anonimo');
  reset role;
  insert into _r96 (caso, ok, detalle) values ('11 anon → permission denied (42501)', false, 'no dio error');
exception when others then
  reset role;
  insert into _r96 (caso, ok, detalle) values ('11 anon → permission denied (42501)', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

-- 12. paridad de la clave con claveProveedor del cliente (mismos ejemplos que proveedorAlias.test.ts)
insert into _r96 (caso, ok, detalle)
select '12 clave = claveProveedor del cliente',
       public.proveedor_clave_alias('Exportadora X, S.A.') = 'exportadoraxsa'
       and public.proveedor_clave_alias('ÁÉÍÓÚ Ñ ü ç') = 'aeiounuc'
       and public.proveedor_clave_alias(null) = '', null;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r96;
-- (el detalle del caso 00 dice con qué rol se probó la escritura)

-- ASSERT: si algún caso falla, la transacción aborta y dice cuáles
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r96 where ok is not true;   -- null = falla
  if v is not null then raise exception '153-FALLAN: %', v; end if;
  if (select count(*) from _r96) <> 14 then raise exception '153-FALLAN: se esperaban 14 casos'; end if;
end $$;
rollback;
