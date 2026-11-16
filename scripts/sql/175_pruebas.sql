-- 175_pruebas (origen club 121) · Aplica la 175 dentro de una transacción, prueba y termina en ROLLBACK: no deja nada.
-- Corre sobre una base con la 173 (staging cuando la tenga, o el Postgres 16 local armado con las migraciones del árbol).
-- Devuelve un JSON con cada caso y ok, y al final un ASSERT: si algún caso falla, aborta con «175-FALLAN: <casos>».
-- Se corre con scripts/sql/175_pruebas.py (o con el SQL armado: 175_pruebas.py --armar).
--
-- MARCADORES que llena el runner: «-- @@175@@ …» → el cuerpo de supabase/migrations/175_… sin begin/commit ni su bloque
-- de verificación (con --mutar, con el arreglo deshecho a propósito); «-- @@175R@@ …» → el cuerpo del rollback (caso 11).
-- Locales FICTICIOS: prueba175a y prueba175b (Club encendido). Un owner ACTIVO de la base (en local lo crea
-- --semilla-local), manager de cada local, un cajero y un contador, ficticios y creados adentro. Socios con nombres
-- ficticios y WhatsApp ficticios (+1 555 01xx). Las fechas (cruzando el fin de año) se prueban con días fijos en las
-- internas (club_cumple_usar_dia / club_cumple_en_caja_dia con p_hoy); las públicas, con el día CR de hoy.
begin;
-- @@175@@   (aquí va el cuerpo de la 175 sin begin/commit)
create temp table _r175 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r175 to anon, authenticated;
grant usage on sequence _r175_n_seq to anon, authenticated;

create temp table _c175 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8175-0000000000a1'::uuid as manager_a,
       '00000000-0000-4000-8175-0000000000b1'::uuid as manager_b,
       '00000000-0000-4000-8175-0000000000c1'::uuid as cajero,
       '00000000-0000-4000-8175-0000000000d1'::uuid as contador,
       (now() at time zone 'America/Costa_Rica')::date as hoy;
grant select on _c175 to anon, authenticated;

insert into public.locations (id, name) values ('prueba175a', 'Local Ficticio A'), ('prueba175b', 'Local Ficticio B')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba175a', 'Local Ficticio A', true), ('prueba175b', 'Local Ficticio B', true);
update public.club_config set cortesia_costo_pct = 40 where location_id = 'prueba175a';
insert into public.club_cortesias (location_id, codigo_producto, nombre) values
  ('prueba175a', 'P175A1', 'Postre Ficticio A'), ('prueba175b', 'P175B1', 'Postre Ficticio B');

