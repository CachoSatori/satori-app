-- 166_pruebas (origen 112) · Club: campañas con grupo de control. Aplica la 166 dentro de una transacción, arma datos
-- ficticios, prueba y termina en ROLLBACK: no deja nada. Al final un ASSERT: si algún caso falla, aborta con
-- «166-FALLAN: <casos>». Se corre con scripts/sql/166_pruebas.py (--local: Postgres 16 local; --armar: SQL para staging).
--
-- MARCADORES que llena el runner: «-- @@166@@» → el cuerpo de la 166 sin begin;/commit; (con --mutar, con el arreglo
-- deshecho a propósito) y «-- @@166R@@» → el cuerpo de scripts/sql/166_rollback.sql.
--
-- Todo es ficticio y propio de la prueba: tres locales (p166-a con 2000 referentes que vencen en 10 días, p166-b con
-- 3, p166-c vacío), un usuario por rol (más un owner inactivo y un manager de otro local). JWT simulado con
-- set_config('request.jwt.claims', …, true), como las baterías 160 y 161.
--
-- Fuera de «A contactar» en p166-a: X1 vence en 40 días · X2 tipo equipo · X3 de baja · X4 ya vencido · X5 saldo 2
-- personas (0 créditos). Los grupos salen del sorteo (semilla al azar): la batería toma O1, O2, O3 (oferta) y C1, C2
-- (control) de las asignaciones y les arma actividad HOY:
--   O1 dos visitas hoy (F1) · O2 una visita hoy (F1, la misma mesa) · O3 una tarjeta de la app hoy con cruce manual a F4
--   · O3 una visita AYER (antes de su ventana: no cuenta) · C1 una visita hoy con F2 (ANULADA), otra hoy con F3 y una
--   tarjeta hoy con F2 elegida a mano (anulada: no suma)
--   · C2 una visita hoy en p166-b (otro local: no cuenta).
--   F1: ₡10.000 (fam. 2) + ₡2.000 (fam. 17, fuera de la neta) − regalía ₡1.000 → ₡9.000 · F3 ₡5.000 · F4 ₡4.000 · F2 X.
--   Esperado: oferta 3 con visita, 3 visitas (días), 2 facturas, ₡13.000 · control 1, 1, 1, ₡5.000.
begin;
-- @@166@@   (aquí va el cuerpo de la 166 sin begin/commit)
create temp table _r166 (n serial, caso text, ok boolean, detalle text) on commit drop;

-- ── Usuarios de prueba ─────────────────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000166a01', 'p166-owner@ejemplo.test'),
  ('00000000-0000-4000-8000-000000166a02', 'p166-manager@ejemplo.test'),
  ('00000000-0000-4000-8000-000000166a03', 'p166-contador@ejemplo.test'),
  ('00000000-0000-4000-8000-000000166a04', 'p166-cajero@ejemplo.test'),
  ('00000000-0000-4000-8000-000000166a06', 'p166-owner-inactivo@ejemplo.test'),
  ('00000000-0000-4000-8000-000000166a07', 'p166-manager-otro@ejemplo.test');
insert into public.profiles (id, full_name, role, is_active) values
  ('00000000-0000-4000-8000-000000166a01', 'Prueba Owner', 'owner', true),
  ('00000000-0000-4000-8000-000000166a02', 'Prueba Manager', 'manager', true),
  ('00000000-0000-4000-8000-000000166a03', 'Prueba Contador', 'contador', true),
  ('00000000-0000-4000-8000-000000166a04', 'Prueba Cajero', 'cajero', true),
  ('00000000-0000-4000-8000-000000166a06', 'Prueba Owner Inactivo', 'owner', false),
  ('00000000-0000-4000-8000-000000166a07', 'Prueba Manager Otro', 'manager', true)
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;

-- ── Locales ────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.locations (id, name) values ('p166-a', 'Local P166 A'), ('p166-b', 'Local P166 B'), ('p166-c', 'Local P166 C')
on conflict (id) do nothing;
insert into public.club_config (location_id, nombre) values ('p166-a', 'Local P166 A'), ('p166-b', 'Local P166 B'), ('p166-c', 'Local P166 C');
insert into public.profile_locations (profile_id, location_id, principal) values
  ('00000000-0000-4000-8000-000000166a02', 'p166-a', true),
  ('00000000-0000-4000-8000-000000166a04', 'p166-a', true),
  ('00000000-0000-4000-8000-000000166a07', 'p166-b', true);

-- ── Miembros ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2000 referentes en p166-a con 6 personas (1 crédito) y última tarjeta hace 12 meses − 10 días: vencen en 10 días
insert into public.club_miembros (id, location_id, tipo, nombre)
select ('00000000-0000-4000-8166-' || lpad(i::text, 12, '0'))::uuid, 'p166-a', 'referente', 'Prueba Referente ' || i
  from generate_series(1, 2000) i;
insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita)
select 'p166-a', ('00000000-0000-4000-8166-' || lpad(i::text, 12, '0'))::uuid, 'tarjeta', 6, 6, 18000,
       now() - interval '12 months' + interval '10 days'
  from generate_series(1, 2000) i;
-- los que NO entran
insert into public.club_miembros (id, location_id, tipo, nombre, estado) values
  ('00000000-0000-4000-8166-100000000001', 'p166-a', 'referente', 'Prueba X1 vence en 40', 'activo'),
  ('00000000-0000-4000-8166-100000000002', 'p166-a', 'equipo',    'Prueba X2 equipo',      'activo'),
  ('00000000-0000-4000-8166-100000000003', 'p166-a', 'referente', 'Prueba X3 de baja',     'baja'),
  ('00000000-0000-4000-8166-100000000004', 'p166-a', 'referente', 'Prueba X4 ya vencido',  'activo'),
  ('00000000-0000-4000-8166-100000000005', 'p166-a', 'referente', 'Prueba X5 sin credito', 'activo'),
  -- p166-b: tres que vencen en 10 días (campaña chica)
  ('00000000-0000-4000-8166-200000000001', 'p166-b', 'referente', 'Prueba B1', 'activo'),
  ('00000000-0000-4000-8166-200000000002', 'p166-b', 'referente', 'Prueba B2', 'activo'),
  ('00000000-0000-4000-8166-200000000003', 'p166-b', 'concierge_pm', 'Prueba B3', 'activo');
insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita)
select x.loc, x.m::uuid, 'tarjeta', x.p, 6, 18000, x.f
  from (values
    ('p166-a', '00000000-0000-4000-8166-100000000001', 6, now() - interval '12 months' + interval '40 days'),
    ('p166-a', '00000000-0000-4000-8166-100000000002', 6, now() - interval '12 months' + interval '10 days'),
    ('p166-a', '00000000-0000-4000-8166-100000000003', 6, now() - interval '12 months' + interval '10 days'),
    ('p166-a', '00000000-0000-4000-8166-100000000004', 6, now() - interval '12 months' - interval '1 day'),
    ('p166-a', '00000000-0000-4000-8166-100000000005', 2, now() - interval '12 months' + interval '10 days'),
    ('p166-b', '00000000-0000-4000-8166-200000000001', 6, now() - interval '12 months' + interval '10 days'),
    ('p166-b', '00000000-0000-4000-8166-200000000002', 6, now() - interval '12 months' + interval '10 days'),
    ('p166-b', '00000000-0000-4000-8166-200000000003', 6, now() - interval '12 months' + interval '10 days')) x(loc, m, p, f);

-- ── Llamar como un usuario (JWT simulado). Devuelve el JSON o «ERR:<sqlstate>» ───────────────────────────────────────
create or replace function pg_temp.como(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  begin execute 'select (' || p_sql || ')::jsonb' into r; exception when others then r := to_jsonb('ERR:' || sqlstate); end;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

-- ── Campañas ───────────────────────────────────────────────────────────────────────────────────────────────────────
create temp table _c166 on commit drop as
select pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear('Prueba vencen', 'p166-a')$$) as a15,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear('Prueba sin reserva', 'p166-a', 0)$$) as a0,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear('Prueba mitad', 'p166-a', 50)$$) as a50,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear('Prueba chica', 'p166-b', 15)$$) as b15,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear('Prueba vacia', 'p166-c', 15)$$) as c15,
       pg_temp.como('00000000-0000-4000-8000-000000166a02', $$public.club_campana_crear('Prueba manager', 'p166-a')$$) as manager,
       pg_temp.como('00000000-0000-4000-8000-000000166a03', $$public.club_campana_crear('Prueba contador', 'p166-a')$$) as contador,
       pg_temp.como('00000000-0000-4000-8000-000000166a04', $$public.club_campana_crear('Prueba cajero', 'p166-a')$$) as cajero,
       pg_temp.como('00000000-0000-4000-8000-000000166a06', $$public.club_campana_crear('Prueba inactivo', 'p166-a')$$) as inactivo,
       pg_temp.como(null,                                   $$public.club_campana_crear('Prueba sin sesion', 'p166-a')$$) as sin_sesion,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear('Prueba sesenta', 'p166-a', 60)$$) as pct60,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear('Prueba negativo', 'p166-a', -1)$$) as pctneg,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear(' ', 'p166-a')$$) as sin_nombre,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear('Prueba reto', 'p166-a', 15, 'reto')$$) as reto,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campana_crear('Prueba local', 'p166-zz')$$) as local_malo;
create temp table _id166 on commit drop as
select (a15->>'id')::uuid as a15, (a0->>'id')::uuid as a0, (a50->>'id')::uuid as a50, (b15->>'id')::uuid as b15,
       (c15->>'id')::uuid as c15 from _c166;
