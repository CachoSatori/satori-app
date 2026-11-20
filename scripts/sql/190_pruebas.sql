-- 190_pruebas · pos_ventas_resumen: el Resumen de Ventas v2 por función, solo lectura, rol adentro. Corre en STAGING
-- (o una base con datos del PoS) dentro de una transacción que termina en ROLLBACK: aplica la 190, corre la batería y
-- el rollback, y no deja nada. Corre ANTES de aplicar (R15). Se arma con scripts/sql/190_pruebas.py (--armar; --mutar X).
--
-- MARCADORES que llena el runner: «-- @@190@@» → cuerpo de supabase/migrations/190_… (con --mutar, con el arreglo roto a
-- propósito); «-- @@190R@@» → cuerpo de scripts/sql/190_rollback.sql sin begin/commit.
-- Usuarios FICTICIOS (manager, contador, salonero) creados dentro de la transacción; el owner es uno activo de la base.
-- Mes de prueba: octubre 2026 (cualquiera con facturas sirve; si no hay, el caso 00 cae: NO PROBADO).
begin;
-- @@190@@   (aquí va el cuerpo de la 190)
create temp table _r190 (n serial, caso text, ok boolean, detalle text) on commit drop;
grant all on _r190 to anon, authenticated;
grant usage on sequence _r190_n_seq to anon, authenticated;

create temp table _c190 on commit drop as
select (select p.id from public.profiles p where p.is_active and p.role::text = 'owner' order by p.id limit 1) as owner_id,
       '00000000-0000-4000-8190-0000000000a1'::uuid as manager,
       '00000000-0000-4000-8190-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8190-0000000000e1'::uuid as salonero,
       'santa-teresa'::text as loc, date '2026-10-01' as d0, date '2026-10-31' as d1;
grant select on _c190 to anon, authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ((select manager from _c190), '{"full_name":"Manager Ficticio"}'),
  ((select contador from _c190), '{"full_name":"Contador Ficticio"}'),
  ((select salonero from _c190), '{"full_name":"Salonero Ficticio"}');
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from _c190), 'role', 'authenticated')::text, true);
update public.profiles set role = 'manager', is_active = true where id = (select manager from _c190);
update public.profiles set role = 'contador', is_active = true where id = (select contador from _c190);
update public.profiles set role = 'salonero', is_active = true where id = (select salonero from _c190);
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
  return sqlstate || ':' || sqlerrm;
end $f$;
create function pg_temp.err_como(p_uid uuid, p_sql text) returns text language sql as $f$
  select pg_temp.error_de(format('select pg_temp.como(%L::uuid, %L)', p_uid, p_sql)) $f$;
create function pg_temp.res(p_uid uuid, p_desde date, p_hasta date) returns jsonb language sql as $f$
  select pg_temp.como(p_uid, format('public.pos_ventas_resumen(%L, %L::date, %L::date)', (select loc from _c190), p_desde, p_hasta)) $f$;

-- Lo que se espera, calculado POR OTRO CAMINO (subconsultas por factura, sin los CTE de la función).
create temp table _t190 on commit drop as
select tk.*, (tk.fecha_registra at time zone 'America/Costa_Rica')::date as dia,
       (select count(*) from public.pos_ndf_ticket_lines x where x.ticket_id = tk.id) as nl,
       case when exists (select 1 from public.pos_ndf_ticket_lines x where x.ticket_id = tk.id)
            then (select coalesce(sum(x.monto), 0) from public.pos_ndf_ticket_lines x
                   where x.ticket_id = tk.id and (x.familia is null or x.familia not in (6, 17, 20)))
            else coalesce(tk.valor_servido_crc, 0) end as neta_e
  from public.pos_ndf_tickets tk, _c190 c
 where tk.local = c.loc and tk.estado = 'C'
   and tk.fecha_registra >= ((c.d0 - 1)::timestamp at time zone 'America/Costa_Rica')
   and tk.fecha_registra <  ((c.d1 + 2)::timestamp at time zone 'America/Costa_Rica');
create temp table _o190 on commit drop as select pg_temp.res(c.owner_id, c.d0, c.d1) as j from _c190 c;

