-- 183_pruebas (origen club 128) · Excepciones del Club más rápidas (índice de la ventana de facturas + la regla del
-- «cambio de lista» de DESCUENTO_SIN_RESPALDO sin recorrer ddia por cada candidata). Arma datos ficticios, saca una FOTO
-- de todo lo que devuelven las excepciones ANTES, aplica la 183 dentro de la transacción, saca la foto DESPUÉS, corre el
-- rollback y saca otra: las tres tienen que ser idénticas fila por fila. Termina en ROLLBACK: no deja nada.
-- Se corre con scripts/sql/183_pruebas.py (--local, o --armar para staging). Necesita la 181 en la base y NO la 183.
--
-- MARCADORES que llena el runner: «-- @@183@@» → cuerpo de supabase/migrations/183_… sin begin/commit (con --mutar, con
-- el arreglo roto a propósito); «-- @@183R@@» → cuerpo de scripts/sql/183_rollback.sql sin begin/commit.
--
-- La foto (pg_temp.foto) cubre, para CADA local con el Club encendido (los reales de la base, si hay, y los ficticios) y
-- para «sin local» (p_location null, con los ficticios apagados un momento: con más de un local activo la API pide
-- elegir): el núcleo entero (30, 7 y 90 días, todas las columnas), solo DESCUENTO_SIN_RESPALDO, y
-- club_excepciones_abiertas con 1, 7, 30, 90 y null días, como owner, como manager (de prueba183a) y como cajero. Los
-- errores se guardan como «ERR:<sqlstate>»: un permiso que cambia, cambia la foto.
--
-- Todo ficticio: locales prueba183a y prueba183b, artículos A183 / B183, un manager y un cajero ficticios.
--   prueba183a · A183 a ₡1000 los días -20…-11 (3 por día). Día -5: 3 a 1000 y 2 a 800 (40 % ≤ 800 → 2 excepciones).
--               Día -4: 2 a 1000 y 3 a 800 (60 % → cambio de lista, ninguna). Día -3: 2 a 1000, 1 a 800 y 2 a 800,50
--               (con la tolerancia de 0,1 % las dos de 800,50 y la de 800 llegan al 60 %: ninguna). Una de las del día
--               -5 queda resuelta. Abiertas a 30 días: 2 descuentos + 5 «pendiente de configuración» − 1 resuelta = 6.
--   prueba183b · B183 a ₡2000 los días -20…-11. Día -6: 3 a 2000, 1 a 1600 (20 %, clasificado por un tipo de
--               descuento del local: sale en la lista pero NO cuenta en el Inicio) y 1 a 1500 (25 %, sin clasificar).
--               Abiertas a 30 días: 2 descuentos − 1 clasificado + 5 pendientes = 6.
begin;
create temp table _r183 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _f183 (etapa text, loc text, rango text, fila jsonb) on commit drop;              -- filas del núcleo
create temp table _a183 (etapa text, rol text, loc text, dias text, valor text) on commit drop;      -- abiertas
create temp table _t183 (etapa text, loc text, ms numeric) on commit drop;                          -- tiempos
create temp table _p183 (etapa text, fn text, md5 text, secdef boolean, cfg text, vol "char", acl text, dueno oid) on commit drop;
grant all on _r183, _f183, _a183, _t183, _p183 to anon, authenticated;
grant usage on sequence _r183_n_seq to anon, authenticated;

create temp table _c183 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8183-0000000000a1'::uuid as manager_a,
       '00000000-0000-4000-8183-0000000000c1'::uuid as cajero_id,
       (now() at time zone 'America/Costa_Rica')::date as hoy;
grant select on _c183 to anon, authenticated;

-- ── Datos ficticios ───────────────────────────────────────────────────────────────────────────────────────────────
insert into public.locations (id, name) values ('prueba183a', 'Local Ficticio A'), ('prueba183b', 'Local Ficticio B')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba183a', 'Local Ficticio A', true), ('prueba183b', 'Local Ficticio B', true);

