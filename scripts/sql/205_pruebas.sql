-- 205_pruebas · catálogo del PoS: falla del disparador visible y reparable (mig 205, hallazgo 256). Transacción que
-- termina en ROLLBACK: no deja nada. LOCAL FICTICIO ('prueba-205') y usuarios, facturas y productos inventados
-- («FICTICIO …»); una factura ficticia en santa-teresa para el caso del local ajeno. Corre en un Postgres 16 local
-- descartable o en STAGING (ref hwiatgic…). Nunca contra PROD.
-- Se arma y se corre con scripts/sql/205_pruebas.py (--armar [--mutar X] [--local] | --psql "<conexión>" [--local]
-- [--mutar todas]). Base: la 198 tal cual (= prod) ya aplicada; la batería aplica la 205 dentro de la transacción.
-- MARCADORES: «@@preludio@@» → 205_preludio_local.sql (solo --local) · «@@205@@» → supabase/migrations/205_…sql (con
-- --mutar, roto a propósito) · «@@205_texto@@» → la 205 como texto (guarda; rota solo en mutaciones `guarda_*`) ·
-- «@@205_rollback@@» → scripts/sql/205_rollback.sql como texto.
begin;
-- @@preludio@@
create temp table _r205 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _a205 (k text primary key, v text) on commit drop;
grant all on _r205, _a205 to public;
grant usage on sequence _r205_n_seq to public;

-- ── Datos ficticios ──────────────────────────────────────────────────────────────────────────────────────────────
create temp table _c205 on commit drop as
select '00000000-0000-4000-8205-0000000000b1'::uuid as owner_id,
       '00000000-0000-4000-8205-0000000000a1'::uuid as manager,      -- manager de prueba-205
       '00000000-0000-4000-8205-0000000000a2'::uuid as manager_otro, -- manager de santa-teresa (local ajeno)
       '00000000-0000-4000-8205-0000000000d1'::uuid as contador,
       '00000000-0000-4000-8205-0000000000e1'::uuid as salonero,
       '00000000-0000-4000-8205-0000000000e2'::uuid as cajero,
       'prueba-205'::text as loc;
grant select on _c205 to public;
insert into public.locations (id, name, is_active) values ('prueba-205', 'Local de prueba 205', false) on conflict (id) do nothing;
insert into auth.users (id, raw_user_meta_data)
select x, '{"full_name":"Ficticio 205"}'::jsonb
  from _c205 c, unnest(array[c.owner_id, c.manager, c.manager_otro, c.contador, c.salonero, c.cajero]) x;
update public.profiles p set role = r.rol::public.user_role, is_active = true
  from _c205 c, (values (1, 'owner'), (2, 'manager'), (3, 'manager'), (4, 'contador'), (5, 'salonero'), (6, 'cajero')) r(i, rol)
 where p.id = (array[c.owner_id, c.manager, c.manager_otro, c.contador, c.salonero, c.cajero])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, loc from _c205;
insert into public.profile_locations (profile_id, location_id) select manager_otro, 'santa-teresa' from _c205;
insert into public.profile_locations (profile_id, location_id) select salonero, loc from _c205;
insert into public.profile_locations (profile_id, location_id) select cajero, loc from _c205;
insert into public.pos_ndf_tickets (local, numero_factura, fecha_registra, estado, canal, registrado_por, con_servicio, pax_alerta, valor_servido_crc)
values ('prueba-205', 'P1', '2026-11-20 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-205', 'P2', '2026-11-21 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-205', 'P3', '2026-11-22 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-205', 'P4', '2026-11-23 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('prueba-205', 'P5', '2026-11-24 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0),
       ('santa-teresa', 'F205-T1', '2026-11-22 12:00-06', 'C', 'salon', 'salonero', true, 'ok', 0);

-- ── Ayudantes (los de la 198) ────────────────────────────────────────────────────────────────────────────────────
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
  return jsonb_build_object('error', sqlstate);
