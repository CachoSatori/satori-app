-- 184_pruebas (origen club 129) · El reporte de descuentos del Club suma TODAS las líneas con descuento sin respaldo de
-- cada factura, cada una con su clasificación (firma del dueño 17-nov 02:13, opción A). Arma datos ficticios, saca una
-- FOTO ANTES (con la 183), aplica la 184 dentro de la transacción, saca la foto DESPUÉS, corre el rollback y saca otra.
-- Termina en ROLLBACK: no deja nada. Se corre con scripts/sql/184_pruebas.py (--local). Necesita la 183 y NO la 184.
--
-- MARCADORES que llena el runner: «-- @@184@@» → cuerpo de supabase/migrations/184_… sin begin/commit (con --mutar, con
-- el arreglo roto a propósito); «-- @@184R@@» → cuerpo de scripts/sql/184_rollback.sql sin begin/commit.
--
-- Todo ficticio, con fechas FIJAS (octubre 2026, hora de Costa Rica). Locales prueba184a y prueba184b. Precios habituales:
-- A184 ₡1000, B184 ₡2000, C184 ₡500, D184 ₡3000 (3 facturas por día del 6 al 25-oct, 6 el 26-oct y 3 el 31-oct, en los
-- dos locales). Tipos de descuento de prueba184a: «Ficticio 10» (10 %) y «Ficticio 20» (20 %). prueba184b: ninguno.
--   F1 26-oct 12:00 (mañana) · 1 línea: A 900 (10 %)                                 → Ficticio 10 ₡100
--   F2 26-oct 20:00 · varias líneas, mismo %: A 800, B 1600, C 400 (20 %)            → Ficticio 20 ₡700 (ejemplo B ₡400)
--   F3 26-oct 20:00 · distintos %: A 900 (10 %), B 1600 (20 %)                       → F10 ₡100 + F20 ₡400 (ejemplo B)
--   F4 26-oct 20:00 · mezcla: A 900 (10 %), D 2100 ×2 (30 %, sin tipo)               → F10 ₡100 + sin clasificar ₡1800
--   F5 26-oct 20:00 · ANULADA (X): A 500                                             → no cuenta
--   F6 31-oct 23:30 CR (= 1-nov 05:30 UTC) · A 900 (10 %)                            → octubre, tarde, F10 ₡100
--   G1 prueba184b 26-oct 20:00 · A 800 (20 %)                                        → (b) sin clasificar ₡200
-- Reporte de prueba184a, 1 al 31-oct (después):
--   2026-10 · sin clasificar · tarde · 1 factura  · ₡1800
--   2026-10 · Ficticio 10    · mañana· 1 factura  · ₡100
--   2026-10 · Ficticio 10    · tarde · 3 facturas · ₡300
--   2026-10 · Ficticio 20    · tarde · 2 facturas · ₡1100            Total ₡3300 (antes, solo la ejemplo: ₡2800)
begin;
set local timezone = 'UTC';   -- como Supabase: un mes calculado sin la hora de CR se ve acá
create temp table _r184 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _f184 (etapa text, loc text, fila jsonb) on commit drop;    -- excepciones (todas, 1 al 31-oct)
create temp table _d184 (etapa text, loc text, fila jsonb) on commit drop;    -- reporte de descuentos
create temp table _a184 (etapa text, loc text, valor text) on commit drop;    -- contador del Inicio / permisos
create temp table _p184 (etapa text, fn text, md5 text, secdef boolean, cfg text, vol "char", acl text, dueno oid) on commit drop;

create temp table _c184 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8184-0000000000c1'::uuid as cajero_id,
       '00000000-0000-4000-8184-0000000000a1'::uuid as manager_a,
       date '2026-10-01' as desde, date '2026-10-31' as hasta;