-- grupos de la campaña principal, antes de tocar nada
create temp table _g166 on commit drop as
select a.miembro_id, a.grupo, a.sorteo from public.club_campana_asignaciones a, _id166 i where a.campana_id = i.a15;

-- 0. catálogo
insert into _r166 (caso, ok, detalle)
select '0 catálogo: definer · search_path fijo · anon sin EXECUTE · authenticated solo en las 5 de pantalla · tablas sin grants',
       bool_and(p.prosecdef and p.proconfig = array['search_path=public, pg_temp'] and not has_function_privilege('anon', p.oid, 'EXECUTE'))
       and bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') = (p.proname in
             ('club_campana_crear', 'club_campana_sumar_nuevos', 'club_campanas_listar', 'club_campana_lista', 'club_campana_reporte')))
       and not has_table_privilege('authenticated', 'public.club_campanas', 'SELECT,INSERT,UPDATE,DELETE')
       and not has_table_privilege('authenticated', 'public.club_campana_asignaciones', 'SELECT,INSERT,UPDATE,DELETE')
       and not has_table_privilege('anon', 'public.club_campana_asignaciones', 'SELECT,INSERT,UPDATE,DELETE'),
       string_agg(p.proname || ':' || coalesce(p.proacl::text, 'sin acl'), ' | ')
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'club_campana%' and p.prosecdef;

-- 1. permisos: solo owner ACTIVO arma campañas
insert into _r166 (caso, ok, detalle) select '1a owner arma la campaña', jsonb_typeof(a15) = 'object' and a15 ? 'id', left(a15::text, 120) from _c166;
insert into _r166 (caso, ok, detalle) select '1b manager → 42501', manager = to_jsonb('ERR:42501'::text), manager::text from _c166;
insert into _r166 (caso, ok, detalle) select '1c contador → 42501', contador = to_jsonb('ERR:42501'::text), contador::text from _c166;
insert into _r166 (caso, ok, detalle) select '1d cajero → 42501', cajero = to_jsonb('ERR:42501'::text), cajero::text from _c166;
insert into _r166 (caso, ok, detalle) select '1e owner inactivo → 42501', inactivo = to_jsonb('ERR:42501'::text), inactivo::text from _c166;
insert into _r166 (caso, ok, detalle) select '1f sin sesión → 42501', sin_sesion = to_jsonb('ERR:42501'::text), sin_sesion::text from _c166;
create temp table _p166 on commit drop as
select pg_temp.como('00000000-0000-4000-8000-000000166a02', format('public.club_campana_reporte(%L)', a15)) as rep_manager,
       pg_temp.como('00000000-0000-4000-8000-000000166a02', format('public.club_campana_lista(%L)', a15)) as lista_manager,
       pg_temp.como('00000000-0000-4000-8000-000000166a02', format('public.club_campana_lista(%L, true)', a15)) as csv_manager,
       pg_temp.como('00000000-0000-4000-8000-000000166a02', format('public.club_campana_sumar_nuevos(%L)', a15)) as sumar_manager,
       pg_temp.como('00000000-0000-4000-8000-000000166a02', $$public.club_campanas_listar('p166-a')$$) as listar_manager,
       pg_temp.como('00000000-0000-4000-8000-000000166a03', format('public.club_campana_reporte(%L)', a15)) as rep_contador,
       pg_temp.como('00000000-0000-4000-8000-000000166a06', format('public.club_campana_reporte(%L)', a15)) as rep_inactivo,
       pg_temp.como('00000000-0000-4000-8000-000000166a07', format('public.club_campana_reporte(%L)', a15)) as rep_manager_otro,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_reporte(%L)', gen_random_uuid())) as rep_no_existe
  from _id166;
insert into _r166 (caso, ok, detalle)
select '1g manager no ve reporte, lista, CSV, sumar ni listar (42501); contador, owner inactivo y manager de otro local tampoco',
       rep_manager = to_jsonb('ERR:42501'::text) and lista_manager = to_jsonb('ERR:42501'::text)
       and csv_manager = to_jsonb('ERR:42501'::text) and sumar_manager = to_jsonb('ERR:42501'::text)
       and listar_manager = to_jsonb('ERR:42501'::text) and rep_contador = to_jsonb('ERR:42501'::text)
       and rep_inactivo = to_jsonb('ERR:42501'::text) and rep_manager_otro = to_jsonb('ERR:42501'::text),
       concat_ws(' ', rep_manager, lista_manager, csv_manager, sumar_manager, listar_manager, rep_contador, rep_inactivo, rep_manager_otro)
  from _p166;
insert into _r166 (caso, ok, detalle) select '1h campaña que no existe → P0001', rep_no_existe = to_jsonb('ERR:P0001'::text), rep_no_existe::text from _p166;

