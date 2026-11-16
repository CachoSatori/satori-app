-- 176_pruebas (origen club 122) · el manager ve en las LISTAS del Club solo las fichas de sus locales.
-- Aplica la 176 dentro de una transacción, arma datos ficticios, prueba y termina en ROLLBACK: no deja nada. Al final un
-- ASSERT: si algún caso falla, aborta con «176-FALLAN: <casos>». Se corre con scripts/sql/176_pruebas.py (--local:
-- Postgres 16 local; --armar: imprime el SQL para staging, con el OK del dueño). Necesita la 170 y la 172 en la base.
--
-- MARCADORES que llena el runner: «-- @@176@@» → cuerpo de supabase/migrations/176_club_local_manager_listas.sql sin
-- begin/commit; «-- @@176R@@» → cuerpo de scripts/sql/176_rollback.sql sin begin/commit (sin el delete del ledger).
--
-- Todo ficticio: dos locales nuevos (p176-a y p176-b, los dos con el Club encendido) y, en CADA uno, un negocio, un
-- anfitrión, un socio con alta provisional y solicitud abierta, un cupón, un código de canje, un canje, una visita, una
-- alerta, un cruce manual, una excepción resuelta, una carga vieja, un pase, una visita de socio con reseña, premio de
-- primeros 90 y premio de reto, y un reto del local. Además un reto de los dos locales y un movimiento en A de un
-- miembro de B. JWT simulado con set_config('request.jwt.claims', …, true).
--   M_A: manager de p176-a · M_B: manager de p176-b · M_AB: manager de los dos · M_0: manager sin asignación (091: solo
--   santa-teresa) · OW: owner · CO: contador · CA: cajero de p176-a.
-- «Igual que hoy» se prueba comparando, para el mismo usuario y los mismos argumentos, la respuesta del envoltorio con la
-- del núcleo (la función original), y en RLS, lo que cada usuario lee antes y después de la 176 en la misma transacción.
begin;