insert into auth.users (id, raw_user_meta_data) values
  ((select manager_a from _c175), '{"full_name":"Manager Ficticio A"}'),
  ((select manager_b from _c175), '{"full_name":"Manager Ficticio B"}'),
  ((select cajero from _c175), '{"full_name":"Cajero Ficticio"}'),
  ((select contador from _c175), '{"full_name":"Contador Ficticio"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c175), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager', is_active = true where id in ((select manager_a from _c175), (select manager_b from _c175));
update public.profiles set role = 'cajero', is_active = true where id = (select cajero from _c175);
update public.profiles set role = 'contador', is_active = true where id = (select contador from _c175);
select set_config('request.jwt.claims', '', true);
insert into public.profile_locations (profile_id, location_id, principal) values
  ((select manager_a from _c175), 'prueba175a', true), ((select manager_b from _c175), 'prueba175b', true);

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
  return sqlerrm;
end $f$;
create function pg_temp.err_como(p_uid uuid, p_sql text) returns text language sql as $f$
  select pg_temp.error_de(format('select pg_temp.como(%L::uuid, %L)', p_uid, p_sql)) $f$;
create function pg_temp.tel(n int) returns text language sql immutable as $f$ select '+1555017' || lpad(n::text, 3, '0') $f$;
create function pg_temp.alta(n int, p_dia int, p_mes int, p_loc text default 'prueba175a') returns jsonb language sql as $f$
  select pg_temp.como((select cajero from _c175), format(
    'public.club_socio_alta_caja_v3(%L, %L, null, true, true, %s, %s, true, %L)',
    'Socio Ficticio ' || n, pg_temp.tel(n), p_dia, p_mes, p_loc)) $f$;
create function pg_temp.mid(n int) returns uuid language sql stable as $f$
  select public.club_miembro_por_telefono(pg_temp.tel(n)) $f$;
-- visita del socio (la registra club_socio_visita en la caja; acá directa, con la factura ficticia F175-<n>-<día>)
create function pg_temp.visita(n int, p_loc text, p_dia date) returns uuid language sql as $f$
  insert into public.club_visitas_socio (location_id, miembro_id, fecha, client_op_id, pos_ref, visita_clave, estado_beneficio, aplicar)
  values (p_loc, pg_temp.mid(n), p_dia, gen_random_uuid(),
          jsonb_build_object('modo', 'factura', 'numero_factura', 'F175-' || n || '-' || to_char(p_dia, 'YYYYMMDD')),
          'F175-' || n || '-' || to_char(p_dia, 'YYYYMMDD'), 'aplica', '{}'::jsonb)
  returning id $f$;
create function pg_temp.usar(p_visita uuid, p_loc text, p_dia date) returns jsonb language sql as $f$
  select public.club_cumple_usar_dia(p_visita, p_loc, p_dia) $f$;
create function pg_temp.err_usar(p_visita uuid, p_loc text, p_dia date) returns text language sql as $f$
  select pg_temp.error_de(format('select public.club_cumple_usar_dia(%L::uuid, %L, %L::date)', p_visita, p_loc, p_dia)) $f$;
create function pg_temp.vigentes(n int) returns int[] language sql stable as $f$
  select coalesce(array_agg(anio order by anio), '{}') from public.club_cumple_usos where miembro_id = pg_temp.mid(n) and deshecho_en is null $f$;
create function pg_temp.cfg(p_loc text, p_activo boolean, p_extra jsonb default '{}') returns jsonb language sql as $f$
  select pg_temp.como((select owner_id from _c175), format('public.club_cumple_config_guardar(%L::jsonb, %L)',
    jsonb_build_object('activo', p_activo, 'beneficio', 'postre de cortesía', 'min_personas', 5, 'dias_antes', 7,
                       'dias_despues', 7, 'uno_por_mesa', true, 'solo_reserva', true,
                       'reserva_url', 'https://reservas.ejemplo.test/r?rid=1',
                       'cortesia_id', (select id from public.club_cortesias where codigo_producto = 'P175' || upper(right(p_loc, 1)) || '1'))
    || p_extra, p_loc)) $f$;

select pg_temp.cfg('prueba175a', true);
select pg_temp.cfg('prueba175b', true);
-- socios de prueba175a: 1 (30-dic), 2 (2-ene), 3 (30-dic), 4 (30-dic), 5 (30-dic); 6 de prueba175b (30-dic);
-- 7: cumpleaños HOY (para las públicas, que usan el día CR de hoy)
select pg_temp.alta(1, 30, 12); select pg_temp.alta(2, 2, 1); select pg_temp.alta(3, 30, 12); select pg_temp.alta(4, 30, 12);
select pg_temp.alta(5, 30, 12); select pg_temp.alta(6, 30, 12, 'prueba175b');
select pg_temp.alta(7, extract(day from (select hoy from _c175))::int, extract(month from (select hoy from _c175))::int);

-- 00. hay owner activo, el personal ficticio y los socios
insert into _r175 (caso, ok, detalle)
select '00 hay un owner activo, personal ficticio y 7 socios con cumpleaños',
       c.owner_id is not null
       and (select count(*) from public.profiles p where p.id in (c.manager_a, c.manager_b) and p.role::text = 'manager' and p.is_active) = 2
       and exists (select 1 from public.profiles p where p.id = c.contador and p.role::text = 'contador' and p.is_active)
       and (select count(*) from generate_series(1, 7) g where pg_temp.mid(g) is not null) = 7,
       'owner ' || coalesce(c.owner_id::text, 'NINGUNO')
  from _c175 c;

-- 01. Primer uso en la ventana que CRUZA el año: hoy 3-ene-2027, cumpleaños 30-dic → año 2026. Queda año, local,
--     visita/factura y artículo; auditado; a la caja no le vuelve ni la fecha ni el año. Antes, la caja ve «aplica» sin
--     «ya_uso»; después, «ya_uso».
do $$ declare v uuid; a jsonb; r jsonb; b jsonb; u public.club_cumple_usos;
begin
  v := pg_temp.visita(1, 'prueba175a', date '2027-01-03');
  a := public.club_cumple_en_caja_dia(pg_temp.mid(1), 'prueba175a', date '2027-01-03');
  r := pg_temp.usar(v, 'prueba175a', date '2027-01-03');
  b := public.club_cumple_en_caja_dia(pg_temp.mid(1), 'prueba175a', date '2027-01-04');
  select * into u from public.club_cumple_usos where visita_id = v;
  insert into _r175 (caso, ok, detalle) values ('01 primer uso (3-ene por un 30-dic) → año 2026, con local, factura y artículo; auditado; sin fecha ni año para la caja',
    (a->>'aplica')::boolean and not (a->>'ya_uso')::boolean
    and (r->>'ok')::boolean and r->'cortesia'->>'codigo' = 'P175A1' and not (r ? 'anio') and r::text !~ '2026|2027|12-30'
    and u.anio = 2026 and u.location_id = 'prueba175a' and u.visita_clave = 'F175-1-20270103' and u.cortesia_codigo = 'P175A1'
    and u.deshecho_en is null
    and (b->>'ya_uso')::boolean and not (b ? 'anio') and b::text !~ '2026|12-30'
    and exists (select 1 from public.club_auditoria x where x.accion = 'cumple_usar' and x.objeto_id = u.id),
    concat_ws(' | ', a, r, b));
exception when others then
  insert into _r175 (caso, ok, detalle) values ('01 (error sin atrapar)', false, sqlerrm);
end $$;

-- 02. Segundo uso del MISMO año (otra visita, otro día de la misma ventana) → rechazado en el servidor
do $$ declare v uuid; e text;
begin
  v := pg_temp.visita(1, 'prueba175a', date '2027-01-05');
  e := pg_temp.err_usar(v, 'prueba175a', date '2027-01-05');
  insert into _r175 (caso, ok, detalle) values ('02 segundo uso del mismo año → «Ya usó su beneficio de cumpleaños este año»',
    e = 'Ya usó su beneficio de cumpleaños este año' and pg_temp.vigentes(1) = array[2026], e);
exception when others then
  insert into _r175 (caso, ok, detalle) values ('02 (error sin atrapar)', false, sqlerrm);
end $$;

-- 03. Uso en OTRO local cuenta: el socio 3 tiene marca del año 2026 hecha en prueba175b; en prueba175a la caja ve «ya_uso»
--     y el servidor rechaza. Y el índice único frena una segunda marca vigente del mismo año aunque sea de otro local.
do $$ declare v uuid; vb uuid; a jsonb; e text; ei text;
begin
  vb := pg_temp.visita(3, 'prueba175b', date '2026-12-29');
  insert into public.club_cumple_usos (miembro_id, anio, location_id, visita_id, cortesia_codigo)
  values (pg_temp.mid(3), 2026, 'prueba175b', vb, 'P175B1');
  v := pg_temp.visita(3, 'prueba175a', date '2027-01-02');
  a := public.club_cumple_en_caja_dia(pg_temp.mid(3), 'prueba175a', date '2027-01-02');
  e := pg_temp.err_usar(v, 'prueba175a', date '2027-01-02');
  ei := pg_temp.error_de(format($q$insert into public.club_cumple_usos (miembro_id, anio, location_id, visita_id) values (%L, 2026, 'prueba175a', %L)$q$,
                                pg_temp.mid(3), v));
  insert into _r175 (caso, ok, detalle) values ('03 usado en otro local → la caja ve «ya_uso» y el servidor rechaza; índice único por socio y año',
    (a->>'aplica')::boolean and (a->>'ya_uso')::boolean
    and e = 'Ya usó su beneficio de cumpleaños este año'
    and ei like 'duplicate key value violates unique constraint "club_cumple_usos_anio_uq"%',
    concat_ws(' | ', a, e, ei));
exception when others then
  insert into _r175 (caso, ok, detalle) values ('03 (error sin atrapar)', false, sqlerrm);
end $$;

-- 04. El año siguiente sí: el socio 1 (30-dic) vuelve el 28-dic-2027 → año 2027
do $$ declare v uuid; a jsonb; r jsonb;
begin
  v := pg_temp.visita(1, 'prueba175a', date '2027-12-28');
  a := public.club_cumple_en_caja_dia(pg_temp.mid(1), 'prueba175a', date '2027-12-28');
  r := pg_temp.usar(v, 'prueba175a', date '2027-12-28');
  insert into _r175 (caso, ok, detalle) values ('04 año siguiente permitido (28-dic-2027 → año 2027)',
    not (a->>'ya_uso')::boolean and (r->>'ok')::boolean and pg_temp.vigentes(1) = array[2026, 2027],
    concat_ws(' | ', a, r, pg_temp.vigentes(1)));
exception when others then
  insert into _r175 (caso, ok, detalle) values ('04 (error sin atrapar)', false, sqlerrm);
end $$;

-- 05. Ventana que cruza el año hacia adelante: cumpleaños 2-ene usado el 28-dic-2026 → año 2027 (no 2026). El 5-ene-2027
--     (misma ventana) → rechazado. El 30-dic-2027 (ventana del 2-ene-2028) → permitido, año 2028.
do $$ declare v1 uuid; v2 uuid; v3 uuid; e text; r jsonb;
begin
  v1 := pg_temp.visita(2, 'prueba175a', date '2026-12-28');
  perform pg_temp.usar(v1, 'prueba175a', date '2026-12-28');
  v2 := pg_temp.visita(2, 'prueba175a', date '2027-01-05');
  e := pg_temp.err_usar(v2, 'prueba175a', date '2027-01-05');
  v3 := pg_temp.visita(2, 'prueba175a', date '2027-12-30');
  r := pg_temp.usar(v3, 'prueba175a', date '2027-12-30');
  insert into _r175 (caso, ok, detalle) values ('05 cumpleaños 2-ene: 28-dic-2026 cuenta para 2027; 5-ene-2027 rechazado; 30-dic-2027 → 2028',
    e = 'Ya usó su beneficio de cumpleaños este año' and (r->>'ok')::boolean and pg_temp.vigentes(2) = array[2027, 2028],
    concat_ws(' | ', e, r, pg_temp.vigentes(2)));
exception when others then
  insert into _r175 (caso, ok, detalle) values ('05 (error sin atrapar)', false, sqlerrm);
end $$;

-- 06. Rechazos: visita de otro día, de otro local, fuera de la ventana, beneficio apagado, artículo apagado; socio de otro
--     local (la caja no le da nada); dos marcas en la misma visita
do $$ declare v uuid; e1 text; e2 text; e3 text; e4 text; e5 text; e6 text; vb uuid;
begin
  v  := pg_temp.visita(4, 'prueba175a', date '2027-01-02');
  e1 := pg_temp.err_usar(v, 'prueba175a', date '2027-01-03');                 -- la visita es de ayer
  e2 := pg_temp.err_usar(v, 'prueba175b', date '2027-01-02');                 -- otro local
  v  := pg_temp.visita(4, 'prueba175a', date '2027-01-20');
  e3 := pg_temp.err_usar(v, 'prueba175a', date '2027-01-20');                 -- fuera de la ventana
  v  := pg_temp.visita(4, 'prueba175a', date '2027-01-01');
  perform pg_temp.cfg('prueba175a', false);
  e4 := pg_temp.err_usar(v, 'prueba175a', date '2027-01-01');                 -- apagado
  perform pg_temp.cfg('prueba175a', true);
  update public.club_cortesias set activa = false where codigo_producto = 'P175A1';
  e5 := pg_temp.err_usar(v, 'prueba175a', date '2027-01-01');                 -- artículo apagado
  update public.club_cortesias set activa = true where codigo_producto = 'P175A1';
  vb := pg_temp.visita(6, 'prueba175a', date '2027-01-01');                   -- socio de prueba175b en prueba175a
  e6 := pg_temp.err_usar(vb, 'prueba175a', date '2027-01-01');
  insert into _r175 (caso, ok, detalle) values ('06 rechazos: visita de otro día u otro local, fuera de ventana, apagado, sin artículo, socio de otro local',
    e1 like 'Esa visita no es de hoy en este local%' and e2 like 'Esa visita no es de hoy en este local%'
    and e3 = 'Hoy no le corresponde el beneficio de cumpleaños' and e4 = 'Hoy no le corresponde el beneficio de cumpleaños'
    and e5 like 'En este local no hay un artículo de cortesía activo%' and e6 = 'Hoy no le corresponde el beneficio de cumpleaños'
    and pg_temp.vigentes(4) = '{}' and pg_temp.vigentes(6) = '{}',
    concat_ws(' | ', e1, e2, e3, e4, e5, e6));
exception when others then
  insert into _r175 (caso, ok, detalle) values ('06 (error sin atrapar)', false, sqlerrm);
end $$;

-- 07. Deshacer: solo el owner, con nota; queda en la bitácora; después se puede volver a marcar; no se deshace dos veces;
--     la fila no se edita a mano (ni siquiera como el dueño de la base)
do $$ declare u uuid; e1 text; e2 text; e3 text; e4 text; r jsonb; e5 text; e6 text; v uuid; r2 jsonb;
begin
  select id into u from public.club_cumple_usos where miembro_id = pg_temp.mid(1) and anio = 2026 and deshecho_en is null;
  e1 := pg_temp.err_como((select cajero from _c175), format('public.club_cumple_uso_deshacer(%L::uuid, %L)', u, 'marcada por error'));
  e2 := pg_temp.err_como((select manager_a from _c175), format('public.club_cumple_uso_deshacer(%L::uuid, %L)', u, 'marcada por error'));
  e3 := pg_temp.err_como((select contador from _c175), format('public.club_cumple_uso_deshacer(%L::uuid, %L)', u, 'marcada por error'));
  e4 := pg_temp.err_como((select owner_id from _c175), format('public.club_cumple_uso_deshacer(%L::uuid, %L)', u, ' no '));
  r  := pg_temp.como((select owner_id from _c175), format('public.club_cumple_uso_deshacer(%L::uuid, %L)', u, 'marcada por error en caja'));
  e5 := pg_temp.err_como((select owner_id from _c175), format('public.club_cumple_uso_deshacer(%L::uuid, %L)', u, 'otra vez lo mismo'));
  e6 := pg_temp.error_de(format('update public.club_cumple_usos set anio = 2030 where id = %L', u));
  v  := pg_temp.visita(1, 'prueba175a', date '2027-01-06');
  r2 := pg_temp.usar(v, 'prueba175a', date '2027-01-06');
  insert into _r175 (caso, ok, detalle) values ('07 deshacer solo owner con nota (bitácora); vuelve a marcarse; no dos veces; fila inmutable',
    e1 like 'Solo el owner deshace%' and e2 like 'Solo el owner deshace%' and e3 like 'Solo el owner deshace%'
    and e4 like 'Escribí una nota de 5 a 300%' and (r->>'ok')::boolean and e5 = 'Esa marca ya estaba deshecha'
    and e6 like 'La marca del cumpleaños no se cambia%'
    and exists (select 1 from public.club_cumple_usos x where x.id = u and x.deshecho_nota = 'marcada por error en caja'
                  and x.deshecho_por = (select owner_id from _c175))
    and exists (select 1 from public.club_auditoria x where x.accion = 'cumple_uso_deshacer' and x.objeto_id = u
                  and x.despues->>'nota' = 'marcada por error en caja' and x.actor = (select owner_id from _c175))
    and (r2->>'ok')::boolean and pg_temp.vigentes(1) = array[2026, 2027],
    concat_ws(' | ', e1, e2, e3, e4, r, e5, e6, r2));
exception when others then
  insert into _r175 (caso, ok, detalle) values ('07 (error sin atrapar)', false, sqlerrm);
end $$;

-- 08. Públicas con el día CR de hoy: el cajero marca sobre la visita de hoy (socio 7, cumpleaños hoy); el segundo intento
--     rechazado; manager de otro local no; la API no ve la tabla ni llama a las internas; anon nada
do $$ declare v uuid; r jsonb; e1 text; e2 text; e3 text; e4 text; e5 text; c jsonb;
begin
  v  := pg_temp.visita(7, 'prueba175a', (select hoy from _c175));
  r  := pg_temp.como((select cajero from _c175), format('public.club_cumple_usar(%L::uuid, %L)', v, 'prueba175a'));
  e1 := pg_temp.err_como((select cajero from _c175), format('public.club_cumple_usar(%L::uuid, %L)', v, 'prueba175a'));
  c  := pg_temp.como((select cajero from _c175), format('public.club_cumple_en_caja(%L::uuid, %L)', pg_temp.mid(7), 'prueba175a'));
  e2 := pg_temp.err_como((select manager_b from _c175), format('public.club_cumple_usar(%L::uuid, %L)', v, 'prueba175a'));
  e3 := pg_temp.err_como((select manager_a from _c175), '(select count(*) from public.club_cumple_usos)');
  e4 := pg_temp.err_como((select manager_a from _c175), format('public.club_cumple_usar_dia(%L::uuid, %L, %L::date)', v, 'prueba175a', (select hoy from _c175)));
  e5 := case when has_function_privilege('anon', 'public.club_cumple_usar(uuid,text)', 'EXECUTE')
               or has_function_privilege('anon', 'public.club_cumple_usos_resumen(date,date,text)', 'EXECUTE')
               or has_table_privilege('anon', 'public.club_cumple_usos', 'SELECT')
             then 'anon PUEDE' else 'permission denied (anon)' end;
  insert into _r175 (caso, ok, detalle) values ('08 públicas: cajero marca hoy; segundo intento no; manager de otro local no; tabla e internas cerradas',
    (r->>'ok')::boolean and e1 = 'Ya usó su beneficio de cumpleaños este año' and (c->>'ya_uso')::boolean
    and e2 = 'Sin permiso en ese local' and e3 like 'permission denied%' and e4 like 'permission denied%'
    and e5 like 'permission denied%'
    and exists (select 1 from public.club_cumple_usos x where x.visita_id = v and x.usado_por = (select cajero from _c175)),
    concat_ws(' | ', r, e1, c, e2, e3, e4, e5));
exception when others then
  insert into _r175 (caso, ok, detalle) values ('08 (error sin atrapar)', false, sqlerrm);
end $$;

-- 09. Reportes: resumen (owner, manager de su local, contador) cuenta los usos vigentes y la cortesía a costo con el %
--     del local (40 %): factura del uso del socio 2 (28-dic-2026) con el artículo a ₡0 de lista ₡5.000 → ₡2.000. Uso sin
--     el artículo en su factura y uso sin factura se cuentan aparte. La lista (owner y manager) trae socio y operador.
do $$ declare s jsonb; sm jsonb; sc jsonb; e1 text; e2 text; e3 text; l jsonb; tk uuid;
begin
  -- facturas ficticias: la del 28-dic con el artículo a ₡0 (y una línea cobrada); la del 3-ene (socio 1) sin el artículo
  insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta)
  values ('prueba175a', 'F175-2-20261228', timestamptz '2026-12-28 20:00-06', 'C', 'salon', 'cajero', true, 'ok') returning id into tk;
  insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto) values
    (tk, 'P175A1', 'Postre Ficticio A', 1, 5000, 0), (tk, 'X175', 'Plato Ficticio', 2, 9000, 18000);
  insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta)
  values ('prueba175a', 'F175-1-20270103', timestamptz '2027-01-03 20:00-06', 'C', 'salon', 'cajero', true, 'ok') returning id into tk;
  insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto) values
    (tk, 'X175', 'Plato Ficticio', 1, 9000, 9000);
  -- las marcas de prueba son de «ahora» (usado_en = now()): el período es el de hoy
  s  := public.club_cumple_usos_resumen_rango((select hoy from _c175), (select hoy from _c175), 'prueba175a');
  sm := pg_temp.como((select manager_a from _c175), format('public.club_cumple_usos_resumen(%L::date, %L::date, %L)', (select hoy from _c175), (select hoy from _c175), 'prueba175a'));
  sc := pg_temp.como((select contador from _c175), format('public.club_cumple_usos_resumen(%L::date, %L::date, %L)', (select hoy from _c175), (select hoy from _c175), 'prueba175a'));
  e1 := pg_temp.err_como((select manager_b from _c175), format('public.club_cumple_usos_resumen(%L::date, %L::date, %L)', (select hoy from _c175), (select hoy from _c175), 'prueba175a'));
  e2 := pg_temp.err_como((select cajero from _c175), format('public.club_cumple_usos_resumen(%L::date, %L::date, %L)', (select hoy from _c175), (select hoy from _c175), 'prueba175a'));
  l  := pg_temp.como((select manager_a from _c175), format('public.club_cumple_usos_listar(%L::date, %L::date, %L)', (select hoy from _c175), (select hoy from _c175), 'prueba175a'));
  e3 := pg_temp.err_como((select contador from _c175), format('public.club_cumple_usos_listar(%L::date, %L::date, %L)', (select hoy from _c175), (select hoy from _c175), 'prueba175a'));
  -- vigentes en prueba175a: socio 1 ×2 (2027 y el 2026 rehecho), socio 2 ×2, socio 7 = 5; deshechos: 1
  insert into _r175 (caso, ok, detalle) values ('09 resumen: usos vigentes, deshechos, cortesía a costo (40 %), sin artículo/sin factura; lista con socio y operador',
    (s->>'usos')::int = 5 and (s->>'deshechos')::int = 1 and (s->>'con_cortesia')::int = 1
    and (s->>'cortesias_lista_crc')::numeric = 5000 and (s->>'cortesias_costo_crc')::numeric = 2000
    and (s->>'sin_articulo_en_factura')::int = 0 and (s->>'sin_factura')::int = 4
    and sm = s and sc = s and not (sc::text ~ 'Socio Ficticio')
    and e1 = 'Sin permiso en ese local' and e2 = 'Sin permiso' and e3 = 'Sin permiso'
    and jsonb_array_length(l) = 6
    and exists (select 1 from jsonb_array_elements(l) x where x->>'operador' = 'Cajero Ficticio' and x->>'socio' = 'Socio Ficticio 7')
    and exists (select 1 from jsonb_array_elements(l) x where x->>'deshecho_nota' = 'marcada por error en caja'),
    concat_ws(' | ', s, e1, e2, e3));
  -- el uso del 3-ene (socio 1, 2026) se deshizo; el rehecho del 6-ene no tiene factura: la del 3-ene sin el artículo no cuenta