-- 2. validaciones
insert into _r166 (caso, ok, detalle)
select '2a % fuera de 0–50 → P0001 (60 y −1)', pct60 = to_jsonb('ERR:P0001'::text) and pctneg = to_jsonb('ERR:P0001'::text),
       pct60::text || ' ' || pctneg::text from _c166;
insert into _r166 (caso, ok, detalle) select '2b sin nombre → P0001', sin_nombre = to_jsonb('ERR:P0001'::text), sin_nombre::text from _c166;
insert into _r166 (caso, ok, detalle) select '2c fuente «reto»: todavía no (P0001) y no crea nada', reto = to_jsonb('ERR:P0001'::text)
       and not exists (select 1 from public.club_campanas where nombre = 'Prueba reto'), reto::text from _c166;
insert into _r166 (caso, ok, detalle) select '2d local que no existe → P0001', local_malo = to_jsonb('ERR:P0001'::text), local_malo::text from _c166;

-- 3. quién entra y proporción
insert into _r166 (caso, ok, detalle)
select '3a entran los 2000 que vencen en 30 días (sin X1 a 40 días, equipo, baja, vencido, sin crédito ni otro local)',
       (select count(*) from _g166) = 2000
       and not exists (select 1 from _g166 where miembro_id::text like '00000000-0000-4000-8166-1%'
                                              or miembro_id::text like '00000000-0000-4000-8166-2%'),
       (select count(*)::text from _g166);
insert into _r166 (caso, ok, detalle)
select '3b proporción aproximada: 15 % → control entre 12 % y 18 % (2000 miembros)',
       (select count(*) filter (where grupo = 'control')::numeric / count(*) from _g166) between 0.12 and 0.18,
       (select count(*) filter (where grupo = 'control')::text from _g166);
insert into _r166 (caso, ok, detalle)
select '3c 0 % → nadie en control · 50 % → control entre 45 % y 55 %',
       (a0->>'control')::int = 0 and (a0->>'oferta')::int = 2000
       and (a50->>'control')::numeric / 2000 between 0.45 and 0.55, a0::text || ' ' || (a50->>'control') from _c166;
insert into _r166 (caso, ok, detalle)
select '3d la respuesta de crear trae los tamaños de cada grupo',
       (a15->>'oferta')::int + (a15->>'control')::int = 2000
       and (a15->>'control')::int = (select count(*) from _g166 where grupo = 'control'), a15::text from _c166;
insert into _r166 (caso, ok, detalle)
select '3e cero datos: campaña en un local vacío → 0 y 0, sin error', (c15->>'oferta')::int = 0 and (c15->>'control')::int = 0,
       c15::text from _c166;

-- 4. sorteo fijo, reproducible y auditado
insert into _r166 (caso, ok, detalle)
select '4a reproducible: con la semilla guardada, cada sorteo y cada grupo se recalculan igual',
       bool_and(g.sorteo = least(public.club_campana_sorteo(c.semilla, c.id, g.miembro_id), 0.999999999)
                and g.grupo = case when g.sorteo < c.control_pct / 100 then 'control' else 'oferta' end),
       count(*)::text
  from _g166 g, _id166 i join public.club_campanas c on c.id = i.a15;
insert into _r166 (caso, ok, detalle)
select '4b la semilla, el % y los tamaños quedan en club_auditoria (campana_crear)',
       exists (select 1 from public.club_auditoria a, _id166 i join public.club_campanas c on c.id = i.a15
                where a.accion = 'campana_crear' and a.objeto_id = c.id and a.despues->>'semilla' = c.semilla
                  and (a.despues->>'control_pct')::numeric = 15
                  and (a.despues->>'control')::int = (select count(*) from _g166 where grupo = 'control')
                  and a.actor = '00000000-0000-4000-8000-000000166a01'), null;
insert into _r166 (caso, ok, detalle)
select '4c dos campañas, dos semillas distintas', (select count(distinct semilla) from public.club_campanas where location_id like 'p166-%') = 5, null;
-- sumar nuevos: nada cambia para los ya asignados; uno nuevo entra con el grupo del sorteo
create temp table _s166 on commit drop as
select pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_sumar_nuevos(%L)', a15)) as s1 from _id166;
insert into public.club_miembros (id, location_id, tipo, nombre) values ('00000000-0000-4000-8166-300000000001', 'p166-a', 'referente', 'Prueba Nuevo');
insert into public.club_movimientos (location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita)
values ('p166-a', '00000000-0000-4000-8166-300000000001', 'tarjeta', 6, 6, 18000, now() - interval '12 months' + interval '5 days');
alter table _s166 add column s2 jsonb;
update _s166 set s2 = pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_sumar_nuevos(%L)', (select a15 from _id166)));
insert into _r166 (caso, ok, detalle)
select '4d sumar nuevos: 0 la primera vez, 1 después del alta; los 2000 siguen igual (grupo y sorteo)',
       (s1->>'nuevos')::int = 0 and (s2->>'nuevos')::int = 1
       and (select count(*) from _g166 g join public.club_campana_asignaciones a on a.miembro_id = g.miembro_id
             and a.campana_id = (select a15 from _id166) and a.grupo = g.grupo and a.sorteo = g.sorteo) = 2000
       and exists (select 1 from public.club_auditoria a where a.accion = 'campana_sumar' and (a.despues->>'nuevos')::int = 1),
       s1::text || ' ' || s2::text from _s166;

