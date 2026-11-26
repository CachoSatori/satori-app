-- 203_pruebas · endurecer reemplazar_pago_caja (mig 203). Transacción que termina en ROLLBACK: no deja nada.
-- Parte de la batería de la 200 (los mismos 23 casos, ahora contra el cuerpo de la 203: regresión) y suma los casos de
-- los 4 Menores del verificador (M1–M4) y de la guarda por md5 (24–39). LOCAL FICTICIO ('prueba-200'), usuarios,
-- proveedor y pagos inventados (correos `.test`, clave ficticia). Corre en un Postgres local descartable o en STAGING
-- (ref hwiatgic…). Nunca contra PROD.
-- Orden: se saca lo que haya → se carga la 200 TAL CUAL (= prod hoy) → casos de la guarda sobre la 200 → la 203 →
-- casos → re-correr la 203 (guarda) → 203_rollback.sql (vuelve EXACTO a la 200) → la 203 entra otra vez.
-- Se arma y se corre con scripts/sql/203_pruebas.py (--armar [--mutar X] [--compacto] [--local] | --psql …).
-- MARCADORES: «@@200@@» → supabase/migrations/200_…sql tal cual · «@@203@@» → supabase/migrations/203_…sql (con
-- --mutar, roto a propósito) · «@@203_texto@@» → la 203 como texto (re-correrla; rota solo en mutaciones de la guarda)
-- · «@@203_rollback@@» → scripts/sql/203_rollback.sql como texto · «@@preludio@@» → vacío en staging; con --local,
-- scripts/sql/200_preludio_local.sql.
begin;
-- @@preludio@@
create temp table _r203 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _a203 (k text primary key, v text) on commit drop;

-- Lo que haya en esta base se saca DENTRO de la transacción: se prueban los archivos (la 200 tal cual y después la 203).
drop function if exists public.reemplazar_pago_caja(uuid, jsonb, text, text);
drop function if exists public._reemplazo_pago_coincide(public.cash_movements, jsonb);

-- ── Datos ficticios ──────────────────────────────────────────────────────────────────────────────────────────────
create temp table _c203 on commit drop as
select '00000000-0000-4000-8200-0000000000b1'::uuid as owner_id,
       '00000000-0000-4000-8200-0000000000a1'::uuid as manager,       -- manager de prueba-200
       '00000000-0000-4000-8200-0000000000a2'::uuid as manager_otro,  -- manager de santa-teresa (local ajeno)
       '00000000-0000-4000-8200-0000000000c1'::uuid as cajero,
       '00000000-0000-4000-8200-0000000000e1'::uuid as salonero,      -- asignado a prueba-200 (ve el local)
       '00000000-0000-4000-8200-0000000000d1'::uuid as contador,      -- ve todos los locales (mis_locales)
       '00000000-0000-4000-8200-0000000000f1'::uuid as proveedor_id,
       '00000000-0000-4000-8200-000000000051'::uuid as ses,           -- turno de prueba-200, 20-nov
       '00000000-0000-4000-8200-000000000052'::uuid as ses_otro_dia,  -- turno de prueba-200, 21-nov
       '00000000-0000-4000-8200-000000000053'::uuid as ses_otro_local,-- turno de santa-teresa, 20-nov
       'prueba-200'::text as loc;
insert into public.locations (id, name, is_active) values ('prueba-200', 'Local de prueba 200', false) on conflict (id) do nothing;
insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
select x.id, x.mail, extensions.crypt('clave-ficticia-200', extensions.gen_salt('bf')), '{"full_name":"Ficticio 200"}'::jsonb
  from _c203 c, lateral (values (c.owner_id, 'owner200@ejemplo.test'), (c.manager, 'manager200@ejemplo.test'),
                                (c.manager_otro, 'otro200@ejemplo.test'), (c.cajero, 'cajero200@ejemplo.test'),
                                (c.salonero, 'salonero200@ejemplo.test'), (c.contador, 'contador200@ejemplo.test')) x(id, mail);
update public.profiles p set role = r.rol::public.user_role, is_active = true
  from _c203 c, (values (1, 'owner'), (2, 'manager'), (3, 'manager'), (4, 'cajero'), (5, 'salonero'), (6, 'contador')) r(i, rol)
 where p.id = (array[c.owner_id, c.manager, c.manager_otro, c.cajero, c.salonero, c.contador])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, loc from _c203;
insert into public.profile_locations (profile_id, location_id) select manager_otro, 'santa-teresa' from _c203;
insert into public.profile_locations (profile_id, location_id) select cajero, loc from _c203;
insert into public.profile_locations (profile_id, location_id) select salonero, loc from _c203;
insert into public.suppliers (id, name) select proveedor_id, 'Proveedor ficticio 200' from _c203;
insert into public.cash_sessions (id, session_date, opened_by, status, initial_service_crc, initial_suppliers_crc, location_id)
select x.id, x.d, c.owner_id, 'open', 0, 0, x.l from _c203 c,
       lateral (values (c.ses, date '2026-11-20', c.loc), (c.ses_otro_dia, date '2026-11-21', c.loc),
                       (c.ses_otro_local, date '2026-11-20', 'santa-teresa')) x(id, d, l);

