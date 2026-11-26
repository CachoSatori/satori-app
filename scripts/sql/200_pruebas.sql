-- 200_pruebas · reemplazar_pago_caja (cambio de pago en UNA transacción). Transacción que termina en ROLLBACK: no deja
-- nada. Usa un LOCAL FICTICIO ('prueba-200'), usuarios, proveedor y pagos inventados (correos `.test`, clave ficticia).
-- 23 casos (01–23). Corre en STAGING (ref hwiatgic…), antes o después de aplicar la 200: el armador mete el cuerpo de la 200 adentro
-- (si ya está aplicada, se borra primero dentro de la transacción para probar el archivo, no lo que haya en la base).
-- Se arma y se corre con scripts/sql/200_pruebas.py (--armar [--mutar X] [--compacto]). Nunca contra PROD.
-- MARCADORES: «@@200@@» → cuerpo de supabase/migrations/200_caja_reemplazo_pago_atomico.sql (con --mutar, roto a
-- propósito) · «@@200_texto@@» → el mismo cuerpo como texto (guarda de «ya existe») · «@@200_rollback@@» ·
-- «@@preludio@@» → vacío en staging; con --local, scripts/sql/200_preludio_local.sql.
begin;
-- @@preludio@@
create temp table _r200 (n serial, caso text, ok boolean, detalle text) on commit drop;
create temp table _a200 (k text primary key, v text) on commit drop;

-- Si la 200 ya estaba aplicada en esta base, se saca DENTRO de la transacción: se prueba el archivo.
drop function if exists public.reemplazar_pago_caja(uuid, jsonb, text, text);
drop function if exists public._reemplazo_pago_coincide(public.cash_movements, jsonb);

-- ── Datos ficticios ──────────────────────────────────────────────────────────────────────────────────────────────
create temp table _c200 on commit drop as
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
  from _c200 c, lateral (values (c.owner_id, 'owner200@ejemplo.test'), (c.manager, 'manager200@ejemplo.test'),
                                (c.manager_otro, 'otro200@ejemplo.test'), (c.cajero, 'cajero200@ejemplo.test'),
                                (c.salonero, 'salonero200@ejemplo.test'), (c.contador, 'contador200@ejemplo.test')) x(id, mail);
update public.profiles p set role = r.rol::public.user_role, is_active = true
  from _c200 c, (values (1, 'owner'), (2, 'manager'), (3, 'manager'), (4, 'cajero'), (5, 'salonero'), (6, 'contador')) r(i, rol)
 where p.id = (array[c.owner_id, c.manager, c.manager_otro, c.cajero, c.salonero, c.contador])[r.i];
insert into public.profile_locations (profile_id, location_id) select manager, loc from _c200;
insert into public.profile_locations (profile_id, location_id) select manager_otro, 'santa-teresa' from _c200;
insert into public.profile_locations (profile_id, location_id) select cajero, loc from _c200;
insert into public.profile_locations (profile_id, location_id) select salonero, loc from _c200;
insert into public.suppliers (id, name) select proveedor_id, 'Proveedor ficticio 200' from _c200;
insert into public.cash_sessions (id, session_date, opened_by, status, initial_service_crc, initial_suppliers_crc, location_id)
select x.id, x.d, c.owner_id, 'open', 0, 0, x.l from _c200 c,
       lateral (values (c.ses, date '2026-11-20', c.loc), (c.ses_otro_dia, date '2026-11-21', c.loc),
                       (c.ses_otro_local, date '2026-11-20', 'santa-teresa')) x(id, d, l);

-- Pagos viejos V01…V12 (uno por caso, para que ninguno dependa de otro).
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency,
                                   description, supplier_id, supplier_name, method, caja_origen, subcategory, status, location_id, created_at)
select v.id, v.id, c.ses, c.owner_id, 'egreso_mercaderia', 10000, 0, 'CRC', 'pago ficticio viejo', c.proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', 'Proveedor mercadería', 'aprobado', c.loc, '2026-11-20 10:00-06'
  from _c200 c, lateral (select ('00000000-0000-4000-8200-1000000000' || lpad(g::text, 2, '0'))::uuid id from generate_series(1, 12) g) v;

-- ── La 200 ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- @@200@@

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
  select case when v like '{%' then v::jsonb->>'estado' else v end from _a200 where _a200.k = est.k $f$;