-- 5. nadie reasigna
create or replace function pg_temp.intenta(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql; return 'PASÓ';
exception when others then return 'ERR:' || sqlstate;
end $f$;
insert into _r166 (caso, ok, detalle)
select '5a UPDATE del grupo se rechaza (aun como dueño de la tabla)', r like 'ERR:%', r
  from (select pg_temp.intenta(format($$update public.club_campana_asignaciones set grupo = 'oferta' where campana_id = %L and grupo = 'control'$$, a15)) r from _id166) x;
insert into _r166 (caso, ok, detalle)
select '5b DELETE de una asignación se rechaza', r like 'ERR:%', r
  from (select pg_temp.intenta(format($$delete from public.club_campana_asignaciones where campana_id = %L$$, a15)) r from _id166) x;
insert into _r166 (caso, ok, detalle)
select '5c cambiar la semilla o el % de la campaña se rechaza; borrarla también',
       r1 like 'ERR:%' and r2 like 'ERR:%' and r3 like 'ERR:%', concat_ws(' ', r1, r2, r3)
  from (select pg_temp.intenta(format($$update public.club_campanas set semilla = md5('x') where id = %L$$, a15)) r1,
               pg_temp.intenta(format($$update public.club_campanas set control_pct = 0 where id = %L$$, a15)) r2,
               pg_temp.intenta(format($$delete from public.club_campanas where id = %L$$, a15)) r3 from _id166) x;
insert into _r166 (caso, ok, detalle)
select '5d asignar dos veces al mismo miembro → clave duplicada (23505)', r = 'ERR:23505', r
  from (select pg_temp.intenta(format($$insert into public.club_campana_asignaciones (campana_id, miembro_id, grupo, sorteo) values (%L, %L, 'control', 0)$$,
                                      a15, (select miembro_id from _g166 where grupo = 'oferta' limit 1))) r from _id166) x;
-- un INSERT a mano que «elige» el grupo: queda el del sorteo
insert into public.club_miembros (id, location_id, tipo, nombre) values ('00000000-0000-4000-8166-300000000002', 'p166-a', 'referente', 'Prueba A Mano');
insert into public.club_campana_asignaciones (campana_id, miembro_id, grupo, sorteo)
select i.a50, '00000000-0000-4000-8166-300000000002',
       -- pide el grupo CONTRARIO al del sorteo
       case when public.club_campana_sorteo(c.semilla, c.id, '00000000-0000-4000-8166-300000000002') < 0.5 then 'oferta' else 'control' end, 0
  from _id166 i join public.club_campanas c on c.id = i.a50;
insert into _r166 (caso, ok, detalle)
select '5e un INSERT a mano no elige el grupo: queda el del sorteo (y su valor)',
       a.grupo = case when a.sorteo < 0.5 then 'control' else 'oferta' end
       and a.sorteo = least(public.club_campana_sorteo(c.semilla, c.id, a.miembro_id), 0.999999999),
       a.grupo || ' ' || a.sorteo
  from public.club_campana_asignaciones a join public.club_campanas c on c.id = a.campana_id
 where a.miembro_id = '00000000-0000-4000-8166-300000000002';
insert into _r166 (caso, ok, detalle)
select '5f TRUNCATE de las asignaciones se rechaza', r like 'ERR:%', r
  from (select pg_temp.intenta('truncate public.club_campana_asignaciones') r) x;
-- authenticated no lee ni escribe las tablas directo
do $$
declare v text := 'nada';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000166a01', 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform 1 from public.club_campana_asignaciones limit 1; v := 'leyó';
  exception when others then v := 'ERR:' || sqlstate; end;
  begin insert into public.club_campanas (location_id, nombre, fuente, inicio) values ('p166-a', 'Directo', 'a_contactar', current_date);
        v := v || ' escribió';
  exception when others then v := v || ' ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('p166.directo', v, true);
end $$;
insert into _r166 (caso, ok, detalle)
select '5g el owner por la API no lee ni inserta las tablas directo (42501)', current_setting('p166.directo') = 'ERR:42501 ERR:42501',
       current_setting('p166.directo');

-- ── Contactos y actividad (sobre los grupos que salieron) ───────────────────────────────────────────────────────────
create temp table _q166 on commit drop as
select (select miembro_id from _g166 where grupo = 'oferta' order by miembro_id limit 1)          as o1,
       (select miembro_id from _g166 where grupo = 'oferta' order by miembro_id offset 1 limit 1) as o2,
       (select miembro_id from _g166 where grupo = 'oferta' order by miembro_id offset 2 limit 1) as o3,
       (select miembro_id from _g166 where grupo = 'control' order by miembro_id limit 1)          as c1,
       (select miembro_id from _g166 where grupo = 'control' order by miembro_id offset 1 limit 1) as c2;
insert into public.club_miembros_contacto (miembro_id, location_id, telefono, email, optin_whatsapp, optin_email)
select * from (
  select o1 as m, 'p166-a', '+50600000166', 'p166-o1@ejemplo.test', true, false from _q166
  union all select o2, 'p166-a', '+50600000167', 'p166-o2@ejemplo.test', false, true from _q166
  union all select c1, 'p166-a', '+50600000168', 'p166-c1@ejemplo.test', true, true from _q166) x
 where m is not null;   -- con una mutación puede no haber control

insert into public.pos_ndf_tickets (id, local, numero_factura, fecha_registra, fecha_cierra, estado, canal, registrado_por,
                                    con_servicio, pax, pax_alerta, total_crc, regalia_crc)
values ('00000000-0000-4000-8000-000000166d01', 'p166-a', '00166001', now(), now(), 'C', 'salon', 'salonero', true, 2, 'ok', 0, 1000),
       ('00000000-0000-4000-8000-000000166d02', 'p166-a', '00166002', now(), now(), 'X', 'salon', 'salonero', true, 2, 'ok', 0, 0),
       ('00000000-0000-4000-8000-000000166d03', 'p166-a', '00166003', now(), now(), 'C', 'salon', 'salonero', true, 2, 'ok', 0, 0),
       ('00000000-0000-4000-8000-000000166d04', 'p166-a', '00166004', now(), now(), 'C', 'salon', 'salonero', true, 2, 'ok', 0, 0);
insert into public.pos_ndf_ticket_lines (ticket_id, codigo_producto, nombre, cantidad, precio, monto, familia, es_cortesia) values
  ('00000000-0000-4000-8000-000000166d01', 'P1', 'Plato uno', 1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000166d01', 'K1', 'Cortesia', 1, 2000, 2000, 17, true),
  ('00000000-0000-4000-8000-000000166d02', 'P1', 'Plato uno', 1, 10000, 10000, 2, false),
  ('00000000-0000-4000-8000-000000166d03', 'P2', 'Plato dos', 1, 5000, 5000, 2, false),
  ('00000000-0000-4000-8000-000000166d04', 'P3', 'Plato tres', 1, 4000, 4000, 2, false);

insert into public.club_visitas_socio (location_id, miembro_id, fecha, registrada_en, client_op_id, pos_ref, estado_beneficio, aplicar)
select x.loc, x.m, (x.en at time zone 'America/Costa_Rica')::date, x.en, gen_random_uuid(),
       case when x.f is not null then jsonb_build_object('modo', 'factura', 'numero_factura', x.f) end, 'aplica', '{}'::jsonb
  from _q166 q, lateral (values
    ('p166-a', q.o1, now(), '00166001'),
    ('p166-a', q.o1, now(), '00166001'),
    ('p166-a', q.o2, now(), '00166001'),
    ('p166-a', q.o3, now() - interval '1 day', '00166003'),       -- antes de su ventana: no cuenta (y F3 no suma a la oferta)
    ('p166-a', q.c1, now(), '00166002'),                            -- anulada
    ('p166-a', q.c1, now(), '00166003'),
    ('p166-b', q.c2, now(), null)                                   -- otro local
  ) x(loc, m, en, f)
 where x.m is not null;
-- O3: tarjeta de la app hoy con la factura elegida a mano (F4)
insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, factura_pos)
select '00000000-0000-4000-8000-000000166e01', 'p166-a', o3, 'tarjeta', 2, 6, 18000, now(), '00166099' from _q166;  -- 099 no existe: solo el cruce manual la encuentra
-- C1: tarjeta de la app hoy con la factura ANULADA (F2) elegida a mano: no suma
insert into public.club_movimientos (id, location_id, miembro_id, tipo, personas, personas_por_credito, valor_credito_crc, fecha_visita, factura_pos)
select '00000000-0000-4000-8000-000000166e02', 'p166-a', c1, 'tarjeta', 2, 6, 18000, now(), '00166098' from _q166 where c1 is not null;
insert into public.club_cruces_manuales (movimiento_id, location_id, numero_factura)
select '00000000-0000-4000-8000-000000166e01', 'p166-a', '00166004'
union all select id, 'p166-a', '00166002' from public.club_movimientos where id = '00000000-0000-4000-8000-000000166e02';

-- 6. la lista y el CSV: solo el grupo con oferta
create temp table _l166 on commit drop as
select pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_lista(%L)', a15)) as lista,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_lista(%L, true)', a15)) as csv,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_lista(%L, true)', b15)) as csv_b
  from _id166;