-- Pagos viejos V01…V30 menos V13 (uno por caso, para que ninguno dependa de otro; el V13 lo crea el caso 18).
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency,
                                   description, supplier_id, supplier_name, method, caja_origen, subcategory, status, location_id, created_at)
select v.id, v.id, c.ses, c.owner_id, 'egreso_mercaderia', 10000, 0, 'CRC', 'pago ficticio viejo', c.proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', 'Proveedor mercadería', 'aprobado', c.loc, '2026-11-20 10:00-06'
  from _c203 c, lateral (select ('00000000-0000-4000-8200-1000000000' || lpad(g::text, 2, '0'))::uuid id from generate_series(1, 30) g where g <> 13) v;

-- ── La 200 tal cual (= prod hoy) ─────────────────────────────────────────────────────────────────────────────────
-- @@200@@

-- ═══ G0. Guarda de la 203 sobre la 200 (antes de aplicarla) ═════════════════════════════════════════════════════
-- 36: la base de la prueba es la 200 exacta. 37: si un cuerpo en la base NO es el de la 200, la 203 se para y no toca
-- nada. 38: la huella ignora espacios (otra sangría = la misma 200) y la 203 entra. 37 y 38 en subtransacciones que se
-- deshacen: al salir queda la 200 tal cual.
insert into _a203 select 'g36', md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure;
insert into _a203 select 'g36c', md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)'::regprocedure;
do $g0$
declare v_err text; v_md5 text; v_ok text;
begin
  begin
    execute $x$create or replace function public._reemplazo_pago_coincide(m public.cash_movements, d jsonb) returns boolean
      language sql immutable set search_path = public, pg_temp as $c$ select false $c$$x$;
    begin
      execute $m203$
-- @@203_texto@@
      $m203$;
      v_err := 'corrió';
    exception when others then v_err := sqlerrm;
    end;
    select md5(regexp_replace(prosrc, '\s', '', 'g')) into v_md5 from pg_proc
     where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure;
    raise exception 'deshacer-g0';
  exception when others then
    if sqlerrm <> 'deshacer-g0' then v_err := 'inesperado: ' || sqlerrm; end if;
  end;
  insert into _a203 values ('g37', v_err), ('g37md5', v_md5);
  begin
    execute (select regexp_replace(pg_get_functiondef('public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure),
                                   E'\n', E'\n    ', 'g'));
    begin
      execute $m203$
-- @@203_texto@@
      $m203$;
      v_ok := 'corrió';
    exception when others then v_ok := sqlerrm;
    end;
    raise exception 'deshacer-g0';
  exception when others then
    if sqlerrm <> 'deshacer-g0' then v_ok := 'inesperado: ' || sqlerrm; end if;
  end;
  insert into _a203 values ('g38', v_ok);
end $g0$;
insert into _r203 (caso, ok, detalle)
select '36 la base de la prueba es la 200 exacta (huellas 636d3776… / 98dae10d…) antes de la 203',
       (select v from _a203 where k = 'g36') = '636d3776826384ff46ed87a1cfe0db25'
       and (select v from _a203 where k = 'g36c') = '98dae10d63e704afd7ff02930e655bbd',
       concat_ws(' / ', (select v from _a203 where k = 'g36'), (select v from _a203 where k = 'g36c'));
insert into _r203 (caso, ok, detalle)
select '37 guarda: con un cuerpo que no es el de la 200, la 203 se para («no son los de la 200») sin tocar nada',
       (select v from _a203 where k = 'g37') like '203: los cuerpos en la base no son los de la 200%'
       and (select v from _a203 where k = 'g37md5') = '636d3776826384ff46ed87a1cfe0db25', (select v from _a203 where k = 'g37');
insert into _r203 (caso, ok, detalle)
select '38 guarda: la 200 con otra sangría (solo espacios) tiene la misma huella y la 203 entra',
       (select v from _a203 where k = 'g38') = 'corrió', (select v from _a203 where k = 'g38');

-- ── La 203 ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- @@203@@

-- ── Ayudantes ────────────────────────────────────────────────────────────────────────────────────────────────────
create function pg_temp.v(i int) returns uuid language sql immutable as $f$ select ('00000000-0000-4000-8200-1000000000' || lpad(i::text, 2, '0'))::uuid $f$;
create function pg_temp.n(i int) returns uuid language sql immutable as $f$ select ('00000000-0000-4000-8200-2000000000' || lpad(i::text, 2, '0'))::uuid $f$;
-- Datos del pago nuevo como los arma el aparato (CashTurno.guardarCambioDePago).
create function pg_temp.datos(p_id uuid, p_crc numeric default 25000, p_ses uuid default '00000000-0000-4000-8200-000000000051') returns jsonb language sql as $f$
  select jsonb_build_object('id', p_id, 'session_id', p_ses, 'amount_crc', p_crc, 'amount_usd', 0,
    'supplier_id', '00000000-0000-4000-8200-0000000000f1', 'supplier_name', 'Proveedor ficticio 200', 'method', 'Efectivo',
    'caja_origen', 'Caja Proveedores', 'description', 'pago ficticio nuevo', 'attachments', '[]'::jsonb, 'exchange_rate', 500,
    'subcategory', 'Proveedor mercadería', 'shift', 'Noche', 'classification', 'mercaderia',
    'suggested_classification', 'mercaderia', 'suggested_confidence', 1) $f$;
-- Llama la RPC como el usuario (JWT de authenticated). Devuelve el jsonb como texto o «ERR:<sqlstate>».
create function pg_temp.rpc(p_uid uuid, p_viejo uuid, p_nuevo jsonb, p_mail text default null, p_clave text default null)
returns text language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  r := public.reemplazar_pago_caja(p_viejo, p_nuevo, p_mail, p_clave);
  reset role; perform set_config('request.jwt.claims', '', true);
  return r::text;
exception when others then
  reset role; perform set_config('request.jwt.claims', '', true);
  return 'ERR:' || sqlstate;
end $f$;
create function pg_temp.existe(p uuid) returns boolean language sql as $f$ select exists (select 1 from public.cash_movements where id = p) $f$;
-- Estado de la respuesta guardada; si fue un error, el «ERR:<sqlstate>» tal cual (no castea: no aborta la transacción).
create function pg_temp.est(k text) returns text language sql as $f$
  select case when v like '{%' then v::jsonb->>'estado' else v end from _a203 where _a203.k = est.k $f$;

-- ═══ A. Reemplazo bien hecho ═════════════════════════════════════════════════════════════════════════════════════
insert into _a203 select 'r01', pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.n(1))) from _c203;
insert into _r203 (caso, ok, detalle)
select '01 owner: reemplazo ok (viejo borrado, nuevo con lo tecleado, en el local y el turno del viejo, created_by = quien llama)',
       pg_temp.est('r01') = 'listo' and not pg_temp.existe(pg_temp.v(1))
       and exists (select 1 from public.cash_movements m where m.id = pg_temp.n(1) and m.client_op_id = pg_temp.n(1) and m.amount_crc = 25000
                   and m.location_id = c.loc and m.session_id = c.ses and m.created_by = c.owner_id and m.status = 'aprobado'),
       (select v from _a203 where k = 'r01') from _c203 c;
