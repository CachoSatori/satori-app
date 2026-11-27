-- 206_pruebas · freno de 0,5 s en la clave de gerencia de reemplazar_pago_caja (mig 206, hallazgo 259).
-- Transacción que termina en ROLLBACK: no deja nada. LOCAL FICTICIO ('prueba-206'), usuarios, proveedor y pagos
-- inventados (correos `.test`, clave ficticia). Corre en un Postgres local descartable o en STAGING (ref hwiatgic…).
-- Nunca contra PROD.
-- Orden: se saca lo que haya → la 200 tal cual → la 202 tal cual (= prod hoy) → guarda de la 206 sobre la 200 → la 206
-- → casos → re-correr la 206 (guarda) → 206_rollback.sql (vuelve EXACTO a la 202) → la 206 entra otra vez.
-- Se arma y se corre con scripts/sql/206_pruebas.py (--armar [--mutar X] [--compacto] [--local] | --psql …).
-- MARCADORES: «@@200@@» / «@@202@@» → esas migraciones tal cual · «@@206@@» → la 206 (con --mutar, rota a propósito)
-- · «@@206_texto@@» → la 206 como texto (re-correrla; rota solo en mutaciones de la guarda) · «@@206_rollback@@» →
-- scripts/sql/206_rollback.sql como texto · «@@preludio@@» → vacío en staging; con --local, 200_preludio_local.sql.
begin;
-- @@preludio@@
create temp table _r206 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _a206 (k text primary key, v text) on commit drop;
-- La 206 y su vuelta atrás como texto, una sola vez (re-correrlas dentro de los bloques: execute desde acá).
create temp table _t206 (k text primary key, v text) on commit drop;
insert into _t206 values ('m206', $m206$
-- @@206_texto@@
$m206$), ('rb206', $rb206$
-- @@206_rollback@@
$rb206$);

drop function if exists public.reemplazar_pago_caja(uuid, jsonb, text, text);
drop function if exists public._reemplazo_pago_coincide(public.cash_movements, jsonb);

-- ── Datos ficticios ──────────────────────────────────────────────────────────────────────────────────────────────
create temp table _c206 on commit drop as
select '00000000-0000-4000-8206-0000000000b1'::uuid as owner_id,
       '00000000-0000-4000-8206-0000000000a1'::uuid as manager,
       '00000000-0000-4000-8206-0000000000c1'::uuid as cajero,
       '00000000-0000-4000-8206-0000000000f1'::uuid as proveedor_id,
       '00000000-0000-4000-8206-000000000051'::uuid as ses,
       'prueba-206'::text as loc;
insert into public.locations (id, name, is_active) values ('prueba-206', 'Local de prueba 206', false) on conflict (id) do nothing;
insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
select x.id, x.mail, extensions.crypt('clave-ficticia-206', extensions.gen_salt('bf')), '{"full_name":"Ficticio 206"}'::jsonb
  from _c206 c, lateral (values (c.owner_id, 'owner206@ejemplo.test'), (c.manager, 'manager206@ejemplo.test'),
                                (c.cajero, 'cajero206@ejemplo.test')) x(id, mail);
update public.profiles p set role = r.rol::public.user_role, is_active = true
  from _c206 c, (values (1, 'owner'), (2, 'manager'), (3, 'cajero')) r(i, rol)
 where p.id = (array[c.owner_id, c.manager, c.cajero])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, loc from _c206;
insert into public.profile_locations (profile_id, location_id) select cajero, loc from _c206;
insert into public.suppliers (id, name) select proveedor_id, 'Proveedor ficticio 206' from _c206;
insert into public.cash_sessions (id, session_date, opened_by, status, initial_service_crc, initial_suppliers_crc, location_id)
select ses, date '2026-11-20', owner_id, 'open', 0, 0, loc from _c206;
-- Pagos viejos V01…V09 (uno por caso, para que ninguno dependa de otro).
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency,
                                   description, supplier_id, supplier_name, method, caja_origen, subcategory, status, location_id, created_at)