insert into _r166 (caso, ok, detalle)
select '6a la lista trae SOLO la oferta: filas = oferta, ningún miembro del control, el control como número',
       jsonb_array_length(lista->'filas') = (lista->>'oferta')::int
       and (lista->>'oferta')::int = (select count(*) from public.club_campana_asignaciones a, _id166 i where a.campana_id = i.a15 and a.grupo = 'oferta')
       and (lista->>'control')::int = (select count(*) from public.club_campana_asignaciones a, _id166 i where a.campana_id = i.a15 and a.grupo = 'control')
       and not exists (select 1 from jsonb_array_elements(lista->'filas') f
                        join public.club_campana_asignaciones a on a.miembro_id = (f->>'miembro_id')::uuid
                       where a.campana_id = (select a15 from _id166) and a.grupo = 'control'),
       (lista->>'oferta') || '/' || (lista->>'control') from _l166;
insert into _r166 (caso, ok, detalle)
select '6b el CSV excluye al control (ni su WhatsApp ni su correo) y trae el contacto solo con permiso',
       jsonb_array_length(csv->'filas') = (csv->>'oferta')::int
       and position('+50600000168' in csv::text) = 0 and position('p166-c1@' in csv::text) = 0
       and (select f->>'whatsapp' from jsonb_array_elements(csv->'filas') f, _q166 q where (f->>'miembro_id')::uuid = q.o1) = '+50600000166'
       and (select f->>'email'    from jsonb_array_elements(csv->'filas') f, _q166 q where (f->>'miembro_id')::uuid = q.o1) is null
       and (select f->>'email'    from jsonb_array_elements(csv->'filas') f, _q166 q where (f->>'miembro_id')::uuid = q.o2) = 'p166-o2@ejemplo.test'
       and (select f->>'whatsapp' from jsonb_array_elements(csv->'filas') f, _q166 q where (f->>'miembro_id')::uuid = q.o2) is null,
       left(csv::text, 120) from _l166;