insert into _r203 (caso, ok, detalle)
select '02 el borrado del viejo es el de siempre: una fila en movement_deletions con la nota de reemplazo y quién autorizó',
       (select count(*) from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(1)::text
          and d.note = 'Reemplazo por edición de pago a proveedor' and d.authorized_by = c.owner_id) = 1, null from _c203 c;

-- ═══ B. Reintento idempotente ════════════════════════════════════════════════════════════════════════════════════
insert into _a203 select 'r03', pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.n(1))) from _c203;
insert into _r203 (caso, ok, detalle)
select '03 reintento con el mismo id: mismo resultado (listo, repetido), sin segundo pago ni segunda auditoría',
       pg_temp.est('r03') = 'listo' and ((select v from _a203 where k = 'r03')::jsonb->>'repetido')::boolean
       and (select count(*) from public.cash_movements where id = pg_temp.n(1) or client_op_id = pg_temp.n(1)) = 1
       and (select count(*) from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(1)::text) = 1,
       (select v from _a203 where k = 'r03');

-- R36: reintento con el MISMO id pero OTRO monto (₡99.999) cuando el viejo ya no está: NO es «listo»; lo guardado manda.
insert into _a203 select 'r21', pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.n(1), 99999)) from _c203;
insert into _r203 (caso, ok, detalle)
select '21 viejo ya no está + mismo id con OTROS datos: estado distinto con lo guardado (₡25.000), nada cambia',
       pg_temp.est('r21') = 'distinto'
       and ((select v from _a203 where k = 'r21')::jsonb->'guardado'->>'amount_crc')::numeric = 25000
       and (select count(*) from public.cash_movements where id = pg_temp.n(1) and amount_crc = 25000) = 1
       and (select count(*) from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(1)::text) = 1,
       (select v from _a203 where k = 'r21');
-- Viejo ya no está y el id coincide con OTRO movimiento visible (V02, un pago cualquiera; y uno por client_op_id):
-- no se devuelve como si fuera el reemplazo.
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select gen_random_uuid(), pg_temp.n(22), ses, owner_id, 'egreso_mercaderia', 25000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', '[]', 'aprobado', loc from _c203;
insert into _a203 select 'r22', concat_ws('|',
  pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.v(2), 10000) || '{"description":"pago ficticio viejo"}'),
  pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.n(22)))) from _c203;
insert into _r203 (caso, ok, detalle)
select '22 viejo ya no está + el id es de OTRO movimiento (por id o por client_op_id): P0002, no «listo» ni lo devuelve',
       (select v from _a203 where k = 'r22') = 'ERR:P0002|ERR:P0002' and pg_temp.existe(pg_temp.v(2))
       and (select count(*) from public.cash_movements where client_op_id = pg_temp.n(22)) = 1,
       (select v from _a203 where k = 'r22');