exception when others then
  insert into _r175 (caso, ok, detalle) values ('09 (error sin atrapar)', false, sqlerrm);
end $$;

-- 09b. Un uso vigente cuya factura NO tiene el artículo → «sin artículo en la factura» (no suma costo)
do $$ declare v uuid; s jsonb;
begin
  insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta)
  values ('prueba175a', 'F175-5-20261231', timestamptz '2026-12-31 20:00-06', 'C', 'salon', 'cajero', true, 'ok');
  v := pg_temp.visita(5, 'prueba175a', date '2026-12-31');
  perform pg_temp.usar(v, 'prueba175a', date '2026-12-31');
  s := public.club_cumple_usos_resumen_rango((select hoy from _c175), (select hoy from _c175), 'prueba175a');
  insert into _r175 (caso, ok, detalle) values ('09b uso con factura sin el artículo → contado aparte, sin costo',
    (s->>'usos')::int = 6 and (s->>'sin_articulo_en_factura')::int = 1 and (s->>'cortesias_costo_crc')::numeric = 2000, s::text);
exception when others then
  insert into _r175 (caso, ok, detalle) values ('09b (error sin atrapar)', false, sqlerrm);
end $$;

-- 10. La 173 sigue: sin cumpleaños, socio de otro local y fuera de la ventana → {"aplica": false} exacto (sin «ya_uso»)
insert into _r175 (caso, ok, detalle)
select '10 la caja sigue igual que la 173 fuera de la ventana / otro local (no revela si lo usó)',
       public.club_cumple_en_caja_dia(pg_temp.mid(1), 'prueba175a', date '2027-03-01') = '{"aplica": false}'::jsonb
       and public.club_cumple_en_caja_dia(pg_temp.mid(3), 'prueba175b', date '2027-01-02') = '{"aplica": false}'::jsonb,
       null;