-- ── Usuarios, locales y datos ficticios ───────────────────────────────────────────────────────────────────────────
insert into auth.users (id, raw_user_meta_data)
select ('00000000-0000-4000-8000-000000176a0' || i)::uuid, '{"full_name":"Prueba P176"}'::jsonb from generate_series(1, 7) i
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000176a01', 'Prueba Owner', 'owner', true),
  ('00000000-0000-4000-8000-000000176a02', 'Prueba Contador', 'contador', true),
  ('00000000-0000-4000-8000-000000176a03', 'Prueba Manager A', 'manager', true),
  ('00000000-0000-4000-8000-000000176a04', 'Prueba Manager B', 'manager', true),
  ('00000000-0000-4000-8000-000000176a05', 'Prueba Manager AB', 'manager', true),
  ('00000000-0000-4000-8000-000000176a06', 'Prueba Manager Sin Local', 'manager', true),
  ('00000000-0000-4000-8000-000000176a07', 'Prueba Cajero', 'cajero', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
insert into public.locations (id, name) values ('p176-a', 'Local P176 A'), ('p176-b', 'Local P176 B') on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values ('p176-a', 'Local P176 A', true), ('p176-b', 'Local P176 B', true);
insert into public.profile_locations (profile_id, location_id, principal) values
  ('00000000-0000-4000-8000-000000176a03', 'p176-a', true),
  ('00000000-0000-4000-8000-000000176a04', 'p176-b', true),
  ('00000000-0000-4000-8000-000000176a05', 'p176-a', true),
  ('00000000-0000-4000-8000-000000176a05', 'p176-b', false),
  ('00000000-0000-4000-8000-000000176a07', 'p176-a', true);

do $$
declare
  l  text;
  s  text;   -- 1 = A, 2 = B
  u  text := '00000000-0000-4000-8000-000000176';
begin
  foreach l in array array['a', 'b'] loop
    s := case l when 'a' then '1' else '2' end;
    insert into public.club_negocios (id, location_id, nombre, tipo) values ((u || 'c0' || s)::uuid, 'p176-' || l, 'Negocio Prueba ' || l, 'hotel');
    insert into public.club_miembros (id, location_id, tipo, nombre, negocio_id, codigo) values
      ((u || 'b0' || s)::uuid, 'p176-' || l, 'referente', 'Prueba Zeta ' || upper(l), (u || 'c0' || s)::uuid, 'ZTZTZT7' || upper(l));
    insert into public.club_miembros (id, location_id, tipo, nombre, codigo_socio) values
      ((u || 'b1' || s)::uuid, 'p176-' || l, 'socio', 'Prueba Socio Zeta ' || upper(l), 'SZCZZ76' || upper(l) || upper(l));
    insert into public.club_miembros_contacto (miembro_id, location_id, telefono)
      values ((u || 'b0' || s)::uuid, 'p176-' || l, '+5060000176' || s) on conflict do nothing;
    update public.club_miembro_roles set estado = 'activo', provisional_hasta = now() + interval '1 day',
           registrado_por = (u || 'a01')::uuid
     where miembro_id = (u || 'b1' || s)::uuid and rol = 'socio';
    insert into public.club_socio_solicitudes (location_id, miembro_id) values ('p176-' || l, (u || 'b1' || s)::uuid);
    insert into public.club_cupones (id, location_id, referente_id, codigo, vence_en) values
      ((u || 'd0' || s)::uuid, 'p176-' || l, (u || 'b0' || s)::uuid, 'PQRSTUVWX' || upper(l), now() + interval '10 days');
    insert into public.club_codigos_canje (location_id, miembro_id, codigo_hash, vence_en) values
      ('p176-' || l, (u || 'b0' || s)::uuid, public.club_codigo_hash('KQKQ7' || upper(l)), now() + interval '10 minutes');
    insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc, pos_ref, registrado_por) values
      ((u || 'e0' || s)::uuid, 'p176-' || l, (u || 'b0' || s)::uuid, 'tarjeta', 3, null, 1, 1000, '{"modo":"pedido"}'::jsonb, (u || 'a01')::uuid);
    insert into public.club_visitas (location_id, miembro_id) values ('p176-' || l, (u || 'b0' || s)::uuid);
    insert into public.club_alertas (id, location_id, tipo, prioritaria) overriding system value values (-176000 - s::int, 'p176-' || l, 'autoalta_cupo', true);
    insert into public.club_cruces_manuales (movimiento_id, location_id, numero_factura) values ((u || 'e0' || s)::uuid, 'p176-' || l, '176' || s);
    insert into public.club_cruces_manuales_historial (movimiento_id, location_id, numero_factura) values ((u || 'e0' || s)::uuid, 'p176-' || l, '176' || s);
    insert into public.club_excepciones_resueltas (location_id, tipo, ref, nota) values ('p176-' || l, 'SIN_CRUCE', 'ref176' || l, 'nota de prueba');
    insert into public.club_comparacion_vieja (location_id, semana, miembro_id, personas) values ('p176-' || l, '2001-03-05', (u || 'b0' || s)::uuid, 1);
    insert into public.club_pases (miembro_id, plataforma, object_id) values ((u || 'b0' || s)::uuid, 'google', 'obj176' || l);
    insert into public.club_visitas_socio (id, location_id, miembro_id, fecha, client_op_id, estado_beneficio, aplicar) values
      ((u || 'd1' || s)::uuid, 'p176-' || l, (u || 'b1' || s)::uuid, '2001-03-01', (u || 'd9' || s)::uuid, 'sin_promocion', '{}'::jsonb);
    insert into public.club_resena_socio (miembro_id, location_id, visita_id) values ((u || 'b1' || s)::uuid, 'p176-' || l, (u || 'd1' || s)::uuid);
    -- primeros 90 con el local NULO (cuenta el del miembro)
    insert into public.club_primeros90 (miembro_id, visita_ganadora, vence_en, location_id) values ((u || 'b1' || s)::uuid, (u || 'd1' || s)::uuid, now() + interval '5 days', null);
    insert into public.club_cortesias (id, location_id, codigo_producto, nombre) values ((u || 'f1' || s)::uuid, 'p176-' || l, 'C176' || l, 'Cortesia ' || l);
    insert into public.club_retos (id, nombre, nombre_en, locales, desde, hasta, meta, cortesias) values
      ((u || 'f0' || s)::uuid, 'Reto P176 ' || l, 'Challenge ' || l, array['p176-' || l], '2001-01-01', '2001-01-31', 3,
       jsonb_build_object('p176-' || l, (u || 'f1' || s)));
    insert into public.club_retos_ganados (reto_id, miembro_id, visita_ganadora, vence_en, location_id) values
      ((u || 'f0' || s)::uuid, (u || 'b1' || s)::uuid, (u || 'd1' || s)::uuid, now() + interval '5 days', 'p176-' || l);
  end loop;
  -- reto de los dos locales, con la cortesía de cada uno
  insert into public.club_retos (id, nombre, nombre_en, locales, desde, hasta, meta, cortesias) values
    ((u || 'f03')::uuid, 'Reto P176 AB', 'Challenge AB', array['p176-a', 'p176-b'], '2001-02-01', '2001-02-28', 3,
     jsonb_build_object('p176-a', u || 'f11', 'p176-b', u || 'f12'));
  -- movimiento en A de un miembro de B (el saldo de B tiene que quedar completo para su manager)
  insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, creditos, personas_por_credito, valor_credito_crc, pos_ref, registrado_por) values
    ((u || 'e03')::uuid, 'p176-a', (u || 'b02')::uuid, 'tarjeta', 2, null, 1, 1000, '{"modo":"pedido"}'::jsonb, (u || 'a01')::uuid);