-- El alta ya había entrado por el camino viejo (#361) y faltaba borrar: con los mismos datos, termina el cambio.
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select pg_temp.n(4), pg_temp.n(4), ses, owner_id, 'egreso_mercaderia', 25000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', '[]', 'aprobado', loc from _c203;
insert into _a203 select 'r04', pg_temp.rpc(manager, pg_temp.v(4), pg_temp.datos(pg_temp.n(4))) from _c203;
insert into _r203 (caso, ok, detalle)
select '04 el nuevo ya estaba con los MISMOS datos (faltaba borrar): borra el viejo y no duplica',
       pg_temp.est('r04') = 'listo' and not pg_temp.existe(pg_temp.v(4))
       and (select count(*) from public.cash_movements where id = pg_temp.n(4)) = 1, (select v from _a203 where k = 'r04');

-- Un intento anterior entró con OTRO monto: no se borra el viejo (lo mismo que coincidePago en el aparato).
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select pg_temp.n(5), pg_temp.n(5), ses, owner_id, 'egreso_mercaderia', 30000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', '[]', 'aprobado', loc from _c203;
insert into _a203 select 'r05', pg_temp.rpc(manager, pg_temp.v(5), pg_temp.datos(pg_temp.n(5), 25000)) from _c203;
insert into _r203 (caso, ok, detalle)
select '05 el nuevo ya estaba con OTROS datos: estado distinto, devuelve lo guardado y el viejo NO se borra',
       pg_temp.est('r05') = 'distinto' and pg_temp.existe(pg_temp.v(5))
       and ((select v from _a203 where k = 'r05')::jsonb->'guardado'->>'amount_crc')::numeric = 30000,
       (select v from _a203 where k = 'r05');

-- ═══ C. El viejo ya no existe / dos aparatos a la vez ═══════════════════════════════════════════════════════════
insert into _a203 select 'r06', pg_temp.rpc(owner_id, gen_random_uuid(), pg_temp.datos(pg_temp.n(6))) from _c203;
insert into _r203 (caso, ok, detalle)
select '06 viejo inexistente: error claro P0002 y el nuevo NO se crea',
       (select v from _a203 where k = 'r06') = 'ERR:P0002' and not pg_temp.existe(pg_temp.n(6)), (select v from _a203 where k = 'r06');
-- Aparato A reemplaza V07 con N07; aparato B (que todavía veía V07) lo quiere reemplazar con N08.
insert into _a203 select 'r07a', pg_temp.rpc(manager, pg_temp.v(7), pg_temp.datos(pg_temp.n(7), 20000)) from _c203;
insert into _a203 select 'r07b', pg_temp.rpc(owner_id, pg_temp.v(7), pg_temp.datos(pg_temp.n(8), 21000)) from _c203;
insert into _r203 (caso, ok, detalle)
select '07 dos reemplazos del mismo viejo: el primero entra, el segundo da P0002 y no crea un segundo pago',
       pg_temp.est('r07a') = 'listo' and (select v from _a203 where k = 'r07b') = 'ERR:P0002'
       and pg_temp.existe(pg_temp.n(7)) and not pg_temp.existe(pg_temp.n(8)) and not pg_temp.existe(pg_temp.v(7)),
       (select v from _a203 where k = 'r07b');
insert into _r203 (caso, ok, detalle)
select '08 la fila vieja se bloquea con FOR UPDATE antes de escribir (lo que pone en fila a dos aparatos simultáneos)',
       pg_get_functiondef('public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure) ~ 'where id = p_viejo for update', null;

-- ═══ D. Permisos ════════════════════════════════════════════════════════════════════════════════════════════════
insert into _a203 select 'r09', pg_temp.rpc(salonero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9))) from _c203;
insert into _a203 select 'r09b', pg_temp.rpc(null, pg_temp.v(9), pg_temp.datos(pg_temp.n(9))) from _c203;
insert into _r203 (caso, ok, detalle)
select '09 rol sin permiso (salonero) y sin sesión (anon): 42501, nada cambia',
       (select v from _a203 where k = 'r09') = 'ERR:42501' and (select v from _a203 where k = 'r09b') = 'ERR:42501'
       and pg_temp.existe(pg_temp.v(9)) and not pg_temp.existe(pg_temp.n(9)),
       (select v from _a203 where k = 'r09') || ' / ' || (select v from _a203 where k = 'r09b');
-- Rol sin permiso CON la clave de un manager del local (salonero asignado al local; contador, que ve todos): igual 42501.
insert into _a203 select 'r23', concat_ws('|',
  pg_temp.rpc(salonero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), 'manager200@ejemplo.test', 'clave-ficticia-200'),
  pg_temp.rpc(contador, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), 'manager200@ejemplo.test', 'clave-ficticia-200'),
  pg_temp.rpc(contador, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)))) from _c203;