-- 11. ROLLBACK: con marcas, aborta; sin marcas, no queda nada de la 175 y la caja vuelve a la 173 (sin «ya_uso»)
-- @@175RG@@   (aquí va el caso 11a: la guarda REAL de 175_rollback.sql, corrida con marcas, tiene que abortar)
delete from public.club_cumple_usos;
-- @@175R@@   (aquí va el cuerpo de 175_rollback.sql sin begin/commit)
do $$
begin
  insert into _r175 (caso, ok, detalle)
select '11 rollback: sin tabla ni funciones de la 175; la caja de la 173 vuelve (sin «ya_uso»)',
       to_regclass('public.club_cumple_usos') is null
       and to_regprocedure('public.club_cumple_usar(uuid,text)') is null
       and to_regprocedure('public.club_cumple_usar_dia(uuid,text,date)') is null
       and to_regprocedure('public.club_cumple_uso_deshacer(uuid,text)') is null
       and to_regprocedure('public.club_cumple_usos_listar(date,date,text)') is null
       and to_regprocedure('public.club_cumple_usos_resumen(date,date,text)') is null
       and to_regprocedure('public.club_cumple_usos_resumen_rango(date,date,text)') is null
       and to_regprocedure('public.club_cumple_usos_guardia()') is null
       and public.club_cumple_en_caja_dia(pg_temp.mid(1), 'prueba175a', date '2027-01-03') ? 'aplica'
       and not public.club_cumple_en_caja_dia(pg_temp.mid(1), 'prueba175a', date '2027-01-03') ? 'ya_uso'
       and to_regprocedure('public.club_cumple_en_caja(uuid,text)') is not null,
       null;
exception when others then
  insert into _r175 (caso, ok, detalle) values ('11 (error sin atrapar)', false, sqlerrm);
end $$;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r175;

-- ASSERT: si algún caso falla, la transacción aborta y dice cuáles
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r175 where ok is not true;   -- null = falla
  if v is not null then raise exception '175-FALLAN: %', v; end if;
  if (select count(*) from _r175) <> 14 then raise exception '175-FALLAN: se esperaban 14 casos (NO PROBADO)'; end if;
end $$;
rollback;