insert into auth.users (id, raw_user_meta_data) values
  ((select manager_a from _c183), '{"full_name":"Manager Ficticio A"}'), ((select cajero_id from _c183), '{"full_name":"Cajero Ficticio"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c183), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager', is_active = true where id = (select manager_a from _c183);
update public.profiles set role = 'cajero', is_active = true where id = (select cajero_id from _c183);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values ((select manager_a from _c183), 'prueba183a', true);

-- facturas: (local, día relativo a hoy CR, n.º en el día, artículo, precio unitario)
create temp table _t183v (loc text, d int, i int, cod text, u numeric) on commit drop;
insert into _t183v
select 'prueba183a', -d, i, 'A183', 1000 from generate_series(11, 20) d, generate_series(1, 3) i
union all select 'prueba183b', -d, i, 'B183', 2000 from generate_series(11, 20) d, generate_series(1, 3) i
union all select * from (values
  ('prueba183a', -5, 1, 'A183', 1000::numeric), ('prueba183a', -5, 2, 'A183', 1000), ('prueba183a', -5, 3, 'A183', 1000),
  ('prueba183a', -5, 4, 'A183', 800), ('prueba183a', -5, 5, 'A183', 800),
  ('prueba183a', -4, 1, 'A183', 1000), ('prueba183a', -4, 2, 'A183', 1000),
  ('prueba183a', -4, 3, 'A183', 800), ('prueba183a', -4, 4, 'A183', 800), ('prueba183a', -4, 5, 'A183', 800),
  ('prueba183a', -3, 1, 'A183', 1000), ('prueba183a', -3, 2, 'A183', 1000), ('prueba183a', -3, 3, 'A183', 800),
  ('prueba183a', -3, 4, 'A183', 800.50), ('prueba183a', -3, 5, 'A183', 800.50),
  ('prueba183b', -6, 1, 'B183', 2000), ('prueba183b', -6, 2, 'B183', 2000), ('prueba183b', -6, 3, 'B183', 2000),
  ('prueba183b', -6, 4, 'B183', 1600), ('prueba183b', -6, 5, 'B183', 1500)) v(loc, d, i, cod, u);
alter table _t183v add column id uuid default gen_random_uuid(), add column nf text;
update _t183v set nf = '183' || (case loc when 'prueba183a' then '1' else '2' end) || lpad((-d)::text, 2, '0') || i;

insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, fecha_cierra, estado, canal, registrado_por,
                                    con_servicio, pax, pax_alerta, total_crc)
select v.id, v.loc, v.nf, f, f, 'C', 'salon', 'salonero', true, 1, 'ok', v.u
  from _t183v v cross join lateral (select (((select hoy from _c183) + v.d) + time '20:00') at time zone 'America/Costa_Rica' as f) x;
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto, familia, es_cortesia)
select v.id, v.cod, 'Plato ficticio', 1, v.u, v.u, 2, false from _t183v v;

-- una de las del día -5 de prueba183a, resuelta; en prueba183b, el 20 % es un tipo de descuento conocido
insert into public.club_excepciones_resueltas (location_id, tipo, ref, nota, resuelto_por)
select 'prueba183a', 'DESCUENTO_SIN_RESPALDO', 'desc:' || ltrim(nf, '0'), 'Resuelta en la prueba', (select owner_id from _c183)
  from _t183v where loc = 'prueba183a' and d = -5 and i = 4;
insert into public.club_descuentos_tipo (location_id, nombre, pct) values ('prueba183b', 'Descuento ficticio 20', 20);

-- ── La foto ──────────────────────────────────────────────────────────────────────────────────────────────────────
create function pg_temp.como(p_id uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', case when p_id is null then '' else
         json_build_object('sub', p_id, 'role', 'authenticated')::text end, true) $f$;

create function pg_temp.abiertas(p_dias int, p_loc text) returns text language plpgsql as $f$
begin
  return public.club_excepciones_abiertas(p_dias, p_loc)::text;
exception when others then return 'ERR:' || sqlstate;
end $f$;

-- DESCUENTO_SIN_RESPALDO muestra UNA línea por factura: distinct on (factura) order by factura, precio/referencia. Si
-- varias líneas empatan en ese cociente (un mismo % a toda la factura), cuál sale es arbitrario y depende del plan: HOY
-- ya cambia con solo crear el índice, sin tocar el núcleo (staging, 16-nov). Empatan en el cociente, así que el %, la
-- clasificación, la excepción y el conteo son los mismos; lo que puede cambiar es el ejemplo (artículo, nombre, precio,
-- referencia y el monto de esa línea). La comparación saca SOLO esos cinco campos y SOLO de ese tipo.
create function pg_temp.norm(f jsonb) returns jsonb language sql immutable as $f$
  select case when f->>'tipo' = 'DESCUENTO_SIN_RESPALDO'
              then jsonb_set(f, '{detalle}', (f->'detalle') - 'articulo' - 'nombre' - 'precio' - 'referencia' - 'descuento_crc')
              else f end $f$;