-- ═══ A. Reemplazo bien hecho ═════════════════════════════════════════════════════════════════════════════════════
insert into _a200 select 'r01', pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.n(1))) from _c200;
insert into _r200 (caso, ok, detalle)
select '01 owner: reemplazo ok (viejo borrado, nuevo con lo tecleado, en el local y el turno del viejo, created_by = quien llama)',
       pg_temp.est('r01') = 'listo' and not pg_temp.existe(pg_temp.v(1))
       and exists (select 1 from public.cash_movements m where m.id = pg_temp.n(1) and m.client_op_id = pg_temp.n(1) and m.amount_crc = 25000
                   and m.location_id = c.loc and m.session_id = c.ses and m.created_by = c.owner_id and m.status = 'aprobado'),
       (select v from _a200 where k = 'r01') from _c200 c;
insert into _r200 (caso, ok, detalle)
select '02 el borrado del viejo es el de siempre: una fila en movement_deletions con la nota de reemplazo y quién autorizó',
       (select count(*) from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(1)::text
          and d.note = 'Reemplazo por edición de pago a proveedor' and d.authorized_by = c.owner_id) = 1, null from _c200 c;

-- ═══ B. Reintento idempotente ════════════════════════════════════════════════════════════════════════════════════
insert into _a200 select 'r03', pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.n(1))) from _c200;
insert into _r200 (caso, ok, detalle)
select '03 reintento con el mismo id: mismo resultado (listo, repetido), sin segundo pago ni segunda auditoría',
       pg_temp.est('r03') = 'listo' and ((select v from _a200 where k = 'r03')::jsonb->>'repetido')::boolean
       and (select count(*) from public.cash_movements where id = pg_temp.n(1) or client_op_id = pg_temp.n(1)) = 1
       and (select count(*) from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(1)::text) = 1,
       (select v from _a200 where k = 'r03');

-- R36: reintento con el MISMO id pero OTRO monto (₡99.999) cuando el viejo ya no está: NO es «listo»; lo guardado manda.
insert into _a200 select 'r21', pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.n(1), 99999)) from _c200;
insert into _r200 (caso, ok, detalle)
select '21 viejo ya no está + mismo id con OTROS datos: estado distinto con lo guardado (₡25.000), nada cambia',
       pg_temp.est('r21') = 'distinto'
       and ((select v from _a200 where k = 'r21')::jsonb->'guardado'->>'amount_crc')::numeric = 25000
       and (select count(*) from public.cash_movements where id = pg_temp.n(1) and amount_crc = 25000) = 1
       and (select count(*) from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(1)::text) = 1,
       (select v from _a200 where k = 'r21');
-- Viejo ya no está y el id coincide con OTRO movimiento visible (V02, un pago cualquiera; y uno por client_op_id):
-- no se devuelve como si fuera el reemplazo.
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select gen_random_uuid(), pg_temp.n(22), ses, owner_id, 'egreso_mercaderia', 25000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', '[]', 'aprobado', loc from _c200;
insert into _a200 select 'r22', concat_ws('|',
  pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.v(2), 10000) || '{"description":"pago ficticio viejo"}'),
  pg_temp.rpc(owner_id, pg_temp.v(1), pg_temp.datos(pg_temp.n(22)))) from _c200;
insert into _r200 (caso, ok, detalle)
select '22 viejo ya no está + el id es de OTRO movimiento (por id o por client_op_id): P0002, no «listo» ni lo devuelve',
       (select v from _a200 where k = 'r22') = 'ERR:P0002|ERR:P0002' and pg_temp.existe(pg_temp.v(2))
       and (select count(*) from public.cash_movements where client_op_id = pg_temp.n(22)) = 1,
       (select v from _a200 where k = 'r22');

-- El alta ya había entrado por el camino viejo (#361) y faltaba borrar: con los mismos datos, termina el cambio.
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select pg_temp.n(4), pg_temp.n(4), ses, owner_id, 'egreso_mercaderia', 25000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', '[]', 'aprobado', loc from _c200;
insert into _a200 select 'r04', pg_temp.rpc(manager, pg_temp.v(4), pg_temp.datos(pg_temp.n(4))) from _c200;
insert into _r200 (caso, ok, detalle)
select '04 el nuevo ya estaba con los MISMOS datos (faltaba borrar): borra el viejo y no duplica',
       pg_temp.est('r04') = 'listo' and not pg_temp.existe(pg_temp.v(4))
       and (select count(*) from public.cash_movements where id = pg_temp.n(4)) = 1, (select v from _a200 where k = 'r04');

-- Un intento anterior entró con OTRO monto: no se borra el viejo (lo mismo que coincidePago en el aparato).
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency, description,
                                   supplier_id, supplier_name, method, caja_origen, attachments, status, location_id)