end $$;

create temp table _r176 (n serial, caso text, ok boolean, detalle text) on commit drop;

-- Llama como el usuario dado y devuelve 'ok:<filas>' o 'SQLSTATE mensaje'. Lo que escribe se DESHACE siempre.
create function pg_temp.leer(p_uid text, p_sql text) returns text language plpgsql as $f$
declare v text; r text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  begin
    execute format('select coalesce(string_agg(t::text, %L order by t::text), %L) from (%s) t', ' || ', '', p_sql) into v;
    raise exception using errcode = 'P0176', message = 'deshacer';
  exception when others then
    r := case when sqlstate = 'P0176' then 'ok:' || v else sqlstate || ' ' || sqlerrm end;
  end;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.uid(p text) returns text language sql immutable as $f$
  select '00000000-0000-4000-8000-000000176a0' || case p when 'OW' then '1' when 'CO' then '2' when 'M_A' then '3'
    when 'M_B' then '4' when 'M_AB' then '5' when 'M_0' then '6' when 'CA' then '7' end
$f$;

-- Lectura directa por RLS: filas de los datos de prueba de A y de B en cada tabla, como cada usuario (rol authenticated).
create temp table _tab176 (tabla text, de_a text, de_b text) on commit drop;
insert into _tab176 values
  ('club_miembros',                  $p$id::text like '%176b_1'$p$,                         $p$id::text like '%176b_2'$p$),
  ('club_negocios',                  $p$id::text like '%176c01'$p$,                         $p$id::text like '%176c02'$p$),
  ('club_movimientos',               $p$id::text like '%176e01'$p$,                         $p$id::text like '%176e02'$p$),
  ('club_visitas',                   $p$location_id = 'p176-a'$p$,                          $p$location_id = 'p176-b'$p$),
  ('club_miembro_roles',             $p$miembro_id::text like '%176b_1'$p$,                 $p$miembro_id::text like '%176b_2'$p$),
  ('club_alertas',                   $p$id = -176001$p$,                                    $p$id = -176002$p$),
  ('club_comparacion_vieja',         $p$location_id = 'p176-a'$p$,                          $p$location_id = 'p176-b'$p$),
  ('club_cruces_manuales',           $p$location_id = 'p176-a'$p$,                          $p$location_id = 'p176-b'$p$),
  ('club_cruces_manuales_historial', $p$location_id = 'p176-a'$p$,                          $p$location_id = 'p176-b'$p$),
  ('club_cupones',                   $p$id::text like '%176d01'$p$,                         $p$id::text like '%176d02'$p$),
  ('club_excepciones_resueltas',     $p$location_id = 'p176-a'$p$,                          $p$location_id = 'p176-b'$p$),
  ('club_pases',                     $p$object_id = 'obj176a'$p$,                           $p$object_id = 'obj176b'$p$),
  ('club_primeros90',                $p$miembro_id::text like '%176b11'$p$,                 $p$miembro_id::text like '%176b12'$p$),
  ('club_resena_socio',              $p$location_id = 'p176-a'$p$,                          $p$location_id = 'p176-b'$p$),
  ('club_retos_ganados',             $p$location_id = 'p176-a'$p$,                          $p$location_id = 'p176-b'$p$),
  ('club_saldos',                    $p$miembro_id::text like '%176b_1'$p$,                 $p$miembro_id::text like '%176b_2'$p$);