create function pg_temp.foto(p_etapa text) returns void language plpgsql as $f$
declare
  v_c  _c183%rowtype;
  v_l  text;
  v_r  record;
  v_t0 timestamptz;
  v_n  int;
begin
  select * into v_c from _c183;
  -- funciones: md5, SECURITY DEFINER, search_path, volatilidad, permisos y dueño
  insert into _p183
  select p_etapa, p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), p.prosecdef, array_to_string(p.proconfig, ';'),
         p.provolatile, p.proacl::text, p.proowner
    from pg_proc p
   where p.oid in ('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure,
                   'public.club_excepciones(date,date,text,text)'::regprocedure,
                   'public.club_excepciones_abiertas(integer,text)'::regprocedure);
  -- «sin local»: con los ficticios apagados (con más de un local activo la API pide elegir)
  update public.club_config set club_activo = false where location_id like 'prueba183%';
  perform pg_temp.como(v_c.owner_id);
  insert into _a183 select p_etapa, 'owner', '(null)', coalesce(d::text, 'null'), pg_temp.abiertas(d, null)
    from unnest(array[1, 7, 30, 90, null]) d;
  begin
    insert into _f183 select p_etapa, '(null)', '30', to_jsonb(e)
      from public.club_excepciones(v_c.hoy - 30, v_c.hoy, null) e;
  exception when others then
    insert into _f183 values (p_etapa, '(null)', '30', jsonb_build_object('error', sqlstate));
  end;
  update public.club_config set club_activo = true where location_id like 'prueba183%';
  -- cada local con el Club encendido
  for v_l in select c.location_id from public.club_config c where c.club_activo order by 1 loop
    perform pg_temp.como(v_c.owner_id);
    for v_r in select * from (values (30), (7), (90)) x(d) loop
      insert into _f183 select p_etapa, v_l, v_r.d::text, to_jsonb(e)
        from public.club_excepciones(v_c.hoy - v_r.d, v_c.hoy, v_l) e;
    end loop;
    insert into _f183 select p_etapa, v_l, '30·DESCUENTO_SIN_RESPALDO', to_jsonb(e)
      from public.club_excepciones(v_c.hoy - 30, v_c.hoy, v_l, 'DESCUENTO_SIN_RESPALDO') e;
    insert into _a183 select p_etapa, 'owner', v_l, coalesce(d::text, 'null'), pg_temp.abiertas(d, v_l)
      from unnest(array[1, 7, 30, 90, null]) d;
    -- tiempo: la mejor de 3 llamadas a 30 días (como el Inicio)
    for v_n in 1..3 loop
      v_t0 := clock_timestamp();
      perform public.club_excepciones_abiertas(30, v_l);
      insert into _t183 values (p_etapa, v_l, round(extract(epoch from clock_timestamp() - v_t0) * 1000, 1));
    end loop;
    perform pg_temp.como(v_c.manager_a);
    insert into _a183 values (p_etapa, 'manager_a', v_l, '30', pg_temp.abiertas(30, v_l));
    perform pg_temp.como(v_c.cajero_id);
    insert into _a183 values (p_etapa, 'cajero', v_l, '30', pg_temp.abiertas(30, v_l));
  end loop;
  perform pg_temp.como(null);
end $f$;

-- ── ANTES ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.foto('antes');
-- como `authenticated` de verdad (los EXECUTE reales), con el owner
select pg_temp.como((select owner_id from _c183));
set local role authenticated;
insert into _a183 values ('antes', 'owner_authenticated', 'prueba183a', '30', public.club_excepciones_abiertas(30, 'prueba183a')::text);
reset role;
select pg_temp.como(null);

-- 00. el escenario ficticio pasa por la regla que cambia (si no, la comparación no prueba nada)
insert into _r183 (caso, ok, detalle)
select '00 escenario: prueba183a 2 descuentos (día -5) y abiertas 6; prueba183b 2 descuentos y abiertas 6 (uno clasificado)',
       (select count(*) from _f183 where etapa = 'antes' and loc = 'prueba183a' and rango = '30' and fila->>'tipo' = 'DESCUENTO_SIN_RESPALDO') = 2
       and (select count(*) from _f183 where etapa = 'antes' and loc = 'prueba183b' and rango = '30' and fila->>'tipo' = 'DESCUENTO_SIN_RESPALDO') = 2
       and (select valor from _a183 where etapa = 'antes' and rol = 'owner' and loc = 'prueba183a' and dias = '30') = '6'
       and (select valor from _a183 where etapa = 'antes' and rol = 'owner' and loc = 'prueba183b' and dias = '30') = '6',
       (select string_agg(loc || ':' || valor, ' ') from _a183 where etapa = 'antes' and rol = 'owner' and dias = '30');

