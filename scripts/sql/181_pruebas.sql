-- 181_pruebas (origen club 126) · Aplica la 181 dentro de una transacción, prueba y termina en ROLLBACK: no deja nada.
-- Corre sobre una base con la 180 (staging ANTES de aplicar la 181, o el Postgres 16 local de local_armar_base.sh sin la
-- 181). Cada caso que falla sale como WARNING, después «181 RESUMEN: pasaron X / fallaron Y de N» y, si Y > 0 o faltan
-- casos, ABORTA con «181-FALLAN: <casos> · pasaron X / fallaron Y». Se corre con scripts/sql/181_pruebas.py.
--
-- MARCADORES que llena el runner: «-- @@181@@ …» → el cuerpo de supabase/migrations/181_… sin begin/commit ni su bloque
-- de verificación (con --mutar, con el arreglo deshecho a propósito); «-- @@181R@@ …» → el cuerpo de 181_rollback.sql.
-- Locales FICTICIOS (Club encendido): prueba181a (corte 23:59:59.999999: «ahora» es ALMUERZO), prueba181b (corte 00:00:
-- «ahora» es CENA) para las llamadas reales con now(); prueba181c (corte 16:00) y prueba181d (corte 15:00) para los casos
-- con hora fija sobre la interna club_socio_tope_comida. Owner ACTIVO de la base (en local lo crea --semilla-local) y un
-- cajero ficticio creado adentro. Socios ficticios, WhatsApp ficticios (+1 555 01xx). Día fijo: 2026-12-01 (hora CR).
begin;
-- @@181@@   (aquí va el cuerpo de la 181 sin begin/commit)
create temp table _r181 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r181 to anon, authenticated;
grant usage on sequence _r181_n_seq to anon, authenticated;

create temp table _c181 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8181-0000000000c1'::uuid as cajero,
       date '2026-12-01' as dia;
grant select on _c181 to anon, authenticated;

insert into public.locations (id, name) values ('prueba181a', 'Local Ficticio A'), ('prueba181b', 'Local Ficticio B'),
  ('prueba181c', 'Local Ficticio C'), ('prueba181d', 'Local Ficticio D')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre, club_activo) values
  ('prueba181a', 'Local Ficticio A', true), ('prueba181b', 'Local Ficticio B', true),
  ('prueba181c', 'Local Ficticio C', true), ('prueba181d', 'Local Ficticio D', true);
update public.club_config set turno_corte = time '23:59:59.999999' where location_id = 'prueba181a';
update public.club_config set turno_corte = time '00:00'           where location_id = 'prueba181b';
update public.club_config set turno_corte = time '16:00'           where location_id = 'prueba181c';
update public.club_config set turno_corte = time '15:00'           where location_id = 'prueba181d';
-- promo vigente para socios (10 %, sin cortesía: así la visita sale «aplica» sin depender de «CORTESÍA CLUB»)
insert into public.club_promociones (location_id, nombre, para, estado, porcentaje, cortesias) values
  ('prueba181a', 'Promo Ficticia A', array['socio'], 'vigente', 10, 0),
  ('prueba181b', 'Promo Ficticia B', array['socio'], 'vigente', 10, 0);
update public.club_config_global set socio_visitas_por_comida = 1;