select pg_temp.n(5), pg_temp.n(5), ses, owner_id, 'egreso_mercaderia', 30000, 0, 'CRC', 'pago ficticio nuevo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', '[]', 'aprobado', loc from _c200;
insert into _a200 select 'r05', pg_temp.rpc(manager, pg_temp.v(5), pg_temp.datos(pg_temp.n(5), 25000)) from _c200;
insert into _r200 (caso, ok, detalle)
select '05 el nuevo ya estaba con OTROS datos: estado distinto, devuelve lo guardado y el viejo NO se borra',
       pg_temp.est('r05') = 'distinto' and pg_temp.existe(pg_temp.v(5))
       and ((select v from _a200 where k = 'r05')::jsonb->'guardado'->>'amount_crc')::numeric = 30000,
       (select v from _a200 where k = 'r05');

-- ═══ C. El viejo ya no existe / dos aparatos a la vez ═══════════════════════════════════════════════════════════
insert into _a200 select 'r06', pg_temp.rpc(owner_id, gen_random_uuid(), pg_temp.datos(pg_temp.n(6))) from _c200;
insert into _r200 (caso, ok, detalle)
select '06 viejo inexistente: error claro P0002 y el nuevo NO se crea',
       (select v from _a200 where k = 'r06') = 'ERR:P0002' and not pg_temp.existe(pg_temp.n(6)), (select v from _a200 where k = 'r06');
-- Aparato A reemplaza V07 con N07; aparato B (que todavía veía V07) lo quiere reemplazar con N08.
insert into _a200 select 'r07a', pg_temp.rpc(manager, pg_temp.v(7), pg_temp.datos(pg_temp.n(7), 20000)) from _c200;
insert into _a200 select 'r07b', pg_temp.rpc(owner_id, pg_temp.v(7), pg_temp.datos(pg_temp.n(8), 21000)) from _c200;
insert into _r200 (caso, ok, detalle)
select '07 dos reemplazos del mismo viejo: el primero entra, el segundo da P0002 y no crea un segundo pago',
       pg_temp.est('r07a') = 'listo' and (select v from _a200 where k = 'r07b') = 'ERR:P0002'
       and pg_temp.existe(pg_temp.n(7)) and not pg_temp.existe(pg_temp.n(8)) and not pg_temp.existe(pg_temp.v(7)),
       (select v from _a200 where k = 'r07b');
insert into _r200 (caso, ok, detalle)
select '08 la fila vieja se bloquea con FOR UPDATE antes de escribir (lo que pone en fila a dos aparatos simultáneos)',
       pg_get_functiondef('public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure) ~ 'where id = p_viejo for update', null;

-- ═══ D. Permisos ════════════════════════════════════════════════════════════════════════════════════════════════
insert into _a200 select 'r09', pg_temp.rpc(salonero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9))) from _c200;
insert into _a200 select 'r09b', pg_temp.rpc(null, pg_temp.v(9), pg_temp.datos(pg_temp.n(9))) from _c200;
insert into _r200 (caso, ok, detalle)
select '09 rol sin permiso (salonero) y sin sesión (anon): 42501, nada cambia',
       (select v from _a200 where k = 'r09') = 'ERR:42501' and (select v from _a200 where k = 'r09b') = 'ERR:42501'
       and pg_temp.existe(pg_temp.v(9)) and not pg_temp.existe(pg_temp.n(9)),
       (select v from _a200 where k = 'r09') || ' / ' || (select v from _a200 where k = 'r09b');
-- Rol sin permiso CON la clave de un manager del local (salonero asignado al local; contador, que ve todos): igual 42501.
insert into _a200 select 'r23', concat_ws('|',
  pg_temp.rpc(salonero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), 'manager200@ejemplo.test', 'clave-ficticia-200'),
  pg_temp.rpc(contador, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), 'manager200@ejemplo.test', 'clave-ficticia-200'),
  pg_temp.rpc(contador, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)))) from _c200;
insert into _r200 (caso, ok, detalle)
select '23 salonero y contador con la clave de un manager del local (y contador sin clave): 42501, nada cambia',
       (select v from _a200 where k = 'r23') = 'ERR:42501|ERR:42501|ERR:42501' and pg_temp.existe(pg_temp.v(9)) and not pg_temp.existe(pg_temp.n(9)),
       (select v from _a200 where k = 'r23');