insert into _r203 (caso, ok, detalle)
select '23 salonero y contador con la clave de un manager del local (y contador sin clave): 42501, nada cambia',
       (select v from _a203 where k = 'r23') = 'ERR:42501|ERR:42501|ERR:42501' and pg_temp.existe(pg_temp.v(9)) and not pg_temp.existe(pg_temp.n(9)),
       (select v from _a203 where k = 'r23');
insert into _a203 select 'r10', pg_temp.rpc(manager_otro, pg_temp.v(9), pg_temp.datos(pg_temp.n(9))) from _c203;
insert into _r203 (caso, ok, detalle)
select '10 manager de OTRO local: 42501, nada cambia',
       (select v from _a203 where k = 'r10') = 'ERR:42501' and pg_temp.existe(pg_temp.v(9)) and not pg_temp.existe(pg_temp.n(9)),
       (select v from _a203 where k = 'r10');
insert into _a203 select 'r11a', pg_temp.rpc(cajero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9))) from _c203;
insert into _a203 select 'r11b', pg_temp.rpc(cajero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), 'manager200@ejemplo.test', 'otra-clave') from _c203;
insert into _a203 select 'r11c', pg_temp.rpc(cajero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), 'otro200@ejemplo.test', 'clave-ficticia-200') from _c203;
insert into _r203 (caso, ok, detalle)
select '11 cajero sin credenciales, con clave mala o con un manager de OTRO local: 42501, nada cambia',
       (select v from _a203 where k = 'r11a') = 'ERR:42501' and (select v from _a203 where k = 'r11b') = 'ERR:42501'
       and (select v from _a203 where k = 'r11c') = 'ERR:42501' and pg_temp.existe(pg_temp.v(9)) and not pg_temp.existe(pg_temp.n(9)),
       concat_ws(' / ', (select v from _a203 where k = 'r11a'), (select v from _a203 where k = 'r11b'), (select v from _a203 where k = 'r11c'));
insert into _a203 select 'r12', pg_temp.rpc(cajero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), ' Manager200@ejemplo.test', 'clave-ficticia-200') from _c203;
insert into _r203 (caso, ok, detalle)
select '12 cajero con credenciales del manager del local: listo; audita quién autorizó y created_by = el cajero',
       pg_temp.est('r12') = 'listo' and not pg_temp.existe(pg_temp.v(9))
       and exists (select 1 from public.cash_movements where id = pg_temp.n(9) and created_by = c.cajero)
       and exists (select 1 from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(9)::text and d.authorized_by = c.manager),
       (select v from _a203 where k = 'r12') from _c203 c;
insert into _r203 (caso, ok, detalle)
select '13 permisos de la función: authenticated ejecuta, anon no; la de comparar no la ejecuta nadie de la app',
       has_function_privilege('authenticated', 'public.reemplazar_pago_caja(uuid,jsonb,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.reemplazar_pago_caja(uuid,jsonb,text,text)', 'execute')
       and not has_function_privilege('authenticated', 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)', 'execute')
       and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure),
       null;

-- ═══ E. Validaciones de monto, turno y tipo ═════════════════════════════════════════════════════════════════════
insert into _a203 select 'r14', concat_ws('|',
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), 0)),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), -5)),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"amount_crc":"NaN"}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"amount_crc":"Infinity"}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"amount_usd":-1}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"method":"Efectivo","caja_origen":"Banco"}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"supplier_id":null}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.v(10)))) from _c203;
insert into _r203 (caso, ok, detalle)
select '14 monto 0, negativo, NaN, Infinity, $ negativo, caja que no va con el método, sin proveedor o id = el viejo: 22023, nada cambia',
       (select v from _a203 where k = 'r14') = 'ERR:22023|ERR:22023|ERR:22023|ERR:22023|ERR:22023|ERR:22023|ERR:22023|ERR:22023'
       and pg_temp.existe(pg_temp.v(10)) and not pg_temp.existe(pg_temp.n(10)), (select v from _a203 where k = 'r14');
insert into _a203 select 'r15', concat_ws('|',
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), 25000, ses_otro_dia)),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), 25000, ses_otro_local)),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), 25000, gen_random_uuid()))) from _c203;
insert into _r203 (caso, ok, detalle)
select '15 regla 11: el nuevo en otro turno (otro día, otro local o inexistente) → 22023, nada cambia',
       (select v from _a203 where k = 'r15') = 'ERR:22023|ERR:22023|ERR:22023' and pg_temp.existe(pg_temp.v(10)) and not pg_temp.existe(pg_temp.n(10)),
       (select v from _a203 where k = 'r15');
update public.cash_movements set movement_type = 'egreso_operativo' where id = pg_temp.v(11);
insert into _a203 select 'r16', pg_temp.rpc(owner_id, pg_temp.v(11), pg_temp.datos(pg_temp.n(11))) from _c203;
insert into _r203 (caso, ok, detalle)
select '16 un movimiento que no es pago a proveedor no se reemplaza por acá: 22023',
       (select v from _a203 where k = 'r16') = 'ERR:22023' and pg_temp.existe(pg_temp.v(11)) and not pg_temp.existe(pg_temp.n(11)),
       (select v from _a203 where k = 'r16');