insert into auth.users (id, raw_user_meta_data) values ((select cajero from _c181), '{"full_name":"Cajero Ficticio"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c181), 'role', 'authenticated')::text, true);
update public.profiles set role = 'cajero', is_active = true where id = (select cajero from _c181);
select set_config('request.jwt.claims', '', true);

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
create function pg_temp.tel(n int) returns text language sql immutable as $f$ select '+1555018' || lpad(n::text, 3, '0') $f$;
create function pg_temp.alta(n int) returns jsonb language sql as $f$
  select pg_temp.como((select cajero from _c181), format(
    'public.club_socio_alta_caja_v3(%L, %L, null, true, true, 1, 6, true, %L)',
    'Socio Ficticio ' || n, pg_temp.tel(n), 'prueba181a')) $f$;
create function pg_temp.mid(n int) returns uuid language sql stable as $f$
  select public.club_miembro_por_telefono(pg_temp.tel(n)) $f$;
-- un momento en hora de Costa Rica del día fijo (o de otro día)
create function pg_temp.ts(p_hora text, p_dia date default date '2026-12-01') returns timestamptz language sql immutable as $f$
  select (p_dia + p_hora::time) at time zone 'America/Costa_Rica' $f$;
-- visita ya registrada (directa, con el momento fijo y su día CR)
create function pg_temp.vis(n int, p_loc text, p_ts timestamptz, p_estado text default 'aplica') returns uuid language sql as $f$
  insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, client_op_id, pos_ref, visita_clave, estado_beneficio, aplicar)
  values (p_loc, pg_temp.mid(n), (p_ts at time zone 'America/Costa_Rica')::date, p_ts, gen_random_uuid(),
          jsonb_build_object('modo', 'factura', 'numero_factura', 'F181-' || n || '-' || extract(epoch from p_ts)::bigint),
          'F181-' || n || '-' || extract(epoch from p_ts)::bigint, p_estado, '{}'::jsonb)
  returning id $f$;
create function pg_temp.tope(n int, p_loc text, p_ts timestamptz) returns jsonb language sql stable as $f$
  select public.club_socio_tope_comida(pg_temp.mid(n), p_loc, p_ts) $f$;
-- la visita real de la caja (club_socio_visita con now(), como cajero), con una factura ficticia del PoS cobrada hace
-- 4 minutos (se siembra una vez por número)
create function pg_temp.factura(p_loc text, p_factura text) returns void language sql as $f$
  insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta)
  select p_loc, p_factura, now() - interval '4 minutes', 'C', 'salon', 'cajero', true, 'ok'
   where not exists (select 1 from public.pos_ndf_tickets t where t.local = p_loc and t.numero_factura = p_factura) $f$;
create function pg_temp.caja(n int, p_loc text, p_factura text) returns jsonb language sql as $f$
  select pg_temp.factura(p_loc, p_factura);
  select pg_temp.como((select cajero from _c181), format('public.club_socio_visita(%L::uuid, %L::jsonb, %L::uuid, %L)',
    pg_temp.mid(n), json_build_object('modo', 'factura', 'local', p_loc, 'numero_factura', p_factura), gen_random_uuid(), p_loc)) $f$;
create function pg_temp.nvis(n int) returns int language sql stable as $f$
  select count(*)::int from public.club_visitas_socio where miembro_id = pg_temp.mid(n) $f$;

-- alertas antiabuso (181, opción A): Excepciones (SOCIO_USO_ANOMALO) y alertas del Inicio (MISMO_USUARIO), como owner
create function pg_temp.exc(p_loc text, p_desde date, p_hasta date) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c181), 'role', 'authenticated')::text, true);
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into r from public.club_excepciones(p_desde, p_hasta, p_loc, 'SOCIO_USO_ANOMALO') e;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.alertas(p_loc text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c181), 'role', 'authenticated')::text, true);
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into r from public.club_alertas_inicio(p_loc) a where a.tipo = 'MISMO_USUARIO';
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
-- ¿hay una alerta/excepción cuyo ref empieza con este prefijo?
create function pg_temp.hay(p jsonb, p_pref text) returns boolean language sql immutable as $f$
  select exists (select 1 from jsonb_array_elements(p) x where x->>'ref' like p_pref || '%') $f$;
create function pg_temp.fila(p jsonb, p_pref text) returns jsonb language sql immutable as $f$
  select x from jsonb_array_elements(p) x where x->>'ref' like p_pref || '%' limit 1 $f$;
-- visita registrada por el cajero ficticio en un momento dado (para MISMO_USUARIO)
create function pg_temp.vis_por(n int, p_loc text, p_ts timestamptz) returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.vis(n, p_loc, p_ts);
  update public.club_visitas_socio set registrado_por = (select cajero from _c181) where id = v;
  return v;
end $f$;

select pg_temp.alta(g) from generate_series(1, 24) g;