-- ── Datos ficticios ───────────────────────────────────────────────────────────────────────────────────────────────
insert into public.locations (id, name) values ('prueba184a', 'Local Ficticio A'), ('prueba184b', 'Local Ficticio B')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba184a', 'Local Ficticio A', true), ('prueba184b', 'Local Ficticio B', true);
insert into public.club_descuentos_tipo (location_id, nombre, pct) values
  ('prueba184a', 'Ficticio 10', 10), ('prueba184a', 'Ficticio 20', 20);

insert into auth.users (id, raw_user_meta_data) values
  ((select cajero_id from _c184), '{"full_name":"Cajero Ficticio"}'), ((select manager_a from _c184), '{"full_name":"Manager Ficticio"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c184), 'role', 'authenticated')::text, true);
update public.profiles set role = 'cajero', is_active = true where id = (select cajero_id from _c184);
update public.profiles set role = 'manager', is_active = true where id = (select manager_a from _c184);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values ((select manager_a from _c184), 'prueba184a', true);

-- facturas: (clave, local, fecha y hora CR, estado)
create temp table _t184 (k text, loc text, f timestamp, est text, id uuid default gen_random_uuid(), nf text) on commit drop;
-- normales (los 4 artículos a precio habitual)
insert into _t184 (k, loc, f, est)
select 'N', l, d + time '20:00', 'C'
  from unnest(array['prueba184a', 'prueba184b']) l,
       (select g::date d, i from generate_series(date '2026-10-06', date '2026-10-25', interval '1 day') g, generate_series(1, 3) i
        union all select date '2026-10-26', i from generate_series(1, 6) i
        union all select date '2026-10-31', i from generate_series(1, 3) i) z;
insert into _t184 (k, loc, f, est) values
  ('F1', 'prueba184a', timestamp '2026-10-26 12:00', 'C'), ('F2', 'prueba184a', timestamp '2026-10-26 20:00', 'C'),
  ('F3', 'prueba184a', timestamp '2026-10-26 20:00', 'C'), ('F4', 'prueba184a', timestamp '2026-10-26 20:00', 'C'),
  ('F5', 'prueba184a', timestamp '2026-10-26 20:00', 'X'), ('F6', 'prueba184a', timestamp '2026-10-31 23:30', 'C'),
  ('G1', 'prueba184b', timestamp '2026-10-26 20:00', 'C');
update _t184 set nf = '184' || lpad((row_number)::text, 5, '0')
  from (select id as i2, row_number() over (order by loc, f, k) from _t184) z where z.i2 = _t184.id;
-- líneas: (clave, artículo, precio unitario, cantidad)
create temp table _l184 (k text, cod text, u numeric, q numeric) on commit drop;
insert into _l184 values
  ('N', 'A184', 1000, 1), ('N', 'B184', 2000, 1), ('N', 'C184', 500, 1), ('N', 'D184', 3000, 1),
  ('F1', 'A184', 900, 1),
  ('F2', 'A184', 800, 1), ('F2', 'B184', 1600, 1), ('F2', 'C184', 400, 1),
  ('F3', 'A184', 900, 1), ('F3', 'B184', 1600, 1),
  ('F4', 'A184', 900, 1), ('F4', 'D184', 2100, 2),
  ('F5', 'A184', 500, 1),
  ('F6', 'A184', 900, 1),
  ('G1', 'A184', 800, 1);

insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, fecha_cierra, estado, canal, registrado_por,
                                    con_servicio, pax, pax_alerta, total_crc)
select t.id, t.loc, t.nf, t.f at time zone 'America/Costa_Rica', t.f at time zone 'America/Costa_Rica', t.est, 'salon',
       'salonero', true, 1, 'ok', (select sum(l.u * l.q) from _l184 l where l.k = t.k)
  from _t184 t;
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto, familia, es_cortesia)
select t.id, l.cod, 'Plato ficticio', l.q, l.u, l.u * l.q, 2, false from _t184 t join _l184 l on l.k = t.k;

-- ── La foto ──────────────────────────────────────────────────────────────────────────────────────────────────────
create function pg_temp.como(p_id uuid) returns void language sql as $f$
  select set_config('request.jwt.claims', case when p_id is null then '' else
         json_build_object('sub', p_id, 'role', 'authenticated')::text end, true) $f$;