select v.id, v.id, c.ses, c.owner_id, 'egreso_mercaderia', 10000, 0, 'CRC', 'pago ficticio viejo', c.proveedor_id,
       'Proveedor ficticio 206', 'Efectivo', 'Caja Proveedores', 'Proveedor mercadería', 'aprobado', c.loc, '2026-11-20 10:00-06'
  from _c206 c, lateral (select ('00000000-0000-4000-8206-1000000000' || lpad(g::text, 2, '0'))::uuid id from generate_series(1, 9) g) v;

-- ── La 200 y la 202 tal cual (= prod hoy) ────────────────────────────────────────────────────────────────────────
-- @@200@@
-- @@202@@

-- ═══ G0. Guarda de la 206 sobre algo que no es la 202: se para sin tocar nada (subtransacción que se deshace) ════════════════════════════
insert into _a206 select 'g02', md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure;
do $g0$
declare v_err text; v_md5 text;
begin
  begin
    execute $x$create or replace function public._reemplazo_pago_coincide(m public.cash_movements, d jsonb) returns boolean
      language sql immutable set search_path = public, pg_temp as $c$ select false $c$$x$;
    begin
      execute (select v from _t206 where k = 'm206');
      v_err := 'corrió';
    exception when others then v_err := sqlerrm;
    end;
    select md5(regexp_replace(prosrc, '\s', '', 'g')) into v_md5 from pg_proc
     where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure;
    raise exception 'deshacer-g0';
  exception when others then
    if sqlerrm <> 'deshacer-g0' then v_err := 'inesperado: ' || sqlerrm; end if;
  end;
  insert into _a206 values ('g01', v_err), ('g01md5', v_md5);
end $g0$;
insert into _r206 (caso, ok, detalle)
select '01 guarda: si _reemplazo_pago_coincide no es el de la 202, la 206 se para («no son los de la 202») sin tocar nada',
       (select v from _a206 where k = 'g01') like '206: los cuerpos en la base no son los de la 202%'
       and (select v from _a206 where k = 'g01md5') = '3ca9211052b3b977f2e5a4f3432b99f1', (select v from _a206 where k = 'g01');
insert into _r206 (caso, ok, detalle)
select '02 la base de la prueba es la 202 exacta (huella 3ca92110…) antes de la 206',
       (select v from _a206 where k = 'g02') = '3ca9211052b3b977f2e5a4f3432b99f1', (select v from _a206 where k = 'g02');

-- ── La 206 ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- @@206@@

-- ── Ayudantes ────────────────────────────────────────────────────────────────────────────────────────────────────
create function pg_temp.v(i int) returns uuid language sql immutable as $f$ select ('00000000-0000-4000-8206-1000000000' || lpad(i::text, 2, '0'))::uuid $f$;
create function pg_temp.n(i int) returns uuid language sql immutable as $f$ select ('00000000-0000-4000-8206-2000000000' || lpad(i::text, 2, '0'))::uuid $f$;
create function pg_temp.datos(p_id uuid) returns jsonb language sql as $f$
  select jsonb_build_object('id', p_id, 'session_id', '00000000-0000-4000-8206-000000000051', 'amount_crc', 25000, 'amount_usd', 0,
    'supplier_id', '00000000-0000-4000-8206-0000000000f1', 'supplier_name', 'Proveedor ficticio 206', 'method', 'Efectivo',
    'caja_origen', 'Caja Proveedores', 'description', 'pago ficticio nuevo', 'attachments', '[]'::jsonb, 'exchange_rate', 500,
    'subcategory', 'Proveedor mercadería', 'shift', 'Noche', 'classification', 'mercaderia') $f$;
-- Llama la RPC como el usuario (JWT de authenticated). Guarda en _a206 «k» el jsonb como texto o «ERR:<sqlstate>», y en
-- «k_ms» los milisegundos que tardó (reloj real: clock_timestamp).
create function pg_temp.rpc(k text, p_uid uuid, p_viejo uuid, p_nuevo jsonb, p_mail text default null, p_clave text default null)
returns void language plpgsql as $f$
declare r text; t0 timestamptz := clock_timestamp();
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    r := public.reemplazar_pago_caja(p_viejo, p_nuevo, p_mail, p_clave)::text;
    reset role; perform set_config('request.jwt.claims', '', true);
  exception when others then
    reset role; perform set_config('request.jwt.claims', '', true);
    r := 'ERR:' || sqlstate;
  end;
  insert into _a206 values (k, r), (k || '_ms', round(extract(epoch from clock_timestamp() - t0) * 1000)::text);