create temp table _rls176 (cuando text, usuario text, tabla text, a int, b int, err text) on commit drop;
grant select on _tab176 to authenticated;
grant insert on _rls176 to authenticated;

create function pg_temp.medir_rls(p_cuando text) returns void language plpgsql as $f$
declare u text; t record; va int; vb int;
begin
  foreach u in array array['OW', 'CO', 'CA', 'M_A', 'M_B', 'M_AB', 'M_0'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(u), 'role', 'authenticated')::text, true);
    set local role authenticated;
    for t in select * from _tab176 loop
      begin
        execute format('select count(*) filter (where %s), count(*) filter (where %s) from public.%I', t.de_a, t.de_b, t.tabla) into va, vb;
        insert into _rls176 values (p_cuando, u, t.tabla, va, vb, null);
      exception when others then
        insert into _rls176 values (p_cuando, u, t.tabla, null, null, sqlstate);
      end;
    end loop;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $f$;

-- saldo de los anfitriones de prueba, como cada usuario
create function pg_temp.saldos(p_u text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p_u), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select coalesce(string_agg(s.miembro_id::text || '=' || s.personas, ',' order by s.miembro_id), '') into v
    from public.club_saldos s where s.miembro_id::text like '%176b0_';
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;
grant execute on function pg_temp.saldos(text) to authenticated;

-- ── ANTES de la 176 ────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.medir_rls('antes');
create temp table _saldos_antes on commit drop as select pg_temp.saldos('OW') as ow;
create temp table _antes176 on commit drop as
select p.proname::text as nom, md5(p.prosrc) as md5, p.provolatile as vol, pg_get_function_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as res
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = any (array[
   'club_buscar', 'club_resolver', 'club_socios_por_confirmar', 'club_socio_solicitudes_abiertas', 'club_retos_listar',
   'club_exigir_local_de']);
create temp table _pol_antes on commit drop as
select tablename::text, policyname::text, qual, with_check from pg_policies where schemaname = 'public' and tablename like 'club%';
create temp table _n_nucleo on commit drop as
select count(*) as n from pg_proc where proname like 'club\_%\_\_nucleo' and pronamespace = 'public'::regnamespace;

-- @@176@@   (aquí va el cuerpo de la 176 sin begin/commit)

select pg_temp.medir_rls('despues');

-- 0. catálogo ──────────────────────────────────────────────────────────────────────────────────────────────────────
insert into _r176 (caso, ok, detalle)
select '0a 5 envoltorios y 5 núcleos nuevos: mismo nombre, argumentos, resultado y volatilidad; el núcleo, byte a byte la original',
       count(*) = 5 and count(*) filter (where w.oid is not null and k.oid is not null) = 5
       and count(*) filter (where pg_get_function_arguments(w.oid) = a.args and pg_get_function_result(w.oid) = a.res
                               and w.provolatile = a.vol and w.prosecdef and md5(k.prosrc) = a.md5
                               and w.proconfig = array['search_path=public, pg_temp']) = 5
       and (select count(*) from pg_proc where proname like 'club\_%\_\_nucleo' and pronamespace = 'public'::regnamespace)
           = (select n from _n_nucleo) + 5,
       string_agg(a.nom, ',') filter (where w.oid is null or k.oid is null or md5(k.prosrc) <> a.md5 or w.provolatile <> a.vol)
  from _antes176 a
  left join pg_proc w on w.proname = a.nom and w.pronamespace = 'public'::regnamespace
  left join pg_proc k on k.proname = a.nom || '__nucleo' and k.pronamespace = 'public'::regnamespace
 where a.nom <> 'club_exigir_local_de';

insert into _r176 (caso, ok, detalle)
select '0c permisos: envoltorio con EXECUTE para authenticated (no anon ni public); núcleo y club_ve_ficha SIN EXECUTE para la API',
       count(*) = 5
       and bool_and(has_function_privilege('authenticated', w.oid, 'EXECUTE') and not has_function_privilege('anon', w.oid, 'EXECUTE')
                and not has_function_privilege('authenticated', k.oid, 'EXECUTE') and not has_function_privilege('anon', k.oid, 'EXECUTE')
                and not exists (select 1 from aclexplode(k.proacl) x where x.grantee = 0)
                and not exists (select 1 from aclexplode(w.proacl) x where x.grantee = 0))
       and not has_function_privilege('authenticated', 'public.club_ve_ficha(text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.club_ve_ficha(text)', 'EXECUTE'),
       string_agg(a.nom, ',') filter (where has_function_privilege('authenticated', k.oid, 'EXECUTE'))
  from _antes176 a
  join pg_proc w on w.proname = a.nom and w.pronamespace = 'public'::regnamespace
  join pg_proc k on k.proname = a.nom || '__nucleo' and k.pronamespace = 'public'::regnamespace
 where a.nom <> 'club_exigir_local_de';