-- ── La 183 ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- @@183@@   (aquí va el cuerpo de supabase/migrations/183_… sin begin/commit)

select pg_temp.foto('despues');
select pg_temp.como((select owner_id from _c183));
set local role authenticated;
insert into _a183 values ('despues', 'owner_authenticated', 'prueba183a', '30', public.club_excepciones_abiertas(30, 'prueba183a')::text);
reset role;
select pg_temp.como(null);

-- 01. funciones: el núcleo con el md5 de la 183; envoltorio y contador sin tocar; mismos permisos, dueño y atributos
insert into _r183 (caso, ok, detalle)
select '01 núcleo md5 bd1b4d15…; envoltorio y abiertas idénticos; SECURITY DEFINER, search_path, volatilidad, ACL y dueño iguales',
       (select md5 from _p183 where etapa = 'despues' and fn like 'club_excepciones__nucleo%') = 'bd1b4d15e6ec6453d540c59b61d80d76'
       and (select md5 from _p183 where etapa = 'antes' and fn like 'club_excepciones__nucleo%') = '94cf0df9d0b189322b27d4d8b208a3e0'
       and not exists (select fn, secdef, cfg, vol, acl, dueno from _p183 where etapa = 'antes'
                       except select fn, secdef, cfg, vol, acl, dueno from _p183 where etapa = 'despues')
       and not exists (select fn, md5 from _p183 where etapa = 'antes' and fn not like 'club_excepciones__nucleo%'
                       except select fn, md5 from _p183 where etapa = 'despues'),
       (select string_agg(fn || '=' || left(md5, 8), ' ') from _p183 where etapa = 'despues');

-- 02. el núcleo devuelve EXACTAMENTE las mismas filas (multiconjunto, todas las columnas) en cada local y rango
insert into _r183 (caso, ok, detalle)
select '02 núcleo idéntico fila por fila, todas las columnas (salvo la línea ejemplo de un empate en DESCUENTO; ver pg_temp.norm)',
       not exists (select loc, rango, pg_temp.norm(fila) from _f183 where etapa = 'antes'
                   except all select loc, rango, pg_temp.norm(fila) from _f183 where etapa = 'despues')
       and not exists (select loc, rango, pg_temp.norm(fila) from _f183 where etapa = 'despues'
                       except all select loc, rango, pg_temp.norm(fila) from _f183 where etapa = 'antes')
       and (select count(*) from _f183 where etapa = 'antes') > 0,
       (select string_agg(loc || '/' || rango || ':' || n, ' ' order by loc, rango)
          from (select loc, rango, count(*) n from _f183 where etapa = 'despues' group by 1, 2) z);

-- 03. el contador del Inicio da lo mismo para cada rol, local y cantidad de días (errores incluidos)
insert into _r183 (caso, ok, detalle)
select '03 club_excepciones_abiertas idéntico (owner, manager, cajero; 1/7/30/90/null días; sin local)',
       not exists (select rol, loc, dias, valor from _a183 where etapa = 'antes' except all select rol, loc, dias, valor from _a183 where etapa = 'despues')
       and not exists (select rol, loc, dias, valor from _a183 where etapa = 'despues' except all select rol, loc, dias, valor from _a183 where etapa = 'antes'),
       (select string_agg(rol || '@' || loc || '/' || dias || '=' || valor, ' ' order by rol, loc, dias) from _a183
         where etapa = 'despues' and (dias = '30' or rol <> 'owner'));

-- 04. permisos: el cajero y el manager fuera de su local siguen afuera (42501); anon no ejecuta; authenticated sí
insert into _r183 (caso, ok, detalle)
select '04 permisos: cajero 42501, manager de A en B 42501, anon sin EXECUTE, el núcleo cerrado a authenticated',
       (select valor from _a183 where etapa = 'despues' and rol = 'cajero' and loc = 'prueba183a') = 'ERR:42501'
       and (select valor from _a183 where etapa = 'despues' and rol = 'manager_a' and loc = 'prueba183b') = 'ERR:42501'
       and (select valor from _a183 where etapa = 'despues' and rol = 'manager_a' and loc = 'prueba183a') = '6'
       and (select valor from _a183 where etapa = 'despues' and rol = 'owner_authenticated') = '6'
       and not has_function_privilege('anon', 'public.club_excepciones_abiertas(integer,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.club_excepciones__nucleo(date,date,text,text)', 'execute')
       and has_function_privilege('authenticated', 'public.club_excepciones_abiertas(integer,text)', 'execute'),
       (select string_agg(rol || '@' || loc || '=' || valor, ' ' order by rol, loc) from _a183
         where etapa = 'despues' and rol in ('cajero', 'manager_a', 'owner_authenticated'));