-- 00. hay owner activo, cajero ficticio, 14 socios y los cortes de los locales ficticios
insert into _r181 (caso, ok, detalle)
select '00 owner activo, cajero ficticio, 24 socios activos, cortes A/B/C/D y tope por comida = 1',
       c.owner_id is not null
       and exists (select 1 from public.profiles p where p.id = c.cajero and p.role::text = 'cajero' and p.is_active)
       and (select count(*) from generate_series(1, 24) g join public.club_miembros m on m.id = pg_temp.mid(g) where m.estado = 'activo') = 24
       and (select turno_corte from public.club_config where location_id = 'prueba181c') = time '16:00'
       and (select socio_visitas_por_comida from public.club_config_global) = 1,
       'owner ' || coalesce(c.owner_id::text, 'NINGUNO')
  from _c181 c;

-- 01. Almuerzo + cena el mismo día: con una visita a las 12:00 (C, corte 16:00), a las 19:00 está libre (cena)
do $$ declare t jsonb;
begin
  perform pg_temp.vis(1, 'prueba181c', pg_temp.ts('12:00'));
  t := pg_temp.tope(1, 'prueba181c', pg_temp.ts('19:00'));
  insert into _r181 (caso, ok, detalle) values ('01 almuerzo 12:00 y cena 19:00 el mismo día → la cena está libre',
    (t->>'libre')::boolean and t->>'comida' = 'cena' and (t->>'usadas')::int = 0, t::text);
exception when others then insert into _r181 (caso, ok, detalle) values ('01 (error sin atrapar)', false, sqlerrm);
end $$;

-- 02. Dos en el almuerzo: con una a las 12:00, a las 13:30 no; el texto dice qué comida y desde cuándo vuelve
do $$ declare t jsonb;
begin
  perform pg_temp.vis(2, 'prueba181c', pg_temp.ts('12:00'));
  t := pg_temp.tope(2, 'prueba181c', pg_temp.ts('13:30'));
  insert into _r181 (caso, ok, detalle) values ('02 dos en el almuerzo → rechazado: «Ya usó su beneficio del almuerzo hoy», vuelve en la cena desde las 16:00',
    not (t->>'libre')::boolean and t->>'comida' = 'almuerzo' and (t->>'usadas')::int = 1
    and t->>'texto' = 'Ya usó su beneficio del almuerzo hoy: NO aplicar beneficio'
    and t->>'vuelve' = 'Vuelve a tenerlo en la cena, desde las 16:00.'
    and t->'avisos'->>0 = 'Vuelve a tenerlo en la cena, desde las 16:00.'
    and t->'avisos'->>1 = 'Una visita con beneficio en el almuerzo y una en la cena, en cualquier Satori. Si viene con otro socio, puede ir como su invitado (857).',
    t::text);
exception when others then insert into _r181 (caso, ok, detalle) values ('02 (error sin atrapar)', false, sqlerrm);
end $$;

-- 03. Dos en la cena: con una a las 19:00, a las 21:30 no; vuelve mañana en el almuerzo
do $$ declare t jsonb;
begin
  perform pg_temp.vis(3, 'prueba181c', pg_temp.ts('19:00'));
  t := pg_temp.tope(3, 'prueba181c', pg_temp.ts('21:30'));
  insert into _r181 (caso, ok, detalle) values ('03 dos en la cena → rechazado: «Ya usó su beneficio de la cena hoy», vuelve mañana en el almuerzo',
    not (t->>'libre')::boolean and t->>'comida' = 'cena'
    and t->>'texto' = 'Ya usó su beneficio de la cena hoy: NO aplicar beneficio'
    and t->>'vuelve' = 'Vuelve a tenerlo mañana en el almuerzo.',
    t::text);
exception when others then insert into _r181 (caso, ok, detalle) values ('03 (error sin atrapar)', false, sqlerrm);
end $$;