create function pg_temp.rep(p_loc text) returns text language plpgsql as $f$
begin
  return (select coalesce(sum(r.facturas), 0) || ' fact. / ' || coalesce(sum(r.descuento_crc), 0)
            from public.club_reporte_descuentos((select desde from _c184), (select hasta from _c184), p_loc) r);
exception when others then return 'ERR:' || sqlstate;
end $f$;
-- la lista de Excepciones, sin las dos claves nuevas: tiene que quedar igual
create function pg_temp.sin_nuevas(f jsonb) returns jsonb language sql immutable as $f$
  select jsonb_set(f, '{detalle}', (f->'detalle') - 'lineas_sin_respaldo' - 'descuento_crc_lineas') $f$;

create function pg_temp.foto(p_etapa text) returns void language plpgsql as $f$
declare v_c _c184%rowtype; v_l text;
begin
  select * into v_c from _c184;
  insert into _p184
  select p_etapa, p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), p.prosecdef, array_to_string(p.proconfig, ';'),
         p.provolatile, p.proacl::text, p.proowner
    from pg_proc p
   where p.oid in ('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure,
                   'public.club_excepciones(date,date,text,text)'::regprocedure,
                   'public.club_excepciones_abiertas(integer,text)'::regprocedure,
                   'public.club_reporte_descuentos(date,date,text)'::regprocedure,
                   'public.club_reporte_descuentos__nucleo(date,date,text)'::regprocedure);
  for v_l in select unnest(array['prueba184a', 'prueba184b']) loop
    perform pg_temp.como(v_c.owner_id);
    insert into _f184 select p_etapa, v_l, to_jsonb(e) from public.club_excepciones(v_c.desde, v_c.hasta, v_l) e;
    insert into _d184 select p_etapa, v_l, to_jsonb(r) from public.club_reporte_descuentos(v_c.desde, v_c.hasta, v_l) r;
    insert into _a184 values (p_etapa, v_l, 'abiertas=' || public.club_excepciones_abiertas(null, v_l)::text);
    perform pg_temp.como(v_c.cajero_id);
    insert into _a184 values (p_etapa, v_l, 'cajero=' || pg_temp.rep(v_l));
    perform pg_temp.como(v_c.manager_a);
    insert into _a184 values (p_etapa, v_l, 'manager_a=' || pg_temp.rep(v_l));
  end loop;
  perform pg_temp.como(null);
end $f$;

-- ── ANTES ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.foto('antes');

-- 00. el escenario pasa por lo que cambia: antes el reporte de prueba184a suma solo la ejemplo (₡2800 en 5 facturas)
insert into _r184 (caso, ok, detalle)
select '00 escenario: antes 5 facturas con la excepción en prueba184a y el reporte (solo ejemplo) suma ₡2800',
       (select count(*) from _f184 where etapa = 'antes' and loc = 'prueba184a' and fila->>'tipo' = 'DESCUENTO_SIN_RESPALDO') = 5
       and (select sum((fila->>'descuento_crc')::numeric) from _d184 where etapa = 'antes' and loc = 'prueba184a') = 2800,
       (select string_agg(fila->>'tipo' || ' ' || (fila->>'facturas') || ' ' || (fila->>'descuento_crc'), ' · ')
          from _d184 where etapa = 'antes' and loc = 'prueba184a');

-- ── La 184 ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- @@184@@   (aquí va el cuerpo de supabase/migrations/184_… sin begin/commit)

select pg_temp.foto('despues');