-- Pago viejo sin turno (pendiente a nivel día de la Bandeja, transferencia): va al turno de su local y su día.
update public.cash_movements set session_id = null, method = 'Transferencia', caja_origen = 'Banco', status = 'pendiente' where id = pg_temp.v(12);
insert into _a203 select 'r17', pg_temp.rpc(owner_id, pg_temp.v(12), pg_temp.datos(pg_temp.n(12)) || '{"method":"Transferencia","caja_origen":"Banco"}') from _c203;
insert into _r203 (caso, ok, detalle)
select '17 viejo sin turno: entra en el turno de su día y local; transferencia queda «pendiente» (= createCashMovement)',
       pg_temp.est('r17') = 'listo' and exists (select 1 from public.cash_movements m where m.id = pg_temp.n(12) and m.session_id = c.ses and m.status = 'pendiente'),
       (select v from _a203 where k = 'r17') from _c203 c;

-- ═══ F. Atómica: si el borrado falla, el alta tampoco queda ══════════════════════════════════════════════════════
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency,
                                   description, supplier_id, supplier_name, method, caja_origen, status, location_id)
select pg_temp.v(13), pg_temp.v(13), ses, owner_id, 'egreso_mercaderia', 10000, 0, 'CRC', 'pago ficticio viejo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', 'aprobado', loc from _c203;
create function pg_temp.frena_borrado() returns trigger language plpgsql as $f$ begin raise exception 'borrado frenado (prueba 200)'; end $f$;
create trigger _frena_200 before delete on public.cash_movements for each row when (old.id = '00000000-0000-4000-8200-100000000013') execute function pg_temp.frena_borrado();
insert into _a203 select 'r18', pg_temp.rpc(owner_id, pg_temp.v(13), pg_temp.datos(pg_temp.n(13))) from _c203;
drop trigger _frena_200 on public.cash_movements;
insert into _r203 (caso, ok, detalle)
select '18 el borrado del viejo falla: error y el nuevo NO queda (todo o nada)',
       (select v from _a203 where k = 'r18') like 'ERR:%' and pg_temp.existe(pg_temp.v(13)) and not pg_temp.existe(pg_temp.n(13)),
       (select v from _a203 where k = 'r18');

-- ═══ H. 203: los 4 Menores del verificador (M1–M4) ══════════════════════════════════════════════════════════════
-- Para preparar los reintentos: el reemplazo bien hecho (owner, o el manager del local), ya probado en 01.
insert into _a203 select 'p24', pg_temp.rpc(owner_id, pg_temp.v(14), pg_temp.datos(pg_temp.n(14))) from _c203;
insert into _a203 select 'p25', pg_temp.rpc(owner_id, pg_temp.v(15), pg_temp.datos(pg_temp.n(15))) from _c203;
insert into _a203 select 'p26', pg_temp.rpc(manager, pg_temp.v(16), pg_temp.datos(pg_temp.n(16))) from _c203;

-- 24 (M2, rama «viejo ya no está»): la fila con ese id ya NO tiene client_op_id = id → no es el reemplazo: P0002.
update public.cash_movements set client_op_id = gen_random_uuid() where id = pg_temp.n(14);
insert into _a203 select 'r24', pg_temp.rpc(owner_id, pg_temp.v(14), pg_temp.datos(pg_temp.n(14))) from _c203;
insert into _r203 (caso, ok, detalle)
select '24 viejo ya no está + la fila con ese id tiene OTRO client_op_id: P0002 (no «listo»)',
       pg_temp.est('p24') = 'listo' and (select v from _a203 where k = 'r24') = 'ERR:P0002', (select v from _a203 where k = 'r24');

-- 25 (M2): el borrado del viejo quedó con la nota pero el que tiene ese id está en OTRO local → no es su reemplazo.
update public.cash_movements set location_id = 'santa-teresa', session_id = c.ses_otro_local from _c203 c where id = pg_temp.n(15);
insert into _a203 select 'r25', pg_temp.rpc(owner_id, pg_temp.v(15), pg_temp.datos(pg_temp.n(15))) from _c203;
insert into _r203 (caso, ok, detalle)
select '25 viejo ya no está + el de ese id está en otro local que el viejo borrado: P0002 (no «listo»)',
       pg_temp.est('p25') = 'listo' and (select v from _a203 where k = 'r25') = 'ERR:P0002', (select v from _a203 where k = 'r25');

-- 26 (M2): quien reintenta NO ve el local del de ese id (manager de otro local): P0002 sin datos.
insert into _a203 select 'r26', pg_temp.rpc(manager_otro, pg_temp.v(16), pg_temp.datos(pg_temp.n(16))) from _c203;
insert into _r203 (caso, ok, detalle)
select '26 viejo ya no está + quien reintenta no ve ese local: P0002, sin devolver la fila',
       pg_temp.est('p26') = 'listo' and (select v from _a203 where k = 'r26') = 'ERR:P0002', (select v from _a203 where k = 'r26');

