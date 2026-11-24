-- 198_pruebas · catálogo por código (pos_familias, pos_productos, pos_producto_ajustes, disparador) y las lecturas
-- pos_ventas_productos / pos_catalogo_productos / pos_producto_ajuste_guardar. Transacción que termina en ROLLBACK: no
-- deja nada. Usa un LOCAL FICTICIO ('prueba-198') con facturas y usuarios inventados; los casos «santa-teresa» comparan
-- contra la 190 con los datos de la base (en un Postgres vacío dan 0 = 0).
-- Corre en STAGING (antes de aplicar, R15) o en un Postgres vacío con scripts/sql/193_base_local.sql + la 190 (y
-- scripts/sql/198_preludio_local.sql, que pone `--local`). Se arma y se corre con scripts/sql/198_pruebas.py
-- (--armar [--medir] [--local] | --psql "<conexión>" [--local] [--mutar todas]). Nunca contra PROD.
-- MARCADORES: «-- @@preludio@@» → 198_preludio_local.sql (solo con --local) · «-- @@198@@» → cuerpo de
-- supabase/migrations/198_pos_catalogo_productos.sql (con --mutar, roto a propósito) · «-- @@198_rollback@@» →
-- scripts/sql/198_rollback.sql. Sin nombres reales: los productos de prueba se llaman «FICTICIO …».
begin;
create temp table _r198 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _m198 (k text primary key, v text) on commit drop;
grant all on _r198, _m198 to public;
grant usage on sequence _r198_n_seq to public;
-- @@preludio@@

-- ── Antes de la 198: usuarios, el local ficticio y lo que la carga inicial tiene que heredar ──────────────────────────
create temp table _c198 on commit drop as
select '00000000-0000-4000-8198-0000000000b1'::uuid as owner_id,
       '00000000-0000-4000-8198-0000000000a1'::uuid as manager,      -- manager de prueba-198
       '00000000-0000-4000-8198-0000000000a2'::uuid as manager_otro, -- manager de santa-teresa (local ajeno)
       '00000000-0000-4000-8198-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8198-0000000000e1'::uuid as salonero,
       '00000000-0000-4000-8198-0000000000e2'::uuid as cajero,
       'prueba-198'::text as loc;
grant select on _c198 to public;
-- Lo que escribe va en su PROPIA sentencia (_a198): dentro de una misma sentencia, lo escrito por una función no lo ve el resto.
create temp table _a198 (k text primary key, v text) on commit drop;
grant all on _a198 to public;
insert into public.locations (id, name, is_active) values ('prueba-198', 'Local de prueba 198', false)
on conflict (id) do nothing;
insert into auth.users (id, raw_user_meta_data)
select x, '{"full_name":"Ficticio 198"}'::jsonb
  from _c198 c, unnest(array[c.owner_id, c.manager, c.manager_otro, c.contador, c.salonero, c.cajero]) x;
update public.profiles p set role = r.rol::public.user_role, is_active = true
  from _c198 c, (values (1, 'owner'), (2, 'manager'), (3, 'manager'), (4, 'contador'), (5, 'salonero'), (6, 'cajero')) r(i, rol)
 where p.id = (array[c.owner_id, c.manager, c.manager_otro, c.contador, c.salonero, c.cajero])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, loc from _c198;
insert into public.profile_locations (profile_id, location_id) select manager_otro, 'santa-teresa' from _c198;

-- «rinde» que la 198 hereda de product_map (por nombre, sin mayúsculas ni espacios): A → gana el mayor (5) · B → la
-- heredan los dos códigos que la comparten · C → tope 20 · «SIN RINDE» (1) no deja fila · «NO EXISTE» no está en el PoS.
insert into public.product_map (nombre, multiplicador) values
  ('FICTICIO 198 RINDE A', 3), ('Ficticio 198 Rinde A', 5), ('FICTICIO 198 RINDE B', 2), ('FICTICIO 198 RINDE C ', 30),
  ('FICTICIO 198 SIN RINDE', 1), ('FICTICIO 198 NO EXISTE', 4);
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, valor_servido_crc)
values ('prueba-198', 'H', '2026-10-05 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-198', 'HX', '2026-10-06 12:00-06', 'X', 'salon', 'salonero', true, 'ok', 0);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, x.cod, x.nom, 1, 1000, x.fam
from (values ('H', '8001', 'FICTICIO 198 RINDE A', 5), ('H', '8002', 'FICTICIO 198 RINDE B', 5),
             ('H', '8003', 'FICTICIO 198 RINDE B', 5), ('H', '8004', 'FICTICIO 198 SIN RINDE', 5),
             ('H', '8005', 'Ficticio 198 Rinde C', 3), ('H', repeat('7', 41), 'FICTICIO CODIGO LARGO', 3),
             ('HX', '8006', 'FICTICIO ANULADO', 3)) x(fac, cod, nom, fam)
join public.pos_ndf_tickets t on t.local = 'prueba-198' and t.numero_factura = x.fac;

-- ── La 198 (con --medir, el armador le suma marcas de tiempo) ─────────────────────────────────────────────────────────
select set_config('p198.t_ini', clock_timestamp()::text, true);
-- @@198@@
insert into _m198 values ('migracion_entera_ms', round(extract(epoch from clock_timestamp() - current_setting('p198.t_ini')::timestamptz) * 1000)::text);