end $f$;
create function pg_temp.existe(p uuid) returns boolean language sql as $f$ select exists (select 1 from public.cash_movements where id = p) $f$;
create function pg_temp.a(k text) returns text language sql as $f$ select v from _a206 where _a206.k = a.k $f$;
create function pg_temp.ms(k text) returns int language sql as $f$ select v::int from _a206 where _a206.k = ms.k || '_ms' $f$;
create function pg_temp.est(k text) returns text language sql as $f$
  select case when v like '{%' then v::jsonb->>'estado' else v end from _a206 where _a206.k = est.k $f$;
-- «Nada cambió»: el viejo sigue, el nuevo no está y no hay auditoría de borrado del viejo.
create function pg_temp.intacto(i int) returns boolean language sql as $f$
  select pg_temp.existe(pg_temp.v(i)) and not pg_temp.existe(pg_temp.n(i))
     and not exists (select 1 from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(i)::text) $f$;

-- ═══ A. Lo que no cambia: firma, atributos, grants, y el cuerpo = 202 + la línea del freno ═══════════════════════
insert into _r206 (caso, ok, detalle)
select '03 misma firma, SECURITY DEFINER, search_path, grants (authenticated sí; anon y public no); _reemplazo_pago_coincide intacta',
       (select prosecdef and proconfig = array['search_path=public, pg_temp'] and prorettype = 'jsonb'::regtype
          from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure)
       and has_function_privilege('authenticated', 'public.reemplazar_pago_caja(uuid,jsonb,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.reemplazar_pago_caja(uuid,jsonb,text,text)', 'execute')
       and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                        where p.oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure and a.grantee = 0)
       and (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)'::regprocedure) = 'ec56e5b77dad0552543a037e0ccf34c3'
       and not has_function_privilege('authenticated', 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)', 'execute'),
       null;
insert into _r206 (caso, ok, detalle)
select '04 el cuerpo de la 206 es el de la 202 más UNA línea (el pg_sleep(0.5) antes del 42501 de clave mala)',
       md5(regexp_replace(replace(prosrc, E'      perform pg_sleep(0.5);   -- 206 · hallazgo 259: el mismo freno que verify_manager_password (045) en el fallo\n', ''), '\s', '', 'g'))
         = '3ca9211052b3b977f2e5a4f3432b99f1'
       and md5(regexp_replace(prosrc, '\s', '', 'g')) = '85456458e90e0f14c1fe3025a5ea8d1b',
       md5(regexp_replace(prosrc, '\s', '', 'g'))
  from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure;

-- ═══ B. Clave correcta: sigue funcionando ═══════════════════════════════════════════════════════════════════════
select pg_temp.rpc('r05', cajero, pg_temp.v(1), pg_temp.datos(pg_temp.n(1)), 'manager206@ejemplo.test', 'clave-ficticia-206') from _c206;
insert into _r206 (caso, ok, detalle)
select '05 cajero + clave correcta del manager del local: listo (viejo borrado, nuevo creado, auditoría con quién autorizó)',
       pg_temp.est('r05') = 'listo' and not pg_temp.existe(pg_temp.v(1))
       and exists (select 1 from public.cash_movements m where m.id = pg_temp.n(1) and m.amount_crc = 25000 and m.created_by = c.cajero)
       and (select count(*) from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(1)::text
              and d.authorized_by = c.manager) = 1,
       pg_temp.a('r05') from _c206 c;
-- Mayúsculas y espacios en el correo: igual que en la 202.
select pg_temp.rpc('r06', cajero, pg_temp.v(2), pg_temp.datos(pg_temp.n(2)), '  Manager206@Ejemplo.TEST ', 'clave-ficticia-206') from _c206;
insert into _r206 (caso, ok, detalle)
select '06 cajero + clave correcta con el correo en mayúsculas/espacios: listo (= 202)',
       pg_temp.est('r06') = 'listo' and not pg_temp.existe(pg_temp.v(2)) and pg_temp.existe(pg_temp.n(2)), pg_temp.a('r06');