insert into _r166 (caso, ok, detalle)
select '6c la lista (sin exporte) no trae contactos', position('+506' in lista::text) = 0 and position('@' in lista::text) = 0, null from _l166;
insert into _r166 (caso, ok, detalle)
select '6d campaña chica: CSV con los de oferta de p166-b (≤ 3)', jsonb_array_length(csv_b->'filas') = (csv_b->>'oferta')::int
       and (csv_b->>'oferta')::int + (csv_b->>'control')::int = 3, csv_b::text from _l166;

-- 7. reporte
create temp table _rep166 on commit drop as
select pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_reporte(%L)', a15)) as r,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_reporte(%L)', a0)) as r0,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_reporte(%L)', b15)) as rb,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_reporte(%L)', c15)) as rc
  from _id166;
insert into _r166 (caso, ok, detalle)
select '7a oferta: 3 con visita, 3 días, 2 facturas (F1 una vez aunque O1 y O2), ₡13.000 (neta sin fam. 17 − regalía + cruce manual)',
       (r->'oferta'->>'con_visita')::int = 3 and (r->'oferta'->>'visitas')::int = 3
       and (r->'oferta'->>'facturas')::int = 2 and (r->'oferta'->>'venta_respaldada_crc')::numeric = 13000,
       (r->'oferta')::text from _rep166;
insert into _r166 (caso, ok, detalle)
select '7b control: 1 con visita, 1 día, 1 factura (la anulada no), ₡5.000; la visita en otro local no cuenta',
       (r->'control'->>'con_visita')::int = 1 and (r->'control'->>'visitas')::int = 1
       and (r->'control'->>'facturas')::int = 1 and (r->'control'->>'venta_respaldada_crc')::numeric = 5000,
       (r->'control')::text from _rep166;
insert into _r166 (caso, ok, detalle)
select '7c tamaños y promedios: miembros = asignados de cada grupo; venta por miembro = venta ÷ miembros',
       (r->'oferta'->>'miembros')::int + (r->'control'->>'miembros')::int = 2001
       and (r->'control'->>'venta_por_miembro_crc')::numeric = round(5000.0 / nullif((r->'control'->>'miembros')::int, 0)),
       (r->'oferta'->>'miembros') || '/' || (r->'control'->>'miembros') from _rep166;
insert into _r166 (caso, ok, detalle)
select '7d con 2000 miembros el aviso «no concluyente» NO sale; ventana abierta (hoy), con PoS',
       (r->>'no_concluyente')::boolean = false and (r->>'cerrado')::boolean = false and (r->>'pos_sin_datos')::boolean = false
       and (r->>'umbral_minimo')::int = 30, concat_ws(' ', r->>'no_concluyente', r->>'cerrado', r->>'pos_sin_datos') from _rep166;