-- 27 (M2, rama «el nuevo ya está»): una fila con client_op_id = ese id pero OTRO id, mismos datos: «distinto», el viejo queda.
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select gen_random_uuid(), pg_temp.n(17), ses, owner_id, 'egreso_mercaderia', 25000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', '[]', 'aprobado', loc from _c203;
insert into _a203 select 'r27', pg_temp.rpc(owner_id, pg_temp.v(17), pg_temp.datos(pg_temp.n(17))) from _c203;
insert into _r203 (caso, ok, detalle)
select '27 el nuevo ya está solo por client_op_id (otro id), mismos datos: distinto y el viejo NO se borra',
       pg_temp.est('r27') = 'distinto' and pg_temp.existe(pg_temp.v(17)) and not pg_temp.existe(pg_temp.n(17)),
       (select v from _a203 where k = 'r27');

-- 28 (M1): el id del cliente choca con un pago de OTRO local (mismos datos). Owner (ve los dos) y manager del local
-- del viejo (no ve el otro): 42501 SIN datos; el viejo queda y la fila ajena no se toca.
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select pg_temp.n(18), pg_temp.n(18), ses_otro_local, owner_id, 'egreso_mercaderia', 25000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', '[]', 'aprobado', 'santa-teresa' from _c203;
insert into _a203 select 'r28', concat_ws('|',
  pg_temp.rpc(owner_id, pg_temp.v(18), pg_temp.datos(pg_temp.n(18))),
  pg_temp.rpc(manager, pg_temp.v(18), pg_temp.datos(pg_temp.n(18))),
  pg_temp.rpc(owner_id, pg_temp.v(18), pg_temp.datos(pg_temp.n(18), 777))) from _c203;
insert into _r203 (caso, ok, detalle)
select '28 M1: id que choca con un pago de OTRO local (mismos u otros datos): 42501 sin datos, el viejo queda',
       (select v from _a203 where k = 'r28') = 'ERR:42501|ERR:42501|ERR:42501' and pg_temp.existe(pg_temp.v(18))
       and exists (select 1 from public.cash_movements where id = pg_temp.n(18) and location_id = 'santa-teresa' and amount_crc = 25000),
       (select v from _a203 where k = 'r28');

-- 29 (M3): dos filas que coinciden (A con ESE id y otro client_op_id; B con otro id y ese client_op_id), mismos datos.
-- Manda A (la del id): «listo» con A y el viejo borrado. Si mandara B: «distinto».
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select x.id, x.op, ses, owner_id, 'egreso_mercaderia', 25000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', '[]', 'aprobado', loc
  from _c203, lateral (values (gen_random_uuid(), pg_temp.n(19)), (pg_temp.n(19), gen_random_uuid())) x(id, op);
insert into _a203 select 'r29', pg_temp.rpc(owner_id, pg_temp.v(19), pg_temp.datos(pg_temp.n(19))) from _c203;
insert into _r203 (caso, ok, detalle)
select '29 M3: con una fila por id y otra por client_op_id manda la del id (listo, devuelve esa, el viejo se borra)',
       pg_temp.est('r29') = 'listo' and ((select v from _a203 where k = 'r29')::jsonb->'nuevo'->>'id')::uuid = pg_temp.n(19)
       and not pg_temp.existe(pg_temp.v(19)), (select v from _a203 where k = 'r29');

-- 30 (M4): método con espacios. (a) alta con «  Efectivo » (se guarda «Efectivo») y reintento igual → listo, repetido.
-- (b) el nuevo ya estaba guardado con «Efectivo » (camino viejo, sin btrim) y llega «Efectivo» → listo (no «distinto»).
insert into _a203 select 'r30a', pg_temp.rpc(owner_id, pg_temp.v(20), pg_temp.datos(pg_temp.n(20)) || '{"method":"  Efectivo "}') from _c203;
insert into _a203 select 'r30b', pg_temp.rpc(owner_id, pg_temp.v(20), pg_temp.datos(pg_temp.n(20)) || '{"method":"  Efectivo "}') from _c203;
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select pg_temp.n(21), pg_temp.n(21), ses, owner_id, 'egreso_mercaderia', 25000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo ', 'Caja Proveedores', '[]', 'aprobado', loc from _c203;
insert into _a203 select 'r30c', pg_temp.rpc(owner_id, pg_temp.v(21), pg_temp.datos(pg_temp.n(21))) from _c203;
insert into _r203 (caso, ok, detalle)
select '30 M4: método con espacios del lado nuevo (reintento) y del guardado (camino viejo): coincide, listo',
       pg_temp.est('r30a') = 'listo' and pg_temp.est('r30b') = 'listo'
       and ((select v from _a203 where k = 'r30b')::jsonb->>'repetido')::boolean
       and exists (select 1 from public.cash_movements where id = pg_temp.n(20) and method = 'Efectivo')
       and pg_temp.est('r30c') = 'listo' and not pg_temp.existe(pg_temp.v(21)),
       concat_ws(' / ', (select v from _a203 where k = 'r30b'), (select v from _a203 where k = 'r30c'));