-- 00. armado
insert into _r190 (caso, ok, detalle)
select '00 armado: owner activo, personal ficticio con su rol, facturas en el mes',
       c.owner_id is not null
       and (select count(*) from public.profiles p where p.id in (c.manager, c.contador, c.salonero) and p.is_active) = 3
       and (select count(*) from _t190 where dia between c.d0 and c.d1) > 0,
       (select count(*) from _t190)::text
  from _c190 c;

-- 01. días: uno por día CR con facturas, y cada suma igual a la calculada por factura
insert into _r190 (caso, ok, detalle)
select '01 días: mismos días; facturas, PAX, neta/IVA/servicio/delivery en céntimos iguales al cálculo por factura',
       a.dias = e.dias and a.fact = e.fact and a.pax = e.pax and a.neta = e.neta and a.iva = e.iva and a.serv = e.serv and a.del = e.del,
       concat_ws(' | ', a, e)
  from (select count(*) dias, sum((d->>6)::bigint) fact, sum((d->>5)::bigint) pax, sum((d->>1)::numeric) neta,
               sum((d->>2)::numeric) iva, sum((d->>3)::numeric) serv, sum((d->>4)::numeric) del
          from _o190, jsonb_array_elements(j->'dias') d) a,
       (select count(distinct dia) dias, count(*) fact,
               sum(case when coalesce(pax_articulo, 0) > 0 then pax_articulo else coalesce(pax, 0) end) pax,
               sum(round(neta_e * 100)) neta, sum(round(coalesce(iva_crc, 0) * 100)) iva,
               sum(round(coalesce(servicio_crc, 0) * 100)) serv,
               coalesce(sum(round(neta_e * 100)) filter (where canal = 'delivery'), 0) del
          from _t190, _c190 c where dia between c.d0 and c.d1) e;

-- 02. facturas: las de salón de la ventana, con su neta, y la parte de dueños null solo sin líneas
insert into _r190 (caso, ok, detalle)
select '02 facturas de salón de la ventana: cantidad, Σ neta, sin líneas = dueños null, Σ familia 28',
       a.n = e.n and a.neta = e.neta and a.sin_l = e.sin_l and a.duenos = e.duenos and a.largo = 10,
       concat_ws(' | ', a, e)
  from (select count(*) n, sum((f->>5)::numeric) neta, count(*) filter (where f->6 = 'null'::jsonb) sin_l,
               sum((f->>6)::numeric) duenos, max(jsonb_array_length(f)) largo
          from _o190, jsonb_array_elements(j->'facturas') f) a,
       (select count(*) n, sum(neta_e) neta, count(*) filter (where nl = 0) sin_l,
               sum((select sum(x.monto) from public.pos_ndf_ticket_lines x where x.ticket_id = t.id and x.familia = 28))
                 duenos
          from _t190 t where canal = 'salon') e;

-- 03. lotes: uno por (caja, cierre) (abiertos, por día), con la apertura = factura más vieja
insert into _r190 (caso, ok, detalle)
select '03 lotes: cantidad y apertura mínima de cada (caja, cierre)',
       a.n = e.n and a.h = e.h, concat_ws(' | ', a.n, e.n)
  from (select count(*) n, md5(string_agg(concat(l->>0, '|', (l->>1)::timestamptz, '|', (l->>2)::timestamptz), ',' order by (l->>2)::timestamptz, l->>0, (l->>1)::timestamptz)) h
          from _o190, jsonb_array_elements(j->'lotes') l) a,
       (select count(*) n, md5(string_agg(concat(cajero_login, '|', fecha_cierra, '|', ap), ',' order by ap, cajero_login, fecha_cierra)) h
          from (select cajero_login, fecha_cierra, min(fecha_registra) ap from _t190
                 group by cajero_login, fecha_cierra, case when fecha_cierra is null then dia end) g) e;

-- 04. manager y contador ven lo mismo que el owner
insert into _r190 (caso, ok, detalle)
select '04 manager y contador: el mismo resultado que el owner',
       pg_temp.res(c.manager, c.d0, c.d1) = o.j and pg_temp.res(c.contador, c.d0, c.d1) = o.j, null
  from _c190 c, _o190 o;