insert into _r166 (caso, ok, detalle)
select '7e campaña chica (3) y sin reserva (0 en control): aviso «no concluyente»',
       (rb->>'no_concluyente')::boolean and (r0->>'no_concluyente')::boolean and (r0->'control'->>'miembros')::int = 0,
       concat_ws(' ', rb->>'no_concluyente', r0->>'no_concluyente') from _rep166;
insert into _r166 (caso, ok, detalle)
select '7f cero datos: campaña vacía sin error, promedios null (no 0), sin PoS',
       jsonb_typeof(rc) = 'object' and (rc->'oferta'->>'miembros')::int = 0 and rc->'oferta'->'venta_por_miembro_crc' = 'null'::jsonb
       and (rc->>'pos_sin_datos')::boolean and (rc->>'no_concluyente')::boolean, left(rc::text, 160) from _rep166;
insert into _r166 (caso, ok, detalle)
select '7g el reporte no trae nombres ni contactos', position('Prueba Referente' in r::text) = 0 and position('+506' in r::text) = 0
       and position('@' in r::text) = 0, null from _rep166;

-- 8. rastro: una fila por apertura; cada exporte deja la suya
create temp table _a166 on commit drop as
select pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_reporte(%L, %L)', a15, '00000000-0000-4000-8000-0000001660a1')) as x1,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_reporte(%L, %L)', a15, '00000000-0000-4000-8000-0000001660a1')) as x2,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_lista(%L, false, %L)', a15, '00000000-0000-4000-8000-0000001660b1')) as x3,
       pg_temp.como('00000000-0000-4000-8000-000000166a01', format('public.club_campana_lista(%L, false, %L)', a15, '00000000-0000-4000-8000-0000001660b1')) as x4
  from _id166;
insert into _r166 (caso, ok, detalle)
select '8a reporte y lista: una fila por apertura (dos lecturas con el mismo id → 1)',
       (select count(*) from public.club_auditoria a where a.accion = 'ver_campana_reporte' and a.objeto_id = '00000000-0000-4000-8000-0000001660a1') = 1
       and (select count(*) from public.club_auditoria a where a.accion = 'ver_campana_lista' and a.objeto_id = '00000000-0000-4000-8000-0000001660b1') = 1
       and (select bool_and(jsonb_typeof(v) = 'object') from _a166, unnest(array[x1, x2, x3, x4]) v),
       null;
insert into _r166 (caso, ok, detalle)
select '8b cada exporte del CSV deja su fila (2 exportes → 2), con cuántas filas y sin datos',
       (select count(*) from public.club_auditoria a, _id166 i where a.accion = 'exporte_campana_csv' and a.objeto_id in (i.a15, i.b15)) = 2
       and (select bool_and(not (a.despues ? 'filas') or position('@' in a.despues::text) = 0) from public.club_auditoria a where a.accion = 'exporte_campana_csv')
       and exists (select 1 from public.club_auditoria a, _id166 i, _l166 l where a.accion = 'exporte_campana_csv' and a.objeto_id = i.a15
                     and (a.despues->>'filas')::int = (l.csv->>'oferta')::int),
       null;
insert into _r166 (caso, ok, detalle)
select '8c listar: las campañas del local con sus tamaños, sin personas',
       jsonb_array_length(x) = 3 and position('Prueba Referente' in x::text) = 0
       and (select bool_and(e ? 'oferta' and e ? 'control') from jsonb_array_elements(x) e), left(x::text, 120)
  from (select pg_temp.como('00000000-0000-4000-8000-000000166a01', $$public.club_campanas_listar('p166-a')$$) x) y;

-- 9. vuelta atrás (dentro de esta misma transacción descartada)
-- @@166R@@   (aquí va el cuerpo de scripts/sql/166_rollback.sql sin begin/commit)
insert into _r166 (caso, ok, detalle)
select '9 rollback: sin tablas ni funciones de la 166; club_reporte_mes y club_config siguen',
       to_regclass('public.club_campanas') is null and to_regclass('public.club_campana_asignaciones') is null
       and to_regprocedure('public.club_campana_reporte(uuid, uuid)') is null
       and to_regprocedure('public.club_campana_sorteo(text, uuid, uuid)') is null
       and to_regprocedure('public.club_reporte_mes(date, text, boolean)') is not null
       and (select count(*) from public.club_config where location_id like 'p166-%') = 3, null;

-- Resultado
select jsonb_agg(jsonb_build_object('caso', caso, 'ok', ok, 'detalle', detalle) order by n) as resultado from _r166;
do $$
declare v text;
begin
  select string_agg(split_part(caso, ' ', 1), ',' order by n) into v from _r166 where not ok;
  if v is not null then raise exception '166-FALLAN: %', v; end if;
  if (select count(*) from _r166) < 38 then raise exception '166-FALLAN: faltan casos (NO PROBADO)'; end if;
end $$;

rollback;