-- 31–35 (M2): la comparación mira cada campo. Fila = N01 (caso 01, guardada con datos(N01)); cambia UNO por vez → false.
create temp table _m203 on commit drop as select * from public.cash_movements where id = pg_temp.n(1);
insert into _a203 select 'c_base', public._reemplazo_pago_coincide(row(m.*)::public.cash_movements, pg_temp.datos(pg_temp.n(1)))::text from _m203 m;
insert into _a203 select 'c' || x.k, public._reemplazo_pago_coincide(row(m.*)::public.cash_movements, pg_temp.datos(pg_temp.n(1)) || x.j)::text
  from _m203 m, (values ('31', '{"supplier_id":"00000000-0000-4000-8200-0000000000f2"}'::jsonb), ('32', '{"amount_usd":1}'),
                        ('33', '{"description":"otra nota"}'), ('34', '{"method":"Transferencia"}'), ('35', '{"caja_origen":"Banco"}')) x(k, j);
insert into _r203 (caso, ok, detalle)
select x.c, (select v from _a203 where k = 'c_base') = 'true' and (select v from _a203 where k = 'c' || left(x.c, 2)) = 'false',
       (select v from _a203 where k = 'c' || left(x.c, 2))
  from (values ('31 la comparación mira el proveedor'), ('32 la comparación mira los dólares'), ('33 la comparación mira la descripción'),
               ('34 la comparación mira el método'), ('35 la comparación mira la caja')) x(c);

-- ═══ G. Guarda, vuelta atrás y vuelta a entrar ══════════════════════════════════════════════════════════════════
do $g$
declare v_err text; v_rb text; v_otra text;
begin
  begin
    execute $m203$
-- @@203_texto@@
    $m203$;
    v_err := 'corrió';
  exception when others then v_err := sqlerrm;
  end;
  insert into _a203 values ('r19b', v_err);
  begin
    execute $rb203$
-- @@203_rollback@@
    $rb203$;
    v_rb := 'corrió';
  exception when others then v_rb := sqlerrm;
  end;
  insert into _a203 values ('r20b', v_rb);
  -- 20b: la vuelta atrás con lo que quedó (ya la 200) se para.
  begin
    execute $rb203$
-- @@203_rollback@@
    $rb203$;
    v_otra := 'corrió';
  exception when others then v_otra := sqlerrm;
  end;
  insert into _a203 values ('r20c', v_otra);
end $g$;
insert into _r203 (caso, ok, detalle)
select '19 correr la 203 otra vez se para en la guarda («ya aplicada») sin tocar nada',
       (select v from _a203 where k = 'r19b') like '203: ya aplicada%'
       and (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure) is not null,
       (select v from _a203 where k = 'r19b');
insert into _r203 (caso, ok, detalle)
select '20 203_rollback.sql deja las dos funciones EXACTAS a la 200 (huellas, definer, search_path, grants, comentario); otra vez se para',
       (select v from _a203 where k = 'r20b') = 'corrió'
       and (select v from _a203 where k = 'r20c') like '203_rollback: los cuerpos en la base no son los de la 203%'
       and (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure) = '636d3776826384ff46ed87a1cfe0db25'
       and (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)'::regprocedure) = '98dae10d63e704afd7ff02930e655bbd'
       and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure)
       and (select not prosecdef and provolatile = 'i' and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)'::regprocedure)
       and has_function_privilege('authenticated', 'public.reemplazar_pago_caja(uuid,jsonb,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.reemplazar_pago_caja(uuid,jsonb,text,text)', 'execute')
       and not has_function_privilege('authenticated', 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)', 'execute')
       and obj_description('public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure, 'pg_proc') like '200 · Cambiar%',
       concat_ws(' / ', (select v from _a203 where k = 'r20b'), (select v from _a203 where k = 'r20c'));
-- 39: después de la vuelta atrás, la 203 vuelve a entrar (la guarda reconoce la 200 restaurada).
do $g39$
declare v text;
begin
  begin
    execute $m203$
-- @@203_texto@@
    $m203$;
    v := 'corrió';
  exception when others then v := sqlerrm;
  end;
  insert into _a203 values ('r39', v);
end $g39$;
insert into _r203 (caso, ok, detalle)
select '39 tras la vuelta atrás la 203 entra otra vez (huella f010a305… / af19ee44…)',
       (select v from _a203 where k = 'r39') = 'corrió'
       and (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure) = 'f010a305df2234dbb9f8a6745f4a466f'
       and (select md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc where oid = 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)'::regprocedure) = 'af19ee44359cc6b7622ca2f60069d095',
       (select v from _a203 where k = 'r39');

select json_build_object(
  'ok', (select count(*) from _r203 where ok), 'fallas', (select count(*) from _r203 where ok is not true),
  'fallaron', (select json_agg(json_build_array(left(caso, 2), left(coalesce(detalle, ''), 200)) order by n) from _r203 where ok is not true)) as resultado;
rollback;