-- 1. las cinco listas ─────────────────────────────────────────────────────────────────────────────────────────────
create temp table _b176 on commit drop as
select u.r,
       pg_temp.leer(pg_temp.uid(u.r), $q$select id from public.club_buscar('zeta')$q$) as env,
       pg_temp.leer(pg_temp.uid(u.r), $q$select id from public.club_buscar__nucleo('zeta')$q$) as nuc
  from (values ('OW'), ('CO'), ('CA'), ('M_A'), ('M_B'), ('M_AB'), ('M_0')) u(r);
insert into _r176 (caso, ok, detalle)
select '1a club_buscar: M_A solo el anfitrión de A, M_B solo el de B, M_AB los dos, M_0 ninguno de los dos',
       bool_and(case r
         when 'M_A'  then env like '%176b01%' and env not like '%176b02%'
         when 'M_B'  then env like '%176b02%' and env not like '%176b01%'
         when 'M_AB' then env like '%176b01%' and env like '%176b02%'
         when 'M_0'  then env like 'ok:%' and env not like '%176b01%' and env not like '%176b02%'
         else true end),
       string_agg(r || ' → ' || env, ' | ') from _b176 where r like 'M%';
insert into _r176 (caso, ok, detalle)
select '1b club_buscar: owner, contador y cajero igual que hoy (envoltorio = núcleo; owner y cajero ven A y B)',
       bool_and(env = nuc) and bool_and(r = 'CO' or (env like '%176b01%' and env like '%176b02%')),
       string_agg(r || ': ' || env || ' ≠ ' || nuc, ' | ') filter (where env <> nuc or (r <> 'CO' and env not like '%176b02%'))
  from _b176 where r in ('OW', 'CO', 'CA');

create temp table _s176 on commit drop as
select f.fn, u.r,
       pg_temp.leer(pg_temp.uid(u.r), format('select miembro_id from public.%I()', f.fn)) as env,
       pg_temp.leer(pg_temp.uid(u.r), format('select miembro_id from public.%I()', f.fn || '__nucleo')) as nuc
  from (values ('club_socios_por_confirmar'), ('club_socio_solicitudes_abiertas')) f(fn),
       (values ('OW'), ('CO'), ('CA'), ('M_A'), ('M_B'), ('M_AB'), ('M_0')) u(r);
insert into _r176 (caso, ok, detalle)
select '1c socios por confirmar y solicitudes abiertas: M_A solo el socio de A, M_B solo el de B, M_AB los dos, M_0 ninguno',
       count(*) = 8 and bool_and(case r
         when 'M_A'  then env like '%176b11%' and env not like '%176b12%'
         when 'M_B'  then env like '%176b12%' and env not like '%176b11%'
         when 'M_AB' then env like '%176b11%' and env like '%176b12%'
         when 'M_0'  then env like 'ok:%' and env not like '%176b11%' and env not like '%176b12%' end),
       string_agg(fn || ' ' || r || ' → ' || env, ' | ')
  from _s176 where r like 'M%';
insert into _r176 (caso, ok, detalle)
select '1d socios por confirmar y solicitudes: owner, contador y cajero igual que hoy (envoltorio = núcleo; owner ve A y B)',
       count(*) = 6 and bool_and(env = nuc) and bool_and(r <> 'OW' or (env like '%176b11%' and env like '%176b12%')),
       string_agg(fn || ' ' || r || ': ' || env || ' ≠ ' || nuc, ' | ') filter (where env <> nuc)
  from _s176 where r in ('OW', 'CO', 'CA');