-- 04. Borde exacto del corte (16:00 en C): 15:59:59.999 es almuerzo, 16:00:00 ya es cena. Una visita a las 15:59:59 no
--     le gasta la cena de las 16:00:00; una a las 16:00:00 sí le gasta la de las 16:00:01.
do $$ declare a jsonb; b jsonb;
begin
  perform pg_temp.vis(4, 'prueba181c', pg_temp.ts('15:59:59'));
  a := pg_temp.tope(4, 'prueba181c', pg_temp.ts('16:00:00'));
  perform pg_temp.vis(5, 'prueba181c', pg_temp.ts('16:00:00'));
  b := pg_temp.tope(5, 'prueba181c', pg_temp.ts('16:00:01'));
  insert into _r181 (caso, ok, detalle) values ('04 borde del corte: 15:59:59.999 almuerzo, 16:00:00 cena; 15:59:59 + 16:00:00 → OK; 16:00:00 + 16:00:01 → rechazado',
    public.club_comida('prueba181c', pg_temp.ts('15:59:59.999')) = 'almuerzo'
    and public.club_comida('prueba181c', pg_temp.ts('16:00:00')) = 'cena'
    and (a->>'libre')::boolean and a->>'comida' = 'cena'
    and not (b->>'libre')::boolean and b->>'comida' = 'cena',
    concat_ws(' | ', a, b));
exception when others then insert into _r181 (caso, ok, detalle) values ('04 (error sin atrapar)', false, sqlerrm);
end $$;

-- 05. Cruce de locales: el almuerzo usado en C cuenta en D (rechazado); y cada visita se clasifica con el corte de SU
--     local: 15:30 en D (corte 15:00) fue CENA, así que a las 15:45 en C (corte 16:00) el almuerzo está libre.
do $$ declare a jsonb; b jsonb;
begin
  perform pg_temp.vis(6, 'prueba181c', pg_temp.ts('12:00'));
  a := pg_temp.tope(6, 'prueba181d', pg_temp.ts('13:00'));
  perform pg_temp.vis(7, 'prueba181d', pg_temp.ts('15:30'));
  b := pg_temp.tope(7, 'prueba181c', pg_temp.ts('15:45'));
  insert into _r181 (caso, ok, detalle) values ('05 cruce: almuerzo en C → en D al almuerzo rechazado; cena en D 15:30 (corte 15:00) no gasta el almuerzo de C 15:45',
    not (a->>'libre')::boolean and a->>'comida' = 'almuerzo'
    and (b->>'libre')::boolean and b->>'comida' = 'almuerzo' and (b->>'usadas')::int = 0,
    concat_ws(' | ', a, b));
exception when others then insert into _r181 (caso, ok, detalle) values ('05 (error sin atrapar)', false, sqlerrm);
end $$;

-- 06. Cambio de día CR a medianoche: la cena de las 23:59:59 del 1-dic gasta la cena de ESE día (23:59:59.5 rechazado)
--     y el 2-dic a las 00:00:00 es un día nuevo (almuerzo libre). En UTC esas horas ya son del día siguiente.
do $$ declare a jsonb; b jsonb;
begin
  perform pg_temp.vis(8, 'prueba181c', pg_temp.ts('23:59:59'));
  a := pg_temp.tope(8, 'prueba181c', pg_temp.ts('23:59:59.5'));
  b := pg_temp.tope(8, 'prueba181c', pg_temp.ts('00:00:00', date '2026-12-02'));
  insert into _r181 (caso, ok, detalle) values ('06 medianoche CR: 23:59:59 gasta la cena del 1-dic; 00:00 del 2-dic es otro día (almuerzo libre)',
    not (a->>'libre')::boolean and a->>'comida' = 'cena'
    and (b->>'libre')::boolean and b->>'comida' = 'almuerzo' and (b->>'usadas')::int = 0,
    concat_ws(' | ', a, b));
exception when others then insert into _r181 (caso, ok, detalle) values ('06 (error sin atrapar)', false, sqlerrm);
end $$;

-- 07. Una visita SIN beneficio (invitado 857, paga con créditos, sin promoción) no gasta la comida
do $$ declare t jsonb;
begin
  perform pg_temp.vis(9, 'prueba181c', pg_temp.ts('12:00'), 'como_invitado');
  perform pg_temp.vis(9, 'prueba181c', pg_temp.ts('12:30'), 'paga_con_creditos');
  perform pg_temp.vis(9, 'prueba181c', pg_temp.ts('13:00'), 'sin_promocion');
  t := pg_temp.tope(9, 'prueba181c', pg_temp.ts('14:00'));
  insert into _r181 (caso, ok, detalle) values ('07 visitas sin beneficio (857, créditos, sin promo) no gastan el almuerzo',
    (t->>'libre')::boolean and (t->>'usadas')::int = 0, t::text);