-- ── Ayudantes ───────────────────────────────────────────────────────────────────────────────────────────────────────
create function pg_temp.como(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  execute 'select to_jsonb((' || p_sql || '))' into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  raise;
end $f$;
-- Una llamada o escritura como el usuario: null si anduvo (o cuántas filas tocó, con p_filas), o el SQLSTATE si falló.
create function pg_temp.err_como(p_uid uuid, p_sql text, p_filas boolean default false) returns text language plpgsql as $f$
declare k int;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  if p_filas then execute p_sql; get diagnostics k = row_count; else execute 'select ' || p_sql; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return case when p_filas then k::text end;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return sqlstate;
end $f$;
-- Lo mismo con el rol de la sesión (dueño de la base): por debajo de las funciones y de los permisos.
create function pg_temp.intentar(p_sql text) returns text language plpgsql as $f$
declare k int;
begin
  execute p_sql; get diagnostics k = row_count; return k::text;
exception when others then return sqlstate;
end $f$;
-- Una fila de `productos` por (código, familia de la línea, canal).
create function pg_temp.fila(j jsonb, p_cod text, p_fam int, p_canal text) returns jsonb language sql as $f$
  select e from jsonb_array_elements(j->'productos') e
  where (e->>0) is not distinct from p_cod and (e->>2)::int is not distinct from p_fam and e->>3 = p_canal $f$;
-- Σ monto de las filas de venta (categoría que no es cortesia/personal/ingredientes) de `productos` (i=5, cat=7) o `meses` (4, 5).
create function pg_temp.venta_cat(j jsonb, p_clave text) returns numeric language sql as $f$
  select coalesce(sum((e->>(case when p_clave = 'productos' then 5 else 4 end))::numeric), 0)
  from jsonb_array_elements(j->p_clave) e
  where e->>(case when p_clave = 'productos' then 7 else 5 end) not in ('cortesia', 'personal', 'ingredientes') $f$;
create function pg_temp.por_cat(j jsonb, p_cat text) returns numeric language sql as $f$
  select coalesce(sum((e->>5)::numeric), 0) from jsonb_array_elements(j->'productos') e where e->>7 = p_cat $f$;
create function pg_temp.neta190(p_uid uuid, p_local text, p_desde date, p_hasta date) returns numeric language sql as $f$
  select coalesce(sum((e->>1)::numeric), 0)
  from jsonb_array_elements(pg_temp.como(p_uid, format('public.pos_ventas_resumen(%L, date %L, date %L)', p_local, p_desde, p_hasta))->'dias') e $f$;
create function pg_temp.vp(p_uid uuid, p_local text, p_desde date, p_hasta date) returns jsonb language sql as $f$
  select pg_temp.como(p_uid, format('public.pos_ventas_productos(%L, date %L, date %L)', p_local, p_desde, p_hasta)) $f$;
create function pg_temp.guardar(p_uid uuid, p_local text, p_cod text, p_rinde int, p_cat text) returns text language sql as $f$
  select pg_temp.err_como(p_uid, format('public.pos_producto_ajuste_guardar(%L, %L, %s, %L)', p_local, p_cod,
                                        coalesce(p_rinde::text, 'null'), p_cat)) $f$;
create function pg_temp.ajustes(p_local text) returns text language sql as $f$
  select coalesce(string_agg(codigo || '=' || rinde_personas || '/' || coalesce(categoria, '-'), ' | ' order by codigo), '-')
  from public.pos_producto_ajustes where local = p_local $f$;

-- ═══ A. Carga inicial y herencia ═══════════════════════════════════════════════════════════════════════════════════
insert into _r198 (caso, ok, detalle)
select '01 carga inicial: una fila por (local, código) válido de las líneas (sin vacíos ni de más de 40)',
       (select count(*) from public.pos_productos)
         = (select count(distinct (t.local, btrim(l.codigo_producto))) from public.pos_ndf_ticket_lines l
              join public.pos_ndf_tickets t on t.id = l.ticket_id
             where nullif(btrim(l.codigo_producto), '') is not null and length(btrim(l.codigo_producto)) <= 40)
       and not exists (select 1 from public.pos_productos where length(codigo) > 40),
       (select count(*)::text from public.pos_productos);
insert into _r198 (caso, ok, detalle)
select '02 correr pos_catalogo_refrescar otra vez no escribe nada (santa-teresa y prueba-198)',
       public.pos_catalogo_refrescar('santa-teresa') = 0 and public.pos_catalogo_refrescar('prueba-198') = 0, null;
insert into _r198 (caso, ok, detalle)
select '03 nombre y familia = los de la factura más reciente; visto_* = primer y último día CR (cualquier estado)',
       not exists (
         with n as (select t.local, btrim(l.codigo_producto) as codigo, coalesce(nullif(btrim(l.nombre), ''), btrim(l.codigo_producto)) as nombre,
                           l.familia, t.fecha_registra, (t.fecha_registra at time zone 'America/Costa_Rica')::date as dia
                      from public.pos_ndf_ticket_lines l join public.pos_ndf_tickets t on t.id = l.ticket_id
                     where nullif(btrim(l.codigo_producto), '') is not null and length(btrim(l.codigo_producto)) <= 40),
              e as (select distinct on (local, codigo) local, codigo, nombre, familia,
                           min(dia) over (partition by local, codigo) as desde, max(dia) over (partition by local, codigo) as hasta
                      from n order by local, codigo, fecha_registra desc, nombre, familia)
         select 1 from e left join public.pos_productos p using (local, codigo)
          where p.codigo is null or p.nombre <> e.nombre or p.familia is distinct from e.familia
             or p.visto_desde <> e.desde or p.visto_hasta <> e.hasta),
       null;
insert into _r198 (caso, ok, detalle)
select '04 «rinde» heredado: dos filas que solo difieren en mayúsculas → gana el mayor (8001 = 5)',
       (select rinde_personas from public.pos_producto_ajustes where local = 'prueba-198' and codigo = '8001') = 5,
       pg_temp.ajustes('prueba-198');
insert into _r198 (caso, ok, detalle)
select '05 «rinde» heredado: varios códigos con el mismo nombre lo heredan todos (8002 y 8003 = 2)',
       (select array_agg(rinde_personas order by codigo) from public.pos_producto_ajustes where local = 'prueba-198' and codigo in ('8002', '8003')) = array[2, 2],
       pg_temp.ajustes('prueba-198');
insert into _r198 (caso, ok, detalle)
select '06 «rinde» heredado: cruce sin mayúsculas ni espacios y tope 20 (8005 = 20)',
       (select rinde_personas from public.pos_producto_ajustes where local = 'prueba-198' and codigo = '8005') = 20,
       pg_temp.ajustes('prueba-198');
insert into _r198 (caso, ok, detalle)
select '07 «rinde» 1 no deja fila, lo que no existe en el PoS no pasa, y lo heredado no trae categoría',
       pg_temp.ajustes('prueba-198') = '8001=5/- | 8002=2/- | 8003=2/- | 8005=20/-',
       pg_temp.ajustes('prueba-198');
insert into _r198 (caso, ok, detalle)
select '08 categoría heredada solo en códigos de las familias 11, 15 y 25',
       not exists (select 1 from public.pos_producto_ajustes a join public.pos_productos p using (local, codigo)
                    where a.categoria is not null and (p.familia is null or p.familia not in (11, 15, 25))),
       (select string_agg(a.codigo || '/' || coalesce(p.familia::text, 'null'), ',') from public.pos_producto_ajustes a
          join public.pos_productos p using (local, codigo) where a.categoria is not null and (p.familia is null or p.familia not in (11, 15, 25)));
insert into _r198 (caso, ok, detalle)
select '09 todo código de santa-teresa en las familias 11, 15 y 25 tiene su categoría (lista de 82 del 24-nov); el 192 va a menu_especial y ningún otro',
       not exists (select 1 from public.pos_productos p left join public.pos_producto_ajustes a using (local, codigo)
                    where p.local = 'santa-teresa' and p.familia in (11, 15, 25) and a.categoria is null)
       and not exists (select 1 from public.pos_producto_ajustes where categoria = 'menu_especial' and (local, codigo) <> ('santa-teresa', '192'))
       and coalesce((select a.categoria from public.pos_producto_ajustes a join public.pos_productos p using (local, codigo)
                      where p.local = 'santa-teresa' and p.codigo = '192' and p.familia = 11), 'menu_especial') = 'menu_especial',
       (select 'comida ' || count(*) filter (where categoria = 'comida') || ' · bebida ' || count(*) filter (where categoria = 'bebida')
               || ' · menu_especial ' || count(*) filter (where categoria = 'menu_especial') || ' · sin categoría en 11/15/25: '
               || (select coalesce(string_agg(p.codigo, ',' order by p.codigo), '-') from public.pos_productos p
                     left join public.pos_producto_ajustes a using (local, codigo)
                    where p.local = 'santa-teresa' and p.familia in (11, 15, 25) and a.categoria is null)
          from public.pos_producto_ajustes where local = 'santa-teresa');
insert into _r198 (caso, ok, detalle)
select '10 lo cargado por la migración no tiene autor (actualizado_por null)',
       not exists (select 1 from public.pos_producto_ajustes where actualizado_por is not null), null;
insert into _r198 (caso, ok, detalle)
select '11 familias de santa-teresa: las 24 de FAMILIAS_CATALOGO (netaVenta.ts), ni una más',
       (select array_agg(familia order by familia) from public.pos_familias where local = 'santa-teresa')
         = array[1, 2, 3, 4, 5, 6, 9, 11, 12, 13, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
       (select array_agg(familia order by familia)::text from public.pos_familias where local = 'santa-teresa');
insert into _r198 (caso, ok, detalle)
select '12 fuera de la venta = {6, 17, 20} (cortesia, personal, ingredientes), igual que FAMILIAS_NO_VENTA',
       (select array_agg(familia order by familia) from public.pos_familias
         where local = 'santa-teresa' and categoria in ('cortesia', 'personal', 'ingredientes')) = array[6, 17, 20], null;
insert into _r198 (caso, ok, detalle)
select '13 ningún producto de santa-teresa queda en una familia sin fila',
       not exists (select 1 from public.pos_productos p where p.local = 'santa-teresa' and p.familia is not null
                    and not exists (select 1 from public.pos_familias f where f.local = p.local and f.familia = p.familia)),
       null;
insert into _r198 (caso, ok, detalle)
select '14 la tabla de familias no acepta familia 17 en comida ni familia 3 en cortesia (23514)',
       pg_temp.intentar($$insert into public.pos_familias (local, familia, nombre, categoria) values ('prueba-198-x', 17, 'X', 'comida')$$) = '23514'
       and pg_temp.intentar($$insert into public.pos_familias (local, familia, nombre, categoria) values ('prueba-198-x', 3, 'X', 'cortesia')$$) = '23514',
       null;
insert into _r198 (caso, ok, detalle)
select '15 los nombres de familia marcados POR CONFIRMAR son, a lo sumo, los de 1, 9 y 27 (los de 11, 15 y 25 los marca el comentario)',
       coalesce((select array_agg(familia order by familia) from public.pos_familias where nombre like 'POR CONFIRMAR%'), '{}') <@ array[1, 9, 27],
       (select coalesce(string_agg(familia::text, ',' order by familia), '-') from public.pos_familias where nombre like 'POR CONFIRMAR%');
insert into _r198 (caso, ok, detalle)
select '16 una factura anulada también registra el producto (8006)',
       exists (select 1 from public.pos_productos where local = 'prueba-198' and codigo = '8006' and visto_desde = '2026-10-06'), null;

-- ═══ B. Disparador ═════════════════════════════════════════════════════════════════════════════════════════════════
insert into public.pos_familias (local, familia, nombre, categoria, orden) values
  ('prueba-198', 2, 'FICTICIA 2', 'comida', 10), ('prueba-198', 3, 'FICTICIA 3', 'comida', 20),
  ('prueba-198', 5, 'FICTICIA 5', 'bebida', 10), ('prueba-198', 12, 'FICTICIA 12', 'giftcard', 10),
  ('prueba-198', 17, 'FICTICIA 17', 'cortesia', 10), ('prueba-198', 6, 'FICTICIA 6', 'personal', 10),
  ('prueba-198', 20, 'FICTICIA 20', 'ingredientes', 10);
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, valor_servido_crc)
values ('prueba-198', 'A', '2026-11-20 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-198', 'B', '2026-11-22 12:00-06', 'C', 'delivery', 'cajero', false, 'ok', 0),
       ('prueba-198', 'V', '2026-11-10 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-198', 'X', '2026-11-21 12:00-06', 'X', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-198', 'S', '2026-11-21 13:00-06', 'C', 'salon', 'salonero', true, 'ok', 1234.5),
       ('prueba-198', 'N', '2026-11-23 23:30-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-198', 'M', '2026-11-24 00:10-06', 'C', 'salon', 'salonero', true, 'ok', 0);
-- Un lote (una sentencia): las líneas de A y de V. 9002 se vende en A (familia 5) y se regala en V (familia 17).
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, x.cod, x.nom, x.cant, x.monto, x.fam
from (values ('A', '9001', 'ROLL FICTICIO', 2, 7000, 3), ('A', '9002', 'TRAGO FICTICIO', 1, 3000, 5),
             ('A', null, 'SIN CODIGO', 1, 500, 22), ('A', '9003', 'CORTESIA FICTICIA', 1, 4000, 17),
             ('A', '9004', 'PERSONAL FICTICIO', 1, 2000, 6), ('A', '9005', 'ING FICTICIO', 1, 100.5, 20),
             ('A', ' 9006 ', 'CON ESPACIOS', 1, 0, null), ('A', '9007', 'TARJETA FICTICIA', 1, 10000, 12),
             ('A', '9008', 'PASO DE MENU FICTICIO', 3, 0, 5), ('A', '   ', 'CODIGO VACIO', 1, 0, 22),
             ('V', '9002', 'TRAGO FICTICIO', 1, 800, 17)) x(fac, cod, nom, cant, monto, fam)
join public.pos_ndf_tickets t on t.local = 'prueba-198' and t.numero_factura = x.fac;
insert into _r198 (caso, ok, detalle)
select '17 alta con la primera factura: los 8 códigos del lote, con nombre, familia y día',
       (select count(*) from public.pos_productos where local = 'prueba-198' and codigo like '900_') = 8
       and exists (select 1 from public.pos_productos where local = 'prueba-198' and codigo = '9001' and nombre = 'ROLL FICTICIO'
                    and familia = 3 and visto_desde = '2026-11-20' and visto_hasta = '2026-11-20'),
       (select string_agg(codigo || '=' || nombre || '/' || coalesce(familia::text, 'null') || '/' || visto_desde || '..' || visto_hasta, ' | ' order by codigo)
          from public.pos_productos where local = 'prueba-198' and codigo like '900_');
insert into _r198 (caso, ok, detalle)
select '18 dentro del mismo lote gana la factura más reciente (9002: familia 5 de A, no la 17 de V) y visto_* cubre las dos',
       exists (select 1 from public.pos_productos where local = 'prueba-198' and codigo = '9002' and familia = 5
                and visto_desde = '2026-11-10' and visto_hasta = '2026-11-20'), null;
insert into _r198 (caso, ok, detalle)
select '19 código con espacios se guarda limpio (9006); línea sin código o con código en blanco no entra',
       exists (select 1 from public.pos_productos where local = 'prueba-198' and codigo = '9006' and familia is null)
       and not exists (select 1 from public.pos_productos where local = 'prueba-198' and (nombre in ('SIN CODIGO', 'CODIGO VACIO') or codigo <> btrim(codigo))),
       null;
insert into _r198 (caso, ok, detalle)
select '20 código de más de 40 caracteres no entra al catálogo',
       not exists (select 1 from public.pos_productos where nombre = 'FICTICIO CODIGO LARGO'), null;
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '9001', 'ROLL FICTICIO NUEVO', 1, 3500, 3 from public.pos_ndf_tickets t where t.local = 'prueba-198' and t.numero_factura = 'B';
insert into _r198 (caso, ok, detalle)
select '21 nombre nuevo en una factura más reciente pisa el nombre y corre visto_hasta',
       (select nombre || ' ' || visto_desde || '..' || visto_hasta from public.pos_productos where local = 'prueba-198' and codigo = '9001')
         = 'ROLL FICTICIO NUEVO 2026-11-20..2026-11-22',
       (select nombre || ' ' || visto_desde || '..' || visto_hasta from public.pos_productos where local = 'prueba-198' and codigo = '9001');
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '9001', 'ROLL VIEJO', 1, 1000, 2 from public.pos_ndf_tickets t where t.local = 'prueba-198' and t.numero_factura = 'V';
insert into _r198 (caso, ok, detalle)
select '22 una factura vieja reingestada no pisa nombre ni familia, y sí corre visto_desde',
       (select nombre || '/' || familia || ' ' || visto_desde || '..' || visto_hasta from public.pos_productos where local = 'prueba-198' and codigo = '9001')
         = 'ROLL FICTICIO NUEVO/3 2026-11-10..2026-11-22',
       (select nombre || '/' || familia || ' ' || visto_desde || '..' || visto_hasta from public.pos_productos where local = 'prueba-198' and codigo = '9001');
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
select t.id, '9001', 'ROLL FICTICIO NUEVO', 1, case t.numero_factura when 'X' then 9999 when 'N' then 100 else 200 end, 3
from public.pos_ndf_tickets t where t.local = 'prueba-198' and t.numero_factura in ('X', 'N', 'M');
insert into _r198 (caso, ok, detalle)
select '23 otro local no se mezcla: ningún código del local ficticio aparece en otro local con su nombre',
       not exists (select 1 from public.pos_productos p join public.pos_productos q using (codigo, nombre)
                    where p.local = 'prueba-198' and q.local <> 'prueba-198'), null;
insert into _r198 (caso, ok, detalle)
select '24 un lote sin nada nuevo no escribe (absorber la factura B otra vez: 0 filas)',
       public.pos_catalogo_absorber(array(select id from public.pos_ndf_tickets where local = 'prueba-198' and numero_factura = 'B')) = 0, null;
insert into _r198 (caso, ok, detalle)
select '25 el disparador es AFTER INSERT por sentencia en pos_ndf_ticket_lines, con tabla de transición',
       exists (select 1 from pg_trigger tg where tg.tgrelid = 'public.pos_ndf_ticket_lines'::regclass
                and tg.tgname = 'trg_pos_catalogo_registrar' and not tg.tgisinternal
                and (tg.tgtype & 1) = 0 and (tg.tgtype & 2) = 0 and (tg.tgtype & 4) = 4 and tg.tgnewtable = 'nuevas'),
       null;

-- ═══ C. pos_ventas_productos (owner): cierre contra la 190 ═════════════════════════════════════════════════════════
create temp table _o198 on commit drop as
select pg_temp.vp(c.owner_id, c.loc, '2026-11-01', '2026-11-23') as j0,
       pg_temp.neta190(c.owner_id, c.loc, '2026-11-01', '2026-11-23') as n190
  from _c198 c;
grant select on _o198 to public;
insert into _r198 (caso, ok, detalle)
select '26 neta_cts del local ficticio = 2.633.450 céntimos (venta de A, B, V, N + la factura sin líneas; sin la anulada ni la del 24)',
       (j0->>'neta_cts')::numeric = 2633450, j0->>'neta_cts' from _o198;
insert into _r198 (caso, ok, detalle)
select '27 neta_cts = Σ dias[].neta_cts de pos_ventas_resumen (190), al céntimo',
       (j0->>'neta_cts')::numeric = n190, (j0->>'neta_cts') || ' vs ' || n190 from _o198;
insert into _r198 (caso, ok, detalle)
select '28 Σ meses = Σ productos (monto)',
       (select sum((e->>4)::numeric) from jsonb_array_elements(j0->'meses') e) = (select sum((e->>5)::numeric) from jsonb_array_elements(j0->'productos') e),
       null from _o198;
insert into _r198 (caso, ok, detalle)
select '29 la factura sin líneas va a sin_lineas con su valor servido (1 factura, 123.450 céntimos)',
       j0->'sin_lineas' = '{"facturas": 1, "cts": 123450}'::jsonb, (j0->'sin_lineas')::text from _o198;
insert into _r198 (caso, ok, detalle)
select '30 la anulada no cuenta: Σ productos = 3.200.050 (ninguna fila trae los 9.999 de X)',
       (select sum((e->>5)::numeric) from jsonb_array_elements(j0->'productos') e) = 3200050, null from _o198;
insert into _r198 (caso, ok, detalle)
select '31 corte del día CR: la de las 23:30 entra (9001 salón familia 3 = 710.000, 3 unidades, 2 facturas) y la de las 00:10 del 24 no',
       pg_temp.fila(j0, '9001', 3, 'salon') = '["9001", "ROLL FICTICIO NUEVO", 3, "salon", 3, 710000, 2, "comida", 0]'::jsonb,
       pg_temp.fila(j0, '9001', 3, 'salon')::text from _o198;
insert into _r198 (caso, ok, detalle)
select '32 una fila por (código, familia de la línea, canal): 9001 en 3 filas, 9002 en 2; 13 filas en total (las dos sin código, por nombre)',
       jsonb_array_length(j0->'productos') = 13
       and (select count(*) from jsonb_array_elements(j0->'productos') e where e->>0 = '9001') = 3
       and (select count(*) from jsonb_array_elements(j0->'productos') e where e->>0 = '9002') = 2,
       jsonb_array_length(j0->'productos')::text from _o198;
insert into _r198 (caso, ok, detalle)
select '33 la línea sin código sale con codigo null, agrupada por nombre (50.000, familia 22 sin fila → otros)',
       exists (select 1 from jsonb_array_elements(j0->'productos') e
                where e->0 = 'null'::jsonb and e->>1 = 'SIN CODIGO' and (e->>5)::numeric = 50000 and e->>7 = 'otros'), null from _o198;
insert into _r198 (caso, ok, detalle)
select '34 unidades en ₡0: el paso de menú 3 y 3 en cero; un producto vendido, 0; la línea sin familia en ₡0, 1 y 1',
       (pg_temp.fila(j0, '9008', 5, 'salon')->>4)::int = 3 and (pg_temp.fila(j0, '9008', 5, 'salon')->>8)::int = 3
       and (pg_temp.fila(j0, '9001', 3, 'salon')->>8)::int = 0
       and (pg_temp.fila(j0, '9006', null, 'salon')->>4)::int = 1 and (pg_temp.fila(j0, '9006', null, 'salon')->>8)::int = 1,
       null from _o198;
insert into _r198 (caso, ok, detalle)
select '35 categoría efectiva sin ajustes: la de la familia; 6/17/20 → personal/cortesia/ingredientes; 12 → giftcard; sin familia → otros',
       pg_temp.fila(j0, '9002', 5, 'salon')->>7 = 'bebida' and pg_temp.fila(j0, '9002', 17, 'salon')->>7 = 'cortesia'
       and pg_temp.fila(j0, '9003', 17, 'salon')->>7 = 'cortesia' and pg_temp.fila(j0, '9004', 6, 'salon')->>7 = 'personal'
       and pg_temp.fila(j0, '9005', 20, 'salon')->>7 = 'ingredientes' and pg_temp.fila(j0, '9007', 12, 'salon')->>7 = 'giftcard'
       and pg_temp.fila(j0, '9006', null, 'salon')->>7 = 'otros' and pg_temp.fila(j0, '9001', 2, 'salon')->>7 = 'comida',
       null from _o198;
insert into _r198 (caso, ok, detalle)
select '36 la venta por categoría cierra: Σ productos de venta + sin_lineas = neta_cts (y lo mismo en meses)',
       pg_temp.venta_cat(j0, 'productos') + (j0->'sin_lineas'->>'cts')::numeric = (j0->>'neta_cts')::numeric
       and pg_temp.venta_cat(j0, 'meses') + (j0->'sin_lineas'->>'cts')::numeric = (j0->>'neta_cts')::numeric,
       pg_temp.venta_cat(j0, 'productos') || ' + ' || (j0->'sin_lineas'->>'cts') || ' vs ' || (j0->>'neta_cts') from _o198;
insert into _r198 (caso, ok, detalle)
select '37 catálogo: lo vendido más lo visto 90 días antes (8001–8006 de octubre), con «rinde» y nombre vigente; sin el código largo',
       jsonb_array_length(j0->'catalogo') = 14
       and exists (select 1 from jsonb_array_elements(j0->'catalogo') e where e->>0 = '8005' and (e->>3)::int = 20)
       and exists (select 1 from jsonb_array_elements(j0->'catalogo') e where e->>0 = '9001' and e->>1 = 'ROLL FICTICIO NUEVO' and (e->>2)::int = 3
                    and e->>5 = '2026-11-24' and e->>6 = 'comida'),
       jsonb_array_length(j0->'catalogo')::text from _o198;
insert into _r198 (caso, ok, detalle)
select '38 forma: seis claves; productos de 9, meses de 6, catálogo de 7 y familias de 4 elementos',
       (select array_agg(k order by k) from jsonb_object_keys(j0) k) = array['catalogo', 'familias', 'meses', 'neta_cts', 'productos', 'sin_lineas']
       and not exists (select 1 from jsonb_array_elements(j0->'productos') e where jsonb_array_length(e) <> 9)
       and not exists (select 1 from jsonb_array_elements(j0->'meses') e where jsonb_array_length(e) <> 6)
       and not exists (select 1 from jsonb_array_elements(j0->'catalogo') e where jsonb_array_length(e) <> 7)
       and not exists (select 1 from jsonb_array_elements(j0->'familias') e where jsonb_array_length(e) <> 4)
       and jsonb_array_length(j0->'familias') = 7,
       null from _o198;
insert into _r198 (caso, ok, detalle)
select '39 validaciones: 732 días, rango invertido y nulos → 22023; 731 días anda',
       pg_temp.err_como(c.owner_id, format('public.pos_ventas_productos(%L, date %L, date %L)', 'santa-teresa', '2024-11-22', '2026-11-23')) = '22023'
       and pg_temp.err_como(c.owner_id, format('public.pos_ventas_productos(%L, date %L, date %L)', 'santa-teresa', '2026-11-23', '2026-11-22')) = '22023'
       and pg_temp.err_como(c.owner_id, 'public.pos_ventas_productos(null, date ''2026-11-01'', date ''2026-11-02'')') = '22023'
       and pg_temp.err_como(c.owner_id, 'public.pos_ventas_productos(''santa-teresa'', null, date ''2026-11-02'')') = '22023'
       and pg_temp.err_como(c.owner_id, 'public.pos_catalogo_productos(null)') = '22023',
       null from _c198 c;
-- Con los datos de la base (staging): el cierre contra la 190 en cuatro períodos y un año.
select set_config('p198.t_vp', clock_timestamp()::text, true);
create temp table _st198 on commit drop as
select pg_temp.vp(c.owner_id, 'santa-teresa', '2025-11-24', '2026-11-23') as anio from _c198 c;
insert into _m198 values ('ventas_productos_1_anio_ms', round(extract(epoch from clock_timestamp() - current_setting('p198.t_vp')::timestamptz) * 1000)::text);
select set_config('p198.t_190', clock_timestamp()::text, true);
insert into _m198 select 'neta_190_1_anio', pg_temp.neta190(c.owner_id, 'santa-teresa', '2025-11-24', '2026-11-23')::text from _c198 c;
insert into _m198 values ('ventas_resumen_190_1_anio_ms', round(extract(epoch from clock_timestamp() - current_setting('p198.t_190')::timestamptz) * 1000)::text);
insert into _m198 select 'ventas_productos_1_anio_forma', 'productos=' || jsonb_array_length(anio->'productos') || ' meses=' || jsonb_array_length(anio->'meses')
       || ' catalogo=' || jsonb_array_length(anio->'catalogo') || ' sin_lineas=' || (anio->'sin_lineas'->>'facturas') || ' bytes=' || length(anio::text) from _st198;
select set_config('p198.t_731', clock_timestamp()::text, true);
insert into _m198 select 'ventas_productos_731_dias_bytes', length(pg_temp.vp(c.owner_id, 'santa-teresa', '2024-11-24', '2026-11-23')::text)::text from _c198 c;
insert into _m198 values ('ventas_productos_731_dias_ms', round(extract(epoch from clock_timestamp() - current_setting('p198.t_731')::timestamptz) * 1000)::text);
insert into _r198 (caso, ok, detalle)
select format('%s santa-teresa %s (%s..%s): neta_cts = la 190 al céntimo', x.n, x.que, x.d, x.h),
       (pg_temp.vp(c.owner_id, 'santa-teresa', x.d, x.h)->>'neta_cts')::numeric = pg_temp.neta190(c.owner_id, 'santa-teresa', x.d, x.h),
       (pg_temp.vp(c.owner_id, 'santa-teresa', x.d, x.h)->>'neta_cts') || ' vs ' || pg_temp.neta190(c.owner_id, 'santa-teresa', x.d, x.h)
  from _c198 c, (values (1, '40', 'ayer', date '2026-11-23', date '2026-11-23'),
                        (2, '41', 'mes a la fecha', date '2026-11-01', date '2026-11-23'),
                        (3, '42', 'último mes cerrado', date '2026-10-01', date '2026-10-31')) x(i, n, que, d, h)
 order by x.i;
insert into _r198 (caso, ok, detalle)
select '43 santa-teresa un año (2025-11-24..2026-11-23): neta_cts = la 190 al céntimo',
       (anio->>'neta_cts')::numeric = (select v::numeric from _m198 where k = 'neta_190_1_anio'),
       (anio->>'neta_cts') || ' vs ' || (select v from _m198 where k = 'neta_190_1_anio') from _st198;
insert into _r198 (caso, ok, detalle)
select '44 santa-teresa un año: Σ meses = Σ productos y la venta por categoría + sin_lineas = neta_cts',
       (select coalesce(sum((e->>4)::numeric), 0) from jsonb_array_elements(anio->'meses') e) = (select coalesce(sum((e->>5)::numeric), 0) from jsonb_array_elements(anio->'productos') e)
       and pg_temp.venta_cat(anio, 'productos') + (anio->'sin_lineas'->>'cts')::numeric = (anio->>'neta_cts')::numeric
       and pg_temp.venta_cat(anio, 'meses') + (anio->'sin_lineas'->>'cts')::numeric = (anio->>'neta_cts')::numeric,
       null from _st198;
insert into _m198 select 'santa_teresa_1_anio_por_categoria', (select string_agg(cat || ' ' || cts, ' · ' order by cat) from (
         select e->>7 as cat, sum((e->>5)::numeric) as cts from jsonb_array_elements(anio->'productos') e group by 1) x) from _st198;

-- ═══ D. «Rinde» y categoría por código: la categoría NUNCA mueve la venta neta ═══════════════════════════════════
insert into _a198 select 'g45', coalesce(pg_temp.guardar(c.owner_id, c.loc, ' 9002 ', 6, 'comida'), 'ok') from _c198 c;
insert into _r198 (caso, ok, detalle)
select '45 owner guarda los dos valores juntos (código con espacios) y queda quién lo guardó',
       (select v from _a198 where k = 'g45') = 'ok'
       and (select rinde_personas = 6 and categoria = 'comida' and actualizado_por = c.owner_id
              from public.pos_producto_ajustes where local = c.loc and codigo = '9002'),
       pg_temp.ajustes(c.loc) from _c198 c;
update _o198 set j0 = pg_temp.vp(c.owner_id, c.loc, '2026-11-01', '2026-11-23') from _c198 c;
insert into _r198 (caso, ok, detalle)
select '46 con la categoría cargada: 9002 vendido → comida; 9002 regalado (familia 17) sigue cortesia',
       pg_temp.fila(j0, '9002', 5, 'salon')->>7 = 'comida' and pg_temp.fila(j0, '9002', 17, 'salon')->>7 = 'cortesia', null from _o198;
insert into _r198 (caso, ok, detalle)
select '47 la neta no cambia con la categoría: sigue en 2.633.450 y = la 190',
       (j0->>'neta_cts')::numeric = 2633450 and (j0->>'neta_cts')::numeric = n190, (j0->>'neta_cts') || ' vs ' || n190 from _o198;
insert into _r198 (caso, ok, detalle)
select '48 con la categoría cargada, la venta por categoría + sin_lineas = neta_cts (productos y meses)',
       pg_temp.venta_cat(j0, 'productos') + (j0->'sin_lineas'->>'cts')::numeric = (j0->>'neta_cts')::numeric
       and pg_temp.venta_cat(j0, 'meses') + (j0->'sin_lineas'->>'cts')::numeric = (j0->>'neta_cts')::numeric, null from _o198;
insert into _r198 (caso, ok, detalle)
select '49 reparto: comida 1.460.000 · bebida 0 (el trago pasó a comida; el paso de menú en ₡0 sigue en bebida)',
       pg_temp.por_cat(j0, 'comida') = 1460000 and pg_temp.por_cat(j0, 'bebida') = 0,
       'comida ' || pg_temp.por_cat(j0, 'comida') || ' · bebida ' || pg_temp.por_cat(j0, 'bebida') from _o198;
insert into _r198 (caso, ok, detalle)
select '50 el catálogo de la lectura trae «rinde» 6 y categoría comida para 9002',
       exists (select 1 from jsonb_array_elements(j0->'catalogo') e where e->>0 = '9002' and (e->>3)::int = 6 and e->>6 = 'comida'), null from _o198;
insert into _a198 select 'g51', coalesce(pg_temp.guardar(c.owner_id, c.loc, '9001', 1, 'menu_especial'), 'ok') from _c198 c;
insert into _r198 (caso, ok, detalle)
select '51 menu_especial: 9001 pasa entero (sus 3 filas, 1.160.000), su plata sigue en la neta y = la 190',
       (select v from _a198 where k = 'g51') = 'ok'
       and pg_temp.por_cat(pg_temp.vp(c.owner_id, c.loc, '2026-11-01', '2026-11-23'), 'menu_especial') = 1160000
       and (pg_temp.vp(c.owner_id, c.loc, '2026-11-01', '2026-11-23')->>'neta_cts')::numeric = 2633450
       and (pg_temp.vp(c.owner_id, c.loc, '2026-11-01', '2026-11-23')->>'neta_cts')::numeric = pg_temp.neta190(c.owner_id, c.loc, '2026-11-01', '2026-11-23'),
       'menu_especial ' || pg_temp.por_cat(pg_temp.vp(c.owner_id, c.loc, '2026-11-01', '2026-11-23'), 'menu_especial') from _c198 c;
insert into _r198 (caso, ok, detalle)
select '52 con menu_especial, la venta por categoría + sin_lineas sigue = neta_cts (productos y meses)',
       pg_temp.venta_cat(j, 'productos') + (j->'sin_lineas'->>'cts')::numeric = (j->>'neta_cts')::numeric
       and pg_temp.venta_cat(j, 'meses') + (j->'sin_lineas'->>'cts')::numeric = (j->>'neta_cts')::numeric, null
  from (select pg_temp.vp(c.owner_id, c.loc, '2026-11-01', '2026-11-23') j from _c198 c) x;
insert into _r198 (caso, ok, detalle)
select format('%s guardar la categoría «%s» → 22023', x.n, x.cat), pg_temp.guardar(c.owner_id, c.loc, '9002', 6, x.cat) = '22023',
       pg_temp.guardar(c.owner_id, c.loc, '9002', 6, x.cat)
  from _c198 c, (values (1, '53', 'cortesia'), (2, '54', 'personal'), (3, '55', 'ingredientes'), (4, '56', 'pax'), (5, '57', 'giftcard'),
                        (6, '58', 'duenos'), (7, '59', 'COMIDA'), (8, '60', '')) x(i, n, cat)
 order by x.i;
insert into _r198 (caso, ok, detalle)
select format('%s cambiarle la categoría a un producto de %s → 22023', x.n, x.que), pg_temp.guardar(c.owner_id, c.loc, x.cod, 1, x.cat) = '22023',
       pg_temp.guardar(c.owner_id, c.loc, x.cod, 1, x.cat)
  from _c198 c, (values (1, '61', 'cortesía (17)', '9003', 'comida'), (2, '62', 'personal (6)', '9004', 'comida'),
                        (3, '63', 'ingredientes (20)', '9005', 'bebida'), (4, '64', 'gift card (12)', '9007', 'comida')) x(i, n, que, cod, cat)
 order by x.i;
insert into _r198 (caso, ok, detalle)
select '65 el «rinde» de un producto de cortesía sí se puede guardar (categoría null)',
       pg_temp.guardar(c.owner_id, c.loc, '9003', 2, null) is null, null from _c198 c;
insert into _r198 (caso, ok, detalle)
select '66 ninguno de los intentos rechazados dejó nada guardado',
       pg_temp.ajustes(c.loc) = '8001=5/- | 8002=2/- | 8003=2/- | 8005=20/- | 9001=1/menu_especial | 9002=6/comida | 9003=2/-',
       pg_temp.ajustes(c.loc) from _c198 c;
insert into _r198 (caso, ok, detalle)
select '67 «rinde» 21, 0 o null → 22023',
       pg_temp.guardar(c.owner_id, c.loc, '9002', 21, null) = '22023' and pg_temp.guardar(c.owner_id, c.loc, '9002', 0, null) = '22023'
       and pg_temp.guardar(c.owner_id, c.loc, '9002', null, null) = '22023', null from _c198 c;
insert into _r198 (caso, ok, detalle)
select '68 código desconocido o en blanco → 22023',
       pg_temp.guardar(c.owner_id, c.loc, '9999', 2, null) = '22023' and pg_temp.guardar(c.owner_id, c.loc, '  ', 2, null) = '22023', null from _c198 c;
insert into _a198 select 'g69', coalesce(pg_temp.guardar(c.owner_id, c.loc, '9006', 1, 'bebida'), 'ok') from _c198 c;
insert into _r198 (caso, ok, detalle)
select '69 un producto sin familia puede tomar una categoría (9006 → bebida)',
       (select v from _a198 where k = 'g69') = 'ok'
       and pg_temp.fila(pg_temp.vp(c.owner_id, c.loc, '2026-11-01', '2026-11-23'), '9006', null, 'salon')->>7 = 'bebida', null from _c198 c;
insert into _r198 (caso, ok, detalle)
select '70 pos_catalogo_productos: todo el catálogo del local, filas de 8, categoría vigente y propia, y las dos listas',
       jsonb_array_length(j->'productos') = 14
       and not exists (select 1 from jsonb_array_elements(j->'productos') e where jsonb_array_length(e) <> 8)
       and exists (select 1 from jsonb_array_elements(j->'productos') e where e->>0 = '9002' and e->>3 = 'comida' and e->>4 = 'comida' and (e->>5)::int = 6)
       and exists (select 1 from jsonb_array_elements(j->'productos') e where e->>0 = '9004' and e->>3 = 'personal' and e->4 = 'null'::jsonb and (e->>5)::int = 1)
       and j->'categorias_editables' = '["comida", "bebida", "menu_especial", "extras", "merch", "otros"]'::jsonb
       and j->'categorias_fijas' = '["giftcard", "pax", "duenos", "cortesia", "personal", "ingredientes"]'::jsonb
       and jsonb_array_length(j->'familias') = 7,
       left(j::text, 300)
  from (select pg_temp.como(c.owner_id, format('public.pos_catalogo_productos(%L)', c.loc)) j from _c198 c) x;
insert into _r198 (caso, ok, detalle)
select '71 la neta después de todos los guardados sigue = 2.633.450 = la 190, y la venta por categoría cierra',
       (j->>'neta_cts')::numeric = 2633450 and (j->>'neta_cts')::numeric = (select n190 from _o198)
       and pg_temp.venta_cat(j, 'productos') + (j->'sin_lineas'->>'cts')::numeric = (j->>'neta_cts')::numeric,
       j->>'neta_cts' from (select pg_temp.vp(c.owner_id, c.loc, '2026-11-01', '2026-11-23') j from _c198 c) x;
insert into _a198 select 'g72a', coalesce(pg_temp.guardar(c.owner_id, c.loc, '9002', 1, null), 'ok') from _c198 c;
insert into _a198 select 'g72b', coalesce(pg_temp.guardar(c.owner_id, c.loc, '9003', 1, null), 'ok') from _c198 c;
insert into _r198 (caso, ok, detalle)
select '72 todo por defecto (rinde 1, categoría null) borra la fila',
       (select string_agg(v, ',' order by k) from _a198 where k in ('g72a', 'g72b')) = 'ok,ok'
       and pg_temp.ajustes(c.loc) = '8001=5/- | 8002=2/- | 8003=2/- | 8005=20/- | 9001=1/menu_especial | 9006=1/bebida',
       pg_temp.ajustes(c.loc) from _c198 c;
insert into _r198 (caso, ok, detalle)
select '73 por debajo de la función, la tabla tampoco acepta cortesia, una categoría fuera de la lista ni una fila vacía (23514)',
       pg_temp.intentar($$insert into public.pos_producto_ajustes (local, codigo, categoria) values ('prueba-198', '9002', 'cortesia')$$) = '23514'
       and pg_temp.intentar($$insert into public.pos_producto_ajustes (local, codigo, categoria) values ('prueba-198', '9002', 'giftcard')$$) = '23514'
       and pg_temp.intentar($$insert into public.pos_producto_ajustes (local, codigo) values ('prueba-198', '9002')$$) = '23514'
       and pg_temp.intentar($$insert into public.pos_producto_ajustes (local, codigo, rinde_personas) values ('prueba-198', '9002', 21)$$) = '23514',
       null;
insert into _r198 (caso, ok, detalle)
select '74 un ajuste solo puede colgar de un producto del catálogo (clave foránea, 23503)',
       pg_temp.intentar($$insert into public.pos_producto_ajustes (local, codigo, rinde_personas) values ('prueba-198', '9999', 2)$$) = '23503', null;

-- ═══ E. Permisos ═══════════════════════════════════════════════════════════════════════════════════════════════════
insert into _r198 (caso, ok, detalle)
select '75 contador: lee la función, el catálogo y las tablas (todos los locales)',
       pg_temp.err_como(c.contador, format('public.pos_ventas_productos(%L, date %L, date %L)', c.loc, '2026-11-23', '2026-11-23')) is null
       and jsonb_array_length(pg_temp.como(c.contador, format('public.pos_catalogo_productos(%L)', c.loc))->'productos') = 14
       and (pg_temp.como(c.contador, '(select count(*) from public.pos_productos)'))::int = (select count(*) from public.pos_productos)
       and (pg_temp.como(c.contador, '(select count(*) from public.pos_familias)'))::int = (select count(*) from public.pos_familias)
       and (pg_temp.como(c.contador, '(select count(*) from public.pos_producto_ajustes)'))::int = (select count(*) from public.pos_producto_ajustes),
       null from _c198 c;
insert into _a198 select 'g76', concat_ws(',', pg_temp.guardar(c.contador, c.loc, '9002', 2, null), pg_temp.guardar(c.contador, c.loc, '9004', 1, null),
                                   pg_temp.guardar(c.contador, c.loc, '8004', 1, 'comida')) from _c198 c;
insert into _r198 (caso, ok, detalle)
select '76 contador no guarda «rinde» ni categoría (42501) y no queda nada',
       (select v from _a198 where k = 'g76') = '42501,42501,42501'
       and not exists (select 1 from public.pos_producto_ajustes where local = c.loc and codigo in ('9002', '8004')), null from _c198 c;
insert into _a198 select 'g77', coalesce(pg_temp.guardar(c.manager, c.loc, '8004', 2, 'bebida'), 'ok') from _c198 c;
insert into _r198 (caso, ok, detalle)
select '77 manager en su local: lee la función y el catálogo, y guarda (queda su id)',
       pg_temp.err_como(c.manager, format('public.pos_ventas_productos(%L, date %L, date %L)', c.loc, '2026-11-23', '2026-11-23')) is null
       and jsonb_array_length(pg_temp.como(c.manager, format('public.pos_catalogo_productos(%L)', c.loc))->'productos') = 14
       and (select v from _a198 where k = 'g77') = 'ok'
       and (select rinde_personas = 2 and categoria = 'bebida' and actualizado_por = c.manager from public.pos_producto_ajustes where local = c.loc and codigo = '8004'),
       null from _c198 c;
insert into _r198 (caso, ok, detalle)
select '78 manager en su local: por las tablas ve solo su local',
       (pg_temp.como(c.manager, '(select count(*) from public.pos_productos)'))::int = (select count(*) from public.pos_productos where local = c.loc)
       and (pg_temp.como(c.manager, '(select count(distinct local) from public.pos_familias)'))::int = 1
       and (pg_temp.como(c.manager, '(select count(*) from public.pos_producto_ajustes)'))::int = (select count(*) from public.pos_producto_ajustes where local = c.loc),
       null from _c198 c;
insert into _r198 (caso, ok, detalle)
select '79 manager de otro local: pos_ventas_productos del local ajeno → 42501',
       pg_temp.err_como(c.manager_otro, format('public.pos_ventas_productos(%L, date %L, date %L)', c.loc, '2026-11-23', '2026-11-23')) = '42501'
       and pg_temp.err_como(c.manager_otro, format('public.pos_ventas_productos(%L, date %L, date %L)', 'santa-teresa', '2026-11-23', '2026-11-23')) is null,
       null from _c198 c;
insert into _r198 (caso, ok, detalle)
select '80 manager de otro local: catálogo del local ajeno → 42501',
       pg_temp.err_como(c.manager_otro, format('public.pos_catalogo_productos(%L)', c.loc)) = '42501', null from _c198 c;
insert into _a198 select 'g81', pg_temp.guardar(c.manager_otro, c.loc, '9002', 2, 'comida') from _c198 c;
insert into _r198 (caso, ok, detalle)
select '81 manager de otro local: guardar en el local ajeno → 42501 y no queda nada',
       (select v from _a198 where k = 'g81') = '42501'
       and not exists (select 1 from public.pos_producto_ajustes where local = c.loc and codigo = '9002'), null from _c198 c;
insert into _r198 (caso, ok, detalle)
select '82 manager de otro local: 0 filas del local ajeno en las tres tablas',
       (pg_temp.como(c.manager_otro, format('(select count(*) from public.pos_productos where local = %L)', c.loc)))::int = 0
       and (pg_temp.como(c.manager_otro, format('(select count(*) from public.pos_familias where local = %L)', c.loc)))::int = 0
       and (pg_temp.como(c.manager_otro, format('(select count(*) from public.pos_producto_ajustes where local = %L)', c.loc)))::int = 0,
       null from _c198 c;
insert into _r198 (caso, ok, detalle)
select format('%s %s: función, catálogo y guardado → 42501; 0 filas en las tablas', x.n, x.que),
       pg_temp.err_como(x.uid, 'public.pos_ventas_productos(''santa-teresa'', date ''2026-11-23'', date ''2026-11-23'')') = '42501'
       and pg_temp.err_como(x.uid, 'public.pos_catalogo_productos(''santa-teresa'')') = '42501'
       and pg_temp.guardar(x.uid, 'prueba-198', '9002', 2, null) = '42501'
       and coalesce(pg_temp.err_como(x.uid, '(select count(*) from public.pos_productos)'), '0') in ('0', '42501')
       and (x.uid is null or (pg_temp.como(x.uid, '(select count(*) from public.pos_productos) + (select count(*) from public.pos_familias) + (select count(*) from public.pos_producto_ajustes)'))::int = 0),
       null
  from _c198 c, lateral (values (1, '83', 'salonero', c.salonero), (2, '84', 'cajero', c.cajero), (3, '85', 'sin sesión (anon)', null::uuid)) x(i, n, que, uid)
 order by x.i;
insert into _r198 (caso, ok, detalle)
select '86 anon sin execute ni select; authenticated sin execute en las internas (absorber, refrescar, categoría, disparador)',
       not has_function_privilege('anon', 'public.pos_ventas_productos(text,date,date)', 'execute')
       and not has_function_privilege('anon', 'public.pos_catalogo_productos(text)', 'execute')
       and not has_function_privilege('anon', 'public.pos_producto_ajuste_guardar(text,text,integer,text)', 'execute')
       and not has_table_privilege('anon', 'public.pos_productos', 'select')
       and not has_table_privilege('anon', 'public.pos_familias', 'select')
       and not has_table_privilege('anon', 'public.pos_producto_ajustes', 'select')
       and not has_function_privilege('authenticated', 'public.pos_categoria_efectiva(integer,text,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.pos_catalogo_absorber(uuid[])', 'execute')
       and not has_function_privilege('authenticated', 'public.pos_catalogo_refrescar(text)', 'execute')
       and not has_function_privilege('authenticated', 'public.pos_catalogo_registrar()', 'execute'),
       null;
insert into _r198 (caso, ok, detalle)
select '87 ni el owner llama las internas por la API (42501)',
       pg_temp.err_como(c.owner_id, 'public.pos_categoria_efectiva(3, ''comida'', null)') = '42501'
       and pg_temp.err_como(c.owner_id, 'public.pos_catalogo_refrescar(''santa-teresa'')') = '42501'
       and pg_temp.err_como(c.owner_id, 'public.pos_catalogo_absorber(array[]::uuid[])') = '42501', null from _c198 c;
insert into _r198 (caso, ok, detalle)
select '88 nadie escribe las tablas por la API, ni el owner (insert, update y delete → 42501)',
       pg_temp.err_como(c.owner_id, format('insert into public.pos_producto_ajustes (local, codigo, rinde_personas) values (%L, %L, 3)', c.loc, '9002'), true) = '42501'
       and pg_temp.err_como(c.owner_id, format('update public.pos_productos set nombre = %L where local = %L', 'HACK', c.loc), true) = '42501'
       and pg_temp.err_como(c.owner_id, format('delete from public.pos_familias where local = %L', c.loc), true) = '42501'
       and pg_temp.err_como(c.manager, format('update public.pos_producto_ajustes set rinde_personas = 9 where local = %L', c.loc), true) = '42501'
       and not exists (select 1 from public.pos_productos where nombre = 'HACK'), null from _c198 c;

-- ═══ F. El catálogo roto no frena la ingesta ═══════════════════════════════════════════════════════════════════════
-- Se rompe la escritura del catálogo (una restricción que ninguna fila cumple): el disparador avisa y la factura entra.
alter table public.pos_productos add constraint _roto_198 check (false) not valid;
insert into _a198 select 'i89', pg_temp.intentar($$insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
                          select t.id, '9050', 'ENTRA IGUAL', 1, 1, 3 from public.pos_ndf_tickets t where t.local = 'prueba-198' and t.numero_factura = 'B'$$);
insert into _r198 (caso, ok, detalle)
select '89 la ingesta entra con el catálogo roto: la línea se guarda y el producto no',
       (select v from _a198 where k = 'i89') = '1'
       and exists (select 1 from public.pos_ndf_ticket_lines where codigo_producto = '9050')
       and not exists (select 1 from public.pos_productos where codigo = '9050'), null;
alter table public.pos_productos drop constraint _roto_198;
insert into _a198 select 'r90', public.pos_catalogo_refrescar('prueba-198')::text;
insert into _r198 (caso, ok, detalle)
select '90 pos_catalogo_refrescar repara lo que el disparador no pudo escribir (1 fila)',
       (select v from _a198 where k = 'r90') = '1' and exists (select 1 from public.pos_productos where local = 'prueba-198' and codigo = '9050'), null;

-- ═══ G. Vuelta atrás ═══════════════════════════════════════════════════════════════════════════════════════════════
select set_config('p198.t_rb', clock_timestamp()::text, true);
-- @@198_rollback@@
insert into _m198 values ('rollback_ms', round(extract(epoch from clock_timestamp() - current_setting('p198.t_rb')::timestamptz) * 1000)::text);
insert into _r198 (caso, ok, detalle)
select '91 después de 198_rollback.sql no queda ninguna de las tres tablas ni de las siete funciones',
       to_regclass('public.pos_familias') is null and to_regclass('public.pos_productos') is null and to_regclass('public.pos_producto_ajustes') is null
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                        and p.proname in ('pos_catalogo_absorber', 'pos_catalogo_registrar', 'pos_catalogo_refrescar', 'pos_categoria_efectiva',
                                          'pos_ventas_productos', 'pos_catalogo_productos', 'pos_producto_ajuste_guardar')),
       null;
insert into _r198 (caso, ok, detalle)
select '92 después de la vuelta atrás pos_ndf_ticket_lines no tiene el disparador y la 190 sigue respondiendo',
       not exists (select 1 from pg_trigger where tgrelid = 'public.pos_ndf_ticket_lines'::regclass and tgname = 'trg_pos_catalogo_registrar')
       and pg_temp.neta190(c.owner_id, c.loc, '2026-11-01', '2026-11-23') = 2633450 + 100,
       null from _c198 c;

select n, caso, case when ok then 'OK' else 'FALLA' end as resultado, left(coalesce(detalle, ''), 300) as detalle from _r198 order by n;
select json_build_object(
  'ok', (select count(*) from _r198 where ok), 'fallas', (select count(*) from _r198 where ok is not true),
  'fallaron', (select json_agg(json_build_array(left(caso, 2), left(coalesce(detalle, ''), 200)) order by n) from _r198 where ok is not true),
  'detalles', (select json_object_agg(left(caso, 2), left(detalle, 200)) from _r198 where left(caso, 2) in ('01', '09', '40', '41', '42', '43')),
  'mediciones', (select json_object_agg(k, v) from _m198)) as resultado;
rollback;