create temp table _t176 on commit drop as
select u.r,
       pg_temp.leer(pg_temp.uid(u.r), $q$select e->>'id' as id, e->'cortesias' as c from jsonb_array_elements(public.club_retos_listar()->'retos') e where e->>'nombre' like 'Reto P176%'$q$) as env,
       pg_temp.leer(pg_temp.uid(u.r), $q$select e->>'id' as id, e->'cortesias' as c from jsonb_array_elements(public.club_retos_listar__nucleo()->'retos') e where e->>'nombre' like 'Reto P176%'$q$) as nuc,
       pg_temp.leer(pg_temp.uid(u.r), $q$select public.club_retos_listar() = public.club_retos_listar__nucleo() as igual$q$) as igual
  from (values ('OW'), ('CO'), ('CA'), ('M_A'), ('M_B'), ('M_0')) u(r);
insert into _r176 (caso, ok, detalle)
select '1e retos: M_A los de A y el de A+B (con la cortesía de A solamente), no el de B; M_B al revés; M_0 ninguno',
       bool_and(case r
         when 'M_A' then env like '%176f01%' and env like '%176f03%' and env not like '%176f02%'
                         and env like '%176f11%' and env not like '%176f12%'
         when 'M_B' then env like '%176f02%' and env like '%176f03%' and env not like '%176f01%'
                         and env like '%176f12%' and env not like '%176f11%'
         when 'M_0' then env = 'ok:' end),
       string_agg(r || ' → ' || env, ' | ')
  from _t176 where r like 'M%';
insert into _r176 (caso, ok, detalle)
select '1f retos: owner igual que hoy (el jsonb entero = núcleo, ve los 3); contador y cajero, el mismo error que hoy',
       bool_and(case r when 'OW' then igual = 'ok:(t)' and env like '%176f01%' and env like '%176f02%' and env like '%176f03%'
                       else env = nuc and env like '42501%' end),
       string_agg(r || ': ' || env || ' / ' || igual, ' | ')
  from _t176 where r in ('OW', 'CO', 'CA');

-- resolver: cupón (/c/, 10), QR del anfitrión (/r/, 8), código de canje (6) y QR del socio (/s/, 9) de cada local
create temp table _q176 on commit drop as
select c.que, c.loc, u.r,
       pg_temp.leer(pg_temp.uid(u.r), format('select public.club_resolver(%L)->>%L as tipo', c.cod, 'tipo')) as env,
       pg_temp.leer(pg_temp.uid(u.r), format('select public.club_resolver__nucleo(%L)->>%L as tipo', c.cod, 'tipo')) as nuc
  from (values ('cupon', 'A', 'PQRSTUVWXA'), ('cupon', 'B', 'PQRSTUVWXB'), ('referente', 'A', 'ZTZTZT7A'),
               ('referente', 'B', 'ZTZTZT7B'), ('canje', 'A', 'KQKQ7A'), ('canje', 'B', 'KQKQ7B'),
               ('socio', 'A', 'SZCZZ76AA'), ('socio', 'B', 'SZCZZ76BB')) c(que, loc, cod),
       (values ('OW'), ('CA'), ('M_A'), ('M_B'), ('M_0')) u(r);
insert into _r176 (caso, ok, detalle)
select '1g resolver: el núcleo reconoce los 8 códigos (si no, la prueba no prueba nada)',
       count(*) = 8 and bool_and(nuc = 'ok:(' || que || ')'), string_agg(que || loc || ' → ' || nuc, ' | ') filter (where nuc <> 'ok:(' || que || ')')
  from _q176 where r = 'OW';
insert into _r176 (caso, ok, detalle)
select '1h resolver: M_A con cupón, QR de anfitrión o código de canje de B → 42501 «Ficha de otro local»; M_0 con los de A y B, igual',
       count(*) = 3 + 6 and bool_and(env = '42501 Ficha de otro local'),
       string_agg(r || ' ' || que || loc || ' → ' || env, ' | ') filter (where env <> '42501 Ficha de otro local')
  from _q176 where que <> 'socio' and ((r = 'M_A' and loc = 'B') or r = 'M_0');
insert into _r176 (caso, ok, detalle)
select '1i resolver: M_A con lo de A y M_B con lo de B, igual que hoy; el QR del SOCIO de otro local sigue (Club compartido)',
       count(*) = 3 + 3 + 4 and bool_and(env = nuc and env like 'ok:%'),
       string_agg(r || ' ' || que || loc || ': ' || env || ' ≠ ' || nuc, ' | ') filter (where env <> nuc or env not like 'ok:%')
  from _q176 where (r = 'M_A' and loc = 'A' and que <> 'socio') or (r = 'M_B' and loc = 'B' and que <> 'socio')
                or (que = 'socio' and r in ('M_A', 'M_B'));