end $f$;
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
create function pg_temp.intentar(p_sql text) returns text language plpgsql as $f$
declare k int;
begin
  execute p_sql; get diagnostics k = row_count; return k::text;
exception when others then return sqlstate;
end $f$;
-- Una línea ficticia en una factura (como la ingesta: un INSERT por lote → el disparador corre una vez).
create function pg_temp.linea(p_local text, p_fac text, p_cod text) returns text language sql as $f$
  select pg_temp.intentar(format($q$insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, monto, familia)
         select t.id, %L, 'FICTICIO 205 ' || %L, 1, 1000, 3 from public.pos_ndf_tickets t where t.local = %L and t.numero_factura = %L$q$,
         p_cod, p_cod, p_local, p_fac)) $f$;
create function pg_temp.reg_md5() returns text language sql as $f$
  select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.pos_catalogo_registrar()'::regprocedure $f$;
create function pg_temp.abiertas(p_local text) returns text language plpgsql as $f$
begin
  return (select coalesce(string_agg(coalesce(local, '-') || ':' || codigo || ':' || veces || ':' || facturas, ' | ' order by id), '-')
    from public.pos_catalogo_fallas where resuelta_en is null and local is not distinct from p_local);
end $f$;

-- ═══ A. La base es la 198 tal cual; la guarda de la 205 ═════════════════════════════════════════════════════════
insert into _r205 (caso, ok, detalle)
select '01 la base tiene la 198 exacta (registrar 85609c26, absorber 75d33295) y no tiene la 205',
       pg_temp.reg_md5() = '85609c26a1736ff174aec2832d101dc6'
       and (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.pos_catalogo_absorber(uuid[])'::regprocedure) = '75d332953001efe0734e99759106be19'
       and to_regclass('public.pos_catalogo_fallas') is null and to_regprocedure('public.pos_catalogo_reparar(text)') is null,
       pg_temp.reg_md5();
-- 02: si el disparador en la base NO es el de la 198, la 205 se para y no crea nada (subtransacción que se deshace).
do $g02$
declare v text; v_t boolean; v_f boolean;
begin
  begin
    execute $q$create or replace function public.pos_catalogo_registrar() returns trigger language plpgsql security definer
               set search_path = public, pg_temp as $x$ begin return null; end; $x$$q$;
    begin
      execute $m205$
-- @@205_texto@@
      $m205$;
      v := 'corrió';
    exception when others then v := sqlerrm;
    end;
    v_t := to_regclass('public.pos_catalogo_fallas') is not null;
    v_f := to_regprocedure('public.pos_catalogo_reparar(text)') is not null;
    raise exception 'deshacer';
  exception when others then
    if sqlerrm <> 'deshacer' then v := 'inesperado: ' || sqlerrm; end if;
  end;
  insert into _a205 values ('g02', v), ('g02t', v_t::text), ('g02f', v_f::text);
end $g02$;
insert into _r205 (caso, ok, detalle)
select '02 con otro cuerpo de registrar la 205 se para sin crear nada; al salir queda la 198',
       (select v from _a205 where k = 'g02') like '205: los cuerpos en la base no son los de la 198%'
       and (select v from _a205 where k = 'g02t') = 'false' and (select v from _a205 where k = 'g02f') = 'false'
       and pg_temp.reg_md5() = '85609c26a1736ff174aec2832d101dc6',
       (select v from _a205 where k = 'g02');

-- ── La 205 ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- @@205@@

-- ═══ B. Objetos y permisos ══════════════════════════════════════════════════════════════════════════════════════
insert into _r205 (caso, ok, detalle)
select '03 tabla con RLS; reparar DEFINER con search_path; authenticated lee y ejecuta reparar; anon nada; nadie escribe ni llama registrar',
       (select relrowsecurity from pg_class where oid = 'public.pos_catalogo_fallas'::regclass)
       and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.pos_catalogo_reparar(text)'::regprocedure)
       and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.pos_catalogo_registrar()'::regprocedure)
       and has_table_privilege('authenticated', 'public.pos_catalogo_fallas', 'select')
       and not has_table_privilege('authenticated', 'public.pos_catalogo_fallas', 'insert')
       and not has_table_privilege('authenticated', 'public.pos_catalogo_fallas', 'update')
       and not has_table_privilege('authenticated', 'public.pos_catalogo_fallas', 'delete')
       and not has_table_privilege('anon', 'public.pos_catalogo_fallas', 'select')
       and has_function_privilege('authenticated', 'public.pos_catalogo_reparar(text)', 'execute')
       and not has_function_privilege('anon', 'public.pos_catalogo_reparar(text)', 'execute')
       and not has_function_privilege('authenticated', 'public.pos_catalogo_registrar()', 'execute')
       and not has_function_privilege('authenticated', 'public.pos_catalogo_absorber(uuid[])', 'execute')
       and not has_function_privilege('authenticated', 'public.pos_catalogo_refrescar(text)', 'execute'),
       null;
insert into _r205 (caso, ok, detalle)
select '04 el disparador sigue igual (uno, habilitado, por sentencia, a pos_catalogo_registrar) y absorber no cambió',
       (select count(*) from pg_trigger g join pg_proc p on p.oid = g.tgfoid
         where g.tgrelid = 'public.pos_ndf_ticket_lines'::regclass and not g.tgisinternal
           and g.tgname = 'trg_pos_catalogo_registrar' and g.tgenabled = 'O' and p.proname = 'pos_catalogo_registrar') = 1
       and (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.pos_catalogo_absorber(uuid[])'::regprocedure) = '75d332953001efe0734e99759106be19',
       null;

-- ═══ C. El disparador: sano no anota; roto anota y la factura entra igual ════════════════════════════════════════
insert into _a205 select 'i05', pg_temp.linea('prueba-205', 'P1', '9051');
insert into _r205 (caso, ok, detalle)
select '05 sano: la línea entra, el producto entra al catálogo y no se anota ninguna falla',
       (select v from _a205 where k = 'i05') = '1'
       and exists (select 1 from public.pos_productos where local = 'prueba-205' and codigo = '9051')
       and not exists (select 1 from public.pos_catalogo_fallas), (select v from _a205 where k = 'i05');

alter table public.pos_productos add constraint _roto_205 check (false) not valid;
insert into _a205 select 'i06', pg_temp.linea('prueba-205', 'P2', '9052');
insert into _r205 (caso, ok, detalle)
select '06 roto: la línea entra (la ingesta manda), el producto no, y queda UNA falla abierta de prueba-205 (23514, 1 lote, 1 factura)',
       (select v from _a205 where k = 'i06') = '1'
       and exists (select 1 from public.pos_ndf_ticket_lines where codigo_producto = '9052')
       and not exists (select 1 from public.pos_productos where codigo = '9052')
       and pg_temp.abiertas('prueba-205') = 'prueba-205:23514:1:1'
       and (select mensaje like '%_roto_205%' and primera_en <= ultima_en from public.pos_catalogo_fallas where local = 'prueba-205'),
       pg_temp.abiertas('prueba-205');
insert into _a205 select 'i07', pg_temp.linea('prueba-205', 'P3', '9053');
insert into _r205 (caso, ok, detalle)
select '07 la misma falla en otro lote suma (veces 2, facturas 2) en la MISMA fila: no crece sin tope',
       (select v from _a205 where k = 'i07') = '1'
       and pg_temp.abiertas('prueba-205') = 'prueba-205:23514:2:2' and (select count(*) from public.pos_catalogo_fallas) = 1,
       pg_temp.abiertas('prueba-205');
-- 08: si anotar la falla TAMBIÉN falla, la línea entra igual.
alter table public.pos_catalogo_fallas add constraint _roto_205f check (false) not valid;
insert into _a205 select 'i08', pg_temp.linea('prueba-205', 'P4', '9054');
alter table public.pos_catalogo_fallas drop constraint _roto_205f;
insert into _r205 (caso, ok, detalle)
select '08 con la bitácora rota también, la línea entra igual (y la falla no se pudo sumar)',
       (select v from _a205 where k = 'i08') = '1'
       and exists (select 1 from public.pos_ndf_ticket_lines where codigo_producto = '9054')
       and pg_temp.abiertas('prueba-205') = 'prueba-205:23514:2:2',
       (select v from _a205 where k = 'i08') || ' / ' || pg_temp.abiertas('prueba-205');
-- Falla en el local ajeno (santa-teresa) y una sin local (no se pudo saber), para los casos de lectura y de cierre.
insert into _a205 select 'i09', pg_temp.linea('santa-teresa', 'F205-T1', '9055');
insert into public.pos_catalogo_fallas (local, codigo, mensaje, facturas) values (null, 'XX000', 'ficticia sin local', 1);

-- ═══ D. Quién ve los avisos ═════════════════════════════════════════════════════════════════════════════════════
insert into _r205 (caso, ok, detalle)
select '09 lectura: owner y contador ven las 3; manager ve solo la suya; el de santa-teresa solo la suya; salonero y cajero 0; anon sin permiso',
       (select v from _a205 where k = 'i09') = '1'
       and pg_temp.como(c.owner_id, 'select count(*) from public.pos_catalogo_fallas') = '3'
       and pg_temp.como(c.contador, 'select count(*) from public.pos_catalogo_fallas') = '3'
       and pg_temp.como(c.manager, 'select string_agg(local, '','') from public.pos_catalogo_fallas') = '"prueba-205"'
       and pg_temp.como(c.manager_otro, 'select string_agg(local, '','') from public.pos_catalogo_fallas') = '"santa-teresa"'
       and pg_temp.como(c.salonero, 'select count(*) from public.pos_catalogo_fallas') = '0'
       and pg_temp.como(c.cajero, 'select count(*) from public.pos_catalogo_fallas') = '0'
       and pg_temp.como(null, 'select count(*) from public.pos_catalogo_fallas') = '{"error": "42501"}',
       concat_ws(' / ', pg_temp.como(c.manager, 'select string_agg(local, '','') from public.pos_catalogo_fallas'),
                 pg_temp.como(c.manager_otro, 'select string_agg(local, '','') from public.pos_catalogo_fallas')) from _c205 c;
insert into _r205 (caso, ok, detalle)
select '10 nadie escribe los avisos por la API, ni el owner (insert, update, delete → 42501)',
       pg_temp.err_como(c.owner_id, $$insert into public.pos_catalogo_fallas (local, codigo, mensaje) values ('prueba-205', 'X', 'x')$$, true) = '42501'
       and pg_temp.err_como(c.owner_id, 'update public.pos_catalogo_fallas set resuelta_en = now()', true) = '42501'
       and pg_temp.err_como(c.manager, 'delete from public.pos_catalogo_fallas', true) = '42501'
       and (select count(*) from public.pos_catalogo_fallas where resuelta_en is null) = 3, null from _c205 c;

-- ═══ E. Reparar ═════════════════════════════════════════════════════════════════════════════════════════════════
insert into _a205 select 'r11', pg_temp.err_como(c.owner_id, $$public.pos_catalogo_reparar('prueba-205')$$) from _c205 c;
insert into _r205 (caso, ok, detalle)
select '11 si la regla sigue rota, reparar da el error (23514) y la falla queda ABIERTA',
       (select v from _a205 where k = 'r11') = '23514' and pg_temp.abiertas('prueba-205') = 'prueba-205:23514:2:2',
       (select v from _a205 where k = 'r11');
alter table public.pos_productos drop constraint _roto_205;
insert into _a205 select 'r12', concat_ws(',',
  pg_temp.err_como(c.contador, $$public.pos_catalogo_reparar('prueba-205')$$),
  pg_temp.err_como(c.salonero, $$public.pos_catalogo_reparar('prueba-205')$$),
  pg_temp.err_como(c.cajero, $$public.pos_catalogo_reparar('prueba-205')$$),
  pg_temp.err_como(null, $$public.pos_catalogo_reparar('prueba-205')$$),
  pg_temp.err_como(c.manager_otro, $$public.pos_catalogo_reparar('prueba-205')$$),
  pg_temp.err_como(c.manager, $$public.pos_catalogo_reparar(null)$$)) from _c205 c;
insert into _r205 (caso, ok, detalle)
select '12 contador, salonero, cajero, anon, el manager de OTRO local y el manager con null → 42501; nada cambia',
       (select v from _a205 where k = 'r12') = '42501,42501,42501,42501,42501,42501'
       and pg_temp.abiertas('prueba-205') = 'prueba-205:23514:2:2'
       and not exists (select 1 from public.pos_productos where codigo in ('9052', '9053', '9054')),
       (select v from _a205 where k = 'r12');
insert into _a205 select 'r13', pg_temp.como(c.manager, $$public.pos_catalogo_reparar('prueba-205')$$)::text from _c205 c;
insert into _r205 (caso, ok, detalle)
select '13 el manager de prueba-205 repara: entran los 3 faltantes, cierra SU falla (con su uid), sin_catalogo 0',
       (select v from _a205 where k = 'r13')::jsonb = '{"sin_catalogo": 0, "fallas_cerradas": 1, "productos_escritos": 3}'::jsonb
       and (select count(*) from public.pos_productos where local = 'prueba-205' and codigo in ('9052', '9053', '9054')) = 3
       and pg_temp.abiertas('prueba-205') = '-'
       and (select resuelta_por from public.pos_catalogo_fallas where local = 'prueba-205') = c.manager,
       (select v from _a205 where k = 'r13') from _c205 c;
insert into _a205 select 'r14', pg_temp.como(c.manager, $$public.pos_catalogo_reparar('prueba-205')$$)::text from _c205 c;
insert into _r205 (caso, ok, detalle)
select '14 idempotente: la segunda vez escribe 0 y cierra 0',
       (select v from _a205 where k = 'r14')::jsonb = '{"sin_catalogo": 0, "fallas_cerradas": 0, "productos_escritos": 0}'::jsonb,
       (select v from _a205 where k = 'r14');
insert into _r205 (caso, ok, detalle)
select '15 reparar prueba-205 NO cierra la de santa-teresa ni la sin local',
       pg_temp.abiertas('santa-teresa') = 'santa-teresa:23514:1:1' and pg_temp.abiertas(null) = '-:XX000:1:1',
       pg_temp.abiertas('santa-teresa') || ' / ' || pg_temp.abiertas(null);
insert into _a205 select 'r16', pg_temp.como(c.owner_id, 'public.pos_catalogo_reparar(null)')::text from _c205 c;
insert into _r205 (caso, ok, detalle)
select '16 el owner con null repara todos los locales y cierra las dos que quedaban (la de santa-teresa y la sin local)',
       ((select v from _a205 where k = 'r16')::jsonb ->> 'fallas_cerradas') = '2'
       and ((select v from _a205 where k = 'r16')::jsonb ->> 'sin_catalogo') = '0'
       and exists (select 1 from public.pos_productos where local = 'santa-teresa' and codigo = '9055')
       and not exists (select 1 from public.pos_catalogo_fallas where resuelta_en is null),
       (select v from _a205 where k = 'r16');
-- 17: una falla NUEVA después de cerrar abre otra fila (la cerrada queda como historia).
alter table public.pos_productos add constraint _roto_205 check (false) not valid;
insert into _a205 select 'i17', pg_temp.linea('prueba-205', 'P5', '9056');
alter table public.pos_productos drop constraint _roto_205;
insert into _r205 (caso, ok, detalle)
select '17 después de cerrar, la misma falla abre una fila nueva (veces 1) y la vieja sigue cerrada',
       (select v from _a205 where k = 'i17') = '1' and pg_temp.abiertas('prueba-205') = 'prueba-205:23514:1:1'
       and (select count(*) from public.pos_catalogo_fallas where local = 'prueba-205') = 2,
       pg_temp.abiertas('prueba-205');

-- ═══ F. Guarda, vuelta atrás y vuelta a entrar ══════════════════════════════════════════════════════════════════
do $g18$
declare v text;
begin
  begin
    execute $m205$
-- @@205_texto@@
    $m205$;
    v := 'corrió';
  exception when others then v := sqlerrm;
  end;
  insert into _a205 values ('g18', v);
end $g18$;
insert into _r205 (caso, ok, detalle)
select '18 correr la 205 otra vez se para («ya aplicada») sin tocar nada',
       (select v from _a205 where k = 'g18') like '205: ya aplicada%' and pg_temp.abiertas('prueba-205') = 'prueba-205:23514:1:1',
       (select v from _a205 where k = 'g18');
do $g19$
declare v text; v2 text;
begin
  begin
    execute $rb205$
-- @@205_rollback@@
    $rb205$;
    v := 'corrió';
  exception when others then v := sqlerrm;
  end;
  begin
    execute $rb205$
-- @@205_rollback@@
    $rb205$;
    v2 := 'corrió';
  exception when others then v2 := sqlerrm;
  end;
  insert into _a205 values ('g19', v), ('g19b', v2);
end $g19$;
insert into _a205 select 'i19', pg_temp.intentar($$alter table public.pos_productos add constraint _roto_205 check (false) not valid$$);
insert into _a205 select 'i19l', pg_temp.linea('prueba-205', 'P5', '9057');
alter table public.pos_productos drop constraint _roto_205;
insert into _r205 (caso, ok, detalle)
select '19 205_rollback.sql deja EXACTO a la 198 (registrar 85609c26, sin tabla ni reparar, disparador en pie, sin comentario); otra vez se para; la ingesta rota sigue entrando',
       (select v from _a205 where k = 'g19') = 'corrió'
       and (select v from _a205 where k = 'g19b') like '205_rollback: el disparador en la base no es el de la 205%'
       and pg_temp.reg_md5() = '85609c26a1736ff174aec2832d101dc6'
       and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.pos_catalogo_registrar()'::regprocedure)
       and obj_description('public.pos_catalogo_registrar()'::regprocedure, 'pg_proc') is null
       and to_regclass('public.pos_catalogo_fallas') is null and to_regprocedure('public.pos_catalogo_reparar(text)') is null
       and exists (select 1 from pg_trigger where tgrelid = 'public.pos_ndf_ticket_lines'::regclass and tgname = 'trg_pos_catalogo_registrar')
       and (select v from _a205 where k = 'i19l') = '1',
       concat_ws(' / ', (select v from _a205 where k = 'g19'), (select v from _a205 where k = 'g19b'), pg_temp.reg_md5());
do $g20$
declare v text;
begin
  begin
    execute $m205$
-- @@205_texto@@
    $m205$;
    v := 'corrió';
  exception when others then v := sqlerrm;
  end;
  insert into _a205 values ('g20', v);
end $g20$;
insert into _r205 (caso, ok, detalle)
select '20 tras la vuelta atrás la 205 entra otra vez (registrar 9d79f682)',
       (select v from _a205 where k = 'g20') = 'corrió' and pg_temp.reg_md5() = '9d79f68209caac275c98d2b8ce42ed71'
       and to_regclass('public.pos_catalogo_fallas') is not null,
       (select v from _a205 where k = 'g20');

select n, caso, case when ok then 'OK' else 'FALLA' end as resultado, left(coalesce(detalle, ''), 300) as detalle from _r205 order by n;
select json_build_object(
  'ok', (select count(*) from _r205 where ok), 'fallas', (select count(*) from _r205 where ok is not true),
  'fallaron', (select json_agg(json_build_array(left(caso, 2), left(coalesce(detalle, ''), 200)) order by n) from _r205 where ok is not true)) as resultado;
rollback;