exception when others then insert into _r181 (caso, ok, detalle) values ('07 (error sin atrapar)', false, sqlerrm);
end $$;

-- 08. Extremo a extremo con la caja (club_socio_visita, now(), como cajero): A = almuerzo, B = cena.
--     1.ª en A aplica · 2.ª en A (otro pedido) → ya_uso_hoy del almuerzo, sin registrar · 1.ª en B aplica (cruce de
--     locales, otra comida) · 2.ª en B → ya_uso_hoy de la cena, «mañana en el almuerzo». Quedan 2 visitas.
do $$ declare a1 jsonb; a2 jsonb; b1 jsonb; b2 jsonb;
begin
  a1 := pg_temp.caja(10, 'prueba181a', '1810001');
  a2 := pg_temp.caja(10, 'prueba181a', '1810002');
  b1 := pg_temp.caja(10, 'prueba181b', '1810003');
  b2 := pg_temp.caja(10, 'prueba181b', '1810004');
  insert into _r181 (caso, ok, detalle) values ('08 caja: A almuerzo aplica, A otra vez rechazado, B cena aplica, B otra vez rechazado; 2 visitas',
    a1->>'estado' = 'aplica' and a1->>'visita_id' is not null
    and a2->>'estado' = 'ya_uso_hoy' and a2->>'visita_id' is null and a2->>'comida' = 'almuerzo'
    and a2->>'texto' = 'Ya usó su beneficio del almuerzo hoy: NO aplicar beneficio'
    and a2->'avisos'->>0 = 'Vuelve a tenerlo en la cena, desde las 23:59.'
    and b1->>'estado' = 'aplica' and b1->>'visita_id' is not null
    and b2->>'estado' = 'ya_uso_hoy' and b2->>'comida' = 'cena'
    and b2->>'texto' = 'Ya usó su beneficio de la cena hoy: NO aplicar beneficio'
    and b2->>'vuelve' = 'Vuelve a tenerlo mañana en el almuerzo.'
    and pg_temp.nvis(10) = 2,
    concat_ws(' | ', a1, a2, b1, b2));
exception when others then insert into _r181 (caso, ok, detalle) values ('08 (error sin atrapar)', false, sqlerrm);
end $$;

-- 09. Invitados / 857 sin cambios: dos socios en la MISMA factura → el 2.º va como invitado; ese 2.º después, en otro
--     pedido de la misma comida, tiene su beneficio (el 857 no le gastó la comida); reescanear el mismo pedido devuelve
--     la misma visita (repetida, sin otra fila).
do $$ declare x jsonb; y jsonb; y2 jsonb; xr jsonb;
begin
  x  := pg_temp.caja(11, 'prueba181a', '1811001');
  y  := pg_temp.caja(12, 'prueba181a', '1811001');
  y2 := pg_temp.caja(12, 'prueba181a', '1811002');
  xr := pg_temp.caja(11, 'prueba181a', '1811001');
  insert into _r181 (caso, ok, detalle) values ('09 invitados/857: 2.º socio en la misma factura como invitado; después aplica en otro pedido; reescaneo = misma visita',
    x->>'estado' = 'aplica' and y->>'estado' = 'como_invitado' and y2->>'estado' = 'aplica'
    and (xr->>'repetida')::boolean and xr->>'visita_id' = x->>'visita_id'
    and pg_temp.nvis(11) = 1 and pg_temp.nvis(12) = 2,
    concat_ws(' | ', x, y, y2, xr));
exception when others then insert into _r181 (caso, ok, detalle) values ('09 (error sin atrapar)', false, sqlerrm);
end $$;

-- 10. El tope por comida es configuración (único del Club): con 2, la 2.ª del almuerzo entra y la 3.ª no, con su texto
do $$ declare a jsonb; b jsonb; c jsonb;
begin
  update public.club_config_global set socio_visitas_por_comida = 2;
  a := pg_temp.caja(13, 'prueba181a', '1813001');
  b := pg_temp.caja(13, 'prueba181a', '1813002');
  c := pg_temp.caja(13, 'prueba181a', '1813003');
  update public.club_config_global set socio_visitas_por_comida = 1;
  insert into _r181 (caso, ok, detalle) values ('10 tope 2 por comida: 1.ª y 2.ª del almuerzo aplican, la 3.ª no («Hasta 2 … en el almuerzo y 2 en la cena»)',
    a->>'estado' = 'aplica' and b->>'estado' = 'aplica' and c->>'estado' = 'ya_uso_hoy'
    and c->'avisos'->>1 like 'Hasta 2 visitas con beneficio en el almuerzo y 2 en la cena, en cualquier Satori.%'
    and pg_temp.nvis(13) = 2,
    concat_ws(' | ', a, b, c));