insert into _r176 (caso, ok, detalle)
select '1j resolver: owner y cajero (de A, con lo de B) igual que hoy, sin corte por local',
       count(*) = 16 and bool_and(env = nuc and env like 'ok:%'),
       string_agg(r || ' ' || que || loc || ': ' || env || ' ≠ ' || nuc, ' | ') filter (where env <> nuc or env not like 'ok:%')
  from _q176 where r in ('OW', 'CA');

-- 2. RLS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into _r176 (caso, ok, detalle)
select '2a la medición sirve: antes de la 176 todos los usuarios con lectura ven A y B (owner en las 16 tablas)',
       count(*) = 16 and bool_and(a = 1 or (tabla = 'club_miembros' and a = 2) or (tabla = 'club_miembro_roles' and a >= 2) or (tabla = 'club_saldos' and a = 2))
       and bool_and(b >= 1),
       string_agg(tabla || ' ' || coalesce(a::text, err) || '/' || coalesce(b::text, err), ' | ') filter (where coalesce(b, 0) < 1)
  from _rls176 where cuando = 'antes' and usuario = 'OW';
insert into _r176 (caso, ok, detalle)
select '2b M_A por SELECT directo: ninguna fila de B en las 16 tablas, y las de A como antes',
       count(*) = 16 and bool_and(d.b = 0 and d.a = x.a and x.b >= 1),
       string_agg(d.tabla || ' A ' || d.a || '/' || x.a || ' B ' || d.b, ' | ') filter (where d.b <> 0 or d.a <> x.a)
  from _rls176 d join _rls176 x on x.usuario = d.usuario and x.tabla = d.tabla and x.cuando = 'antes'
 where d.cuando = 'despues' and d.usuario = 'M_A' and d.err is null and x.err is null;
insert into _r176 (caso, ok, detalle)
select '2c M_B: ninguna fila de A; M_AB: A y B como antes; M_0: ni A ni B',
       count(*) = 48 and bool_and(case d.usuario
         when 'M_B'  then d.a = 0 and d.b = x.b
         when 'M_AB' then d.a = x.a and d.b = x.b
         when 'M_0'  then d.a = 0 and d.b = 0 end),
       string_agg(d.usuario || ' ' || d.tabla || ' ' || d.a || '/' || d.b, ' | ')
         filter (where not case d.usuario when 'M_B' then d.a = 0 and d.b = x.b when 'M_AB' then d.a = x.a and d.b = x.b
                                         when 'M_0' then d.a = 0 and d.b = 0 end)
  from _rls176 d join _rls176 x on x.usuario = d.usuario and x.tabla = d.tabla and x.cuando = 'antes'
 where d.cuando = 'despues' and d.usuario in ('M_B', 'M_AB', 'M_0') and d.err is null;
insert into _r176 (caso, ok, detalle)
select '2d owner, contador y cajero: exactamente lo mismo que antes en las 16 tablas (filas o el mismo error de permiso)',
       count(*) = 48 and bool_and(d.a is not distinct from x.a and d.b is not distinct from x.b and d.err is not distinct from x.err),
       string_agg(d.usuario || ' ' || d.tabla, ' | ')
         filter (where d.a is distinct from x.a or d.b is distinct from x.b or d.err is distinct from x.err)
  from _rls176 d join _rls176 x on x.usuario = d.usuario and x.tabla = d.tabla and x.cuando = 'antes'
 where d.cuando = 'despues' and d.usuario in ('OW', 'CO', 'CA');
insert into _r176 (caso, ok, detalle)
select '2e club_saldos: M_B ve el saldo COMPLETO de su anfitrión (incluye el movimiento hecho en A), igual que el owner; M_A no ve el de B',
       pg_temp.saldos('M_B') = split_part((select ow from _saldos_antes), ',', 2)
       and split_part((select ow from _saldos_antes), ',', 2) like '%176b02=5'
       and pg_temp.saldos('M_A') = split_part((select ow from _saldos_antes), ',', 1)
       and pg_temp.saldos('OW') = (select ow from _saldos_antes),
       pg_temp.saldos('M_A') || ' / ' || pg_temp.saldos('M_B') || ' / owner ' || (select ow from _saldos_antes);