-- 05. el índice existe y sirve para el filtro de tk (la misma expresión). Con estadísticas al día (analyze dentro de la
--     transacción descartada) y sin seq scan, el planificador tiene que elegirlo: la condición sobre coalesce(…) solo la
--     puede resolver este índice.
analyze public.pos_ndf_tickets;
create function pg_temp.plan_tk() returns text language plpgsql as $f$
declare v text := ''; l text;
begin
  perform set_config('enable_seqscan', 'off', true);
  for l in execute $q$explain (format text) select 1 from public.pos_ndf_tickets t
           where t.local = 'prueba183a' and coalesce(t.fecha_registra, t.fecha_cierra) >= now() - interval '4 days'
             and coalesce(t.fecha_registra, t.fecha_cierra) < now() - interval '3 days'$q$ loop
    v := v || ' | ' || btrim(l);
  end loop;
  perform set_config('enable_seqscan', 'on', true);
  return v;
end $f$;
insert into _r183 (caso, ok, detalle)
select '05 índice pos_ndf_tickets_local_fecha_efectiva_idx sobre (local, coalesce(fecha_registra, fecha_cierra)) y el plan lo usa',
       exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'pos_ndf_tickets_local_fecha_efectiva_idx'
                and indexdef like '%(local, COALESCE(fecha_registra, fecha_cierra))%')
       and pg_temp.plan_tk() like '%pos_ndf_tickets_local_fecha_efectiva_idx%',
       pg_temp.plan_tk();

-- 06. tiempo: después no es peor que antes en ningún local (la mejor de 3; margen de 10 % + 20 ms por el ruido).
--     En staging (volumen real) el detalle muestra la mejora; en la base local los datos son chicos.
insert into _r183 (caso, ok, detalle)
select '06 tiempo de club_excepciones_abiertas(30): después ≤ antes (mejor de 3 por local)',
       bool_and(d.ms <= a.ms * 1.10 + 20),
       string_agg(a.loc || ': ' || a.ms || ' ms → ' || d.ms || ' ms', ' · ' order by a.loc)
  from (select loc, min(ms) ms from _t183 where etapa = 'antes' group by loc) a
  join (select loc, min(ms) ms from _t183 where etapa = 'despues' group by loc) d using (loc);

-- 07. vuelta atrás (en esta misma transacción descartada): núcleo de la 181, sin índice, y la misma foto
-- @@183R@@   (aquí va el cuerpo de scripts/sql/183_rollback.sql sin begin/commit)
select pg_temp.foto('rollback');
insert into _r183 (caso, ok, detalle)
select '07 rollback: núcleo md5 94cf0df9 (181), sin el índice, mismas filas y mismos conteos que antes',
       (select md5 from _p183 where etapa = 'rollback' and fn like 'club_excepciones__nucleo%') = '94cf0df9d0b189322b27d4d8b208a3e0'
       and to_regclass('public.pos_ndf_tickets_local_fecha_efectiva_idx') is null
       and not exists (select fn, md5, secdef, cfg, vol, acl, dueno from _p183 where etapa = 'antes'
                       except select fn, md5, secdef, cfg, vol, acl, dueno from _p183 where etapa = 'rollback')
       and not exists (select loc, rango, pg_temp.norm(fila) from _f183 where etapa = 'antes'
                       except all select loc, rango, pg_temp.norm(fila) from _f183 where etapa = 'rollback')
       and not exists (select loc, rango, pg_temp.norm(fila) from _f183 where etapa = 'rollback'
                       except all select loc, rango, pg_temp.norm(fila) from _f183 where etapa = 'antes')
       and not exists (select rol, loc, dias, valor from _a183 where etapa = 'antes' and rol <> 'owner_authenticated'
                       except all select rol, loc, dias, valor from _a183 where etapa = 'rollback'),
       (select string_agg(fn || '=' || left(md5, 8), ' ') from _p183 where etapa = 'rollback');

-- Resultado
select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r183;

-- ASSERT: cada caso que falla sale como WARNING («183 FALLA <caso> — <detalle>»), después el resumen
-- («183 RESUMEN: pasaron X / fallaron Y de 8») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «183-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 8;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _r183 where ok is not true order by n loop   -- null = falla
    raise warning '183 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r183;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '183 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice '183 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception '183-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