-- 01. funciones: md5 nuevos; envoltorios y contador sin tocar; mismos permisos, dueño y atributos
insert into _r184 (caso, ok, detalle)
select '01 núcleos con md5 de la 184; envoltorios y abiertas idénticos; SECURITY DEFINER, search_path, volatilidad, ACL y dueño iguales',
       (select md5 from _p184 where etapa = 'despues' and fn like 'club_excepciones__nucleo%') = '0b7b956e5670f617ace9ff9e6637f222'
       and (select md5 from _p184 where etapa = 'despues' and fn like 'club_reporte_descuentos__nucleo%') = '7a5e33e2565a1dc493965c007fa76058'
       and not exists (select fn, secdef, cfg, vol, acl, dueno from _p184 where etapa = 'antes'
                       except select fn, secdef, cfg, vol, acl, dueno from _p184 where etapa = 'despues')
       and not exists (select fn, md5 from _p184 where etapa = 'antes' and fn not like '%\_\_nucleo%'
                       except select fn, md5 from _p184 where etapa = 'despues'),
       (select string_agg(fn || '=' || left(md5, 8), ' ') from _p184 where etapa = 'despues');

-- 02. la lista de Excepciones no cambia (todas las verificaciones, fila por fila, sin las 2 claves nuevas) ni el contador
insert into _r184 (caso, ok, detalle)
select '02 Excepciones: mismas filas (línea ejemplo incluida) y mismo contador; solo se agregan lineas_sin_respaldo y descuento_crc_lineas',
       not exists (select loc, fila from _f184 where etapa = 'antes'
                   except all select loc, pg_temp.sin_nuevas(fila) from _f184 where etapa = 'despues')
       and not exists (select loc, pg_temp.sin_nuevas(fila) from _f184 where etapa = 'despues'
                       except all select loc, fila from _f184 where etapa = 'antes')
       and not exists (select loc, valor from _a184 where etapa = 'antes' and valor like 'abiertas=%'
                       except select loc, valor from _a184 where etapa = 'despues')
       and (select bool_and(fila->'detalle' ? 'lineas_sin_respaldo') from _f184
             where etapa = 'despues' and fila->>'tipo' = 'DESCUENTO_SIN_RESPALDO'),
       (select string_agg(loc || ':' || n, ' ') from (select loc, count(*) n from _f184 where etapa = 'despues' group by loc) z);

-- 03. factura con 1 línea (F1): una línea, ₡100, Ficticio 10; total = ejemplo
create function pg_temp.exc(p_k text) returns jsonb language sql as $f$
  select f.fila->'detalle' from _f184 f join _t184 t on t.nf = f.fila->>'factura' and t.loc = f.loc
   where f.etapa = 'despues' and t.k = p_k and f.fila->>'tipo' = 'DESCUENTO_SIN_RESPALDO' $f$;
insert into _r184 (caso, ok, detalle)
select '03 F1 (1 línea): 1 línea ₡100 Ficticio 10; descuento_crc_lineas = descuento_crc',
       jsonb_array_length(pg_temp.exc('F1')->'lineas_sin_respaldo') = 1
       and (pg_temp.exc('F1')->>'descuento_crc_lineas')::numeric = 100
       and (pg_temp.exc('F1')->>'descuento_crc')::numeric = 100
       and pg_temp.exc('F1')->'lineas_sin_respaldo'->0->>'clasificacion' = 'Ficticio 10',
       pg_temp.exc('F1')::text;

-- 04. varias líneas al mismo % (F2): 3 líneas, ₡700, todas Ficticio 20; la ejemplo sigue siendo B ₡400
insert into _r184 (caso, ok, detalle)
select '04 F2 (3 líneas al 20 %): ₡700 en 3 líneas Ficticio 20; ejemplo B184 ₡400 sin cambio',
       jsonb_array_length(pg_temp.exc('F2')->'lineas_sin_respaldo') = 3
       and (pg_temp.exc('F2')->>'descuento_crc_lineas')::numeric = 700
       and (select bool_and(x->>'clasificacion' = 'Ficticio 20') from jsonb_array_elements(pg_temp.exc('F2')->'lineas_sin_respaldo') x)
       and pg_temp.exc('F2')->>'articulo' = 'B184' and (pg_temp.exc('F2')->>'descuento_crc')::numeric = 400,
       pg_temp.exc('F2')::text;

