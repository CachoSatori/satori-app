-- 188_pruebas · club_socio_edad: el rol de socio por función, con control de local para el manager. Postgres local
-- (nunca prod). Aplica la 188 dentro de una transacción, corre la batería y el rollback y termina en ROLLBACK.
-- Corre ANTES de aplicar (R15): base local armada con scripts/sql/local_armar_base.sh (sin la 188).
-- Se corre con scripts/sql/188_pruebas.py (--local … --semilla-local; --mutar todas).
--
-- MARCADORES que llena el runner: «-- @@188@@» → cuerpo de supabase/migrations/188_… sin begin/commit (con --mutar, con
-- el arreglo roto a propósito); «-- @@188R@@» → cuerpo de scripts/sql/188_rollback.sql sin begin/commit.
-- Locales FICTICIOS prueba188a y prueba188b; un owner activo de la base (en local lo crea --semilla-local) y, ficticios,
-- un manager de prueba188a, un cajero, un contador y un salonero. Socios «Socio Ficticio N» (+1 555 01xx, ficción).
begin;
-- @@188@@   (aquí va el cuerpo de la 188 sin begin/commit)
create temp table _r188 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r188 to anon, authenticated;
grant usage on sequence _r188_n_seq to anon, authenticated;

create temp table _c188 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8188-0000000000a1'::uuid as manager_a,
       '00000000-0000-4000-8188-0000000000c1'::uuid as cajero,
       '00000000-0000-4000-8188-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8188-0000000000e1'::uuid as salonero;
grant select on _c188 to anon, authenticated;

insert into public.locations (id, name) values ('prueba188a', 'Local Ficticio A'), ('prueba188b', 'Local Ficticio B')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba188a', 'Local Ficticio A', true), ('prueba188b', 'Local Ficticio B', true);
update public.club_config_global set club_url = coalesce(club_url, 'https://club.ejemplo.test');