-- ═══ C. Clave mala: 42501, tarda ≥ 0,5 s y no cambia nada ════════════════════════════════════════════════════════
select pg_temp.rpc('r07a', cajero, pg_temp.v(3), pg_temp.datos(pg_temp.n(3)), 'manager206@ejemplo.test', 'otra-clave') from _c206;
select pg_temp.rpc('r07b', cajero, pg_temp.v(3), pg_temp.datos(pg_temp.n(3)), 'cajero206@ejemplo.test', 'clave-ficticia-206') from _c206;
select pg_temp.rpc('r07c', cajero, pg_temp.v(3), pg_temp.datos(pg_temp.n(3)), 'manager206@ejemplo.test', '') from _c206;
select pg_temp.rpc('r07d', cajero, pg_temp.v(3), pg_temp.datos(pg_temp.n(3)), 'nadie206@ejemplo.test', 'clave-ficticia-206') from _c206;
insert into _r206 (caso, ok, detalle)
select '07 cajero + clave mala / correo de un no-manager / clave vacía / correo que no existe: 42501, cada uno ≥ 500 ms, nada cambia',
       pg_temp.a('r07a') = 'ERR:42501' and pg_temp.a('r07b') = 'ERR:42501'
       and pg_temp.a('r07c') = 'ERR:42501' and pg_temp.a('r07d') = 'ERR:42501'
       and pg_temp.ms('r07a') >= 500 and pg_temp.ms('r07b') >= 500 and pg_temp.ms('r07c') >= 500 and pg_temp.ms('r07d') >= 500
       and pg_temp.intacto(3),
       concat_ws(' / ', pg_temp.a('r07a') || ' ' || pg_temp.ms('r07a') || 'ms', pg_temp.a('r07b') || ' ' || pg_temp.ms('r07b') || 'ms',
                 pg_temp.a('r07c') || ' ' || pg_temp.ms('r07c') || 'ms', pg_temp.a('r07d') || ' ' || pg_temp.ms('r07d') || 'ms');
-- Después de los fallos, la clave correcta sigue sirviendo (el freno no bloquea a nadie).
select pg_temp.rpc('r08', cajero, pg_temp.v(3), pg_temp.datos(pg_temp.n(3)), 'manager206@ejemplo.test', 'clave-ficticia-206') from _c206;
insert into _r206 (caso, ok, detalle)
select '08 después de los intentos fallidos, la clave correcta entra (listo)',
       pg_temp.est('r08') = 'listo' and not pg_temp.existe(pg_temp.v(3)) and pg_temp.existe(pg_temp.n(3)), pg_temp.a('r08');

-- ═══ D. Sin credenciales y roles que no las necesitan: igual que la 202 ═════════════════════════════════════════
select pg_temp.rpc('r09', cajero, pg_temp.v(4), pg_temp.datos(pg_temp.n(4))) from _c206;
insert into _r206 (caso, ok, detalle)
select '09 cajero sin credenciales: 42501 y nada cambia (= 202)', pg_temp.a('r09') = 'ERR:42501' and pg_temp.intacto(4), pg_temp.a('r09');
select pg_temp.rpc('r10a', owner_id, pg_temp.v(5), pg_temp.datos(pg_temp.n(5))) from _c206;
select pg_temp.rpc('r10b', manager, pg_temp.v(6), pg_temp.datos(pg_temp.n(6))) from _c206;
insert into _r206 (caso, ok, detalle)
select '10 owner y manager sin clave: listo y SIN freno (< 500 ms cada uno)',
       pg_temp.est('r10a') = 'listo' and pg_temp.est('r10b') = 'listo'
       and pg_temp.ms('r10a') < 500 and pg_temp.ms('r10b') < 500
       and not pg_temp.existe(pg_temp.v(5)) and not pg_temp.existe(pg_temp.v(6)),
       concat_ws(' / ', pg_temp.a('r10a') || ' ' || pg_temp.ms('r10a') || 'ms', pg_temp.a('r10b') || ' ' || pg_temp.ms('r10b') || 'ms');