exception when others then insert into _r181 (caso, ok, detalle) values ('10 (error sin atrapar)', false, sqlerrm);
end $$;

-- 11. Las internas no están abiertas a la API (anon ni authenticated); el cajero no las puede llamar
do $$ declare e1 text; e2 text;
begin
  e1 := pg_temp.err_como((select cajero from _c181), format('public.club_socio_tope_comida(%L::uuid, %L, now())', pg_temp.mid(14), 'prueba181a'));
  e2 := pg_temp.err_como((select cajero from _c181), format('public.club_comida(%L, now())', 'prueba181a'));
  insert into _r181 (caso, ok, detalle) values ('11 club_comida y club_socio_tope_comida cerradas a anon/authenticated; club_socio_visita_base también',
    not has_function_privilege('authenticated', 'public.club_socio_tope_comida(uuid,text,timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.club_socio_tope_comida(uuid,text,timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.club_comida(text,timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.club_comida(text,timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.club_socio_visita_base(uuid,jsonb,uuid,text)', 'execute')
    and has_function_privilege('authenticated', 'public.club_socio_visita(uuid,jsonb,uuid,text)', 'execute')
    and e1 like 'permission denied%' and e2 like 'permission denied%',
    concat_ws(' | ', e1, e2));
exception when others then insert into _r181 (caso, ok, detalle) values ('11 (error sin atrapar)', false, sqlerrm);
end $$;

-- 13. SOCIO_USO_ANOMALO por COMIDA (día fijo pasado 2026-11-03, local C con corte 16:00): almuerzo + cena en dos mesas
--     NO dispara; dos mesas en el almuerzo SÍ (ref socio-comida:…:almuerzo, «dos mesas en la misma comida»); borde
--     15:59:59 / 16:00:00 son comidas distintas (no dispara); almuerzo en C y almuerzo en D (corte 15:00) SÍ, con los dos
--     locales.
update public.club_config set socio_visitas_semana_max = 5 where location_id in ('prueba181c', 'prueba181d');
do $$ declare e jsonb; d date := date '2026-11-03';
begin
  perform pg_temp.vis(15, 'prueba181c', pg_temp.ts('12:00', d)); perform pg_temp.vis(15, 'prueba181c', pg_temp.ts('19:00', d));
  perform pg_temp.vis(16, 'prueba181c', pg_temp.ts('12:00', d)); perform pg_temp.vis(16, 'prueba181c', pg_temp.ts('13:30', d));
  perform pg_temp.vis(17, 'prueba181c', pg_temp.ts('15:59:59', d)); perform pg_temp.vis(17, 'prueba181c', pg_temp.ts('16:00:00', d));
  perform pg_temp.vis(18, 'prueba181c', pg_temp.ts('12:00', d)); perform pg_temp.vis(18, 'prueba181d', pg_temp.ts('13:00', d));
  e := pg_temp.exc('prueba181c', d, d);
  insert into _r181 (caso, ok, detalle) values ('13 SOCIO_USO_ANOMALO por comida: almuerzo+cena no; dos almuerzos sí; 15:59:59/16:00 no; C+D al almuerzo sí',
    not pg_temp.hay(e, 'socio-comida:' || pg_temp.mid(15)) and not pg_temp.hay(e, 'socio-dia:' || pg_temp.mid(15))
    and pg_temp.fila(e, 'socio-comida:' || pg_temp.mid(16))->>'ref' = 'socio-comida:' || pg_temp.mid(16) || ':2026-11-03:almuerzo'
    and pg_temp.fila(e, 'socio-comida:' || pg_temp.mid(16))->'detalle'->>'motivo' = 'dos mesas en la misma comida'
    and pg_temp.fila(e, 'socio-comida:' || pg_temp.mid(16))->'detalle'->>'comida' = 'almuerzo'
    and not pg_temp.hay(e, 'socio-comida:' || pg_temp.mid(17))
    and pg_temp.fila(e, 'socio-comida:' || pg_temp.mid(18))->'detalle'->'locales' @> '["prueba181c","prueba181d"]',
    e::text);