-- 05. salonero → 42501; anon y public sin EXECUTE; authenticated sí
insert into _r190 (caso, ok, detalle)
select '05 salonero → 42501 «No autorizado»; anon y public sin EXECUTE; authenticated sí',
       a = '42501:No autorizado'
       and not has_function_privilege('anon', 'public.pos_ventas_resumen(text, date, date)', 'execute')
       and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                        where p.oid = 'public.pos_ventas_resumen(text, date, date)'::regprocedure and x.grantee = 0)
       and has_function_privilege('authenticated', 'public.pos_ventas_resumen(text, date, date)', 'execute'),
       a
  from (select pg_temp.err_como(c.salonero, format('public.pos_ventas_resumen(%L, %L::date, %L::date)', c.loc, c.d0, c.d1)) a from _c190 c) x;

-- 06. parámetros: al revés, de más de 731 días o nulos → 22023
insert into _r190 (caso, ok, detalle)
select '06 parámetros inválidos → 22023 (al revés, 732 días, nulo)',
       a like '22023:%' and b like '22023:%' and d like '22023:%' and pg_temp.res(c.owner_id, c.d0, c.d0 + 730) is not null,
       concat_ws(' | ', a, b, d)
  from _c190 c,
       lateral (select pg_temp.err_como(c.owner_id, format('public.pos_ventas_resumen(%L, %L::date, %L::date)', c.loc, c.d1, c.d0)) a,
                       pg_temp.err_como(c.owner_id, format('public.pos_ventas_resumen(%L, %L::date, %L::date)', c.loc, c.d0, c.d0 + 731)) b,
                       pg_temp.err_como(c.owner_id, format('public.pos_ventas_resumen(%L, null::date, %L::date)', c.loc, c.d1)) d) x;

-- 07. forma: SECURITY DEFINER, search_path fijo, STABLE, jsonb; solo las tres listas, filas del largo esperado
insert into _r190 (caso, ok, detalle)
select '07 SECURITY DEFINER, search_path = public, pg_temp, STABLE; {dias, facturas, lotes}; filas 7 / 10 / 3',
       p.prosecdef and p.proconfig = array['search_path=public, pg_temp'] and p.provolatile = 's'
       and p.prorettype = 'jsonb'::regtype
       and (select array_agg(k order by k) from _o190, jsonb_object_keys(j) k) = array['dias', 'facturas', 'lotes']
       and (select bool_and(jsonb_array_length(d) = 7) from _o190, jsonb_array_elements(j->'dias') d)
       and (select bool_and(jsonb_array_length(l) = 3) from _o190, jsonb_array_elements(j->'lotes') l),
       null
  from pg_proc p where p.oid = 'public.pos_ventas_resumen(text, date, date)'::regprocedure;

-- 08. rollback
-- @@190R@@   (aquí va el cuerpo de scripts/sql/190_rollback.sql sin begin/commit)
insert into _r190 (caso, ok, detalle)
select '08 rollback: sin pos_ventas_resumen', to_regprocedure('public.pos_ventas_resumen(text, date, date)') is null, null;

-- Resultado
select json_agg(json_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) from _r190;

-- ASSERT: cada caso que falla sale como WARNING, después el resumen y, si falla alguno o faltan casos, ABORTA con
-- «190-FALLAN: <casos>». Este bloque NO lleva «exception when others».
do $$
declare
  r record;
  v_esp constant int := 9;
  v_tot int; v_ok int; v_mal int; v_lista text;
begin
  for r in select caso, detalle from _r190 where ok is not true order by n loop
    raise warning '190 FALLA % — %', r.caso, coalesce(r.detalle, '(sin detalle)');
  end loop;
  select count(*), count(*) filter (where ok is true), string_agg(split_part(caso, ' ', 1), ',' order by n) filter (where ok is not true)
    into v_tot, v_ok, v_lista from _r190;
  v_mal := v_tot - v_ok;
  if v_tot <> v_esp then
    raise warning '190 FALLA cantidad: se esperaban % casos y hay % (NO PROBADO)', v_esp, v_tot;
    v_mal := v_mal + greatest(v_esp - v_tot, 1);
    v_lista := concat_ws(',', v_lista, 'cantidad');
  end if;
  raise notice '190 RESUMEN: pasaron % / fallaron % de %', v_ok, v_mal, v_esp;
  if v_mal > 0 then raise exception '190-FALLAN: % · pasaron % / fallaron %', v_lista, v_ok, v_mal; end if;
end $$;
rollback;