-- ═══ E. Atómica: si el borrado falla, el alta tampoco queda (con clave correcta) ═════════════════════════════════
create function pg_temp.frena_borrado() returns trigger language plpgsql as $f$ begin raise exception 'borrado frenado (prueba 206)'; end $f$;
create trigger _frena_206 before delete on public.cash_movements for each row when (old.id = '00000000-0000-4000-8206-100000000007') execute function pg_temp.frena_borrado();
select pg_temp.rpc('r11', cajero, pg_temp.v(7), pg_temp.datos(pg_temp.n(7)), 'manager206@ejemplo.test', 'clave-ficticia-206') from _c206;
drop trigger _frena_206 on public.cash_movements;
insert into _r206 (caso, ok, detalle)
select '11 el borrado del viejo falla: error y el nuevo NO queda (todo o nada)',
       pg_temp.a('r11') like 'ERR:%' and pg_temp.intacto(7), pg_temp.a('r11');

-- ═══ F. Guarda y vuelta atrás ═══════════════════════════════════════════════════════════════════════════════════
do $g$
declare v_ya text; v_rb text; v_otra text; v_de_nuevo text;
begin
  begin
    execute (select v from _t206 where k = 'm206');
    v_ya := 'corrió';
  exception when others then v_ya := sqlerrm;
  end;
  insert into _a206 values ('r12', v_ya);
  begin
    execute (select v from _t206 where k = 'rb206');
    v_rb := 'corrió';
  exception when others then v_rb := sqlerrm;
  end;
  insert into _a206 values ('r13a', v_rb);
  insert into _a206 select 'r13md5', md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure;
  insert into _a206 select 'r13com', obj_description('public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure, 'pg_proc');
  insert into _a206 select 'r13atr', (prosecdef and proconfig = array['search_path=public, pg_temp']
         and has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute'))::text
    from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure;
  begin
    execute (select v from _t206 where k = 'rb206');
    v_otra := 'corrió';
  exception when others then v_otra := sqlerrm;
  end;
  insert into _a206 values ('r13b', v_otra);
  begin
    execute (select v from _t206 where k = 'm206');
    v_de_nuevo := 'corrió';
  exception when others then v_de_nuevo := sqlerrm;
  end;
  insert into _a206 values ('r14', v_de_nuevo);
end $g$;
insert into _r206 (caso, ok, detalle)
select '12 correr la 206 otra vez se para en la guarda («ya aplicada») sin tocar nada',
       pg_temp.a('r12') like '206: ya aplicada%', pg_temp.a('r12');
insert into _r206 (caso, ok, detalle)
select '13 206_rollback.sql deja la función EXACTA a la 202 (huella, definer, search_path, grants, comentario); otra vez se para',
       pg_temp.a('r13a') = 'corrió' and pg_temp.a('r13md5') = '3ca9211052b3b977f2e5a4f3432b99f1' and pg_temp.a('r13atr') = 'true'
       and pg_temp.a('r13com') like '200 + 202 · %método con btrim.'
       and pg_temp.a('r13b') like '206_rollback: el cuerpo en la base no es el de la 206%',
       concat_ws(' / ', pg_temp.a('r13a'), pg_temp.a('r13md5'), pg_temp.a('r13b'));
insert into _r206 (caso, ok, detalle)
select '14 tras la vuelta atrás la 206 entra otra vez (huella 85456458…)',
       pg_temp.a('r14') = 'corrió'
       and (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure) = '85456458e90e0f14c1fe3025a5ea8d1b',
       pg_temp.a('r14');

select json_build_object(
  'ok', (select count(*) from _r206 where ok), 'fallas', (select count(*) from _r206 where ok is not true),
  'fallaron', (select json_agg(json_build_array(left(caso, 2), left(coalesce(detalle, ''), 200)) order by n) from _r206 where ok is not true)) as resultado;
rollback;