exception when others then insert into _r181 (caso, ok, detalle) values ('13 (error sin atrapar)', false, sqlerrm);
end $$;

-- 14. Máximo semanal (5) por DÍAS con visita (semana ISO del 2-nov al 8-nov de 2026): almuerzo + cena 3 días (6 visitas,
--     3 días) NO dispara; 6 días distintos SÍ (dias = 6); 5 días justos (borde) NO.
do $$ declare e jsonb; i int;
begin
  for i in 0..2 loop
    perform pg_temp.vis(19, 'prueba181c', pg_temp.ts('12:00', date '2026-11-02' + i));
    perform pg_temp.vis(19, 'prueba181c', pg_temp.ts('19:00', date '2026-11-02' + i));
  end loop;
  for i in 0..5 loop perform pg_temp.vis(20, 'prueba181c', pg_temp.ts('12:00', date '2026-11-02' + i)); end loop;
  for i in 0..4 loop perform pg_temp.vis(21, 'prueba181c', pg_temp.ts('19:00', date '2026-11-02' + i)); end loop;
  e := pg_temp.exc('prueba181c', date '2026-11-02', date '2026-11-08');
  insert into _r181 (caso, ok, detalle) values ('14 semana por días: 6 visitas en 3 días no; 6 días sí (dias 6); 5 días justos no',
    not pg_temp.hay(e, 'socio-semana:' || pg_temp.mid(19))
    and (pg_temp.fila(e, 'socio-semana:' || pg_temp.mid(20))->'detalle'->>'dias')::int = 6
    and pg_temp.fila(e, 'socio-semana:' || pg_temp.mid(20))->'detalle'->>'motivo' = 'muchos días con visita en la semana'
    and not pg_temp.hay(e, 'socio-semana:' || pg_temp.mid(21)),
    e::text);
exception when others then insert into _r181 (caso, ok, detalle) values ('14 (error sin atrapar)', false, sqlerrm);
end $$;

-- 15. MISMO_USUARIO (umbral 2 en 3 días) cuenta DÍAS con visita del mismo usuario: almuerzo + cena hoy y ayer (4 visitas,
--     2 días) NO dispara; hoy, ayer y anteayer (3 días) SÍ, con cantidad 3 y cuenta «dias».
update public.club_config set alerta_mismo_usuario_max = 2, alerta_mismo_usuario_dias = 3 where location_id = 'prueba181c';
do $$ declare a jsonb; f jsonb;
begin
  perform pg_temp.vis_por(22, 'prueba181c', now() - interval '1 minute');
  perform pg_temp.vis_por(22, 'prueba181c', now() - interval '2 minutes');
  perform pg_temp.vis_por(22, 'prueba181c', now() - interval '1 day');
  perform pg_temp.vis_por(22, 'prueba181c', now() - interval '1 day 1 minute');
  a := pg_temp.alertas('prueba181c');
  perform pg_temp.vis_por(23, 'prueba181c', now() - interval '1 minute');
  perform pg_temp.vis_por(23, 'prueba181c', now() - interval '1 day');
  perform pg_temp.vis_por(23, 'prueba181c', now() - interval '2 days');
  f := pg_temp.fila(pg_temp.alertas('prueba181c'), 'mismo-usuario:socio:' || pg_temp.mid(23));
  insert into _r181 (caso, ok, detalle) values ('15 MISMO_USUARIO por días: 4 visitas en 2 días no; 3 días sí (cantidad 3, cuenta dias)',
    not pg_temp.hay(a, 'mismo-usuario:socio:' || pg_temp.mid(22))
    and (f->>'cantidad')::int = 3 and f->'detalle'->>'cuenta' = 'dias',
    concat_ws(' | ', a, f));