-- 05. distintos % (F3) y mezcla tipificado / sin clasificar (F4): cada línea con SU clasificación
insert into _r184 (caso, ok, detalle)
select '05 F3: F10 ₡100 + F20 ₡400; F4: F10 ₡100 + sin clasificar ₡1800 (D184 ×2); cada línea con su clasificación',
       (select jsonb_object_agg(coalesce(x->>'clasificacion', 'sc'), (x->>'descuento_crc')::numeric)
          from jsonb_array_elements(pg_temp.exc('F3')->'lineas_sin_respaldo') x) = '{"Ficticio 10": 100, "Ficticio 20": 400}'::jsonb
       and (select jsonb_object_agg(coalesce(x->>'clasificacion', 'sc'), (x->>'descuento_crc')::numeric)
              from jsonb_array_elements(pg_temp.exc('F4')->'lineas_sin_respaldo') x) = '{"Ficticio 10": 100, "sc": 1800}'::jsonb
       and pg_temp.exc('F4')->>'clasificacion' is null and (pg_temp.exc('F4')->>'descuento_crc')::numeric = 1800,
       pg_temp.exc('F3')::text || ' | ' || pg_temp.exc('F4')::text;

-- 06. el reporte de prueba184a: exactamente las 4 filas esperadas (mes y turno en hora CR; anulada afuera)
insert into _r184 (caso, ok, detalle)
select '06 reporte prueba184a: sc 1/₡1800 · F10 mañana 1/₡100 · F10 tarde 3/₡300 · F20 tarde 2/₡1100 (total ₡3300)',
       (select jsonb_agg(jsonb_build_array(fila->>'mes', fila->>'tipo', fila->>'turno', (fila->>'facturas')::int,
                                           (fila->>'descuento_crc')::numeric) order by fila->>'tipo', fila->>'turno')
          from _d184 where etapa = 'despues' and loc = 'prueba184a')
       = '[["2026-10","Ficticio 10","mañana",1,100],["2026-10","Ficticio 10","tarde",3,300],
           ["2026-10","Ficticio 20","tarde",2,1100],["2026-10","sin clasificar","tarde",1,1800]]'::jsonb,
       (select string_agg(fila::text, ' ') from _d184 where etapa = 'despues' and loc = 'prueba184a');

-- 07. orden de las filas: «sin clasificar» primero dentro del mes (como antes)
insert into _r184 (caso, ok, detalle)
select '07 orden del reporte: sin clasificar primero',
       (select fila->>'tipo' from public.club_reporte_descuentos((select desde from _c184), (select hasta from _c184), 'prueba184a') r
          cross join lateral (select to_jsonb(r) fila) z limit 1) = 'sin clasificar',
       null
  from (select pg_temp.como((select owner_id from _c184))) s;

-- 08. hora CR: F6 (31-oct 23:30 CR = 1-nov UTC) cae en 2026-10 y turno tarde; no hay filas de 2026-11; anulada X afuera
insert into _r184 (caso, ok, detalle)
select '08 hora CR y anuladas: nada en 2026-11 con sesión en UTC; F5 (X) sin excepción',
       not exists (select 1 from _d184 where etapa = 'despues' and fila->>'mes' <> '2026-10')
       and pg_temp.exc('F5') is null and pg_temp.exc('F6') is not null,
       (select string_agg(distinct fila->>'mes', ',') from _d184 where etapa = 'despues');

-- 09. multi-local: prueba184b solo ve su factura (sin clasificar ₡200, 1 factura); a no ve la de b
insert into _r184 (caso, ok, detalle)
select '09 multi-local: prueba184b = 1 fila sin clasificar 1/₡200',
       (select jsonb_agg(jsonb_build_array(fila->>'tipo', (fila->>'facturas')::int, (fila->>'descuento_crc')::numeric))
          from _d184 where etapa = 'despues' and loc = 'prueba184b') = '[["sin clasificar",1,200]]'::jsonb,
       (select string_agg(fila::text, ' ') from _d184 where etapa = 'despues' and loc = 'prueba184b');