insert into _a200 select 'r10', pg_temp.rpc(manager_otro, pg_temp.v(9), pg_temp.datos(pg_temp.n(9))) from _c200;
insert into _r200 (caso, ok, detalle)
select '10 manager de OTRO local: 42501, nada cambia',
       (select v from _a200 where k = 'r10') = 'ERR:42501' and pg_temp.existe(pg_temp.v(9)) and not pg_temp.existe(pg_temp.n(9)),
       (select v from _a200 where k = 'r10');
insert into _a200 select 'r11a', pg_temp.rpc(cajero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9))) from _c200;
insert into _a200 select 'r11b', pg_temp.rpc(cajero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), 'manager200@ejemplo.test', 'otra-clave') from _c200;
insert into _a200 select 'r11c', pg_temp.rpc(cajero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), 'otro200@ejemplo.test', 'clave-ficticia-200') from _c200;
insert into _r200 (caso, ok, detalle)
select '11 cajero sin credenciales, con clave mala o con un manager de OTRO local: 42501, nada cambia',
       (select v from _a200 where k = 'r11a') = 'ERR:42501' and (select v from _a200 where k = 'r11b') = 'ERR:42501'
       and (select v from _a200 where k = 'r11c') = 'ERR:42501' and pg_temp.existe(pg_temp.v(9)) and not pg_temp.existe(pg_temp.n(9)),
       concat_ws(' / ', (select v from _a200 where k = 'r11a'), (select v from _a200 where k = 'r11b'), (select v from _a200 where k = 'r11c'));
insert into _a200 select 'r12', pg_temp.rpc(cajero, pg_temp.v(9), pg_temp.datos(pg_temp.n(9)), ' Manager200@ejemplo.test', 'clave-ficticia-200') from _c200;
insert into _r200 (caso, ok, detalle)
select '12 cajero con credenciales del manager del local: listo; audita quién autorizó y created_by = el cajero',
       pg_temp.est('r12') = 'listo' and not pg_temp.existe(pg_temp.v(9))
       and exists (select 1 from public.cash_movements where id = pg_temp.n(9) and created_by = c.cajero)
       and exists (select 1 from public.movement_deletions d where d.movement_snapshot->>'id' = pg_temp.v(9)::text and d.authorized_by = c.manager),
       (select v from _a200 where k = 'r12') from _c200 c;
insert into _r200 (caso, ok, detalle)
select '13 permisos de la función: authenticated ejecuta, anon no; la de comparar no la ejecuta nadie de la app',
       has_function_privilege('authenticated', 'public.reemplazar_pago_caja(uuid,jsonb,text,text)', 'execute')
       and not has_function_privilege('anon', 'public.reemplazar_pago_caja(uuid,jsonb,text,text)', 'execute')
       and not has_function_privilege('authenticated', 'public._reemplazo_pago_coincide(public.cash_movements,jsonb)', 'execute')
       and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.reemplazar_pago_caja(uuid,jsonb,text,text)'::regprocedure),
       null;

-- ═══ E. Validaciones de monto, turno y tipo ═════════════════════════════════════════════════════════════════════
insert into _a200 select 'r14', concat_ws('|',
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), 0)),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), -5)),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"amount_crc":"NaN"}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"amount_crc":"Infinity"}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"amount_usd":-1}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"method":"Efectivo","caja_origen":"Banco"}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10)) || '{"supplier_id":null}'),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.v(10)))) from _c200;
insert into _r200 (caso, ok, detalle)
select '14 monto 0, negativo, NaN, Infinity, $ negativo, caja que no va con el método, sin proveedor o id = el viejo: 22023, nada cambia',
       (select v from _a200 where k = 'r14') = 'ERR:22023|ERR:22023|ERR:22023|ERR:22023|ERR:22023|ERR:22023|ERR:22023|ERR:22023'
       and pg_temp.existe(pg_temp.v(10)) and not pg_temp.existe(pg_temp.n(10)), (select v from _a200 where k = 'r14');
insert into _a200 select 'r15', concat_ws('|',
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), 25000, ses_otro_dia)),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), 25000, ses_otro_local)),
  pg_temp.rpc(owner_id, pg_temp.v(10), pg_temp.datos(pg_temp.n(10), 25000, gen_random_uuid()))) from _c200;
insert into _r200 (caso, ok, detalle)
select '15 regla 11: el nuevo en otro turno (otro día, otro local o inexistente) → 22023, nada cambia',
       (select v from _a200 where k = 'r15') = 'ERR:22023|ERR:22023|ERR:22023' and pg_temp.existe(pg_temp.v(10)) and not pg_temp.existe(pg_temp.n(10)),
       (select v from _a200 where k = 'r15');