exception when others then insert into _r181 (caso, ok, detalle) values ('15 (error sin atrapar)', false, sqlerrm);
end $$;

-- 16. MISMO_USUARIO con horas FIJAS en CR que cruzan la medianoche UTC: ayer 12:00 y 19:00 CR (19:00 CR = 01:00 UTC
--     del día siguiente) + anteayer 12:00 CR. En CR son 2 días → NO dispara (umbral 2). Contado en UTC serían 3 días.
do $$ declare a jsonb; ayer date := (now() at time zone 'America/Costa_Rica')::date - 1;
begin
  perform pg_temp.vis_por(24, 'prueba181c', pg_temp.ts('12:00', ayer));
  perform pg_temp.vis_por(24, 'prueba181c', pg_temp.ts('19:00', ayer));
  perform pg_temp.vis_por(24, 'prueba181c', pg_temp.ts('12:00', ayer - 1));
  a := pg_temp.alertas('prueba181c');
  insert into _r181 (caso, ok, detalle) values ('16 MISMO_USUARIO cuenta días CR: almuerzo 12:00 y cena 19:00 CR de ayer + anteayer = 2 días, no dispara',
    not pg_temp.hay(a, 'mismo-usuario:socio:' || pg_temp.mid(24)), a::text);
exception when others then insert into _r181 (caso, ok, detalle) values ('16 (error sin atrapar)', false, sqlerrm);
end $$;

-- 12. ROLLBACK: vuelve el cuerpo exacto de la 150 (md5 de prod el 16-nov), sin las internas ni la columna; la caja
--     vuelve a «una por día»: el socio 14 usa el almuerzo en A y en B (cena) ya no le toca. Excepciones y alertas, como prod.
-- @@181R@@   (aquí va el cuerpo de 181_rollback.sql sin begin/commit)
do $$ declare a jsonb; b jsonb;
begin
  a := pg_temp.caja(14, 'prueba181a', '1814001');
  b := pg_temp.caja(14, 'prueba181b', '1814002');
  insert into _r181 (caso, ok, detalle) values ('12 rollback: base (150), núcleo de excepciones (155) y alertas (164) con el md5 de prod; sin internas ni columna; vuelve «una por día»',
    md5(pg_get_functiondef('public.club_socio_visita_base(uuid,jsonb,uuid,text)'::regprocedure)) = 'a5765518898bbdd297336582a146a5df'
    and md5(pg_get_functiondef('public.club_excepciones__nucleo(date,date,text,text)'::regprocedure)) = '5ad4ff8cf91646c6406fc3ebc24b498e'
    and md5(pg_get_functiondef('public.club_alertas_inicio(text)'::regprocedure)) = '493eb9cb9dd73aae69b87afb1b8bd47f'
    and md5(pg_get_functiondef('public.club_excepciones(date,date,text,text)'::regprocedure)) = '7e0b7ae5c466b5885de3b8d7547381f5'
    and has_function_privilege('authenticated', 'public.club_alertas_inicio(text)', 'execute')
    and to_regprocedure('public.club_socio_tope_comida(uuid,text,timestamptz)') is null
    and to_regprocedure('public.club_comida(text,timestamptz)') is null
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'club_config_global'
                                                              and column_name = 'socio_visitas_por_comida')
    and a->>'estado' = 'aplica' and b->>'estado' = 'ya_uso_hoy'
    and b->>'texto' = 'Ya usó su beneficio hoy en otro pedido: NO aplicar beneficio',
    concat_ws(' | ', a, b));
exception when others then insert into _r181 (caso, ok, detalle) values ('12 (error sin atrapar)', false, sqlerrm);
end $$;

select json_agg(json_build_object('caso', caso, 'ok', coalesce(ok, false), 'detalle', detalle) order by n) from _r181;

-- ASSERT: cada caso que falla sale como WARNING («181 FALLA <caso> — <detalle>»), después el resumen
-- («181 RESUMEN: pasaron X / fallaron Y de 17») y, si Y > 0 o faltan casos, la transacción ABORTA con
-- «181-FALLAN: <casos> · pasaron X / fallaron Y». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 17;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _r181 where ok is not true order by n loop   -- null = falla
    raise warning '181 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r181;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '181 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice '181 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception '181-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