insert into auth.users (id, raw_user_meta_data) values
  ((select manager_a from _c188), '{"full_name":"Manager Ficticio A"}'),
  ((select cajero from _c188), '{"full_name":"Cajero Ficticio"}'),
  ((select contador from _c188), '{"full_name":"Contador Ficticio"}'),
  ((select salonero from _c188), '{"full_name":"Salonero Ficticio"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c188), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager', is_active = true where id = (select manager_a from _c188);
update public.profiles set role = 'cajero', is_active = true where id = (select cajero from _c188);
update public.profiles set role = 'contador', is_active = true where id = (select contador from _c188);
update public.profiles set role = 'salonero', is_active = true where id = (select salonero from _c188);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values ((select manager_a from _c188), 'prueba188a', true);

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
create function pg_temp.mid(n int) returns uuid language sql stable as $f$
  select public.club_miembro_por_telefono(pg_temp.tel(n)) $f$;
create function pg_temp.edad(p_uid uuid, p_m uuid) returns jsonb language sql as $f$
  select pg_temp.como(p_uid, format('public.club_socio_edad(%L::uuid)', p_m)) $f$;
create function pg_temp.err_edad(p_uid uuid, p_m uuid) returns text language sql as $f$
  select pg_temp.err_como(p_uid, format('public.club_socio_edad(%L::uuid)', p_m)) $f$;
-- lo que la tabla dice (como lo leía la app antes)
create function pg_temp.tabla(p_m uuid) returns jsonb language sql stable as $f$
  select jsonb_build_object('estado', r.estado, 'baja_por', r.baja_por, 'alta_por', r.alta_por,
                            'validado_en', r.validado_en, 'mayor_edad_en', r.mayor_edad_en)
    from public.club_miembro_roles r where r.miembro_id = p_m and r.rol = 'socio' $f$;

-- Datos: S1 socio de A (alta en caja), S2 socio de B; R3 referente de A sin rol de socio.
do $$ declare v uuid;
begin
  perform pg_temp.como((select cajero from _c188), format(
    'public.club_socio_alta_caja_v3(%L, %L, null, true, true, null, null, null, %L)', 'Socio Ficticio 1', pg_temp.tel(1), 'prueba188a'));
  perform pg_temp.como((select cajero from _c188), format(
    'public.club_socio_alta_caja_v3(%L, %L, null, true, true, null, null, null, %L)', 'Socio Ficticio 2', pg_temp.tel(2), 'prueba188b'));
  insert into public.club_miembros (location_id, tipo, nombre) values ('prueba188a', 'referente', 'Referente Ficticio 3') returning id into v;
  insert into public.club_miembros_contacto (miembro_id, location_id, telefono) values (v, 'prueba188a', pg_temp.tel(3));
  insert into public.club_miembro_roles (miembro_id, rol, estado) values (v, 'referente', 'activo') on conflict do nothing;
end $$;

-- 00. armado
insert into _r188 (caso, ok, detalle)
select '00 armado: owner y personal ficticio con su rol; S1 (A) y S2 (B) socios; R3 sin rol de socio',
       c.owner_id is not null
       and (select count(*) from public.profiles p where p.id in (c.manager_a, c.cajero, c.contador, c.salonero) and p.is_active) = 4
       and pg_temp.tabla(pg_temp.mid(1)) is not null and pg_temp.tabla(pg_temp.mid(2)) is not null
       and pg_temp.mid(3) is not null and pg_temp.tabla(pg_temp.mid(3)) is null,
       null
  from _c188 c;

-- 01. owner: devuelve exactamente lo que dice la tabla (los cinco campos)
insert into _r188 (caso, ok, detalle)
select '01 owner: S1 y S2 iguales a la tabla (estado, baja_por, alta_por, validado_en, mayor_edad_en)',
       a = pg_temp.tabla(pg_temp.mid(1)) and b = pg_temp.tabla(pg_temp.mid(2)) and a->>'estado' is not null,
       concat_ws(' | ', a, b)
  from (select pg_temp.edad(c.owner_id, pg_temp.mid(1)) a, pg_temp.edad(c.owner_id, pg_temp.mid(2)) b from _c188 c) x;

-- 02. manager de A: su socio sí; el de B → «Ficha de otro local» (42501), no «no es socio»
insert into _r188 (caso, ok, detalle)
select '02 manager de A: S1 igual a la tabla; S2 (de B) → 42501 «Ficha de otro local»',
       a = pg_temp.tabla(pg_temp.mid(1)) and b = '42501:Ficha de otro local', concat_ws(' | ', a, b)
  from (select pg_temp.edad(c.manager_a, pg_temp.mid(1)) a, pg_temp.err_edad(c.manager_a, pg_temp.mid(2)) b from _c188 c) x;

-- 03. cajero y contador: sin filtro de local (como hoy la RLS)
insert into _r188 (caso, ok, detalle)
select '03 cajero y contador: S2 (de B) igual a la tabla',
       a = pg_temp.tabla(pg_temp.mid(2)) and b = pg_temp.tabla(pg_temp.mid(2)), concat_ws(' | ', a, b)
  from (select pg_temp.edad(c.cajero, pg_temp.mid(2)) a, pg_temp.edad(c.contador, pg_temp.mid(2)) b from _c188 c) x;

-- 04. salonero → 42501; anon sin EXECUTE
insert into _r188 (caso, ok, detalle)
select '04 salonero → 42501 «Sin permiso»; anon sin EXECUTE',
       a like '42501:Sin permiso%' and not has_function_privilege('anon', 'public.club_socio_edad(uuid)', 'execute'), a
  from (select pg_temp.err_edad(c.salonero, pg_temp.mid(1)) a from _c188 c) x;

-- 05. sin rol de socio o inexistente → null (también para el manager)
insert into _r188 (caso, ok, detalle)
select '05 R3 (sin rol de socio) e id inexistente → null (owner y manager)',
       a is null and b is null and d is null, concat_ws(' | ', a, b, d)
  from (select pg_temp.edad(c.owner_id, pg_temp.mid(3)) a, pg_temp.edad(c.manager_a, pg_temp.mid(3)) b,
               pg_temp.edad(c.manager_a, '00000000-0000-4000-8188-00000000ffff'::uuid) d from _c188 c) x;

-- 06. forma
insert into _r188 (caso, ok, detalle)
select '06 SECURITY DEFINER, search_path fijo, STABLE; EXECUTE solo authenticated',
       p.prosecdef and p.proconfig = array['search_path=public, pg_temp'] and p.provolatile = 's'
       and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'),
       null
  from pg_proc p where p.oid = 'public.club_socio_edad(uuid)'::regprocedure;

-- 07. rollback
-- @@188R@@   (aquí va el cuerpo de scripts/sql/188_rollback.sql sin begin/commit)
insert into _r188 (caso, ok, detalle)
select '07 rollback: sin club_socio_edad; los roles siguen', to_regprocedure('public.club_socio_edad(uuid)') is null
       and pg_temp.tabla(pg_temp.mid(1)) is not null, null;

-- Resultado
select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r188;

-- ASSERT: cada caso que falla sale como WARNING («188 FALLA <caso> — <detalle>»), después el resumen
-- («188 RESUMEN: pasaron X / fallaron Y de 8») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «188-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 8;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _r188 where ok is not true order by n loop   -- null = falla
    raise warning '188 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r188;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '188 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice '188 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception '188-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