update public.cash_movements set movement_type = 'egreso_operativo' where id = pg_temp.v(11);
insert into _a200 select 'r16', pg_temp.rpc(owner_id, pg_temp.v(11), pg_temp.datos(pg_temp.n(11))) from _c200;
insert into _r200 (caso, ok, detalle)
select '16 un movimiento que no es pago a proveedor no se reemplaza por acá: 22023',
       (select v from _a200 where k = 'r16') = 'ERR:22023' and pg_temp.existe(pg_temp.v(11)) and not pg_temp.existe(pg_temp.n(11)),
       (select v from _a200 where k = 'r16');
-- Pago viejo sin turno (pendiente a nivel día de la Bandeja, transferencia): va al turno de su local y su día.
update public.cash_movements set session_id = null, method = 'Transferencia', caja_origen = 'Banco', status = 'pendiente' where id = pg_temp.v(12);
insert into _a200 select 'r17', pg_temp.rpc(owner_id, pg_temp.v(12), pg_temp.datos(pg_temp.n(12)) || '{"method":"Transferencia","caja_origen":"Banco"}') from _c200;
insert into _r200 (caso, ok, detalle)
select '17 viejo sin turno: entra en el turno de su día y local; transferencia queda «pendiente» (= createCashMovement)',
       pg_temp.est('r17') = 'listo' and exists (select 1 from public.cash_movements m where m.id = pg_temp.n(12) and m.session_id = c.ses and m.status = 'pendiente'),
       (select v from _a200 where k = 'r17') from _c200 c;

-- ═══ F. Atómica: si el borrado falla, el alta tampoco queda ══════════════════════════════════════════════════════
insert into public.cash_movements (id, client_op_id, session_id, created_by, movement_type, amount_crc, amount_usd, currency,
                                   description, supplier_id, supplier_name, method, caja_origen, status, location_id)
select pg_temp.v(13), pg_temp.v(13), ses, owner_id, 'egreso_mercaderia', 10000, 0, 'CRC', 'pago ficticio viejo', proveedor_id,
       'Proveedor ficticio 200', 'Efectivo', 'Caja Proveedores', 'aprobado', loc from _c200;
create function pg_temp.frena_borrado() returns trigger language plpgsql as $f$ begin raise exception 'borrado frenado (prueba 200)'; end $f$;
create trigger _frena_200 before delete on public.cash_movements for each row when (old.id = '00000000-0000-4000-8200-100000000013') execute function pg_temp.frena_borrado();
insert into _a200 select 'r18', pg_temp.rpc(owner_id, pg_temp.v(13), pg_temp.datos(pg_temp.n(13))) from _c200;
drop trigger _frena_200 on public.cash_movements;
insert into _r200 (caso, ok, detalle)
select '18 el borrado del viejo falla: error y el nuevo NO queda (todo o nada)',
       (select v from _a200 where k = 'r18') like 'ERR:%' and pg_temp.existe(pg_temp.v(13)) and not pg_temp.existe(pg_temp.n(13)),
       (select v from _a200 where k = 'r18');

-- ═══ G. Guarda y vuelta atrás ═══════════════════════════════════════════════════════════════════════════════════
do $g$ begin
  begin
    execute $m200$
-- @@200_texto@@
    $m200$;
    insert into _a200 values ('r19b', 'corrió');
  exception when others then insert into _a200 values ('r19b', sqlerrm);
  end;
end $g$;
insert into _r200 (caso, ok, detalle)
select '19 correr la 200 otra vez se para en la guarda («ya existe») sin tocar nada',
       (select v from _a200 where k = 'r19b') like '200: reemplazar_pago_caja ya existe%'
       and (select count(*) from pg_proc where proname = 'reemplazar_pago_caja') = 1, (select v from _a200 where k = 'r19b');
-- @@200_rollback@@
insert into _r200 (caso, ok, detalle)
select '20 después de 200_rollback.sql no queda ninguna de las dos funciones',
       to_regprocedure('public.reemplazar_pago_caja(uuid,jsonb,text,text)') is null
       and to_regprocedure('public._reemplazo_pago_coincide(public.cash_movements,jsonb)') is null, null;

select json_build_object(
  'ok', (select count(*) from _r200 where ok), 'fallas', (select count(*) from _r200 where ok is not true),
  'fallaron', (select json_agg(json_build_array(left(caso, 2), left(coalesce(detalle, ''), 200)) order by n) from _r200 where ok is not true)) as resultado;
rollback;