-- 10. el reporte cuadra con la lista: Σ reporte = Σ descuento_crc_lineas = Σ de las líneas de cada excepción
insert into _r184 (caso, ok, detalle)
select '10 Σ reporte = Σ descuento_crc_lineas de la lista (por local)',
       bool_and(r.s = e.s), string_agg(r.loc || ' ' || r.s || '=' || e.s, ' · ')
  from (select loc, sum((fila->>'descuento_crc')::numeric) s from _d184 where etapa = 'despues' group by loc) r
  join (select loc, sum((fila->'detalle'->>'descuento_crc_lineas')::numeric) s from _f184
         where etapa = 'despues' and fila->>'tipo' = 'DESCUENTO_SIN_RESPALDO' group by loc) e using (loc);

-- 11. permisos: cajero 42501, manager de A en B 42501, manager en A sí; anon sin EXECUTE; núcleos cerrados
insert into _r184 (caso, ok, detalle)
select '11 permisos iguales: cajero y manager fuera de su local 42501; anon y núcleos cerrados',
       not exists (select loc, valor from _a184 where etapa = 'antes' and valor not like 'abiertas=%' and valor not like 'manager_a=%'
                   except select loc, valor from _a184 where etapa = 'despues')
       and (select valor from _a184 where etapa = 'despues' and loc = 'prueba184a' and valor like 'cajero=%') = 'cajero=ERR:42501'
       and (select valor from _a184 where etapa = 'despues' and loc = 'prueba184b' and valor like 'manager_a=%') = 'manager_a=ERR:42501'
       and (select valor from _a184 where etapa = 'despues' and loc = 'prueba184a' and valor like 'manager_a=%') = 'manager_a=7 fact. / 3300'
       and not has_function_privilege('anon', 'public.club_reporte_descuentos(date,date,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.club_reporte_descuentos__nucleo(date,date,text)', 'execute')
       and has_function_privilege('authenticated', 'public.club_reporte_descuentos(date,date,text)', 'execute'),
       (select string_agg(loc || ' ' || valor, ' · ') from _a184 where etapa = 'despues' and valor not like 'abiertas=%');

-- 12. vuelta atrás (en esta misma transacción descartada): md5 de antes, misma lista y mismo reporte que antes
-- @@184R@@   (aquí va el cuerpo de scripts/sql/184_rollback.sql sin begin/commit)
select pg_temp.foto('rollback');
insert into _r184 (caso, ok, detalle)
select '12 rollback: núcleos 100caed1 / 30bba89b; misma lista, mismo reporte y mismos permisos que antes',
       not exists (select fn, md5, secdef, cfg, vol, acl, dueno from _p184 where etapa = 'antes'
                   except select fn, md5, secdef, cfg, vol, acl, dueno from _p184 where etapa = 'rollback')
       and not exists (select loc, fila from _f184 where etapa = 'antes' except all select loc, fila from _f184 where etapa = 'rollback')
       and not exists (select loc, fila from _f184 where etapa = 'rollback' except all select loc, fila from _f184 where etapa = 'antes')
       and not exists (select loc, fila from _d184 where etapa = 'antes' except all select loc, fila from _d184 where etapa = 'rollback')
       and not exists (select loc, fila from _d184 where etapa = 'rollback' except all select loc, fila from _d184 where etapa = 'antes')
       and not exists (select loc, valor from _a184 where etapa = 'antes' except select loc, valor from _a184 where etapa = 'rollback'),
       (select string_agg(fn || '=' || left(md5, 8), ' ') from _p184 where etapa = 'rollback');

-- Resultado
select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r184;

-- ASSERT: cada caso que falla sale como WARNING («184 FALLA <caso> — <detalle>»), después el resumen
-- («184 RESUMEN: pasaron X / fallaron Y de 13») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «184-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 13;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _r184 where ok is not true order by n loop   -- null = falla
    raise warning '184 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r184;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '184 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice '184 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception '184-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