-- contacto: la política ALL también frena la escritura directa del manager en otro local (WITH CHECK)
create temp table _w176 (u text, r text) on commit drop;
grant insert on _w176 to authenticated;
do $$
declare u text;
begin
  foreach u in array array['M_A', 'M_B', 'OW'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(u), 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.club_miembros_contacto (miembro_id, location_id, telefono)
        values ('00000000-0000-4000-8000-000000176b12', 'p176-b', '+50600001769');
      raise exception using errcode = 'P0176', message = 'deshacer';
    exception when others then
      reset role;
      insert into _w176 values (u, case when sqlstate = 'P0176' then 'ok' else sqlstate end);
    end;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;
insert into _r176 (caso, ok, detalle)
select '2f contacto por escritura directa: M_A en B → 42501 (RLS); M_B y owner en B → ok',
       (select r from _w176 where u = 'M_A') = '42501' and (select r from _w176 where u = 'M_B') = 'ok'
       and (select r from _w176 where u = 'OW') = 'ok',
       (select string_agg(u || '=' || r, ',') from _w176);

-- 3. el mensaje ──────────────────────────────────────────────────────────────────────────────────────────────────
insert into _r176 (caso, ok, detalle)
select '3a ficha de otro local por id → «Ficha de otro local»; local de otro por p_location → «Sin permiso en ese local» (170)',
       pg_temp.leer(pg_temp.uid('M_A'), $q$select * from public.club_miembro_contacto_ver('00000000-0000-4000-8000-000000176b02')$q$)
         = '42501 Ficha de otro local'
       and pg_temp.leer(pg_temp.uid('M_A'), $q$select public.club_reporte_equipo('2001-03-01', 'p176-b')$q$)
         = '42501 Sin permiso en ese local'
       and pg_temp.leer(pg_temp.uid('M_B'), $q$select 1 from public.club_miembro_contacto_ver('00000000-0000-4000-8000-000000176b02')$q$) = 'ok:(1)',
       pg_temp.leer(pg_temp.uid('M_A'), $q$select * from public.club_miembro_contacto_ver('00000000-0000-4000-8000-000000176b02')$q$);

-- 4. vuelta atrás (en esta misma transacción descartada) ───────────────────────────────────────────────────────────
-- @@176R@@   (aquí va el cuerpo de scripts/sql/176_rollback.sql sin begin/commit)
insert into _r176 (caso, ok, detalle)
select '4a rollback: las 5 y club_exigir_local_de vuelven con su cuerpo, volatilidad y EXECUTE para authenticated; sin club_ve_ficha; las políticas, como antes',
       to_regprocedure('public.club_ve_ficha(text)') is null
       and (select count(*) from pg_proc where proname like 'club\_%\_\_nucleo' and pronamespace = 'public'::regnamespace) = (select n from _n_nucleo)
       and (select count(*) from _antes176 a join pg_proc p on p.proname = a.nom and p.pronamespace = 'public'::regnamespace
             where md5(p.prosrc) = a.md5 and p.provolatile = a.vol and pg_get_function_arguments(p.oid) = a.args
               and (a.nom = 'club_exigir_local_de' or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
               and not has_function_privilege('anon', p.oid, 'EXECUTE')) = 6
       and not exists (select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename like 'club%'
                        except select * from _pol_antes)
       and not exists (select * from _pol_antes
                        except select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename like 'club%'),
       (select string_agg(tablename || '.' || policyname, ',') from (select tablename, policyname, qual, with_check from pg_policies
          where schemaname = 'public' and tablename like 'club%' except select * from _pol_antes) z);
select pg_temp.medir_rls('rollback');
insert into _r176 (caso, ok, detalle)
select '4b rollback: vuelve lo de antes (M_A otra vez ve B por SELECT y en club_buscar): la prueba distingue',
       (select bool_and(d.a is not distinct from x.a and d.b is not distinct from x.b) from _rls176 d
          join _rls176 x on x.usuario = d.usuario and x.tabla = d.tabla and x.cuando = 'antes' where d.cuando = 'rollback')
       and pg_temp.leer(pg_temp.uid('M_A'), $q$select id from public.club_buscar('zeta')$q$) like '%176b02%', null;

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r176;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r176 where not ok or ok is null;
  if v is not null then raise exception '176-FALLAN: %', v; end if;
  if (select count(*) from _r176) < 20 then raise exception '176-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
